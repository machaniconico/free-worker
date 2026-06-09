import type { DB } from '../db/connection.js';
import {
  createDocumentVersion,
  getDocumentVersion,
  updateDocumentVersion,
  type CreateDocumentVersionInput,
  type DocumentVersion,
} from '../services/documents.js';

export interface SeedLegalTemplatesResult {
  inserted: number;
  updated: number;
  unchanged: number;
  total: number;
}

const INITIAL_LEGAL_TEMPLATES: CreateDocumentVersionInput[] = [
  {
    docType: 'tokushoho',
    title: '特定商取引法に基づく表記',
    versionLabel: 'initial-template',
    body: [
      '# 特定商取引法に基づく表記',
      '',
      '## 販売業者',
      '## 運営責任者',
      '## 所在地',
      '## 電話番号',
      '## メールアドレス/問い合わせフォーム',
      '## 販売価格',
      '## 商品代金以外の必要料金',
      '## 支払方法',
      '## 支払時期',
      '## 引渡時期/提供時期',
      '## 返品・キャンセル・解除',
      '## 動作環境',
      '## 継続課金条件',
    ].join('\n'),
    sourceId: 'S6',
  },
  {
    docType: 'terms',
    title: '利用規約',
    versionLabel: 'initial-template',
    body: [
      '# 利用規約',
      '',
      '## 1. 適用範囲',
      '## 2. アカウント登録と管理',
      '## 3. 商品/会員サービスの内容',
      '## 4. 料金、支払い、更新、解約',
      '## 5. デジタル商品のライセンス',
      '## 6. 禁止事項',
      '## 7. 知的財産権',
      '## 8. 投稿・コミュニティ機能がある場合のルール',
      '## 9. サービス停止・変更・終了',
      '## 10. 返金・キャンセル',
      '## 11. 免責・責任制限',
      '## 12. 準拠法・管轄',
      '## 13. 規約変更の通知',
    ].join('\n'),
    sourceId: 'S6',
  },
  {
    docType: 'privacy',
    title: 'プライバシーポリシー',
    versionLabel: 'initial-template',
    body: [
      '# プライバシーポリシー',
      '',
      '## 取得する情報',
      '## 利用目的',
      '## 第三者提供',
      '## 委託先',
      '## 保管期間',
      '## 安全管理',
      '## 開示・訂正・利用停止等の窓口',
      '## Cookie/解析ツール/広告タグの利用',
    ].join('\n'),
    sourceId: 'S9',
  },
  {
    docType: 'contract_template',
    title: '受託契約テンプレート',
    versionLabel: 'initial-template',
    body: [
      '# 受託契約テンプレート',
      '',
      '## 業務内容',
      '## 納品物',
      '## 報酬と支払期日',
      '## 検収',
      '## 知的財産権',
      '## 秘密保持',
      '## 再委託',
      '## 契約変更と解除',
    ].join('\n'),
    sourceId: 'S7',
  },
  {
    docType: 'license',
    title: 'デジタル商品のライセンス条項',
    versionLabel: 'initial-template',
    body: [
      '# デジタル商品のライセンス条項',
      '',
      '## 利用者',
      '## 禁止事項',
      '## 成果物への組込み可否',
      '## クレジット表記要否',
      '## アップデート提供範囲',
      '## 返金条件',
      '## 違反時のアカウント停止・損害賠償',
    ].join('\n'),
    sourceId: 'S11',
  },
];

export function seedLegalTemplates(db: DB): SeedLegalTemplatesResult {
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

  db.transaction(() => {
    for (const template of INITIAL_LEGAL_TEMPLATES) {
      const existing = db
        .prepare('SELECT id FROM document_versions WHERE doc_type = ? AND version_label = ?')
        .get(template.docType, template.versionLabel) as { id: number } | undefined;

      if (!existing) {
        createDocumentVersion(db, template, 'seed');
        inserted++;
        continue;
      }

      const current = getDocumentVersion(db, existing.id);
      if (current && sameTemplate(current, template)) {
        unchanged++;
      } else {
        updateDocumentVersion(db, existing.id, template, 'seed');
        updated++;
      }
    }
  })();

  return { inserted, updated, unchanged, total: INITIAL_LEGAL_TEMPLATES.length };
}

function sameTemplate(current: DocumentVersion, template: CreateDocumentVersionInput): boolean {
  return (
    current.docType === template.docType &&
    current.title === template.title &&
    current.versionLabel === template.versionLabel &&
    current.body === template.body &&
    current.state === (template.state ?? 'draft') &&
    current.effectiveDate === (template.effectiveDate ?? null) &&
    current.nextReviewDate === (template.nextReviewDate ?? null) &&
    current.sourceId === (template.sourceId ?? null)
  );
}
