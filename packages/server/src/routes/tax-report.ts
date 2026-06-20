import type { FastifyInstance } from 'fastify';
import { annualReport, exportAnnualReportCsv } from '@free-worker/core';

interface TaxReportQuery {
  year?: string;
}

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

function parseYear(year: string | undefined): number | null {
  if (year === undefined || year.trim() === '') return null;
  if (!/^\d{4}$/.test(year)) return null;
  return Number(year);
}
