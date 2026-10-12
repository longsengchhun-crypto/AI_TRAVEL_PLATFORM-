import type { NextFunction, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { config } from "./config.js";
import type { Db } from "./db/index.js";
import { ApiError } from "./http.js";

export type Role = "customer" | "partner" | "staff" | "admin";
export interface AuthUser { id: string; role: Role; email: string }

declare module "express-serve-static-core" {
  interface Request { user?: AuthUser; db: Db; rawBody?: Buffer }
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export const hashPassword = (pw: string) => bcrypt.hash(pw, 10);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

export function signAccess(u: AuthUser): string {
  return jwt.sign({ role: u.role, email: u.email }, config.jwtAccessSecret, { subject: u.id, expiresIn: config.accessTtlSec, issuer: "wayfarer" });
}

export async function issueTokens(db: Db, u: AuthUser, familyId: string = randomUUID()) {
  const refresh = randomBytes(48).toString("base64url");
  await db.query(
    "INSERT INTO refresh_tokens(user_id, family_id, token_hash, expires_at) VALUES ($1,$2,$3, now() + ($4 || ' seconds')::interval)",
    [u.id, familyId, sha(refresh), String(config.refreshTtlSec)],
  );
  return { accessToken: signAccess(u), refreshToken: refresh, expiresIn: config.accessTtlSec, tokenType: "Bearer" as const };
}

/** Rotates a refresh token. Re-use of an already-rotated token revokes the whole family (theft detection). */
export async function rotateRefresh(db: Db, token: string) {
  const { rows } = await db.query<any>(
    `SELECT t.id, t.user_id, t.family_id, t.revoked_at, t.expires_at < now() AS expired, u.email, u.role, u.deleted_at
       FROM refresh_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = $1`, [sha(token)]);
  const t = rows[0];
  if (!t) throw new ApiError(401, "INVALID_REFRESH", "Invalid refresh token");
  if (t.revoked_at) {
    await db.query("UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL", [t.family_id]);
    throw new ApiError(401, "REFRESH_REUSED", "Refresh token was already used; please sign in again");
  }
  if (t.expired || t.deleted_at) throw new ApiError(401, "INVALID_REFRESH", "Refresh token expired");
  await db.query("UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1", [t.id]);
  return issueTokens(db, { id: t.user_id, role: t.role, email: t.email }, t.family_id);
}

export async function revokeRefresh(db: Db, token: string) {
  await db.query("UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL", [sha(token)]);
}

export const hashToken = sha;

function readToken(req: Request): AuthUser | null {
  const hdr = req.headers.authorization;
  if (!hdr?.startsWith("Bearer ")) return null;
  try {
    const p = jwt.verify(hdr.slice(7), config.jwtAccessSecret, { issuer: "wayfarer" }) as jwt.JwtPayload;
    return { id: String(p.sub), role: p.role as Role, email: String(p.email) };
  } catch (e) {
    if (e instanceof jwt.TokenExpiredError) throw new ApiError(401, "TOKEN_EXPIRED", "Access token expired");
    throw new ApiError(401, "INVALID_TOKEN", "Invalid access token");
  }
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  try { const u = readToken(req); if (u) req.user = u; next(); } catch (e) { next(e); }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const u = readToken(req);
    if (!u) throw new ApiError(401, "UNAUTHENTICATED", "Authentication required");
    req.user = u;
    next();
  } catch (e) { next(e); }
}

/** The signed token identifies the user; the role is re-read from the DB so role changes apply immediately. */
export function requireRole(...roles: Role[]) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const u = req.user;
      if (!u) throw new ApiError(401, "UNAUTHENTICATED", "Authentication required");
      const { rows } = await req.db.query<{ role: Role }>("SELECT role FROM users WHERE id = $1 AND deleted_at IS NULL", [u.id]);
      const role = rows[0]?.role;
      if (!role || !roles.includes(role)) throw new ApiError(403, "FORBIDDEN", "You do not have permission to perform this action");
      u.role = role;
      next();
    } catch (e) { next(e); }
  };
}
