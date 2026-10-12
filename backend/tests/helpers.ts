import request from "supertest";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { createDb, type Db } from "../src/db/index.js";
import { runSeed } from "../src/seed/seed.js";
import { addDays, todayIso } from "../src/util.js";

export async function boot() {
  const db = await createDb();
  await runSeed(db);
  const app = createApp(db);
  return { db, app, api: request(app) };
}

export async function login(api: ReturnType<typeof request>, handle: string) {
  const r = await api.post("/api/auth/login").send({ email: `${handle}@demo.wayfarer.test`, password: config.demoPassword });
  if (r.status !== 200) throw new Error(`login failed for ${handle}: ${r.status} ${JSON.stringify(r.body)}`);
  return { token: r.body.accessToken as string, refresh: r.body.refreshToken as string, user: r.body.user };
}

export const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
export const inDays = (n: number) => addDays(todayIso(), n);

export async function roomOf(db: Db, accSlug: string, nth = 0) {
  const r = await db.query<any>(
    "SELECT r.id, r.base_price_usd, r.total_units FROM room_types r JOIN accommodations a ON a.id=r.accommodation_id WHERE a.slug=$1 ORDER BY r.base_price_usd", [accSlug]);
  return r.rows[nth];
}

/** Opens a clean, controllable window of inventory for a room type. */
export async function setInventory(db: Db, roomTypeId: string, from: string, nights: number, units: number, price?: number) {
  for (let i = 0; i < nights; i++) {
    await db.query(
      `INSERT INTO room_inventory(room_type_id, night, units_available, price_usd) VALUES ($1,$2,$3,COALESCE($4,(SELECT base_price_usd FROM room_types WHERE id=$1)))
       ON CONFLICT (room_type_id, night) DO UPDATE SET units_available=$3`, [roomTypeId, addDays(from, i), units, price ?? null]);
  }
}
