import type { FastifyInstance } from 'fastify';
import {
  listDocumentVersions,
  listDocumentVersionsByType,
  getDocumentRevisionHistory,
  getDocumentVersion,
  createDocumentVersion,
  updateDocumentVersion,
  publishDocumentVersion,
  deleteDocumentVersion,
  type DocumentType,
  type CreateDocumentVersionInput,
  type UpdateDocumentVersionInput,
} from '@free-worker/core';

interface IdParams {
  id: string;
}

interface HistoryParams {
  docType: string;
}

interface ListQuery {
  docType?: string;
}

const DOCUMENT_TYPES: DocumentType[] = ['tokushoho', 'terms', 'privacy', 'contract_template', 'license', 'other'];

export async function documentRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: ListQuery }>('/api/documents', async (req, reply) => {
    if (req.query.docType !== undefined) {
      const docType = parseDocumentTypeOrNull(req.query.docType);
      if (!docType) {
        reply.code(400);
        return { error: 'invalid_doc_type' };
      }
      return listDocumentVersionsByType(app.db, docType);
    }
    return listDocumentVersions(app.db);
  });

  app.get<{ Params: HistoryParams }>('/api/documents/history/:docType', async (req, reply) => {
    const docType = parseDocumentTypeOrNull(req.params.docType);
    if (!docType) {
      reply.code(400);
      return { error: 'invalid_doc_type' };
    }
    return getDocumentRevisionHistory(app.db, docType);
  });

  app.get<{ Params: IdParams }>('/api/documents/:id', async (req, reply) => {
    const id = parseId(req.params.id);
    if (id == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    const document = getDocumentVersion(app.db, id);
    if (!document) {
      reply.code(404);
      return { error: 'not_found' };
    }
    return document;
  });

  app.post<{ Body: unknown }>('/api/documents', async (req, reply) => {
    try {
      const created = createDocumentVersion(app.db, req.body as CreateDocumentVersionInput);
      reply.code(201);
      return created;
    } catch (error) {
      reply.code(400);
      return invalidPayload(error);
    }
  });

  app.put<{ Body: unknown; Params: IdParams }>('/api/documents/:id', async (req, reply) => {
    const id = parseId(req.params.id);
    if (id == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    try {
      const updated = updateDocumentVersion(app.db, id, req.body as UpdateDocumentVersionInput);
      if (!updated) {
        reply.code(404);
        return { error: 'not_found' };
      }
      return updated;
    } catch (error) {
      reply.code(400);
      return invalidPayload(error);
    }
  });

  app.post<{ Params: IdParams }>('/api/documents/:id/publish', async (req, reply) => {
    const id = parseId(req.params.id);
    if (id == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    const published = publishDocumentVersion(app.db, id);
    if (!published) {
      reply.code(404);
      return { error: 'not_found' };
    }
    return published;
  });

  app.delete<{ Params: IdParams }>('/api/documents/:id', async (req, reply) => {
    const id = parseId(req.params.id);
    if (id == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    const deleted = deleteDocumentVersion(app.db, id);
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

function parseDocumentTypeOrNull(value: unknown): DocumentType | null {
  if (typeof value !== 'string') return null;
  return DOCUMENT_TYPES.includes(value as DocumentType) ? (value as DocumentType) : null;
}

function invalidPayload(error: unknown): { error: 'invalid_payload'; message: string } {
  return { error: 'invalid_payload', message: error instanceof Error ? error.message : 'invalid payload' };
}
