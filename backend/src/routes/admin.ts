import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth.js";
import { ApiError, h, notFound, parse } from "../http.js";
import { cancelBooking, getBookingDetail, transition, type BookingStatus } from "../services/booking.js";
import { audit, notify } from "../services/notify.js";
import { refreshRating } from "./public.js";
import { isUuid } from "../services/search.js";
import { addDays, isIsoDate, slugify, todayIso } from "../util.js";

export const adminRoutes = Router();
const staffOnly = [requireAuth, requireRole("admin", "staff")];
const adminOnly = [requireAuth, requireRole("admin")];

const pg = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) });
const total = (rows: any[]) => Number(rows[0]?.total_count ?? 0);

adminRoutes.get("/admin/overview", ...staffOnly, h(async (req, res) => {
  const q = async (sql: string) => (await req.db.query<any>(sql)).rows;
  const [counts] = await q(`SELECT
      (SELECT COUNT(*) FROM users WHERE deleted_at IS NULL)::int AS users,
      (SELECT COUNT(*) FROM destinations WHERE deleted_at IS NULL)::int AS destinations,
      (SELECT COUNT(*) FROM accommodations WHERE deleted_at IS NULL)::int AS accommodations,
      (SELECT COUNT(*) FROM room_types WHERE deleted_at IS NULL)::int AS room_types,
      (SELECT COUNT(*) FROM room_inventory)::int AS inventory_rows,
      (SELECT COUNT(*) FROM attractions WHERE deleted_at IS NULL)::int AS attractions,
      (SELECT COUNT(*) FROM reviews)::int AS reviews,
      (SELECT COUNT(*) FROM bookings)::int AS bookings,
      (SELECT COUNT(*) FROM payments)::int AS payments,
      (SELECT COUNT(*) FROM payment_events)::int AS payment_events,
      (SELECT COUNT(*) FROM notifications)::int AS notifications,
      (SELECT COUNT(*) FROM itineraries)::int AS itineraries,
      (SELECT COUNT(*) FROM travel_documents)::int AS documents,
      (SELECT COUNT(*) FROM document_chunks)::int AS chunks,
      (SELECT COUNT(*) FROM audit_logs)::int AS audit_logs`);
  const byStatus = await q("SELECT status, COUNT(*)::int AS count FROM bookings GROUP BY status ORDER BY count DESC");
  const revenue = await q("SELECT COALESCE(SUM(amount_usd - refunded_usd),0) AS usd, COUNT(*)::int AS payments FROM payments WHERE status IN ('SUCCESS','REFUNDED')");
  const daily = await q(`SELECT to_char(created_at::date,'YYYY-MM-DD') AS day, COUNT(*)::int AS bookings FROM bookings
                          WHERE created_at > now() - interval '30 days' GROUP BY 1 ORDER BY 1`);
  const ai = await q("SELECT kind, mode, COUNT(*)::int AS calls, ROUND(AVG(latency_ms))::int AS avg_ms FROM ai_usage_events GROUP BY kind, mode ORDER BY calls DESC");
  res.json({ counts, bookingsByStatus: byStatus, revenueSimulatedUsd: revenue[0], bookingsLast30Days: daily, aiUsage: ai,
    note: "Revenue figures include simulated demo payments only." });
}));

adminRoutes.get("/admin/users", ...staffOnly, h(async (req, res) => {
  const q = parse(pg.extend({ q: z.string().max(80).optional(), role: z.enum(["customer", "partner", "staff", "admin"]).optional() }), req.query);
  const params: unknown[] = []; const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
  const where = ["deleted_at IS NULL"];
  if (q.q) { const l = p(`%${q.q.replace(/[%_\\]/g, "\\$&")}%`); where.push(`(email ILIKE ${l} OR name ILIKE ${l})`); }
  if (q.role) where.push(`role = ${p(q.role)}`);
  const limit = p(q.pageSize), off = p((q.page - 1) * q.pageSize);
  const { rows } = await req.db.query<any>(
    `SELECT id, email, name, role, is_demo, created_at, COUNT(*) OVER () AS total_count FROM users WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${off}`, params);
  res.json({ items: rows.map(({ total_count, ...r }) => r), page: q.page, pageSize: q.pageSize, total: total(rows) });
}));

adminRoutes.patch("/admin/users/:id/role", ...adminOnly, h(async (req, res) => {
  const b = parse(z.object({ role: z.enum(["customer", "partner", "staff", "admin"]) }), req.body);
  if (String(req.params.id) === req.user!.id) throw new ApiError(409, "SELF_ROLE_CHANGE", "You cannot change your own role.");
  const r = await req.db.query("UPDATE users SET role=$2, updated_at=now() WHERE id::text=$1 AND deleted_at IS NULL", [String(req.params.id), b.role]);
  if (!r.rowCount) throw notFound("User");
  await audit(req.db, req.user!.id, "user.role_change", "user", String(req.params.id), { role: b.role });
  res.status(204).end();
}));

adminRoutes.get("/admin/bookings", ...staffOnly, h(async (req, res) => {
  const q = parse(pg.extend({ status: z.string().optional(), q: z.string().max(60).optional() }), req.query);
  const params: unknown[] = []; const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
  const where = ["true"];
  if (q.status) where.push(`b.status = ${p(q.status)}`);
  if (q.q) { const l = p(`%${q.q.replace(/[%_\\]/g, "\\$&")}%`); where.push(`(b.reference ILIKE ${l} OR b.guest_name ILIKE ${l} OR b.guest_email ILIKE ${l})`); }
  const limit = p(q.pageSize), off = p((q.page - 1) * q.pageSize);
  const { rows } = await req.db.query<any>(
    `SELECT b.id, b.reference, b.status, b.guest_name, b.guest_email, b.check_in, b.check_out, b.total_usd, b.created_at, b.is_demo,
            a.name AS accommodation_name, COUNT(*) OVER () AS total_count
       FROM bookings b JOIN accommodations a ON a.id=b.accommodation_id WHERE ${where.join(" AND ")}
      ORDER BY b.created_at DESC LIMIT ${limit} OFFSET ${off}`, params);
  res.json({ items: rows.map(({ total_count, ...r }) => r), page: q.page, pageSize: q.pageSize, total: total(rows) });
}));

adminRoutes.get("/admin/bookings/:id", ...staffOnly, h(async (req, res) => {
  if (!isUuid(String(req.params.id))) throw notFound("Booking");
  res.json(await getBookingDetail(req.db, String(req.params.id), { id: req.user!.id, role: "admin" }));
}));

adminRoutes.post("/admin/bookings/:id/cancel", ...staffOnly, h(async (req, res) => {
  if (!isUuid(String(req.params.id))) throw notFound("Booking");
  const r = await cancelBooking(req.db, String(req.params.id), req.user!.id, { asStaff: true });
  res.json(r);
}));

adminRoutes.get("/admin/payments", ...staffOnly, h(async (req, res) => {
  const q = parse(pg.extend({ status: z.string().optional() }), req.query);
  const { rows } = await req.db.query<any>(
    `SELECT p.id, p.amount_usd, p.refunded_usd, p.status, p.provider, p.provider_ref, p.simulated, p.failure_reason, p.created_at,
            b.reference, COUNT(*) OVER () AS total_count
       FROM payments p JOIN bookings b ON b.id=p.booking_id WHERE ($1::text IS NULL OR p.status=$1)
      ORDER BY p.created_at DESC LIMIT $2 OFFSET $3`, [q.status ?? null, q.pageSize, (q.page - 1) * q.pageSize]);
  res.json({ items: rows.map(({ total_count, ...r }) => r), page: q.page, pageSize: q.pageSize, total: total(rows) });
}));

adminRoutes.get("/admin/audit-logs", ...staffOnly, h(async (req, res) => {
  const q = parse(pg.extend({ action: z.string().max(60).optional() }), req.query);
  const { rows } = await req.db.query<any>(
    `SELECT l.id, l.action, l.entity, l.entity_id, l.meta, l.created_at, u.email AS actor_email, COUNT(*) OVER () AS total_count
       FROM audit_logs l LEFT JOIN users u ON u.id=l.actor_id WHERE ($1::text IS NULL OR l.action ILIKE $1)
      ORDER BY l.id DESC LIMIT $2 OFFSET $3`, [q.action ? `%${q.action}%` : null, q.pageSize, (q.page - 1) * q.pageSize]);
  res.json({ items: rows.map(({ total_count, ...r }) => r), page: q.page, pageSize: q.pageSize, total: total(rows) });
}));

adminRoutes.get("/admin/reviews", ...staffOnly, h(async (req, res) => {
  const q = parse(pg.extend({ status: z.enum(["published", "hidden"]).optional() }), req.query);
  const { rows } = await req.db.query<any>(
    `SELECT r.id, r.rating, r.title, r.body, r.status, r.is_demo, r.created_at, a.name AS accommodation_name, u.name AS author, COUNT(*) OVER () AS total_count
       FROM reviews r JOIN accommodations a ON a.id=r.accommodation_id JOIN users u ON u.id=r.user_id
      WHERE ($1::text IS NULL OR r.status=$1) ORDER BY r.created_at DESC LIMIT $2 OFFSET $3`, [q.status ?? null, q.pageSize, (q.page - 1) * q.pageSize]);
  res.json({ items: rows.map(({ total_count, ...r }) => r), page: q.page, pageSize: q.pageSize, total: total(rows) });
}));

adminRoutes.patch("/admin/reviews/:id", ...staffOnly, h(async (req, res) => {
  const b = parse(z.object({ status: z.enum(["published", "hidden"]) }), req.body);
  const r = (await req.db.query<any>("UPDATE reviews SET status=$2 WHERE id::text=$1 RETURNING accommodation_id", [String(req.params.id), b.status])).rows[0];
  if (!r) throw notFound("Review");
  await refreshRating(req.db, r.accommodation_id);
  await audit(req.db, req.user!.id, "review.moderate", "review", String(req.params.id), { status: b.status });
  res.status(204).end();
}));

adminRoutes.get("/admin/ai-usage", ...staffOnly, h(async (req, res) => {
  const { rows } = await req.db.query("SELECT id, kind, mode, provider, latency_ms, ok, created_at FROM ai_usage_events ORDER BY id DESC LIMIT 100");
  res.json({ items: rows });
}));

/* ---------------------------------------------------------------- content management */

const DestBody = z.object({
  name: z.string().trim().min(2).max(80), country: z.string().trim().min(2).max(60), region: z.string().max(80).optional(),
  shortDescription: z.string().trim().min(10).max(300), longDescription: z.string().trim().min(20).max(4000),
  lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180),
  dailyBudgetUsd: z.number().min(0).max(5000), currency: z.string().length(3).toUpperCase().default("USD"),
  coverImage: z.string().url().optional(), tags: z.array(z.string().max(30)).max(12).default([]),
  isInternational: z.boolean().default(false), isFeatured: z.boolean().default(false),
});

adminRoutes.post("/admin/destinations", ...staffOnly, h(async (req, res) => {
  const b = parse(DestBody, req.body);
  const slug = slugify(b.name);
  const dup = await req.db.query("SELECT 1 FROM destinations WHERE slug=$1", [slug]);
  if (dup.rowCount) throw new ApiError(409, "DUPLICATE", "A destination with this name already exists");
  const cur = await req.db.query("SELECT 1 FROM currencies WHERE code=$1", [b.currency]);
  if (!cur.rowCount) throw new ApiError(422, "VALIDATION_ERROR", "Unsupported currency code");
  const d = (await req.db.query<any>(
    `INSERT INTO destinations(slug, name, country, region, is_international, short_description, long_description, lat, lng, cover_image,
        daily_budget_usd, currency, tags, is_featured, is_demo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,false) RETURNING *`,
    [slug, b.name, b.country, b.region ?? null, b.isInternational, b.shortDescription, b.longDescription, b.lat, b.lng, b.coverImage ?? null,
      b.dailyBudgetUsd, b.currency, b.tags, b.isFeatured])).rows[0];
  await audit(req.db, req.user!.id, "destination.create", "destination", d.id, { name: d.name });
  res.status(201).json(d);
}));

adminRoutes.patch("/admin/destinations/:id", ...staffOnly, h(async (req, res) => {
  const b = parse(DestBody.partial().strict(), req.body);
  const sets: string[] = []; const params: unknown[] = [String(req.params.id)];
  const map: Record<string, string> = { name: "name", country: "country", region: "region", shortDescription: "short_description", longDescription: "long_description",
    lat: "lat", lng: "lng", dailyBudgetUsd: "daily_budget_usd", currency: "currency", coverImage: "cover_image", tags: "tags", isInternational: "is_international", isFeatured: "is_featured" };
  for (const [k, v] of Object.entries(b)) { params.push(v); sets.push(`${map[k]} = $${params.length}`); }
  if (!sets.length) throw new ApiError(422, "VALIDATION_ERROR", "No fields to update");
  const r = (await req.db.query<any>(
    `UPDATE destinations SET ${sets.join(", ")}, updated_at=now() WHERE id::text=$1 AND deleted_at IS NULL RETURNING *`, params)).rows[0];
  if (!r) throw notFound("Destination");
  await audit(req.db, req.user!.id, "destination.update", "destination", r.id, { fields: Object.keys(b) });
  res.json(r);
}));

adminRoutes.delete("/admin/destinations/:id", ...adminOnly, h(async (req, res) => {
  const r = await req.db.query("UPDATE destinations SET deleted_at=now() WHERE id::text=$1 AND deleted_at IS NULL", [String(req.params.id)]);
  if (!r.rowCount) throw notFound("Destination");
  await audit(req.db, req.user!.id, "destination.delete", "destination", String(req.params.id));
  res.status(204).end();
}));

const AccBody = z.object({
  destinationId: z.string().uuid(), name: z.string().trim().min(2).max(100),
  type: z.enum(["hotel", "guesthouse", "resort", "hostel", "boutique", "villa", "apartment"]), stars: z.number().int().min(1).max(5),
  description: z.string().trim().min(20).max(3000), address: z.string().trim().min(5).max(200),
  lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180),
  freeCancelHours: z.number().int().min(0).max(720).default(48), breakfastIncluded: z.boolean().default(false), familyFriendly: z.boolean().default(false),
  coverImage: z.string().url().optional(),
  rooms: z.array(z.object({ name: z.string().min(2).max(80), description: z.string().min(5).max(500), bedType: z.string().max(40), maxAdults: z.number().int().min(1).max(8),
    maxChildren: z.number().int().min(0).max(6).default(0), basePriceUsd: z.number().positive().max(10000), totalUnits: z.number().int().min(1).max(500) })).min(1).max(10),
});

adminRoutes.post("/admin/accommodations", ...staffOnly, h(async (req, res) => {
  const b = parse(AccBody, req.body);
  const dest = await req.db.query("SELECT 1 FROM destinations WHERE id=$1 AND deleted_at IS NULL", [b.destinationId]);
  if (!dest.rowCount) throw notFound("Destination");
  const policy = b.freeCancelHours > 0 ? `Free cancellation up to ${b.freeCancelHours} hours before check-in. After that the booking is non-refundable.` : "Non-refundable rate.";
  const id = await req.db.tx(async (tx) => {
    const slug = `${slugify(b.name)}-${Math.random().toString(36).slice(2, 6)}`;
    const a = (await tx.query<any>(
      `INSERT INTO accommodations(slug, destination_id, name, type, stars, description, address, lat, lng, cover_image, free_cancel_hours, cancellation_policy,
          breakfast_included, family_friendly, from_price_usd, is_demo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,false) RETURNING id`,
      [slug, b.destinationId, b.name, b.type, b.stars, b.description, b.address, b.lat, b.lng, b.coverImage ?? null, b.freeCancelHours, policy,
        b.breakfastIncluded, b.familyFriendly, Math.min(...b.rooms.map((r) => r.basePriceUsd))])).rows[0];
    for (const r of b.rooms) {
      await tx.query(
        `INSERT INTO room_types(accommodation_id, name, description, bed_type, max_adults, max_children, base_price_usd, total_units, breakfast_included)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [a.id, r.name, r.description, r.bedType, r.maxAdults, r.maxChildren, r.basePriceUsd, r.totalUnits, b.breakfastIncluded]);
    }
    await audit(tx, req.user!.id, "accommodation.create", "accommodation", a.id, { name: b.name });
    return a.id as string;
  });
  res.status(201).json({ id });
}));

/** Opens (or updates) nightly inventory for a room type over a date range. */
const InventoryBody = z.object({
  from: z.string().refine(isIsoDate), to: z.string().refine(isIsoDate), units: z.number().int().min(0).max(500), priceUsd: z.number().positive().max(10000).optional(),
});
async function upsertInventory(req: any, roomTypeId: string) {
  const b = parse(InventoryBody, req.body);
  if (b.to < b.from) throw new ApiError(422, "INVALID_DATES", "'to' must be on or after 'from'");
  if (b.from < todayIso()) throw new ApiError(422, "INVALID_DATES", "Cannot change inventory in the past");
  const days = (Date.parse(b.to) - Date.parse(b.from)) / 86_400_000 + 1;
  if (days > 366) throw new ApiError(422, "INVALID_DATES", "Range is limited to 366 days");
  const room = (await req.db.query("SELECT r.id, r.base_price_usd, r.total_units, a.id AS acc_id, a.partner_id FROM room_types r JOIN accommodations a ON a.id=r.accommodation_id WHERE r.id=$1", [roomTypeId])).rows[0];
  if (!room) throw notFound("Room type");
  if (req.user.role === "partner") {
    const ok = await req.db.query("SELECT 1 FROM partners WHERE id=$1 AND user_id=$2", [room.partner_id, req.user.id]);
    if (!ok.rowCount) throw notFound("Room type");
  }
  if (b.units > room.total_units) throw new ApiError(422, "VALIDATION_ERROR", `Units cannot exceed the room count (${room.total_units}).`);
  await req.db.query(
    `INSERT INTO room_inventory(room_type_id, night, units_available, price_usd)
     SELECT $1::uuid, d::date, $4::int, COALESCE($5::numeric, $6::numeric) FROM generate_series($2::date, $3::date, interval '1 day') d
     ON CONFLICT (room_type_id, night) DO UPDATE SET units_available = EXCLUDED.units_available,
       price_usd = COALESCE($5::numeric, room_inventory.price_usd)`,
    [roomTypeId, b.from, b.to, b.units, b.priceUsd ?? null, room.base_price_usd]);
  await audit(req.db, req.user.id, "inventory.update", "room_type", roomTypeId, { from: b.from, to: b.to, units: b.units, priceUsd: b.priceUsd });
  return { updatedNights: days };
}
adminRoutes.put("/admin/room-types/:id/inventory", ...staffOnly, h(async (req, res) => { res.json(await upsertInventory(req, String(req.params.id))); }));

adminRoutes.post("/admin/bookings/:id/transition", ...staffOnly, h(async (req, res) => {
  const b = parse(z.object({ to: z.enum(["CHECKED_IN", "COMPLETED"]) }), req.body);
  const bk = (await req.db.query<any>("SELECT id, status, user_id, reference FROM bookings WHERE id::text=$1", [String(req.params.id)])).rows[0];
  if (!bk) throw notFound("Booking");
  await transition(req.db, bk.id, bk.status as BookingStatus, b.to, req.user!.id, "Updated by staff");
  await notify(req.db, bk.user_id, "booking", `Booking ${b.to === "CHECKED_IN" ? "checked in" : "completed"}`, `Booking ${bk.reference} is now ${b.to.replace("_", " ").toLowerCase()}.`, { bookingId: bk.id });
  await audit(req.db, req.user!.id, "booking.transition", "booking", bk.id, { to: b.to });
  res.json({ id: bk.id, status: b.to });
}));

/* ---------------------------------------------------------------- partner portal */

const partnerOnly = [requireAuth, requireRole("partner", "admin")];

async function partnerIds(req: any): Promise<string[] | null> {
  if (req.user.role === "admin") return null; // admin sees all
  const { rows } = await req.db.query("SELECT a.id FROM accommodations a JOIN partners p ON p.id=a.partner_id WHERE p.user_id=$1 AND a.deleted_at IS NULL", [req.user.id]);
  return rows.map((r: any) => r.id);
}

adminRoutes.get("/partner/accommodations", ...partnerOnly, h(async (req, res) => {
  const ids = await partnerIds(req);
  const { rows } = await req.db.query<any>(
    `SELECT a.id, a.slug, a.name, a.stars, a.type, a.rating_avg, a.review_count, a.from_price_usd,
            (SELECT json_agg(json_build_object('id', r.id, 'name', r.name, 'base_price_usd', r.base_price_usd, 'total_units', r.total_units) ORDER BY r.base_price_usd)
               FROM room_types r WHERE r.accommodation_id=a.id AND r.deleted_at IS NULL) AS rooms
       FROM accommodations a WHERE a.deleted_at IS NULL AND ($1::uuid[] IS NULL OR a.id = ANY($1::uuid[])) ORDER BY a.name`, [ids]);
  res.json({ items: rows });
}));

adminRoutes.get("/partner/bookings", ...partnerOnly, h(async (req, res) => {
  const ids = await partnerIds(req);
  const q = parse(pg.extend({ status: z.string().optional() }), req.query);
  const { rows } = await req.db.query<any>(
    `SELECT b.id, b.reference, b.status, b.guest_name, b.check_in, b.check_out, b.nights, b.rooms, b.adults, b.children, b.total_usd, a.name AS accommodation_name, r.name AS room_name,
            COUNT(*) OVER () AS total_count
       FROM bookings b JOIN accommodations a ON a.id=b.accommodation_id JOIN room_types r ON r.id=b.room_type_id
      WHERE ($1::uuid[] IS NULL OR b.accommodation_id = ANY($1::uuid[])) AND ($2::text IS NULL OR b.status=$2)
      ORDER BY b.check_in DESC LIMIT $3 OFFSET $4`, [ids, q.status ?? null, q.pageSize, (q.page - 1) * q.pageSize]);
  res.json({ items: rows.map(({ total_count, ...r }) => r), page: q.page, pageSize: q.pageSize, total: total(rows) });
}));

adminRoutes.post("/partner/bookings/:id/transition", ...partnerOnly, h(async (req, res) => {
  const b = parse(z.object({ to: z.enum(["CHECKED_IN", "COMPLETED"]) }), req.body);
  const ids = await partnerIds(req);
  const bk = (await req.db.query<any>("SELECT id, status, user_id, reference, accommodation_id FROM bookings WHERE id::text=$1", [String(req.params.id)])).rows[0];
  if (!bk || (ids && !ids.includes(bk.accommodation_id))) throw notFound("Booking");
  await transition(req.db, bk.id, bk.status as BookingStatus, b.to, req.user!.id, "Updated by partner");
  await notify(req.db, bk.user_id, "booking", `Stay ${b.to === "CHECKED_IN" ? "checked in" : "completed"}`, `Booking ${bk.reference} is now ${b.to.replace("_", " ").toLowerCase()}.`, { bookingId: bk.id });
  await audit(req.db, req.user!.id, "booking.transition", "booking", bk.id, { to: b.to, by: "partner" });
  res.json({ id: bk.id, status: b.to });
}));

adminRoutes.put("/partner/room-types/:id/inventory", ...partnerOnly, h(async (req, res) => { res.json(await upsertInventory(req, String(req.params.id))); }));

adminRoutes.get("/partner/analytics", ...partnerOnly, h(async (req, res) => {
  const ids = await partnerIds(req);
  const to = addDays(todayIso(), 30);
  const [occ, st] = await Promise.all([
    req.db.query<any>(
      `SELECT ROUND(100.0 * (1 - SUM(ri.units_available)::numeric / NULLIF(SUM(rt.total_units),0)), 1) AS occupancy_pct_next_30d
         FROM room_inventory ri JOIN room_types rt ON rt.id=ri.room_type_id
        WHERE ($1::uuid[] IS NULL OR rt.accommodation_id = ANY($1::uuid[])) AND ri.night >= $2 AND ri.night < $3`, [ids, todayIso(), to]),
    req.db.query<any>(
      `SELECT status, COUNT(*)::int AS count, COALESCE(SUM(total_usd),0) AS total_usd FROM bookings
        WHERE ($1::uuid[] IS NULL OR accommodation_id = ANY($1::uuid[])) GROUP BY status`, [ids]),
  ]);
  res.json({ occupancyPctNext30Days: occ.rows[0]?.occupancy_pct_next_30d ?? null, bookingsByStatus: st.rows,
    note: "Occupancy is derived from stored room inventory; demo figures only." });
}));
