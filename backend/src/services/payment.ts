import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import type { Db } from "../db/index.js";
import { ApiError, conflict, notFound } from "../http.js";
import { expireStaleHolds, transition } from "./booking.js";
import { audit, notify } from "./notify.js";

/**
 * Payment provider abstraction. In 'mock' mode WAYFARER simulates a card processor: no real money moves,
 * and every record is flagged simulated. A real provider adapter would implement the same two methods:
 *   createCharge() -> provider_ref ; verifyWebhook() -> parsed event.
 */
export interface WebhookEvent {
  id: string;                // provider event id (dedupe key)
  type: "payment.succeeded" | "payment.failed" | "payment.cancelled";
  payment_ref: string;       // provider transaction reference
  amount_usd: number;
  reason?: string;
}

export const sign = (raw: string | Buffer) => createHmac("sha256", config.webhookSecret).update(raw).digest("hex");

export function verifySignature(raw: Buffer | string, signature: string | undefined): boolean {
  if (!signature) return false;
  const a = Buffer.from(sign(raw)), b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function createIntent(db: Db, userId: string, bookingId: string, idempotencyKey: string) {
  await expireStaleHolds(db);
  return db.tx(async (tx) => {
    const b = (await tx.query<any>("SELECT * FROM bookings WHERE id=$1 FOR UPDATE", [bookingId])).rows[0];
    if (!b || b.user_id !== userId) throw notFound("Booking");
    const same = (await tx.query<any>("SELECT * FROM payments WHERE idempotency_key=$1", [idempotencyKey])).rows[0];
    if (same) {
      if (same.booking_id !== bookingId || same.user_id !== userId) throw conflict("IDEMPOTENCY_KEY_REUSED", "Idempotency key was used for a different request.");
      return same;
    }
    if (b.status !== "PENDING_CONFIRMATION") throw conflict("BOOKING_NOT_PAYABLE", `A booking in status ${b.status} cannot be paid.`);
    const open = (await tx.query<any>("SELECT * FROM payments WHERE booking_id=$1 AND status IN ('PENDING','SUCCESS') LIMIT 1", [bookingId])).rows[0];
    if (open) return open;
    const p = (await tx.query<any>(
      `INSERT INTO payments(booking_id, user_id, amount_usd, status, provider, provider_ref, idempotency_key, simulated)
       VALUES ($1,$2,$3,'PENDING',$4,$5,$6,$7) RETURNING *`,
      [bookingId, userId, b.total_usd, config.paymentMode === "mock" ? "demo-sim" : config.paymentMode,
        "SIM-" + randomBytes(8).toString("hex").toUpperCase(), idempotencyKey, config.paymentMode === "mock"])).rows[0];
    await audit(tx, userId, "payment.intent", "payment", p.id, { bookingId, amount_usd: p.amount_usd });
    return p;
  });
}

/**
 * Applies a provider event. Idempotent: the same provider event id is processed once.
 * The client never reports success; only a signed event (or the server-side simulator) reaches here.
 */
export async function applyWebhookEvent(db: Db, ev: WebhookEvent): Promise<{ duplicate: boolean; status?: string }> {
  return db.tx(async (tx) => {
    const p = (await tx.query<any>("SELECT * FROM payments WHERE provider_ref=$1 FOR UPDATE", [ev.payment_ref])).rows[0];
    if (!p) throw notFound("Payment");
    const ins = await tx.query(
      "INSERT INTO payment_events(payment_id, provider_event_id, type, payload) VALUES ($1,$2,$3,$4) ON CONFLICT (provider_event_id) DO NOTHING",
      [p.id, ev.id, ev.type, JSON.stringify(ev)]);
    if (ins.rowCount === 0) return { duplicate: true, status: p.status };
    if (p.status !== "PENDING") return { duplicate: false, status: p.status }; // already final; event logged only

    const b = (await tx.query<any>("SELECT * FROM bookings WHERE id=$1 FOR UPDATE", [p.booking_id])).rows[0];
    if (ev.type === "payment.succeeded") {
      if (Math.abs(Number(ev.amount_usd) - Number(p.amount_usd)) > 0.001) {
        await tx.query("UPDATE payments SET status='FAILED', failure_reason='amount_mismatch', updated_at=now() WHERE id=$1", [p.id]);
        await audit(tx, null, "payment.amount_mismatch", "payment", p.id, { expected: p.amount_usd, got: ev.amount_usd });
        return { duplicate: false, status: "FAILED" };
      }
      if (b.status !== "PENDING_CONFIRMATION") {
        await tx.query("UPDATE payments SET status='FAILED', failure_reason='booking_not_payable', updated_at=now() WHERE id=$1", [p.id]);
        return { duplicate: false, status: "FAILED" };
      }
      await tx.query("UPDATE payments SET status='SUCCESS', updated_at=now() WHERE id=$1", [p.id]);
      await transition(tx, b.id, "PENDING_CONFIRMATION", "CONFIRMED", null, `Payment ${p.provider_ref} verified${p.simulated ? " (simulated)" : ""}`);
      await tx.query("UPDATE bookings SET hold_expires_at = NULL WHERE id=$1", [b.id]);
      await notify(tx, b.user_id, "payment", "Payment received", `Payment for booking ${b.reference} succeeded${p.simulated ? " (simulated, no real money moved)" : ""}. Your booking is confirmed.`, { bookingId: b.id });
      await audit(tx, null, "payment.success", "payment", p.id, { bookingId: b.id });
      return { duplicate: false, status: "SUCCESS" };
    }
    const status = ev.type === "payment.cancelled" ? "CANCELLED" : "FAILED";
    await tx.query("UPDATE payments SET status=$2, failure_reason=$3, updated_at=now() WHERE id=$1", [p.id, status, ev.reason ?? null]);
    await notify(tx, b.user_id, "payment", "Payment " + status.toLowerCase(),
      `Payment for booking ${b.reference} ${status === "FAILED" ? "failed" : "was cancelled"}. The booking is not confirmed; you can retry before the hold expires.`, { bookingId: b.id });
    await audit(tx, null, `payment.${status.toLowerCase()}`, "payment", p.id, { reason: ev.reason });
    return { duplicate: false, status };
  });
}

/** Demo-mode simulator: builds a signed event as the mock provider would and runs it through the same pipeline. */
export async function simulateProvider(db: Db, userId: string, paymentId: string, outcome: "success" | "fail" | "cancel") {
  if (config.paymentMode !== "mock") throw new ApiError(403, "SIMULATION_DISABLED", "Payment simulation is disabled in this environment");
  const p = (await db.query<any>("SELECT * FROM payments WHERE id=$1 AND user_id=$2", [paymentId, userId])).rows[0];
  if (!p) throw notFound("Payment");
  const ev: WebhookEvent = {
    id: "evt_" + randomBytes(8).toString("hex"),
    type: outcome === "success" ? "payment.succeeded" : outcome === "fail" ? "payment.failed" : "payment.cancelled",
    payment_ref: p.provider_ref, amount_usd: p.amount_usd,
    reason: outcome === "fail" ? "card_declined (simulated)" : undefined,
  };
  return applyWebhookEvent(db, ev);
}
