// Post-seed image pipeline (run after `npm run seed` on a persistent database):
//   1. drops non-free en.wikipedia local files, 2. fills places that have no photo with a relevant Commons photo,
//   3. removes duplicate hotel covers, 4. mirrors every photo to app/web/img (resized) and rewrites DB URLs,
// so visitors never depend on hotlinking Wikimedia (which rate-limits with HTTP 429).
// Usage: npx tsx src/seed/finalize-images.ts   (env: DATABASE_URL, IMG_BASE)
import "dotenv/config";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import sharp from "sharp";

const IMG_BASE = process.env.IMG_BASE ?? "https://wayfarer-web-red.vercel.app/img";
const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "app", "web", "img");
mkdirSync(outDir, { recursive: true });
const UA = "WayfarerCapstone/1.0 (educational demo; image mirroring)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fileKey = (u: string) => decodeURIComponent(u.split("?")[0].split("/").filter(Boolean).slice(-2).join("/")).replace(/\/\d+px-/, "/").toLowerCase();
const isMirrored = (u: string) => u.startsWith(IMG_BASE);

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const q = async <T = any>(s: string, p: unknown[] = []) => (await c.query(s, p)).rows as T[];

/* ---- 1. non-free local files */
const enLocal = "%/wikipedia/en/%";
await q("UPDATE attractions SET image=NULL, image_credit=NULL WHERE image LIKE $1", [enLocal]);
await q("DELETE FROM destination_images WHERE url LIKE $1", [enLocal]);
await q("UPDATE accommodation_images SET url=url WHERE false");
await q(`UPDATE destinations d SET cover_image=(SELECT url FROM destination_images i WHERE i.destination_id=d.id ORDER BY position LIMIT 1), image_credit=(SELECT credit FROM destination_images i WHERE i.destination_id=d.id ORDER BY position LIMIT 1)
          WHERE cover_image LIKE $1`, [enLocal]);

/* ---- 2. fill gaps with relevant, distinct Commons photos (labelled illustrative) */
const BAD = /flag|map\b|logo|coat[_ ]of|locator|diagram|chart|icon|svg|seal|emblem|stamp|poster|banner|screenshot|\.pdf|\.tif/i;
const GOOD = /^(CC[ -]BY|CC0|Public domain|PD|Attribution|GFDL|FAL)/i;
async function search(term: string): Promise<{ url: string; page: string; title: string; credit: string; hay: string }[]> {
  const u = new URL("https://commons.wikimedia.org/w/api.php");
  u.search = new URLSearchParams({ action: "query", format: "json", generator: "search", gsrnamespace: "6", gsrsearch: `${term} filetype:bitmap`, gsrlimit: "15",
    prop: "imageinfo", iiprop: "url|extmetadata|size|mime", iiurlwidth: "960", origin: "*" }).toString();
  for (let a = 0; a < 5; a++) {
    const r = await fetch(u, { headers: { "User-Agent": UA } });
    if (r.status === 429) { await sleep(3000 * (a + 1)); continue; }
    if (!r.ok) return [];
    const j: any = await r.json();
    const out: any[] = [];
    for (const p of Object.values(j.query?.pages ?? {}) as any[]) {
      const ii = p.imageinfo?.[0];
      if (!ii?.thumburl || ii.mime !== "image/jpeg" || ii.width < 1000 || ii.height < 600 || BAD.test(p.title)) continue;
      const md = ii.extmetadata ?? {};
      const lic = String(md.LicenseShortName?.value ?? "");
      if (!GOOD.test(lic)) continue;
      const hay = `${p.title} ${String(md.ImageDescription?.value ?? "").replace(/<[^>]+>/g, " ")} ${String(md.Categories?.value ?? "")}`.toLowerCase();
      if (/bikini|nude|topless|erotic|naked|sexy/.test(hay)) continue;
      const artist = String(md.Artist?.value ?? "Unknown author").replace(/<[^>]+>/g, "").trim().slice(0, 60);
      out.push({ url: ii.thumburl, page: `https://commons.wikimedia.org/wiki/${encodeURIComponent(String(p.title).replace(/ /g, "_"))}`,
        title: String(p.title), credit: `${artist}, ${lic} via Wikimedia Commons`, hay });
    }
    return out;
  }
  return [];
}

const taken = new Set<string>();
for (const r of await q("SELECT image u FROM attractions WHERE image IS NOT NULL UNION SELECT cover_image FROM accommodations WHERE cover_image IS NOT NULL UNION SELECT cover_image FROM destinations WHERE cover_image IS NOT NULL UNION SELECT url FROM destination_images UNION SELECT url FROM accommodation_images")) taken.add(fileKey(r.u));

// Photos judged unsuitable in review (wrong subject); they are cleared and re-filled strictly or left as a clean placeholder.
const REJECT = ["Phare Ponleu Selpak Circus Evening", "Art Lane Kitchen", "Teuk Chhou Rapids", "Phnom Chhngok Cave Temple", "Sunset River Cruise", "Tatai Waterfall",
  "Jungle Smoothie Hut", "Brickfields Banana Leaf", "Chow Kit Nasi Kandar", "Russian Market (Toul Tom Poung)", "Independence Monument", "Cyclo Heritage Tour",
  "Khmer Cooking Class", "Wat Bo Vegan Garden", "Otres Seafood Shack", "Independence Bakery", "Wat Banan", "Pepper Terrace Cafe", "N Seoul Tower", "Rooftop Pepper Bar"];
await q("UPDATE attractions SET image=NULL, image_credit=NULL WHERE name = ANY($1::text[])", [REJECT]);

const STOPW = new Set(["the", "and", "national", "park", "market", "museum", "temple", "tour", "evening", "river", "cruise", "beach", "island", "night", "city", "center", "centre", "house", "street", "view", "garden", "walking", "heritage", "class", "cooking", "boat", "bicycle", "countryside", "sunset", "sunrise", "cafe", "kitchen", "shack", "bakery", "grill", "counter", "stall"]);
const gaps = await q<any>(`SELECT t.id, t.name, t.category, t.kind, d.name AS dest, d.country FROM attractions t JOIN destinations d ON d.id=t.destination_id WHERE t.image IS NULL ORDER BY d.name`);
console.log("places without photo:", gaps.length);
for (const g of gaps) {
  const dn = g.dest.replace(/ \(.*\)/, "");
  const clean = g.name.replace(/\(.*?\)/g, "").trim();
  const toks = clean.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((t: string) => t.length > 3 && !STOPW.has(t));
  let done = false;
  if (g.kind !== "restaurant" && toks.length) {
    for (const t of [`${clean} ${dn}`, clean]) {
      const hits = await search(t);
      await sleep(200);
      const h = hits.find((x) => !taken.has(fileKey(x.url)) && toks.every((k: string) => x.hay.includes(k)) && (x.hay.includes(dn.toLowerCase()) || x.hay.includes(g.country.toLowerCase()) || toks.length >= 2));
      if (h) {
        taken.add(fileKey(h.url));
        await q("UPDATE attractions SET image=$2, image_credit=$3 WHERE id=$1", [g.id, h.url, `Photo: ${h.credit} - ${h.page}`]);
        console.log("filled", g.name, "<-", h.title.slice(0, 60));
        done = true;
        break;
      }
    }
  }
  if (!done) console.log("placeholder kept:", g.name);
}

/* ---- 3. hotel covers: unique, and never equal to a place photo */
const placeKeys = new Set((await q<any>("SELECT image u FROM attractions WHERE image IS NOT NULL")).map((r) => fileKey(r.u)));
const hotels = await q<any>("SELECT id, name, slug, destination_id, cover_image FROM accommodations ORDER BY slug");
const usedCovers = new Set<string>();
for (const h of hotels) {
  const k = h.cover_image ? fileKey(h.cover_image) : null;
  if (k && !usedCovers.has(k) && !placeKeys.has(k)) { usedCovers.add(k); continue; }
  const pool = await q<any>("SELECT url, credit FROM destination_images WHERE destination_id=$1 ORDER BY position DESC", [h.destination_id]);
  const pick = pool.find((p) => !usedCovers.has(fileKey(p.url)) && !placeKeys.has(fileKey(p.url)));
  if (pick) {
    usedCovers.add(fileKey(pick.url));
    await q("UPDATE accommodations SET cover_image=$2, image_credit=$3 WHERE id=$1", [h.id, pick.url, `Illustrative photo of the destination, not this property.${pick.credit ? " " + pick.credit : ""}`]);
    console.log("re-covered hotel", h.name);
  } else console.log("could not de-duplicate hotel cover:", h.name);
}
await q("DELETE FROM accommodation_images");
await q(`INSERT INTO accommodation_images(accommodation_id, url, caption, position)
         SELECT a.id, x.url, 'Illustrative photo of ' || d.name, (row_number() OVER (PARTITION BY a.id ORDER BY x.ord))::int - 1
           FROM accommodations a JOIN destinations d ON d.id=a.destination_id
           JOIN LATERAL (SELECT a.cover_image AS url, 0 AS ord WHERE a.cover_image IS NOT NULL
                         UNION ALL (SELECT di.url, 1 + di.position FROM destination_images di
                                     WHERE di.destination_id=a.destination_id AND di.url IS DISTINCT FROM a.cover_image
                                       AND di.url NOT IN (SELECT cover_image FROM accommodations WHERE cover_image IS NOT NULL)
                                       AND di.url NOT IN (SELECT image FROM attractions WHERE image IS NOT NULL)
                                     ORDER BY md5(di.url || a.slug) LIMIT 3)) x ON true`);

/* ---- 4. mirror to our own static hosting */
const urls = (await q<any>(`SELECT u FROM (SELECT cover_image u FROM destinations UNION SELECT image FROM attractions UNION SELECT cover_image FROM accommodations
                              UNION SELECT url FROM destination_images UNION SELECT url FROM accommodation_images) x WHERE u IS NOT NULL`)).map((r) => r.u as string).filter((u) => !isMirrored(u));
console.log("photos to mirror:", urls.length);
const map = new Map<string, string>();
let next = 0, failed = 0;
async function worker() {
  while (next < urls.length) {
    const u = urls[next++];
    const name = createHash("sha1").update(u).digest("hex").slice(0, 16) + ".jpg";
    const file = join(outDir, name);
    if (!existsSync(file)) {
      let ok = false;
      for (let a = 0; a < 8 && !ok; a++) {
        try {
          const r = await fetch(u, { headers: { "User-Agent": UA } });
          if (r.status === 429) { await sleep(4000 * (a + 1)); continue; }
          if (!r.ok) throw new Error(String(r.status));
          const buf = Buffer.from(await r.arrayBuffer());
          const out = await sharp(buf).rotate().resize({ width: 900, withoutEnlargement: true }).jpeg({ quality: 76, mozjpeg: true }).toBuffer();
          writeFileSync(file, out);
          ok = true;
        } catch (e) { await sleep(1500); }
      }
      if (!ok) { failed++; console.log("FAILED", u.slice(0, 100)); continue; }
      await sleep(150);
    }
    map.set(u, `${IMG_BASE}/${name}`);
  }
}
await Promise.all(Array.from({ length: 3 }, worker));
console.log(`mirrored ${map.size}, failed ${failed}`);

const olds = [...map.keys()], news = olds.map((o) => map.get(o)!);
for (const [t, col] of [["destinations", "cover_image"], ["attractions", "image"], ["accommodations", "cover_image"], ["destination_images", "url"], ["accommodation_images", "url"]] as const) {
  const r = await c.query(`UPDATE ${t} x SET ${col}=m.n FROM (SELECT unnest($1::text[]) o, unnest($2::text[]) n) m WHERE x.${col}=m.o`, [olds, news]);
  console.log("rewrote", t, r.rowCount);
}
const referenced = new Set((await q<any>(`SELECT u FROM (SELECT cover_image u FROM destinations UNION SELECT image FROM attractions UNION SELECT cover_image FROM accommodations
   UNION SELECT url FROM destination_images UNION SELECT url FROM accommodation_images) x WHERE u LIKE $1`, [IMG_BASE + "%"])).map((r) => r.u.split("/").pop()));
const { readdirSync, unlinkSync } = await import("node:fs");
let removed = 0;
for (const f of readdirSync(outDir)) if (f.endsWith(".jpg") && !referenced.has(f)) { unlinkSync(join(outDir, f)); removed++; }
console.log("referenced photos:", referenced.size, "| orphan files removed:", removed);
await c.end();
