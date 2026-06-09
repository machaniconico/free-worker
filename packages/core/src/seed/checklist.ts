import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DB } from '../db/connection.js';
import { parseCsv, type CsvRow } from '../util/csv.js';
import { createObligation, getObligation, updateObligation, type Obligation } from '../services/obligations.js';

export interface SeedChecklistResult {
  inserted: number;
  updated: number;
  unchanged: number;
  total: number;
}

const SOURCE_PATTERN = /S(?:1[0-5]|[1-9])/g;

export function seedChecklist(db: DB, csvPath = defaultChecklistPath()): SeedChecklistResult {
  const rows = parseCsv(readFileSync(csvPath, 'utf8'));
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

  const tx = db.transaction(() => {
    for (const row of rows) {
      const input = toObligationInput(row);
      const existing = db
        .prepare('SELECT id FROM obligations WHERE category = ? AND title = ?')
        .get(input.category, input.title) as { id: number } | undefined;
      if (existing) {
        const current = getObligation(db, existing.id);
        if (current && sameSeededObligation(current, input)) {
          unchanged++;
        } else {
          updateObligation(db, existing.id, input, 'seed');
          updated++;
        }
      } else {
        createObligation(db, input, 'seed');
        inserted++;
      }
    }
  });
  tx();

  return { inserted, updated, unchanged, total: rows.length };
}

function toObligationInput(row: CsvRow): {
  category: string;
  title: string;
  description: string;
  dueDate: null;
  recurrence: null;
  status: string;
  sourceId: string | null;
  evidenceAttachmentId: null;
} {
  const phase = required(row, 'フェーズ');
  const category = required(row, '分類');
  const task = required(row, 'タスク');
  const priority = row['優先度']?.trim() || '未設定';
  const evidence = row['証跡/成果物']?.trim() || '未設定';
  const status = normalizeStatus(row['状態']);
  const sourceId = firstSourceId(row['主な出典'] ?? '');

  return {
    category,
    title: task,
    description: `フェーズ: ${phase}\n優先度: ${priority}\n証跡/成果物: ${evidence}`,
    dueDate: null,
    recurrence: null,
    status,
    sourceId,
    evidenceAttachmentId: null,
  };
}

function defaultChecklistPath(): string {
  const candidates = [
    join(process.cwd(), 'docs', 'reference', 'action_checklist.csv'),
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'docs', 'reference', 'action_checklist.csv'),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error('docs/reference/action_checklist.csv not found');
  return found;
}

function required(row: CsvRow, key: string): string {
  const value = row[key]?.trim();
  if (!value) throw new Error(`checklist column is required: ${key}`);
  return value;
}

function normalizeStatus(value: string | undefined): string {
  const status = value?.trim();
  return status && status !== '未' ? status : '未着手';
}

function firstSourceId(value: string): string | null {
  return value.match(SOURCE_PATTERN)?.[0] ?? null;
}

function sameSeededObligation(
  current: Obligation,
  next: ReturnType<typeof toObligationInput>,
): boolean {
  return (
    current.category === next.category &&
    current.title === next.title &&
    current.description === next.description &&
    current.dueDate === next.dueDate &&
    current.recurrence === next.recurrence &&
    current.status === next.status &&
    current.sourceId === next.sourceId &&
    current.evidenceAttachmentId === next.evidenceAttachmentId
  );
}
