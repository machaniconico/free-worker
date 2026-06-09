import type { FastifyInstance } from 'fastify';
import { diffDays, dueStatus, toIsoDate, type DB } from '@free-worker/core';

type AgendaAlertKind = 'obligation' | 'task' | 'document_review' | 'backup';
type AgendaAlertSeverity = 'overdue' | 'due_soon' | 'info';

interface AgendaQuery {
  today?: string;
  soonDays?: string;
  staleDays?: string;
}

interface AgendaAlert {
  kind: AgendaAlertKind;
  severity: AgendaAlertSeverity;
  title: string;
  dueDate?: string;
  ref: Record<string, string | number | boolean | null>;
}

interface ObligationRow {
  id: number;
  category: string;
  title: string;
  due_date: string | null;
  status: string;
}

interface TaskRow {
  id: number;
  project_id: number | null;
  title: string;
  status: string;
  priority: string;
  due_date: string | null;
}

interface DocumentReviewRow {
  id: number;
  doc_type: string;
  title: string;
  version_label: string;
  state: string;
  next_review_date: string | null;
}

interface BackupHistoryRow {
  id: number;
  created_at: string;
}

const DEFAULT_SOON_DAYS = 14;
const DEFAULT_STALE_DAYS = 7;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function agendaRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: AgendaQuery }>('/api/agenda', async (req, reply) => {
    const parsed = parseQuery(req.query);
    if ('error' in parsed) {
      reply.code(400);
      return { error: parsed.error };
    }
    return todayAgendaForRoute(app.db, parsed.today, {
      soonDays: parsed.soonDays,
      staleDays: parsed.staleDays,
    });
  });
}

function todayAgendaForRoute(
  db: DB,
  today: string = toIsoDate(new Date()),
  opts: { soonDays: number; staleDays: number },
): { today: string; alerts: AgendaAlert[] } {
  const alerts = [
    ...obligationAlerts(db, today, opts.soonDays),
    ...taskAlerts(db, today, opts.soonDays),
    ...documentReviewAlerts(db, today, opts.soonDays),
    ...backupAlerts(db, today, opts.staleDays),
  ].sort(compareAlerts);

  return { today, alerts };
}

function obligationAlerts(db: DB, today: string, soonDays: number): AgendaAlert[] {
  const rows = db
    .prepare(
      `SELECT id, category, title, due_date, status
       FROM obligations
       WHERE due_date IS NOT NULL
       ORDER BY due_date ASC, id ASC`,
    )
    .all() as ObligationRow[];

  return rows.flatMap((row) => {
    const status = dueStatus(row.due_date, today, soonDays);
    if (status !== 'overdue' && status !== 'due_soon') return [];
    return [
      {
        kind: 'obligation',
        severity: status,
        title: row.title,
        dueDate: row.due_date ?? undefined,
        ref: { type: 'obligation', id: row.id, category: row.category, status: row.status },
      },
    ];
  });
}

function taskAlerts(db: DB, today: string, soonDays: number): AgendaAlert[] {
  const rows = db
    .prepare(
      `SELECT id, project_id, title, status, priority, due_date
       FROM tasks
       WHERE due_date IS NOT NULL AND status <> 'done'
       ORDER BY due_date ASC, id ASC`,
    )
    .all() as TaskRow[];

  return rows.flatMap((row) => {
    const status = dueStatus(row.due_date, today, soonDays);
    if (status !== 'overdue' && status !== 'due_soon') return [];
    return [
      {
        kind: 'task',
        severity: status,
        title: row.title,
        dueDate: row.due_date ?? undefined,
        ref: { type: 'task', id: row.id, projectId: row.project_id, status: row.status, priority: row.priority },
      },
    ];
  });
}

function documentReviewAlerts(db: DB, today: string, soonDays: number): AgendaAlert[] {
  const rows = db
    .prepare(
      `SELECT id, doc_type, title, version_label, state, next_review_date
       FROM document_versions
       WHERE next_review_date IS NOT NULL
       ORDER BY next_review_date ASC, id ASC`,
    )
    .all() as DocumentReviewRow[];

  return rows.flatMap((row) => {
    const status = dueStatus(row.next_review_date, today, soonDays);
    if (status !== 'overdue' && status !== 'due_soon') return [];
    return [
      {
        kind: 'document_review',
        severity: status,
        title: `${row.title} の見直し`,
        dueDate: row.next_review_date ?? undefined,
        ref: {
          type: 'document_version',
          id: row.id,
          docType: row.doc_type,
          versionLabel: row.version_label,
          state: row.state,
        },
      },
    ];
  });
}

function backupAlerts(db: DB, today: string, staleDays: number): AgendaAlert[] {
  const latest = db
    .prepare(
      `SELECT id, created_at
       FROM backup_history
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
    )
    .get() as BackupHistoryRow | undefined;

  if (!latest) {
    return [{ kind: 'backup', severity: 'overdue', title: 'バックアップ未実施', ref: { type: 'backup_history', reason: 'empty' } }];
  }

  const lastBackupDate = latest.created_at.slice(0, 10);
  if (diffDays(today, lastBackupDate) < staleDays) return [];
  return [
    {
      kind: 'backup',
      severity: 'overdue',
      title: 'バックアップ未実施',
      dueDate: lastBackupDate,
      ref: { type: 'backup_history', id: latest.id, lastBackupDate },
    },
  ];
}

function parseQuery(
  query: AgendaQuery,
): { today: string; soonDays: number; staleDays: number } | { error: 'invalid_today' | 'invalid_soon_days' | 'invalid_stale_days' } {
  const today = query.today?.trim() || toIsoDate(new Date());
  if (!ISO_DATE_PATTERN.test(today)) return { error: 'invalid_today' };
  const soonDays = parseNonNegativeInteger(query.soonDays, DEFAULT_SOON_DAYS);
  if (soonDays == null) return { error: 'invalid_soon_days' };
  const staleDays = parseNonNegativeInteger(query.staleDays, DEFAULT_STALE_DAYS);
  if (staleDays == null) return { error: 'invalid_stale_days' };
  return { today, soonDays, staleDays };
}

function parseNonNegativeInteger(value: string | undefined, fallback: number): number | null {
  if (value === undefined || value.trim() === '') return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function compareAlerts(a: AgendaAlert, b: AgendaAlert): number {
  const severity = severityRank(a.severity) - severityRank(b.severity);
  if (severity !== 0) return severity;
  const date = (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31');
  if (date !== 0) return date;
  const kind = a.kind.localeCompare(b.kind);
  if (kind !== 0) return kind;
  return a.title.localeCompare(b.title);
}

function severityRank(severity: AgendaAlertSeverity): number {
  switch (severity) {
    case 'overdue':
      return 0;
    case 'due_soon':
      return 1;
    case 'info':
      return 2;
  }
}
