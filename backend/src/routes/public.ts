import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth.js";
import { ApiError, h, notFound, parse } from "../http.js";
import { quoteStay } from "../services/booking.js";
import { AccommodationQuery, isUuid, searchAccommodations } from "../services/search.js";
import { haversineKm, isIsoDate, round2 } from "../util.js";

export const publicRoutes = Router();

const paging = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(12) });
const like = (s: string) => `%${s.replace(/[%_\\]/g, "\\$&")}%`;

async function destinationByIdOrSlug(db: any, key: string) {
  const col = isUuid(key) ? "id" : "slug";
  return (await db.query(`SELECT * FROM destinations WHERE ${col} = $1 AND deleted_at IS NULL`, [key])).rows[0];
}

publicRoutes.get("/meta", h(async (req, res) => {
  const [currencies, amenities, dests] = await Promise.all([
    req.db.query("SELECT code, name, symbol, per_usd, rate_source, updated_at FROM currencies ORDER BY code"),
    req.db.query("SELECT code, label FROM amenities ORDER BY label"),
    req.db.query("SELECT slug, name, country FROM destinations WHERE deleted_at IS NULL ORDER BY name"),
  ]);
  res.json({ currencies: currencies.rows, amenities: amenities.rows, destinations: dests.rows,
    notice: "Exchange rates are documented sample rates, not live market rates." });
}));

publicRoutes.get("/home", h(async (req, res) => {
  const [featured, trending, hotels, itineraries, categories, counts] = await Promise.all([
    req.db.query("SELECT id, slug, name, country, short_description, cover_image, image_credit, daily_budget_usd, tags FROM destinations WHERE deleted_at IS NULL AND is_featured ORDER BY popularity DESC LIMIT 6"),
    req.db.query("SELECT id, slug, name, country, short_description, cover_image, image_credit, daily_budget_usd, tags FROM destinations WHERE deleted_at IS NULL ORDER BY popularity DESC LIMIT 8"),
    req.db.query(`SELECT a.id, a.slug, a.name, a.type, a.stars, a.cover_image, a.rating_avg, a.review_count, a.from_price_usd, a.is_demo, d.name AS destination_name
                    FROM accommodations a JOIN destinations d ON d.id=a.destination_id WHERE a.deleted_at IS NULL AND a.review_count >= 2
                    ORDER BY a.rating_avg DESC, a.review_count DESC LIMIT 6`),
    req.db.query(`SELECT i.id, i.title, i.summary, i.num_days, i.est_total_usd, i.interests, d.name AS destination_name, d.cover_image
                    FROM itineraries i JOIN destinations d ON d.id=i.destination_id WHERE i.is_template ORDER BY i.est_total_usd LIMIT 6`),
    req.db.query("SELECT category, COUNT(*)::int AS count FROM attractions WHERE deleted_at IS NULL GROUP BY category ORDER BY count DESC"),
    req.db.query(`SELECT (SELECT COUNT(*) FROM destinations WHERE deleted_at IS NULL) AS destinations,
                         (SELECT COUNT(*) FROM accommodations WHERE deleted_at IS NULL) AS accommodations,
                         (SELECT COUNT(*) FROM attractions WHERE deleted_at IS NULL) AS places`),
  ]);
  res.json({ featured: featured.rows, trending: trending.rows, hotels: hotels.rows, itineraries: itineraries.rows,
    categories: categories.rows, counts: counts.rows[0] });
}));

/* ---------------------------------------------------------------- destinations */

publicRoutes.get("/destinations", h(async (req, res) => {
  const q = parse(paging.extend({
    q: z.string().trim().max(80).optional(), country: z.string().optional(), tag: z.string().optional(),
    international: z.enum(["true", "false"]).optional(), featured: z.enum(["true", "false"]).optional(),
    sort: z.enum(["popularity", "name", "budget_asc", "budget_desc"]).default("popularity"),
  }), req.query);
  const params: unknown[] = []; const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
  const where = ["deleted_at IS NULL"];
  if (q.q) { const l = p(like(q.q)); where.push(`(name ILIKE ${l} OR country ILIKE ${l} OR short_description ILIKE ${l})`); }
  if (q.country) where.push(`country = ${p(q.country)}`);
  if (q.tag) where.push(`${p(q.tag)} = ANY(tags)`);
  if (q.international) where.push(`is_international = ${q.international === "true"}`);
  if (q.featured === "true") where.push("is_featured");
  const order = { popularity: "popularity DESC", name: "name", budget_asc: "daily_budget_usd", budget_desc: "daily_budget_usd DESC" }[q.sort];
  const limit = p(q.pageSize), offset = p((q.page - 1) * q.pageSize);
  const { rows } = await req.db.query<any>(
    `SELECT id, slug, name, country, region, is_international, short_description, lat, lng, cover_image, image_credit, daily_budget_usd, currency, tags, is_featured,
            (SELECT COUNT(*)::int FROM accommodations a WHERE a.destination_id=destinations.id AND a.deleted_at IS NULL) AS accommodation_count,
            (SELECT COUNT(*)::int FROM attractions t WHERE t.destination_id=destinations.id AND t.deleted_at IS NULL) AS place_count,
            COUNT(*) OVER () AS total_count
       FROM destinations WHERE ${where.join(" AND ")} ORDER BY ${order}, name LIMIT ${limit} OFFSET ${offset}`, params);
  const total = Number(rows[0]?.total_count ?? 0);
  res.json({ items: rows.map(({ total_count, ...r }) => r), page: q.page, pageSize: q.pageSize, total, totalPages: Math.ceil(total / q.pageSize) });
}));

publicRoutes.get("/destinations/:id", h(async (req, res) => {
  const d = await destinationByIdOrSlug(req.db, String(req.params.id));
  if (!d) throw notFound("Destination");
  const [images, related, top, hotels, docs] = await Promise.all([
    req.db.query("SELECT url, caption, credit FROM destination_images WHERE destination_id=$1 ORDER BY position", [d.id]),
    req.db.query(`SELECT r.id, r.slug, r.name, r.country, r.cover_image, r.lat, r.lng, r.short_description FROM related_destinations rd
                    JOIN destinations r ON r.id = rd.related_id WHERE rd.destination_id = $1 AND r.deleted_at IS NULL`, [d.id]),
    req.db.query(`SELECT id, slug, kind, category, name, image, price_usd, duration_min, lat, lng, is_demo FROM attractions
                   WHERE destination_id=$1 AND deleted_at IS NULL AND kind <> 'restaurant' ORDER BY price_usd DESC NULLS LAST LIMIT 6`, [d.id]),
    req.db.query(`SELECT id, slug, name, stars, type, cover_image, rating_avg, review_count, from_price_usd FROM accommodations
                   WHERE destination_id=$1 AND deleted_at IS NULL ORDER BY rating_avg DESC LIMIT 4`, [d.id]),
    req.db.query("SELECT slug, title, category FROM travel_documents WHERE destination_id=$1 OR destination_id IS NULL ORDER BY (destination_id IS NULL), title LIMIT 8", [d.id]),
  ]);
  const relatedWithDist = related.rows.map((r: any) => ({ ...r, distance_km: Math.round(haversineKm(d.lat, d.lng, r.lat, r.lng)) }));
  res.json({ ...d, images: images.rows, related: relatedWithDist, top_attractions: top.rows, top_accommodations: hotels.rows,
    guides: docs.rows, estimated_daily_budget_note: "Indicative mid-range daily budget in USD, excluding international travel." });
}));

publicRoutes.get("/destinations/:id/attractions", h(async (req, res) => {
  const d = await destinationByIdOrSlug(req.db, String(req.params.id));
  if (!d) throw notFound("Destination");
  const q = parse(paging.extend({ kind: z.enum(["attraction", "restaurant", "activity"]).optional(), category: z.string().optional(),
    q: z.string().trim().max(80).optional(), familyFriendly: z.enum(["true", "false"]).optional(),
    sort: z.enum(["name", "price_asc", "price_desc", "duration"]).default("name") }), req.query);
  const params: unknown[] = [d.id]; const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
  const where = ["destination_id = $1", "deleted_at IS NULL"];
  if (q.kind) where.push(`kind = ${p(q.kind)}`);
  if (q.category) where.push(`category = ${p(q.category)}`);
  if (q.q) where.push(`name ILIKE ${p(like(q.q))}`);
  if (q.familyFriendly === "true") where.push("family_friendly");
  const order = { name: "name", price_asc: "price_usd NULLS LAST", price_desc: "price_usd DESC NULLS LAST", duration: "duration_min" }[q.sort];
  const limit = p(q.pageSize), offset = p((q.page - 1) * q.pageSize);
  const { rows } = await req.db.query<any>(
    `SELECT id, slug, kind, category, name, description, lat, lng, image, image_credit, price_usd, duration_min, opens_min, closes_min,
            hours_verified, tags, family_friendly, is_demo, COUNT(*) OVER () AS total_count
       FROM attractions WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`, params);
  const total = Number(rows[0]?.total_count ?? 0);
  res.json({ items: rows.map(({ total_count, ...r }) => r), page: q.page, pageSize: q.pageSize, total, totalPages: Math.ceil(total / q.pageSize) });
}));

publicRoutes.get("/destinations/:id/accommodations", h(async (req, res) => {
  const d = await destinationByIdOrSlug(req.db, String(req.params.id));
  if (!d) throw notFound("Destination");
  const q = parse(AccommodationQuery, { ...req.query, destination: d.id });
  res.json(await searchAccommodations(req.db, q));
}));

/* ---------------------------------------------------------------- attractions */

publicRoutes.get("/attractions", h(async (req, res) => {
  const q = parse(paging.extend({ destination: z.string().optional(), kind: z.enum(["attraction", "restaurant", "activity"]).optional(),
    category: z.string().optional(), q: z.string().trim().max(80).optional() }), req.query);
  const params: unknown[] = []; const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
  const where = ["t.deleted_at IS NULL"];
  if (q.destination) where.push(isUuid(q.destination) ? `t.destination_id = ${p(q.destination)}` : `d.slug = ${p(q.destination)}`);
  if (q.kind) where.push(`t.kind = ${p(q.kind)}`);
  if (q.category) where.push(`t.category = ${p(q.category)}`);
  if (q.q) where.push(`t.name ILIKE ${p(like(q.q))}`);
  const limit = p(q.pageSize), offset = p((q.page - 1) * q.pageSize);
  const { rows } = await req.db.query<any>(
    `SELECT t.id, t.slug, t.kind, t.category, t.name, t.description, t.lat, t.lng, t.image, t.price_usd, t.duration_min, t.is_demo,
            d.name AS destination_name, d.slug AS destination_slug, COUNT(*) OVER () AS total_count
       FROM attractions t JOIN destinations d ON d.id=t.destination_id WHERE ${where.join(" AND ")} ORDER BY t.name LIMIT ${limit} OFFSET ${offset}`, params);
  const total = Number(rows[0]?.total_count ?? 0);
  res.json({ items: rows.map(({ total_count, ...r }) => r), page: q.page, pageSize: q.pageSize, total, totalPages: Math.ceil(total / q.pageSize) });
}));

publicRoutes.get("/attractions/:id", h(async (req, res) => {
  const col = isUuid(String(req.params.id)) ? "t.id" : "t.slug";
  const a = (await req.db.query<any>(
    `SELECT t.*, d.name AS destination_name, d.slug AS destination_slug FROM attractions t JOIN destinations d ON d.id=t.destination_id
      WHERE ${col}=$1 AND t.deleted_at IS NULL`, [String(req.params.id)])).rows[0];
  if (!a) throw notFound("Attraction");
  res.json(a);
}));

/* ---------------------------------------------------------------- accommodations */

publicRoutes.get("/accommodations", h(async (req, res) => {
  const q = parse(AccommodationQuery, req.query);
  if (req.user) {
    const term = q.q ?? q.destination;
    if (term) await req.db.query("INSERT INTO search_history(user_id, query) VALUES ($1,$2)", [req.user.id, term]);
  }
  res.json(await searchAccommodations(req.db, q));
}));

const DatesQ = z.object({
  checkIn: z.string().refine(isIsoDate, "Use YYYY-MM-DD").optional(), checkOut: z.string().refine(isIsoDate, "Use YYYY-MM-DD").optional(),
  rooms: z.coerce.number().int().min(1).max(8).default(1),
});

publicRoutes.get("/accommodations/:id", h(async (req, res) => {
  const col = isUuid(String(req.params.id)) ? "a.id" : "a.slug";
  const a = (await req.db.query<any>(
    `SELECT a.*, d.name AS destination_name, d.slug AS destination_slug, d.country FROM accommodations a JOIN destinations d ON d.id=a.destination_id
      WHERE ${col}=$1 AND a.deleted_at IS NULL`, [String(req.params.id)])).rows[0];
  if (!a) throw notFound("Accommodation");
  const dq = parse(DatesQ, req.query);
  const [images, amenities, rooms, related, breakdown] = await Promise.all([
    req.db.query("SELECT url, caption FROM accommodation_images WHERE accommodation_id=$1 ORDER BY position", [a.id]),
    req.db.query("SELECT m.code, m.label FROM accommodation_amenities x JOIN amenities m ON m.id=x.amenity_id WHERE x.accommodation_id=$1 ORDER BY m.label", [a.id]),
    req.db.query("SELECT * FROM room_types WHERE accommodation_id=$1 AND deleted_at IS NULL ORDER BY base_price_usd", [a.id]),
    req.db.query(`SELECT id, slug, name, stars, cover_image, rating_avg, from_price_usd FROM accommodations
                   WHERE destination_id=$1 AND id<>$2 AND deleted_at IS NULL ORDER BY ABS(from_price_usd - $3) LIMIT 4`, [a.destination_id, a.id, a.from_price_usd]),
    req.db.query("SELECT rating, COUNT(*)::int AS count FROM reviews WHERE accommodation_id=$1 AND status='published' GROUP BY rating ORDER BY rating DESC", [a.id]),
  ]);
  const withQuotes = [] as any[];
  for (const r of rooms.rows) {
    let quote: any = null;
    if (dq.checkIn && dq.checkOut) {
      const { room, ...qt } = await quoteStay(req.db, r.id, dq.checkIn, dq.checkOut, dq.rooms);
      quote = qt;
    }
    withQuotes.push({ ...r, quote });
  }
  res.json({ ...a, images: images.rows, amenities: amenities.rows, room_types: withQuotes, related: related.rows,
    rating_breakdown: breakdown.rows, data_notice: a.is_demo ? "Educational demo listing: details, prices and reviews are sample data." : undefined });
}));

publicRoutes.get("/accommodations/:id/availability", h(async (req, res) => {
  const dq = parse(DatesQ.extend({ checkIn: z.string().refine(isIsoDate), checkOut: z.string().refine(isIsoDate) }), req.query);
  const id = String(req.params.id);
  const acc = (await req.db.query<any>(`SELECT id FROM accommodations WHERE ${isUuid(id) ? "id" : "slug"}=$1 AND deleted_at IS NULL`, [id])).rows[0];
  if (!acc) throw notFound("Accommodation");
  const rooms = (await req.db.query<any>("SELECT id, name FROM room_types WHERE accommodation_id=$1 AND deleted_at IS NULL ORDER BY base_price_usd", [acc.id])).rows;
  const out = [];
  for (const r of rooms) {
    const { room, ...q } = await quoteStay(req.db, r.id, dq.checkIn, dq.checkOut, dq.rooms);
    out.push({ roomTypeId: r.id, name: r.name, ...q, average_nightly_usd: q.nightly.length ? round2(q.subtotal_usd / dq.rooms / q.nightly.length) : null });
  }
  res.json({ checkIn: dq.checkIn, checkOut: dq.checkOut, rooms: dq.rooms, results: out });
}));

publicRoutes.get("/room-types/:id", h(async (req, res) => {
  if (!isUuid(String(req.params.id))) throw notFound("Room type");
  const r = (await req.db.query<any>(
    `SELECT r.*, a.name AS accommodation_name, a.slug AS accommodation_slug, a.cancellation_policy, a.free_cancel_hours,
            a.check_in_from, a.check_out_until FROM room_types r JOIN accommodations a ON a.id=r.accommodation_id WHERE r.id=$1 AND r.deleted_at IS NULL`, [String(req.params.id)])).rows[0];
  if (!r) throw notFound("Room type");
  const dq = parse(DatesQ, req.query);
  let quote = null;
  if (dq.checkIn && dq.checkOut) { const { room, ...q } = await quoteStay(req.db, r.id, dq.checkIn, dq.checkOut, dq.rooms); quote = q; }
  res.json({ ...r, quote });
}));

/* ---------------------------------------------------------------- reviews */

publicRoutes.get("/accommodations/:id/reviews", h(async (req, res) => {
  const q = parse(paging, req.query);
  const id = String(req.params.id);
  const acc = (await req.db.query<any>(`SELECT id FROM accommodations WHERE ${isUuid(id) ? "id" : "slug"}=$1 AND deleted_at IS NULL`, [id])).rows[0];
  if (!acc) throw notFound("Accommodation");
  const { rows } = await req.db.query<any>(
    `SELECT r.id, r.rating, r.title, r.body, r.is_demo, r.created_at, u.name AS author, (r.booking_id IS NOT NULL) AS verified_stay,
            COUNT(*) OVER () AS total_count
       FROM reviews r JOIN users u ON u.id=r.user_id WHERE r.accommodation_id=$1 AND r.status='published'
      ORDER BY r.created_at DESC LIMIT $2 OFFSET $3`, [acc.id, q.pageSize, (q.page - 1) * q.pageSize]);
  const total = Number(rows[0]?.total_count ?? 0);
  res.json({ items: rows.map(({ total_count, author, ...r }) => ({ ...r, author: String(author).split(" ")[0] })), page: q.page, pageSize: q.pageSize, total });
}));

publicRoutes.post("/accommodations/:id/reviews", requireAuth, h(async (req, res) => {
  const body = parse(z.object({ rating: z.number().int().min(1).max(5), title: z.string().trim().min(3).max(100), body: z.string().trim().min(10).max(2000) }), req.body);
  const id = String(req.params.id);
  const acc = (await req.db.query<any>(`SELECT id FROM accommodations WHERE ${isUuid(id) ? "id" : "slug"}=$1 AND deleted_at IS NULL`, [id])).rows[0];
  if (!acc) throw notFound("Accommodation");
  const stay = (await req.db.query<any>(
    "SELECT id FROM bookings WHERE user_id=$1 AND accommodation_id=$2 AND status IN ('CONFIRMED','CHECKED_IN','COMPLETED') ORDER BY created_at DESC LIMIT 1",
    [req.user!.id, acc.id])).rows[0];
  if (!stay) throw new ApiError(403, "STAY_REQUIRED", "Only guests with a confirmed booking at this property can leave a review.");
  const dup = await req.db.query("SELECT 1 FROM reviews WHERE accommodation_id=$1 AND user_id=$2", [acc.id, req.user!.id]);
  if (dup.rowCount) throw new ApiError(409, "REVIEW_EXISTS", "You have already reviewed this property.");
  const r = (await req.db.query<any>(
    "INSERT INTO reviews(accommodation_id, user_id, booking_id, rating, title, body) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, rating, title, body, created_at",
    [acc.id, req.user!.id, stay.id, body.rating, body.title, body.body])).rows[0];
  await refreshRating(req.db, acc.id);
  res.status(201).json(r);
}));

export async function refreshRating(db: any, accommodationId: string) {
  await db.query(
    `UPDATE accommodations SET rating_avg = COALESCE((SELECT ROUND(AVG(rating)::numeric,2) FROM reviews WHERE accommodation_id=$1 AND status='published'),0),
            review_count = (SELECT COUNT(*) FROM reviews WHERE accommodation_id=$1 AND status='published') WHERE id=$1`, [accommodationId]);
}

/* ---------------------------------------------------------------- maps */

publicRoutes.get("/locations/search", h(async (req, res) => {
  const { q } = parse(z.object({ q: z.string().trim().min(2).max(60) }), req.query);
  const l = like(q);
  const { rows } = await req.db.query<any>(
    `(SELECT 'destination' AS type, id, slug, name, country AS subtitle, lat, lng FROM destinations WHERE deleted_at IS NULL AND name ILIKE $1 LIMIT 5)
     UNION ALL
     (SELECT 'attraction', t.id, t.slug, t.name, d.name, t.lat, t.lng FROM attractions t JOIN destinations d ON d.id=t.destination_id WHERE t.deleted_at IS NULL AND t.name ILIKE $1 LIMIT 8)
     UNION ALL
     (SELECT 'accommodation', a.id, a.slug, a.name, d.name, a.lat, a.lng FROM accommodations a JOIN destinations d ON d.id=a.destination_id WHERE a.deleted_at IS NULL AND a.name ILIKE $1 LIMIT 8)`, [l]);
  res.json({ source: "WAYFARER internal gazetteer (not a global geocoder)", results: rows });
}));

publicRoutes.post("/routes/estimate", h(async (req, res) => {
  const { points } = parse(z.object({
    points: z.array(z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), name: z.string().max(80).optional() })).min(2).max(25),
  }), req.body);
  const legs = [];
  let km = 0, min = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const straight = haversineKm(a.lat, a.lng, b.lat, b.lng);
    const road = straight * 1.35;                          // documented detour factor, not a routed distance
    const m = Math.round((road / 22) * 60);               // 22 km/h urban average
    km += road; min += m;
    legs.push({ from: a.name ?? `Point ${i}`, to: b.name ?? `Point ${i + 1}`, straightLineKm: round2(straight), estimatedRoadKm: round2(road), estimatedMinutes: m });
  }
  const path = points.map((p) => `${p.lat},${p.lng}`).join("/");
  res.json({
    method: "straight_line_estimate", liveTraffic: false,
    disclaimer: "Distances use great-circle distance x1.35 and an assumed 22 km/h urban speed. This is not turn-by-turn routing and ignores live traffic.",
    totalKm: round2(km), totalMinutes: min, legs,
    externalNavigation: { googleMaps: `https://www.google.com/maps/dir/${path}`, openStreetMap: `https://www.openstreetmap.org/directions?route=${points[0].lat}%2C${points[0].lng}%3B${points[points.length - 1].lat}%2C${points[points.length - 1].lng}` },
  });
}));

publicRoutes.get("/documents", h(async (req, res) => {
  const { rows } = await req.db.query("SELECT slug, title, category, source_label, is_demo FROM travel_documents ORDER BY category, title");
  res.json({ items: rows });
}));
