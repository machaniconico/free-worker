import type { DB } from '../db/connection.js';
import { serializeCsv, type CsvRow } from '../util/csv.js';
import { yearMonth } from '../util/dates.js';
import { listExpenses } from './expenses.js';
import { listOrders, type Order } from './sales.js';

export interface AnnualReportTotals {
  salesTaxIncluded: number;
  taxAmount: number;
  expenseTaxIncluded: number;
  grossProfit: number;
}

export interface SalesChannelTaxSummary {
  channel: string;
  taxCategory: string;
  salesTaxIncluded: number;
  taxAmount: number;
  orderCount: number;
}

export interface SalesChannelSummary {
  channel: string;
  salesTaxIncluded: number;
  taxAmount: number;
  orderCount: number;
}

export interface SalesTaxCategorySummary {
  taxCategory: string;
  salesTaxIncluded: number;
  taxAmount: number;
  orderCount: number;
}

export interface ExpenseCategorySummary {
  category: string;
  amountTaxIncluded: number;
  taxAmount: number;
  expenseCount: number;
}

export interface AnnualReportMonth extends AnnualReportTotals {
  month: string;
  salesByChannel: SalesChannelSummary[];
  salesByTaxCategory: SalesTaxCategorySummary[];
  salesByChannelAndTaxCategory: SalesChannelTaxSummary[];
  expensesByCategory: ExpenseCategorySummary[];
}

export interface AnnualReport {
  year: number | null;
  salesTotal: number;
  taxAmountTotal: number;
  expenseTotal: number;
  grossProfit: number;
  totals: AnnualReportTotals;
  months: AnnualReportMonth[];
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

export function annualReport(db: DB, year?: number | string | null): AnnualReport {
  const normalizedYear = normalizeYear(year);
  if (normalizedYear == null) return emptyReport(null);

  const months = new Map<string, MutableAnnualReportMonth>();
  const yearPrefix = `${normalizedYear}-`;

  for (const order of listOrders(db)) {
    const month = yearMonth(order.orderedAt);
    if (!month.startsWith(yearPrefix)) continue;
    const current = getMonth(months, month);
    const taxEntries = taxCategoryEntries(order);
    current.salesTaxIncluded += order.subtotalTaxIncluded;
    current.taxAmount += order.taxAmount ?? 0;

    addChannel(current, order.channel, order.subtotalTaxIncluded, order.taxAmount ?? 0);
    for (const entry of taxEntries) {
      addTaxCategory(current, entry.taxCategory, entry.salesTaxIncluded, entry.taxAmount);
      addChannelTax(current, order.channel, entry.taxCategory, entry.salesTaxIncluded, entry.taxAmount);
    }
  }

  for (const expense of listExpenses(db)) {
    const month = yearMonth(expense.spentAt);
    if (!month.startsWith(yearPrefix)) continue;
    const current = getMonth(months, month);
    current.expenseTaxIncluded += expense.amountTaxIncluded;
    addExpenseCategory(current, expense.category, expense.amountTaxIncluded, expense.taxAmount ?? 0);
  }

  const reportMonths = [...months.values()]
    .map(finalizeMonth)
    .sort((a, b) => a.month.localeCompare(b.month));
  const totals = reportMonths.reduce(
    (acc, month) => {
      acc.salesTaxIncluded += month.salesTaxIncluded;
      acc.taxAmount += month.taxAmount;
      acc.expenseTaxIncluded += month.expenseTaxIncluded;
      acc.grossProfit += month.grossProfit;
      return acc;
    },
    { salesTaxIncluded: 0, taxAmount: 0, expenseTaxIncluded: 0, grossProfit: 0 } satisfies AnnualReportTotals,
  );

  return {
    year: normalizedYear,
    salesTotal: totals.salesTaxIncluded,
    taxAmountTotal: totals.taxAmount,
    expenseTotal: totals.expenseTaxIncluded,
    grossProfit: totals.grossProfit,
    totals,
    months: reportMonths,
  };
}

export function exportAnnualReportCsv(db: DB, year?: number | string | null): string {
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

interface MutableAnnualReportMonth extends AnnualReportTotals {
  month: string;
  channels: Map<string, SalesChannelSummary>;
  taxCategories: Map<string, SalesTaxCategorySummary>;
  channelTaxCategories: Map<string, SalesChannelTaxSummary>;
  expenseCategories: Map<string, ExpenseCategorySummary>;
}

interface TaxCategoryEntry {
  taxCategory: string;
  salesTaxIncluded: number;
  taxAmount: number;
}

function emptyReport(year: number | null): AnnualReport {
  const totals = { salesTaxIncluded: 0, taxAmount: 0, expenseTaxIncluded: 0, grossProfit: 0 };
  return {
    year,
    salesTotal: 0,
    taxAmountTotal: 0,
    expenseTotal: 0,
    grossProfit: 0,
    totals,
    months: [],
  };
}

function normalizeYear(year: number | string | null | undefined): number | null {
  if (year == null || year === '') return null;
  const parsed = typeof year === 'string' ? Number(year) : year;
  return Number.isInteger(parsed) && parsed >= 1_000 && parsed <= 9_999 ? Number(parsed) : null;
}

function getMonth(months: Map<string, MutableAnnualReportMonth>, month: string): MutableAnnualReportMonth {
  const existing = months.get(month);
  if (existing) return existing;
  const created: MutableAnnualReportMonth = {
    month,
    salesTaxIncluded: 0,
    taxAmount: 0,
    expenseTaxIncluded: 0,
    grossProfit: 0,
    channels: new Map(),
    taxCategories: new Map(),
    channelTaxCategories: new Map(),
    expenseCategories: new Map(),
  };
  months.set(month, created);
  return created;
}

function addChannel(month: MutableAnnualReportMonth, channel: string, amount: number, taxAmount: number): void {
  const current = month.channels.get(channel) ?? { channel, salesTaxIncluded: 0, taxAmount: 0, orderCount: 0 };
  current.salesTaxIncluded += amount;
  current.taxAmount += taxAmount;
  current.orderCount += 1;
  month.channels.set(channel, current);
}

function addTaxCategory(
  month: MutableAnnualReportMonth,
  taxCategory: string,
  amount: number,
  taxAmount: number,
): void {
  const current = month.taxCategories.get(taxCategory) ?? {
    taxCategory,
    salesTaxIncluded: 0,
    taxAmount: 0,
    orderCount: 0,
  };
  current.salesTaxIncluded += amount;
  current.taxAmount += taxAmount;
  current.orderCount += 1;
  month.taxCategories.set(taxCategory, current);
}

function addChannelTax(
  month: MutableAnnualReportMonth,
  channel: string,
  taxCategory: string,
  amount: number,
  taxAmount: number,
): void {
  const key = `${channel}\u0000${taxCategory}`;
  const current = month.channelTaxCategories.get(key) ?? {
    channel,
    taxCategory,
    salesTaxIncluded: 0,
    taxAmount: 0,
    orderCount: 0,
  };
  current.salesTaxIncluded += amount;
  current.taxAmount += taxAmount;
  current.orderCount += 1;
  month.channelTaxCategories.set(key, current);
}

function addExpenseCategory(
  month: MutableAnnualReportMonth,
  category: string,
  amount: number,
  taxAmount: number,
): void {
  const current = month.expenseCategories.get(category) ?? {
    category,
    amountTaxIncluded: 0,
    taxAmount: 0,
    expenseCount: 0,
  };
  current.amountTaxIncluded += amount;
  current.taxAmount += taxAmount;
  current.expenseCount += 1;
  month.expenseCategories.set(category, current);
}

function finalizeMonth(month: MutableAnnualReportMonth): AnnualReportMonth {
  const grossProfit = month.salesTaxIncluded - month.expenseTaxIncluded;
  return {
    month: month.month,
    salesTaxIncluded: month.salesTaxIncluded,
    taxAmount: month.taxAmount,
    expenseTaxIncluded: month.expenseTaxIncluded,
    grossProfit,
    salesByChannel: sortByChannel([...month.channels.values()]),
    salesByTaxCategory: sortByTaxCategory([...month.taxCategories.values()]),
    salesByChannelAndTaxCategory: sortByChannelTax([...month.channelTaxCategories.values()]),
    expensesByCategory: sortByCategory([...month.expenseCategories.values()]),
  };
}

function taxCategoryEntries(order: Order): TaxCategoryEntry[] {
  const fromInvoice = entriesFromTaxRateSummary(order);
  if (fromInvoice.length > 0) return fromInvoice;
  const taxAmount = order.taxAmount ?? 0;
  return [
    {
      taxCategory: taxAmount > 0 ? 'taxable' : 'tax_exempt',
      salesTaxIncluded: order.subtotalTaxIncluded,
      taxAmount,
    },
  ];
}

function entriesFromTaxRateSummary(order: Order): TaxCategoryEntry[] {
  const summary = order.invoice?.taxRateSummary;
  if (!summary) return [];
  try {
    const parsed = JSON.parse(summary) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    const entries = Object.entries(parsed)
      .filter((entry): entry is [string, number] => entry[0].trim() !== '' && Number.isInteger(entry[1]))
      .sort(([a], [b]) => a.localeCompare(b));
    if (entries.length === 0) return [];
    if (entries.length === 1) {
      const [taxCategory, taxAmount] = entries[0]!;
      return [{ taxCategory, salesTaxIncluded: order.subtotalTaxIncluded, taxAmount }];
    }
    return entries.map(([taxCategory, taxAmount]) => ({ taxCategory, salesTaxIncluded: 0, taxAmount }));
  } catch {
    return [];
  }
}

function sortByChannel<T extends { channel: string }>(rows: T[]): T[] {
  return rows.sort((a, b) => a.channel.localeCompare(b.channel));
}

function sortByTaxCategory<T extends { taxCategory: string }>(rows: T[]): T[] {
  return rows.sort((a, b) => a.taxCategory.localeCompare(b.taxCategory));
}

function sortByChannelTax<T extends { channel: string; taxCategory: string }>(rows: T[]): T[] {
  return rows.sort((a, b) => a.channel.localeCompare(b.channel) || a.taxCategory.localeCompare(b.taxCategory));
}

function sortByCategory<T extends { category: string }>(rows: T[]): T[] {
  return rows.sort((a, b) => a.category.localeCompare(b.category));
}
