// One-off helper: resolves a lead image for each Wikipedia title referenced in seed data.
// Output: src/seed/images.json  { [wikiTitle]: { url, page } }  (license: see the Wikipedia/Commons file page)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { destinations, attractions } from "./data.js";

const file = new URL("./images.json", import.meta.url);
const out: Record<string, { url: string; page: string }> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const titles = new Set<string>();
destinations.forEach((d) => titles.add(d.wiki));
attractions.forEach((a) => a[11] && titles.add(a[11]));

const miss: string[] = [];
for (const t of [...titles].filter((t) => !out[t])) {
  let err = "unknown";
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t)}?redirect=true`, {
      headers: { "User-Agent": "WayfarerCapstone/1.0 (educational demo project)" },
    });
    if (r.status === 429) { err = "429"; await sleep(3000 * (attempt + 1)); continue; }
    if (!r.ok) { err = String(r.status); break; }
    const j: any = await r.json();
    const src: string | undefined = j.thumbnail?.source ?? j.originalimage?.source;
    if (!src) { err = "no-image"; break; }
    out[t] = { url: src.replace(/\/(\d+)px-/, "/960px-"), page: j.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${t}` };
    err = ""; break;
  }
  if (err) miss.push(`${t}(${err})`);
  await sleep(400);
}
writeFileSync(file, JSON.stringify(out, null, 1));
console.log(`resolved ${Object.keys(out).length}/${titles.size}; missing: ${miss.join(", ") || "none"}`);
