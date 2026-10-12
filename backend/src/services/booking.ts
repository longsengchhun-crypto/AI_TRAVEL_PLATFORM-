import { randomBytes } from "node:crypto";
import { config } from "../config.js";
import type { Db } from "../db/index.js";
import { ApiError, conflict, notFound } from "../http.js";
import { addDays, nightsBetween, round2, todayIso } from "../util.js";
import { audit, notify } from "./notify.js";

export type BookingStatus =
  | "DRAFT" | "PENDING_CONFIRMATION" | "CONFIRMED" | "CHECKED_IN" | "COMPLETED"
  | "CANCELLED" | "EXPIRED" | "REFUND_PENDING" | "REFUNDED";

/** Legal transitions, enforced server-side. */
export const TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  DRAFT: ["PENDING_CONFIRMATION", "CANCELLED"],
  PENDING_CONFIRMATION: ["CONFIRMED", "CANCELLED", "EXPIRED"],
  CONFIRMED: ["CHECKED_IN", "CANCELLED"],
  CHECKED_IN: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: ["REFUND_PENDING"],
  EXPIRED: [],
  REFUND_PENDING: ["REFUNDED"],
  REFUNDED: [],
};

export interface Quote {
  available: boolean;
  reason?: string;
  nights: number;
  rooms: number;
  nightly: { night: string; rate_usd: number; units_available: number }[];
  subtotal_usd: number;
  taxes_usd: number;
  fees_usd: number;
  total_usd: number;
  tax_rate: number;
  service_fee_rate: number;
}

export function validateStayDates(checkIn: string, checkOut: string) {
  const nights = nightsBetween(checkIn, checkOut);
  if (nights <= 0) throw new ApiError(422, "INVALID_DATES", "Check-out must be after check-in");
  if (nights > 30) throw new ApiError(422, "INVALID_DATES", "Stays are limited to 30 nights");
  if (checkIn < todayIso()) throw new ApiError(422, "INVALID_DATES", "Check-in cannot be in the past");
  return nights;
}

export async function quoteStay(db: Db, roomTypeId: string, checkIn: string, checkOut: string, rooms = 1, lock = false): Promise<Quote & { room: any }> {
  const nights = validateStayDates(checkIn, checkOut);
  const room = (await db.query<any>(
    `SELECT r.*, a.tax_rate, a.service_fee_rate, a.free_cancel_hours, a.cancellation_policy, a.name AS accommodation_name, a.deleted_at AS acc_deleted
       FROM room_types r JOIN accommodations a ON a.id = r.accommodation_id WHERE r.id = $1 AND r.deleted_at IS NULL`, [roomTypeId])).rows[0];
  if (!room || room.acc_deleted) throw notFound("Room type");
  const inv = (await db.query<any>(
    `SELECT night, price_usd, units_available FROM room_inventory
      WHERE room_type_id = $1 AND night >= $2 AND night < $3 ORDER BY night ${lock ? "FOR UPDATE" : ""}`,
    [roomTypeId, checkIn, checkOut])).rows;
  const nightly = inv.map((r) => ({ night: r.night as string, rate_usd: r.price_usd as number, units_available: r.units_available as number }));
  let available = true, reason: string | undefined;
  if (inv.length !== nights) { available = false; reason = "These dates are not open for booking yet."; }
  else if (inv.some((r) => r.units_available < rooms)) {
    available = false;
    const first = inv.find((r) => r.units_available < rooms);
    reason = `Not enough rooms left on ${first.night}. Try different dates or fewer rooms.`;
  }
  const subtotal = round2(nightly.reduce((s, n) => s + n.rate_usd, 0) * rooms);
  const taxes = round2(subtotal * room.tax_rate);
  const fees = round2(subtotal * room.service_fee_rate);
  return { available, reason, nights, rooms, nightly, subtotal_usd: subtotal, taxes_usd: taxes, fees_usd: fees,
    total_usd: round2(subtotal + taxes + fees), tax_rate: room.tax_rate, service_fee_rate: room.service_fee_rate, room };
}

export interface CreateBookingInput {
  roomTypeId: string; checkIn: string; checkOut: string; rooms: number; adults: number; children: number;
  guestName: string; guestEmail: string; guestPhone?: string; specialRequests?: string;
}

const refCode = () => "WF-" + randomBytes(5).toString("hex").toUpperCase();

export async function transition(db: Db, bookingId: string, from: BookingStatus, to: BookingStatus, actorId: string | null, note?: string) {
  if (!TRANSITIONS[from]?.includes(to)) {
    throw conflict("ILLEGAL_TRANSITION", `A booking cannot move from ${from} to ${to}.`);
  }
  const r = await db.query("UPDATE bookings SET status = $1, updated_at = now() WHERE id = $2 AND status = $3", [to, bookingId, from]);
  if (r.rowCount === 0) throw conflict("STALE_STATE", "Booking state changed; please refresh and retry.");
  await db.query("INSERT INTO booking_status_events(booking_id, from_status, to_status, actor_id, note) VALUES ($1,$2,$3,$4,$5)", [bookingId, from, to, actorId, note ?? null]);
}

export async function releaseInventory(db: Db, bookingId: string, roomTypeId: string) {
  await db.query(
    `UPDATE room_inventory ri SET units_available = ri.units_available + bi.rooms
       FROM booking_items bi
      WHERE bi.booking_id = $1 AND bi.released = false AND ri.room_type_id = $2 AND ri.night = bi.night`, [bookingId, roomTypeId]);
  await db.query("UPDATE booking_items SET released = true WHERE booking_id = $1", [bookingId]);
}

export async function createBooking(db: Db, userId: string, input: CreateBookingInput) {
  await expireStaleHolds(db);
  return db.tx(async (tx) => {
    const q = await quoteStay(tx, input.roomTypeId, input.checkIn, input.checkOut, input.rooms, true);
    const room = q.room;
    if (input.adults > room.max_adults * input.rooms || input.children > room.max_children * input.rooms) {
      throw new ApiError(422, "CAPACITY_EXCEEDED", `This room type fits up to ${room.max_adults} adults and ${room.max_children} children per room.`);
    }
    if (!q.available) throw conflict("NO_AVAILABILITY", q.reason ?? "No availability for the selected dates.");

    const dec = await tx.query(
      `UPDATE room_inventory SET units_available = units_available - $4
        WHERE room_type_id = $1 AND night >= $2 AND night < $3 AND units_available >= $4`,
      [input.roomTypeId, input.checkIn, input.checkOut, input.rooms]);
    if (dec.rowCount !== q.nights) throw conflict("NO_AVAILABILITY", "Those rooms were just taken. Please search again.");

    const [yy, mm, dd] = input.checkIn.split("-").map(Number);
    const freeUntil = room.free_cancel_hours > 0 ? new Date(Date.UTC(yy, mm - 1, dd, 14) - room.free_cancel_hours * 3_600_000) : null;
    const holdUntil = new Date(Date.now() + config.holdMinutes * 60_000);
    const acc = room.accommodation_id as string;
    const b = (await tx.query<any>(
      `INSERT INTO bookings(reference, user_id, accommodation_id, room_type_id, check_in, check_out, nights, rooms, adults, children,
          guest_name, guest_email, guest_phone, special_requests, status, subtotal_usd, taxes_usd, fees_usd, total_usd,
          cancellation_policy, free_cancel_until, hold_expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'PENDING_CONFIRMATION',$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
      [refCode(), userId, acc, input.roomTypeId, input.checkIn, input.checkOut, q.nights, input.rooms, input.adults, input.children,
        input.guestName, input.guestEmail, input.guestPhone ?? null, input.specialRequests ?? null,
        q.subtotal_usd, q.taxes_usd, q.fees_usd, q.total_usd, room.cancellation_policy, freeUntil, holdUntil])).rows[0];
    for (const n of q.nightly) {
      await tx.query("INSERT INTO booking_items(booking_id, night, rate_usd, rooms) VALUES ($1,$2,$3,$4)", [b.id, n.night, n.rate_usd, input.rooms]);
    }
    await tx.query("INSERT INTO booking_status_events(booking_id, from_status, to_status, actor_id, note) VALUES ($1,NULL,'PENDING_CONFIRMATION',$2,$3)",
      [b.id, userId, `Room held until ${holdUntil.toISOString()} pending payment`]);
    await notify(tx, userId, "booking", "Booking received",
      `Your booking ${b.reference} at ${room.accommodation_name} is held for ${config.holdMinutes} minutes. Complete payment to confirm it.`, { bookingId: b.id });
    await audit(tx, userId, "booking.create", "booking", b.id, { reference: b.reference, total_usd: b.total_usd });
    return b;
  });
}

/** Releases rooms for unpaid bookings whose hold elapsed. Called lazily (serverless-friendly, no cron needed). */
export async function expireStaleHolds(db: Db) {
  const stale = (await db.query<any>(
    "SELECT id, room_type_id, user_id, reference FROM bookings WHERE status = 'PENDING_CONFIRMATION' AND hold_expires_at < now() LIMIT 50")).rows;
  for (const b of stale) {
    await db.tx(async (tx) => {
      try {
        await transition(tx, b.id, "PENDING_CONFIRMATION", "EXPIRED", null, "Payment hold elapsed");
      } catch { return; }
      await releaseInventory(tx, b.id, b.room_type_id);
      await tx.query("UPDATE payments SET status='CANCELLED', updated_at=now() WHERE booking_id=$1 AND status='PENDING'", [b.id]);
      await notify(tx, b.user_id, "booking", "Booking expired", `Booking ${b.reference} expired because payment was not completed. The room was released.`, { bookingId: b.id });
    });
  }
  return stale.length;
}

export function cancellationInfo(b: { status: string; free_cancel_until: string | Date | null }) {
  const cancellable = ["PENDING_CONFIRMATION", "CONFIRMED"].includes(b.status);
  const free = b.free_cancel_until ? new Date(b.free_cancel_until).getTime() > Date.now() : false;
  return { cancellable, freeCancellation: cancellable && free };
}

export async function cancelBooking(db: Db, bookingId: string, actorId: string, opts: { asStaff?: boolean } = {}) {
  return db.tx(async (tx) => {
    const b = (await tx.query<any>("SELECT * FROM bookings WHERE id = $1 FOR UPDATE", [bookingId])).rows[0];
    if (!b) throw notFound("Booking");
    if (!opts.asStaff && b.user_id !== actorId) throw notFound("Booking"); // do not reveal other users' bookings
    const info = cancellationInfo(b);
    if (!info.cancellable) throw conflict("NOT_CANCELLABLE", `A booking in status ${b.status} cannot be cancelled.`);
    const pay = (await tx.query<any>("SELECT * FROM payments WHERE booking_id=$1 AND status='SUCCESS' LIMIT 1", [bookingId])).rows[0];

    await transition(tx, b.id, b.status, "CANCELLED", actorId, info.freeCancellation ? "Cancelled within free-cancellation window" : "Cancelled after free-cancellation window");
    await releaseInventory(tx, b.id, b.room_type_id);
    await tx.query("UPDATE payments SET status='CANCELLED', updated_at=now() WHERE booking_id=$1 AND status='PENDING'", [b.id]);

    let refunded = false;
    if (pay && info.freeCancellation) {
      await transition(tx, b.id, "CANCELLED", "REFUND_PENDING", actorId, "Refund initiated (simulated provider)");
      await tx.query("UPDATE payments SET status='REFUNDED', refunded_usd=amount_usd, updated_at=now() WHERE id=$1", [pay.id]);
      await tx.query("INSERT INTO payment_events(payment_id, provider_event_id, type, payload) VALUES ($1,$2,'refund.simulated',$3)",
        [pay.id, `evt_refund_${pay.id}`, JSON.stringify({ amount_usd: pay.amount_usd, simulated: true })]);
      await transition(tx, b.id, "REFUND_PENDING", "REFUNDED", actorId, "Refund completed (simulated; no real money moved)");
      refunded = true;
    }
    await notify(tx, b.user_id, "booking", "Booking cancelled",
      refunded ? `Booking ${b.reference} was cancelled and a simulated refund of $${pay.amount_usd} was recorded.`
        : `Booking ${b.reference} was cancelled.${pay ? " It was outside the free-cancellation window, so no refund applies." : ""}`, { bookingId: b.id });
    await audit(tx, actorId, "booking.cancel", "booking", b.id, { refunded, free: info.freeCancellation });
    const updated = (await tx.query<any>("SELECT * FROM bookings WHERE id=$1", [b.id])).rows[0];
    return { booking: updated, refunded };
  });
}

export async function getBookingDetail(db: Db, id: string, viewer: { id: string; role: string }) {
  const b = (await db.query<any>(
    `SELECT b.*, a.name AS accommodation_name, a.slug AS accommodation_slug, a.address, a.cover_image, a.partner_id,
            r.name AS room_name, d.name AS destination_name, a.is_demo AS accommodation_is_demo
       FROM bookings b JOIN accommodations a ON a.id=b.accommodation_id JOIN room_types r ON r.id=b.room_type_id
       JOIN destinations d ON d.id=a.destination_id WHERE b.id=$1`, [id])).rows[0];
  if (!b) throw notFound("Booking");
  if (viewer.role === "partner") {
    const ok = (await db.query("SELECT 1 FROM partners p WHERE p.id=$1 AND p.user_id=$2", [b.partner_id, viewer.id])).rowCount > 0;
    if (!ok) throw notFound("Booking");
  } else if (!["admin", "staff"].includes(viewer.role) && b.user_id !== viewer.id) {
    throw notFound("Booking");
  }
  const [events, items, payments] = await Promise.all([
    db.query("SELECT from_status, to_status, note, created_at FROM booking_status_events WHERE booking_id=$1 ORDER BY id", [id]),
    db.query("SELECT night, rate_usd FROM booking_items WHERE booking_id=$1 ORDER BY night", [id]),
    db.query("SELECT id, amount_usd, refunded_usd, status, provider, provider_ref, simulated, failure_reason, created_at FROM payments WHERE booking_id=$1 ORDER BY created_at", [id]),
  ]);
  delete b.partner_id;
  return { ...b, ...cancellationInfo(b), nights_detail: items.rows, events: events.rows, payments: payments.rows,
    check_in_to: addDays(b.check_in, 0) };
}
