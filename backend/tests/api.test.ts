import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auth, boot, inDays, login, roomOf, setInventory } from "./helpers.js";

let ctx: Awaited<ReturnType<typeof boot>>;
beforeAll(async () => { ctx = await boot(); });
afterAll(async () => { await ctx.db.close(); });

describe("authentication", () => {
  it("registers, logs in, and never honours a client-supplied role", async () => {
    const reg = await ctx.api.post("/api/auth/register").send({ email: "new.user@example.com", password: "Sup3rSecretPw", name: "New User", role: "admin" });
    expect(reg.status).toBe(201);
    expect(reg.body.user.role).toBe("customer");
    const me = await ctx.api.get("/api/users/me").set(auth(reg.body.accessToken));
    expect(me.body.email).toBe("new.user@example.com");
    const dup = await ctx.api.post("/api/auth/register").send({ email: "NEW.user@example.com", password: "Sup3rSecretPw", name: "Dup" });
    expect(dup.status).toBe(409);
  });

  it("rejects weak passwords and wrong credentials with safe messages", async () => {
    const weak = await ctx.api.post("/api/auth/register").send({ email: "weak@example.com", password: "short", name: "Weak" });
    expect(weak.status).toBe(422);
    const bad = await ctx.api.post("/api/auth/login").send({ email: "maya@demo.wayfarer.test", password: "nope-nope-nope" });
    expect(bad.status).toBe(401);
    const unknown = await ctx.api.post("/api/auth/login").send({ email: "ghost@example.com", password: "nope-nope-nope" });
    expect(unknown.body.error.message).toBe(bad.body.error.message);
    expect(JSON.stringify(bad.body)).not.toMatch(/stack|sql|pg_/i);
  });

  it("rotates refresh tokens and revokes the family when one is reused", async () => {
    const s = await login(ctx.api, "noah");
    const r1 = await ctx.api.post("/api/auth/refresh").send({ refreshToken: s.refresh });
    expect(r1.status).toBe(200);
    expect(r1.body.refreshToken).not.toBe(s.refresh);
    const reuse = await ctx.api.post("/api/auth/refresh").send({ refreshToken: s.refresh });
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe("REFRESH_REUSED");
    const after = await ctx.api.post("/api/auth/refresh").send({ refreshToken: r1.body.refreshToken });
    expect(after.status).toBe(401); // whole family revoked
  });

  it("rejects missing, malformed and tampered tokens", async () => {
    expect((await ctx.api.get("/api/users/me")).status).toBe(401);
    const bad = await ctx.api.get("/api/users/me").set(auth("not.a.jwt"));
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe("INVALID_TOKEN");
  });

  it("password reset flow works once and revokes sessions", async () => {
    const s = await login(ctx.api, "emma");
    const f = await ctx.api.post("/api/auth/forgot-password").send({ email: "emma@demo.wayfarer.test" });
    expect(f.body.demoResetToken).toBeTruthy();
    const ok = await ctx.api.post("/api/auth/reset-password").send({ token: f.body.demoResetToken, password: "BrandNewPass123" });
    expect(ok.status).toBe(200);
    const again = await ctx.api.post("/api/auth/reset-password").send({ token: f.body.demoResetToken, password: "AnotherPass123" });
    expect(again.status).toBe(400);
    expect((await ctx.api.post("/api/auth/refresh").send({ refreshToken: s.refresh })).status).toBe(401);
    const l = await ctx.api.post("/api/auth/login").send({ email: "emma@demo.wayfarer.test", password: "BrandNewPass123" });
    expect(l.status).toBe(200);
  });
});

describe("authorization (scenario 11)", () => {
  it("a customer cannot read another user's booking", async () => {
    const maya = await login(ctx.api, "maya");
    const liam = await login(ctx.api, "liam");
    const room = await roomOf(ctx.db, "riverside-pepper-lodge");
    await setInventory(ctx.db, room.id, inDays(30), 1, 2);
    const b = await ctx.api.post("/api/bookings").set(auth(maya.token)).send({
      roomTypeId: room.id, checkIn: inDays(30), checkOut: inDays(31), rooms: 1, adults: 2, children: 0, guestName: "Maya T", guestEmail: "m@example.com" });
    expect(b.status).toBe(201);
    const peek = await ctx.api.get(`/api/bookings/${b.body.id}`).set(auth(liam.token));
    expect(peek.status).toBe(404);
    const cancel = await ctx.api.post(`/api/bookings/${b.body.id}/cancel`).set(auth(liam.token));
    expect(cancel.status).toBe(404);
    const list = await ctx.api.get("/api/bookings").set(auth(liam.token));
    expect(list.body.items.find((x: any) => x.id === b.body.id)).toBeUndefined();
  });

  it("customers and partners are blocked from admin endpoints; staff are not blocked from reading", async () => {
    const maya = await login(ctx.api, "maya");
    const partner = await login(ctx.api, "partner.pp");
    const staff = await login(ctx.api, "staff1");
    for (const path of ["/api/admin/overview", "/api/admin/users", "/api/admin/bookings", "/api/admin/payments", "/api/admin/audit-logs"]) {
      expect((await ctx.api.get(path).set(auth(maya.token))).status).toBe(403);
      expect((await ctx.api.get(path).set(auth(partner.token))).status).toBe(403);
      expect((await ctx.api.get(path)).status).toBe(401);
    }
    expect((await ctx.api.get("/api/admin/overview").set(auth(staff.token))).status).toBe(200);
    const roleChange = await ctx.api.patch(`/api/admin/users/${maya.user.id}/role`).set(auth(staff.token)).send({ role: "admin" });
    expect(roleChange.status).toBe(403); // staff cannot grant roles
  });

  it("role changes made in the database apply immediately even with an old token", async () => {
    const tom = await login(ctx.api, "tom");
    expect((await ctx.api.get("/api/admin/overview").set(auth(tom.token))).status).toBe(403);
    await ctx.db.query("UPDATE users SET role='staff' WHERE id=$1", [tom.user.id]);
    expect((await ctx.api.get("/api/admin/overview").set(auth(tom.token))).status).toBe(200);
    await ctx.db.query("UPDATE users SET role='customer' WHERE id=$1", [tom.user.id]);
    expect((await ctx.api.get("/api/admin/overview").set(auth(tom.token))).status).toBe(403);
  });

  it("partners only see and manage their own properties", async () => {
    const pp = await login(ctx.api, "partner.pp");
    const sr = await login(ctx.api, "partner.sr");
    const mine = await ctx.api.get("/api/partner/accommodations").set(auth(pp.token));
    expect(mine.body.items.length).toBeGreaterThan(0);
    expect(mine.body.items.every((a: any) => /Riverside|Tonle|Bassac|Independence|Backpackers/.test(a.name))).toBe(true);
    const srRoom = await roomOf(ctx.db, "angkor-courtyard-resort");
    const hijack = await ctx.api.put(`/api/partner/room-types/${srRoom.id}/inventory`).set(auth(pp.token)).send({ from: inDays(5), to: inDays(6), units: 0 });
    expect(hijack.status).toBe(404);
    const own = await ctx.api.put(`/api/partner/room-types/${srRoom.id}/inventory`).set(auth(sr.token)).send({ from: inDays(5), to: inDays(6), units: 1 });
    expect(own.status).toBe(200);
  });
});

describe("search and discovery", () => {
  it("filters in the query layer: price, stars, amenities, family, breakfast, cancellation", async () => {
    const cheap = await ctx.api.get("/api/accommodations").query({ destination: "phnom-penh", maxPrice: 30 });
    expect(cheap.status).toBe(200);
    expect(cheap.body.total).toBeGreaterThan(0);
    expect(cheap.body.items.every((i: any) => i.price_from <= 30)).toBe(true);

    const four = await ctx.api.get("/api/accommodations").query({ stars: "4,5" });
    expect(four.body.items.every((i: any) => i.stars >= 4)).toBe(true);

    const pool = await ctx.api.get("/api/accommodations").query({ amenities: "pool,gym", pageSize: 50 });
    expect(pool.body.total).toBeGreaterThan(0);
    for (const i of pool.body.items) {
      const d = await ctx.api.get(`/api/accommodations/${i.slug}`);
      const codes = d.body.amenities.map((a: any) => a.code);
      expect(codes).toEqual(expect.arrayContaining(["pool", "gym"]));
    }

    const fam = await ctx.api.get("/api/accommodations").query({ familyFriendly: "true", pageSize: 50 });
    expect(fam.body.items.every((i: any) => i.family_friendly)).toBe(true);
    const nr = await ctx.api.get("/api/accommodations").query({ freeCancellation: "true", pageSize: 50 });
    expect(nr.body.items.every((i: any) => i.free_cancel_hours > 0)).toBe(true);
    expect(nr.body.items.map((i: any) => i.slug)).not.toContain("backpackers-lounge-hostel");
  });

  it("scenario 4: family search for 2 adults + 2 children only returns rooms that fit", async () => {
    const r = await ctx.api.get("/api/accommodations").query({ destination: "siem-reap", adults: 2, children: 2, checkIn: inDays(20), checkOut: inDays(23), familyFriendly: "true" });
    expect(r.status).toBe(200);
    expect(r.body.items.length).toBeGreaterThan(0);
    const d = await ctx.api.get(`/api/accommodations/${r.body.items[0].slug}`).query({ checkIn: inDays(20), checkOut: inDays(23) });
    expect(d.body.room_types.some((x: any) => x.max_children >= 2)).toBe(true);
    expect(d.body.room_types[0].quote.nights).toBe(3);
    expect(d.body.room_types[0].quote.total_usd).toBeGreaterThan(d.body.room_types[0].quote.subtotal_usd);
  });

  it("scenario 5: sorts by price with a nightly budget", async () => {
    const r = await ctx.api.get("/api/accommodations").query({ destination: "phnom-penh", maxPrice: 60, sort: "price_asc" });
    const prices = r.body.items.map((i: any) => i.price_from);
    expect([...prices].sort((a: number, b: number) => a - b)).toEqual(prices);
    expect(Math.max(...prices)).toBeLessThanOrEqual(60);
  });

  it("paginates and reports totals", async () => {
    const p1 = await ctx.api.get("/api/accommodations").query({ pageSize: 10, page: 1 });
    const p2 = await ctx.api.get("/api/accommodations").query({ pageSize: 10, page: 2 });
    expect(p1.body.total).toBe(30);
    expect(p1.body.items).toHaveLength(10);
    expect(p2.body.items.map((i: any) => i.id)).not.toEqual(expect.arrayContaining(p1.body.items.map((i: any) => i.id)));
    const empty = await ctx.api.get("/api/accommodations").query({ q: "zzzz-not-a-place" });
    expect(empty.status).toBe(200);
    expect(empty.body.items).toEqual([]);
  });

  it("validates dates and distance parameters", async () => {
    expect((await ctx.api.get("/api/accommodations").query({ checkIn: inDays(5), checkOut: inDays(3) })).status).toBe(422);
    expect((await ctx.api.get("/api/accommodations").query({ checkIn: inDays(5) })).status).toBe(422);
    expect((await ctx.api.get("/api/accommodations").query({ checkIn: "2020-01-01", checkOut: "2020-01-03" })).status).toBe(422);
    expect((await ctx.api.get("/api/accommodations").query({ sort: "distance" })).status).toBe(422);
    const near = await ctx.api.get("/api/accommodations").query({ lat: 11.5636, lng: 104.9312, maxDistanceKm: 3, sort: "distance" });
    expect(near.status).toBe(200);
    expect(near.body.items.length).toBeGreaterThan(0);
    expect(near.body.items.every((i: any) => i.distance_km <= 3)).toBe(true);
  });

  it("serves destinations with real data and unknown ids as 404", async () => {
    const list = await ctx.api.get("/api/destinations").query({ pageSize: 50 });
    expect(list.body.total).toBe(20);
    const intl = await ctx.api.get("/api/destinations").query({ international: "true" });
    expect(intl.body.items.every((d: any) => d.country !== "Cambodia")).toBe(true);
    const pp = await ctx.api.get("/api/destinations/phnom-penh");
    expect(pp.body.related.length).toBeGreaterThan(0);
    expect(pp.body.related[0].distance_km).toBeGreaterThan(0);
    expect((await ctx.api.get("/api/destinations/does-not-exist")).status).toBe(404);
    const a = await ctx.api.get("/api/destinations/phnom-penh/attractions").query({ kind: "restaurant" });
    expect(a.body.items.every((x: any) => x.kind === "restaurant")).toBe(true);
  });
});

describe("AI planner and assistant (rules / retrieval modes)", () => {
  it("scenario 1/9: understands the 3-day Phnom Penh request and only returns stored records", async () => {
    const r = await ctx.api.post("/api/ai/travel-plan").send({
      prompt: "I have three days in Phnom Penh, two adults, and a total budget of $150. I enjoy Khmer food, culture, photography and relaxed walks." });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("ok");
    expect(r.body.understood).toMatchObject({ destination: "phnom-penh", days: 3, adults: 2, budgetUsd: 150 });
    expect(r.body.understood.interests).toEqual(expect.arrayContaining(["food", "culture", "photography"]));
    expect(r.body.plan.mode).toBe("rules");
    expect(r.body.plan.modeNote).toMatch(/not an AI/i);
    const ids = r.body.plan.days.flatMap((d: any) => d.items.map((i: any) => i.attractionId));
    expect(ids.length).toBeGreaterThanOrEqual(6);
    expect(new Set(ids).size).toBe(ids.length); // no duplicate stops
    const found = await ctx.db.query("SELECT id FROM attractions WHERE id = ANY($1::uuid[])", [ids]);
    expect(found.rowCount).toBe(ids.length);
    if (r.body.plan.lodging) {
      const l = await ctx.db.query("SELECT 1 FROM accommodations WHERE id=$1", [r.body.plan.lodging.id]);
      expect(l.rowCount).toBe(1);
    }
    for (const day of r.body.plan.days) {
      const starts = day.items.map((i: any) => i.startMin);
      expect([...starts].sort((a: number, b: number) => a - b)).toEqual(starts);
      for (let i = 1; i < day.items.length; i++) {
        expect(day.items[i].startMin).toBeGreaterThanOrEqual(day.items[i - 1].startMin + day.items[i - 1].durationMin);
      }
    }
    const sum = r.body.plan.budget.lodgingUsd + r.body.plan.budget.activitiesUsd + r.body.plan.budget.foodUsd + r.body.plan.budget.transportUsd;
    expect(r.body.plan.budget.totalUsd).toBeCloseTo(sum, 1);
    expect(typeof r.body.plan.budget.withinBudget).toBe("boolean");
  });

  it("asks for missing essentials instead of guessing", async () => {
    const r = await ctx.api.post("/api/ai/travel-plan").send({ prompt: "I want a relaxing holiday with good food" });
    expect(r.body.status).toBe("needs_more_info");
    expect(r.body.missing).toEqual(expect.arrayContaining(["destination", "days"]));
  });

  it("requires sign-in to save, then supports edit/reorder/remove with recalculated totals", async () => {
    const anon = await ctx.api.post("/api/ai/travel-plan").send({ prompt: "2 days in Siem Reap for temples", save: true });
    expect(anon.status).toBe(401);
    const sophea = await login(ctx.api, "sophea");
    const saved = await ctx.api.post("/api/ai/travel-plan").set(auth(sophea.token)).send({ prompt: "3 days in Siem Reap, 2 adults, temples and photography", save: true });
    expect(saved.body.itineraryId).toBeTruthy();
    const id = saved.body.itineraryId;
    const before = await ctx.api.get(`/api/itineraries/${id}`).set(auth(sophea.token));
    expect(before.body.days).toHaveLength(3);
    const day1 = before.body.days[0].items.map((i: any) => ({ attractionId: i.attractionId }));
    expect(day1.length).toBeGreaterThan(1);
    const reordered = [...day1].reverse().slice(0, day1.length - 1); // reverse + remove one
    const patched = await ctx.api.patch(`/api/itineraries/${id}`).set(auth(sophea.token)).send({ days: [{ day: 1, items: reordered }] });
    expect(patched.status).toBe(200);
    expect(patched.body.days[0].items.map((i: any) => i.attractionId)).toEqual(reordered.map((i: any) => i.attractionId));
    expect(patched.body.est_total_usd).not.toBe(before.body.est_total_usd);

    // regenerate just day 2, others untouched
    const d3Before = JSON.stringify(patched.body.days[2].items.map((i: any) => i.attractionId));
    const regen = await ctx.api.post(`/api/itineraries/${id}/generate`).set(auth(sophea.token)).send({ day: 2 });
    expect(regen.status).toBe(200);
    expect(JSON.stringify(regen.body.days[2].items.map((i: any) => i.attractionId))).toBe(d3Before);

    // foreign attraction (other destination) is refused
    const other = (await ctx.db.query<any>("SELECT a.id FROM attractions a JOIN destinations d ON d.id=a.destination_id WHERE d.slug='bangkok' LIMIT 1")).rows[0];
    const bad = await ctx.api.patch(`/api/itineraries/${id}`).set(auth(sophea.token)).send({ days: [{ day: 1, items: [{ attractionId: other.id }] }] });
    expect(bad.status).toBe(422);

    // other users cannot see or change it
    const maya = await login(ctx.api, "maya");
    expect((await ctx.api.get(`/api/itineraries/${id}`).set(auth(maya.token))).status).toBe(404);
    expect((await ctx.api.patch(`/api/itineraries/${id}`).set(auth(maya.token)).send({ title: "hijack" })).status).toBe(404);
  });

  it("RAG: answers from approved documents with sources, and declines unknown topics", async () => {
    const ok = await ctx.api.post("/api/ai/assistant").send({ question: "What should I wear when visiting temples in Cambodia?" });
    expect(ok.status).toBe(200);
    expect(ok.body.grounded).toBe(true);
    expect(ok.body.mode).toBe("retrieval-only");
    expect(ok.body.sources.map((s: any) => s.slug)).toContain("etiquette-temples-cambodia");
    expect(ok.body.disclaimer).toMatch(/verify/i);
    const none = await ctx.api.post("/api/ai/assistant").send({ question: "Who won the 1998 football world cup final?" });
    expect(none.body.grounded).toBe(false);
    expect(none.body.sources).toEqual([]);
    const policy = await ctx.api.post("/api/ai/assistant").send({ question: "How does free cancellation work?" });
    expect(policy.body.sources[0].category).toBe("policy");
  });

  it("route estimates are labelled as estimates and never claim live traffic", async () => {
    const r = await ctx.api.post("/api/routes/estimate").send({ points: [{ lat: 11.5636, lng: 104.9312 }, { lat: 11.5649, lng: 104.9298 }, { lat: 11.5761, lng: 104.9235 }] });
    expect(r.body.liveTraffic).toBe(false);
    expect(r.body.method).toBe("straight_line_estimate");
    expect(r.body.legs).toHaveLength(2);
    expect((await ctx.api.post("/api/routes/estimate").send({ points: [{ lat: 1, lng: 1 }] })).status).toBe(422);
  });
});

describe("administration (scenario 10)", () => {
  it("staff can create a destination, adjust availability and the audit log records it", async () => {
    const staff = await login(ctx.api, "staff1");
    const created = await ctx.api.post("/api/admin/destinations").set(auth(staff.token)).send({
      name: "Test Haven", country: "Cambodia", shortDescription: "A test destination for QA.", longDescription: "A long enough description for validation to pass cleanly.",
      lat: 12.1, lng: 105.1, dailyBudgetUsd: 40, currency: "KHR", tags: ["test"] });
    expect(created.status).toBe(201);
    const dup = await ctx.api.post("/api/admin/destinations").set(auth(staff.token)).send({
      name: "Test Haven", country: "Cambodia", shortDescription: "A test destination for QA.", longDescription: "A long enough description for validation to pass cleanly.",
      lat: 12.1, lng: 105.1, dailyBudgetUsd: 40 });
    expect(dup.status).toBe(409);
    const invalid = await ctx.api.post("/api/admin/destinations").set(auth(staff.token)).send({ name: "x", country: "y", lat: 999, lng: 0 });
    expect(invalid.status).toBe(422);
    const room = await roomOf(ctx.db, "temple-view-family-hotel");
    const inv = await ctx.api.put(`/api/admin/room-types/${room.id}/inventory`).set(auth(staff.token)).send({ from: inDays(200), to: inDays(204), units: 2, priceUsd: 70 });
    expect(inv.body.updatedNights).toBe(5);
    const q = await ctx.api.get(`/api/accommodations/temple-view-family-hotel/availability`).query({ checkIn: inDays(200), checkOut: inDays(202) });
    expect(q.body.results[0].available).toBe(true);
    const logs = await ctx.api.get("/api/admin/audit-logs").set(auth(staff.token)).query({ action: "destination.create" });
    expect(logs.body.items.length).toBeGreaterThan(0);
    const adminLogs = await ctx.api.get("/api/admin/audit-logs").set(auth(staff.token)).query({ action: "inventory" });
    expect(adminLogs.body.items[0].actor_email).toBe("staff1@demo.wayfarer.test");
  });

  it("reviews require a stay, can be moderated, and update the rating", async () => {
    const fresh = await ctx.api.post("/api/auth/register").send({ email: "reviewer@example.com", password: "Sup3rSecretPw", name: "Fresh Reviewer" });
    const staff = await login(ctx.api, "staff2");
    const noStay = await ctx.api.post("/api/accommodations/tonle-garden-guesthouse/reviews").set(auth(fresh.body.accessToken)).send({ rating: 5, title: "Great", body: "A wonderful quiet place to stay." });
    expect(noStay.status).toBe(403);
    const list = await ctx.api.get("/api/admin/reviews").set(auth(staff.token)).query({ status: "published", pageSize: 5 });
    const rid = list.body.items[0].id;
    expect((await ctx.api.patch(`/api/admin/reviews/${rid}`).set(auth(staff.token)).send({ status: "hidden" })).status).toBe(204);
    const hidden = await ctx.db.query("SELECT status FROM reviews WHERE id=$1", [rid]);
    expect((hidden.rows[0] as any).status).toBe("hidden");
  });

  it("overview exposes counts and flags revenue as simulated", async () => {
    const admin = await login(ctx.api, "admin");
    const o = await ctx.api.get("/api/admin/overview").set(auth(admin.token));
    expect(o.body.counts.accommodations).toBe(30);
    expect(o.body.note).toMatch(/simulated/i);
  });
});

describe("platform", () => {
  it("health, docs and openapi are served; unknown routes are JSON 404s", async () => {
    expect((await ctx.api.get("/api/health")).body.status).toBe("ok");
    const spec = await ctx.api.get("/api/openapi.json");
    expect(Object.keys(spec.body.paths).length).toBeGreaterThan(50);
    const nf = await ctx.api.get("/api/nope");
    expect(nf.status).toBe(404);
    expect(nf.body.error.code).toBe("NOT_FOUND");
    const bad = await ctx.api.post("/api/auth/login").set("content-type", "application/json").send("{bad json");
    expect(bad.status).toBe(400);
  });

  it("wishlist, notifications and account deletion", async () => {
    const lina = await login(ctx.api, "lina");
    const dest = (await ctx.db.query<any>("SELECT id FROM destinations WHERE slug='kep'")).rows[0];
    expect((await ctx.api.put(`/api/wishlist/destination/${dest.id}`).set(auth(lina.token))).status).toBe(204);
    const w = await ctx.api.get("/api/wishlist").set(auth(lina.token));
    expect(w.body.items.map((i: any) => i.slug)).toContain("kep");
    const n = await ctx.api.get("/api/notifications").set(auth(lina.token));
    expect(n.body.items.length).toBeGreaterThan(0);
    expect((await ctx.api.patch(`/api/notifications/${n.body.items[0].id}/read`).set(auth(lina.token))).status).toBe(204);
    const wrongPw = await ctx.api.post("/api/users/me/delete").set(auth(lina.token)).send({ password: "wrong-wrong-1" });
    expect(wrongPw.status).toBe(403);
  });
});
