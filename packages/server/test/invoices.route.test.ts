import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bootstrap, taxFromInclusive, TAX_RATE_REDUCED, TAX_RATE_STANDARD, type DB } from '@free-worker/core';
import { invoiceRoutes } from '../src/routes/invoices.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: DB;
  }
}

let app: FastifyInstance;
let db: DB;

beforeEach(async () => {
  db = bootstrap({ filename: ':memory:' });
  addProductTaxRateColumn(db);
  app = Fastify({ logger: false });
  app.decorate('db', db);
  await app.register(invoiceRoutes);
});

afterEach(async () => {
  await app.close();
  db.close();
});

describe('invoiceRoutes', () => {
  it('請求書印刷ビュー用のデータを返す', async () => {
    seedProfile(db, 'Route Works', 'T9876543210987');
    const standardProductId = seedProduct(db, { sku: 'R-STD-001', title: '標準商品', taxRate: 10 });
    const reducedProductId = seedProduct(db, { sku: 'R-RED-001', title: '軽減商品', taxRate: 8 });
    const orderId = seedOrder(db, {
      orderNo: 'ROUTE-INV-001',
      buyerName: 'ルート請求株式会社',
      items: [
        { productId: standardProductId, quantity: 1, unitPriceTaxIncluded: 11_000 },
        { productId: reducedProductId, quantity: 2, unitPriceTaxIncluded: 1_080 },
      ],
    });

    const res = await app.inject({ method: 'GET', url: `/api/invoices/${orderId}/view` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      qualified: true,
      issuer: {
        name: 'Route Works',
        invoiceRegistrationNumber: 'T9876543210987',
      },
      buyer: { name: 'ルート請求株式会社' },
      order: {
        id: orderId,
        orderNo: 'ROUTE-INV-001',
        orderedAt: '2026-06-09',
      },
      items: [
        {
          productId: standardProductId,
          productTitle: '標準商品',
          quantity: 1,
          unitPriceTaxIncluded: 11_000,
          subtotalTaxIncluded: 11_000,
          taxRate: 10,
        },
        {
          productId: reducedProductId,
          productTitle: '軽減商品',
          quantity: 2,
          unitPriceTaxIncluded: 1_080,
          subtotalTaxIncluded: 2_160,
          taxRate: 8,
        },
      ],
      taxRateBreakdown: [
        {
          taxRate: 10,
          taxableAmountTaxIncluded: 11_000,
          taxAmount: taxFromInclusive(11_000, TAX_RATE_STANDARD),
        },
        {
          taxRate: 8,
          taxableAmountTaxIncluded: 2_160,
          taxAmount: taxFromInclusive(2_160, TAX_RATE_REDUCED),
        },
      ],
      totalTaxIncluded: 13_160,
    });
  });

  it('登録番号無しはqualified=false、不正IDと存在しない注文はエラーを返す', async () => {
    seedProfile(db, 'Unregistered Works', null);
    const productId = seedProduct(db, { sku: 'R-STD-002', title: '未登録商品', taxRate: 10 });
    const orderId = seedOrder(db, {
      orderNo: 'ROUTE-INV-002',
      buyerName: '未登録宛先',
      items: [{ productId, quantity: 1, unitPriceTaxIncluded: 5_500 }],
    });

    const view = await app.inject({ method: 'GET', url: `/api/invoices/${orderId}/view` });
    expect(view.statusCode).toBe(200);
    expect(view.json()).toMatchObject({
      qualified: false,
      issuer: {
        name: 'Unregistered Works',
        invoiceRegistrationNumber: null,
      },
    });

    const invalid = await app.inject({ method: 'GET', url: '/api/invoices/not-a-number/view' });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error).toBe('invalid_id');

    const missing = await app.inject({ method: 'GET', url: '/api/invoices/999999/view' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error).toBe('not_found');
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

function seedProduct(db: DB, input: { sku: string; title: string; taxRate: 10 | 8 }): number {
  const result = db
    .prepare(
      `INSERT INTO products (sku, title, product_type, price_tax_included, tax_rate)
       VALUES (@sku, @title, @productType, @priceTaxIncluded, @taxRate)`,
    )
    .run({
      sku: input.sku,
      title: input.title,
      productType: 'download',
      priceTaxIncluded: 11_000,
      taxRate: input.taxRate,
    });
  return Number(result.lastInsertRowid);
}

function seedOrder(
  db: DB,
  input: {
    orderNo: string;
    buyerName: string;
    items: Array<{ productId: number; quantity: number; unitPriceTaxIncluded: number }>;
  },
): number {
  const total = input.items.reduce((sum, item) => sum + item.quantity * item.unitPriceTaxIncluded, 0);
  const order = db
    .prepare(
      `INSERT INTO orders (order_no, ordered_at, channel, subtotal_tax_included, tax_amount)
       VALUES (@orderNo, @orderedAt, @channel, @subtotalTaxIncluded, @taxAmount)`,
    )
    .run({
      orderNo: input.orderNo,
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
