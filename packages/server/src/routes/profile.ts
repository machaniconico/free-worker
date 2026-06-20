import type { FastifyInstance } from 'fastify';
import {
  listProfiles,
  getProfile,
  createProfile,
  updateProfile,
  deleteProfile,
} from '@free-worker/core';

interface ProfileParams {
  id: string;
}

interface ProfileBody {
  tradeName?: unknown;
  legalNamePublicPolicy?: unknown;
  businessStartDate?: unknown;
  taxOffice?: unknown;
  blueReturnEnabled?: unknown;
  invoiceRegistrationNumber?: unknown;
}

function parseId(id: string): number | null {
  if (!/^\d+$/.test(id)) return null;
  const parsed = Number(id);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function profileRoutes(app: FastifyInstance): Promise<void> {
  await app.register(
    async (profile) => {
      profile.get('/', async () => {
        return listProfiles(app.db);
      });

      profile.get<{ Params: ProfileParams }>('/:id', async (req, reply) => {
        const id = parseId(req.params.id);
        if (id == null) {
          reply.code(400);
          return { error: 'invalid_id' };
        }
        const result = getProfile(app.db, id);
        if (!result) {
          reply.code(404);
          return { error: 'not_found' };
        }
        return result;
      });

      profile.post<{ Body: ProfileBody }>('/', async (req, reply) => {
        try {
          const body = req.body ?? {};
          const created = createProfile(app.db, {
            tradeName: body.tradeName as string,
            legalNamePublicPolicy: body.legalNamePublicPolicy as string | null | undefined,
            businessStartDate: body.businessStartDate as string | null | undefined,
            taxOffice: body.taxOffice as string | null | undefined,
            blueReturnEnabled: body.blueReturnEnabled as boolean | undefined,
            invoiceRegistrationNumber: body.invoiceRegistrationNumber as string | null | undefined,
          });
          reply.code(201);
          return created;
        } catch (error) {
          reply.code(400);
          return { error: 'invalid_payload', message: error instanceof Error ? error.message : 'invalid payload' };
        }
      });

      profile.put<{ Body: ProfileBody; Params: ProfileParams }>('/:id', async (req, reply) => {
        const id = parseId(req.params.id);
        if (id == null) {
          reply.code(400);
          return { error: 'invalid_id' };
        }

        try {
          const body = req.body ?? {};
          const result = updateProfile(app.db, id, {
            tradeName: body.tradeName as string | undefined,
            legalNamePublicPolicy: body.legalNamePublicPolicy as string | null | undefined,
            businessStartDate: body.businessStartDate as string | null | undefined,
            taxOffice: body.taxOffice as string | null | undefined,
            blueReturnEnabled: body.blueReturnEnabled as boolean | undefined,
            invoiceRegistrationNumber: body.invoiceRegistrationNumber as string | null | undefined,
          });
          if (!result) {
            reply.code(404);
            return { error: 'not_found' };
          }
          return result;
        } catch (error) {
          reply.code(400);
          return { error: 'invalid_payload', message: error instanceof Error ? error.message : 'invalid payload' };
        }
      });

      profile.delete<{ Params: ProfileParams }>('/:id', async (req, reply) => {
        const id = parseId(req.params.id);
        if (id == null) {
          reply.code(400);
          return { error: 'invalid_id' };
        }
        const deleted = deleteProfile(app.db, id);
        if (!deleted) {
          reply.code(404);
          return { error: 'not_found' };
        }
        reply.code(204);
        return undefined;
      });
    },
    { prefix: '/api/profile' },
  );
}
