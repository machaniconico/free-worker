import { writeAudit } from '../audit.js';
import type { DB } from '../db/connection.js';
import { parseCsv, serializeCsv, type CsvRow } from '../util/csv.js';
import { yearMonth } from '../util/dates.js';
import { cellToInteger, cellToNullableInteger, nullableText, requireText } from '../util/validate.js';

export interface Expense {
  id: number;
  spentAt: string;
  vendor: string | null;
  category: string;
  amountTaxIncluded: number;
  taxAmount: number | null;
  paymentMethod: string | null;
  purpose: string | null;
  attachmentId: number | null;
  createdAt: string;
}

export interface CreateExpenseInput {
  spentAt: string;
  vendor?: string | null;
  category: string;
  amountTaxIncluded: number;
  taxAmount?: number | null;
  paymentMethod?: string | null;
  purpose?: string | null;
  attachmentId?: number | null;
}

export type UpdateExpenseInput = Partial<CreateExpenseInput>;

export interface ImportExpensesCsvResult {
  imported: number;
  created: number;
  updated: number;
}

export interface MonthlyExpenseSummary {
  month: string;
  amountTaxIncluded: number;
  taxAmount: number;
  expenseCount: number;
}

export interface CategoryExpenseSummary {
  category: string;
  amountTaxIncluded: number;
  taxAmount: number;
  expenseCount: number;
}

interface ExpenseRow {
  id: number;
  spent_at: string;
  vendor: string | null;
  category: string;
  amount_tax_included: number;
  tax_amount: number | null;
  payment_method: string | null;
  purpose: string | null;
  attachment_id: number | null;
  created_at: string;
}

const EXPENSE_ENTITY = 'expense';
const CSV_COLUMNS = [
  'id',
  'spentAt',
  'vendor',
  'category',
  'amountTaxIncluded',
  'taxAmount',
  'paymentMethod',
  'purpose',
  'attachmentId',
];

export function createExpense(db: DB, input: CreateExpenseInput, actor = 'local_user'): Expense {
  const payload = normalizeCreate(input);
  return db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO expenses
          (spent_at, vendor, category, amount_tax_included, tax_amount, payment_method, purpose, attachment_id)
         VALUES
          (@spentAt, @vendor, @category, @amountTaxIncluded, @taxAmount, @paymentMethod, @purpose, @attachmentId)`,
      )
      .run(payload);
    const created = getExpenseOrThrow(db, Number(result.lastInsertRowid));
    writeAudit(db, { actor, action: 'create', entityType: EXPENSE_ENTITY, entityId: created.id, after: created });
    return created;
  })();
}

export function getExpense(db: DB, id: number): Expense | null {
  const row = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id) as ExpenseRow | undefined;
  return row ? mapExpense(row) : null;
}

export function listExpenses(db: DB): Expense[] {
  const rows = db.prepare('SELECT * FROM expenses ORDER BY spent_at ASC, id ASC').all() as ExpenseRow[];
  return rows.map(mapExpense);
}

export function updateExpense(db: DB, id: number, input: UpdateExpenseInput, actor = 'local_user'): Expense | null {
  const before = getExpense(db, id);
  if (!before) return null;
  const next = { ...before, ...normalizeUpdate(input) };
  return db.transaction(() => {
    db.prepare(
      `UPDATE expenses SET
         spent_at = @spentAt,
         vendor = @vendor,
         category = @category,
         amount_tax_included = @amountTaxIncluded,
         tax_amount = @taxAmount,
         payment_method = @paymentMethod,
         purpose = @purpose,
         attachment_id = @attachmentId
       WHERE id = @id`,
    ).run({
      id,
      spentAt: next.spentAt,
      vendor: next.vendor,
      category: next.category,
      amountTaxIncluded: next.amountTaxIncluded,
      taxAmount: next.taxAmount,
      paymentMethod: next.paymentMethod,
      purpose: next.purpose,
      attachmentId: next.attachmentId,
    });
    const after = getExpenseOrThrow(db, id);
    writeAudit(db, { actor, action: 'update', entityType: EXPENSE_ENTITY, entityId: id, before, after });
    return after;
  })();
}

export function deleteExpense(db: DB, id: number, actor = 'local_user'): boolean {
  const before = getExpense(db, id);
  if (!before) return false;
  db.transaction(() => {
    writeAudit(db, { actor, action: 'delete', entityType: EXPENSE_ENTITY, entityId: id, before });
    db.prepare('DELETE FROM expenses WHERE id = ?').run(id);
  })();
  return true;
}

export function summarizeExpensesByMonth(db: DB, month?: string): MonthlyExpenseSummary[] {
  const summaries = new Map<string, MonthlyExpenseSummary>();
  for (const expense of listExpenses(db)) {
    const key = yearMonth(expense.spentAt);
    if (month && key !== month) continue;
    const current =
      summaries.get(key) ??
      ({ month: key, amountTaxIncluded: 0, taxAmount: 0, expenseCount: 0 } satisfies MonthlyExpenseSummary);
    current.amountTaxIncluded += expense.amountTaxIncluded;
    current.taxAmount += expense.taxAmount ?? 0;
    current.expenseCount += 1;
    summaries.set(key, current);
  }
  return [...summaries.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export function summarizeExpensesByCategory(db: DB, month?: string): CategoryExpenseSummary[] {
  const summaries = new Map<string, CategoryExpenseSummary>();
  for (const expense of listExpenses(db)) {
    if (month && yearMonth(expense.spentAt) !== month) continue;
    const current =
      summaries.get(expense.category) ??
      ({ category: expense.category, amountTaxIncluded: 0, taxAmount: 0, expenseCount: 0 } satisfies CategoryExpenseSummary);
    current.amountTaxIncluded += expense.amountTaxIncluded;
    current.taxAmount += expense.taxAmount ?? 0;
    current.expenseCount += 1;
    summaries.set(expense.category, current);
  }
  return [...summaries.values()].sort((a, b) => a.category.localeCompare(b.category));
}

export function exportExpensesCsv(db: DB): string {
  const rows: CsvRow[] = listExpenses(db).map((expense) => ({
    id: String(expense.id),
    spentAt: expense.spentAt,
    vendor: expense.vendor ?? '',
    category: expense.category,
    amountTaxIncluded: String(expense.amountTaxIncluded),
    taxAmount: numberToCell(expense.taxAmount),
    paymentMethod: expense.paymentMethod ?? '',
    purpose: expense.purpose ?? '',
    attachmentId: numberToCell(expense.attachmentId),
  }));
  return serializeCsv(rows, { columns: CSV_COLUMNS, bom: false });
}

export function importExpensesCsv(db: DB, text: string, actor = 'local_user'): ImportExpensesCsvResult {
  const rows = parseCsv(text);
  const result: ImportExpensesCsvResult = { imported: 0, created: 0, updated: 0 };
  db.transaction(() => {
    for (const row of rows) {
      const input = expenseInputFromCsv(row);
      const id = cellToNullableInteger(row.id, 'id');
      if (id != null && getExpense(db, id)) {
        updateExpense(db, id, input, actor);
        result.updated += 1;
      } else {
        createExpense(db, input, actor);
        result.created += 1;
      }
      result.imported += 1;
    }
  })();
  return result;
}

function getExpenseOrThrow(db: DB, id: number): Expense {
  const expense = getExpense(db, id);
  if (!expense) throw new Error(`expense not found: ${id}`);
  return expense;
}

function normalizeCreate(input: CreateExpenseInput): Omit<Expense, 'id' | 'createdAt'> {
  return {
    spentAt: requireText(input.spentAt, 'spentAt'),
    vendor: nullableText(input.vendor),
    category: requireText(input.category, 'category'),
    amountTaxIncluded: requireInteger(input.amountTaxIncluded, 'amountTaxIncluded'),
    taxAmount: nullableInteger(input.taxAmount, 'taxAmount'),
    paymentMethod: nullableText(input.paymentMethod),
    purpose: nullableText(input.purpose),
    attachmentId: nullableInteger(input.attachmentId, 'attachmentId'),
  };
}

function normalizeUpdate(input: UpdateExpenseInput): Partial<Omit<Expense, 'id' | 'createdAt'>> {
  const next: Partial<Omit<Expense, 'id' | 'createdAt'>> = {};
  if (input.spentAt !== undefined) next.spentAt = requireText(input.spentAt, 'spentAt');
  if (input.vendor !== undefined) next.vendor = nullableText(input.vendor);
  if (input.category !== undefined) next.category = requireText(input.category, 'category');
  if (input.amountTaxIncluded !== undefined) {
    next.amountTaxIncluded = requireInteger(input.amountTaxIncluded, 'amountTaxIncluded');
  }
  if (input.taxAmount !== undefined) next.taxAmount = nullableInteger(input.taxAmount, 'taxAmount');
  if (input.paymentMethod !== undefined) next.paymentMethod = nullableText(input.paymentMethod);
  if (input.purpose !== undefined) next.purpose = nullableText(input.purpose);
  if (input.attachmentId !== undefined) next.attachmentId = nullableInteger(input.attachmentId, 'attachmentId');
  return next;
}

function mapExpense(row: ExpenseRow): Expense {
  return {
    id: row.id,
    spentAt: row.spent_at,
    vendor: row.vendor,
    category: row.category,
    amountTaxIncluded: row.amount_tax_included,
    taxAmount: row.tax_amount,
    paymentMethod: row.payment_method,
    purpose: row.purpose,
    attachmentId: row.attachment_id,
    createdAt: row.created_at,
  };
}

function expenseInputFromCsv(row: CsvRow): CreateExpenseInput {
  return {
    spentAt: requireText(row.spentAt, 'spentAt'),
    vendor: nullableText(row.vendor),
    category: requireText(row.category, 'category'),
    amountTaxIncluded: cellToInteger(row.amountTaxIncluded, 'amountTaxIncluded'),
    taxAmount: cellToNullableInteger(row.taxAmount, 'taxAmount'),
    paymentMethod: nullableText(row.paymentMethod),
    purpose: nullableText(row.purpose),
    attachmentId: cellToNullableInteger(row.attachmentId, 'attachmentId'),
  };
}

function requireInteger(value: number | null | undefined, field: string): number {
  if (!Number.isInteger(value)) throw new Error(`${field} must be an integer`);
  return Number(value);
}

function nullableInteger(value: number | null | undefined, field: string): number | null {
  if (value == null) return null;
  return requireInteger(value, field);
}

function numberToCell(value: number | null): string {
  return value == null ? '' : String(value);
}
