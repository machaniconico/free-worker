import { createHash } from 'node:crypto';
import { writeAudit } from '../audit.js';
import type { DB } from '../db/connection.js';
import { parseIsoDate } from '../util/dates.js';

export interface BusinessProfile {
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

export interface CreateProfileInput {
  tradeName: string;
  legalNamePublicPolicy?: string | null;
  businessStartDate?: string | null;
  taxOffice?: string | null;
  blueReturnEnabled?: boolean;
  invoiceRegistrationNumber?: string | null;
}

export interface UpdateProfileInput {
  tradeName?: string;
  legalNamePublicPolicy?: string | null;
  businessStartDate?: string | null;
  taxOffice?: string | null;
  blueReturnEnabled?: boolean;
  invoiceRegistrationNumber?: string | null;
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

/**
 * 監査ログ用スナップショット: invoiceRegistrationNumber を SHA-256 ハッシュに置換する。
 * business_profiles テーブルの保存値は平文のまま変えない。
 */
function sanitizeProfileForAudit(profile: BusinessProfile): Omit<BusinessProfile, 'invoiceRegistrationNumber'> & { invoiceRegistrationNumber: string | null } {
  const { invoiceRegistrationNumber, ...rest } = profile;
  const hashed =
    invoiceRegistrationNumber != null
      ? createHash('sha256').update(invoiceRegistrationNumber).digest('hex')
      : null;
  return { ...rest, invoiceRegistrationNumber: hashed };
}

function normalizeRequiredText(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${field} is required`);
  }
  return trimmed;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function normalizeBusinessStartDate(value: string | null | undefined): string | null {
  if (value == null) return null;
  parseIsoDate(value);
  return value;
}

export function listProfiles(db: DB): BusinessProfile[] {
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

export function getProfile(db: DB, id: number): BusinessProfile | null {
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

export function createProfile(db: DB, input: CreateProfileInput): BusinessProfile {
  const params = {
    tradeName: normalizeRequiredText(input.tradeName, 'tradeName'),
    legalNamePublicPolicy: normalizeOptionalText(input.legalNamePublicPolicy) ?? '未設定',
    businessStartDate: normalizeBusinessStartDate(input.businessStartDate),
    taxOffice: normalizeOptionalText(input.taxOffice),
    blueReturnEnabled: input.blueReturnEnabled ? 1 : 0,
    invoiceRegistrationNumber: normalizeOptionalText(input.invoiceRegistrationNumber),
  };

  const run = db.transaction(() => {
    const result = db
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
    const profile = getProfile(db, Number(result.lastInsertRowid));
    if (!profile) {
      throw new Error('created profile was not found');
    }
    writeAudit(db, {
      action: 'create',
      entityType: 'business_profile',
      entityId: profile.id,
      after: sanitizeProfileForAudit(profile),
    });
    return profile;
  });

  return run();
}

export function updateProfile(db: DB, id: number, input: UpdateProfileInput): BusinessProfile | null {
  const before = getProfile(db, id);
  if (!before) return null;

  const params = {
    id,
    hasTradeName: input.tradeName === undefined ? 0 : 1,
    tradeName: input.tradeName === undefined ? null : normalizeRequiredText(input.tradeName, 'tradeName'),
    hasLegalNamePublicPolicy: input.legalNamePublicPolicy === undefined ? 0 : 1,
    legalNamePublicPolicy:
      input.legalNamePublicPolicy === undefined
        ? null
        : (normalizeOptionalText(input.legalNamePublicPolicy) ?? '未設定'),
    hasBusinessStartDate: input.businessStartDate === undefined ? 0 : 1,
    businessStartDate: input.businessStartDate === undefined ? null : normalizeBusinessStartDate(input.businessStartDate),
    hasTaxOffice: input.taxOffice === undefined ? 0 : 1,
    taxOffice: input.taxOffice === undefined ? null : normalizeOptionalText(input.taxOffice),
    hasBlueReturnEnabled: input.blueReturnEnabled === undefined ? 0 : 1,
    blueReturnEnabled: input.blueReturnEnabled ? 1 : 0,
    hasInvoiceRegistrationNumber: input.invoiceRegistrationNumber === undefined ? 0 : 1,
    invoiceRegistrationNumber:
      input.invoiceRegistrationNumber === undefined ? null : normalizeOptionalText(input.invoiceRegistrationNumber),
  };

  const run = db.transaction(() => {
    db.prepare(
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
    ).run(params);
    const after = getProfile(db, id);
    if (!after) {
      throw new Error('updated profile was not found');
    }
    writeAudit(db, {
      action: 'update',
      entityType: 'business_profile',
      entityId: id,
      before: sanitizeProfileForAudit(before),
      after: sanitizeProfileForAudit(after),
    });
    return after;
  });

  return run();
}

export function deleteProfile(db: DB, id: number): boolean {
  const before = getProfile(db, id);
  if (!before) return false;

  const run = db.transaction(() => {
    writeAudit(db, {
      action: 'delete',
      entityType: 'business_profile',
      entityId: id,
      before: sanitizeProfileForAudit(before),
    });
    db.prepare('DELETE FROM business_profiles WHERE id = ?').run(id);
  });

  run();
  return true;
}
