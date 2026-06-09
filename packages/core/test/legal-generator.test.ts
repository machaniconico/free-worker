import { describe, it, expect } from 'vitest';
import { bootstrap } from '../src/db/bootstrap.js';
import { createProfile } from '../src/services/profile.js';
import { createProduct } from '../src/services/products.js';
import { generateTokushoho, generateTerms, generatePrivacy, generateLegalDraft } from '../src/services/legal-generator.js';

describe('legal-generator', () => {
  it('プロフィール未設定でも各草案を生成し、要記入プレースホルダを含む', () => {
    const db = bootstrap({ filename: ':memory:' });
    const t = generateTokushoho(db);
    expect(t.docType).toBe('tokushoho');
    expect(t.body).toContain('特定商取引法に基づく表記');
    expect(t.placeholderCount).toBeGreaterThan(0);
    expect(t.body).toContain('〔要記入:');
    db.close();
  });

  it('プロフィール設定済みなら屋号・登録番号が反映される', () => {
    const db = bootstrap({ filename: ':memory:' });
    createProfile(db, { tradeName: 'スカイ工房', invoiceRegistrationNumber: 'T1234567890123' });
    const t = generateTokushoho(db);
    expect(t.body).toContain('スカイ工房');
    expect(t.body).toContain('T1234567890123');
    db.close();
  });

  it('商品があると動作環境・価格の記載が変わる', () => {
    const db = bootstrap({ filename: ':memory:' });
    createProduct(db, {
      sku: 'A1',
      title: 'テンプレ',
      productType: 'template',
      priceTaxIncluded: 1980,
      operatingEnvironment: 'Windows 11 / macOS 14',
    });
    const t = generateTokushoho(db);
    expect(t.body).toContain('各商品ページ');
    db.close();
  });

  it('利用規約・プライバシーも生成できる', () => {
    const db = bootstrap({ filename: ':memory:' });
    expect(generateTerms(db).body).toContain('利用規約');
    expect(generatePrivacy(db).body).toContain('プライバシーポリシー');
    expect(generateLegalDraft(db, 'terms').docType).toBe('terms');
    db.close();
  });
});
