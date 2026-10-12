import { Router } from "express";
import { randomBytes } from "node:crypto";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { hashPassword, hashToken, issueTokens, requireAuth, revokeRefresh, rotateRefresh, verifyPassword } from "../auth.js";
import { config } from "../config.js";
import { ApiError, h, notFound, parse } from "../http.js";
import { audit, notify } from "../services/notify.js";

export const accountRoutes = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60_000, limit: config.isProd ? 30 : 1000, standardHeaders: true, legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many attempts. Please try again later." } }),
});

const pw = z.string().min(10, "Use at least 10 characters").max(128)
  .refine((s) => /[a-z]/i.test(s) && /\d/.test(s), "Include letters and at least one number");
const publicUser = (u: any) => ({ id: u.id, email: u.email, name: u.name, phone: u.phone, role: u.role, preferredCurrency: u.preferred_currency, isDemo: u.is_demo, createdAt: u.created_at });

accountRoutes.post("/auth/register", authLimiter, h(async (req, res) => {
  const b = parse(z.object({ email: z.string().email().max(160), password: pw, name: z.string().trim().min(2).max(80), phone: z.string().max(30).optional() }), req.body);
  const exists = await req.db.query("SELECT 1 FROM users WHERE lower(email)=lower($1) AND deleted_at IS NULL", [b.email]);
  if (exists.rowCount) throw new ApiError(409, "EMAIL_TAKEN", "An account with this email already exists");
  // Role is never taken from the client: self-registration always yields a customer.
  const u = (await req.db.query<any>(
    "INSERT INTO users(email, password_hash, name, phone, role) VALUES ($1,$2,$3,$4,'customer') RETURNING *",
    [b.email, await hashPassword(b.password), b.name, b.phone ?? null])).rows[0];
  await notify(req.db, u.id, "account", "Welcome to WAYFARER", "Your account is ready. Start by searching a destination or asking the AI planner for an itinerary.");
  const tokens = await issueTokens(req.db, { id: u.id, role: u.role, email: u.email });
  res.status(201).json({ user: publicUser(u), ...tokens });
}));

accountRoutes.post("/auth/login", authLimiter, h(async (req, res) => {
  const b = parse(z.object({ email: z.string().email(), password: z.string().min(1).max(128) }), req.body);
  const u = (await req.db.query<any>("SELECT * FROM users WHERE lower(email)=lower($1) AND deleted_at IS NULL", [b.email])).rows[0];
  // Same message and similar work for unknown email vs wrong password.
  const ok = u ? await verifyPassword(b.password, u.password_hash) : (await verifyPassword(b.password, "$2a$10$abcdefghijklmnopqrstuuYqzJp0Qh8JrW0pYxM6Vf8Q4Vx5r0x2K"), false);
  if (!u || !ok) throw new ApiError(401, "INVALID_CREDENTIALS", "Email or password is incorrect");
  const tokens = await issueTokens(req.db, { id: u.id, role: u.role, email: u.email });
  res.json({ user: publicUser(u), ...tokens });
}));

accountRoutes.post("/auth/refresh", authLimiter, h(async (req, res) => {
  const { refreshToken } = parse(z.object({ refreshToken: z.string().min(20).max(200) }), req.body);
  res.json(await rotateRefresh(req.db, refreshToken));
}));

accountRoutes.post("/auth/logout", h(async (req, res) => {
  const { refreshToken } = parse(z.object({ refreshToken: z.string().min(20).max(200) }), req.body);
  await revokeRefresh(req.db, refreshToken);
  res.status(204).end();
}));

/**
 * Password reset. No email provider is configured in demo mode, so the single-use token is returned in the
 * response ONLY when EMAIL_PROVIDER_API_KEY is absent and the environment is not production.
 */
accountRoutes.post("/auth/forgot-password", authLimiter, h(async (req, res) => {
  const { email } = parse(z.object({ email: z.string().email() }), req.body);
  const u = (await req.db.query<any>("SELECT id FROM users WHERE lower(email)=lower($1) AND deleted_at IS NULL", [email])).rows[0];
  let devToken: string | undefined;
  if (u) {
    const token = randomBytes(24).toString("base64url");
    await req.db.query("INSERT INTO password_resets(user_id, token_hash, expires_at) VALUES ($1,$2, now() + interval '30 minutes')", [u.id, hashToken(token)]);
    if (!config.isProd && !process.env.EMAIL_PROVIDER_API_KEY) devToken = token;
  }
  res.json({ message: "If an account exists for that email, a reset link has been prepared.", demoResetToken: devToken });
}));

accountRoutes.post("/auth/reset-password", authLimiter, h(async (req, res) => {
  const b = parse(z.object({ token: z.string().min(10).max(100), password: pw }), req.body);
  const r = (await req.db.query<any>(
    "SELECT id, user_id FROM password_resets WHERE token_hash=$1 AND used_at IS NULL AND expires_at > now()", [hashToken(b.token)])).rows[0];
  if (!r) throw new ApiError(400, "INVALID_RESET_TOKEN", "This reset link is invalid or has expired");
  await req.db.query("UPDATE users SET password_hash=$2, updated_at=now() WHERE id=$1", [r.user_id, await hashPassword(b.password)]);
  await req.db.query("UPDATE password_resets SET used_at=now() WHERE id=$1", [r.id]);
  await req.db.query("UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL", [r.user_id]);
  await audit(req.db, r.user_id, "auth.password_reset", "user", r.user_id);
  res.json({ message: "Password updated. Please sign in." });
}));

/* ---------------------------------------------------------------- profile */

accountRoutes.get("/users/me", requireAuth, h(async (req, res) => {
  const u = (await req.db.query<any>("SELECT * FROM users WHERE id=$1 AND deleted_at IS NULL", [req.user!.id])).rows[0];
  if (!u) throw new ApiError(401, "UNAUTHENTICATED", "Account no longer exists");
  res.json(publicUser(u));
}));

accountRoutes.patch("/users/me", requireAuth, h(async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(2).max(80).optional(), phone: z.string().max(30).nullable().optional(),
    preferredCurrency: z.string().length(3).toUpperCase().optional() }).strict(), req.body);
  if (b.preferredCurrency) {
    const c = await req.db.query("SELECT 1 FROM currencies WHERE code=$1", [b.preferredCurrency]);
    if (!c.rowCount) throw new ApiError(422, "VALIDATION_ERROR", "Unsupported currency");
  }
  const u = (await req.db.query<any>(
    `UPDATE users SET name=COALESCE($2,name), phone=CASE WHEN $3::boolean THEN $4 ELSE phone END,
            preferred_currency=COALESCE($5,preferred_currency), updated_at=now() WHERE id=$1 RETURNING *`,
    [req.user!.id, b.name ?? null, b.phone !== undefined, b.phone ?? null, b.preferredCurrency ?? null])).rows[0];
  res.json(publicUser(u));
}));

accountRoutes.post("/users/me/delete", requireAuth, h(async (req, res) => {
  const { password } = parse(z.object({ password: z.string().min(1) }), req.body);
  const u = (await req.db.query<any>("SELECT * FROM users WHERE id=$1", [req.user!.id])).rows[0];
  if (!(await verifyPassword(password, u.password_hash))) throw new ApiError(403, "INVALID_CREDENTIALS", "Password is incorrect");
  const active = await req.db.query("SELECT 1 FROM bookings WHERE user_id=$1 AND status IN ('PENDING_CONFIRMATION','CONFIRMED','CHECKED_IN')", [u.id]);
  if (active.rowCount) throw new ApiError(409, "ACTIVE_BOOKINGS", "Cancel or complete your active bookings before deleting your account.");
  // Soft delete + anonymise PII; bookings/payments remain for financial records.
  await req.db.query(
    "UPDATE users SET deleted_at=now(), email=$2, name='Deleted user', phone=NULL, password_hash='-', updated_at=now() WHERE id=$1",
    [u.id, `deleted+${u.id}@wayfarer.invalid`]);
  await req.db.query("UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL", [u.id]);
  await audit(req.db, u.id, "account.delete", "user", u.id);
  res.status(204).end();
}));

/* ---------------------------------------------------------------- wishlist & history */

const WishKind = z.enum(["destination", "accommodation", "attraction"]);

accountRoutes.get("/wishlist", requireAuth, h(async (req, res) => {
  const { rows } = await req.db.query<any>(
    `SELECT w.kind, w.ref_id, w.created_at,
            COALESCE(d.name, a.name, t.name) AS name, COALESCE(d.slug, a.slug, t.slug) AS slug,
            COALESCE(d.cover_image, a.cover_image, t.image) AS image
       FROM wishlist_items w
       LEFT JOIN destinations d ON w.kind='destination' AND d.id=w.ref_id
       LEFT JOIN accommodations a ON w.kind='accommodation' AND a.id=w.ref_id
       LEFT JOIN attractions t ON w.kind='attraction' AND t.id=w.ref_id
      WHERE w.user_id=$1 ORDER BY w.created_at DESC`, [req.user!.id]);
  res.json({ items: rows });
}));

accountRoutes.put("/wishlist/:kind/:id", requireAuth, h(async (req, res) => {
  const kind = parse(WishKind, String(req.params.kind));
  const table = { destination: "destinations", accommodation: "accommodations", attraction: "attractions" }[kind];
  const exists = await req.db.query(`SELECT 1 FROM ${table} WHERE id::text=$1 AND deleted_at IS NULL`, [String(req.params.id)]);
  if (!exists.rowCount) throw notFound(kind);
  await req.db.query("INSERT INTO wishlist_items(user_id, kind, ref_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [req.user!.id, kind, String(req.params.id)]);
  res.status(204).end();
}));

accountRoutes.delete("/wishlist/:kind/:id", requireAuth, h(async (req, res) => {
  const kind = parse(WishKind, String(req.params.kind));
  await req.db.query("DELETE FROM wishlist_items WHERE user_id=$1 AND kind=$2 AND ref_id::text=$3", [req.user!.id, kind, String(req.params.id)]);
  res.status(204).end();
}));

accountRoutes.get("/search-history", requireAuth, h(async (req, res) => {
  const { rows } = await req.db.query(
    "SELECT query, MAX(created_at) AS last_used FROM search_history WHERE user_id=$1 GROUP BY query ORDER BY last_used DESC LIMIT 10", [req.user!.id]);
  res.json({ items: rows });
}));

accountRoutes.get("/users/me/reviews", requireAuth, h(async (req, res) => {
  const { rows } = await req.db.query(
    `SELECT r.id, r.rating, r.title, r.body, r.status, r.created_at, a.name AS accommodation_name, a.slug AS accommodation_slug
       FROM reviews r JOIN accommodations a ON a.id=r.accommodation_id WHERE r.user_id=$1 ORDER BY r.created_at DESC`, [req.user!.id]);
  res.json({ items: rows });
}));

/* ---------------------------------------------------------------- notifications */

accountRoutes.get("/notifications", requireAuth, h(async (req, res) => {
  const { rows } = await req.db.query(
    "SELECT id, type, title, body, data, read_at, created_at FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100", [req.user!.id]);
  const unread = rows.filter((r: any) => !r.read_at).length;
  res.json({ items: rows, unread, push: "In-app only. Push delivery requires Firebase credentials and is not configured." });
}));

accountRoutes.patch("/notifications/:id/read", requireAuth, h(async (req, res) => {
  const r = await req.db.query("UPDATE notifications SET read_at=COALESCE(read_at, now()) WHERE id::text=$1 AND user_id=$2", [String(req.params.id), req.user!.id]);
  if (!r.rowCount) throw notFound("Notification");
  res.status(204).end();
}));

accountRoutes.post("/notifications/read-all", requireAuth, h(async (req, res) => {
  await req.db.query("UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL", [req.user!.id]);
  res.status(204).end();
}));
