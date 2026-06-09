import { describe, it, expect } from 'vitest';
import { bootstrap } from '../src/db/bootstrap.js';
import {
  createProfile,
  deleteProfile,
  getProfile,
  listProfiles,
  updateProfile,
} from '../src/services/profile.js';

describe('business profile service', () => {
  it('creates, lists, gets, updates, and deletes profiles with audit logs', () => {
    const db = bootstrap({ filename: ':memory:' });

    const created = createProfile(db, {
      tradeName: '山田制作所',
      legalNamePublicPolicy: '屋号のみ公開',
      businessStartDate: '2026-01-15',
      taxOffice: '渋谷税務署',
      blueReturnEnabled: true,
      invoiceRegistrationNumber: 'T1234567890123',
    });

    expect(created).toMatchObject({
      id: expect.any(Number),
      tradeName: '山田制作所',
      legalNamePublicPolicy: '屋号のみ公開',
      businessStartDate: '2026-01-15',
      taxOffice: '渋谷税務署',
      blueReturnEnabled: true,
      invoiceRegistrationNumber: 'T1234567890123',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(listProfiles(db)).toHaveLength(1);
    expect(getProfile(db, created.id)?.tradeName).toBe('山田制作所');

    const updated = updateProfile(db, created.id, {
      tradeName: '山田デザイン',
      businessStartDate: null,
      blueReturnEnabled: false,
    });

    expect(updated).toMatchObject({
      id: created.id,
      tradeName: '山田デザイン',
      legalNamePublicPolicy: '屋号のみ公開',
      businessStartDate: null,
      taxOffice: '渋谷税務署',
      blueReturnEnabled: false,
    });

    expect(deleteProfile(db, created.id)).toBe(true);
    expect(getProfile(db, created.id)).toBeNull();

    const audits = db
      .prepare(
        `SELECT action, entity_type, entity_id, before_json, after_json
         FROM audit_logs
         WHERE entity_type = ?
         ORDER BY id ASC`,
      )
      .all('business_profile') as Array<{
      action: string;
      entity_type: string;
      entity_id: string;
      before_json: string | null;
      after_json: string | null;
    }>;

    expect(audits.map((row) => row.action)).toEqual(['create', 'update', 'delete']);
    expect(audits.every((row) => row.entity_id === String(created.id))).toBe(true);
    expect(JSON.parse(audits[0]?.after_json ?? '{}')).toMatchObject({ tradeName: '山田制作所' });
    expect(JSON.parse(audits[1]?.before_json ?? '{}')).toMatchObject({ tradeName: '山田制作所' });
    expect(JSON.parse(audits[1]?.after_json ?? '{}')).toMatchObject({ tradeName: '山田デザイン' });
    expect(JSON.parse(audits[2]?.before_json ?? '{}')).toMatchObject({ tradeName: '山田デザイン' });

    db.close();
  });

  it('returns null or false for missing profiles without writing audit logs', () => {
    const db = bootstrap({ filename: ':memory:' });

    expect(getProfile(db, 999)).toBeNull();
    expect(updateProfile(db, 999, { tradeName: 'missing' })).toBeNull();
    expect(deleteProfile(db, 999)).toBe(false);

    const count = db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get() as { n: number };
    expect(count.n).toBe(0);

    db.close();
  });
});
