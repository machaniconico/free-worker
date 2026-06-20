import { describe, expect, it } from 'vitest';
import { bootstrap } from '../src/db/bootstrap.js';
import { accountsReceivableAging } from '../src/services/ar-aging.js';
import { createOrder } from '../src/services/sales.js';

/** asOf からの相対日付を返す (offset < 0 = 過去) */
function relativeDate(asOf: string, offsetDays: number): string {
  const d = new Date(asOf);
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

describe('accountsReceivableAging', () => {
  const AS_OF = '2026-06-20';

  it('空DB: buckets が4つとも 0、total が 0、orders が空', () => {
    const db = bootstrap({ filename: ':memory:' });
    const report = accountsReceivableAging(db, AS_OF);
    expect(report.asOf).toBe(AS_OF);
    expect(report.buckets).toHaveLength(4);
    expect(report.buckets.map((b) => b.label)).toEqual(['0-30', '31-60', '61-90', '90+']);
    expect(report.buckets.every((b) => b.count === 0 && b.amount === 0)).toBe(true);
    expect(report.total).toEqual({ count: 0, amount: 0 });
    expect(report.orders).toHaveLength(0);
    db.close();
  });

  it('全 paid: buckets が4つとも 0、total が 0', () => {
    const db = bootstrap({ filename: ':memory:' });
    createOrder(db, { orderNo: 'PAID-001', orderedAt: relativeDate(AS_OF, -10), channel: 'direct', subtotalTaxIncluded: 10_000, paymentStatus: 'paid' });
    createOrder(db, { orderNo: 'PAID-002', orderedAt: relativeDate(AS_OF, -50), channel: 'direct', subtotalTaxIncluded: 5_000, paymentStatus: 'paid' });
    const report = accountsReceivableAging(db, AS_OF);
    expect(report.buckets.every((b) => b.count === 0 && b.amount === 0)).toBe(true);
    expect(report.total).toEqual({ count: 0, amount: 0 });
    expect(report.orders).toHaveLength(0);
    db.close();
  });

  it('全 cancelled: buckets が4つとも 0', () => {
    const db = bootstrap({ filename: ':memory:' });
    createOrder(db, { orderNo: 'CAN-001', orderedAt: relativeDate(AS_OF, -10), channel: 'direct', subtotalTaxIncluded: 8_000, paymentStatus: 'cancelled' });
    const report = accountsReceivableAging(db, AS_OF);
    expect(report.buckets.every((b) => b.count === 0 && b.amount === 0)).toBe(true);
    expect(report.total).toEqual({ count: 0, amount: 0 });
    db.close();
  });

  it('バケット境界: 10日→0-30、45日→31-60、75日→61-90、120日→90+', () => {
    const db = bootstrap({ filename: ':memory:' });
    // pending/overdue 等の未入金ステータスが対象
    createOrder(db, { orderNo: 'AG-010', orderedAt: relativeDate(AS_OF, -10), channel: 'direct', subtotalTaxIncluded: 1_000, paymentStatus: 'pending' });
    createOrder(db, { orderNo: 'AG-045', orderedAt: relativeDate(AS_OF, -45), channel: 'direct', subtotalTaxIncluded: 2_000, paymentStatus: 'pending' });
    createOrder(db, { orderNo: 'AG-075', orderedAt: relativeDate(AS_OF, -75), channel: 'direct', subtotalTaxIncluded: 3_000, paymentStatus: 'overdue' });
    createOrder(db, { orderNo: 'AG-120', orderedAt: relativeDate(AS_OF, -120), channel: 'direct', subtotalTaxIncluded: 4_000, paymentStatus: 'overdue' });

    const report = accountsReceivableAging(db, AS_OF);
    expect(report.asOf).toBe(AS_OF);

    const byLabel = new Map(report.buckets.map((b) => [b.label, b]));
    expect(byLabel.get('0-30')).toMatchObject({ count: 1, amount: 1_000 });
    expect(byLabel.get('31-60')).toMatchObject({ count: 1, amount: 2_000 });
    expect(byLabel.get('61-90')).toMatchObject({ count: 1, amount: 3_000 });
    expect(byLabel.get('90+')).toMatchObject({ count: 1, amount: 4_000 });

    expect(report.total).toEqual({ count: 4, amount: 10_000 });
    db.close();
  });

  it('paid/cancelled は除外され、未入金だけが集計される', () => {
    const db = bootstrap({ filename: ':memory:' });
    createOrder(db, { orderNo: 'MIX-001', orderedAt: relativeDate(AS_OF, -10), channel: 'direct', subtotalTaxIncluded: 5_000, paymentStatus: 'pending' });
    createOrder(db, { orderNo: 'MIX-002', orderedAt: relativeDate(AS_OF, -20), channel: 'direct', subtotalTaxIncluded: 3_000, paymentStatus: 'paid' });
    createOrder(db, { orderNo: 'MIX-003', orderedAt: relativeDate(AS_OF, -30), channel: 'direct', subtotalTaxIncluded: 2_000, paymentStatus: 'cancelled' });
    createOrder(db, { orderNo: 'MIX-004', orderedAt: relativeDate(AS_OF, -5), channel: 'direct', subtotalTaxIncluded: 1_000, paymentStatus: 'overdue' });

    const report = accountsReceivableAging(db, AS_OF);
    expect(report.total).toEqual({ count: 2, amount: 6_000 });
    expect(report.orders.map((o) => o.orderNo).sort()).toEqual(['MIX-001', 'MIX-004']);
    db.close();
  });

  it('orders が daysOutstanding 降順(古い=督促優先)でソートされる', () => {
    const db = bootstrap({ filename: ':memory:' });
    createOrder(db, { orderNo: 'SORT-005', orderedAt: relativeDate(AS_OF, -5), channel: 'direct', subtotalTaxIncluded: 1_000, paymentStatus: 'pending' });
    createOrder(db, { orderNo: 'SORT-100', orderedAt: relativeDate(AS_OF, -100), channel: 'direct', subtotalTaxIncluded: 2_000, paymentStatus: 'overdue' });
    createOrder(db, { orderNo: 'SORT-050', orderedAt: relativeDate(AS_OF, -50), channel: 'direct', subtotalTaxIncluded: 3_000, paymentStatus: 'pending' });

    const report = accountsReceivableAging(db, AS_OF);
    const labels = report.orders.map((o) => o.orderNo);
    expect(labels).toEqual(['SORT-100', 'SORT-050', 'SORT-005']);
    db.close();
  });

  it('customerName の解決: 顧客あり→ display_name、顧客なし→null', () => {
    const db = bootstrap({ filename: ':memory:' });
    // 顧客を直接 INSERT (createCustomer 呼び出し省略)
    db.prepare(`INSERT INTO customers (id, display_name) VALUES (?, ?)`).run(1, 'テスト顧客');

    createOrder(db, { orderNo: 'CUST-001', orderedAt: relativeDate(AS_OF, -10), channel: 'direct', subtotalTaxIncluded: 1_000, paymentStatus: 'pending', customerId: 1 });
    createOrder(db, { orderNo: 'CUST-002', orderedAt: relativeDate(AS_OF, -20), channel: 'direct', subtotalTaxIncluded: 2_000, paymentStatus: 'pending', customerId: null });

    const report = accountsReceivableAging(db, AS_OF);
    const byNo = new Map(report.orders.map((o) => [o.orderNo, o]));

    expect(byNo.get('CUST-001')).toMatchObject({ customerId: 1, customerName: 'テスト顧客' });
    expect(byNo.get('CUST-002')).toMatchObject({ customerId: null, customerName: null });
    db.close();
  });

  it('daysOutstanding: asOf より未来の ordered_at は 0 にクランプされる', () => {
    const db = bootstrap({ filename: ':memory:' });
    // asOf より5日未来の注文(通常起こらないが境界確認)
    createOrder(db, { orderNo: 'FUTURE-001', orderedAt: relativeDate(AS_OF, 5), channel: 'direct', subtotalTaxIncluded: 1_000, paymentStatus: 'pending' });
    const report = accountsReceivableAging(db, AS_OF);
    expect(report.orders[0]!.daysOutstanding).toBe(0);
    expect(report.orders[0]!.bucket).toBe('0-30');
    db.close();
  });

  it('asOf 省略時は today 基準で動作し report が返る', () => {
    const db = bootstrap({ filename: ':memory:' });
    createOrder(db, { orderNo: 'DEF-001', orderedAt: '2026-01-01', channel: 'direct', subtotalTaxIncluded: 9_000, paymentStatus: 'pending' });
    const report = accountsReceivableAging(db);
    expect(report.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(report.total.count).toBe(1);
    db.close();
  });

  it('バケット境界値: 30日→0-30、31日→31-60、60日→31-60、61日→61-90、90日→61-90、91日→90+', () => {
    const db = bootstrap({ filename: ':memory:' });
    const cases: [number, AgingBucketLabel][] = [
      [-30, '0-30'],
      [-31, '31-60'],
      [-60, '31-60'],
      [-61, '61-90'],
      [-90, '61-90'],
      [-91, '90+'],
    ];
    for (const [offset, _] of cases) {
      createOrder(db, {
        orderNo: `BOUND${Math.abs(offset)}`,
        orderedAt: relativeDate(AS_OF, offset),
        channel: 'direct',
        subtotalTaxIncluded: 1_000,
        paymentStatus: 'pending',
      });
    }
    const report = accountsReceivableAging(db, AS_OF);
    const byNo = new Map(report.orders.map((o) => [o.orderNo, o]));
    for (const [offset, expectedBucket] of cases) {
      const no = `BOUND${Math.abs(offset)}`;
      expect(byNo.get(no)?.bucket, `orderNo=${no} offset=${offset}`).toBe(expectedBucket);
    }
    db.close();
  });
});

type AgingBucketLabel = '0-30' | '31-60' | '61-90' | '90+';
