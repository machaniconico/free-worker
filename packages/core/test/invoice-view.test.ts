import { describe, expect, it } from 'vitest';
import { bootstrap } from '../src/db/bootstrap.js';
import type { DB } from '../src/db/connection.js';
import { taxFromInclusive, TAX_RATE_REDUCED, TAX_RATE_STANDARD } from '../src/util/money.js';
import { buildInvoiceView } from '../src/services/invoice-view.js';

describe('invoice view service', () => {
  it('適格請求書の表示データを注文・明細・商品・事業者プロフィールから組み立てる', () => {
    const db = bootstrap({ filename: ':memory:' });
    addProductTaxRateColumn(db);
    seedProfile(db, 'Local Works', 'T1234567890123');
    const standardProductId = seedProduct(db, { sku: 'STD-001', title: '標準税率商品', taxRate: 10 });
    const reducedProductId = seedProduct(db, { sku: 'RED-001', title: '軽減税率商品', taxRate: 8 });
    const orderId = seedOrder(db, {
      orderNo: 'ORD-VIEW-001',
      buyerName: '株式会社ビュー',
      items: [
        { productId: standardProductId, quantity: 2, unitPriceTaxIncluded: 11_000 },
        { productId: reducedProductId, quantity: 3, unitPriceTaxIncluded: 1_080 },
      ],
    });

    const view = buildInvoiceView(db, orderId);

    expect(view).toMatchObject({
      qualified: true,
      issuer: {
        name: 'Local Works',
        invoiceRegistrationNumber: 'T1234567890123',
      },
      buyer: { name: '株式会社ビュー' },
      order: {
        id: orderId,
        orderNo: 'ORD-VIEW-001',
        orderedAt: '2026-06-09',
      },
      totalTaxIncluded: 25_240,
    });
    expect(view?.items).toEqual([
      {
        id: expect.any(Number),
        productId: standardProductId,
        productTitle: '標準税率商品',
        quantity: 2,
        unitPriceTaxIncluded: 11_000,
        subtotalTaxIncluded: 22_000,
        taxRate: 10,
      },
      {
        id: expect.any(Number),
        productId: reducedProductId,
        productTitle: '軽減税率商品',
        quantity: 3,
        unitPriceTaxIncluded: 1_080,
        subtotalTaxIncluded: 3_240,
        taxRate: 8,
      },
    ]);
    expect(view?.taxRateBreakdown).toEqual([
      {
        taxRate: 10,
        taxableAmountTaxIncluded: 22_000,
        taxAmount: taxFromInclusive(22_000, TAX_RATE_STANDARD),
      },
      {
        taxRate: 8,
        taxableAmountTaxIncluded: 3_240,
        taxAmount: taxFromInclusive(3_240, TAX_RATE_REDUCED),
      },
    ]);
    db.close();
  });

  it('登録番号が無い場合はqualified=false、存在しない注文はnullを返す', () => {
    const db = bootstrap({ filename: ':memory:' });
    seedProfile(db, 'No Number Studio', null);
    const customerId = seedCustomer(db, '顧客名フォールバック');
    const productId = seedProduct(db, { sku: 'NO-RATE-001', title: '標準税率既定商品' });
    const orderId = seedOrder(db, {
      orderNo: 'ORD-VIEW-002',
      customerId,
      buyerName: null,
      items: [{ productId, quantity: 1, unitPriceTaxIncluded: 5_500 }],
    });

    const view = buildInvoiceView(db, orderId);

    expect(view).toMatchObject({
      qualified: false,
      issuer: {
        name: 'No Number Studio',
        invoiceRegistrationNumber: null,
      },
      buyer: { name: '顧客名フォールバック' },
      taxRateBreakdown: [
        {
          taxRate: 10,
          taxableAmountTaxIncluded: 5_500,
          taxAmount: taxFromInclusive(5_500, TAX_RATE_STANDARD),
        },
        {
          taxRate: 8,
          taxableAmountTaxIncluded: 0,
          taxAmount: 0,
        },
      ],
    });
    expect(buildInvoiceView(db, 999_999)).toBeNull();
    db.close();
  });
});

function addProductTaxRateColumn(db: DB): void {
  db.prepare('ALTER TABLE products ADD COLUMN tax_rate INTEGER NOT NULL DEFAULT 10').run();
}

function seedProfile(db: DB, tradeName: string, invoiceRegistrationNumber: string | null): void {
  db.prepare(
    `INSERT INTO business_profiles (trade_name, legal_name_public_policy, invoice_registration_number)
     VALUES (@tradeName, @legalNamePublicPolicy, @invoiceRegistrationNumber)`,
  ).run({
    tradeName,
    legalNamePublicPolicy: '公開名',
    invoiceRegistrationNumber,
  });
}

function seedCustomer(db: DB, displayName: string): number {
  const result = db.prepare('INSERT INTO customers (display_name) VALUES (?)').run(displayName);
  return Number(result.lastInsertRowid);
}

function seedProduct(db: DB, input: { sku: string; title: string; taxRate?: 10 | 8 }): number {
  const hasTaxRate = hasColumn(db, 'products', 'tax_rate');
  const result = hasTaxRate
    ? db
        .prepare(
          `INSERT INTO products (sku, title, product_type, price_tax_included, tax_rate)
           VALUES (@sku, @title, @productType, @priceTaxIncluded, @taxRate)`,
        )
        .run({
          sku: input.sku,
          title: input.title,
          productType: 'download',
          priceTaxIncluded: 11_000,
          taxRate: input.taxRate ?? 10,
        })
    : db
        .prepare(
          `INSERT INTO products (sku, title, product_type, price_tax_included)
           VALUES (@sku, @title, @productType, @priceTaxIncluded)`,
        )
        .run({
          sku: input.sku,
          title: input.title,
          productType: 'download',
          priceTaxIncluded: 11_000,
        });
  return Number(result.lastInsertRowid);
}

function seedOrder(
  db: DB,
  input: {
    orderNo: string;
    customerId?: number | null;
    buyerName: string | null;
    items: Array<{ productId: number; quantity: number; unitPriceTaxIncluded: number }>;
  },
): number {
  const total = input.items.reduce((sum, item) => sum + item.quantity * item.unitPriceTaxIncluded, 0);
  const order = db
    .prepare(
      `INSERT INTO orders (order_no, customer_id, ordered_at, channel, subtotal_tax_included, tax_amount)
       VALUES (@orderNo, @customerId, @orderedAt, @channel, @subtotalTaxIncluded, @taxAmount)`,
    )
    .run({
      orderNo: input.orderNo,
      customerId: input.customerId ?? null,
      orderedAt: '2026-06-09',
      channel: 'direct',
      subtotalTaxIncluded: total,
      taxAmount: taxFromInclusive(total),
    });
  const orderId = Number(order.lastInsertRowid);
  const insertItem = db.prepare(
    `INSERT INTO order_items (order_id, product_id, quantity, unit_price_tax_included)
     VALUES (@orderId, @productId, @quantity, @unitPriceTaxIncluded)`,
  );
  for (const item of input.items) {
    insertItem.run({ orderId, ...item });
  }
  db.prepare(
    `INSERT INTO invoices (invoice_no, order_id, issued_at, buyer_name, qualified_invoice_flag)
     VALUES (@invoiceNo, @orderId, @issuedAt, @buyerName, @qualifiedInvoiceFlag)`,
  ).run({
    invoiceNo: `INV-${input.orderNo}`,
    orderId,
    issuedAt: '2026-06-10',
    buyerName: input.buyerName,
    qualifiedInvoiceFlag: 1,
  });
  return orderId;
}

function hasColumn(db: DB, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}
