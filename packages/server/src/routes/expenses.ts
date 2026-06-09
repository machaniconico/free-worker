import type { FastifyInstance } from 'fastify';
import { parseCsv, serializeCsv, writeAudit, yearMonth, type CsvRow, type DB } from '@free-worker/core';

interface Expense {
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

interface ExpensePayload {
  id?: unknown;
  spentAt?: unknown;
  vendor?: unknown;
  category?: unknown;
  amountTaxIncluded?: unknown;
  taxAmount?: unknown;
  paymentMethod?: unknown;
  purpose?: unknown;
  attachmentId?: unknown;
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

interface IdParams {
  id: string;
}

interface SummaryQuery {
  month?: string;
  groupBy?: 'month' | 'category';
}

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

export async function expenseRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/expenses', async () => listExpenses(app.db));

  app.get<{ Querystring: SummaryQuery }>('/api/expenses/summary', async (req) => {
    if (req.query.groupBy === 'category') return categorySummary(app.db, req.query.month);
    return monthlySummary(app.db, req.query.month);
  });

  app.get('/api/expenses/export', async (_req, reply) => {
    reply.header('content-type', 'text/csv; charset=utf-8');
    return exportExpensesCsv(app.db);
  });

  app.post<{ Body: { csv?: unknown } }>('/api/expenses/import', async (req, reply) => {
    if (typeof req.body?.csv !== 'string') {
      reply.code(400);
      return { error: 'csv_required' };
    }
    try {
      return importExpensesCsv(app.db, req.body.csv);
    } catch (error) {
      reply.code(400);
      return { error: 'invalid_csv', message: error instanceof Error ? error.message : 'invalid csv' };
    }
  });

  app.get<{ Params: IdParams }>('/api/expenses/:id', async (req, reply) => {
    const id = parseId(req.params.id);
    if (id == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    const expense = getExpense(app.db, id);
    if (!expense) {
      reply.code(404);
      return { error: 'not_found' };
    }
    return expense;
  });

  app.post<{ Body: ExpensePayload }>('/api/expenses', async (req, reply) => {
    try {
      const created = createExpense(app.db, req.body ?? {});
      reply.code(201);
      return created;
    } catch (error) {
      reply.code(400);
      return { error: 'invalid_payload', message: error instanceof Error ? error.message : 'invalid payload' };
    }
  });

  app.put<{ Body: ExpensePayload; Params: IdParams }>('/api/expenses/:id', async (req, reply) => {
    const id = parseId(req.params.id);
    if (id == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    if (!getExpense(app.db, id)) {
      reply.code(404);
      return { error: 'not_found' };
    }
    try {
      return updateExpense(app.db, id, req.body ?? {});
    } catch (error) {
      reply.code(400);
      return { error: 'invalid_payload', message: error instanceof Error ? error.message : 'invalid payload' };
    }
  });

  app.delete<{ Params: IdParams }>('/api/expenses/:id', async (req, reply) => {
    const id = parseId(req.params.id);
    if (id == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    const before = getExpense(app.db, id);
    if (!before) {
      reply.code(404);
      return { error: 'not_found' };
    }
    app.db.transaction(() => {
      writeAudit(app.db, { action: 'delete', entityType: 'expense', entityId: id, before });
      app.db.prepare('DELETE FROM expenses WHERE id = ?').run(id);
    })();
    reply.code(204);
    return undefined;
  });
}

function createExpense(db: DB, body: ExpensePayload): Expense {
  const payload = normalizeCreate(body);
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
    writeAudit(db, { action: 'create', entityType: 'expense', entityId: created.id, after: created });
    return created;
  })();
}

function updateExpense(db: DB, id: number, body: ExpensePayload): Expense {
  const before = getExpenseOrThrow(db, id);
  const next = { ...before, ...normalizeUpdate(body) };
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
    writeAudit(db, { action: 'update', entityType: 'expense', entityId: id, before, after });
    return after;
  })();
}

function listExpenses(db: DB): Expense[] {
  const rows = db.prepare('SELECT * FROM expenses ORDER BY spent_at ASC, id ASC').all() as ExpenseRow[];
  return rows.map(mapExpense);
}

function getExpense(db: DB, id: number): Expense | null {
  const row = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id) as ExpenseRow | undefined;
  return row ? mapExpense(row) : null;
}

function getExpenseOrThrow(db: DB, id: number): Expense {
  const expense = getExpense(db, id);
  if (!expense) throw new Error(`expense not found: ${id}`);
  return expense;
}

function normalizeCreate(body: ExpensePayload): Omit<Expense, 'id' | 'createdAt'> {
  return {
    spentAt: parseRequiredString(body.spentAt, 'spentAt'),
    vendor: parseOptionalString(body.vendor, 'vendor'),
    category: parseRequiredString(body.category, 'category'),
    amountTaxIncluded: parseRequiredInteger(body.amountTaxIncluded, 'amountTaxIncluded'),
    taxAmount: parseNullableInteger(body.taxAmount, 'taxAmount'),
    paymentMethod: parseOptionalString(body.paymentMethod, 'paymentMethod'),
    purpose: parseOptionalString(body.purpose, 'purpose'),
    attachmentId: parseNullableInteger(body.attachmentId, 'attachmentId'),
  };
}

function normalizeUpdate(body: ExpensePayload): Partial<Omit<Expense, 'id' | 'createdAt'>> {
  const next: Partial<Omit<Expense, 'id' | 'createdAt'>> = {};
  if (body.spentAt !== undefined) next.spentAt = parseRequiredString(body.spentAt, 'spentAt');
  if (body.vendor !== undefined) next.vendor = parseOptionalString(body.vendor, 'vendor');
  if (body.category !== undefined) next.category = parseRequiredString(body.category, 'category');
  if (body.amountTaxIncluded !== undefined) {
    next.amountTaxIncluded = parseRequiredInteger(body.amountTaxIncluded, 'amountTaxIncluded');
  }
  if (body.taxAmount !== undefined) next.taxAmount = parseNullableInteger(body.taxAmount, 'taxAmount');
  if (body.paymentMethod !== undefined) next.paymentMethod = parseOptionalString(body.paymentMethod, 'paymentMethod');
  if (body.purpose !== undefined) next.purpose = parseOptionalString(body.purpose, 'purpose');
  if (body.attachmentId !== undefined) next.attachmentId = parseNullableInteger(body.attachmentId, 'attachmentId');
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

function exportExpensesCsv(db: DB): string {
  const rows: CsvRow[] = listExpenses(db).map((expense) => ({
    id: String(expense.id),
    spentAt: expense.spentAt,
    vendor: expense.vendor ?? '',
    category: expense.category,
    amountTaxIncluded: String(expense.amountTaxIncluded),
    taxAmount: numberCell(expense.taxAmount),
    paymentMethod: expense.paymentMethod ?? '',
    purpose: expense.purpose ?? '',
    attachmentId: numberCell(expense.attachmentId),
  }));
  return serializeCsv(rows, { columns: CSV_COLUMNS, bom: false });
}

function importExpensesCsv(db: DB, csv: string): { imported: number; created: number; updated: number } {
  const result = { imported: 0, created: 0, updated: 0 };
  db.transaction(() => {
    for (const row of parseCsv(csv)) {
      const payload = payloadFromCsv(row);
      const id = parseNullableInteger(row.id, 'id');
      if (id != null && getExpense(db, id)) {
        updateExpense(db, id, payload);
        result.updated += 1;
      } else {
        createExpense(db, payload);
        result.created += 1;
      }
      result.imported += 1;
    }
  })();
  return result;
}

function payloadFromCsv(row: CsvRow): ExpensePayload {
  return {
    spentAt: row.spentAt,
    vendor: row.vendor,
    category: row.category,
    amountTaxIncluded: row.amountTaxIncluded,
    taxAmount: row.taxAmount,
    paymentMethod: row.paymentMethod,
    purpose: row.purpose,
    attachmentId: row.attachmentId,
  };
}

function monthlySummary(
  db: DB,
  month?: string,
): Array<{ month: string; amountTaxIncluded: number; taxAmount: number; expenseCount: number }> {
  const summaries = new Map<string, { month: string; amountTaxIncluded: number; taxAmount: number; expenseCount: number }>();
  for (const expense of listExpenses(db)) {
    const key = yearMonth(expense.spentAt);
    if (month && key !== month) continue;
    const current = summaries.get(key) ?? { month: key, amountTaxIncluded: 0, taxAmount: 0, expenseCount: 0 };
    current.amountTaxIncluded += expense.amountTaxIncluded;
    current.taxAmount += expense.taxAmount ?? 0;
    current.expenseCount += 1;
    summaries.set(key, current);
  }
  return [...summaries.values()].sort((a, b) => a.month.localeCompare(b.month));
}

function categorySummary(
  db: DB,
  month?: string,
): Array<{ category: string; amountTaxIncluded: number; taxAmount: number; expenseCount: number }> {
  const summaries = new Map<string, { category: string; amountTaxIncluded: number; taxAmount: number; expenseCount: number }>();
  for (const expense of listExpenses(db)) {
    if (month && yearMonth(expense.spentAt) !== month) continue;
    const current = summaries.get(expense.category) ?? {
      category: expense.category,
      amountTaxIncluded: 0,
      taxAmount: 0,
      expenseCount: 0,
    };
    current.amountTaxIncluded += expense.amountTaxIncluded;
    current.taxAmount += expense.taxAmount ?? 0;
    current.expenseCount += 1;
    summaries.set(expense.category, current);
  }
  return [...summaries.values()].sort((a, b) => a.category.localeCompare(b.category));
}

function parseId(id: string): number | null {
  if (!/^\d+$/.test(id)) return null;
  const parsed = Number(id);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseRequiredString(value: unknown, field: string): string {
  const text = parseOptionalString(value, field);
  if (!text) throw new Error(`${field} is required`);
  return text;
}

function parseOptionalString(value: unknown, field: string): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  const text = value.trim();
  return text.length > 0 ? text : null;
}

function parseRequiredInteger(value: unknown, field: string): number {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (!Number.isInteger(parsed)) throw new Error(`${field} must be an integer`);
  return Number(parsed);
}

function parseNullableInteger(value: unknown, field: string): number | null {
  if (value == null || value === '') return null;
  return parseRequiredInteger(value, field);
}

function numberCell(value: number | null): string {
  return value == null ? '' : String(value);
}
