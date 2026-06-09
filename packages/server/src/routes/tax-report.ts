import type { FastifyInstance } from 'fastify';
import { serializeCsv, yearMonth, type CsvRow, type DB } from '@free-worker/core';

interface TaxReportQuery {
  year?: string;
}

interface OrderRow {
  id: number;
  ordered_at: string;
  channel: string;
  subtotal_tax_included: number;
  tax_amount: number | null;
  tax_rate_summary: string | null;
}

interface ExpenseRow {
  id: number;
  spent_at: string;
  category: string;
  amount_tax_included: number;
  tax_amount: number | null;
}

interface Totals {
  salesTaxIncluded: number;
  taxAmount: number;
  expenseTaxIncluded: number;
  grossProfit: number;
}

interface MonthReport extends Totals {
  month: string;
  salesByChannel: Array<{
    channel: string;
    salesTaxIncluded: number;
    taxAmount: number;
    orderCount: number;
  }>;
  salesByTaxCategory: Array<{
    taxCategory: string;
    salesTaxIncluded: number;
    taxAmount: number;
    orderCount: number;
  }>;
  salesByChannelAndTaxCategory: Array<{
    channel: string;
    taxCategory: string;
    salesTaxIncluded: number;
    taxAmount: number;
    orderCount: number;
  }>;
  expensesByCategory: Array<{
    category: string;
    amountTaxIncluded: number;
    taxAmount: number;
    expenseCount: number;
  }>;
}

const CSV_COLUMNS = [
  'year',
  'month',
  'item',
  'channel',
  'taxCategory',
  'category',
  'amountTaxIncluded',
  'taxAmount',
  'count',
];

export async function taxReportRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: TaxReportQuery }>('/api/tax-report', async (req, reply) => {
    const year = parseYear(req.query.year);
    if (req.query.year !== undefined && year == null) {
      reply.code(400);
      return { error: 'invalid_year' };
    }
    return annualReport(app.db, year);
  });

  app.get<{ Querystring: TaxReportQuery }>('/api/tax-report/export', async (req, reply) => {
    const year = parseYear(req.query.year);
    if (req.query.year !== undefined && year == null) {
      reply.code(400);
      return { error: 'invalid_year' };
    }
    reply.header('content-type', 'text/csv; charset=utf-8');
    return exportAnnualReportCsv(app.db, year);
  });
}

function annualReport(db: DB, year: number | null): {
  year: number | null;
  salesTotal: number;
  taxAmountTotal: number;
  expenseTotal: number;
  grossProfit: number;
  totals: Totals;
  months: MonthReport[];
} {
  if (year == null) {
    return {
      year: null,
      salesTotal: 0,
      taxAmountTotal: 0,
      expenseTotal: 0,
      grossProfit: 0,
      totals: { salesTaxIncluded: 0, taxAmount: 0, expenseTaxIncluded: 0, grossProfit: 0 },
      months: [],
    };
  }
  const yearPrefix = `${year}-`;
  const monthMap = new Map<string, MutableMonthReport>();

  const orderRows = db
    .prepare(
      `SELECT o.id, o.ordered_at, o.channel, o.subtotal_tax_included, o.tax_amount, i.tax_rate_summary
       FROM orders o
       LEFT JOIN invoices i ON i.order_id = o.id
       WHERE o.ordered_at >= ? AND o.ordered_at < ?
       ORDER BY o.ordered_at ASC, o.id ASC`,
    )
    .all(`${year}-01-01`, `${year + 1}-01-01`) as OrderRow[];
  for (const order of orderRows) {
    const month = yearMonth(order.ordered_at);
    if (!month.startsWith(yearPrefix)) continue;
    const current = getMonth(monthMap, month);
    current.salesTaxIncluded += order.subtotal_tax_included;
    current.taxAmount += order.tax_amount ?? 0;
    for (const taxEntry of taxEntries(order)) {
      const taxSummary = current.taxCategories.get(taxEntry.taxCategory) ?? {
        taxCategory: taxEntry.taxCategory,
        salesTaxIncluded: 0,
        taxAmount: 0,
        orderCount: 0,
      };
      taxSummary.salesTaxIncluded += taxEntry.salesTaxIncluded;
      taxSummary.taxAmount += taxEntry.taxAmount;
      taxSummary.orderCount += 1;
      current.taxCategories.set(taxEntry.taxCategory, taxSummary);

      const key = `${order.channel}\u0000${taxEntry.taxCategory}`;
      const sales = current.sales.get(key) ?? {
        channel: order.channel,
        taxCategory: taxEntry.taxCategory,
        salesTaxIncluded: 0,
        taxAmount: 0,
        orderCount: 0,
      };
      sales.salesTaxIncluded += taxEntry.salesTaxIncluded;
      sales.taxAmount += taxEntry.taxAmount;
      sales.orderCount += 1;
      current.sales.set(key, sales);
    }

    const channelSummary = current.channels.get(order.channel) ?? {
      channel: order.channel,
      salesTaxIncluded: 0,
      taxAmount: 0,
      orderCount: 0,
    };
    channelSummary.salesTaxIncluded += order.subtotal_tax_included;
    channelSummary.taxAmount += order.tax_amount ?? 0;
    channelSummary.orderCount += 1;
    current.channels.set(order.channel, channelSummary);
  }

  const expenseRows = db
    .prepare(
      `SELECT id, spent_at, category, amount_tax_included, tax_amount
       FROM expenses
       WHERE spent_at >= ? AND spent_at < ?
       ORDER BY spent_at ASC, id ASC`,
    )
    .all(`${year}-01-01`, `${year + 1}-01-01`) as ExpenseRow[];
  for (const expense of expenseRows) {
    const month = yearMonth(expense.spent_at);
    if (!month.startsWith(yearPrefix)) continue;
    const current = getMonth(monthMap, month);
    current.expenseTaxIncluded += expense.amount_tax_included;
    const summary = current.expenses.get(expense.category) ?? {
      category: expense.category,
      amountTaxIncluded: 0,
      taxAmount: 0,
      expenseCount: 0,
    };
    summary.amountTaxIncluded += expense.amount_tax_included;
    summary.taxAmount += expense.tax_amount ?? 0;
    summary.expenseCount += 1;
    current.expenses.set(expense.category, summary);
  }

  const months = [...monthMap.values()].map(finalizeMonth).sort((a, b) => a.month.localeCompare(b.month));
  const totals = months.reduce(
    (acc, month) => {
      acc.salesTaxIncluded += month.salesTaxIncluded;
      acc.taxAmount += month.taxAmount;
      acc.expenseTaxIncluded += month.expenseTaxIncluded;
      acc.grossProfit += month.grossProfit;
      return acc;
    },
    { salesTaxIncluded: 0, taxAmount: 0, expenseTaxIncluded: 0, grossProfit: 0 },
  );
  return {
    year,
    salesTotal: totals.salesTaxIncluded,
    taxAmountTotal: totals.taxAmount,
    expenseTotal: totals.expenseTaxIncluded,
    grossProfit: totals.grossProfit,
    totals,
    months,
  };
}

function exportAnnualReportCsv(db: DB, year: number | null): string {
  const report = annualReport(db, year);
  const rows: CsvRow[] = [];
  for (const month of report.months) {
    for (const sales of month.salesByChannelAndTaxCategory) {
      rows.push({
        year: report.year == null ? '' : String(report.year),
        month: month.month,
        item: 'sales',
        channel: sales.channel,
        taxCategory: sales.taxCategory,
        category: '',
        amountTaxIncluded: String(sales.salesTaxIncluded),
        taxAmount: String(sales.taxAmount),
        count: String(sales.orderCount),
      });
    }
    for (const expense of month.expensesByCategory) {
      rows.push({
        year: report.year == null ? '' : String(report.year),
        month: month.month,
        item: 'expense',
        channel: '',
        taxCategory: '',
        category: expense.category,
        amountTaxIncluded: String(expense.amountTaxIncluded),
        taxAmount: String(expense.taxAmount),
        count: String(expense.expenseCount),
      });
    }
    rows.push({
      year: report.year == null ? '' : String(report.year),
      month: month.month,
      item: 'monthly_total',
      channel: '',
      taxCategory: '',
      category: '',
      amountTaxIncluded: String(month.salesTaxIncluded - month.expenseTaxIncluded),
      taxAmount: String(month.taxAmount),
      count: '',
    });
  }
  return serializeCsv(rows, { columns: CSV_COLUMNS, bom: false });
}

interface MutableMonthReport extends Totals {
  month: string;
  channels: Map<string, MonthReport['salesByChannel'][number]>;
  taxCategories: Map<string, MonthReport['salesByTaxCategory'][number]>;
  sales: Map<string, MonthReport['salesByChannelAndTaxCategory'][number]>;
  expenses: Map<string, MonthReport['expensesByCategory'][number]>;
}

function getMonth(months: Map<string, MutableMonthReport>, month: string): MutableMonthReport {
  const existing = months.get(month);
  if (existing) return existing;
  const created: MutableMonthReport = {
    month,
    salesTaxIncluded: 0,
    taxAmount: 0,
    expenseTaxIncluded: 0,
    grossProfit: 0,
    channels: new Map(),
    taxCategories: new Map(),
    sales: new Map(),
    expenses: new Map(),
  };
  months.set(month, created);
  return created;
}

function finalizeMonth(month: MutableMonthReport): MonthReport {
  return {
    month: month.month,
    salesTaxIncluded: month.salesTaxIncluded,
    taxAmount: month.taxAmount,
    expenseTaxIncluded: month.expenseTaxIncluded,
    grossProfit: month.salesTaxIncluded - month.expenseTaxIncluded,
    salesByChannel: [...month.channels.values()].sort((a, b) => a.channel.localeCompare(b.channel)),
    salesByTaxCategory: [...month.taxCategories.values()].sort((a, b) => a.taxCategory.localeCompare(b.taxCategory)),
    salesByChannelAndTaxCategory: [...month.sales.values()].sort(
      (a, b) => a.channel.localeCompare(b.channel) || a.taxCategory.localeCompare(b.taxCategory),
    ),
    expensesByCategory: [...month.expenses.values()].sort((a, b) => a.category.localeCompare(b.category)),
  };
}

function taxEntries(order: OrderRow): Array<{ taxCategory: string; salesTaxIncluded: number; taxAmount: number }> {
  const fromInvoice = entriesFromTaxRateSummary(order);
  if (fromInvoice.length > 0) return fromInvoice;
  const taxAmount = order.tax_amount ?? 0;
  return [{ taxCategory: taxAmount > 0 ? 'taxable' : 'tax_exempt', salesTaxIncluded: order.subtotal_tax_included, taxAmount }];
}

function entriesFromTaxRateSummary(order: OrderRow): Array<{ taxCategory: string; salesTaxIncluded: number; taxAmount: number }> {
  if (!order.tax_rate_summary) return [];
  try {
    const parsed = JSON.parse(order.tax_rate_summary) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    const entries = Object.entries(parsed)
      .filter((entry): entry is [string, number] => entry[0].trim() !== '' && Number.isInteger(entry[1]))
      .sort(([a], [b]) => a.localeCompare(b));
    if (entries.length === 0) return [];
    if (entries.length === 1) {
      const [taxCategory, taxAmount] = entries[0]!;
      return [{ taxCategory, salesTaxIncluded: order.subtotal_tax_included, taxAmount }];
    }
    return entries.map(([taxCategory, taxAmount]) => ({ taxCategory, salesTaxIncluded: 0, taxAmount }));
  } catch {
    return [];
  }
}

function parseYear(year: string | undefined): number | null {
  if (year === undefined || year.trim() === '') return null;
  if (!/^\d{4}$/.test(year)) return null;
  return Number(year);
}
