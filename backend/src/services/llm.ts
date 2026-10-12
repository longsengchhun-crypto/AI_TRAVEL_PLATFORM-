import { config } from "../config.js";

/**
 * Provider abstraction. Only one concrete provider (Anthropic Messages API over fetch) is implemented.
 * When no key is configured isLlmConfigured() is false and callers MUST use their deterministic fallback
 * and report mode = 'rules' / 'retrieval-only' to the user.
 */
export const isLlmConfigured = () => config.aiApiKey.length > 0;

export async function llmComplete(system: string, user: string, opts: { maxTokens?: number; timeoutMs?: number } = {}): Promise<string> {
  if (!isLlmConfigured()) throw new Error("LLM not configured");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 15_000);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: ctl.signal,
      headers: { "content-type": "application/json", "x-api-key": config.aiApiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: config.aiModel,
        max_tokens: opts.maxTokens ?? 800,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!r.ok) throw new Error(`LLM HTTP ${r.status}`);
    const j: any = await r.json();
    return (j.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n").trim();
  } finally {
    clearTimeout(timer);
  }
}

/** Extracts the first JSON object from model text (models sometimes wrap JSON in prose or fences). */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("No JSON object in model output");
  return JSON.parse(text.slice(start, end + 1));
}
