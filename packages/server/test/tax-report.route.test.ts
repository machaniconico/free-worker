import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bootstrap, type DB } from '@free-worker/core';
import { taxReportRoutes } from '../src/routes/tax-report.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: DB;
  }
}

let app: FastifyInstance;
let db: DB;

beforeEach(async () => {
  db = bootstrap({ filename: ':memory:' });
  app = Fastify({ logger: false });
  app.decorate('db', db);
  await app.register(taxReportRoutes);
});

afterEach(async () => {
  await app.close();
  db.close();
});

describe('taxReportRoutes', () => {
  it('GET /api/tax-report は年次集計を返す', async () => {
    seedOrder(db, {
      orderNo: 'ROUTE-TAX-001',
      orderedAt: '2026-03-10',
      channel: 'direct',
      subtotalTaxIncluded: 33_000,
      taxAmount: 3_000,
      taxRateSummary: '{"10":3000}',
    });
    seedExpense(db, {
      spentAt: '2026-03-11',
      category: 'software',
      amountTaxIncluded: 5_500,
      taxAmount: 500,
    });

    const res = await app.inject({ method: 'GET', url: '/api/tax-report?year=2026' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      year: 2026,
      salesTotal: 33_000,
      taxAmountTotal: 3_000,
      expenseTotal: 5_500,
      grossProfit: 27_500,
      months: [
        {
          month: '2026-03',
          salesByChannelAndTaxCategory: [
            { channel: 'direct', taxCategory: '10', salesTaxIncluded: 33_000, taxAmount: 3_000, orderCount: 1 },
          ],
          expensesByCategory: [
            { category: 'software', amountTaxIncluded: 5_500, taxAmount: 500, expenseCount: 1 },
          ],
        },
      ],
    });
  });

  it('year未指定では空集計を返し、CSV exportもヘッダだけ返す', async () => {
    const json = await app.inject({ method: 'GET', url: '/api/tax-report' });
    expect(json.statusCode).toBe(200);
    expect(json.json()).toMatchObject({ year: null, months: [], salesTotal: 0 });

    const csv = await app.inject({ method: 'GET', url: '/api/tax-report/export' });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toBe('year,month,item,channel,taxCategory,category,amountTaxIncluded,taxAmount,count');
  });

  it('GET /api/tax-report/export はCSVを返す', async () => {
    seedOrder(db, {
      orderNo: 'ROUTE-TAX-CSV-001',
      orderedAt: '2026-04-01',
      channel: 'store',
      subtotalTaxIncluded: 11_000,
      taxAmount: 1_000,
      taxRateSummary: '{"10":1000}',
    });

    const res = await app.inject({ method: 'GET', url: '/api/tax-report/export?year=2026' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('2026,2026-04,sales,store,10,,11000,1000,1');
  });

  it('不正なyearは400', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tax-report?year=20x6' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_year' });
  });
});

function seedOrder(
  db: DB,
  input: {
    orderNo: string;
    orderedAt: string;
    channel: string;
    subtotalTaxIncluded: number;
    taxAmount: number;
    taxRateSummary: string;
  },
): void {
  const result = db
    .prepare(
      `INSERT INTO orders (order_no, ordered_at, channel, subtotal_tax_included, tax_amount, payment_status, delivery_status, refund_status)
       VALUES (@orderNo, @orderedAt, @channel, @subtotalTaxIncluded, @taxAmount, 'paid', 'delivered', 'none')`,
    )
    .run(input);
  db.prepare(
    `INSERT INTO invoices (invoice_no, order_id, issued_at, qualified_invoice_flag, tax_rate_summary)
     VALUES (@invoiceNo, @orderId, @issuedAt, 1, @taxRateSummary)`,
  ).run({
    invoiceNo: `${input.orderNo}-INV`,
    orderId: Number(result.lastInsertRowid),
    issuedAt: input.orderedAt,
    taxRateSummary: input.taxRateSummary,
  });
}

function seedExpense(
  db: DB,
  input: {
    spentAt: string;
    category: string;
    amountTaxIncluded: number;
    taxAmount: number;
  },
): void {
  db.prepare(
    `INSERT INTO expenses (spent_at, category, amount_tax_included, tax_amount)
     VALUES (@spentAt, @category, @amountTaxIncluded, @taxAmount)`,
  ).run(input);
}
