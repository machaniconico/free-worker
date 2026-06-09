import { describe, expect, it } from 'vitest';
import { bootstrap } from '../src/db/bootstrap.js';
import { createExpense } from '../src/services/expenses.js';
import { createOrder } from '../src/services/sales.js';
import { annualReport, exportAnnualReportCsv } from '../src/services/tax-report.js';

describe('tax report service', () => {
  it('年次の売上・税額・経費・粗利を月別に集計する', () => {
    const db = bootstrap({ filename: ':memory:' });
    createOrder(db, {
      orderNo: 'TAX-001',
      orderedAt: '2026-01-15',
      channel: 'direct',
      subtotalTaxIncluded: 11_000,
      taxAmount: 1_000,
      invoice: {
        invoiceNo: 'TAX-INV-001',
        issuedAt: '2026-01-16',
        qualifiedInvoiceFlag: true,
        taxRateSummary: '{"10":1000}',
      },
    });
    createOrder(db, {
      orderNo: 'TAX-002',
      orderedAt: '2026-01-20',
      channel: 'store',
      subtotalTaxIncluded: 5_400,
      taxAmount: 400,
      invoice: {
        invoiceNo: 'TAX-INV-002',
        issuedAt: '2026-01-21',
        qualifiedInvoiceFlag: true,
        taxRateSummary: '{"8":400}',
      },
    });
    createOrder(db, {
      orderNo: 'TAX-OLD',
      orderedAt: '2025-12-31',
      channel: 'direct',
      subtotalTaxIncluded: 99_999,
      taxAmount: 9_090,
    });
    createExpense(db, {
      spentAt: '2026-01-05',
      category: 'software',
      amountTaxIncluded: 3_300,
      taxAmount: 300,
    });
    createExpense(db, {
      spentAt: '2026-02-01',
      category: 'books',
      amountTaxIncluded: 2_200,
      taxAmount: 200,
    });

    const report = annualReport(db, 2026);

    expect(report.totals).toEqual({
      salesTaxIncluded: 16_400,
      taxAmount: 1_400,
      expenseTaxIncluded: 5_500,
      grossProfit: 10_900,
    });
    expect(report.months).toHaveLength(2);
    expect(report.months[0]).toMatchObject({
      month: '2026-01',
      salesTaxIncluded: 16_400,
      taxAmount: 1_400,
      expenseTaxIncluded: 3_300,
      grossProfit: 13_100,
    });
    expect(report.months[0]?.salesByChannelAndTaxCategory).toEqual([
      { channel: 'direct', taxCategory: '10', salesTaxIncluded: 11_000, taxAmount: 1_000, orderCount: 1 },
      { channel: 'store', taxCategory: '8', salesTaxIncluded: 5_400, taxAmount: 400, orderCount: 1 },
    ]);
    expect(report.months[0]?.expensesByCategory).toEqual([
      { category: 'software', amountTaxIncluded: 3_300, taxAmount: 300, expenseCount: 1 },
    ]);
    expect(report.months[1]).toMatchObject({
      month: '2026-02',
      salesTaxIncluded: 0,
      taxAmount: 0,
      expenseTaxIncluded: 2_200,
      grossProfit: -2_200,
    });
    db.close();
  });

  it('year未指定や該当データ無しでも空集計を返す', () => {
    const db = bootstrap({ filename: ':memory:' });
    expect(annualReport(db).months).toEqual([]);
    expect(annualReport(db, 2026)).toMatchObject({
      year: 2026,
      salesTotal: 0,
      taxAmountTotal: 0,
      expenseTotal: 0,
      grossProfit: 0,
      months: [],
    });
    db.close();
  });

  it('年次レポートを月と項目のCSVに出力する', () => {
    const db = bootstrap({ filename: ':memory:' });
    createOrder(db, {
      orderNo: 'TAX-CSV-001',
      orderedAt: '2026-06-10',
      channel: 'direct',
      subtotalTaxIncluded: 22_000,
      taxAmount: 2_000,
      invoice: {
        invoiceNo: 'TAX-CSV-INV-001',
        issuedAt: '2026-06-11',
        qualifiedInvoiceFlag: true,
        taxRateSummary: '{"10":2000}',
      },
    });
    createExpense(db, {
      spentAt: '2026-06-12',
      category: 'supplies',
      amountTaxIncluded: 1_100,
      taxAmount: 100,
    });

    const csv = exportAnnualReportCsv(db, 2026);

    expect(csv).toContain('year,month,item,channel,taxCategory,category,amountTaxIncluded,taxAmount,count');
    expect(csv).toContain('2026,2026-06,sales,direct,10,,22000,2000,1');
    expect(csv).toContain('2026,2026-06,expense,,,supplies,1100,100,1');
    expect(csv).toContain('2026,2026-06,monthly_total,,,,20900,2000,');
    db.close();
  });
});
