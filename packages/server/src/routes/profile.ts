import type { FastifyInstance } from 'fastify';
import { writeAudit, type DB } from '@free-worker/core';

interface BusinessProfile {
  id: number;
  tradeName: string;
  legalNamePublicPolicy: string;
  businessStartDate: string | null;
  taxOffice: string | null;
  blueReturnEnabled: boolean;
  invoiceRegistrationNumber: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ProfileRow {
  id: number;
  trade_name: string;
  legal_name_public_policy: string;
  business_start_date: string | null;
  tax_office: string | null;
  blue_return_enabled: number;
  invoice_registration_number: string | null;
  created_at: string;
  updated_at: string;
}

interface ProfileBody {
  tradeName?: unknown;
  legalNamePublicPolicy?: unknown;
  businessStartDate?: unknown;
  taxOffice?: unknown;
  blueReturnEnabled?: unknown;
  invoiceRegistrationNumber?: unknown;
}

interface ProfileParams {
  id: string;
}

function mapProfile(row: ProfileRow): BusinessProfile {
  return {
    id: row.id,
    tradeName: row.trade_name,
    legalNamePublicPolicy: row.legal_name_public_policy,
    businessStartDate: row.business_start_date,
    taxOffice: row.tax_office,
    blueReturnEnabled: row.blue_return_enabled === 1,
    invoiceRegistrationNumber: row.invoice_registration_number,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseId(id: string): number | null {
  if (!/^\d+$/.test(id)) return null;
  const parsed = Number(id);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseOptionalString(value: unknown, field: string): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') {
    throw new Error(`${field} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function parseRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${field} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${field} is required`);
  }
  return trimmed;
}

function parseOptionalDate(value: unknown): string | null {
  const parsed = parseOptionalString(value, 'businessStartDate');
  if (parsed == null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed)) {
    throw new Error('businessStartDate must be YYYY-MM-DD');
  }
  return parsed;
}

function parseOptionalBoolean(value: unknown, field: string): boolean {
  if (value == null) return false;
  if (typeof value !== 'boolean') {
    throw new Error(`${field} must be a boolean`);
  }
  return value;
}

function parsePatchBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    throw new Error(`${field} must be a boolean`);
  }
  return value;
}

function getProfile(db: DB, id: number): BusinessProfile | null {
  const row = db
    .prepare(
      `SELECT id, trade_name, legal_name_public_policy, business_start_date, tax_office,
              blue_return_enabled, invoice_registration_number, created_at, updated_at
       FROM business_profiles
       WHERE id = ?`,
    )
    .get(id) as ProfileRow | undefined;
  return row ? mapProfile(row) : null;
}

function listProfiles(db: DB): BusinessProfile[] {
  const rows = db
    .prepare(
      `SELECT id, trade_name, legal_name_public_policy, business_start_date, tax_office,
              blue_return_enabled, invoice_registration_number, created_at, updated_at
       FROM business_profiles
       ORDER BY id ASC`,
    )
    .all() as ProfileRow[];
  return rows.map(mapProfile);
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
          const params = {
            tradeName: parseRequiredString(body.tradeName, 'tradeName'),
            legalNamePublicPolicy: parseOptionalString(body.legalNamePublicPolicy, 'legalNamePublicPolicy') ?? '未設定',
            businessStartDate: parseOptionalDate(body.businessStartDate),
            taxOffice: parseOptionalString(body.taxOffice, 'taxOffice'),
            blueReturnEnabled: parseOptionalBoolean(body.blueReturnEnabled, 'blueReturnEnabled') ? 1 : 0,
            invoiceRegistrationNumber: parseOptionalString(
              body.invoiceRegistrationNumber,
              'invoiceRegistrationNumber',
            ),
          };
          const created = app.db.transaction(() => {
            const result = app.db
              .prepare(
                `INSERT INTO business_profiles (
                   trade_name, legal_name_public_policy, business_start_date, tax_office,
                   blue_return_enabled, invoice_registration_number
                 )
                 VALUES (
                   @tradeName, @legalNamePublicPolicy, @businessStartDate, @taxOffice,
                   @blueReturnEnabled, @invoiceRegistrationNumber
                 )`,
              )
              .run(params);
            const profileResult = getProfile(app.db, Number(result.lastInsertRowid));
            if (!profileResult) {
              throw new Error('created profile was not found');
            }
            writeAudit(app.db, {
              action: 'create',
              entityType: 'business_profile',
              entityId: profileResult.id,
              after: profileResult,
            });
            return profileResult;
          })();
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
        const before = getProfile(app.db, id);
        if (!before) {
          reply.code(404);
          return { error: 'not_found' };
        }

        try {
          const body = req.body ?? {};
          const params = {
            id,
            hasTradeName: body.tradeName === undefined ? 0 : 1,
            tradeName: body.tradeName === undefined ? null : parseRequiredString(body.tradeName, 'tradeName'),
            hasLegalNamePublicPolicy: body.legalNamePublicPolicy === undefined ? 0 : 1,
            legalNamePublicPolicy:
              body.legalNamePublicPolicy === undefined
                ? null
                : (parseOptionalString(body.legalNamePublicPolicy, 'legalNamePublicPolicy') ?? '未設定'),
            hasBusinessStartDate: body.businessStartDate === undefined ? 0 : 1,
            businessStartDate: body.businessStartDate === undefined ? null : parseOptionalDate(body.businessStartDate),
            hasTaxOffice: body.taxOffice === undefined ? 0 : 1,
            taxOffice: body.taxOffice === undefined ? null : parseOptionalString(body.taxOffice, 'taxOffice'),
            hasBlueReturnEnabled: body.blueReturnEnabled === undefined ? 0 : 1,
            blueReturnEnabled: parsePatchBoolean(body.blueReturnEnabled, 'blueReturnEnabled') ? 1 : 0,
            hasInvoiceRegistrationNumber: body.invoiceRegistrationNumber === undefined ? 0 : 1,
            invoiceRegistrationNumber:
              body.invoiceRegistrationNumber === undefined
                ? null
                : parseOptionalString(body.invoiceRegistrationNumber, 'invoiceRegistrationNumber'),
          };
          const updated = app.db.transaction(() => {
            app.db
              .prepare(
                `UPDATE business_profiles
                 SET trade_name = CASE WHEN @hasTradeName = 1 THEN @tradeName ELSE trade_name END,
                     legal_name_public_policy = CASE
                       WHEN @hasLegalNamePublicPolicy = 1 THEN @legalNamePublicPolicy
                       ELSE legal_name_public_policy
                     END,
                     business_start_date = CASE
                       WHEN @hasBusinessStartDate = 1 THEN @businessStartDate
                       ELSE business_start_date
                     END,
                     tax_office = CASE WHEN @hasTaxOffice = 1 THEN @taxOffice ELSE tax_office END,
                     blue_return_enabled = CASE
                       WHEN @hasBlueReturnEnabled = 1 THEN @blueReturnEnabled
                       ELSE blue_return_enabled
                     END,
                     invoice_registration_number = CASE
                       WHEN @hasInvoiceRegistrationNumber = 1 THEN @invoiceRegistrationNumber
                       ELSE invoice_registration_number
                     END,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = @id`,
              )
              .run(params);
            const after = getProfile(app.db, id);
            if (!after) {
              throw new Error('updated profile was not found');
            }
            writeAudit(app.db, {
              action: 'update',
              entityType: 'business_profile',
              entityId: id,
              before,
              after,
            });
            return after;
          })();
          return updated;
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
        const before = getProfile(app.db, id);
        if (!before) {
          reply.code(404);
          return { error: 'not_found' };
        }
        app.db.transaction(() => {
          writeAudit(app.db, {
            action: 'delete',
            entityType: 'business_profile',
            entityId: id,
            before,
          });
          app.db.prepare('DELETE FROM business_profiles WHERE id = ?').run(id);
        })();
        reply.code(204);
        return undefined;
      });
    },
    { prefix: '/api/profile' },
  );
}
