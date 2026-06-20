import type { FastifyInstance } from 'fastify';
import {
  listExpenses,
  getExpense,
  createExpense,
  updateExpense,
  deleteExpense,
  exportExpensesCsv,
  importExpensesCsv,
  summarizeExpensesByMonth,
  summarizeExpensesByCategory,
  type CreateExpenseInput,
  type UpdateExpenseInput,
} from '@free-worker/core';

interface IdParams {
  id: string;
}

interface SummaryQuery {
  month?: string;
  groupBy?: 'month' | 'category';
}

export async function expenseRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/expenses', async () => listExpenses(app.db));

  app.get<{ Querystring: SummaryQuery }>('/api/expenses/summary', async (req) => {
    if (req.query.groupBy === 'category') return summarizeExpensesByCategory(app.db, req.query.month);
    return summarizeExpensesByMonth(app.db, req.query.month);
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

  app.post<{ Body: unknown }>('/api/expenses', async (req, reply) => {
    try {
      const created = createExpense(app.db, (req.body ?? {}) as unknown as CreateExpenseInput);
      reply.code(201);
      return created;
    } catch (error) {
      reply.code(400);
      return { error: 'invalid_payload', message: error instanceof Error ? error.message : 'invalid payload' };
    }
  });

  app.put<{ Body: unknown; Params: IdParams }>('/api/expenses/:id', async (req, reply) => {
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
      const updated = updateExpense(app.db, id, (req.body ?? {}) as unknown as UpdateExpenseInput);
      if (!updated) {
        reply.code(404);
        return { error: 'not_found' };
      }
      return updated;
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
    const deleted = deleteExpense(app.db, id);
    if (!deleted) {
      reply.code(404);
      return { error: 'not_found' };
    }
    reply.code(204);
    return undefined;
  });
}

function parseId(id: string): number | null {
  if (!/^\d+$/.test(id)) return null;
  const parsed = Number(id);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
