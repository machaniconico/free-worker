import type { DB } from '../db/connection.js';
import { serializeCsv, type CsvRow } from '../util/csv.js';

export interface AuditFilter {
  entityType?: string;
  action?: string;
  from?: string;
  to?: string;
}

export interface AuditLogEntry {
  id: number;
  actor: string;
  action: string;
  entityType: string;
  entityId: string | null;
  beforeJson: string | null;
  afterJson: string | null;
  createdAt: string;
}

interface AuditLogRow {
  id: number;
  actor: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before_json: string | null;
  after_json: string | null;
  created_at: string;
}

const CSV_COLUMNS = ['id', 'createdAt', 'actor', 'action', 'entityType', 'entityId', 'beforeJson', 'afterJson'];

export function listAudit(db: DB, filter: AuditFilter = {}): AuditLogEntry[] {
  const query = buildAuditQuery(filter);
  const rows = db.prepare(query.sql).all(query.params) as AuditLogRow[];
  return rows.map(mapAuditLog);
}

export function exportAuditCsv(db: DB, filter: AuditFilter = {}): string {
  const rows: CsvRow[] = listAudit(db, filter).map((entry) => ({
    id: String(entry.id),
    createdAt: entry.createdAt,
    actor: entry.actor,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? '',
    beforeJson: entry.beforeJson ?? '',
    afterJson: entry.afterJson ?? '',
  }));
  return serializeCsv(rows, { columns: CSV_COLUMNS, bom: false });
}

function buildAuditQuery(filter: AuditFilter): { sql: string; params: Record<string, string> } {
  const conditions: string[] = [];
  const params: Record<string, string> = {};

  if (filter.entityType) {
    conditions.push('entity_type = @entityType');
    params.entityType = filter.entityType;
  }
  if (filter.action) {
    conditions.push('action = @action');
    params.action = filter.action;
  }
  if (filter.from) {
    conditions.push('created_at >= @from');
    params.from = filter.from;
  }
  if (filter.to) {
    conditions.push('created_at <= @to');
    params.to = filter.to;
  }

  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
  return {
    sql: `SELECT id, actor, action, entity_type, entity_id, before_json, after_json, created_at
          FROM audit_logs${where}
          ORDER BY created_at DESC, id DESC`,
    params,
  };
}

function mapAuditLog(row: AuditLogRow): AuditLogEntry {
  return {
    id: row.id,
    actor: row.actor,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    beforeJson: row.before_json,
    afterJson: row.after_json,
    createdAt: row.created_at,
  };
}
