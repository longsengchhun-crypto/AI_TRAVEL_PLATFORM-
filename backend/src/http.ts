import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError, type ZodTypeAny, type z } from "zod";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}
export const notFound = (what = "Resource") => new ApiError(404, "NOT_FOUND", `${what} not found`);
export const conflict = (code: string, msg: string, details?: unknown) => new ApiError(409, code, msg, details);

export const h = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { fn(req, res, next).catch(next); };

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new ApiError(422, "VALIDATION_ERROR", "Request validation failed", r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  return r.data;
}

export function errorMiddleware(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof ZodError) {
    return res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "Request validation failed" } });
  }
  const e = err as { type?: string };
  if (e?.type === "entity.parse.failed") return res.status(400).json({ error: { code: "BAD_JSON", message: "Malformed JSON body" } });
  if (e?.type === "entity.too.large") return res.status(413).json({ error: { code: "TOO_LARGE", message: "Request body too large" } });
  console.error("[unhandled]", err instanceof Error ? err.message : err);
  res.status(500).json({ error: { code: "INTERNAL", message: "Something went wrong on our side." } });
}
