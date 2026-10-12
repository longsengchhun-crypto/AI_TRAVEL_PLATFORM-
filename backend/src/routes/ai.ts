import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { requireAuth } from "../auth.js";
import { config } from "../config.js";
import { ApiError, h, notFound, parse } from "../http.js";
import { isLlmConfigured } from "../services/llm.js";
import {
  PlanRequest, generatePlan, loadItinerary, polishSummary, rebuildDayFromIds, recalcItinerary, regenerateDay, savePlan, understandRequest,
} from "../services/planner.js";
import { answerQuestion } from "../services/rag.js";
import { audit, notify } from "../services/notify.js";
import { isUuid } from "../services/search.js";
import { isIsoDate } from "../util.js";

export const aiRoutes = Router();

const aiLimiter = rateLimit({
  windowMs: 60_000, limit: config.isProd ? 20 : 500, standardHeaders: true, legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: { code: "RATE_LIMITED", message: "You are asking too quickly. Please wait a moment." } }),
});

async function usage(req: any, kind: string, mode: string, started: number, ok = true) {
  await req.db.query("INSERT INTO ai_usage_events(user_id, kind, mode, provider, latency_ms, ok) VALUES ($1,$2,$3,$4,$5,$6)",
    [req.user?.id ?? null, kind, mode, mode === "llm" ? "anthropic" : null, Date.now() - started, ok]);
}

aiRoutes.get("/ai/status", h(async (_req, res) => {
  res.json({
    llmConfigured: isLlmConfigured(),
    plannerMode: isLlmConfigured() ? "llm-assisted" : "rules",
    assistantMode: isLlmConfigured() ? "llm" : "retrieval-only",
    explanation: isLlmConfigured()
      ? "Language-model assistance is enabled; results are still grounded in stored records."
      : "No language-model key is configured. Planning uses a deterministic rules engine and answers are extracted from stored guides.",
  });
}));

/** Natural-language request or structured request -> grounded plan (not saved). */
aiRoutes.post("/ai/travel-plan", aiLimiter, h(async (req, res) => {
  const started = Date.now();
  const b = parse(z.object({
    prompt: z.string().trim().min(5).max(800).optional(),
    structured: PlanRequest.partial().optional(),
    save: z.boolean().default(false),
    startDate: z.string().refine(isIsoDate).optional(),
  }).refine((v) => v.prompt || v.structured, "Provide a prompt or structured request"), req.body);
  if (b.save && !req.user) throw new ApiError(401, "UNAUTHENTICATED", "Sign in to save an itinerary");

  const dests = (await req.db.query<{ slug: string; name: string }>("SELECT slug, name FROM destinations WHERE deleted_at IS NULL")).rows;
  let parsed: { request: PlanRequest; mode: "llm" | "rules"; note?: string };
  if (b.prompt) parsed = await understandRequest(b.prompt, dests);
  else parsed = { request: PlanRequest.parse({ destination: null, days: null, budgetUsd: null, ...b.structured }), mode: "rules" };
  if (b.prompt && b.structured) parsed.request = PlanRequest.parse({ ...parsed.request, ...b.structured });

  const r = parsed.request;
  const missing: string[] = [];
  if (!r.destination) missing.push("destination");
  if (!r.days) missing.push("days");
  if (missing.length) {
    await usage(req, "travel-plan", parsed.mode, started, false);
    return res.status(200).json({
      status: "needs_more_info", understood: r, missing,
      questions: missing.map((m) => (m === "destination" ? "Which destination would you like to visit?" : "How many days will you travel?")),
      availableDestinations: dests.map((d) => ({ slug: d.slug, name: d.name })),
    });
  }
  let plan = await generatePlan(req.db, r);
  plan = await polishSummary(plan);
  let itineraryId: string | undefined;
  if (b.save && req.user) {
    itineraryId = await savePlan(req.db, req.user.id, plan, r, b.startDate ?? null);
    await notify(req.db, req.user.id, "itinerary", "Itinerary saved", `"${plan.title}" was saved to your trips.`, { itineraryId });
  }
  await usage(req, "travel-plan", plan.mode, started);
  res.json({ status: "ok", understood: r, understoodBy: parsed.mode, parserNote: parsed.note, plan, itineraryId });
}));

aiRoutes.post("/ai/assistant", aiLimiter, h(async (req, res) => {
  const started = Date.now();
  const b = parse(z.object({ question: z.string().trim().min(3).max(500), destination: z.string().max(60).optional() }), req.body);
  const out = await answerQuestion(req.db, b.question, b.destination);
  await usage(req, "assistant", out.mode, started, out.grounded);
  if (req.user) {
    const c = (await req.db.query<any>("INSERT INTO ai_conversations(user_id) VALUES ($1) RETURNING id", [req.user.id])).rows[0];
    await req.db.query("INSERT INTO ai_messages(conversation_id, role, content) VALUES ($1,'user',$2)", [c.id, b.question]);
    await req.db.query("INSERT INTO ai_messages(conversation_id, role, content, sources, mode) VALUES ($1,'assistant',$2,$3,$4)",
      [c.id, out.answer, JSON.stringify(out.sources.map((s) => ({ slug: s.slug, title: s.title }))), out.mode]);
  }
  res.json(out);
}));

aiRoutes.post("/ai/recommendations", aiLimiter, h(async (req, res) => {
  const b = parse(z.object({ destination: z.string().min(2), interests: z.array(z.string().max(30)).max(8).default([]), budgetPerNightUsd: z.number().positive().optional(),
    children: z.number().int().min(0).max(10).default(0) }), req.body);
  const dest = (await req.db.query<any>("SELECT id, name, slug FROM destinations WHERE (slug=$1 OR id::text=$1) AND deleted_at IS NULL", [b.destination])).rows[0];
  if (!dest) throw notFound("Destination");
  const places = (await req.db.query<any>(
    `SELECT id, name, kind, category, price_usd, family_friendly, is_demo, image, tags FROM attractions WHERE destination_id=$1 AND deleted_at IS NULL`, [dest.id])).rows;
  const scored = places.map((p) => {
    const hits = b.interests.filter((i) => p.category === i || p.tags.includes(i));
    return { ...p, score: hits.length * 3 + (b.children > 0 && p.family_friendly ? 2 : 0) + (p.price_usd === 0 ? 0.5 : 0), matchedInterests: hits };
  }).sort((a, c) => c.score - a.score).slice(0, 8);
  const hotels = (await req.db.query<any>(
    `SELECT id, name, stars, from_price_usd, rating_avg, family_friendly FROM accommodations WHERE destination_id=$1 AND deleted_at IS NULL
        AND ($2::numeric IS NULL OR from_price_usd <= $2) ORDER BY rating_avg DESC LIMIT 4`, [dest.id, b.budgetPerNightUsd ?? null])).rows;
  res.json({ method: "rules", destination: dest, places: scored, accommodations: hotels,
    note: "Ranked by interest match from stored records. This is rule-based ranking, not a machine-learning prediction." });
}));

aiRoutes.get("/ai/sources", h(async (req, res) => {
  const { rows } = await req.db.query(
    `SELECT t.slug, t.title, t.category, t.source_label, t.is_demo, (SELECT COUNT(*)::int FROM document_chunks c WHERE c.document_id=t.id) AS chunks
       FROM travel_documents t ORDER BY t.category, t.title`);
  res.json({ retrieval: "PostgreSQL full-text search (lexical). Embedding search is not enabled.", items: rows });
}));

/* ---------------------------------------------------------------- itineraries */

const Item = z.object({ attractionId: z.string().uuid() });

aiRoutes.post("/itineraries", requireAuth, h(async (req, res) => {
  const b = parse(z.object({
    destination: z.string().min(2), days: z.number().int().min(1).max(14), adults: z.number().int().min(1).max(12).default(1),
    children: z.number().int().min(0).max(12).default(0), budgetUsd: z.number().positive().optional(), interests: z.array(z.string().max(30)).max(10).default([]),
    pace: z.enum(["relaxed", "balanced", "packed"]).default("balanced"), startDate: z.string().refine(isIsoDate).optional(),
    title: z.string().trim().min(2).max(120).optional(),
  }), req.body);
  const dest = (await req.db.query<any>("SELECT id FROM destinations WHERE (slug=$1 OR id::text=$1) AND deleted_at IS NULL", [b.destination])).rows[0];
  if (!dest) throw notFound("Destination");
  const it = (await req.db.query<any>(
    `INSERT INTO itineraries(user_id, destination_id, title, start_date, num_days, adults, children, budget_usd, interests, pace, generated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'manual') RETURNING id`,
    [req.user!.id, dest.id, b.title ?? `${b.days}-day trip`, b.startDate ?? null, b.days, b.adults, b.children, b.budgetUsd ?? null, b.interests, b.pace])).rows[0];
  res.status(201).json(await loadItinerary(req.db, it.id));
}));

aiRoutes.get("/itineraries", requireAuth, h(async (req, res) => {
  const { rows } = await req.db.query(
    `SELECT i.id, i.title, i.summary, i.num_days, i.start_date, i.est_total_usd, i.budget_usd, i.generated_by, i.updated_at, d.name AS destination_name, d.cover_image
       FROM itineraries i JOIN destinations d ON d.id=i.destination_id WHERE i.user_id=$1 ORDER BY i.updated_at DESC`, [req.user!.id]);
  res.json({ items: rows });
}));

async function ownedOrTemplate(req: any, id: string, write: boolean) {
  if (!isUuid(id)) throw notFound("Itinerary");
  const it = await loadItinerary(req.db, id);
  if (!it) throw notFound("Itinerary");
  const mine = req.user && it.user_id === req.user.id;
  if (write && !mine) throw notFound("Itinerary");
  if (!write && !mine && !it.is_template) throw notFound("Itinerary");
  return it;
}

aiRoutes.get("/itineraries/:id", h(async (req, res) => {
  const it = await ownedOrTemplate(req, String(req.params.id), false);
  res.json(it);
}));

aiRoutes.patch("/itineraries/:id", requireAuth, h(async (req, res) => {
  const it = await ownedOrTemplate(req, String(req.params.id), true);
  const b = parse(z.object({
    title: z.string().trim().min(2).max(120).optional(), startDate: z.string().refine(isIsoDate).nullable().optional(),
    adults: z.number().int().min(1).max(12).optional(), children: z.number().int().min(0).max(12).optional(),
    budgetUsd: z.number().positive().nullable().optional(),
    days: z.array(z.object({ day: z.number().int().min(1).max(14), items: z.array(Item).max(10) })).max(14).optional(),
  }).strict(), req.body);
  await req.db.tx(async (tx) => {
    await tx.query(
      `UPDATE itineraries SET title=COALESCE($2,title), start_date=CASE WHEN $3::boolean THEN $4::date ELSE start_date END,
              adults=COALESCE($5,adults), children=COALESCE($6,children),
              budget_usd=CASE WHEN $7::boolean THEN $8 ELSE budget_usd END, updated_at=now() WHERE id=$1`,
      [it.id, b.title ?? null, b.startDate !== undefined, b.startDate ?? null, b.adults ?? null, b.children ?? null, b.budgetUsd !== undefined, b.budgetUsd ?? null]);
    for (const d of b.days ?? []) await rebuildDayFromIds(tx, it.id, d.day, d.items.map((i) => i.attractionId));
    await recalcItinerary(tx, it.id);
  });
  await notify(req.db, req.user!.id, "itinerary", "Itinerary updated", `Your trip "${b.title ?? it.title}" was changed and its estimate recalculated.`, { itineraryId: it.id });
  res.json(await loadItinerary(req.db, it.id));
}));

aiRoutes.delete("/itineraries/:id", requireAuth, h(async (req, res) => {
  const it = await ownedOrTemplate(req, String(req.params.id), true);
  await req.db.query("DELETE FROM itineraries WHERE id=$1", [it.id]);
  await audit(req.db, req.user!.id, "itinerary.delete", "itinerary", it.id);
  res.status(204).end();
}));

aiRoutes.post("/itineraries/:id/generate", requireAuth, aiLimiter, h(async (req, res) => {
  const it = await ownedOrTemplate(req, String(req.params.id), true);
  const b = parse(z.object({ day: z.number().int().min(1).max(14).optional() }), req.body ?? {});
  const started = Date.now();
  if (b.day) {
    await regenerateDay(req.db, it.id, b.day);
  } else {
    for (let d = 1; d <= it.num_days; d++) await regenerateDay(req.db, it.id, d);
  }
  await recalcItinerary(req.db, it.id);
  await usage(req, "itinerary-generate", "rules", started);
  res.json(await loadItinerary(req.db, it.id));
}));

aiRoutes.post("/itineraries/:id/recalculate", requireAuth, h(async (req, res) => {
  const it = await ownedOrTemplate(req, String(req.params.id), true);
  const totals = await recalcItinerary(req.db, it.id);
  res.json({ ...totals, assumptions: ["Prices are stored indicative USD values; see itinerary assumptions."] });
}));

/** Copies a curated template into the signed-in user's trips. */
aiRoutes.post("/itineraries/:id/copy", requireAuth, h(async (req, res) => {
  const it = await ownedOrTemplate(req, String(req.params.id), false);
  const copy = await req.db.tx(async (tx) => {
    const n = (await tx.query<any>(
      `INSERT INTO itineraries(user_id, destination_id, title, summary, num_days, adults, children, budget_usd, interests, pace, generated_by, accommodation_id, est_total_usd, assumptions)
       SELECT $2, destination_id, title, summary, num_days, adults, children, budget_usd, interests, pace, 'manual', accommodation_id, est_total_usd, assumptions
         FROM itineraries WHERE id=$1 RETURNING id`, [it.id, req.user!.id])).rows[0];
    await tx.query(
      `INSERT INTO itinerary_items(itinerary_id, day_index, position, attraction_id, start_min, duration_min, travel_min_from_prev, est_cost_usd, reason)
       SELECT $2, day_index, position, attraction_id, start_min, duration_min, travel_min_from_prev, est_cost_usd, reason FROM itinerary_items WHERE itinerary_id=$1`, [it.id, n.id]);
    return n.id as string;
  });
  res.status(201).json(await loadItinerary(req.db, copy));
}));
