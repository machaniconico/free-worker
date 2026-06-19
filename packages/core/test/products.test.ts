import { describe, expect, it } from 'vitest';
import { bootstrap } from '../src/db/bootstrap.js';
import {
  checkProductCompleteness,
  createProduct,
  createSubscriptionPlan,
  deleteProduct,
  deleteSubscriptionPlan,
  getProduct,
  getSubscriptionPlan,
  listProducts,
  listSubscriptionPlansForProduct,
  updateProduct,
  updateSubscriptionPlan,
  type Product,
  type SubscriptionPlan,
} from '../src/services/products.js';

describe('product service', () => {
  it('価格は非負整数かつ上限内のみ許可する(オーバーフロー防止)', () => {
    const db = bootstrap({ filename: ':memory:' });
    const base = { sku: 'PR-LIMIT', title: '上限テスト', productType: 'download' as const };

    // 上限(10億円)ちょうどは許可。
    expect(createProduct(db, { ...base, sku: 'PR-OK', priceTaxIncluded: 1_000_000_000 }).priceTaxIncluded).toBe(
      1_000_000_000,
    );
    // 上限超過は拒否。
    expect(() => createProduct(db, { ...base, sku: 'PR-OVER', priceTaxIncluded: 1_000_000_001 })).toThrow(
      /integer yen/,
    );
    // 負値は拒否。
    expect(() => createProduct(db, { ...base, sku: 'PR-NEG', priceTaxIncluded: -1 })).toThrow(/integer yen/);
    db.close();
  });

  it('creates, lists, gets, updates, and deletes products with audit logs', () => {
    const db = bootstrap({ filename: ':memory:' });

    const created = createProduct(db, {
      sku: 'FW-TPL-001',
      title: '業務テンプレート',
      productType: 'template',
      priceTaxIncluded: 3300,
      licenseSummary: '1名の事業利用可',
      operatingEnvironment: 'Excel 2021以降',
      refundPolicy: 'デジタル商品のため提供後返金不可',
      status: 'active',
    });
    expect(created).toMatchObject({
      id: expect.any(Number),
      sku: 'FW-TPL-001',
      title: '業務テンプレート',
      priceTaxIncluded: 3300,
      currency: 'JPY',
      createdAt: expect.any(String),
    });
    expect(listProducts(db)).toHaveLength(1);
    expect(getProduct(db, created.id)?.sku).toBe('FW-TPL-001');

    const updated = updateProduct(db, created.id, {
      title: '業務テンプレートPro',
      priceTaxIncluded: 4400,
      refundPolicy: null,
    });
    expect(updated).toMatchObject({
      id: created.id,
      title: '業務テンプレートPro',
      priceTaxIncluded: 4400,
      refundPolicy: null,
    });

    expect(() =>
      createProduct(db, {
        sku: 'BAD-PRICE',
        title: 'Bad',
        productType: 'download',
        priceTaxIncluded: 100.5,
      }),
    ).toThrow(/integer yen/);

    expect(deleteProduct(db, created.id)).toBe(true);
    expect(getProduct(db, created.id)).toBeNull();

    const audits = db
      .prepare(
        `SELECT action, entity_type, entity_id, before_json, after_json
         FROM audit_logs
         WHERE entity_type = ?
         ORDER BY id ASC`,
      )
      .all('product') as Array<{
      action: string;
      entity_type: string;
      entity_id: string;
      before_json: string | null;
      after_json: string | null;
    }>;
    expect(audits.map((row) => row.action)).toEqual(['create', 'update', 'delete']);
    expect(audits.every((row) => row.entity_id === String(created.id))).toBe(true);
    expect(JSON.parse(audits[0]?.after_json ?? '{}')).toMatchObject({ sku: 'FW-TPL-001' });
    expect(JSON.parse(audits[1]?.before_json ?? '{}')).toMatchObject({ priceTaxIncluded: 3300 });
    expect(JSON.parse(audits[1]?.after_json ?? '{}')).toMatchObject({ priceTaxIncluded: 4400 });
    expect(JSON.parse(audits[2]?.before_json ?? '{}')).toMatchObject({ title: '業務テンプレートPro' });

    db.close();
  });

  it('creates, lists, gets, updates, and deletes subscription plans with audit logs', () => {
    const db = bootstrap({ filename: ':memory:' });
    const product = createProduct(db, {
      sku: 'FW-MEM-001',
      title: '月額会員',
      productType: 'membership',
      priceTaxIncluded: 1980,
    });

    const plan = createSubscriptionPlan(db, {
      productId: product.id,
      planName: '月額',
      billingPeriod: 'monthly',
      renewalPolicy: '毎月1日に税込1,980円を請求',
      cancellationPolicy: '次回更新日前日までに会員画面で解約',
      postCancelAccessPolicy: '解約月末まで閲覧可能',
    });
    expect(plan).toMatchObject({
      id: expect.any(Number),
      productId: product.id,
      planName: '月額',
      billingPeriod: 'monthly',
    });
    expect(listSubscriptionPlansForProduct(db, product.id)).toHaveLength(1);
    expect(getSubscriptionPlan(db, plan.id)?.planName).toBe('月額');

    const updated = updateSubscriptionPlan(db, plan.id, {
      planName: '月額スタンダード',
      trialPolicy: '14日間無料',
    });
    expect(updated).toMatchObject({ id: plan.id, planName: '月額スタンダード', trialPolicy: '14日間無料' });

    expect(deleteSubscriptionPlan(db, plan.id)).toBe(true);
    expect(getSubscriptionPlan(db, plan.id)).toBeNull();

    const audits = db
      .prepare('SELECT action FROM audit_logs WHERE entity_type = ? ORDER BY id ASC')
      .all('subscription_plan') as Array<{ action: string }>;
    expect(audits.map((row) => row.action)).toEqual(['create', 'update', 'delete']);

    db.close();
  });

  it('returns warnings for missing product page fields and subscription conditions', () => {
    const product = {
      productType: 'membership',
      priceTaxIncluded: 1200.25,
      licenseSummary: '',
      operatingEnvironment: null,
      refundPolicy: undefined,
    } as unknown as Product;
    const plan = {
      billingPeriod: 'monthly',
      renewalPolicy: '',
      cancellationPolicy: null,
      postCancelAccessPolicy: ' ',
    } as unknown as SubscriptionPlan;

    const result = checkProductCompleteness(product, [plan]);

    expect(result.complete).toBe(false);
    expect(result.warnings.map((warning) => warning.field)).toEqual([
      'priceTaxIncluded',
      'operatingEnvironment',
      'licenseSummary',
      'refundPolicy',
      'plans[0].renewalPolicy',
      'plans[0].cancellationPolicy',
      'plans[0].postCancelAccessPolicy',
    ]);
    expect(result.warnings.every((warning) => warning.reason.includes('S'))).toBe(true);
  });

  it('returns no warnings when product page fields and subscription conditions are complete', () => {
    const product = {
      productType: 'membership',
      priceTaxIncluded: 1200,
      licenseSummary: '1契約1名まで利用可能',
      operatingEnvironment: 'Chrome最新版、macOS 14以降またはWindows 11',
      refundPolicy: '初回決済から7日以内は返金可',
    } as Product;
    const plan = {
      billingPeriod: 'monthly',
      renewalPolicy: '毎月契約日に税込1,200円で自動更新',
      cancellationPolicy: '更新日前日までに会員画面から解約',
      postCancelAccessPolicy: '解約後も当月末まで閲覧可',
    } as SubscriptionPlan;

    expect(checkProductCompleteness(product, [plan])).toEqual({ complete: true, warnings: [] });
  });
});
