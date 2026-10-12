import { existsSync, readFileSync } from "node:fs";
import { hashPassword } from "../auth.js";
import { config } from "../config.js";
import { getDb, type Db } from "../db/index.js";
import { migrate } from "../db/migrate.js";
import { generatePlan, savePlan, type PlanRequest } from "../services/planner.js";
import { chunkText } from "../services/rag.js";
import { addDays, hhmmToMin, round2, slugify, todayIso } from "../util.js";
import { amenities, attractions, destinations, documents, hotels, restaurants } from "./data.js";

const images: Record<string, { url: string; page: string }> = existsSync(new URL("./images.json", import.meta.url))
  ? JSON.parse(readFileSync(new URL("./images.json", import.meta.url), "utf8")) : {};

/** Deterministic PRNG so every seed run produces the same demo data. */
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const credit = (page?: string) => (page ? `Photo: Wikipedia/Wikimedia Commons (licence on file page) - ${page}` : null);

export interface SeedSummary { [k: string]: number }

export async function runSeed(db: Db, opts: { log?: (m: string) => void } = {}): Promise<SeedSummary> {
  const log = opts.log ?? (() => {});
  if (config.isProd && !process.env.DEMO_PASSWORD) throw new Error("Refusing to seed demo users in production without an explicit DEMO_PASSWORD");
  const today = todayIso();
  const rand = rng(20261012);

  await migrate(db);

  await db.tx(async (tx) => {
    /* ---- currencies */
    const cur: [string, string, string, number][] = [["USD", "US Dollar", "$", 1], ["KHR", "Cambodian Riel", "៛", 4100], ["THB", "Thai Baht", "฿", 36],
      ["SGD", "Singapore Dollar", "S$", 1.34], ["MYR", "Malaysian Ringgit", "RM", 4.5], ["VND", "Vietnamese Dong", "₫", 25000], ["IDR", "Indonesian Rupiah", "Rp", 16000],
      ["JPY", "Japanese Yen", "¥", 150], ["KRW", "South Korean Won", "₩", 1350], ["LAK", "Lao Kip", "₭", 21500]];
    for (const [code, name, sym, rate] of cur) {
      await tx.query("INSERT INTO currencies(code,name,symbol,per_usd,rate_source) VALUES ($1,$2,$3,$4,'documented sample rate (not live)') ON CONFLICT (code) DO NOTHING", [code, name, sym, rate]);
      await tx.query(
        "INSERT INTO exchange_rate_snapshots(code, per_usd, source) SELECT $1,$2,'documented sample rate (not live)' WHERE NOT EXISTS (SELECT 1 FROM exchange_rate_snapshots WHERE code=$1)", [code, rate]);
    }
    for (const [code, label] of amenities) await tx.query("INSERT INTO amenities(code,label) VALUES ($1,$2) ON CONFLICT (code) DO NOTHING", [code, label]);

    /* ---- users */
    // Customer demo accounts share a documented password. admin/staff/partner accounts use PRIVILEGED_DEMO_PASSWORD
    // (kept out of the repo and docs) so a public demo never exposes a usable privileged login.
    const pwHash = await hashPassword(config.demoPassword);
    const privHash = await hashPassword(process.env.PRIVILEGED_DEMO_PASSWORD || config.demoPassword);
    const people: [string, string, string][] = [
      ["admin", "Sokha Admin", "admin"], ["staff1", "Dara Support", "staff"], ["staff2", "Vanna Operations", "staff"],
      ["partner.pp", "Chenda Riverside Partner", "partner"], ["partner.sr", "Bopha Angkor Partner", "partner"], ["partner.coast", "Rithy Coast Partner", "partner"],
      ["maya", "Maya Thompson", "customer"], ["liam", "Liam Chen", "customer"], ["sophea", "Sophea Sok", "customer"], ["noah", "Noah Williams", "customer"],
      ["aiko", "Aiko Tanaka", "customer"], ["carlos", "Carlos Rivera", "customer"], ["priya", "Priya Nair", "customer"], ["emma", "Emma Laurent", "customer"],
      ["jun", "Jun Park", "customer"], ["lina", "Lina Haddad", "customer"], ["oliver", "Oliver Smith", "customer"], ["sreyleak", "Sreyleak Chea", "customer"],
      ["tom", "Tom Becker", "customer"], ["anna", "Anna Kowalski", "customer"],
    ];
    const userIds: Record<string, string> = {};
    for (const [handle, name, role] of people) {
      const email = `${handle}@demo.wayfarer.test`;
      const r = await tx.query<any>(
        `INSERT INTO users(email, password_hash, name, role, is_demo) VALUES ($1,$2,$3,$4,true)
         ON CONFLICT (lower(email)) WHERE deleted_at IS NULL DO UPDATE SET name = EXCLUDED.name RETURNING id`,
        [email, role === "customer" ? pwHash : privHash, name, role]);
      userIds[handle] = r.rows[0].id;
    }
    const partnerIds: Record<string, string> = {};
    for (const [handle, label] of [["partner.pp", "Riverside Hospitality (demo)"], ["partner.sr", "Angkor Stays Group (demo)"], ["partner.coast", "Coastal Retreats (demo)"]]) {
      const ex = await tx.query<any>("SELECT id FROM partners WHERE user_id=$1", [userIds[handle]]);
      partnerIds[handle] = ex.rows[0]?.id ?? (await tx.query<any>("INSERT INTO partners(user_id, name) VALUES ($1,$2) RETURNING id", [userIds[handle], label])).rows[0].id;
    }
    const customers = people.filter((p) => p[2] === "customer").map((p) => userIds[p[0]]);

    /* ---- destinations */
    const destId: Record<string, string> = {};
    const destCover: Record<string, string | null> = {};
    for (const d of destinations) {
      // Wikipedia's lead image is sometimes a flag/map or a minor building; prefer a representative landmark photo.
      const coverWiki: Record<string, string> = { "siem-reap": "Angkor_Wat", singapore: "Marina_Bay_Sands", kep: "Rabbit_Island_(Cambodia)", kratie: "Irrawaddy_dolphin" };
      const img = (coverWiki[d.slug] ? images[coverWiki[d.slug]] : undefined) ?? images[d.wiki];
      destCover[d.slug] = img?.url ?? null;
      const r = await tx.query<any>(
        `INSERT INTO destinations(slug,name,country,region,is_international,short_description,long_description,lat,lng,cover_image,image_credit,
            daily_budget_usd,currency,best_period,transport_info,practical_info,tags,popularity,is_featured,is_demo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,false)
         ON CONFLICT (slug) DO UPDATE SET cover_image = COALESCE(EXCLUDED.cover_image, destinations.cover_image), image_credit = COALESCE(EXCLUDED.image_credit, destinations.image_credit)
         RETURNING id`,
        [d.slug, d.name, d.country, d.region, d.intl, d.short, d.long, d.lat, d.lng, img?.url ?? null, credit(img?.page), d.budget, d.currency,
          d.best, d.transport, d.practical, d.tags, d.popularity, !!d.featured]);
      destId[d.slug] = r.rows[0].id;
    }
    for (const d of destinations) {
      for (const rel of d.related) {
        if (!destId[rel]) continue;
        await tx.query("INSERT INTO related_destinations(destination_id, related_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [destId[d.slug], destId[rel]]);
      }
    }

    /* ---- attractions, activities, restaurants */
    const catTags: Record<string, string[]> = {
      temple: ["temples", "culture", "photography"], museum: ["culture", "history"], market: ["markets", "food", "photography", "shopping"],
      landmark: ["photography", "culture", "relaxed"], nature: ["nature", "outdoor", "photography", "relaxed"], beach: ["beach", "relaxed"],
      culture: ["culture", "photography"], tour: ["culture", "photography"], outdoor: ["outdoor", "nature"], food: ["food"], cafe: ["food", "relaxed", "cafe"],
    };
    const attrIds: Record<string, string> = {};
    for (const a of attractions) {
      const [dest, kind, cat, name, lat, lng, price, dur, open, close, fam, wiki, desc] = a;
      const img = wiki ? images[wiki] : undefined;
      const isDemo = desc.startsWith("Educational demo listing");
      const opens = hhmmToMin(open), closes = hhmmToMin(close);
      const slug = slugify(`${dest}-${name}`);
      const r = await tx.query<any>(
        `INSERT INTO attractions(slug,destination_id,kind,category,name,description,lat,lng,image,image_credit,price_usd,duration_min,opens_min,closes_min,
            hours_verified,tips,tags,family_friendly,is_demo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,false,$15,$16,$17,$18)
         ON CONFLICT (slug) DO UPDATE SET image = COALESCE(attractions.image, EXCLUDED.image), image_credit = COALESCE(attractions.image_credit, EXCLUDED.image_credit)
         RETURNING id`,
        [slug, destId[dest], kind, cat, name, desc.replace(/^Educational demo listing: /, ""), lat, lng, img?.url ?? null, credit(img?.page), price, dur,
          opens, closes === null ? null : closes, "Prices and opening hours are indicative; confirm locally before visiting.",
          [...new Set([cat, ...(catTags[cat] ?? [])])], !!fam, isDemo]);
      attrIds[slug] = r.rows[0].id;
    }
    for (const [dest, name, cuisine, lat, lng, price, desc] of restaurants) {
      const cafe = /cafe|bakery|coffee/i.test(cuisine);
      const slug = slugify(`${dest}-${name}`);
      await tx.query(
        `INSERT INTO attractions(slug,destination_id,kind,category,name,description,lat,lng,price_usd,duration_min,opens_min,closes_min,hours_verified,tips,tags,family_friendly,is_demo)
         VALUES ($1,$2,'restaurant',$3,$4,$5,$6,$7,$8,$9,$10,$11,false,$12,$13,true,true) ON CONFLICT (slug) DO NOTHING`,
        [slug, destId[dest], cafe ? "cafe" : "food", name, `${cuisine}. ${desc}`, lat, lng, price, cafe ? 45 : 70,
          cafe ? 7 * 60 : 11 * 60, cafe ? 17 * 60 : 21 * 60 + 30, "Educational demo listing: details are sample values.",
          [...new Set(["food", cafe ? "cafe" : "restaurant", ...cuisine.toLowerCase().split(/[\s&]+/).filter((w) => w.length > 3)])]]);
    }
    // Gallery images per destination from its own attraction photos.
    for (const d of destinations) {
      const has = await tx.query("SELECT 1 FROM destination_images WHERE destination_id=$1", [destId[d.slug]]);
      if (has.rowCount) continue;
      const imgs = (await tx.query<any>(
        "SELECT image, image_credit, name FROM attractions WHERE destination_id=$1 AND image IS NOT NULL ORDER BY name LIMIT 5", [destId[d.slug]])).rows;
      let pos = 0;
      if (destCover[d.slug]) await tx.query("INSERT INTO destination_images(destination_id,url,caption,credit,position) VALUES ($1,$2,$3,$4,$5)", [destId[d.slug], destCover[d.slug], d.name, null, pos++]);
      for (const i of imgs) await tx.query("INSERT INTO destination_images(destination_id,url,caption,credit,position) VALUES ($1,$2,$3,$4,$5)", [destId[d.slug], i.image, i.name, i.image_credit, pos++]);
    }

    // Gallery cleanup: drop flag/map images from older seeds and re-create galleries from landmark photos.
    await tx.query("DELETE FROM destination_images WHERE url ILIKE '%Flag_of%' OR url ILIKE '%Coat_of_arms%'");

    /* ---- accommodations + rooms + amenities */
    const amenityId: Record<string, number> = {};
    for (const r of (await tx.query<any>("SELECT id, code FROM amenities")).rows) amenityId[r.code] = r.id;
    const partnerFor = (dest: string) => (dest === "phnom-penh" ? partnerIds["partner.pp"] : dest === "siem-reap" ? partnerIds["partner.sr"]
      : ["kampot", "kep", "koh-rong", "sihanoukville"].includes(dest) ? partnerIds["partner.coast"] : null);
    const roomIds: string[] = [];
    for (const [dest, name, type, stars, price, fam, bf, cancelH, blurb] of hotels) {
      const slug = slugify(name);
      const d = destinations.find((x) => x.slug === dest)!;
      const jitter = (k: number) => (((Math.abs(slug.split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, k)) % 2000) - 1000) / 1000) * 0.014;
      const policy = cancelH > 0 ? `Free cancellation up to ${cancelH} hours before check-in (14:00). After that the booking is non-refundable.` : "Non-refundable rate: no refund if cancelled.";
      const r = await tx.query<any>(
        `INSERT INTO accommodations(slug,destination_id,partner_id,name,type,stars,description,address,lat,lng,cover_image,image_credit,free_cancel_hours,
            cancellation_policy,breakfast_included,family_friendly,from_price_usd,is_demo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,true) ON CONFLICT (slug) DO NOTHING RETURNING id`,
        [slug, destId[dest], partnerFor(dest), name, type, stars,
          `${blurb} This is an educational demo listing: the property, its prices and its amenities are sample data, not a real commercial offer.`,
          `Sample address, ${d.name}, ${d.country}`, round2(d.lat + jitter(1)), round2((d.lng + jitter(7)) * 1e4) / 1e4, destCover[dest],
          destCover[dest] ? `Illustrative photo of ${d.name} (not this property)` : null, cancelH, policy, !!bf, !!fam, price]);
      if (!r.rows[0]) continue; // already seeded
      const accId = r.rows[0].id as string;
      const am = new Set<string>(["wifi", "ac"]);
      if (stars >= 3) { am.add("restaurant"); am.add("laundry"); }
      if (stars >= 4 || type === "resort") { am.add("pool"); am.add("gym"); am.add("airport-shuttle"); }
      if (stars >= 5) am.add("spa");
      if (stars >= 4) am.add("bar");
      if (fam) { am.add("family-room"); if (stars >= 3) am.add("kids-pool"); }
      if (bf) am.add("breakfast");
      if (type === "apartment") am.add("kitchen");
      if (stars >= 3) am.add("parking");
      if (stars >= 4) am.add("accessible");
      for (const code of am) await tx.query("INSERT INTO accommodation_amenities(accommodation_id, amenity_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [accId, amenityId[code]]);
      const units = stars >= 4 ? 8 : stars === 3 ? 6 : 4;
      const first = (await tx.query<any>(
        `INSERT INTO room_types(accommodation_id,name,description,bed_type,max_adults,max_children,size_sqm,base_price_usd,total_units,breakfast_included)
         VALUES ($1,$2,$3,$4,2,$5,$6,$7,$8,$9) RETURNING id`,
        [accId, type === "hostel" ? "Private Twin Room" : "Standard Room", "Comfortable room with air conditioning and en-suite bathroom.",
          type === "hostel" ? "2 single beds" : "1 queen bed", fam ? 1 : 0, type === "hostel" ? 14 : 22, price, units, !!bf])).rows[0];
      const secondName = fam ? "Family Room" : "Deluxe Room";
      const second = (await tx.query<any>(
        `INSERT INTO room_types(accommodation_id,name,description,bed_type,max_adults,max_children,size_sqm,base_price_usd,total_units,breakfast_included)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [accId, secondName, fam ? "Spacious room with a king bed plus two single beds, suited to families." : "Larger room with a seating area and upgraded amenities.",
          fam ? "1 king + 2 single beds" : "1 king bed", fam ? 2 : 2, fam ? 2 : 1, fam ? 38 : 30, round2(price * 1.55), Math.max(2, Math.floor(units / 2)), !!bf])).rows[0];
      roomIds.push(first.id, second.id);
    }

    // Property photos are illustrative destination photos; vary them per property so listings are not visually identical.
    await tx.query(
      `UPDATE accommodations a
          SET cover_image = (SELECT di.url FROM destination_images di WHERE di.destination_id = a.destination_id ORDER BY md5(di.url || a.slug) LIMIT 1),
              image_credit = 'Illustrative photo of ' || (SELECT d.name FROM destinations d WHERE d.id = a.destination_id) || ' (not this property)'
        WHERE a.is_demo AND EXISTS (SELECT 1 FROM destination_images di WHERE di.destination_id = a.destination_id)`);
    await tx.query(
      `INSERT INTO accommodation_images(accommodation_id, url, caption, position)
       SELECT a.id, di.url, 'Illustrative photo of ' || d.name, (row_number() OVER (PARTITION BY a.id ORDER BY md5(di.url || a.slug)))::int - 1
         FROM accommodations a JOIN destinations d ON d.id = a.destination_id
         JOIN destination_images di ON di.destination_id = a.destination_id
        WHERE a.is_demo AND NOT EXISTS (SELECT 1 FROM accommodation_images x WHERE x.accommodation_id = a.id)`);

    /* ---- inventory: 120 nights from today; demo blackout so the 'no availability' scenario is reproducible */
    await tx.query(
      `INSERT INTO room_inventory(room_type_id, night, units_available, price_usd)
       SELECT rt.id, d::date,
              CASE WHEN a.slug = 'riverside-heritage-hotel' AND d::date BETWEEN $1::date + 30 AND $1::date + 34 THEN 0
                   ELSE GREATEST(0, rt.total_units - (abs(hashtext(rt.id::text || d::text)) % GREATEST(1, rt.total_units / 2 + 1))) END,
              ROUND(rt.base_price_usd * CASE WHEN extract(isodow from d) IN (5,6) THEN 1.15 ELSE 1 END, 2)
         FROM room_types rt JOIN accommodations a ON a.id = rt.accommodation_id,
              generate_series($1::date, $1::date + 119, interval '1 day') d
        WHERE rt.deleted_at IS NULL
       ON CONFLICT (room_type_id, night) DO NOTHING`, [today]);
    log("inventory generated");

    /* ---- documents + chunks */
    for (const doc of documents) {
      const r = await tx.query<any>(
        `INSERT INTO travel_documents(slug,title,destination_id,category,source_label,content) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (slug) DO NOTHING RETURNING id`, [doc.slug, doc.title, doc.dest ? destId[doc.dest] : null, doc.category, doc.source, doc.content]);
      if (!r.rows[0]) continue;
      const chunks = chunkText(doc.content);
      for (let i = 0; i < chunks.length; i++) {
        await tx.query("INSERT INTO document_chunks(document_id, chunk_index, content) VALUES ($1,$2,$3)", [r.rows[0].id, i, `${doc.title}. ${chunks[i]}`]);
      }
    }

    /* ---- reviews (educational demo, never verified stays) */
    const accs = (await tx.query<any>("SELECT id, name FROM accommodations ORDER BY slug")).rows;
    const titles = [["Lovely stay", "Staff were helpful and the room was clean and quiet. Breakfast options were good and the location was convenient for sightseeing."],
      ["Good value", "Comfortable bed, strong air conditioning and fast Wi-Fi. A great base for a few nights; would stay again for the price."],
      ["Nice location", "Easy to walk to cafés and sights. Rooms are simple but well kept, and the front desk helped us arrange transport."],
      ["Relaxing", "A calm place to unwind after busy days of exploring. The pool was lovely in the late afternoon."],
      ["Decent, with small issues", "Overall pleasant, though hot water took a while to warm up. Friendly team who fixed things quickly."],
      ["Family friendly", "Our kids enjoyed the pool and the staff were patient and kind. Room was a good size for four."]];
    let reviewIdx = 0;
    for (const [ai, a] of accs.entries()) {
      const count = ai < 10 ? 4 : 3;
      for (let k = 0; k < count && reviewIdx < 100 + 10; k++) {
        const user = customers[(ai * 3 + k) % customers.length];
        const t = titles[(ai + k) % titles.length];
        const rating = [5, 4, 4, 5, 3, 4, 5][Math.floor(rand() * 7)];
        await tx.query(
          `INSERT INTO reviews(accommodation_id, user_id, rating, title, body, is_demo, created_at)
           VALUES ($1,$2,$3,$4,$5,true, now() - ($6 || ' days')::interval) ON CONFLICT (accommodation_id, user_id) DO NOTHING`,
          [a.id, user, rating, t[0], t[1], String(5 + Math.floor(rand() * 200))]);
        reviewIdx++;
      }
    }
    await tx.query(
      `UPDATE accommodations a SET rating_avg = COALESCE(s.avg,0), review_count = COALESCE(s.cnt,0)
         FROM (SELECT accommodation_id, ROUND(AVG(rating)::numeric,2) AS avg, COUNT(*)::int AS cnt FROM reviews WHERE status='published' GROUP BY accommodation_id) s
        WHERE s.accommodation_id = a.id`);

    /* ---- historical demo bookings, payments, events, notifications */
    const rooms = (await tx.query<any>(
      `SELECT r.id, r.accommodation_id, r.base_price_usd, r.max_adults, a.tax_rate, a.service_fee_rate, a.free_cancel_hours, a.cancellation_policy
         FROM room_types r JOIN accommodations a ON a.id=r.accommodation_id ORDER BY a.slug, r.base_price_usd`)).rows;
    for (let n = 1; n <= 50; n++) {
      const reference = `WF-DEMO-${String(n).padStart(4, "0")}`;
      const exists = await tx.query("SELECT 1 FROM bookings WHERE reference=$1", [reference]);
      if (exists.rowCount) continue;
      const room = rooms[Math.floor(rand() * rooms.length)];
      const user = customers[Math.floor(rand() * customers.length)];
      const offset = -75 + Math.floor(rand() * 135);               // -75 .. +59 days
      const nights = 1 + Math.floor(rand() * 4);
      const ci = addDays(today, offset), co = addDays(ci, nights);
      const roomsN = 1;
      const adults = Math.min(room.max_adults, 1 + Math.floor(rand() * 2));
      const past = co < today;
      const roll = rand();
      let status: string; let payStatus: "SUCCESS" | "FAILED" | "REFUNDED" | null;
      if (past) { if (roll < 0.78) { status = "COMPLETED"; payStatus = "SUCCESS"; } else if (roll < 0.9) { status = "CANCELLED"; payStatus = "SUCCESS"; } else { status = "EXPIRED"; payStatus = "FAILED"; } }
      else { if (roll < 0.62) { status = "CONFIRMED"; payStatus = "SUCCESS"; } else if (roll < 0.82) { status = "REFUNDED"; payStatus = "REFUNDED"; } else if (roll < 0.92) { status = "CANCELLED"; payStatus = "SUCCESS"; } else { status = "EXPIRED"; payStatus = "FAILED"; } }
      if (ci <= today && co > today && status === "CONFIRMED") status = "CHECKED_IN";
      const price = room.base_price_usd;
      const sub = round2(price * nights * roomsN), tax = round2(sub * room.tax_rate), fee = round2(sub * room.service_fee_rate), total = round2(sub + tax + fee);
      const person = people.find((p) => userIds[p[0]] === user)!;
      const created = addDays(ci, -(3 + Math.floor(rand() * 20)));
      const b = (await tx.query<any>(
        `INSERT INTO bookings(reference,user_id,accommodation_id,room_type_id,check_in,check_out,nights,rooms,adults,children,guest_name,guest_email,status,
            subtotal_usd,taxes_usd,fees_usd,total_usd,cancellation_policy,free_cancel_until,is_demo,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$10,$11,$12,$13,$14,$15,$16,$17,$18,true,$19::date,$19::date) RETURNING id`,
        [reference, user, room.accommodation_id, room.id, ci, co, nights, roomsN, adults, person[1], `${person[0]}@demo.wayfarer.test`, status, sub, tax, fee, total,
          room.cancellation_policy, room.free_cancel_hours > 0 ? new Date(Date.parse(ci + "T14:00:00Z") - room.free_cancel_hours * 3_600_000) : null, created])).rows[0];
      for (let i = 0; i < nights; i++) {
        await tx.query("INSERT INTO booking_items(booking_id, night, rate_usd, rooms, released) VALUES ($1,$2,$3,$4,$5)",
          [b.id, addDays(ci, i), price, roomsN, ["CANCELLED", "EXPIRED", "REFUNDED"].includes(status)]);
      }
      // Hold inventory for live future bookings so seeded data stays consistent with availability.
      if (["CONFIRMED", "CHECKED_IN"].includes(status) && co > today) {
        await tx.query(
          "UPDATE room_inventory SET units_available = GREATEST(0, units_available - 1) WHERE room_type_id=$1 AND night >= $2 AND night < $3 AND night >= $4",
          [room.id, ci, co, today]);
      }
      const flow: [string | null, string][] = [[null, "PENDING_CONFIRMATION"]];
      if (status === "EXPIRED") flow.push(["PENDING_CONFIRMATION", "EXPIRED"]);
      else { flow.push(["PENDING_CONFIRMATION", "CONFIRMED"]);
        if (status === "CHECKED_IN") flow.push(["CONFIRMED", "CHECKED_IN"]);
        if (status === "COMPLETED") flow.push(["CONFIRMED", "CHECKED_IN"], ["CHECKED_IN", "COMPLETED"]);
        if (status === "CANCELLED") flow.push(["CONFIRMED", "CANCELLED"]);
        if (status === "REFUNDED") flow.push(["CONFIRMED", "CANCELLED"], ["CANCELLED", "REFUND_PENDING"], ["REFUND_PENDING", "REFUNDED"]); }
      for (const [f, t] of flow) {
        await tx.query("INSERT INTO booking_status_events(booking_id, from_status, to_status, actor_id, note, created_at) VALUES ($1,$2,$3,$4,'Seeded demo history',$5::date)",
          [b.id, f, t, user, created]);
      }
      const pid = (await tx.query<any>(
        `INSERT INTO payments(booking_id,user_id,amount_usd,refunded_usd,status,provider,provider_ref,idempotency_key,simulated,failure_reason,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,'demo-sim',$6,$7,true,$8,$9::date,$9::date) RETURNING id`,
        [b.id, user, total, payStatus === "REFUNDED" ? total : 0, payStatus, `SIM-${reference}`, `seed-${reference}`,
          payStatus === "FAILED" ? "card_declined (simulated)" : null, created])).rows[0].id;
      await tx.query("INSERT INTO payment_events(payment_id, provider_event_id, type, payload, created_at) VALUES ($1,$2,'payment.created','{\"simulated\":true}',$3::date)", [pid, `evt_seed_${reference}_1`, created]);
      await tx.query("INSERT INTO payment_events(payment_id, provider_event_id, type, payload, created_at) VALUES ($1,$2,$3,'{\"simulated\":true}',$4::date)",
        [pid, `evt_seed_${reference}_2`, payStatus === "FAILED" ? "payment.failed" : "payment.succeeded", created]);
      const nt: [string, string, string] = status === "EXPIRED"
        ? ["booking", "Booking expired", `Booking ${reference} expired because payment was not completed.`]
        : status.startsWith("CANCEL") || status === "REFUNDED"
          ? ["booking", "Booking cancelled", `Booking ${reference} was cancelled.`]
          : ["booking", "Booking confirmed", `Booking ${reference} is confirmed (simulated demo payment).`];
      await tx.query("INSERT INTO notifications(user_id,type,title,body,data,read_at,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7::date)",
        [user, nt[0], nt[1], nt[2], JSON.stringify({ bookingId: b.id, demo: true }), rand() < 0.6 ? new Date() : null, created]);
      await tx.query("INSERT INTO notifications(user_id,type,title,body,data,created_at) VALUES ($1,'payment',$2,$3,$4,$5::date)",
        [user, payStatus === "FAILED" ? "Payment failed" : "Payment received", `Simulated payment for ${reference}: ${payStatus}.`, JSON.stringify({ bookingId: b.id, demo: true }), created]);
      await tx.query("INSERT INTO audit_logs(actor_id, action, entity, entity_id, meta, created_at) VALUES ($1,'booking.create','booking',$2,$3,$4::date)",
        [user, b.id, JSON.stringify({ reference, seeded: true }), created]);
    }
    // Welcome notification for every demo user (idempotent).
    for (const id of Object.values(userIds)) {
      await tx.query(
        `INSERT INTO notifications(user_id,type,title,body) SELECT $1,'account','Welcome to WAYFARER','This is a demo account. All data is sample data.'
          WHERE NOT EXISTS (SELECT 1 FROM notifications WHERE user_id=$1 AND type='account')`, [id]);
    }
    await tx.query("INSERT INTO audit_logs(actor_id, action, entity, meta) VALUES ($1,'seed.run','system',$2)", [userIds["admin"], JSON.stringify({ at: new Date().toISOString() })]);

    /* ---- curated itineraries, generated by the real planner */
    const templates: [string, number, string[], number, number, number | null, "relaxed" | "balanced" | "packed", string][] = [
      ["phnom-penh", 3, ["culture", "food", "photography", "relaxed"], 2, 0, 150, "relaxed", "Phnom Penh in 3 days: culture, food and photography"],
      ["phnom-penh", 2, ["history", "culture"], 1, 0, null, "balanced", "Phnom Penh essentials: 2 days"],
      ["phnom-penh", 4, ["food", "markets"], 2, 0, 300, "balanced", "Phnom Penh food and markets"],
      ["phnom-penh", 3, ["family"], 2, 2, null, "relaxed", "Phnom Penh with children"],
      ["siem-reap", 4, ["temples", "culture", "photography"], 2, 0, null, "balanced", "Siem Reap cultural holiday: 4 days"],
      ["siem-reap", 3, ["temples", "relaxed"], 2, 0, 250, "relaxed", "Slow Angkor: 3 days"],
      ["siem-reap", 2, ["temples", "photography"], 1, 0, null, "packed", "Angkor highlights: 2 days"],
      ["siem-reap", 3, ["family", "culture"], 2, 2, null, "relaxed", "Siem Reap family trip"],
      ["kampot", 3, ["relaxed", "nature", "food"], 2, 0, null, "relaxed", "Kampot weekend: riverside and pepper"],
      ["kampot", 2, ["nature", "outdoor"], 2, 0, 120, "balanced", "Kampot 2-day nature escape"],
      ["kep", 2, ["food", "relaxed"], 2, 0, null, "relaxed", "Kep seafood weekend"],
      ["koh-rong", 3, ["beach", "outdoor"], 2, 0, null, "relaxed", "Koh Rong island break"],
      ["battambang", 2, ["culture", "arts"], 2, 0, null, "balanced", "Battambang art and countryside"],
      ["sihanoukville", 2, ["beach", "relaxed"], 2, 0, 140, "relaxed", "Sihanoukville beach stopover"],
      ["kratie", 2, ["nature"], 2, 0, null, "relaxed", "Kratie dolphins and river life"],
      ["mondulkiri", 3, ["nature", "outdoor"], 2, 0, null, "balanced", "Mondulkiri highlands"],
      ["koh-kong", 2, ["nature", "outdoor"], 2, 0, null, "balanced", "Koh Kong mangroves and waterfalls"],
      ["bangkok", 3, ["temples", "food", "markets"], 2, 0, null, "balanced", "Bangkok temples and street food"],
      ["bangkok", 2, ["markets", "food"], 1, 0, 200, "packed", "Bangkok quick bites"],
      ["singapore", 3, ["family", "nature"], 2, 2, null, "relaxed", "Singapore with kids"],
      ["singapore", 2, ["food", "photography"], 2, 0, null, "balanced", "Singapore food and skyline"],
      ["kuala-lumpur", 2, ["food", "culture"], 2, 0, null, "balanced", "Kuala Lumpur long weekend"],
      ["ho-chi-minh-city", 3, ["history", "food"], 2, 0, null, "balanced", "Ho Chi Minh City history and food"],
      ["hanoi", 3, ["culture", "food", "relaxed"], 2, 0, null, "relaxed", "Hanoi old quarter and lakes"],
      ["bali", 4, ["nature", "culture", "relaxed"], 2, 0, null, "relaxed", "Ubud nature and culture"],
      ["tokyo", 3, ["culture", "photography"], 2, 0, null, "balanced", "Tokyo shrines and crossings"],
      ["seoul", 3, ["culture", "food"], 2, 0, null, "balanced", "Seoul palaces and street food"],
      ["luang-prabang", 3, ["temples", "relaxed", "nature"], 2, 0, null, "relaxed", "Luang Prabang slow travel"],
      ["chiang-mai", 3, ["temples", "culture", "nature"], 2, 0, null, "balanced", "Chiang Mai temples and mountains"],
      ["phnom-penh", 1, ["photography"], 1, 0, 60, "packed", "Phnom Penh in a day: photographer's route"],
    ];
    for (const [dest, days, interests, adults, children, budget, pace, title] of templates) {
      const ex = await tx.query("SELECT 1 FROM itineraries WHERE is_template AND title=$1", [title]);
      if (ex.rowCount) continue;
      const req: PlanRequest = { destination: dest, days, adults, children, budgetUsd: budget, budgetIsPerDay: false, interests, pace };
      const plan = await generatePlan(tx, req);
      plan.title = title;
      await savePlan(tx, null, plan, req, null, { template: true });
    }
    // A few saved trips for demo customers so the account area is populated.
    for (const [handle, dest, days, interests, title] of [
      ["maya", "phnom-penh", 3, ["culture", "food", "photography"], "My Phnom Penh trip"],
      ["liam", "siem-reap", 3, ["temples", "photography"], "Angkor with Liam"],
      ["sophea", "kampot", 2, ["relaxed", "nature"], "Kampot weekend away"],
    ] as const) {
      const ex = await tx.query("SELECT 1 FROM itineraries WHERE user_id=$1 AND title=$2", [userIds[handle], title]);
      if (ex.rowCount) continue;
      const req: PlanRequest = { destination: dest, days, adults: 2, children: 0, budgetUsd: null, budgetIsPerDay: false, interests: [...interests], pace: "balanced" };
      const plan = await generatePlan(tx, req);
      plan.title = title;
      await savePlan(tx, userIds[handle], plan, req, addDays(today, 21));
    }
    // Wishlists
    for (const [handle, slug] of [["maya", "kampot"], ["maya", "siem-reap"], ["liam", "phnom-penh"], ["sophea", "koh-rong"]] as const) {
      await tx.query("INSERT INTO wishlist_items(user_id, kind, ref_id) VALUES ($1,'destination',$2) ON CONFLICT DO NOTHING", [userIds[handle], destId[slug]]);
    }
  });

  const c = async (t: string, w = "") => Number((await db.query<any>(`SELECT COUNT(*)::int AS n FROM ${t} ${w}`)).rows[0].n);
  return {
    destinations: await c("destinations"), accommodations: await c("accommodations"), room_types: await c("room_types"),
    room_inventory: await c("room_inventory"), attractions_and_activities: await c("attractions", "WHERE kind <> 'restaurant'"),
    restaurants: await c("attractions", "WHERE kind = 'restaurant'"), itineraries: await c("itineraries", "WHERE is_template"),
    reviews: await c("reviews"), travel_documents: await c("travel_documents"), users: await c("users"), bookings: await c("bookings"),
    payments: await c("payments"), payment_events: await c("payment_events"), notifications: await c("notifications"),
    audit_logs: await c("audit_logs"), partners: await c("partners"),
  };
}

if (process.argv[1]?.endsWith("seed.ts")) {
  const db = await getDb();
  const t0 = Date.now();
  const summary = await runSeed(db, { log: console.log });
  console.log(`Seed finished in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.table(summary);
  await db.close();
}
