import type { FastifyInstance } from 'fastify';
import { todayAgenda, toIsoDate } from '@free-worker/core';

interface AgendaQuery {
  today?: string;
  soonDays?: string;
  staleDays?: string;
}

const DEFAULT_SOON_DAYS = 14;
const DEFAULT_STALE_DAYS = 7;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function agendaRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: AgendaQuery }>('/api/agenda', async (req, reply) => {
    const parsed = parseQuery(req.query);
    if ('error' in parsed) {
      reply.code(400);
      return { error: parsed.error };
    }
    return todayAgenda(app.db, parsed.today, {
      soonDays: parsed.soonDays,
      staleDays: parsed.staleDays,
    });
  });
}

function parseQuery(
  query: AgendaQuery,
): { today: string; soonDays: number; staleDays: number } | { error: 'invalid_today' | 'invalid_soon_days' | 'invalid_stale_days' } {
  const today = query.today?.trim() || toIsoDate(new Date());
  if (!ISO_DATE_PATTERN.test(today)) return { error: 'invalid_today' };
  const soonDays = parseNonNegativeInteger(query.soonDays, DEFAULT_SOON_DAYS);
  if (soonDays == null) return { error: 'invalid_soon_days' };
  const staleDays = parseNonNegativeInteger(query.staleDays, DEFAULT_STALE_DAYS);
  if (staleDays == null) return { error: 'invalid_stale_days' };
  return { today, soonDays, staleDays };
}

function parseNonNegativeInteger(value: string | undefined, fallback: number): number | null {
  if (value === undefined || value.trim() === '') return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
