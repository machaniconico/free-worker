import { describe, expect, it } from 'vitest';
import { bootstrap } from '../src/db/bootstrap.js';
import { seedLegalTemplates } from '../src/seed/legal.js';
import {
  createDocumentVersion,
  deleteDocumentVersion,
  getDocumentRevisionHistory,
  getDocumentVersion,
  listDocumentVersions,
  listDocumentVersionsByType,
  publishDocumentVersion,
  updateDocumentVersion,
} from '../src/services/documents.js';

describe('documents service', () => {
  it('creates, lists, gets, updates, and deletes document versions with audit logs', () => {
    const db = bootstrap({ filename: ':memory:' });

    const created = createDocumentVersion(db, {
      docType: 'terms',
      title: '利用規約',
      versionLabel: 'v1',
      body: '初版本文',
      effectiveDate: '2026-07-01',
      nextReviewDate: '2027-01-01',
      sourceId: 'S6',
    });
    expect(created).toMatchObject({
      id: expect.any(Number),
      docType: 'terms',
      title: '利用規約',
      versionLabel: 'v1',
      body: '初版本文',
      state: 'draft',
      effectiveDate: '2026-07-01',
      nextReviewDate: '2027-01-01',
      sourceId: 'S6',
      createdAt: expect.any(String),
    });
    expect(listDocumentVersions(db)).toHaveLength(1);
    expect(getDocumentVersion(db, created.id)?.versionLabel).toBe('v1');

    const updated = updateDocumentVersion(db, created.id, {
      versionLabel: 'v1.1',
      body: '改定本文',
      nextReviewDate: null,
    });
    expect(updated).toMatchObject({
      id: created.id,
      versionLabel: 'v1.1',
      body: '改定本文',
      nextReviewDate: null,
    });

    expect(deleteDocumentVersion(db, created.id)).toBe(true);
    expect(getDocumentVersion(db, created.id)).toBeNull();

    const audits = db
      .prepare(
        `SELECT action, entity_type, entity_id, before_json, after_json
         FROM audit_logs
         WHERE entity_type = ?
         ORDER BY id ASC`,
      )
      .all('document_version') as Array<{
      action: string;
      entity_type: string;
      entity_id: string;
      before_json: string | null;
      after_json: string | null;
    }>;
    expect(audits.map((row) => row.action)).toEqual(['create', 'update', 'delete']);
    expect(audits.every((row) => row.entity_id === String(created.id))).toBe(true);
    expect(JSON.parse(audits[0]?.after_json ?? '{}')).toMatchObject({ versionLabel: 'v1' });
    expect(JSON.parse(audits[1]?.before_json ?? '{}')).toMatchObject({ body: '初版本文' });
    expect(JSON.parse(audits[1]?.after_json ?? '{}')).toMatchObject({ body: '改定本文' });
    expect(JSON.parse(audits[2]?.before_json ?? '{}')).toMatchObject({ versionLabel: 'v1.1' });

    db.close();
  });

  it('publishes one version per doc type and archives the previous published version', () => {
    const db = bootstrap({ filename: ':memory:' });
    const v1 = createDocumentVersion(db, {
      docType: 'privacy',
      title: 'プライバシーポリシー',
      versionLabel: 'v1',
      body: '初版',
      state: 'published',
      effectiveDate: '2026-07-01',
      sourceId: 'S9',
    });
    const v2 = createDocumentVersion(db, {
      docType: 'privacy',
      title: 'プライバシーポリシー',
      versionLabel: 'v2',
      body: '改定版',
      effectiveDate: '2026-10-01',
      sourceId: 'S9',
    });

    const published = publishDocumentVersion(db, v2.id);
    expect(published).toMatchObject({ id: v2.id, state: 'published' });
    expect(getDocumentVersion(db, v1.id)?.state).toBe('archived');

    const privacyVersions = listDocumentVersionsByType(db, 'privacy');
    expect(privacyVersions.filter((version) => version.state === 'published')).toHaveLength(1);
    expect(privacyVersions.filter((version) => version.state === 'archived')).toHaveLength(1);
    expect(getDocumentRevisionHistory(db, 'privacy').map((version) => version.versionLabel)).toEqual(['v2', 'v1']);

    const actions = db
      .prepare('SELECT action FROM audit_logs WHERE entity_type = ? ORDER BY id ASC')
      .all('document_version')
      .map((row) => (row as { action: string }).action);
    expect(actions).toEqual(['create', 'create', 'publish']);

    db.close();
  });

  it('rejects invalid type and state values', () => {
    const db = bootstrap({ filename: ':memory:' });

    expect(() =>
      createDocumentVersion(db, {
        docType: 'bad' as never,
        title: '不正',
        versionLabel: 'v1',
        body: 'body',
      }),
    ).toThrow(/docType must be one of/);

    expect(() =>
      createDocumentVersion(db, {
        docType: 'license',
        title: 'ライセンス',
        versionLabel: 'v1',
        body: 'body',
        state: 'active' as never,
      }),
    ).toThrow(/state must be one of/);

    db.close();
  });

  it('seeds legal templates idempotently', () => {
    const db = bootstrap({ filename: ':memory:' });

    expect(seedLegalTemplates(db)).toEqual({ inserted: 5, updated: 0, unchanged: 0, total: 5 });
    expect(seedLegalTemplates(db)).toEqual({ inserted: 0, updated: 0, unchanged: 5, total: 5 });
    expect(listDocumentVersionsByType(db, 'tokushoho')[0]).toMatchObject({
      title: '特定商取引法に基づく表記',
      versionLabel: 'initial-template',
      state: 'draft',
      sourceId: 'S6',
    });
    expect(listDocumentVersions(db)).toHaveLength(5);

    db.close();
  });
});
