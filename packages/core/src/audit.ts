import type { DB } from './db/connection.js';

export interface AuditEntry {
  actor?: string;
  action: 'create' | 'update' | 'delete' | string;
  entityType: string;
  entityId?: string | number | null;
  before?: unknown;
  after?: unknown;
}

/**
 * 監査ログを1件記録する。重要データの create/update/delete で呼ぶ。
 * before/after は JSON 文字列化して保存する。
 */
export function writeAudit(db: DB, entry: AuditEntry): void {
  db.prepare(
    `INSERT INTO audit_logs (actor, action, entity_type, entity_id, before_json, after_json)
     VALUES (@actor, @action, @entityType, @entityId, @before, @after)`,
  ).run({
    actor: entry.actor ?? 'local_user',
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId == null ? null : String(entry.entityId),
    before: entry.before === undefined ? null : JSON.stringify(entry.before),
    after: entry.after === undefined ? null : JSON.stringify(entry.after),
  });
}
