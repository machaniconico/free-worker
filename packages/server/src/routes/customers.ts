import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { writeAudit, type DB } from '@free-worker/core';

interface Customer {
  id: number;
  displayName: string;
  emailHash: string | null;
  emailEncrypted: string | null;
  notes: string | null;
  createdAt: string;
}

interface Consent {
  id: number;
  customerId: number;
  consentType: string;
  consentedAt: string;
  source: string | null;
  revokedAt: string | null;
  evidenceAttachmentId: number | null;
}

interface CustomerPayload {
  displayName?: unknown;
  notes?: unknown;
  email?: unknown;
  emailHash?: unknown;
  emailEncrypted?: unknown;
}

interface ConsentPayload {
  consentType?: unknown;
  consentedAt?: unknown;
  source?: unknown;
  evidenceAttachmentId?: unknown;
  revokedAt?: unknown;
}

interface CustomerRow {
  id: number;
  display_name: string | null;
  email_hash: string | null;
  email_encrypted: string | null;
  notes: string | null;
  created_at: string;
}

interface ConsentRow {
  id: number;
  customer_id: number;
  consent_type: string;
  consented_at: string;
  source: string | null;
  revoked_at: string | null;
  evidence_attachment_id: number | null;
}

interface IdParams {
  id: string;
}

interface ConsentParams extends IdParams {
  consentId: string;
}

type CustomerFields = Omit<Customer, 'id' | 'createdAt'>;

export async function customerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/customers', async () => listCustomers(app.db));

  app.get<{ Params: IdParams }>('/api/customers/:id', async (req, reply) => {
    const id = parseId(req.params.id);
    if (id == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    const customer = getCustomer(app.db, id);
    if (!customer) {
      reply.code(404);
      return { error: 'not_found' };
    }
    return customer;
  });

  app.post<{ Body: CustomerPayload }>('/api/customers', async (req, reply) => {
    try {
      const created = createCustomer(app.db, req.body ?? {});
      reply.code(201);
      return created;
    } catch (error) {
      reply.code(400);
      return invalidPayload(error);
    }
  });

  app.put<{ Body: CustomerPayload; Params: IdParams }>('/api/customers/:id', async (req, reply) => {
    const id = parseId(req.params.id);
    if (id == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    if (!getCustomer(app.db, id)) {
      reply.code(404);
      return { error: 'not_found' };
    }
    try {
      return updateCustomer(app.db, id, req.body ?? {});
    } catch (error) {
      reply.code(400);
      return invalidPayload(error);
    }
  });

  app.delete<{ Params: IdParams }>('/api/customers/:id', async (req, reply) => {
    const id = parseId(req.params.id);
    if (id == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    const before = getCustomer(app.db, id);
    if (!before) {
      reply.code(404);
      return { error: 'not_found' };
    }
    app.db.transaction(() => {
      writeAudit(app.db, {
        action: 'delete',
        entityType: 'customer',
        entityId: id,
        before: { ...before, consents: listConsentHistory(app.db, id) },
      });
      app.db.prepare('DELETE FROM customers WHERE id = ?').run(id);
    })();
    reply.code(204);
    return undefined;
  });

  app.get<{ Params: IdParams }>('/api/customers/:id/consents', async (req, reply) => {
    const customerId = parseId(req.params.id);
    if (customerId == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    if (!getCustomer(app.db, customerId)) {
      reply.code(404);
      return { error: 'not_found' };
    }
    return listConsentHistory(app.db, customerId);
  });

  app.post<{ Body: ConsentPayload; Params: IdParams }>('/api/customers/:id/consents', async (req, reply) => {
    const customerId = parseId(req.params.id);
    if (customerId == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    if (!getCustomer(app.db, customerId)) {
      reply.code(404);
      return { error: 'not_found' };
    }
    try {
      const created = grantConsent(app.db, customerId, req.body ?? {});
      reply.code(201);
      return created;
    } catch (error) {
      reply.code(400);
      return invalidPayload(error);
    }
  });

  app.post<{ Body: ConsentPayload; Params: ConsentParams }>(
    '/api/customers/:id/consents/:consentId/revoke',
    async (req, reply) => {
      const customerId = parseId(req.params.id);
      const consentId = parseId(req.params.consentId);
      if (customerId == null || consentId == null) {
        reply.code(400);
        return { error: 'invalid_id' };
      }
      const before = getConsent(app.db, consentId);
      if (!before || before.customerId !== customerId) {
        reply.code(404);
        return { error: 'not_found' };
      }
      try {
        return revokeConsent(app.db, consentId, req.body ?? {});
      } catch (error) {
        reply.code(400);
        return invalidPayload(error);
      }
    },
  );
}

function listCustomers(db: DB): Customer[] {
  const rows = db.prepare('SELECT * FROM customers ORDER BY id ASC').all() as CustomerRow[];
  return rows.map(mapCustomer);
}

function getCustomer(db: DB, id: number): Customer | null {
  const row = db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as CustomerRow | undefined;
  return row ? mapCustomer(row) : null;
}

function getCustomerOrThrow(db: DB, id: number): Customer {
  const customer = getCustomer(db, id);
  if (!customer) throw new Error(`customer not found: ${id}`);
  return customer;
}

function createCustomer(db: DB, body: CustomerPayload): Customer {
  const payload = normalizeCreateCustomer(body);
  return db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO customers (display_name, email_hash, email_encrypted, notes)
         VALUES (@displayName, @emailHash, @emailEncrypted, @notes)`,
      )
      .run(payload);
    const created = getCustomerOrThrow(db, Number(result.lastInsertRowid));
    writeAudit(db, { action: 'create', entityType: 'customer', entityId: created.id, after: created });
    return created;
  })();
}

function updateCustomer(db: DB, id: number, body: CustomerPayload): Customer {
  const before = getCustomerOrThrow(db, id);
  const next = { ...before, ...normalizeUpdateCustomer(body, before) };
  return db.transaction(() => {
    db.prepare(
      `UPDATE customers SET
         display_name = @displayName,
         email_hash = @emailHash,
         email_encrypted = @emailEncrypted,
         notes = @notes
       WHERE id = @id`,
    ).run({
      id,
      displayName: next.displayName,
      emailHash: next.emailHash,
      emailEncrypted: next.emailEncrypted,
      notes: next.notes,
    });
    const after = getCustomerOrThrow(db, id);
    writeAudit(db, { action: 'update', entityType: 'customer', entityId: id, before, after });
    return after;
  })();
}

function grantConsent(db: DB, customerId: number, body: ConsentPayload): Consent {
  const payload = normalizeConsent(customerId, body);
  return db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO consents (customer_id, consent_type, consented_at, source, evidence_attachment_id)
         VALUES (@customerId, @consentType, @consentedAt, @source, @evidenceAttachmentId)`,
      )
      .run(payload);
    const created = getConsentOrThrow(db, Number(result.lastInsertRowid));
    writeAudit(db, { action: 'create', entityType: 'consent', entityId: created.id, after: created });
    return created;
  })();
}

function revokeConsent(db: DB, consentId: number, body: ConsentPayload): Consent {
  const before = getConsentOrThrow(db, consentId);
  const revokedAt = requireText(body.revokedAt, 'revokedAt');
  return db.transaction(() => {
    db.prepare('UPDATE consents SET revoked_at = ? WHERE id = ?').run(revokedAt, consentId);
    const after = getConsentOrThrow(db, consentId);
    writeAudit(db, { action: 'update', entityType: 'consent', entityId: consentId, before, after });
    return after;
  })();
}

function listConsentHistory(db: DB, customerId: number): Consent[] {
  const rows = db
    .prepare('SELECT * FROM consents WHERE customer_id = ? ORDER BY consented_at ASC, id ASC')
    .all(customerId) as ConsentRow[];
  return rows.map(mapConsent);
}

function getConsent(db: DB, id: number): Consent | null {
  const row = db.prepare('SELECT * FROM consents WHERE id = ?').get(id) as ConsentRow | undefined;
  return row ? mapConsent(row) : null;
}

function getConsentOrThrow(db: DB, id: number): Consent {
  const consent = getConsent(db, id);
  if (!consent) throw new Error(`consent not found: ${id}`);
  return consent;
}

function normalizeCreateCustomer(body: CustomerPayload): CustomerFields {
  // 顧客情報は display_name/notes と非平文メール識別子だけに限定する。
  // raw email は即時ハッシュ化し、返却値・監査ログ・DBのどこにも平文を残さない。
  const email = normalizeEmailFields(body);
  return {
    displayName: requireText(body.displayName, 'displayName'),
    emailHash: email.emailHash,
    emailEncrypted: email.emailEncrypted,
    notes: nullableText(body.notes, 'notes'),
  };
}

function normalizeUpdateCustomer(body: CustomerPayload, before: Customer): Partial<CustomerFields> {
  const out: Partial<CustomerFields> = {};
  if (body.displayName !== undefined) out.displayName = requireText(body.displayName, 'displayName');
  if (body.notes !== undefined) out.notes = nullableText(body.notes, 'notes');
  if (body.email !== undefined || body.emailHash !== undefined || body.emailEncrypted !== undefined) {
    Object.assign(out, normalizeEmailFields(body, before));
  }
  return out;
}

function normalizeConsent(customerId: number, body: ConsentPayload): Omit<Consent, 'id' | 'revokedAt'> {
  return {
    customerId,
    consentType: requireText(body.consentType, 'consentType'),
    consentedAt: requireText(body.consentedAt, 'consentedAt'),
    source: nullableText(body.source, 'source'),
    evidenceAttachmentId: optionalPositiveInteger(body.evidenceAttachmentId, 'evidenceAttachmentId'),
  };
}

function normalizeEmailFields(
  body: Pick<CustomerPayload, 'email' | 'emailHash' | 'emailEncrypted'>,
  before?: Pick<Customer, 'emailHash' | 'emailEncrypted'>,
): Pick<CustomerFields, 'emailHash' | 'emailEncrypted'> {
  if (body.email !== undefined) {
    const email = nullableText(body.email, 'email');
    return {
      emailHash: email ? hashEmail(email) : null,
      emailEncrypted: body.emailEncrypted !== undefined ? nullableText(body.emailEncrypted, 'emailEncrypted') : null,
    };
  }
  return {
    emailHash: body.emailHash !== undefined ? nullableText(body.emailHash, 'emailHash') : before?.emailHash ?? null,
    emailEncrypted:
      body.emailEncrypted !== undefined ? nullableText(body.emailEncrypted, 'emailEncrypted') : before?.emailEncrypted ?? null,
  };
}

function hashEmail(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

function parseId(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function requireText(value: unknown, field: string): string {
  const text = nullableText(value, field);
  if (!text) throw new Error(`${field} is required`);
  return text;
}

function nullableText(value: unknown, field: string): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  const text = value.trim();
  return text.length > 0 ? text : null;
}

function optionalPositiveInteger(value: unknown, field: string): number | null {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return value;
}

function invalidPayload(error: unknown): { error: string; message: string } {
  return { error: 'invalid_payload', message: error instanceof Error ? error.message : 'invalid payload' };
}

function mapCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    displayName: row.display_name ?? '',
    emailHash: row.email_hash,
    emailEncrypted: row.email_encrypted,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

function mapConsent(row: ConsentRow): Consent {
  return {
    id: row.id,
    customerId: row.customer_id,
    consentType: row.consent_type,
    consentedAt: row.consented_at,
    source: row.source,
    revokedAt: row.revoked_at,
    evidenceAttachmentId: row.evidence_attachment_id,
  };
}
