// One-off harvester: finds a distinct, openly licensed Wikimedia Commons photo for every place, restaurant,
// destination gallery slot and hotel. Output: src/seed/images2.json. Run: npx tsx src/seed/harvest-images.ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { attractions, destinations, hotels, restaurants } from "./data.js";
import { slugify } from "../util.js";

interface Img { url: string; page: string; title: string; credit: string; hay?: string }
const outFile = new URL("./images2.json", import.meta.url);
const out: { attractions: Record<string, Img>; destinations: Record<string, Img[]>; restaurants: Record<string, Img>; hotels: Record<string, Img> } =
  existsSync(outFile) ? JSON.parse(readFileSync(outFile, "utf8")) : { attractions: {}, destinations: {}, restaurants: {}, hotels: {} };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const BAD = /flag|map\b|logo|coat[_ ]of|locator|diagram|chart|icon|svg|seal|emblem|stamp|poster|banner|screenshot|plan\b|\.pdf|\.tif/i;
const GOOD_LICENSE = /^(CC[ -]BY|CC0|Public domain|PD|Attribution|GFDL|FAL|Copyrighted free use)/i;
const used = new Set<string>();

async function search(q: string, limit = 12): Promise<Img[]> {
  const u = new URL("https://commons.wikimedia.org/w/api.php");
  u.search = new URLSearchParams({
    action: "query", format: "json", generator: "search", gsrnamespace: "6", gsrsearch: `${q} filetype:bitmap`, gsrlimit: String(limit),
    prop: "imageinfo", iiprop: "url|extmetadata|size|mime", iiurlwidth: "960", origin: "*",
  }).toString();
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(u, { headers: { "User-Agent": "WayfarerCapstone/1.0 (educational demo; image harvest)" } });
    if (r.status === 429) { await sleep(3000 * (attempt + 1)); continue; }
    if (!r.ok) return [];
    const j: any = await r.json();
    const pages = Object.values(j.query?.pages ?? {}) as any[];
    pages.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const res: Img[] = [];
    for (const p of pages) {
      const ii = p.imageinfo?.[0];
      if (!ii || !ii.thumburl) continue;
      if (ii.mime !== "image/jpeg") continue;
      if (ii.width < 1000 || ii.height < 600 || ii.width / ii.height < 1.1 || ii.width / ii.height > 2.4) continue;
      if (BAD.test(p.title)) continue;
      const md = ii.extmetadata ?? {};
      const lic = String(md.LicenseShortName?.value ?? "");
      if (!GOOD_LICENSE.test(lic)) continue;
      const artist = String(md.Artist?.value ?? "Unknown author").replace(/<[^>]+>/g, "").trim().slice(0, 60);
      const hay = `${p.title} ${String(md.ImageDescription?.value ?? "").replace(/<[^>]+>/g, " ")} ${String(md.Categories?.value ?? "")}`.toLowerCase();
      if (/bikini|nude|topless|erotic|naked|sexy/.test(hay)) continue;
      res.push({
        hay,
        url: ii.thumburl as string,
        page: `https://commons.wikimedia.org/wiki/${encodeURIComponent(String(p.title).replace(/ /g, "_"))}`,
        title: String(p.title).replace(/^File:/, ""),
        credit: `${artist}, ${lic} via Wikimedia Commons`,
      });
    }
    return res;
  }
  return [];
}

const strip = (i: Img): Img => ({ url: i.url, page: i.page, title: i.title, credit: i.credit });
const STOPW = new Set(["the", "and", "of", "national", "park", "market", "museum", "temple", "tour", "trip", "evening", "river", "cruise", "beach", "island", "night", "city", "wat", "old", "center", "centre", "house", "street", "view", "garden", "gardens", "food", "walking", "heritage", "class", "cooking", "boat", "bicycle", "countryside", "sunset", "sunrise"]);

/** An image is relevant when its title/description/categories mention the destination (or country)
 *  and, for named places, a distinctive token of the place name. */
function relevant(i: Img, dest: string, country: string, name: string | null): boolean {
  const hay = i.hay ?? i.title.toLowerCase();
  const destOk = hay.includes(dest.toLowerCase()) || hay.includes(country.toLowerCase());
  if (name === null) return destOk;
  const toks = name.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((t) => t.length > 3 && !STOPW.has(t));
  if (toks.length === 0) return true;
  const some = toks.some((t) => hay.includes(t));
  const all = toks.every((t) => hay.includes(t));
  return (destOk && some) || (all && (toks.length >= 2 || toks[0].length >= 5));
}

async function firstUnused(queries: string[], ok: (i: Img) => boolean): Promise<Img | undefined> {
  for (const q of queries) {
    const res = await search(q);
    await sleep(120);
    const hit = res.find((i) => !used.has(i.url) && ok(i));
    if (hit) { used.add(hit.url); return strip(hit); }
  }
  return undefined;
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let k = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (k < items.length) await fn(items[k++]); }));
}

const destName = new Map(destinations.map((d) => [d.slug, d.name.replace(/ \(.*\)/, "")]));
// Pre-register already-assigned URLs so re-runs stay unique.
for (const v of Object.values(out.attractions)) used.add(v.url);
for (const v of Object.values(out.restaurants)) used.add(v.url);
for (const v of Object.values(out.hotels)) used.add(v.url);
for (const arr of Object.values(out.destinations)) arr.forEach((i) => used.add(i.url));
const save = () => writeFileSync(outFile, JSON.stringify(out, null, 1));

// 1) Destination galleries (cover + 6 more, all different)
for (const d of destinations) {
  const n = destName.get(d.slug)!;
  const have = out.destinations[d.slug] ?? [];
  if (have.length >= 7) continue;
  const qs = [`${n} ${d.country}`, `${n} skyline`, `${n} street`, `${n} market`, `${n} river`, `${n} temple`, `${n} landscape`, `${n} city`, `${n} old town`, `${n} sunset`];
  const got = [...have];
  for (const q of qs) {
    if (got.length >= 7) break;
    const res = await search(q);
    await sleep(120);
    for (const i of res) {
      if (got.length >= 7) break;
      if (!used.has(i.url) && relevant(i, n, d.country, null)) { used.add(i.url); got.push(strip(i)); }
    }
  }
  out.destinations[d.slug] = got;
  console.log("gallery", d.slug, got.length);
  save();
}

// 2) Attractions and activities
const demoActivity = (desc: string) => desc.startsWith("Educational demo listing");
await pool(attractions, 4, async (a) => {
  const [dest, , cat, name, , , , , , , , , desc] = a;
  const slug = slugify(`${dest}-${name}`);
  if (out.attractions[slug]) return;
  const n = destName.get(dest)!;
  const country = destinations.find((d) => d.slug === dest)!.country;
  const clean = name.replace(/\(.*?\)/g, "").trim();
  const strict = demoActivity(desc) ? null : clean;
  let hit = await firstUnused([`${clean} ${n}`, clean], (im) => relevant(im, n, country, strict));
  if (!hit) hit = await firstUnused([`${n} ${cat}`, `${n} ${country}`, `${n} ${clean.split(" ")[0]}`], (im) => relevant(im, n, country, null));
  if (hit) out.attractions[slug] = hit; else console.log("NO IMAGE", slug);
  save();
});

// 3) Restaurants: illustrative food/cafe photos of the destination (listings are fictional)
await pool(restaurants, 4, async ([dest, name, cuisine]) => {
  const slug = slugify(`${dest}-${name}`);
  if (out.restaurants[slug]) return;
  const n = destName.get(dest)!;
  const country = destinations.find((d) => d.slug === dest)!.country;
  const cafe = /cafe|bakery|coffee/i.test(cuisine);
  const hit = await firstUnused(
    cafe ? [`${n} cafe`, `${n} coffee`, `${country} cafe`] : [`${n} ${cuisine} food`, `${n} street food`, `${n} restaurant`, `${country} ${cuisine} dish`, `${country} food`],
    (im) => relevant(im, n, country, null));
  if (hit) out.restaurants[slug] = hit; else console.log("NO IMAGE restaurant", slug);
  save();
});

// 4) Hotels: illustrative photo of the destination, unique per property
await pool(hotels, 4, async ([dest, name, type]) => {
  const slug = slugify(name);
  if (out.hotels[slug]) return;
  const n = destName.get(dest)!;
  const country = destinations.find((d) => d.slug === dest)!.country;
  const hit = await firstUnused([`${n} ${type}`, `${n} hotel`, `${n} guesthouse`, `${n} resort`, `${n} accommodation`, `${n} street`, `${n} building`], (im) => relevant(im, n, country, null));
  if (hit) out.hotels[slug] = hit; else console.log("NO IMAGE hotel", slug);
  save();
});
save();
console.log(`attractions ${Object.keys(out.attractions).length}/${attractions.length}, restaurants ${Object.keys(out.restaurants).length}/${restaurants.length}, hotels ${Object.keys(out.hotels).length}/${hotels.length}`);
