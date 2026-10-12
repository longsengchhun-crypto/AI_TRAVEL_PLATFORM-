import "dotenv/config";

const isProd = process.env.NODE_ENV === "production";

export const config = {
  isProd,
  port: Number(process.env.PORT ?? 8080),
  databaseUrl: process.env.DATABASE_URL ?? "",
  // Dev/test fall back to an in-process PGlite database (real Postgres engine) when DATABASE_URL is unset.
  pglitePath: process.env.PGLITE_PATH ?? "memory://",
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET ?? (isProd ? "" : "dev-only-access-secret-change-me"),
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET ?? (isProd ? "" : "dev-only-refresh-secret-change-me"),
  accessTtlSec: 15 * 60,
  refreshTtlSec: 30 * 24 * 3600,
  corsOrigins: (process.env.CORS_ORIGINS ?? "*").split(",").map((s) => s.trim()),
  aiApiKey: process.env.AI_PROVIDER_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? "",
  aiModel: process.env.AI_MODEL ?? "claude-sonnet-5-5",
  paymentMode: process.env.PAYMENT_PROVIDER_MODE ?? "mock",
  webhookSecret: process.env.PAYMENT_WEBHOOK_SECRET ?? "dev-webhook-secret",
  holdMinutes: Number(process.env.BOOKING_HOLD_MINUTES ?? 30),
  demoPassword: process.env.DEMO_PASSWORD ?? "Wayfarer#Demo2026",
};

export function assertProdConfig() {
  if (config.isProd) {
    for (const k of ["jwtAccessSecret", "jwtRefreshSecret", "databaseUrl"] as const) {
      if (!config[k]) throw new Error(`Missing required production configuration: ${k}`);
    }
  }
}
