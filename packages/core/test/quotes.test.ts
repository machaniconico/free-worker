import { describe, expect, it } from 'vitest';
import { bootstrap } from '../src/db/bootstrap.js';
import {
  convertQuoteToOrder,
  createQuote,
  deleteQuote,
  getQuote,
  listQuotes,
  updateQuote,
  updateQuoteStatus,
} from '../src/services/quotes.js';

function seedProduct(db: ReturnType<typeof bootstrap>, id: number): void {
  db.prepare(
    `INSERT OR IGNORE INTO products (id, sku, title, product_type, price_tax_included)
     VALUES (@id, @sku, @title, @productType, @priceTaxIncluded)`,
  ).run({
    id,
    sku: `SKU-${id}`,
    title: 'テスト商品',
    productType: 'download',
    priceTaxIncluded: 11000,
  });
}

describe('quotes service', () => {
  it('マイグレーション 0004 適用後に quotes/quote_items テーブルが存在する', () => {
    const db = bootstrap({ filename: ':memory:' });
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('quotes','quote_items') ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toEqual(['quote_items', 'quotes']);
    db.close();
  });

  it('CRUD: 作成・取得・更新・削除と監査ログ', () => {
    const db = bootstrap({ filename: ':memory:' });
    seedProduct(db, 1);

    const created = createQuote(db, {
      quoteNo: 'Q-001',
      issuedAt: '2026-06-20',
      validUntil: '2026-07-20',
      items: [
        { productId: 1, quantity: 2, unitPriceTaxIncluded: 5000 },
        { description: 'サービス料', quantity: 1, unitPriceTaxIncluded: 3000 },
      ],
    });

    expect(created.id).toBeGreaterThan(0);
    expect(created.quoteNo).toBe('Q-001');
    expect(created.status).toBe('draft');
    expect(created.items).toHaveLength(2);

    // getQuote
    const fetched = getQuote(db, created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.quoteNo).toBe('Q-001');

    // update
    const updated = updateQuote(db, created.id, { note: '修正見積', validUntil: '2026-08-01' });
    expect(updated.note).toBe('修正見積');
    expect(updated.validUntil).toBe('2026-08-01');

    // delete
    deleteQuote(db, created.id);
    expect(getQuote(db, created.id)).toBeNull();

    const audit = db
      .prepare('SELECT action FROM audit_logs WHERE entity_type = ? ORDER BY id')
      .all('quote')
      .map((r) => (r as { action: string }).action);
    expect(audit).toEqual(['create', 'update', 'delete']);
    db.close();
  });

  it('subtotalTaxIncluded は items から計算される(呼び出し側の値は無視)', () => {
    const db = bootstrap({ filename: ':memory:' });
    seedProduct(db, 1);
    seedProduct(db, 2);

    const q = createQuote(db, {
      quoteNo: 'Q-SUB',
      issuedAt: '2026-06-20',
      items: [
        { productId: 1, quantity: 3, unitPriceTaxIncluded: 1000 },
        { productId: 2, quantity: 2, unitPriceTaxIncluded: 500 },
      ],
    });

    // 3*1000 + 2*500 = 4000
    expect(q.subtotalTaxIncluded).toBe(4000);
    expect(q.items[0].subtotalTaxIncluded).toBe(3000);
    expect(q.items[1].subtotalTaxIncluded).toBe(1000);
    db.close();
  });

  it('items 更新時に subtotal が再計算される', () => {
    const db = bootstrap({ filename: ':memory:' });
    seedProduct(db, 1);

    const q = createQuote(db, {
      quoteNo: 'Q-RESUB',
      issuedAt: '2026-06-20',
      items: [{ productId: 1, quantity: 1, unitPriceTaxIncluded: 1000 }],
    });
    expect(q.subtotalTaxIncluded).toBe(1000);

    const updated = updateQuote(db, q.id, {
      items: [
        { productId: 1, quantity: 2, unitPriceTaxIncluded: 2000 },
        { productId: 1, quantity: 1, unitPriceTaxIncluded: 500 },
      ],
    });
    // 2*2000 + 1*500 = 4500
    expect(updated.subtotalTaxIncluded).toBe(4500);
    expect(updated.items).toHaveLength(2);
    db.close();
  });

  it('listQuotes は issued_at DESC, id DESC で返す', () => {
    const db = bootstrap({ filename: ':memory:' });
    createQuote(db, { quoteNo: 'Q-A', issuedAt: '2026-01-01' });
    createQuote(db, { quoteNo: 'Q-B', issuedAt: '2026-06-01' });
    createQuote(db, { quoteNo: 'Q-C', issuedAt: '2026-06-01' });

    const list = listQuotes(db);
    expect(list.map((q) => q.quoteNo)).toEqual(['Q-C', 'Q-B', 'Q-A']);
    db.close();
  });

  it('updateQuoteStatus: 正常ステータス遷移', () => {
    const db = bootstrap({ filename: ':memory:' });
    const q = createQuote(db, { quoteNo: 'Q-ST', issuedAt: '2026-06-20' });

    const sent = updateQuoteStatus(db, q.id, 'sent');
    expect(sent.status).toBe('sent');

    const accepted = updateQuoteStatus(db, q.id, 'accepted');
    expect(accepted.status).toBe('accepted');

    const expired = updateQuoteStatus(db, q.id, 'expired');
    expect(expired.status).toBe('expired');
    db.close();
  });

  it('updateQuoteStatus: 不正ステータスは throw', () => {
    const db = bootstrap({ filename: ':memory:' });
    const q = createQuote(db, { quoteNo: 'Q-BADST', issuedAt: '2026-06-20' });
    expect(() => updateQuoteStatus(db, q.id, 'unknown_status')).toThrow('invalid status');
    db.close();
  });

  it('金額負値を拒否する', () => {
    const db = bootstrap({ filename: ':memory:' });
    expect(() =>
      createQuote(db, {
        quoteNo: 'Q-NEG',
        issuedAt: '2026-06-20',
        items: [{ quantity: 1, unitPriceTaxIncluded: -100 }],
      }),
    ).toThrow('non-negative');
    db.close();
  });

  it('数量 0 を拒否する', () => {
    const db = bootstrap({ filename: ':memory:' });
    expect(() =>
      createQuote(db, {
        quoteNo: 'Q-ZERO',
        issuedAt: '2026-06-20',
        items: [{ quantity: 0, unitPriceTaxIncluded: 1000 }],
      }),
    ).toThrow('positive integer');
    db.close();
  });

  it('convert: order が生成され quote が converted になる', () => {
    const db = bootstrap({ filename: ':memory:' });
    seedProduct(db, 1);

    const q = createQuote(db, {
      quoteNo: 'Q-CONV',
      issuedAt: '2026-06-20',
      items: [{ productId: 1, quantity: 2, unitPriceTaxIncluded: 5000 }],
    });

    const result = convertQuoteToOrder(db, q.id);
    expect(result.quote.status).toBe('converted');
    expect(result.quote.convertedOrderId).toBe(result.order.id);
    expect(result.order.subtotalTaxIncluded).toBe(10000);
    expect(result.order.items).toHaveLength(1);

    // quote 側: 'create' + 'update'(from updateQuote内) + 'convert'
    const quoteAudit = db
      .prepare('SELECT action FROM audit_logs WHERE entity_type = ? AND entity_id = ? ORDER BY id')
      .all('quote', String(q.id))
      .map((r) => (r as { action: string }).action);
    expect(quoteAudit).toContain('create');
    expect(quoteAudit).toContain('convert');

    // order 側: 'create' が1件のみ
    const orderAudit = db
      .prepare('SELECT action FROM audit_logs WHERE entity_type = ? AND entity_id = ? ORDER BY id')
      .all('order', String(result.order.id))
      .map((r) => (r as { action: string }).action);
    expect(orderAudit).toEqual(['create']);
    db.close();
  });

  it('convert: 既に converted の見積は再変換不可', () => {
    const db = bootstrap({ filename: ':memory:' });
    seedProduct(db, 1);

    const q = createQuote(db, {
      quoteNo: 'Q-CONV2',
      issuedAt: '2026-06-20',
      items: [{ productId: 1, quantity: 1, unitPriceTaxIncluded: 1000 }],
    });
    convertQuoteToOrder(db, q.id);
    expect(() => convertQuoteToOrder(db, q.id)).toThrow('already converted');
    db.close();
  });

  it('convert: productId なし自由記述行があると変換不可', () => {
    const db = bootstrap({ filename: ':memory:' });
    seedProduct(db, 1);

    const q = createQuote(db, {
      quoteNo: 'Q-FREE',
      issuedAt: '2026-06-20',
      items: [
        { productId: 1, quantity: 1, unitPriceTaxIncluded: 1000 },
        { description: '自由記述サービス', quantity: 1, unitPriceTaxIncluded: 500 },
      ],
    });
    expect(() => convertQuoteToOrder(db, q.id)).toThrow('cannot convert');
    db.close();
  });

  it('存在しない quote を削除すると throw', () => {
    const db = bootstrap({ filename: ':memory:' });
    expect(() => deleteQuote(db, 9999)).toThrow('quote not found');
    db.close();
  });

  it('存在しない quote を updateQuote すると throw', () => {
    const db = bootstrap({ filename: ':memory:' });
    expect(() => updateQuote(db, 9999, { note: 'x' })).toThrow('quote not found');
    db.close();
  });
});
