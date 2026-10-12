import cors from "cors";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import swaggerUi from "swagger-ui-express";
import { optionalAuth } from "./auth.js";
import { config } from "./config.js";
import type { Db } from "./db/index.js";
import { errorMiddleware } from "./http.js";
import { openapi } from "./openapi.js";
import { accountRoutes } from "./routes/account.js";
import { adminRoutes } from "./routes/admin.js";
import { aiRoutes } from "./routes/ai.js";
import { bookingRoutes } from "./routes/bookings.js";
import { publicRoutes } from "./routes/public.js";

export function createApp(db: Db | (() => Promise<Db>)) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  const origins = config.corsOrigins;
  app.use(cors({
    origin: origins.includes("*") ? true : origins,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Wayfarer-Signature"],
    maxAge: 600,
  }));
  app.use(express.json({
    limit: "100kb",
    verify: (req, _res, buf) => { (req as any).rawBody = buf; },
  }));
  app.use(rateLimit({
    windowMs: 60_000, limit: config.isProd ? 300 : 5000, standardHeaders: true, legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many requests" } }),
  }));

  // Resolve the DB lazily so serverless cold starts connect on first request.
  app.use(async (req, _res, next) => {
    try { req.db = typeof db === "function" ? await db() : db; next(); } catch (e) { next(e); }
  });

  app.get("/api/health", async (req, res) => {
    try {
      await req.db.query("SELECT 1");
      res.json({ status: "ok", database: req.db.kind, paymentMode: config.paymentMode, time: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: "degraded", database: "unreachable" });
    }
  });
  app.get("/api/openapi.json", (_req, res) => res.json(openapi));
  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: "WAYFARER API" }));

  app.use("/api", optionalAuth);
  app.use("/api", publicRoutes);
  app.use("/api", accountRoutes);
  app.use("/api", bookingRoutes);
  app.use("/api", aiRoutes);
  app.use("/api", adminRoutes);

  app.use("/api", (_req, res) => res.status(404).json({ error: { code: "NOT_FOUND", message: "Unknown endpoint" } }));
  app.use(errorMiddleware);
  return app;
}
