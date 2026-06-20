import { describe, expect, it } from 'vitest';
import { bootstrap } from '../src/db/bootstrap.js';
import {
  createRecurringBilling,
  deleteRecurringBilling,
  generateDueBillings,
  getRecurringBilling,
  listRecurringBillings,
  updateRecurringBilling,
  updateRecurringBillingStatus,
} from '../src/services/recurring-billing.js';

function seedProduct(db: ReturnType<typeof bootstrap>, id: number): void {
  db.prepare(
    `INSERT OR IGNORE INTO products (id, sku, title, product_type, price_tax_included)
     VALUES (@id, @sku, @title, @productType, @priceTaxIncluded)`,
  ).run({
    id,
    sku: `SKU-${id}`,
    title: 'テスト商品',
    productType: 'membership',
    priceTaxIncluded: 11000,
  });
}

describe('recurring-billing service', () => {
  it('マイグレーション 0005 適用後に recurring_billings テーブルが存在する', () => {
    const db = bootstrap({ filename: ':memory:' });
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'recurring_billings'")
      .get() as { name: string } | undefined;
    expect(row?.name).toBe('recurring_billings');
    db.close();
  });

  it('createRecurringBilling: 作成と監査ログ、nextBillingDate 未指定は startDate を使う', () => {
    const db = bootstrap({ filename: ':memory:' });
    seedProduct(db, 1);

    const created = createRecurringBilling(db, {
      productId: 1,
      planName: '月額プラン',
      amountTaxIncluded: 11000,
      taxAmount: 1000,
      billingPeriod: 'monthly',
      startDate: '2026-01-15',
    });

    expect(created.id).toBeGreaterThan(0);
    expect(created.planName).toBe('月額プラン');
    expect(created.status).toBe('active');
    expect(created.nextBillingDate).toBe('2026-01-15');

    const fetched = getRecurringBilling(db, created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.amountTaxIncluded).toBe(11000);

    const audit = db
      .prepare('SELECT action FROM audit_logs WHERE entity_type = ? ORDER BY id')
      .all('recurring_billing')
      .map((r) => (r as { action: string }).action);
    expect(audit).toEqual(['create']);
    db.close();
  });

  it('createRecurringBilling: 不正な billingPeriod を拒否', () => {
    const db = bootstrap({ filename: ':memory:' });
    seedProduct(db, 1);
    expect(() =>
      createRecurringBilling(db, {
        productId: 1,
        planName: 'x',
        amountTaxIncluded: 1000,
        billingPeriod: 'weekly' as 'monthly',
        startDate: '2026-01-01',
      }),
    ).toThrow('invalid billingPeriod');
    db.close();
  });

  it('createRecurringBilling: 金額負値を拒否', () => {
    const db = bootstrap({ filename: ':memory:' });
    seedProduct(db, 1);
    expect(() =>
      createRecurringBilling(db, {
        productId: 1,
        planName: 'x',
        amountTaxIncluded: -1,
        billingPeriod: 'monthly',
        startDate: '2026-01-01',
      }),
    ).toThrow('non-negative');
    db.close();
  });

  it('updateRecurringBillingStatus: 正常遷移', () => {
    const db = bootstrap({ filename: ':memory:' });
    seedProduct(db, 1);
    const b = createRecurringBilling(db, {
      productId: 1,
      planName: 'p',
      amountTaxIncluded: 1000,
      billingPeriod: 'monthly',
      startDate: '2026-01-01',
    });
    expect(updateRecurringBillingStatus(db, b.id, 'paused').status).toBe('paused');
    expect(updateRecurringBillingStatus(db, b.id, 'ended').status).toBe('ended');
    expect(updateRecurringBillingStatus(db, b.id, 'active').status).toBe('active');
    db.close();
  });

  it('updateRecurringBillingStatus: 不正値を拒否', () => {
    const db = bootstrap({ filename: ':memory:' });
    seedProduct(db, 1);
    const b = createRecurringBilling(db, {
      productId: 1,
      planName: 'p',
      amountTaxIncluded: 1000,
      billingPeriod: 'monthly',
      startDate: '2026-01-01',
    });
    expect(() => updateRecurringBillingStatus(db, b.id, 'cancelled')).toThrow('invalid status');
    db.close();
  });

  it('listRecurringBillings: next_billing_date ASC で返す', () => {
    const db = bootstrap({ filename: ':memory:' });
    seedProduct(db, 1);
    createRecurringBilling(db, {
      productId: 1,
      planName: 'B',
      amountTaxIncluded: 1000,
      billingPeriod: 'monthly',
      startDate: '2026-06-01',
    });
    createRecurringBilling(db, {
      productId: 1,
      planName: 'A',
      amountTaxIncluded: 1000,
      billingPeriod: 'monthly',
      startDate: '2026-01-01',
    });
    const list = listRecurringBillings(db);
    expect(list.map((b) => b.planName)).toEqual(['A', 'B']);
    db.close();
  });

  it('generateDueBillings: monthly が asOf までに正しい件数生成し next_billing_date が前進する', () => {
    const db = bootstrap({ filename: ':memory:' });
    seedProduct(db, 1);
    const b = createRecurringBilling(db, {
      productId: 1,
      planName: '月額',
      amountTaxIncluded: 5000,
      taxAmount: 500,
      billingPeriod: 'monthly',
      startDate: '2026-01-10',
    });

    // 2026-01-10, 02-10, 03-10 の3件が asOf 2026-03-15 までに生成される
    const result = generateDueBillings(db, '2026-03-15');
    expect(result.asOf).toBe('2026-03-15');
    const mine = result.generated.filter((g) => g.billingId === b.id);
    expect(mine).toHaveLength(3);
    expect(mine.map((g) => g.order.orderedAt)).toEqual(['2026-01-10', '2026-02-10', '2026-03-10']);
    expect(mine[0].order.channel).toBe('recurring');
    expect(mine[0].order.subtotalTaxIncluded).toBe(5000);
    expect(mine[0].order.taxAmount).toBe(500);
    expect(mine[0].order.orderNo).toBe(`RB-${b.id}-2026-01-10`);
    expect(mine[0].order.items).toHaveLength(1);
    expect(mine[0].order.items[0].productId).toBe(1);

    const after = getRecurringBilling(db, b.id);
    expect(after!.nextBillingDate).toBe('2026-04-10');
    expect(after!.lastGeneratedOrderId).toBe(mine[2].order.id);
    db.close();
  });

  it('generateDueBillings: 期日未到来は生成しない(idempotent な再実行)', () => {
    const db = bootstrap({ filename: ':memory:' });
    seedProduct(db, 1);
    const b = createRecurringBilling(db, {
      productId: 1,
      planName: '月額',
      amountTaxIncluded: 1000,
      billingPeriod: 'monthly',
      startDate: '2026-01-10',
    });

    const first = generateDueBillings(db, '2026-02-15');
    expect(first.generated.filter((g) => g.billingId === b.id)).toHaveLength(2);

    // 同じ asOf で再実行しても next_billing_date が前進済みなので 0 件
    const second = generateDueBillings(db, '2026-02-15');
    expect(second.generated.filter((g) => g.billingId === b.id)).toHaveLength(0);
    db.close();
  });

  it('generateDueBillings: paused はスキップ、active のみ生成', () => {
    const db = bootstrap({ filename: ':memory:' });
    seedProduct(db, 1);
    const active = createRecurringBilling(db, {
      productId: 1,
      planName: 'active',
      amountTaxIncluded: 1000,
      billingPeriod: 'monthly',
      startDate: '2026-01-01',
    });
    const paused = createRecurringBilling(db, {
      productId: 1,
      planName: 'paused',
      amountTaxIncluded: 1000,
      billingPeriod: 'monthly',
      startDate: '2026-01-01',
    });
    updateRecurringBillingStatus(db, paused.id, 'paused');

    const result = generateDueBillings(db, '2026-01-15');
    expect(result.generated.some((g) => g.billingId === active.id)).toBe(true);
    expect(result.generated.some((g) => g.billingId === paused.id)).toBe(false);

    // paused の next_billing_date は変わらない
    expect(getRecurringBilling(db, paused.id)!.nextBillingDate).toBe('2026-01-01');
    db.close();
  });

  it('generateDueBillings: yearly は12ヶ月繰り上げ', () => {
    const db = bootstrap({ filename: ':memory:' });
    seedProduct(db, 1);
    const b = createRecurringBilling(db, {
      productId: 1,
      planName: '年額',
      amountTaxIncluded: 50000,
      billingPeriod: 'yearly',
      startDate: '2024-03-01',
    });

    const result = generateDueBillings(db, '2026-06-01');
    const mine = result.generated.filter((g) => g.billingId === b.id);
    // 2024-03-01, 2025-03-01, 2026-03-01 の3件
    expect(mine.map((g) => g.order.orderedAt)).toEqual(['2024-03-01', '2025-03-01', '2026-03-01']);
    expect(getRecurringBilling(db, b.id)!.nextBillingDate).toBe('2027-03-01');
    db.close();
  });

  it('generateDueBillings: billing 側に generate 監査が1注文ごとに残る', () => {
    const db = bootstrap({ filename: ':memory:' });
    seedProduct(db, 1);
    const b = createRecurringBilling(db, {
      productId: 1,
      planName: 'p',
      amountTaxIncluded: 1000,
      billingPeriod: 'monthly',
      startDate: '2026-01-01',
    });
    generateDueBillings(db, '2026-03-15');

    const generateAudit = db
      .prepare('SELECT COUNT(*) AS n FROM audit_logs WHERE entity_type = ? AND entity_id = ? AND action = ?')
      .get('recurring_billing', String(b.id), 'generate') as { n: number };
    expect(generateAudit.n).toBe(3);

    // order 側にも create 監査
    const orderAudit = db
      .prepare('SELECT COUNT(*) AS n FROM audit_logs WHERE entity_type = ? AND action = ?')
      .get('order', 'create') as { n: number };
    expect(orderAudit.n).toBe(3);
    db.close();
  });

  it('createRecurringBilling: 不正な startDate を拒否', () => {
    const db = bootstrap({ filename: ':memory:' });
    seedProduct(db, 1);
    expect(() =>
      createRecurringBilling(db, {
        productId: 1,
        planName: 'p',
        amountTaxIncluded: 1000,
        billingPeriod: 'monthly',
        startDate: 'hello',
      }),
    ).toThrow();
    db.close();
  });

  it('createRecurringBilling: 不正な nextBillingDate を拒否', () => {
    const db = bootstrap({ filename: ':memory:' });
    seedProduct(db, 1);
    expect(() =>
      createRecurringBilling(db, {
        productId: 1,
        planName: 'p',
        amountTaxIncluded: 1000,
        billingPeriod: 'monthly',
        startDate: '2026-01-01',
        nextBillingDate: '2026-13-99',
      }),
    ).toThrow();
    db.close();
  });

  it('updateRecurringBilling: 不正な nextBillingDate を拒否', () => {
    const db = bootstrap({ filename: ':memory:' });
    seedProduct(db, 1);
    const b = createRecurringBilling(db, {
      productId: 1,
      planName: 'p',
      amountTaxIncluded: 1000,
      billingPeriod: 'monthly',
      startDate: '2026-01-01',
    });
    expect(() => updateRecurringBilling(db, b.id, { nextBillingDate: 'zzzz' })).toThrow();
    // 不正更新は弾かれ、元の値は変わらない
    expect(getRecurringBilling(db, b.id)!.nextBillingDate).toBe('2026-01-01');
    db.close();
  });

  it('generateDueBillings: 不正な asOf を拒否(字句比較での誤生成を防ぐ)', () => {
    const db = bootstrap({ filename: ':memory:' });
    seedProduct(db, 1);
    createRecurringBilling(db, {
      productId: 1,
      planName: 'p',
      amountTaxIncluded: 1000,
      billingPeriod: 'monthly',
      startDate: '2026-01-01',
    });
    expect(() => generateDueBillings(db, 'zzzz')).toThrow();
    expect(() => generateDueBillings(db, '2026-13-99')).toThrow();
    db.close();
  });

  it('generateDueBillings: 巻き戻しで order_no 衝突しても冪等(再生成せず前進)', () => {
    const db = bootstrap({ filename: ':memory:' });
    seedProduct(db, 1);
    const b = createRecurringBilling(db, {
      productId: 1,
      planName: 'p',
      amountTaxIncluded: 1000,
      billingPeriod: 'monthly',
      startDate: '2026-01-10',
    });

    // 初回: 2026-01-10, 02-10 の2件生成
    const first = generateDueBillings(db, '2026-02-15');
    expect(first.generated.filter((g) => g.billingId === b.id)).toHaveLength(2);
    expect(first.errors).toHaveLength(0);

    // next_billing_date を生成済みの過去日へ巻き戻す
    updateRecurringBilling(db, b.id, { nextBillingDate: '2026-01-10' });

    // 再実行しても order_no 衝突で落ちず、既存注文を再利用して前進(新規生成0・エラー0)
    const ordersBefore = (db.prepare('SELECT COUNT(*) AS n FROM orders').get() as { n: number }).n;
    const second = generateDueBillings(db, '2026-02-15');
    expect(second.errors).toHaveLength(0);
    expect(second.generated.filter((g) => g.billingId === b.id)).toHaveLength(0);
    const ordersAfter = (db.prepare('SELECT COUNT(*) AS n FROM orders').get() as { n: number }).n;
    expect(ordersAfter).toBe(ordersBefore); // 重複注文は作られない
    expect(getRecurringBilling(db, b.id)!.nextBillingDate).toBe('2026-03-10');
    db.close();
  });

  it('generateDueBillings: 1件の異常 billing が他の健全な billing を巻き添えにしない', () => {
    const db = bootstrap({ filename: ':memory:' });
    seedProduct(db, 1);
    const healthy = createRecurringBilling(db, {
      productId: 1,
      planName: 'healthy',
      amountTaxIncluded: 1000,
      billingPeriod: 'monthly',
      startDate: '2026-01-10',
    });
    const broken = createRecurringBilling(db, {
      productId: 1,
      planName: 'broken',
      amountTaxIncluded: 1000,
      billingPeriod: 'monthly',
      startDate: '2026-01-10',
    });
    // broken の金額を service 検証を迂回して負値に書き換え、生成時(createOrder)に失敗させる
    db.prepare('UPDATE recurring_billings SET amount_tax_included = -1 WHERE id = ?').run(broken.id);

    const result = generateDueBillings(db, '2026-02-15');
    // healthy は生成され、broken は errors に記録される
    expect(result.generated.filter((g) => g.billingId === healthy.id).length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.billingId === broken.id)).toBe(true);
    // healthy の next_billing_date は前進している(巻き添えロールバックなし)
    expect(getRecurringBilling(db, healthy.id)!.nextBillingDate).toBe('2026-03-10');
    db.close();
  });

  it('deleteRecurringBilling: 削除と監査、存在しない id は throw', () => {
    const db = bootstrap({ filename: ':memory:' });
    seedProduct(db, 1);
    const b = createRecurringBilling(db, {
      productId: 1,
      planName: 'p',
      amountTaxIncluded: 1000,
      billingPeriod: 'monthly',
      startDate: '2026-01-01',
    });
    deleteRecurringBilling(db, b.id);
    expect(getRecurringBilling(db, b.id)).toBeNull();
    expect(() => deleteRecurringBilling(db, 9999)).toThrow('recurring billing not found');
    db.close();
  });
});
