import { z } from "zod";
import type { Db } from "../db/index.js";
import { ApiError } from "../http.js";
import { isIsoDate, nightsBetween, todayIso } from "../util.js";

const csv = z.string().optional().transform((s) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : []));
const bool = z.enum(["true", "false", "1", "0"]).optional().transform((v) => (v === undefined ? undefined : v === "true" || v === "1"));
const optNum = z.coerce.number().optional();

export const AccommodationQuery = z.object({
  destination: z.string().optional(),   // id or slug
  q: z.string().trim().max(80).optional(),
  checkIn: z.string().refine(isIsoDate, "Use YYYY-MM-DD").optional(),
  checkOut: z.string().refine(isIsoDate, "Use YYYY-MM-DD").optional(),
  adults: z.coerce.number().int().min(1).max(20).default(2),
  children: z.coerce.number().int().min(0).max(10).default(0),
  rooms: z.coerce.number().int().min(1).max(8).default(1),
  minPrice: optNum, maxPrice: optNum,
  stars: csv, minRating: optNum, amenities: csv, type: csv,
  freeCancellation: bool, breakfast: bool, familyFriendly: bool,
  lat: optNum, lng: optNum, maxDistanceKm: optNum,
  sort: z.enum(["relevance", "price_asc", "price_desc", "rating", "distance"]).default("relevance"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(12),
});
export type AccommodationQuery = z.infer<typeof AccommodationQuery>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID.test(s);

export async function searchAccommodations(db: Db, q: AccommodationQuery) {
  const params: unknown[] = [];
  const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
  const hasDates = !!(q.checkIn && q.checkOut);
  let nights = 0;
  if (hasDates) {
    nights = nightsBetween(q.checkIn!, q.checkOut!);
    if (nights <= 0) throw new ApiError(422, "INVALID_DATES", "Check-out must be after check-in");
    if (nights > 30) throw new ApiError(422, "INVALID_DATES", "Stays are limited to 30 nights");
    if (q.checkIn! < todayIso()) throw new ApiError(422, "INVALID_DATES", "Check-in cannot be in the past");
  } else if (q.checkIn || q.checkOut) {
    throw new ApiError(422, "INVALID_DATES", "Provide both checkIn and checkOut");
  }

  const rooms = p(q.rooms), adults = p(q.adults), children = p(q.children);
  let priceExpr = "r.base_price_usd";
  let availExpr = "true";
  if (hasDates) {
    const ci = p(q.checkIn), co = p(q.checkOut), n = p(nights);
    priceExpr = `(SELECT AVG(i.price_usd) FROM room_inventory i WHERE i.room_type_id = r.id AND i.night >= ${ci} AND i.night < ${co})`;
    availExpr = `(SELECT COUNT(*) FROM room_inventory i WHERE i.room_type_id = r.id AND i.night >= ${ci} AND i.night < ${co} AND i.units_available >= ${rooms}) = ${n}`;
  }

  const where: string[] = ["a.deleted_at IS NULL", "d.deleted_at IS NULL"];
  if (q.destination) where.push(isUuid(q.destination) ? `a.destination_id = ${p(q.destination)}` : `d.slug = ${p(q.destination)}`);
  if (q.q) {
    const like = `%${q.q.replace(/[%_\\]/g, "\\$&")}%`;
    const l = p(like);
    where.push(`(a.name ILIKE ${l} OR d.name ILIKE ${l} OR d.country ILIKE ${l} OR a.address ILIKE ${l})`);
  }
  if (q.stars.length) where.push(`a.stars = ANY(${p(q.stars.map(Number).filter((n) => n >= 1 && n <= 5))}::int[])`);
  if (q.type.length) where.push(`a.type = ANY(${p(q.type)}::text[])`);
  if (q.minRating !== undefined) where.push(`a.rating_avg >= ${p(q.minRating)}`);
  if (q.freeCancellation === true) where.push("a.free_cancel_hours > 0");
  if (q.breakfast === true) where.push("(a.breakfast_included OR EXISTS (SELECT 1 FROM room_types rb WHERE rb.accommodation_id = a.id AND rb.breakfast_included))");
  if (q.familyFriendly === true) where.push("a.family_friendly = true");
  if (q.amenities.length) {
    where.push(`a.id IN (SELECT aa.accommodation_id FROM accommodation_amenities aa JOIN amenities am ON am.id = aa.amenity_id
                          WHERE am.code = ANY(${p(q.amenities)}::text[]) GROUP BY aa.accommodation_id HAVING COUNT(*) = ${q.amenities.length})`);
  }
  let distExpr = "NULL::float8";
  if (q.lat !== undefined && q.lng !== undefined) {
    const la = p(q.lat), lo = p(q.lng);
    distExpr = `(6371 * acos(LEAST(1, cos(radians(${la})) * cos(radians(a.lat)) * cos(radians(a.lng) - radians(${lo})) + sin(radians(${la})) * sin(radians(a.lat)))))`;
    if (q.maxDistanceKm !== undefined) where.push(`${distExpr} <= ${p(q.maxDistanceKm)}`);
  } else if (q.sort === "distance" || q.maxDistanceKm !== undefined) {
    throw new ApiError(422, "MISSING_LOCATION", "Provide lat and lng to filter or sort by distance");
  }

  const having: string[] = [];
  if (q.minPrice !== undefined) having.push(`MIN(rt.price) >= ${p(q.minPrice)}`);
  if (q.maxPrice !== undefined) having.push(`MIN(rt.price) <= ${p(q.maxPrice)}`);

  const order = {
    relevance: "a.rating_avg * ln(a.review_count + 2) DESC, a.name",
    price_asc: "price_from ASC, a.name",
    price_desc: "price_from DESC, a.name",
    rating: "a.rating_avg DESC, a.review_count DESC",
    distance: "distance_km ASC NULLS LAST",
  }[q.sort];

  const limit = p(q.pageSize), offset = p((q.page - 1) * q.pageSize);
  const sql = `
    WITH rt AS (
      SELECT r.id, r.accommodation_id, ${priceExpr} AS price, ${availExpr} AS ok, r.name AS room_name
        FROM room_types r
       WHERE r.deleted_at IS NULL
         AND ${adults} <= r.max_adults * ${rooms}
         AND ${children} <= r.max_children * ${rooms}
    )
    SELECT a.id, a.slug, a.name, a.type, a.stars, a.cover_image, a.image_credit, a.address, a.lat, a.lng, a.rating_avg, a.review_count,
           a.free_cancel_hours, a.breakfast_included, a.family_friendly, a.is_demo, a.cancellation_policy,
           d.id AS destination_id, d.slug AS destination_slug, d.name AS destination_name, d.country,
           ROUND(MIN(rt.price)::numeric, 2) AS price_from,
           COUNT(rt.id) AS matching_rooms,
           ${distExpr} AS distance_km,
           COUNT(*) OVER () AS total_count
      FROM accommodations a
      JOIN destinations d ON d.id = a.destination_id
      JOIN rt ON rt.accommodation_id = a.id AND rt.ok
     WHERE ${where.join(" AND ")}
     GROUP BY a.id, d.id
     ${having.length ? "HAVING " + having.join(" AND ") : ""}
     ORDER BY ${order}
     LIMIT ${limit} OFFSET ${offset}`;
  const { rows } = await db.query<any>(sql, params);
  const total = rows[0]?.total_count ?? 0;
  const items = rows.map(({ total_count, ...r }) => ({
    ...r, matching_rooms: Number(r.matching_rooms), distance_km: r.distance_km == null ? null : Math.round(r.distance_km * 10) / 10,
    total_for_stay_usd: hasDates ? Math.round(r.price_from * nights * q.rooms * 100) / 100 : null,
  }));
  return { items, page: q.page, pageSize: q.pageSize, total: Number(total), totalPages: Math.ceil(Number(total) / q.pageSize), nights: hasDates ? nights : null };
}
