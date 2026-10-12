// Creates 480px thumbnails (app/web/img/t/*.jpg) next to the 900px mirrored photos. Safe to re-run.
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "app", "web", "img");
const tdir = join(dir, "t");
mkdirSync(tdir, { recursive: true });
let n = 0;
for (const f of readdirSync(dir)) {
  if (!f.endsWith(".jpg")) continue;
  const out = join(tdir, f);
  if (existsSync(out)) continue;
  await sharp(join(dir, f)).resize({ width: 480, withoutEnlargement: true }).jpeg({ quality: 72, mozjpeg: true }).toFile(out);
  n++;
}
console.log(`thumbnails created: ${n}`);
