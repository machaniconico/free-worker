import { createHash } from 'node:crypto';
import { writeAudit } from '../audit.js';
import type { DB } from '../db/connection.js';

export interface Customer {
  id: number;
  displayName: string;
  emailHash: string | null;
  emailEncrypted: string | null;
  notes: string | null;
  createdAt: string;
}

export interface Consent {
  id: number;
  customerId: number;
  consentType: string;
  consentedAt: string;
  source: string | null;
  revokedAt: string | null;
  evidenceAttachmentId: number | null;
}

export interface CreateCustomerInput {
  displayName: string;
  notes?: string | null;
  email?: string | null;
  emailHash?: string | null;
  emailEncrypted?: string | null;
}

export type UpdateCustomerInput = Partial<CreateCustomerInput>;

export interface GrantConsentInput {
  customerId: number;
  consentType: string;
  consentedAt: string;
  source?: string | null;
  evidenceAttachmentId?: number | null;
}

export interface RevokeConsentInput {
  revokedAt: string;
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

type CustomerPayload = Omit<Customer, 'id' | 'createdAt'>;

export function listCustomers(db: DB): Customer[] {
  const rows = db.prepare('SELECT * FROM customers ORDER BY id ASC').all() as CustomerRow[];
  return rows.map(mapCustomer);
}

export function getCustomer(db: DB, id: number): Customer | null {
  const row = db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as CustomerRow | undefined;
  return row ? mapCustomer(row) : null;
}

export function createCustomer(db: DB, input: CreateCustomerInput, actor = 'local_user'): Customer {
  const payload = normalizeCreateCustomer(input);
  return db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO customers (display_name, email_hash, email_encrypted, notes)
         VALUES (@displayName, @emailHash, @emailEncrypted, @notes)`,
      )
      .run(payload);
    const created = getCustomerOrThrow(db, Number(result.lastInsertRowid));
    writeAudit(db, { actor, action: 'create', entityType: 'customer', entityId: created.id, after: created });
    return created;
  })();
}

export function updateCustomer(
  db: DB,
  id: number,
  input: UpdateCustomerInput,
  actor = 'local_user',
): Customer | null {
  const before = getCustomer(db, id);
  if (!before) return null;
  const next = { ...before, ...normalizeUpdateCustomer(input, before) };

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
    writeAudit(db, { actor, action: 'update', entityType: 'customer', entityId: id, before, after });
    return after;
  })();
}

export function deleteCustomer(db: DB, id: number, actor = 'local_user'): boolean {
  const before = getCustomer(db, id);
  if (!before) return false;
  const consents = listConsentHistory(db, id);

  return db.transaction(() => {
    writeAudit(db, { actor, action: 'delete', entityType: 'customer', entityId: id, before: { ...before, consents } });
    db.prepare('DELETE FROM customers WHERE id = ?').run(id);
    return true;
  })();
}

export function grantConsent(db: DB, input: GrantConsentInput, actor = 'local_user'): Consent {
  const payload = normalizeGrantConsent(input);
  if (!getCustomer(db, payload.customerId)) {
    throw new Error(`customer not found: ${payload.customerId}`);
  }

  return db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO consents (customer_id, consent_type, consented_at, source, evidence_attachment_id)
         VALUES (@customerId, @consentType, @consentedAt, @source, @evidenceAttachmentId)`,
      )
      .run(payload);
    const created = getConsentOrThrow(db, Number(result.lastInsertRowid));
    writeAudit(db, { actor, action: 'create', entityType: 'consent', entityId: created.id, after: created });
    return created;
  })();
}

export function revokeConsent(
  db: DB,
  customerId: number,
  consentId: number,
  input: RevokeConsentInput,
  actor = 'local_user',
): Consent | null {
  const before = getConsent(db, consentId);
  if (!before || before.customerId !== customerId) return null;
  const revokedAt = requireText(input.revokedAt, 'revokedAt');

  return db.transaction(() => {
    db.prepare('UPDATE consents SET revoked_at = ? WHERE id = ?').run(revokedAt, consentId);
    const after = getConsentOrThrow(db, consentId);
    writeAudit(db, { actor, action: 'update', entityType: 'consent', entityId: consentId, before, after });
    return after;
  })();
}

export function listConsentHistory(db: DB, customerId: number): Consent[] {
  const rows = db
    .prepare('SELECT * FROM consents WHERE customer_id = ? ORDER BY consented_at ASC, id ASC')
    .all(customerId) as ConsentRow[];
  return rows.map(mapConsent);
}

export function getConsent(db: DB, id: number): Consent | null {
  const row = db.prepare('SELECT * FROM consents WHERE id = ?').get(id) as ConsentRow | undefined;
  return row ? mapConsent(row) : null;
}

function getCustomerOrThrow(db: DB, id: number): Customer {
  const customer = getCustomer(db, id);
  if (!customer) throw new Error(`customer not found: ${id}`);
  return customer;
}

function getConsentOrThrow(db: DB, id: number): Consent {
  const consent = getConsent(db, id);
  if (!consent) throw new Error(`consent not found: ${id}`);
  return consent;
}

function normalizeCreateCustomer(input: CreateCustomerInput): CustomerPayload {
  // 顧客情報は display_name/notes と非平文メール識別子だけに限定する。
  // raw email は即時ハッシュ化し、返却値・監査ログ・DBのどこにも平文を残さない。
  const email = normalizeEmailFields(input);
  return {
    displayName: requireText(input.displayName, 'displayName'),
    emailHash: email.emailHash,
    emailEncrypted: email.emailEncrypted,
    notes: nullableText(input.notes, 'notes'),
  };
}

function normalizeUpdateCustomer(input: UpdateCustomerInput, before: Customer): Partial<CustomerPayload> {
  const out: Partial<CustomerPayload> = {};
  if (input.displayName !== undefined) out.displayName = requireText(input.displayName, 'displayName');
  if (input.notes !== undefined) out.notes = nullableText(input.notes, 'notes');
  if (input.email !== undefined || input.emailHash !== undefined || input.emailEncrypted !== undefined) {
    Object.assign(out, normalizeEmailFields(input, before));
  }
  return out;
}

function normalizeGrantConsent(input: GrantConsentInput): Omit<Consent, 'id' | 'revokedAt'> {
  return {
    customerId: requirePositiveInteger(input.customerId, 'customerId'),
    consentType: requireText(input.consentType, 'consentType'),
    consentedAt: requireText(input.consentedAt, 'consentedAt'),
    source: nullableText(input.source, 'source'),
    evidenceAttachmentId: optionalPositiveInteger(input.evidenceAttachmentId, 'evidenceAttachmentId'),
  };
}

function normalizeEmailFields(
  input: Pick<CreateCustomerInput, 'email' | 'emailHash' | 'emailEncrypted'>,
  before?: Pick<Customer, 'emailHash' | 'emailEncrypted'>,
): Pick<CustomerPayload, 'emailHash' | 'emailEncrypted'> {
  if (input.email !== undefined) {
    const email = nullableText(input.email, 'email');
    return {
      emailHash: email ? hashEmail(email) : null,
      emailEncrypted: input.emailEncrypted !== undefined ? nullableText(input.emailEncrypted, 'emailEncrypted') : null,
    };
  }
  return {
    emailHash: input.emailHash !== undefined ? nullableText(input.emailHash, 'emailHash') : before?.emailHash ?? null,
    emailEncrypted:
      input.emailEncrypted !== undefined ? nullableText(input.emailEncrypted, 'emailEncrypted') : before?.emailEncrypted ?? null,
  };
}

function hashEmail(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
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

function requirePositiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return value;
}

function optionalPositiveInteger(value: unknown, field: string): number | null {
  if (value == null) return null;
  return requirePositiveInteger(value, field);
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
