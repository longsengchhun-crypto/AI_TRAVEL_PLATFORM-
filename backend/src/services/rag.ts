import type { Db } from "../db/index.js";
import { isLlmConfigured, llmComplete } from "./llm.js";

/**
 * Retrieval-augmented answering over approved travel_documents.
 * Retrieval: PostgreSQL full-text search (tsvector + ts_rank) over document_chunks, OR-combined query terms.
 * This is lexical retrieval, NOT embedding/semantic search. pgvector is available on Neon and can be added
 * when an embedding provider key is configured (see docs/AI_ENGINEERING.md).
 */
const STOP = new Set(("a an the and or but if of to in on at for from by with about is are was were be been am do does did " +
  "i you we they he she it my your our their me us what which who whom how when where why can could should would will shall may might " +
  "there here this that these those any some into over under than then so very just also not no yes please tell need want know").split(" "));

// Small, explicit synonym map. This is query expansion for lexical search, not semantic understanding.
const SYNONYMS: Record<string, string[]> = {
  wear: ["dress", "clothes", "clothing"], clothes: ["dress", "clothing"], cost: ["price", "budget"], cheap: ["budget"], money: ["dollars", "riel", "payments"],
  cancel: ["cancellation", "refund"], refund: ["cancellation"], bus: ["minibuses", "transport"], taxi: ["tuk-tuk", "transport"], getting: ["transport"],
  safe: ["safety"], dangerous: ["safety"], pay: ["payment", "payments"], kids: ["children", "family"], visa: ["entry"], hours: ["open", "opening"],
};

export function toOrQuery(q: string): string {
  const base = q.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t.length > 2 && !STOP.has(t));
  const expanded = base.flatMap((t) => [t, ...(SYNONYMS[t] ?? [])]).map((t) => t.replace(/[^a-z0-9]/g, ""));
  return [...new Set(expanded.filter(Boolean))].slice(0, 16).join(" | ");
}

export function chunkText(text: string, target = 480): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [text];
  const chunks: string[] = []; let cur = "";
  for (const s of sentences) {
    if ((cur + s).length > target && cur) { chunks.push(cur.trim()); cur = ""; }
    cur += s;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

export interface Source { documentId: string; slug: string; title: string; source: string; category: string; snippet: string; score: number; isDemo: boolean }

export async function retrieve(db: Db, question: string, limit = 4, destinationSlug?: string): Promise<Source[]> {
  const tsq = toOrQuery(question);
  if (!tsq) return [];
  const params: unknown[] = [tsq, limit];
  let destClause = "";
  if (destinationSlug) { params.push(destinationSlug); destClause = "AND (d.slug = $3 OR t.destination_id IS NULL)"; }
  const { rows } = await db.query<any>(
    `SELECT t.id AS document_id, t.slug, t.title, t.source_label, t.category, t.is_demo, c.content,
            ts_rank(c.tsv, to_tsquery('english', $1)) AS score
       FROM document_chunks c
       JOIN travel_documents t ON t.id = c.document_id
       LEFT JOIN destinations d ON d.id = t.destination_id
      WHERE c.tsv @@ to_tsquery('english', $1) ${destClause}
      ORDER BY score DESC LIMIT $2`, params);
  return rows.map((r) => ({ documentId: r.document_id, slug: r.slug, title: r.title, source: r.source_label, category: r.category,
    snippet: r.content, score: Number(r.score), isDemo: r.is_demo }));
}

export interface Answer {
  answer: string; mode: "retrieval-only" | "llm"; sources: Source[]; grounded: boolean; disclaimer: string;
}

const DISCLAIMER = "Answers are drawn from WAYFARER's educational demo guides. Verify prices, opening hours, visas and safety advice with official sources before travelling.";

export async function answerQuestion(db: Db, question: string, destinationSlug?: string): Promise<Answer> {
  const sources = await retrieve(db, question, 4, destinationSlug);
  if (sources.length === 0) {
    return { answer: "I couldn't find anything about that in the approved travel guides, so I don't want to guess. Try rephrasing, or ask about a destination, transport, cancellation policy or temple etiquette.",
      mode: "retrieval-only", sources: [], grounded: false, disclaimer: DISCLAIMER };
  }
  if (isLlmConfigured()) {
    try {
      const ctx = sources.map((s, i) => `[${i + 1}] ${s.title}: ${s.snippet}`).join("\n\n");
      const text = await llmComplete(
        "You are a travel information assistant. Answer ONLY using the numbered context. Cite sources like [1]. If the context does not contain the answer, say you do not have that information. Never invent prices, opening hours or policies. Keep it under 150 words.",
        `Context:\n${ctx}\n\nQuestion: ${question}`, { maxTokens: 400, timeoutMs: 12_000 });
      if (text) return { answer: text, mode: "llm", sources, grounded: true, disclaimer: DISCLAIMER };
    } catch { /* fall back to extractive answer below */ }
  }
  const body = sources.slice(0, 3).map((s, i) => `${s.snippet} [${i + 1}]`).join("\n\n");
  return {
    answer: `Here is what the approved guides say:\n\n${body}`,
    mode: "retrieval-only", sources, grounded: true, disclaimer: DISCLAIMER,
  };
}
