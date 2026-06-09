import { describe, expect, it } from 'vitest';
import { bootstrap } from '../src/db/bootstrap.js';
import { todayAgenda } from '../src/services/agenda.js';
import { createContentProject, createContentTask } from '../src/services/content.js';
import { createDocumentVersion } from '../src/services/documents.js';
import { createObligation } from '../src/services/obligations.js';

describe('todayAgenda', () => {
  it('obligations, tasks, document reviews, and stale backups are aggregated as alerts', () => {
    const db = bootstrap({ filename: ':memory:' });
    const project = createContentProject(db, { title: '教材制作' });
    createObligation(db, { category: '税務', title: '期限超過の届出', dueDate: '2026-06-08' });
    createObligation(db, { category: '経理', title: '近い支払い', dueDate: '2026-06-12' });
    createObligation(db, { category: '経理', title: '先の支払い', dueDate: '2026-07-01' });
    createContentTask(db, { projectId: project.id, title: '超過タスク', dueDate: '2026-06-07' });
    createContentTask(db, { projectId: project.id, title: '完了済みタスク', status: 'done', dueDate: '2026-06-07' });
    createDocumentVersion(db, {
      docType: 'terms',
      title: '利用規約',
      versionLabel: 'v1',
      body: '本文',
      nextReviewDate: '2026-06-10',
    });
    db.prepare(
      `INSERT INTO backup_history (file_path, sha256, size_bytes, encrypted, kind, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('/tmp/old.fwbak', '0'.repeat(64), 10, 1, 'manual', '2026-06-01 00:00:00');

    const agenda = todayAgenda(db, '2026-06-09', { soonDays: 3, staleDays: 7 });
    const byTitle = new Map(agenda.alerts.map((alert) => [alert.title, alert]));

    expect(agenda.today).toBe('2026-06-09');
    expect(byTitle.get('期限超過の届出')).toMatchObject({
      kind: 'obligation',
      severity: 'overdue',
      dueDate: '2026-06-08',
      ref: { type: 'obligation' },
    });
    expect(byTitle.get('近い支払い')).toMatchObject({ kind: 'obligation', severity: 'due_soon' });
    expect(byTitle.get('超過タスク')).toMatchObject({ kind: 'task', severity: 'overdue' });
    expect(byTitle.get('利用規約 の見直し')).toMatchObject({
      kind: 'document_review',
      severity: 'due_soon',
      dueDate: '2026-06-10',
      ref: { type: 'document_version', docType: 'terms' },
    });
    expect(byTitle.get('バックアップ未実施')).toMatchObject({
      kind: 'backup',
      severity: 'overdue',
      dueDate: '2026-06-01',
    });
    expect(byTitle.has('先の支払い')).toBe(false);
    expect(byTitle.has('完了済みタスク')).toBe(false);
    db.close();
  });

  it('adds a backup warning when backup_history is empty', () => {
    const db = bootstrap({ filename: ':memory:' });

    expect(todayAgenda(db, '2026-06-09').alerts).toEqual([
      {
        kind: 'backup',
        severity: 'overdue',
        title: 'バックアップ未実施',
        ref: { type: 'backup_history', reason: 'empty' },
      },
    ]);
    db.close();
  });

  it('returns no alerts when nothing is due and the latest backup is fresh', () => {
    const db = bootstrap({ filename: ':memory:' });
    const project = createContentProject(db, { title: '保守' });
    createObligation(db, { category: '税務', title: '翌月の届出', dueDate: '2026-07-01' });
    createContentTask(db, { projectId: project.id, title: '翌月の作業', dueDate: '2026-07-02' });
    createDocumentVersion(db, {
      docType: 'privacy',
      title: 'プライバシーポリシー',
      versionLabel: 'v1',
      body: '本文',
      nextReviewDate: '2026-07-03',
    });
    db.prepare(
      `INSERT INTO backup_history (file_path, sha256, size_bytes, encrypted, kind, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('/tmp/fresh.fwbak', '1'.repeat(64), 10, 1, 'manual', '2026-06-08 00:00:00');

    expect(todayAgenda(db, '2026-06-09', { soonDays: 3, staleDays: 7 }).alerts).toEqual([]);
    db.close();
  });
});
