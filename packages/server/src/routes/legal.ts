import type { FastifyInstance } from 'fastify';
import {
  generateLegalDraft,
  createDocumentVersion,
  type GeneratableDocType,
} from '@free-worker/core';

const VALID_DOC_TYPES: GeneratableDocType[] = ['tokushoho', 'terms', 'privacy'];

interface GenerateBody {
  docType?: unknown;
  save?: unknown;
}

/** 事業プロフィール+商品から法令文書の草案を生成する。save:true で document_versions に draft 保存。 */
export async function legalRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/legal/generate', async (req, reply) => {
    const body = (req.body ?? {}) as GenerateBody;
    if (typeof body.docType !== 'string' || !VALID_DOC_TYPES.includes(body.docType as GeneratableDocType)) {
      reply.code(400);
      return { error: 'invalid_doc_type', allowed: VALID_DOC_TYPES };
    }
    const draft = generateLegalDraft(app.db, body.docType as GeneratableDocType);

    if (body.save === true) {
      const saved = createDocumentVersion(app.db, {
        docType: draft.docType,
        title: draft.title,
        versionLabel: draft.versionLabel,
        body: draft.body,
        state: 'draft',
        sourceId: draft.sourceIds[0] ?? null,
      });
      reply.code(201);
      return { draft, saved };
    }
    return { draft };
  });
}
