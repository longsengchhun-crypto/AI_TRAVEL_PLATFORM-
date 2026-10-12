import { createApp } from "./app.js";
import { assertProdConfig, config } from "./config.js";
import { getDb } from "./db/index.js";
import { migrate } from "./db/migrate.js";

assertProdConfig();
const db = await getDb();
// Local/dev convenience only: in-process PGlite starts empty, so apply migrations automatically.
if (db.kind === "pglite") {
  const applied = await migrate(db);
  if (applied.length) console.log(`Applied migrations: ${applied.join(", ")}. Run "npm run seed" against a persistent DB for demo data.`);
}
createApp(db).listen(config.port, () => console.log(`WAYFARER API listening on :${config.port} (db: ${db.kind})`));
