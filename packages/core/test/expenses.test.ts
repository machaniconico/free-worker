import { describe, expect, it } from 'vitest';
import { bootstrap } from '../src/db/bootstrap.js';
import {
  createExpense,
  deleteExpense,
  exportExpensesCsv,
  getExpense,
  importExpensesCsv,
  listExpenses,
  summarizeExpensesByCategory,
  summarizeExpensesByMonth,
  updateExpense,
} from '../src/services/expenses.js';

describe('expenses service', () => {
  it('経費CRUDで整数金額を保持し監査ログを記録する', () => {
    const db = bootstrap({ filename: ':memory:' });

    const created = createExpense(db, {
      spentAt: '2026-06-09',
      vendor: '文房具店',
      category: 'supplies',
      amountTaxIncluded: 1100,
      taxAmount: 100,
      paymentMethod: 'credit_card',
      purpose: '発送用封筒',
    });
    expect(created).toMatchObject({
      id: expect.any(Number),
      spentAt: '2026-06-09',
      vendor: '文房具店',
      category: 'supplies',
      amountTaxIncluded: 1100,
      taxAmount: 100,
      paymentMethod: 'credit_card',
      purpose: '発送用封筒',
    });

    const updated = updateExpense(db, created.id, {
      vendor: 'オンライン文具',
      amountTaxIncluded: 1650,
      taxAmount: 150,
      purpose: null,
    });
    expect(updated).toMatchObject({
      id: created.id,
      vendor: 'オンライン文具',
      amountTaxIncluded: 1650,
      taxAmount: 150,
      purpose: null,
    });

    expect(listExpenses(db)).toHaveLength(1);
    expect(deleteExpense(db, created.id)).toBe(true);
    expect(getExpense(db, created.id)).toBeNull();

    const auditActions = db
      .prepare('SELECT action FROM audit_logs WHERE entity_type = ? ORDER BY id ASC')
      .all('expense')
      .map((row) => (row as { action: string }).action);
    expect(auditActions).toEqual(['create', 'update', 'delete']);
    db.close();
  });

  it('非整数の金額と税額を拒否する', () => {
    const db = bootstrap({ filename: ':memory:' });

    expect(() =>
      createExpense(db, {
        spentAt: '2026-06-09',
        category: 'software',
        amountTaxIncluded: 1200.5,
      }),
    ).toThrow(/amountTaxIncluded must be an integer/);

    expect(() =>
      createExpense(db, {
        spentAt: '2026-06-09',
        category: 'software',
        amountTaxIncluded: 1200,
        taxAmount: 109.5,
      }),
    ).toThrow(/taxAmount must be an integer/);
    db.close();
  });

  it('月次とカテゴリ別に税込金額と税額を集計する', () => {
    const db = bootstrap({ filename: ':memory:' });
    createExpense(db, {
      spentAt: '2026-06-01',
      category: 'software',
      amountTaxIncluded: 3300,
      taxAmount: 300,
    });
    createExpense(db, {
      spentAt: '2026-06-20',
      category: 'supplies',
      amountTaxIncluded: 1100,
      taxAmount: 100,
    });
    createExpense(db, {
      spentAt: '2026-07-01',
      category: 'software',
      amountTaxIncluded: 2200,
      taxAmount: 200,
    });

    expect(summarizeExpensesByMonth(db)).toEqual([
      { month: '2026-06', amountTaxIncluded: 4400, taxAmount: 400, expenseCount: 2 },
      { month: '2026-07', amountTaxIncluded: 2200, taxAmount: 200, expenseCount: 1 },
    ]);
    expect(summarizeExpensesByMonth(db, '2026-06')).toEqual([
      { month: '2026-06', amountTaxIncluded: 4400, taxAmount: 400, expenseCount: 2 },
    ]);
    expect(summarizeExpensesByCategory(db, '2026-06')).toEqual([
      { category: 'software', amountTaxIncluded: 3300, taxAmount: 300, expenseCount: 1 },
      { category: 'supplies', amountTaxIncluded: 1100, taxAmount: 100, expenseCount: 1 },
    ]);
    db.close();
  });

  it('CSV export/import の往復で経費データを保持し既存idは更新する', () => {
    const sourceDb = bootstrap({ filename: ':memory:' });
    const existing = createExpense(sourceDb, {
      spentAt: '2026-06-15',
      vendor: 'クラウドなしソフト',
      category: 'software',
      amountTaxIncluded: 5500,
      taxAmount: 500,
      paymentMethod: 'debit',
      purpose: '制作ツール',
    });
    const csv = exportExpensesCsv(sourceDb);

    const targetDb = bootstrap({ filename: ':memory:' });
    createExpense(targetDb, {
      spentAt: '2026-06-01',
      vendor: '旧ベンダー',
      category: 'software',
      amountTaxIncluded: 1000,
      taxAmount: 90,
    });
    const result = importExpensesCsv(targetDb, `${csv}\r\n,2026-06-20,書店,books,2200,200,cash,資料,`);
    const imported = listExpenses(targetDb);

    expect(existing.id).toBe(1);
    expect(result).toEqual({ imported: 2, created: 1, updated: 1 });
    expect(imported).toHaveLength(2);
    expect(imported[0]).toMatchObject({
      id: 1,
      vendor: 'クラウドなしソフト',
      amountTaxIncluded: 5500,
      taxAmount: 500,
    });
    expect(imported[1]).toMatchObject({ vendor: '書店', category: 'books', amountTaxIncluded: 2200 });
    sourceDb.close();
    targetDb.close();
  });
});
