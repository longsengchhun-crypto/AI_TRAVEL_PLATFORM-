import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { auth, boot, inDays, login, roomOf, setInventory } from "./helpers.js";

let ctx: Awaited<ReturnType<typeof boot>>;
let maya: Awaited<ReturnType<typeof login>>, liam: Awaited<ReturnType<typeof login>>;
beforeAll(async () => { ctx = await boot(); maya = await login(ctx.api, "maya"); liam = await login(ctx.api, "liam"); });
afterAll(async () => { await ctx.db.close(); });

const body = (roomTypeId: string, ci: string, co: string, extra: object = {}) =>
  ({ roomTypeId, checkIn: ci, checkOut: co, rooms: 1, adults: 2, children: 0, guestName: "Maya Thompson", guestEmail: "maya@demo.wayfarer.test", ...extra });
const unitsOn = async (roomId: string, night: string) =>
  (await ctx.db.query<any>("SELECT units_available FROM room_inventory WHERE room_type_id=$1 AND night=$2", [roomId, night])).rows[0].units_available as number;

describe("booking lifecycle", () => {
  it("scenario 6: books, pays, cancels within policy, restores inventory and refunds (simulated)", async () => {
    const room = await roomOf(ctx.db, "riverside-pepper-lodge");
    const ci = inDays(50), co = inDays(52);
    await setInventory(ctx.db, room.id, ci, 2, 3);
    const created = await ctx.api.post("/api/bookings").set(auth(maya.token)).send(body(room.id, ci, co));
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("PENDING_CONFIRMATION");
    expect(await unitsOn(room.id, ci)).toBe(2);

    const intent = await ctx.api.post("/api/payments/intent").set(auth(maya.token)).send({ bookingId: created.body.id, idempotencyKey: "key-abc-12345" });
    expect(intent.status).toBe(201);
    expect(intent.body.simulated).toBe(true);
    const pay = await ctx.api.post(`/api/payments/${intent.body.id}/simulate`).set(auth(maya.token)).send({ outcome: "success" });
    expect(pay.body.payment.status).toBe("SUCCESS");

    const detail = await ctx.api.get(`/api/bookings/${created.body.id}`).set(auth(maya.token));
    expect(detail.body.status).toBe("CONFIRMED");
    const receipt = await ctx.api.get(`/api/bookings/${created.body.id}/receipt`).set(auth(maya.token));
    expect(receipt.status).toBe(200);
    expect(receipt.body.simulated).toBe(true);
    expect(receipt.body.notice).toMatch(/SIMULATED/);

    const cancel = await ctx.api.post(`/api/bookings/${created.body.id}/cancel`).set(auth(maya.token));
    expect(cancel.status).toBe(200);
    expect(cancel.body.refunded).toBe(true);
    expect(cancel.body.booking.status).toBe("REFUNDED");
    expect(await unitsOn(room.id, ci)).toBe(3);
    const history = (await ctx.db.query<any>("SELECT to_status FROM booking_status_events WHERE booking_id=$1 ORDER BY id", [created.body.id])).rows.map((r) => r.to_status);
    expect(history).toEqual(["PENDING_CONFIRMATION", "CONFIRMED", "CANCELLED", "REFUND_PENDING", "REFUNDED"]);
  });

  it("scenario 7: failed payment never marks the booking paid", async () => {
    const room = await roomOf(ctx.db, "riverside-pepper-lodge");
    const ci = inDays(60), co = inDays(61);
    await setInventory(ctx.db, room.id, ci, 1, 2);
    const b = await ctx.api.post("/api/bookings").set(auth(maya.token)).send(body(room.id, ci, co));
    const intent = await ctx.api.post("/api/payments/intent").set(auth(maya.token)).send({ bookingId: b.body.id, idempotencyKey: "key-fail-12345" });
    const r = await ctx.api.post(`/api/payments/${intent.body.id}/simulate`).set(auth(maya.token)).send({ outcome: "fail" });
    expect(r.body.payment.status).toBe("FAILED");
    const d = await ctx.api.get(`/api/bookings/${b.body.id}`).set(auth(maya.token));
    expect(d.body.status).toBe("PENDING_CONFIRMATION");
    const receipt = await ctx.api.get(`/api/bookings/${b.body.id}/receipt`).set(auth(maya.token));
    expect(receipt.status).toBe(409);
  });

  it("scenario 8: duplicate signed webhook is processed once", async () => {
    const room = await roomOf(ctx.db, "riverside-pepper-lodge");
    const ci = inDays(70), co = inDays(71);
    await setInventory(ctx.db, room.id, ci, 1, 2);
    const b = await ctx.api.post("/api/bookings").set(auth(maya.token)).send(body(room.id, ci, co));
    const intent = await ctx.api.post("/api/payments/intent").set(auth(maya.token)).send({ bookingId: b.body.id, idempotencyKey: "key-dup-123456" });
    const payload = JSON.stringify({ id: "evt_dup_1", type: "payment.succeeded", payment_ref: intent.body.provider_ref, amount_usd: intent.body.amount_usd });
    const sig = createHmac("sha256", config.webhookSecret).update(payload).digest("hex");
    const send = () => ctx.api.post("/api/payments/webhook").set("content-type", "application/json").set("x-wayfarer-signature", sig).send(payload);
    const first = await send();
    const second = await send();
    expect(first.body.duplicate).toBe(false);
    expect(second.body.duplicate).toBe(true);
    const events = await ctx.db.query("SELECT 1 FROM payment_events WHERE provider_event_id='evt_dup_1'");
    expect(events.rowCount).toBe(1);
    const success = await ctx.db.query("SELECT 1 FROM booking_status_events WHERE booking_id=$1 AND to_status='CONFIRMED'", [b.body.id]);
    expect(success.rowCount).toBe(1);
  });

  it("rejects webhooks with a bad signature or none", async () => {
    const payload = JSON.stringify({ id: "evt_x", type: "payment.succeeded", payment_ref: "SIM-NOPE", amount_usd: 1 });
    const bad = await ctx.api.post("/api/payments/webhook").set("content-type", "application/json").set("x-wayfarer-signature", "deadbeef").send(payload);
    expect(bad.status).toBe(401);
    const none = await ctx.api.post("/api/payments/webhook").send({ id: "evt_y" });
    expect(none.status).toBe(401);
  });

  it("amount mismatch in a signed event fails the payment and keeps the booking unpaid", async () => {
    const room = await roomOf(ctx.db, "riverside-pepper-lodge");
    const ci = inDays(80), co = inDays(81);
    await setInventory(ctx.db, room.id, ci, 1, 2);
    const b = await ctx.api.post("/api/bookings").set(auth(maya.token)).send(body(room.id, ci, co));
    const intent = await ctx.api.post("/api/payments/intent").set(auth(maya.token)).send({ bookingId: b.body.id, idempotencyKey: "key-mismatch-1" });
    const payload = JSON.stringify({ id: "evt_mm_1", type: "payment.succeeded", payment_ref: intent.body.provider_ref, amount_usd: 0.01 });
    const sig = createHmac("sha256", config.webhookSecret).update(payload).digest("hex");
    const r = await ctx.api.post("/api/payments/webhook").set("content-type", "application/json").set("x-wayfarer-signature", sig).send(payload);
    expect(r.body.status).toBe("FAILED");
    const d = await ctx.api.get(`/api/bookings/${b.body.id}`).set(auth(maya.token));
    expect(d.body.status).toBe("PENDING_CONFIRMATION");
  });

  it("payment intent is idempotent", async () => {
    const room = await roomOf(ctx.db, "riverside-pepper-lodge");
    const ci = inDays(90), co = inDays(91);
    await setInventory(ctx.db, room.id, ci, 1, 2);
    const b = await ctx.api.post("/api/bookings").set(auth(maya.token)).send(body(room.id, ci, co));
    const a = await ctx.api.post("/api/payments/intent").set(auth(maya.token)).send({ bookingId: b.body.id, idempotencyKey: "same-key-12345" });
    const c = await ctx.api.post("/api/payments/intent").set(auth(maya.token)).send({ bookingId: b.body.id, idempotencyKey: "same-key-12345" });
    expect(c.body.id).toBe(a.body.id);
    const n = await ctx.db.query("SELECT 1 FROM payments WHERE booking_id=$1", [b.body.id]);
    expect(n.rowCount).toBe(1);
  });

  it("non-refundable cancellation releases the room but keeps the payment", async () => {
    const room = await roomOf(ctx.db, "backpackers-lounge-hostel");
    const ci = inDays(40), co = inDays(41);
    await setInventory(ctx.db, room.id, ci, 1, 2);
    const b = await ctx.api.post("/api/bookings").set(auth(liam.token)).send(body(room.id, ci, co, { guestName: "Liam Chen" }));
    const intent = await ctx.api.post("/api/payments/intent").set(auth(liam.token)).send({ bookingId: b.body.id, idempotencyKey: "key-hostel-1234" });
    await ctx.api.post(`/api/payments/${intent.body.id}/simulate`).set(auth(liam.token)).send({ outcome: "success" });
    const c = await ctx.api.post(`/api/bookings/${b.body.id}/cancel`).set(auth(liam.token));
    expect(c.body.refunded).toBe(false);
    expect(c.body.booking.status).toBe("CANCELLED");
    expect(await unitsOn(room.id, ci)).toBe(2);
    const p = (await ctx.db.query<any>("SELECT status FROM payments WHERE booking_id=$1", [b.body.id])).rows[0];
    expect(p.status).toBe("SUCCESS");
  });

  it("scenario 12: blocked dates return a useful 409 and the hotel is excluded from search", async () => {
    const room = await roomOf(ctx.db, "riverside-heritage-hotel");
    const ci = inDays(31), co = inDays(33);
    const r = await ctx.api.post("/api/bookings").set(auth(maya.token)).send(body(room.id, ci, co));
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("NO_AVAILABILITY");
    expect(r.body.error.message).toMatch(/Not enough rooms|not open/);
    const search = await ctx.api.get("/api/accommodations").query({ destination: "phnom-penh", checkIn: ci, checkOut: co });
    expect(search.body.items.map((i: any) => i.slug)).not.toContain("riverside-heritage-hotel");
  });

  it("dates outside the open window are not bookable", async () => {
    const room = await roomOf(ctx.db, "riverside-pepper-lodge");
    const r = await ctx.api.post("/api/bookings").set(auth(maya.token)).send(body(room.id, inDays(400), inDays(402)));
    expect(r.status).toBe(409);
  });

  it("invalid dates and capacity are rejected with 422", async () => {
    const room = await roomOf(ctx.db, "riverside-pepper-lodge");
    const past = await ctx.api.post("/api/bookings").set(auth(maya.token)).send(body(room.id, inDays(-3), inDays(-1)));
    expect(past.status).toBe(422);
    const rev = await ctx.api.post("/api/bookings").set(auth(maya.token)).send(body(room.id, inDays(10), inDays(8)));
    expect(rev.status).toBe(422);
    const many = await ctx.api.post("/api/bookings").set(auth(maya.token)).send(body(room.id, inDays(10), inDays(11), { adults: 9 }));
    expect(many.status).toBe(422);
  });

  it("concurrent bookings of the last room: exactly one wins, no overbooking", async () => {
    const room = await roomOf(ctx.db, "bassac-lane-studios");
    const ci = inDays(100), co = inDays(102);
    await setInventory(ctx.db, room.id, ci, 2, 1);
    const users = [maya, liam, maya, liam, maya, liam];
    const results = await Promise.all(users.map((u) => ctx.api.post("/api/bookings").set(auth(u.token)).send(body(room.id, ci, co))));
    expect(results.filter((r) => r.status === 201).length).toBe(1);
    expect(results.filter((r) => r.status === 409).length).toBe(results.length - 1);
    expect(await unitsOn(room.id, ci)).toBe(0);
    const negative = await ctx.db.query("SELECT 1 FROM room_inventory WHERE units_available < 0");
    expect(negative.rowCount).toBe(0);
  });

  it("an unpaid hold that elapses is expired and the room is released", async () => {
    const room = await roomOf(ctx.db, "riverside-pepper-lodge");
    const ci = inDays(110), co = inDays(111);
    await setInventory(ctx.db, room.id, ci, 1, 2);
    const b = await ctx.api.post("/api/bookings").set(auth(maya.token)).send(body(room.id, ci, co));
    expect(await unitsOn(room.id, ci)).toBe(1);
    await ctx.db.query("UPDATE bookings SET hold_expires_at = now() - interval '1 minute' WHERE id=$1", [b.body.id]);
    const d = await ctx.api.get(`/api/bookings/${b.body.id}`).set(auth(maya.token));
    expect(d.body.status).toBe("EXPIRED");
    expect(await unitsOn(room.id, ci)).toBe(2);
  });

  it("illegal transitions are refused (cancel twice) and inventory is released once", async () => {
    const room = await roomOf(ctx.db, "riverside-pepper-lodge");
    const ci = inDays(120), co = inDays(121);
    await setInventory(ctx.db, room.id, ci, 1, 2);
    const b = await ctx.api.post("/api/bookings").set(auth(maya.token)).send(body(room.id, ci, co));
    const c1 = await ctx.api.post(`/api/bookings/${b.body.id}/cancel`).set(auth(maya.token));
    expect(c1.status).toBe(200);
    const c2 = await ctx.api.post(`/api/bookings/${b.body.id}/cancel`).set(auth(maya.token));
    expect(c2.status).toBe(409);
    expect(await unitsOn(room.id, ci)).toBe(2);
  });
});
