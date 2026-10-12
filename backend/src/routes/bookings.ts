import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth.js";
import { config } from "../config.js";
import { ApiError, h, notFound, parse } from "../http.js";
import { cancelBooking, cancellationInfo, createBooking, expireStaleHolds, getBookingDetail, quoteStay } from "../services/booking.js";
import { applyWebhookEvent, createIntent, simulateProvider, verifySignature, type WebhookEvent } from "../services/payment.js";
import { isIsoDate } from "../util.js";
import { isUuid } from "../services/search.js";

export const bookingRoutes = Router();

const BookingBody = z.object({
  roomTypeId: z.string().uuid(),
  checkIn: z.string().refine(isIsoDate, "Use YYYY-MM-DD"),
  checkOut: z.string().refine(isIsoDate, "Use YYYY-MM-DD"),
  rooms: z.number().int().min(1).max(8).default(1),
  adults: z.number().int().min(1).max(20),
  children: z.number().int().min(0).max(10).default(0),
  guestName: z.string().trim().min(2).max(100),
  guestEmail: z.string().email().max(160),
  guestPhone: z.string().trim().max(30).optional(),
  specialRequests: z.string().trim().max(500).optional(),
});

bookingRoutes.post("/bookings/quote", requireAuth, h(async (req, res) => {
  const b = parse(BookingBody.pick({ roomTypeId: true, checkIn: true, checkOut: true, rooms: true }), req.body);
  const { room, ...q } = await quoteStay(req.db, b.roomTypeId, b.checkIn, b.checkOut, b.rooms);
  res.json({ ...q, roomName: room.name, accommodationName: room.accommodation_name, cancellationPolicy: room.cancellation_policy });
}));

bookingRoutes.post("/bookings", requireAuth, h(async (req, res) => {
  const b = parse(BookingBody, req.body);
  const booking = await createBooking(req.db, req.user!.id, b);
  res.status(201).json(booking);
}));

bookingRoutes.get("/bookings", requireAuth, h(async (req, res) => {
  await expireStaleHolds(req.db);
  const { status } = parse(z.object({ status: z.string().optional() }), req.query);
  const { rows } = await req.db.query<any>(
    `SELECT b.id, b.reference, b.status, b.check_in, b.check_out, b.nights, b.rooms, b.adults, b.children, b.total_usd, b.free_cancel_until,
            b.hold_expires_at, b.created_at, b.is_demo, a.name AS accommodation_name, a.slug AS accommodation_slug, a.cover_image, r.name AS room_name
       FROM bookings b JOIN accommodations a ON a.id=b.accommodation_id JOIN room_types r ON r.id=b.room_type_id
      WHERE b.user_id=$1 AND ($2::text IS NULL OR b.status=$2) ORDER BY b.created_at DESC LIMIT 100`, [req.user!.id, status ?? null]);
  res.json({ items: rows.map((b) => ({ ...b, ...cancellationInfo(b) })) });
}));

bookingRoutes.get("/bookings/:id", requireAuth, h(async (req, res) => {
  if (!isUuid(String(req.params.id))) throw notFound("Booking");
  await expireStaleHolds(req.db);
  res.json(await getBookingDetail(req.db, String(req.params.id), { id: req.user!.id, role: req.user!.role }));
}));

bookingRoutes.post("/bookings/:id/cancel", requireAuth, h(async (req, res) => {
  if (!isUuid(String(req.params.id))) throw notFound("Booking");
  const r = await cancelBooking(req.db, String(req.params.id), req.user!.id);
  res.json(r);
}));

bookingRoutes.get("/bookings/:id/receipt", requireAuth, h(async (req, res) => {
  if (!isUuid(String(req.params.id))) throw notFound("Booking");
  const b = await getBookingDetail(req.db, String(req.params.id), { id: req.user!.id, role: req.user!.role });
  const paid = b.payments.find((p: any) => ["SUCCESS", "REFUNDED"].includes(p.status));
  if (!paid) throw new ApiError(409, "NO_PAYMENT", "A receipt is available once a payment has succeeded.");
  res.json({
    receiptNumber: `RCT-${b.reference}`, issuedFor: b.guest_name, reference: b.reference, property: b.accommodation_name, room: b.room_name,
    checkIn: b.check_in, checkOut: b.check_out, nights: b.nights, rooms: b.rooms,
    lineItems: [
      ...b.nights_detail.map((n: any) => ({ label: `Room night ${n.night}`, amountUsd: n.rate_usd * b.rooms })),
      { label: "Taxes", amountUsd: b.taxes_usd }, { label: "Service fee", amountUsd: b.fees_usd },
    ],
    totalUsd: b.total_usd, paymentStatus: paid.status, paymentReference: paid.provider_ref,
    simulated: paid.simulated,
    notice: paid.simulated ? "SIMULATED PAYMENT - no real money was transferred. This receipt is for demonstration only." : undefined,
  });
}));

/* ---------------------------------------------------------------- payments */

bookingRoutes.post("/payments/intent", requireAuth, h(async (req, res) => {
  const b = parse(z.object({ bookingId: z.string().uuid(), idempotencyKey: z.string().min(8).max(100) }), req.body);
  const p = await createIntent(req.db, req.user!.id, b.bookingId, b.idempotencyKey);
  res.status(201).json({ ...p, simulated: p.simulated,
    notice: p.simulated ? "Demo payment provider: use /payments/:id/simulate to act as the provider. No real money moves." : undefined });
}));

bookingRoutes.get("/payments/:id", requireAuth, h(async (req, res) => {
  if (!isUuid(String(req.params.id))) throw notFound("Payment");
  const p = (await req.db.query<any>("SELECT * FROM payments WHERE id=$1 AND user_id=$2", [String(req.params.id), req.user!.id])).rows[0];
  if (!p) throw notFound("Payment");
  const events = (await req.db.query("SELECT type, created_at FROM payment_events WHERE payment_id=$1 ORDER BY id", [p.id])).rows;
  res.json({ ...p, events });
}));

// Demo-mode stand-in for the payment provider. It goes through the exact pipeline a signed webhook uses.
bookingRoutes.post("/payments/:id/simulate", requireAuth, h(async (req, res) => {
  if (!isUuid(String(req.params.id))) throw notFound("Payment");
  const { outcome } = parse(z.object({ outcome: z.enum(["success", "fail", "cancel"]) }), req.body);
  const r = await simulateProvider(req.db, req.user!.id, String(req.params.id), outcome);
  const p = (await req.db.query("SELECT id, status, simulated, failure_reason FROM payments WHERE id=$1", [String(req.params.id)])).rows[0];
  res.json({ ...r, payment: p, notice: "Simulated payment - no real money was transferred." });
}));

const WebhookSchema = z.object({
  id: z.string().min(4).max(100),
  type: z.enum(["payment.succeeded", "payment.failed", "payment.cancelled"]),
  payment_ref: z.string().min(4).max(100),
  amount_usd: z.number().nonnegative(),
  reason: z.string().max(200).optional(),
});

// Provider webhook: authenticated by HMAC signature over the raw body, never by user session.
bookingRoutes.post("/payments/webhook", h(async (req, res) => {
  const sig = req.header("x-wayfarer-signature");
  if (!req.rawBody || !verifySignature(req.rawBody, sig)) throw new ApiError(401, "INVALID_SIGNATURE", "Webhook signature verification failed");
  const ev = parse(WebhookSchema, req.body) as WebhookEvent;
  const r = await applyWebhookEvent(req.db, ev);
  res.json({ received: true, ...r });
}));

void config;
