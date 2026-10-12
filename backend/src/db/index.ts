import pg from "pg";
import type { PGlite } from "@electric-sql/pglite";
import { config } from "../config.js";

export interface QueryResult<T> { rows: T[]; rowCount: number }
export interface Db {
  query<T = any>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  tx<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
  kind: "neon-pg" | "pglite";
}

// Return DATE as 'YYYY-MM-DD' strings, NUMERIC and BIGINT as numbers.
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(1700, (v) => parseFloat(v));
pg.types.setTypeParser(20, (v) => parseInt(v, 10));

function fromClient(c: pg.PoolClient | pg.Pool, owner?: pg.PoolClient): Db {
  const db: Db = {
    kind: "neon-pg",
    async query(sql, params) {
      const r = await c.query(sql, params as any[]);
      return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length };
    },
    async exec(sql) { await c.query(sql); },
    async tx(fn) {
      if (owner) return fn(db); // already inside a transaction
      const client = await (c as pg.Pool).connect();
      try {
        await client.query("BEGIN");
        const r = await fn(fromClient(client, client));
        await client.query("COMMIT");
        return r;
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    async close() { if (!owner) await (c as pg.Pool).end(); },
  };
  return db;
}

function fromPglite(p: PGlite, inTx = false): Db {
  const db: Db = {
    kind: "pglite",
    async query(sql, params) {
      const r = await p.query(sql, params as any[]);
      return { rows: r.rows as any[], rowCount: r.rows.length > 0 ? r.rows.length : (r.affectedRows ?? 0) };
    },
    async exec(sql) { await p.exec(sql); },
    async tx(fn) {
      if (inTx) return fn(db);
      return p.transaction(async (t) => {
        const wrapped: Db = {
          kind: "pglite",
          async query(sql, params) {
            const r = await t.query(sql, params as any[]);
            return { rows: r.rows as any[], rowCount: r.rows.length > 0 ? r.rows.length : (r.affectedRows ?? 0) };
          },
          exec: async (sql) => { await t.exec(sql); },
          tx: async (f) => f(wrapped),
          close: async () => {},
        };
        return fn(wrapped);
      });
    },
    async close() { await p.close(); },
  };
  return db;
}

let shared: Db | undefined;

export async function createDb(): Promise<Db> {
  if (config.databaseUrl) {
    const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 5, idleTimeoutMillis: 10_000 });
    return fromClient(pool);
  }
  // Imported lazily so serverless deployments (which always use DATABASE_URL) never load the WASM engine.
  const { PGlite } = await import("@electric-sql/pglite");
  const p = new PGlite(config.pglitePath, {
    parsers: { 1082: (v: string) => v, 1700: (v: string) => parseFloat(v), 20: (v: string) => parseInt(v, 10) },
  });
  await p.waitReady;
  return fromPglite(p);
}

export async function getDb(): Promise<Db> {
  shared ??= await createDb();
  return shared;
}
