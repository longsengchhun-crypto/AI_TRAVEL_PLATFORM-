import { z } from "zod";
import type { Db } from "../db/index.js";
import { ApiError, notFound } from "../http.js";
import { haversineKm, round2 } from "../util.js";
import { extractJson, isLlmConfigured, llmComplete } from "./llm.js";

/* ------------------------------------------------------------------ request understanding */

export const PlanRequest = z.object({
  destination: z.string().min(1).nullable(),
  days: z.number().int().min(1).max(14).nullable(),
  adults: z.number().int().min(1).max(12).default(1),
  children: z.number().int().min(0).max(12).default(0),
  budgetUsd: z.number().positive().nullable(),
  budgetIsPerDay: z.boolean().default(false),
  interests: z.array(z.string()).default([]),
  pace: z.enum(["relaxed", "balanced", "packed"]).default("balanced"),
});
export type PlanRequest = z.infer<typeof PlanRequest>;

const WORD_NUM: Record<string, number> = { one: 1, a: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, couple: 2 };
const num = (s: string) => (/^\d+$/.test(s) ? Number(s) : WORD_NUM[s.toLowerCase()]);
const NUM_RE = "(\\d+|one|two|three|four|five|six|seven|eight|nine|ten|a)";

const INTEREST_KEYWORDS: Record<string, string[]> = {
  culture: ["culture", "cultural", "heritage", "museum", "history", "historical", "art"],
  food: ["food", "cuisine", "eat", "eating", "street food", "khmer food", "dining", "restaurant", "foodie"],
  photography: ["photo", "photography", "photographs", "instagram", "scenic"],
  temples: ["temple", "temples", "pagoda", "wat", "angkor"],
  nature: ["nature", "hiking", "trek", "waterfall", "wildlife", "jungle", "national park"],
  beach: ["beach", "beaches", "island", "snorkel", "swim"],
  relaxed: ["relaxed", "relaxing", "slow", "calm", "walks", "walk", "stroll", "easy"],
  family: ["family", "kids", "children", "child"],
  markets: ["market", "markets", "shopping", "souvenir"],
  outdoor: ["adventure", "outdoor", "kayak", "cycling", "bike"],
};

export function parseRequestRules(text: string, destinations: { slug: string; name: string }[]): PlanRequest {
  const t = text.toLowerCase();
  const dest = destinations.find((d) => t.includes(d.name.toLowerCase()) || t.includes(d.slug.replace(/-/g, " ")))
    ?? (t.includes("angkor") ? destinations.find((d) => d.slug === "siem-reap") : undefined)
    ?? (/\bbali\b|\bubud\b/.test(t) ? destinations.find((d) => d.slug === "bali") : undefined)
    ?? (/\bsaigon\b/.test(t) ? destinations.find((d) => d.slug === "ho-chi-minh-city") : undefined);

  let days: number | null = null;
  const dm = t.match(new RegExp(`${NUM_RE}[\\s-]*(?:days?|day trip)`)) ?? t.match(new RegExp(`${NUM_RE}[\\s-]*nights?`));
  if (dm) days = num(dm[1]) ?? null;
  if (days === null && /\bweekend\b/.test(t)) days = 2;
  if (days === null && /\bweek\b/.test(t)) days = 7;
  if (days && /nights?/.test(dm?.[0] ?? "")) days = days + 1;

  let adults = 1;
  const am = t.match(new RegExp(`${NUM_RE}\\s+adults?`));
  if (am) adults = num(am[1]) ?? 1;
  else if (/\bcouple\b|\bhoneymoon\b/.test(t)) adults = 2;
  else if (/\bsolo\b|\bmyself\b|\balone\b/.test(t)) adults = 1;
  let children = 0;
  const cm = t.match(new RegExp(`${NUM_RE}\\s+(?:children|kids|child|kid)`));
  if (cm) children = num(cm[1]) ?? 0;

  let budget: number | null = null;
  let perDay = false;
  const bm = t.match(/(?:\$|usd\s?)\s?(\d[\d,]*(?:\.\d+)?)/) ?? t.match(/(\d[\d,]*(?:\.\d+)?)\s?(?:usd|dollars?|bucks)/);
  if (bm) {
    budget = Number(bm[1].replace(/,/g, ""));
    const around = t.slice(Math.max(0, (bm.index ?? 0) - 15), (bm.index ?? 0) + bm[0].length + 20);
    perDay = /per day|a day|\/day|daily|each day/.test(around);
  }

  const interests = Object.entries(INTEREST_KEYWORDS)
    .filter(([, kws]) => kws.some((k) => new RegExp(`\\b${k}`).test(t))).map(([k]) => k);
  const pace = /relax|slow|easy|calm/.test(t) ? "relaxed" : /packed|busy|see everything|as much as/.test(t) ? "packed" : "balanced";
  if (children > 0 && !interests.includes("family")) interests.push("family");

  return { destination: dest?.slug ?? null, days, adults, children, budgetUsd: budget, budgetIsPerDay: perDay, interests, pace };
}

/** Tries the LLM for extraction when a key exists; always validates against the schema and falls back to rules. */
export async function understandRequest(text: string, destinations: { slug: string; name: string }[]):
  Promise<{ request: PlanRequest; mode: "llm" | "rules"; note?: string }> {
  if (isLlmConfigured()) {
    try {
      const raw = await llmComplete(
        "Extract trip parameters. Reply with ONLY a JSON object with keys: destination (one of the provided slugs or null), days (int|null), adults (int), children (int), budgetUsd (number|null), budgetIsPerDay (boolean), interests (array of lowercase keywords), pace ('relaxed'|'balanced'|'packed'). Do not invent values that the user did not state.",
        `Destination slugs: ${destinations.map((d) => d.slug).join(", ")}\nUser request: ${text}`, { maxTokens: 300, timeoutMs: 8000 });
      const parsed = PlanRequest.safeParse(extractJson(raw));
      if (parsed.success && (parsed.data.destination === null || destinations.some((d) => d.slug === parsed.data.destination))) {
        return { request: parsed.data, mode: "llm" };
      }
    } catch { /* fall through to rules */ }
  }
  return { request: parseRequestRules(text, destinations), mode: "rules",
    note: isLlmConfigured() ? "The language model was unavailable or returned invalid output; the rules-based parser was used." : undefined };
}

/* ------------------------------------------------------------------ planning */

interface Place {
  id: string; slug: string; name: string; kind: "attraction" | "restaurant" | "activity"; category: string; description: string;
  lat: number; lng: number; image: string | null; price_usd: number | null; duration_min: number;
  opens_min: number | null; closes_min: number | null; hours_verified: boolean; tags: string[]; family_friendly: boolean; is_demo: boolean;
}

export interface PlannedItem {
  attractionId: string; name: string; kind: string; category: string; lat: number; lng: number; image: string | null;
  startMin: number; durationMin: number; travelMinFromPrev: number; costUsd: number; reason: string; isDemo: boolean; hoursVerified: boolean;
}
export interface PlannedDay { day: number; items: PlannedItem[]; costUsd: number }
export interface Lodging { id: string; name: string; nightlyUsd: number; nights: number; totalUsd: number; breakfastIncluded: boolean; isDemo: boolean }
export interface Plan {
  title: string; summary: string; destination: { id: string; slug: string; name: string; lat: number; lng: number };
  days: PlannedDay[]; lodging: Lodging | null;
  budget: { lodgingUsd: number; activitiesUsd: number; foodUsd: number; transportUsd: number; totalUsd: number; budgetUsd: number | null;
    withinBudget: boolean | null; perDayUsd: number[] };
  assumptions: string[]; warnings: string[]; mode: "rules" | "llm"; modeNote: string;
}

const DAY_START = 9 * 60;
const SLOT_PLAN: Record<string, { want: number; withLunch: boolean; withEvening: boolean }> = {
  relaxed: { want: 2, withLunch: true, withEvening: false },
  balanced: { want: 3, withLunch: true, withEvening: true },
  packed: { want: 4, withLunch: true, withEvening: true },
};

const travelMin = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => Math.round((haversineKm(a.lat, a.lng, b.lat, b.lng) * 1.35 / 22) * 60) + 8; // 22 km/h urban estimate

function score(p: Place, req: PlanRequest): { s: number; why: string[] } {
  let s = 1; const why: string[] = [];
  const hay = new Set([p.category, ...p.tags].map((x) => x.toLowerCase()));
  const catMap: Record<string, string[]> = {
    culture: ["museum", "culture", "temple", "landmark"], temples: ["temple"], food: ["food", "cafe", "market"], markets: ["market"],
    nature: ["nature"], beach: ["beach"], outdoor: ["outdoor", "nature"], family: [], photography: ["landmark", "temple", "nature", "market"], relaxed: ["landmark", "nature", "cafe"],
  };
  for (const i of req.interests) {
    if (hay.has(i) || (catMap[i] ?? []).includes(p.category)) { s += 3; why.push(i); }
  }
  if (req.interests.includes("family") && p.family_friendly) { s += 2; why.push("family-friendly"); }
  if ((req.children ?? 0) > 0 && !p.family_friendly) s -= 2;
  if (req.interests.includes("relaxed") && p.duration_min > 150) s -= 1;
  if (p.price_usd === 0) s += 0.5;
  return { s, why };
}

const fmtT = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

function fitsHours(p: Place, start: number) {
  if (p.opens_min == null || p.closes_min == null) return true;
  const close = p.closes_min <= p.opens_min ? 1440 + p.closes_min : p.closes_min; // spans midnight
  return start >= p.opens_min && start + p.duration_min <= close;
}

function costFor(p: Place, adults: number, children: number): number {
  const price = p.price_usd ?? 0;
  if (p.kind === "restaurant") return round2(price * (adults + children * 0.6));
  return round2(price * adults + price * 0.5 * children);
}

function reasonFor(p: Place, why: string[], req: PlanRequest, hoursNote: string): string {
  const parts: string[] = [];
  if (why.length) parts.push(`Matches your interest in ${[...new Set(why)].slice(0, 3).join(", ")}`);
  else parts.push("A well-regarded local stop chosen to round out the day");
  if (p.family_friendly && (req.children ?? 0) > 0) parts.push("suitable for children");
  if (p.price_usd === 0) parts.push("free to visit");
  if (hoursNote) parts.push(hoursNote);
  return parts.join("; ") + ".";
}

function buildDay(
  day: number, pool: Place[], used: Set<string>, req: PlanRequest, hotel: { lat: number; lng: number } | null,
  slot = SLOT_PLAN[req.pace],
): PlannedDay {
  const items: PlannedItem[] = [];
  let cursor = DAY_START;
  let prev: { lat: number; lng: number } | null = hotel;
  const sights = pool.filter((p) => p.kind !== "restaurant" && !used.has(p.id));
  const eats = pool.filter((p) => p.kind === "restaurant" && !used.has(p.id));

  const pick = (cands: Place[], atMin: number, preferNear: boolean) => {
    let best: { p: Place; v: number; why: string[] } | null = null;
    for (const c of cands) {
      if (used.has(c.id) || !fitsHours(c, atMin)) continue;
      const { s, why } = score(c, req);
      const d = prev ? haversineKm(prev.lat, prev.lng, c.lat, c.lng) : 0;
      const v = s - (preferNear ? Math.min(d, 40) * 0.25 : Math.min(d, 40) * 0.05);
      if (!best || v > best.v) best = { p: c, v, why };
    }
    return best;
  };

  const push = (b: { p: Place; why: string[] }, startAt: number) => {
    const t = prev ? travelMin(prev, b.p) : 0;
    const start = Math.max(startAt, cursor + t);
    if (!fitsHours(b.p, start)) return false;
    const hoursNote = b.p.opens_min != null && b.p.closes_min != null
      ? `${b.p.hours_verified ? "open" : "typically open"} ${fmtT(b.p.opens_min)}-${fmtT(b.p.closes_min % 1440)}` : "";
    items.push({
      attractionId: b.p.id, name: b.p.name, kind: b.p.kind, category: b.p.category, lat: b.p.lat, lng: b.p.lng, image: b.p.image,
      startMin: start, durationMin: b.p.duration_min, travelMinFromPrev: items.length === 0 && !hotel ? 0 : t,
      costUsd: costFor(b.p, req.adults, req.children), reason: reasonFor(b.p, b.why, req, hoursNote), isDemo: b.p.is_demo, hoursVerified: b.p.hours_verified,
    });
    used.add(b.p.id);
    cursor = start + b.p.duration_min;
    prev = { lat: b.p.lat, lng: b.p.lng };
    return true;
  };

  const morningCount = Math.ceil(slot.want / 2);
  for (let i = 0; i < morningCount; i++) {
    const b = pick(sights, cursor + (prev ? 15 : 0), true);
    if (!b || !push(b, cursor)) break;
    if (cursor > 11 * 60 + 45) break;
  }
  if (slot.withLunch) {
    const lunchAt = Math.max(cursor + 10, 12 * 60);
    const b = pick(eats, lunchAt, true);
    if (b) push(b, lunchAt);
  }
  const afternoonCount = slot.want - morningCount;
  for (let i = 0; i < afternoonCount; i++) {
    const at = Math.max(cursor + 10, 13 * 60 + 30);
    const b = pick(sights, at, true);
    if (!b || !push(b, at)) break;
    if (cursor > 17 * 60 + 30) break;
  }
  if (slot.withEvening) {
    const at = Math.max(cursor + 10, 18 * 60 + 30);
    const b = pick(eats, at, true);
    if (b) push(b, at);
  }
  items.sort((a, b) => a.startMin - b.startMin);
  return { day, items, costUsd: round2(items.reduce((s, i) => s + i.costUsd, 0)) };
}

async function loadPool(db: Db, destinationId: string): Promise<Place[]> {
  const { rows } = await db.query<Place>(
    `SELECT id, slug, name, kind, category, description, lat, lng, image, price_usd, duration_min, opens_min, closes_min,
            hours_verified, tags, family_friendly, is_demo FROM attractions WHERE destination_id=$1 AND deleted_at IS NULL`, [destinationId]);
  return rows;
}

export async function chooseLodging(db: Db, destinationId: string, req: PlanRequest, nights: number, budgetUsd: number | null) {
  if (nights < 1) return null;
  const { rows } = await db.query<any>(
    `SELECT id, name, from_price_usd, rating_avg, breakfast_included, family_friendly, is_demo, lat, lng, tax_rate, service_fee_rate
       FROM accommodations WHERE destination_id=$1 AND deleted_at IS NULL AND from_price_usd > 0 ORDER BY from_price_usd`, [destinationId]);
  if (!rows.length) return null;
  const rooms = Math.max(1, Math.ceil(req.adults / 2));
  const loaded = (r: any) => round2(r.from_price_usd * rooms * (1 + r.tax_rate + r.service_fee_rate));
  let pickRow = rows[0];
  if (budgetUsd) {
    const lodgingBudget = (budgetUsd * 0.5) / nights;
    const ok = rows.filter((r) => loaded(r) <= lodgingBudget);
    if (ok.length) {
      const fam = req.children > 0 ? ok.filter((r) => r.family_friendly) : ok;
      pickRow = (fam.length ? fam : ok).sort((a, b) => b.rating_avg - a.rating_avg || a.from_price_usd - b.from_price_usd)[0];
    }
  } else {
    const fam = req.children > 0 ? rows.filter((r) => r.family_friendly) : rows;
    pickRow = (fam.length ? fam : rows).sort((a, b) => b.rating_avg - a.rating_avg)[Math.min(0, rows.length - 1)];
  }
  const nightly = loaded(pickRow);
  return {
    row: pickRow,
    lodging: { id: pickRow.id, name: pickRow.name, nightlyUsd: nightly, nights, totalUsd: round2(nightly * nights),
      breakfastIncluded: pickRow.breakfast_included, isDemo: pickRow.is_demo } as Lodging,
    rooms,
  };
}

export async function generatePlan(db: Db, req: PlanRequest, opts: { excludeIds?: string[] } = {}): Promise<Plan> {
  if (!req.destination) throw new ApiError(422, "MISSING_DESTINATION", "Which destination would you like to visit?");
  if (!req.days) throw new ApiError(422, "MISSING_DURATION", "How many days is your trip?");
  const dest = (await db.query<any>("SELECT id, slug, name, lat, lng, daily_budget_usd FROM destinations WHERE (slug=$1 OR id::text=$1) AND deleted_at IS NULL", [req.destination])).rows[0];
  if (!dest) throw notFound("Destination");
  const pool = await loadPool(db, dest.id);
  if (!pool.length) throw new ApiError(422, "NO_DATA", `We do not have attractions stored for ${dest.name} yet.`);

  const days = req.days;
  const nights = Math.max(0, days - 1);
  const totalBudget = req.budgetUsd ? (req.budgetIsPerDay ? req.budgetUsd * days : req.budgetUsd) : null;
  const lod = await chooseLodging(db, dest.id, req, nights, totalBudget);
  const hotel = lod ? { lat: lod.row.lat, lng: lod.row.lng } : null;

  const used = new Set<string>(opts.excludeIds ?? []);
  const planned: PlannedDay[] = [];
  for (let d = 1; d <= days; d++) planned.push(buildDay(d, pool, used, req, hotel));

  const people = req.adults + req.children;
  const transportPerDay = round2(Math.max(4, Math.min(20, dest.daily_budget_usd * 0.12)));
  const activitiesUsd = round2(planned.flatMap((d) => d.items).filter((i) => i.kind !== "restaurant").reduce((s, i) => s + i.costUsd, 0));
  const mealsPlanned = round2(planned.flatMap((d) => d.items).filter((i) => i.kind === "restaurant").reduce((s, i) => s + i.costUsd, 0));
  const breakfastAllowance = lod?.lodging.breakfastIncluded ? 0 : round2(3 * people * days);
  const foodUsd = round2(mealsPlanned + breakfastAllowance);
  const transportUsd = round2(transportPerDay * days);
  const lodgingUsd = lod?.lodging.totalUsd ?? 0;
  const total = round2(lodgingUsd + activitiesUsd + foodUsd + transportUsd);
  const perDay = planned.map((d, i) => round2(d.costUsd + transportPerDay + (lod?.lodging.breakfastIncluded ? 0 : 3 * people) + (i < nights ? (lodgingUsd / Math.max(1, nights)) : 0)));

  const warnings: string[] = [];
  const emptyDays = planned.filter((d) => d.items.length === 0).map((d) => d.day);
  if (emptyDays.length) warnings.push(`We only hold ${pool.length} listings for ${dest.name}, so day ${emptyDays.join(", ")} has no suggestions yet.`);
  const withinBudget = totalBudget ? total <= totalBudget : null;
  if (totalBudget && !withinBudget) warnings.push(`The estimate (${total} USD) is above your budget (${totalBudget} USD). Try fewer paid activities, a cheaper stay or fewer days.`);
  if (planned.flatMap((d) => d.items).some((i) => i.isDemo)) warnings.push("Some stops are educational demo listings whose prices and hours are sample values.");

  const assumptions = [
    `Prices are the stored indicative values in USD; children are charged at 50% for activities and 60% for meals.`,
    `Lodging: ${lod ? `${nights} night(s) at ${lod.lodging.name}, ${lod.rooms} room(s), base nightly rate plus taxes and fees` : "not included"}.`,
    `Transport allowance of ${transportPerDay} USD per day (tuk-tuk / ride-hailing estimate).`,
    breakfastAllowance ? `Breakfast allowance of 3 USD per person per day because the stay does not include breakfast.` : `Breakfast is included with the stay.`,
    `Travel times between stops are straight-line estimates at ~22 km/h; they do not use live traffic.`,
    `Opening hours are indicative unless marked verified; check locally before you go.`,
  ];

  const title = `${days} day${days > 1 ? "s" : ""} in ${dest.name}`;
  const interests = req.interests.length ? ` focused on ${req.interests.join(", ")}` : "";
  const summary = `A ${req.pace} ${days}-day plan for ${req.adults} adult${req.adults > 1 ? "s" : ""}${req.children ? ` and ${req.children} child${req.children > 1 ? "ren" : ""}` : ""}${interests}. Estimated total ${total} USD.`;

  return {
    title, summary, destination: { id: dest.id, slug: dest.slug, name: dest.name, lat: dest.lat, lng: dest.lng },
    days: planned, lodging: lod?.lodging ?? null,
    budget: { lodgingUsd, activitiesUsd, foodUsd, transportUsd, totalUsd: total, budgetUsd: totalBudget, withinBudget, perDayUsd: perDay },
    assumptions, warnings, mode: "rules",
    modeNote: "Built by WAYFARER's deterministic rules engine from stored database records. This is not an AI language-model output.",
  };
}

/** Optional LLM pass: rewrite only the summary text, never the structured data. Falls back silently. */
export async function polishSummary(plan: Plan): Promise<Plan> {
  if (!isLlmConfigured()) return plan;
  try {
    const stops = plan.days.map((d) => `Day ${d.day}: ${d.items.map((i) => i.name).join(", ")}`).join("\n");
    const txt = await llmComplete(
      "Write a warm, factual 2-sentence summary of this itinerary. Mention only the places listed. Do not add prices, hours or places.",
      `${plan.title}\n${stops}`, { maxTokens: 200, timeoutMs: 8000 });
    if (txt) return { ...plan, summary: txt, mode: "llm", modeNote: "Structure and costs come from stored database records; the summary text was written by a language model." };
  } catch { /* keep rules */ }
  return plan;
}

/* ------------------------------------------------------------------ persistence */

export async function savePlan(db: Db, userId: string | null, plan: Plan, req: PlanRequest, startDate?: string | null, opts: { template?: boolean } = {}) {
  return db.tx(async (tx) => {
    const it = (await tx.query<any>(
      `INSERT INTO itineraries(user_id, destination_id, title, summary, start_date, num_days, adults, children, budget_usd, interests, pace,
         generated_by, accommodation_id, est_total_usd, assumptions, is_template)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
      [userId, plan.destination.id, plan.title, plan.summary, startDate ?? null, plan.days.length, req.adults, req.children, plan.budget.budgetUsd,
        req.interests, req.pace, opts.template ? "curated" : plan.mode, plan.lodging?.id ?? null, plan.budget.totalUsd,
        JSON.stringify(plan.assumptions), !!opts.template])).rows[0];
    for (const d of plan.days) {
      let pos = 0;
      for (const i of d.items) {
        await tx.query(
          `INSERT INTO itinerary_items(itinerary_id, day_index, position, attraction_id, start_min, duration_min, travel_min_from_prev, est_cost_usd, reason)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [it.id, d.day, pos++, i.attractionId, i.startMin, i.durationMin, i.travelMinFromPrev, i.costUsd, i.reason]);
      }
    }
    return it.id as string;
  });
}

export async function loadItinerary(db: Db, id: string) {
  const it = (await db.query<any>(
    `SELECT i.*, d.name AS destination_name, d.slug AS destination_slug, d.lat AS dest_lat, d.lng AS dest_lng, a.name AS accommodation_name
       FROM itineraries i JOIN destinations d ON d.id=i.destination_id LEFT JOIN accommodations a ON a.id=i.accommodation_id WHERE i.id=$1`, [id])).rows[0];
  if (!it) return null;
  const items = (await db.query<any>(
    `SELECT ii.day_index, ii.position, ii.attraction_id, ii.start_min, ii.duration_min, ii.travel_min_from_prev, ii.est_cost_usd, ii.reason,
            a.name, a.kind, a.category, a.lat, a.lng, a.image, a.is_demo, a.hours_verified, a.price_usd
       FROM itinerary_items ii JOIN attractions a ON a.id=ii.attraction_id WHERE ii.itinerary_id=$1 ORDER BY ii.day_index, ii.position`, [id])).rows;
  const days: PlannedDay[] = [];
  for (let d = 1; d <= it.num_days; d++) {
    const its = items.filter((x) => x.day_index === d).map((x): PlannedItem => ({
      attractionId: x.attraction_id, name: x.name, kind: x.kind, category: x.category, lat: x.lat, lng: x.lng, image: x.image,
      startMin: x.start_min, durationMin: x.duration_min, travelMinFromPrev: x.travel_min_from_prev, costUsd: x.est_cost_usd,
      reason: x.reason ?? "", isDemo: x.is_demo, hoursVerified: x.hours_verified,
    }));
    days.push({ day: d, items: its, costUsd: round2(its.reduce((s, i) => s + i.costUsd, 0)) });
  }
  return { ...it, days };
}

/** Re-schedules a day from an ordered list of attraction ids (used for edit / reorder / replace / remove) and re-prices it. */
export async function rebuildDayFromIds(db: Db, itineraryId: string, dayIndex: number, attractionIds: string[]) {
  const it = (await db.query<any>("SELECT * FROM itineraries WHERE id=$1", [itineraryId])).rows[0];
  if (!it) throw notFound("Itinerary");
  if (dayIndex < 1 || dayIndex > it.num_days) throw new ApiError(422, "INVALID_DAY", "Day is outside the itinerary");
  if (new Set(attractionIds).size !== attractionIds.length) throw new ApiError(422, "DUPLICATE_STOP", "A place can only appear once per day");
  const places = attractionIds.length
    ? (await db.query<Place>(
      `SELECT id, name, kind, category, lat, lng, image, price_usd, duration_min, opens_min, closes_min, hours_verified, tags, family_friendly, is_demo, slug, description
         FROM attractions WHERE id = ANY($1::uuid[]) AND destination_id=$2 AND deleted_at IS NULL`, [attractionIds, it.destination_id])).rows
    : [];
  if (places.length !== attractionIds.length) throw new ApiError(422, "UNKNOWN_PLACE", "One or more places do not exist in this destination");
  const byId = new Map(places.map((p) => [p.id, p]));
  await db.query("DELETE FROM itinerary_items WHERE itinerary_id=$1 AND day_index=$2", [itineraryId, dayIndex]);
  let cursor = DAY_START; let prev: Place | null = null; let pos = 0;
  for (const id of attractionIds) {
    const p = byId.get(id)!;
    const t = prev ? travelMin(prev, p) : 0;
    let start = cursor + t;
    if (p.opens_min != null && start < p.opens_min) start = p.opens_min;
    if (p.kind === "restaurant" && start < 12 * 60 && pos > 0) start = 12 * 60;
    await db.query(
      `INSERT INTO itinerary_items(itinerary_id, day_index, position, attraction_id, start_min, duration_min, travel_min_from_prev, est_cost_usd, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [itineraryId, dayIndex, pos++, p.id, start, p.duration_min, t, costFor(p, it.adults, it.children), "Added by you"]);
    cursor = start + p.duration_min; prev = p;
  }
}

export async function recalcItinerary(db: Db, itineraryId: string) {
  const it = (await db.query<any>("SELECT * FROM itineraries WHERE id=$1", [itineraryId])).rows[0];
  if (!it) throw notFound("Itinerary");
  const items = (await db.query<any>(
    `SELECT ii.id, a.price_usd, a.kind FROM itinerary_items ii JOIN attractions a ON a.id=ii.attraction_id WHERE ii.itinerary_id=$1`, [itineraryId])).rows;
  for (const i of items) {
    const price = i.price_usd ?? 0;
    const c = i.kind === "restaurant" ? price * (it.adults + it.children * 0.6) : price * it.adults + price * 0.5 * it.children;
    await db.query("UPDATE itinerary_items SET est_cost_usd=$2 WHERE id=$1", [i.id, round2(c)]);
  }
  const dest = (await db.query<any>("SELECT daily_budget_usd FROM destinations WHERE id=$1", [it.destination_id])).rows[0];
  const lodging = it.accommodation_id
    ? (await db.query<any>("SELECT from_price_usd, tax_rate, service_fee_rate, breakfast_included FROM accommodations WHERE id=$1", [it.accommodation_id])).rows[0] : null;
  const rooms = Math.max(1, Math.ceil(it.adults / 2));
  const nights = Math.max(0, it.num_days - 1);
  const lodgingUsd = lodging ? round2(lodging.from_price_usd * rooms * (1 + lodging.tax_rate + lodging.service_fee_rate) * nights) : 0;
  const activities = (await db.query<any>("SELECT COALESCE(SUM(est_cost_usd),0) AS s FROM itinerary_items WHERE itinerary_id=$1", [itineraryId])).rows[0].s as number;
  const transport = round2(Math.max(4, Math.min(20, dest.daily_budget_usd * 0.12)) * it.num_days);
  const breakfast = lodging?.breakfast_included ? 0 : round2(3 * (it.adults + it.children) * it.num_days);
  const total = round2(lodgingUsd + activities + transport + breakfast);
  await db.query("UPDATE itineraries SET est_total_usd=$2, updated_at=now() WHERE id=$1", [itineraryId, total]);
  return { totalUsd: total, lodgingUsd, activitiesAndMealsUsd: round2(activities), transportUsd: transport, breakfastAllowanceUsd: breakfast,
    withinBudget: it.budget_usd ? total <= it.budget_usd : null, budgetUsd: it.budget_usd };
}

export async function regenerateDay(db: Db, itineraryId: string, dayIndex: number) {
  const it = (await db.query<any>("SELECT * FROM itineraries WHERE id=$1", [itineraryId])).rows[0];
  if (!it) throw notFound("Itinerary");
  if (dayIndex < 1 || dayIndex > it.num_days) throw new ApiError(422, "INVALID_DAY", "Day is outside the itinerary");
  const other = (await db.query<{ attraction_id: string }>(
    "SELECT attraction_id FROM itinerary_items WHERE itinerary_id=$1 AND day_index<>$2", [itineraryId, dayIndex])).rows.map((r) => r.attraction_id);
  const current = (await db.query<{ attraction_id: string }>(
    "SELECT attraction_id FROM itinerary_items WHERE itinerary_id=$1 AND day_index=$2", [itineraryId, dayIndex])).rows.map((r) => r.attraction_id);
  const pool = await loadPool(db, it.destination_id);
  const req: PlanRequest = { destination: it.destination_id, days: it.num_days, adults: it.adults, children: it.children,
    budgetUsd: it.budget_usd, budgetIsPerDay: false, interests: it.interests, pace: it.pace };
  const hotel = it.accommodation_id
    ? (await db.query<any>("SELECT lat, lng FROM accommodations WHERE id=$1", [it.accommodation_id])).rows[0] : null;
  // Prefer new stops: exclude the previous ones first, fall back to allowing them if the pool is too small.
  let day = buildDay(dayIndex, pool, new Set([...other, ...current]), req, hotel);
  if (day.items.length === 0) day = buildDay(dayIndex, pool, new Set(other), req, hotel);
  await db.query("DELETE FROM itinerary_items WHERE itinerary_id=$1 AND day_index=$2", [itineraryId, dayIndex]);
  let pos = 0;
  for (const i of day.items) {
    await db.query(
      `INSERT INTO itinerary_items(itinerary_id, day_index, position, attraction_id, start_min, duration_min, travel_min_from_prev, est_cost_usd, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [itineraryId, dayIndex, pos++, i.attractionId, i.startMin, i.durationMin, i.travelMinFromPrev, i.costUsd, i.reason]);
  }
  return day;
}
