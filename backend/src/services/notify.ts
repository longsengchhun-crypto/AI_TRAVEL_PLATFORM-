import type { Db } from "../db/index.js";

export async function notify(db: Db, userId: string, type: string, title: string, body: string, data: Record<string, unknown> = {}) {
  await db.query("INSERT INTO notifications(user_id, type, title, body, data) VALUES ($1,$2,$3,$4,$5)", [userId, type, title, body, JSON.stringify(data)]);
}

export async function audit(db: Db, actorId: string | null, action: string, entity: string, entityId?: string, meta: Record<string, unknown> = {}) {
  await db.query("INSERT INTO audit_logs(actor_id, action, entity, entity_id, meta) VALUES ($1,$2,$3,$4,$5)", [actorId, action, entity, entityId ?? null, JSON.stringify(meta)]);
}
