import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 120_000,
    env: { DATABASE_URL: "", NODE_ENV: "test", PAYMENT_PROVIDER_MODE: "mock", AI_PROVIDER_API_KEY: "", ANTHROPIC_API_KEY: "", PRIVILEGED_DEMO_PASSWORD: "", DEMO_PASSWORD: "Wayfarer#Demo2026", JWT_ACCESS_SECRET: "test-access-secret", JWT_REFRESH_SECRET: "test-refresh-secret", PAYMENT_WEBHOOK_SECRET: "dev-webhook-secret" },
    fileParallelism: false,
  },
});
