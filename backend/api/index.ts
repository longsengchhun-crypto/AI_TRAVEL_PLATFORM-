import { createApp } from "../src/app.js";
import { assertProdConfig } from "../src/config.js";
import { getDb } from "../src/db/index.js";

assertProdConfig();
// Vercel invokes this Express app per request; the DB pool is created lazily on first use and reused while warm.
export default createApp(() => getDb());
