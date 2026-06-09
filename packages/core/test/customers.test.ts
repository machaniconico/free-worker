import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { bootstrap } from '../src/db/bootstrap.js';
import {
  createCustomer,
  deleteCustomer,
  getCustomer,
  grantConsent,
  listConsentHistory,
  listCustomers,
  revokeConsent,
  updateCustomer,
} from '../src/services/customers.js';

describe('customer service', () => {
  it('stores only minimal customer fields and never persists plaintext email', () => {
    const db = bootstrap({ filename: ':memory:' });

    const customer = createCustomer(db, {
      displayName: '山田 太郎',
      email: 'Taro@example.com',
      notes: '請求書は月末締め',
    });
    const expectedHash = createHash('sha256').update('taro@example.com').digest('hex');

    expect(customer).toMatchObject({
      id: expect.any(Number),
      displayName: '山田 太郎',
      emailHash: expectedHash,
      emailEncrypted: null,
      notes: '請求書は月末締め',
      createdAt: expect.any(String),
    });
    expect(listCustomers(db)).toHaveLength(1);
    expect(getCustomer(db, customer.id)?.emailHash).toBe(expectedHash);

    const stored = db
      .prepare('SELECT display_name, email_hash, email_encrypted, notes FROM customers WHERE id = ?')
      .get(customer.id) as {
      display_name: string;
      email_hash: string;
      email_encrypted: string | null;
      notes: string;
    };
    expect(JSON.stringify(stored)).not.toContain('Taro@example.com');
    expect(stored.email_hash).toBe(expectedHash);

    const audit = db
      .prepare('SELECT after_json FROM audit_logs WHERE entity_type = ? AND action = ?')
      .get('customer', 'create') as { after_json: string };
    expect(audit.after_json).not.toContain('Taro@example.com');
    expect(JSON.parse(audit.after_json)).toMatchObject({ emailHash: expectedHash });

    db.close();
  });

  it('updates and deletes customers with audit logs', () => {
    const db = bootstrap({ filename: ':memory:' });
    const customer = createCustomer(db, {
      displayName: '佐藤 花子',
      emailEncrypted: 'local-ciphertext',
    });

    const updated = updateCustomer(db, customer.id, {
      displayName: '佐藤 花子 様',
      notes: 'メール連絡不可',
      emailHash: null,
      emailEncrypted: 'new-local-ciphertext',
    });
    expect(updated).toMatchObject({
      id: customer.id,
      displayName: '佐藤 花子 様',
      emailHash: null,
      emailEncrypted: 'new-local-ciphertext',
      notes: 'メール連絡不可',
    });

    expect(deleteCustomer(db, customer.id)).toBe(true);
    expect(getCustomer(db, customer.id)).toBeNull();

    const audits = db
      .prepare('SELECT action, before_json, after_json FROM audit_logs WHERE entity_type = ? ORDER BY id ASC')
      .all('customer') as Array<{ action: string; before_json: string | null; after_json: string | null }>;
    expect(audits.map((row) => row.action)).toEqual(['create', 'update', 'delete']);
    expect(JSON.parse(audits[1]?.before_json ?? '{}')).toMatchObject({ displayName: '佐藤 花子' });
    expect(JSON.parse(audits[1]?.after_json ?? '{}')).toMatchObject({ displayName: '佐藤 花子 様' });
    expect(JSON.parse(audits[2]?.before_json ?? '{}')).toMatchObject({ displayName: '佐藤 花子 様' });

    db.close();
  });

  it('grants, revokes, and lists consent history with audit logs', () => {
    const db = bootstrap({ filename: ':memory:' });
    const customer = createCustomer(db, { displayName: '同意管理 顧客' });

    const marketing = grantConsent(db, {
      customerId: customer.id,
      consentType: 'marketing_email',
      consentedAt: '2026-06-09T10:00:00+09:00',
      source: 'settings_screen',
    });
    grantConsent(db, {
      customerId: customer.id,
      consentType: 'terms',
      consentedAt: '2026-06-09T09:00:00+09:00',
      source: 'checkout',
    });

    const revoked = revokeConsent(db, customer.id, marketing.id, {
      revokedAt: '2026-06-10T12:00:00+09:00',
    });
    expect(revoked).toMatchObject({
      id: marketing.id,
      customerId: customer.id,
      consentType: 'marketing_email',
      revokedAt: '2026-06-10T12:00:00+09:00',
    });

    expect(listConsentHistory(db, customer.id)).toEqual([
      expect.objectContaining({ consentType: 'terms', revokedAt: null }),
      expect.objectContaining({ consentType: 'marketing_email', revokedAt: '2026-06-10T12:00:00+09:00' }),
    ]);
    expect(revokeConsent(db, customer.id + 1, marketing.id, { revokedAt: '2026-06-11' })).toBeNull();

    const consentAudits = db
      .prepare('SELECT action FROM audit_logs WHERE entity_type = ? ORDER BY id ASC')
      .all('consent') as Array<{ action: string }>;
    expect(consentAudits.map((row) => row.action)).toEqual(['create', 'create', 'update']);

    db.close();
  });

  it('rejects invalid customer and consent payloads', () => {
    const db = bootstrap({ filename: ':memory:' });

    expect(() => createCustomer(db, { displayName: '' })).toThrow(/displayName is required/);
    expect(() =>
      grantConsent(db, {
        customerId: 999,
        consentType: 'marketing_email',
        consentedAt: '2026-06-09T10:00:00+09:00',
      }),
    ).toThrow(/customer not found/);

    db.close();
  });
});
