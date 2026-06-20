import { describe, expect, it } from 'vitest';
import { bootstrap } from '../src/db/bootstrap.js';
import type { DB } from '../src/db/connection.js';
import {
  createOrder,
  deleteOrder,
  exportOrdersCsv,
  getOrder,
  importOrdersCsv,
  listOrders,
  monthlySummary,
  updateDeliveryStatus,
  updateOrder,
  updatePaymentStatus,
  updateRefundStatus,
} from '../src/services/sales.js';

const BASE_ORDER = {
  orderNo: 'ORD-VAL-001',
  orderedAt: '2026-06-01',
  channel: 'direct',
  subtotalTaxIncluded: 1_000,
  taxAmount: 100,
} as const;

describe('sales service', () => {
  it('注文CRUDとステータス更新で監査ログを記録する', () => {
    const db = bootstrap({ filename: ':memory:' });
    const productId = seedProduct(db);

    const created = createOrder(db, {
      orderNo: 'ORD-001',
      orderedAt: '2026-06-09',
      channel: 'direct',
      subtotalTaxIncluded: 11_000,
      taxAmount: 1_000,
      items: [{ productId, quantity: 2, unitPriceTaxIncluded: 5_500 }],
      invoice: {
        invoiceNo: 'INV-001',
        issuedAt: '2026-06-10',
        buyerName: '合同会社サンプル',
        qualifiedInvoiceFlag: true,
        taxRateSummary: '{"10":1000}',
      },
    });

    expect(created).toMatchObject({
      id: expect.any(Number),
      orderNo: 'ORD-001',
      paymentStatus: 'pending',
      deliveryStatus: 'not_delivered',
      refundStatus: 'none',
      subtotalTaxIncluded: 11_000,
      taxAmount: 1_000,
    });
    expect(created.items).toHaveLength(1);
    expect(created.invoice).toMatchObject({ invoiceNo: 'INV-001', qualifiedInvoiceFlag: true });

    const updated = updateOrder(db, created.id, { channel: 'booth', subtotalTaxIncluded: 12_100, taxAmount: 1_100 });
    expect(updated).toMatchObject({ channel: 'booth', subtotalTaxIncluded: 12_100, taxAmount: 1_100 });

    expect(updatePaymentStatus(db, created.id, 'paid')?.paymentStatus).toBe('paid');
    expect(updateDeliveryStatus(db, created.id, 'delivered')?.deliveryStatus).toBe('delivered');
    expect(updateRefundStatus(db, created.id, 'refunded')?.refundStatus).toBe('refunded');

    expect(deleteOrder(db, created.id)).toBe(true);
    expect(getOrder(db, created.id)).toBeNull();

    const auditActions = db
      .prepare('SELECT action FROM audit_logs WHERE entity_type = ? ORDER BY id ASC')
      .all('order')
      .map((row) => (row as { action: string }).action);
    expect(auditActions).toEqual(['create', 'update', 'update', 'update', 'update', 'delete']);
    db.close();
  });

  it('CSV export/import の往復で注文・明細・請求書データを保持する', () => {
    const sourceDb = bootstrap({ filename: ':memory:' });
    const sourceProductId = seedProduct(sourceDb);
    createOrder(sourceDb, {
      orderNo: 'ORD-CSV-001',
      orderedAt: '2026-06-15',
      channel: 'store',
      subtotalTaxIncluded: 22_000,
      taxAmount: 2_000,
      paymentStatus: 'paid',
      deliveryStatus: 'delivered',
      refundStatus: 'none',
      items: [{ productId: sourceProductId, quantity: 1, unitPriceTaxIncluded: 22_000 }],
      invoice: {
        invoiceNo: 'INV-CSV-001',
        issuedAt: '2026-06-16',
        buyerName: '株式会社CSV',
        qualifiedInvoiceFlag: true,
        taxRateSummary: '{"10":2000}',
      },
    });

    const csv = exportOrdersCsv(sourceDb);
    const targetDb = bootstrap({ filename: ':memory:' });
    seedProduct(targetDb, sourceProductId);
    const result = importOrdersCsv(targetDb, csv);
    const imported = listOrders(targetDb);

    expect(result).toEqual({ imported: 1, created: 1, updated: 0 });
    expect(imported).toHaveLength(1);
    expect(imported[0]).toMatchObject({
      orderNo: 'ORD-CSV-001',
      orderedAt: '2026-06-15',
      channel: 'store',
      subtotalTaxIncluded: 22_000,
      taxAmount: 2_000,
      paymentStatus: 'paid',
      deliveryStatus: 'delivered',
    });
    expect(imported[0]?.items[0]).toMatchObject({ productId: sourceProductId, quantity: 1, unitPriceTaxIncluded: 22_000 });
    expect(imported[0]?.invoice).toMatchObject({ invoiceNo: 'INV-CSV-001', buyerName: '株式会社CSV' });
    sourceDb.close();
    targetDb.close();
  });

  it('monthlySummary は年月別に整数金額を集計する', () => {
    const db = bootstrap({ filename: ':memory:' });
    createOrder(db, {
      orderNo: 'ORD-SUM-001',
      orderedAt: '2026-06-01',
      channel: 'direct',
      subtotalTaxIncluded: 11_000,
      taxAmount: 1_000,
      paymentStatus: 'paid',
      refundStatus: 'none',
    });
    createOrder(db, {
      orderNo: 'ORD-SUM-002',
      orderedAt: '2026-06-30',
      channel: 'direct',
      subtotalTaxIncluded: 5_500,
      taxAmount: 500,
      paymentStatus: 'pending',
      refundStatus: 'refunded',
    });
    createOrder(db, {
      orderNo: 'ORD-SUM-003',
      orderedAt: '2026-07-01',
      channel: 'direct',
      subtotalTaxIncluded: 3_300,
      taxAmount: 300,
      paymentStatus: 'pending',
    });

    expect(monthlySummary(db)).toEqual([
      {
        month: '2026-06',
        salesTaxIncluded: 16_500,
        taxAmount: 1_500,
        uncollectedAmount: 5_500,
        refundAmount: 5_500,
        orderCount: 2,
      },
      {
        month: '2026-07',
        salesTaxIncluded: 3_300,
        taxAmount: 300,
        uncollectedAmount: 3_300,
        refundAmount: 0,
        orderCount: 1,
      },
    ]);
    expect(monthlySummary(db, '2026-06')).toHaveLength(1);
    db.close();
  });
});

describe('金額・数量バリデーション (characterization)', () => {
  it('subtotalTaxIncluded=-1 で createOrder が throw する', () => {
    const db = bootstrap({ filename: ':memory:' });
    expect(() =>
      createOrder(db, { ...BASE_ORDER, orderNo: 'ORD-V-01', subtotalTaxIncluded: -1 }),
    ).toThrow(/non-negative/);
    db.close();
  });

  it('unitPriceTaxIncluded=-1 で createOrder が throw する', () => {
    const db = bootstrap({ filename: ':memory:' });
    const productId = seedProduct(db);
    expect(() =>
      createOrder(db, {
        ...BASE_ORDER,
        orderNo: 'ORD-V-02',
        items: [{ productId, quantity: 1, unitPriceTaxIncluded: -1 }],
      }),
    ).toThrow(/non-negative/);
    db.close();
  });

  it('quantity=0 で createOrder が throw する', () => {
    const db = bootstrap({ filename: ':memory:' });
    const productId = seedProduct(db);
    expect(() =>
      createOrder(db, {
        ...BASE_ORDER,
        orderNo: 'ORD-V-03',
        items: [{ productId, quantity: 0, unitPriceTaxIncluded: 1_000 }],
      }),
    ).toThrow(/positive/);
    db.close();
  });

  it('quantity=-1 で createOrder が throw する', () => {
    const db = bootstrap({ filename: ':memory:' });
    const productId = seedProduct(db);
    expect(() =>
      createOrder(db, {
        ...BASE_ORDER,
        orderNo: 'ORD-V-04',
        items: [{ productId, quantity: -1, unitPriceTaxIncluded: 1_000 }],
      }),
    ).toThrow(/positive/);
    db.close();
  });

  it('taxAmount=-1 で createOrder が throw する', () => {
    const db = bootstrap({ filename: ':memory:' });
    expect(() =>
      createOrder(db, { ...BASE_ORDER, orderNo: 'ORD-V-05', taxAmount: -1 }),
    ).toThrow(/non-negative/);
    db.close();
  });

  it('subtotalTaxIncluded=-1 で updateOrder が throw する', () => {
    const db = bootstrap({ filename: ':memory:' });
    const order = createOrder(db, { ...BASE_ORDER, orderNo: 'ORD-V-06' });
    expect(() => updateOrder(db, order.id, { subtotalTaxIncluded: -1 })).toThrow(/non-negative/);
    db.close();
  });

  it('taxAmount=-1 で updateOrder が throw する', () => {
    const db = bootstrap({ filename: ':memory:' });
    const order = createOrder(db, { ...BASE_ORDER, orderNo: 'ORD-V-07' });
    expect(() => updateOrder(db, order.id, { taxAmount: -1 })).toThrow(/non-negative/);
    db.close();
  });

  it('subtotalTaxIncluded=0 は許容される(無料商品)', () => {
    const db = bootstrap({ filename: ':memory:' });
    const order = createOrder(db, { ...BASE_ORDER, orderNo: 'ORD-V-08', subtotalTaxIncluded: 0, taxAmount: 0 });
    expect(order.subtotalTaxIncluded).toBe(0);
    db.close();
  });

  it('CSV取込で負の subtotalTaxIncluded を含む行は throw する', () => {
    const csv =
      'orderNo,customerId,orderedAt,channel,subtotalTaxIncluded,taxAmount,paymentStatus,deliveryStatus,refundStatus,itemsJson,invoiceNo,invoiceIssuedAt,buyerName,qualifiedInvoiceFlag,taxRateSummary,attachmentId\n' +
      'ORD-CSV-NEG,,2026-06-01,direct,-500,,pending,not_delivered,none,,,,,,,' ;
    const db = bootstrap({ filename: ':memory:' });
    expect(() => importOrdersCsv(db, csv)).toThrow(/non-negative/);
    db.close();
  });
});

function seedProduct(db: DB, id?: number): number {
  const params = {
    id: id ?? null,
    sku: `SKU-${id ?? 'AUTO'}`,
    title: 'テスト商品',
    productType: 'download',
    priceTaxIncluded: 11_000,
  };
  const result = db
    .prepare(
      `INSERT INTO products (id, sku, title, product_type, price_tax_included)
       VALUES (@id, @sku, @title, @productType, @priceTaxIncluded)`,
    )
    .run(params);
  return id ?? Number(result.lastInsertRowid);
}
