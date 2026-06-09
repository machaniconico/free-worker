import { describe, expect, it } from 'vitest';
import { bootstrap } from '../src/db/bootstrap.js';
import {
  createObligation,
  deleteObligation,
  getObligation,
  listWithDueStatus,
  updateObligation,
  updateObligationStatus,
} from '../src/services/obligations.js';
import { seedChecklist } from '../src/seed/checklist.js';

describe('obligations service', () => {
  it('CRUD と監査ログを記録する', () => {
    const db = bootstrap({ filename: ':memory:' });
    const created = createObligation(db, {
      category: '税務',
      title: '青色申告承認申請',
      description: '提出期限を確認する',
      dueDate: '2026-03-15',
      recurrence: 'yearly',
      sourceId: 'S2',
    });

    expect(created.id).toBeGreaterThan(0);
    expect(created.status).toBe('未着手');
    expect(getObligation(db, created.id)?.sourceId).toBe('S2');

    const updated = updateObligation(db, created.id, { title: '青色申告承認申請書', status: '進行中' });
    expect(updated.title).toBe('青色申告承認申請書');
    expect(updated.status).toBe('進行中');

    const statusUpdated = updateObligationStatus(db, created.id, '完了');
    expect(statusUpdated.status).toBe('完了');

    deleteObligation(db, created.id);
    expect(getObligation(db, created.id)).toBeNull();

    const audit = db
      .prepare('SELECT action FROM audit_logs WHERE entity_type = ? ORDER BY id')
      .all('obligation')
      .map((row) => (row as { action: string }).action);
    expect(audit).toEqual(['create', 'update', 'update', 'delete']);
    db.close();
  });

  it('listWithDueStatus は dates.ts の期限判定を付与する', () => {
    const db = bootstrap({ filename: ':memory:' });
    createObligation(db, { category: '期限', title: '超過', dueDate: '2026-06-08' });
    createObligation(db, { category: '期限', title: '近い', dueDate: '2026-06-20' });
    createObligation(db, { category: '期限', title: '先', dueDate: '2026-07-01' });
    createObligation(db, { category: '期限', title: '未設定' });

    const byTitle = new Map(listWithDueStatus(db, '2026-06-09').map((item) => [item.title, item.dueStatus]));
    expect(byTitle.get('超過')).toBe('overdue');
    expect(byTitle.get('近い')).toBe('due_soon');
    expect(byTitle.get('先')).toBe('upcoming');
    expect(byTitle.get('未設定')).toBe('none');
    db.close();
  });

  it('seedChecklist は CSV から冪等に投入し source_id を紐付ける', () => {
    const db = bootstrap({ filename: ':memory:' });
    const first = seedChecklist(db);
    const second = seedChecklist(db);
    const count = db.prepare('SELECT COUNT(*) AS n FROM obligations').get() as { n: number };
    const accountingRoutine = db.prepare('SELECT source_id FROM obligations WHERE category = ?').get('会計ルーチン') as {
      source_id: string;
    };

    expect(first.inserted).toBeGreaterThan(0);
    expect(first.total).toBeGreaterThan(0);
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.unchanged).toBe(first.total);
    expect(count.n).toBe(first.total);
    expect(accountingRoutine.source_id).toBe('S2');
    db.close();
  });
});
