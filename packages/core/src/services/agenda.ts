import type { DB } from '../db/connection.js';
import { diffDays, dueStatus, toIsoDate, type IsoDate } from '../util/dates.js';

export type AgendaAlertKind = 'obligation' | 'task' | 'document_review' | 'backup';
export type AgendaAlertSeverity = 'overdue' | 'due_soon' | 'info';

export interface AgendaAlert {
  kind: AgendaAlertKind;
  severity: AgendaAlertSeverity;
  title: string;
  dueDate?: IsoDate;
  ref: Record<string, string | number | boolean | null>;
}

export interface TodayAgenda {
  today: IsoDate;
  alerts: AgendaAlert[];
}

export interface TodayAgendaOptions {
  soonDays?: number;
  staleDays?: number;
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

export function todayAgenda(db: DB, today: IsoDate = toIsoDate(new Date()), opts: TodayAgendaOptions = {}): TodayAgenda {
  const soonDays = normalizeNonNegativeInteger(opts.soonDays, DEFAULT_SOON_DAYS);
  const staleDays = normalizeNonNegativeInteger(opts.staleDays, DEFAULT_STALE_DAYS);
  const alerts = [
    ...obligationAlerts(db, today, soonDays),
    ...taskAlerts(db, today, soonDays),
    ...documentReviewAlerts(db, today, soonDays),
    ...backupAlerts(db, today, staleDays),
  ].sort(compareAlerts);

  return { today, alerts };
}

function obligationAlerts(db: DB, today: IsoDate, soonDays: number): AgendaAlert[] {
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
        ref: {
          type: 'obligation',
          id: row.id,
          category: row.category,
          status: row.status,
        },
      },
    ];
  });
}

function taskAlerts(db: DB, today: IsoDate, soonDays: number): AgendaAlert[] {
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
        ref: {
          type: 'task',
          id: row.id,
          projectId: row.project_id,
          status: row.status,
          priority: row.priority,
        },
      },
    ];
  });
}

function documentReviewAlerts(db: DB, today: IsoDate, soonDays: number): AgendaAlert[] {
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

function backupAlerts(db: DB, today: IsoDate, staleDays: number): AgendaAlert[] {
  const latest = db
    .prepare(
      `SELECT id, created_at
       FROM backup_history
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
    )
    .get() as BackupHistoryRow | undefined;

  if (!latest) {
    return [
      {
        kind: 'backup',
        severity: 'overdue',
        title: 'バックアップ未実施',
        ref: { type: 'backup_history', reason: 'empty' },
      },
    ];
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

function normalizeNonNegativeInteger(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('agenda option must be a non-negative integer');
  return value;
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
