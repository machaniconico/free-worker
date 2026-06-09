import { describe, expect, it } from 'vitest';
import { writeAudit } from '../src/audit.js';
import { bootstrap } from '../src/db/bootstrap.js';
import { exportAuditCsv, listAudit } from '../src/services/audit-query.js';

describe('audit query service', () => {
  it('監査ログを新しい順に一覧し entity/action/期間で絞り込める', () => {
    const db = bootstrap({ filename: ':memory:' });
    writeAudit(db, {
      actor: 'owner',
      action: 'create',
      entityType: 'customer',
      entityId: 1,
      after: { displayName: '合成顧客A' },
    });
    writeAudit(db, {
      actor: 'owner',
      action: 'update',
      entityType: 'expense',
      entityId: 2,
      before: { amountTaxIncluded: 1000 },
      after: { amountTaxIncluded: 1200 },
    });
    writeAudit(db, {
      actor: 'system',
      action: 'delete',
      entityType: 'expense',
      entityId: 3,
      before: { amountTaxIncluded: 500 },
    });

    const ids = db.prepare('SELECT id FROM audit_logs ORDER BY id ASC').all() as { id: number }[];
    db.prepare('UPDATE audit_logs SET created_at = ? WHERE id = ?').run('2026-06-01 09:00:00', ids[0]!.id);
    db.prepare('UPDATE audit_logs SET created_at = ? WHERE id = ?').run('2026-06-10 10:00:00', ids[1]!.id);
    db.prepare('UPDATE audit_logs SET created_at = ? WHERE id = ?').run('2026-07-01 11:00:00', ids[2]!.id);

    expect(listAudit(db).map((entry) => entry.action)).toEqual(['delete', 'update', 'create']);
    expect(listAudit(db, { entityType: 'expense' }).map((entry) => entry.action)).toEqual(['delete', 'update']);
    expect(listAudit(db, { action: 'update' }).map((entry) => entry.entityId)).toEqual(['2']);
    expect(
      listAudit(db, {
        entityType: 'expense',
        from: '2026-06-01 00:00:00',
        to: '2026-06-30 23:59:59',
      }).map((entry) => entry.id),
    ).toEqual([ids[1]!.id]);
    db.close();
  });

  it('いつ誰が何を変えたかをCSV出力する', () => {
    const db = bootstrap({ filename: ':memory:' });
    writeAudit(db, {
      actor: 'owner',
      action: 'update',
      entityType: 'profile',
      entityId: '7',
      before: { tradeName: '旧屋号' },
      after: { tradeName: '新屋号' },
    });
    const id = (db.prepare('SELECT id FROM audit_logs').get() as { id: number }).id;
    db.prepare('UPDATE audit_logs SET created_at = ? WHERE id = ?').run('2026-06-09 12:34:56', id);

    const csv = exportAuditCsv(db, { entityType: 'profile' });

    expect(csv).toContain('id,createdAt,actor,action,entityType,entityId,beforeJson,afterJson');
    expect(csv).toContain('2026-06-09 12:34:56,owner,update,profile,7');
    expect(csv).toContain('"{""tradeName"":""旧屋号""}"');
    expect(csv).toContain('"{""tradeName"":""新屋号""}"');
    db.close();
  });
});
