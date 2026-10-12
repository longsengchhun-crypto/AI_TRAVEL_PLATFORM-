import { afterAll, describe, expect, it } from "vitest";
import { createDb } from "../src/db/index.js";
import { runSeed } from "../src/seed/seed.js";

describe("seed", () => {
  it("is idempotent: a second run adds no rows and meets target volumes", async () => {
    const db = await createDb();
    const first = await runSeed(db);
    const second = await runSeed(db);
    // audit_logs legitimately gains one 'seed.run' entry per execution; everything else must be unchanged.
    const { audit_logs: a1, ...rest1 } = first;
    const { audit_logs: a2, ...rest2 } = second;
    expect(rest2).toEqual(rest1);
    expect(a2).toBe(a1 + 1);
    expect(first.destinations).toBe(20);
    expect(first.accommodations).toBe(30);
    expect(first.room_types).toBe(60);
    expect(first.room_inventory).toBeGreaterThanOrEqual(100);
    expect(first.attractions_and_activities).toBeGreaterThanOrEqual(100);
    expect(first.restaurants).toBeGreaterThanOrEqual(40);
    expect(first.itineraries).toBe(30);
    expect(first.reviews).toBe(100);
    expect(first.travel_documents).toBe(20);
    expect(first.users).toBe(20);
    expect(first.bookings).toBe(50);
    expect(first.payment_events).toBeGreaterThanOrEqual(100);
    expect(first.notifications).toBeGreaterThanOrEqual(100);
    const bad = await db.query("SELECT 1 FROM room_inventory WHERE units_available < 0");
    expect(bad.rowCount).toBe(0);
    await db.close();
  });
});
