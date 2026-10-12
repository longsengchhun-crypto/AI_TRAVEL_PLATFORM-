import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getDb, type Db } from "./index.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");

export async function migrate(db: Db): Promise<string[]> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Set((await db.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
  const applied: string[] = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(f)) continue;
    await db.tx(async (t) => {
      await t.exec(readFileSync(join(dir, f), "utf8"));
      await t.query("INSERT INTO schema_migrations(name) VALUES ($1)", [f]);
    });
    applied.push(f);
  }
  return applied;
}

if (process.argv[1] && process.argv[1].endsWith("migrate.ts")) {
  const db = await getDb();
  const a = await migrate(db);
  console.log(a.length ? `Applied: ${a.join(", ")}` : "Database is up to date.");
  await db.close();
}
