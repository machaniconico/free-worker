/**
 * 特商法表記・利用規約・プライバシーポリシーの草案を、事業プロフィールと商品から
 * テンプレ生成する(オフライン・AI非依存)。出典: docs/reference/legal_templates_notes.md、S5/S6/S9。
 *
 * 重要: これは「草案(ドラフト)」であり最終文書ではない。未設定項目は 〔要記入: ...〕
 * プレースホルダで明示し、公開前に必ずユーザー(専門家確認含む)が補完・確認する前提。
 */
import type { DB } from '../db/connection.js';
import { listProfiles, type BusinessProfile } from './profile.js';
import { listProducts } from './products.js';
import type { DocumentType } from './documents.js';

export interface GeneratedDraft {
  docType: DocumentType;
  title: string;
  versionLabel: string;
  body: string;
  sourceIds: string[];
  /** 草案中に残っている要記入プレースホルダの件数(0 が望ましい)。 */
  placeholderCount: number;
}

const TODAY_LABEL = 'draft';

function ph(value: string | null | undefined, hint: string): string {
  const v = (value ?? '').trim();
  return v.length > 0 ? v : `〔要記入: ${hint}〕`;
}

function firstProfile(db: DB): BusinessProfile | null {
  const all = listProfiles(db);
  return all.length > 0 ? all[0]! : null;
}

function countPlaceholders(body: string): number {
  return (body.match(/〔要記入:/g) ?? []).length;
}

/** 特商法に基づく表記の草案。出典 S5(総額表示)/S6(通信販売)。 */
export function generateTokushoho(db: DB): GeneratedDraft {
  const p = firstProfile(db);
  const products = listProducts(db);
  const priceLine =
    products.length > 0
      ? '各商品ページに税込価格を表示します。'
      : '〔要記入: 販売価格(税込総額表示)〕';

  const lines = [
    '# 特定商取引法に基づく表記',
    '',
    `販売業者: ${ph(p?.tradeName, '屋号または氏名')}`,
    `運営責任者: ${ph(p?.tradeName, '運営責任者名(個人の場合は本人名)')}`,
    `所在地: 〔要記入: 公開所在地。自宅公開を避ける場合はバーチャルオフィス等。請求があれば遅滞なく開示〕`,
    `電話番号: 〔要記入: 連絡可能な電話番号(請求があれば遅滞なく開示)〕`,
    `メールアドレス/問い合わせ: 〔要記入: 連絡先メールまたは問い合わせフォームURL〕`,
    `販売価格: ${priceLine}`,
    `商品代金以外の必要料金: 〔要記入: 決済手数料・通信費・振込手数料など〕`,
    `支払方法: 〔要記入: クレジットカード/銀行振込/プラットフォーム決済など〕`,
    `支払時期: 〔要記入: 申込時/更新日/無料期間終了後など〕`,
    `引渡し・提供時期: 〔要記入: ダウンロードURL発行/会員権限付与/講座公開日など〕`,
    `返品・キャンセル・解除: 〔要記入: デジタル商品の性質・サブスク解約方法・解約後の閲覧可否・返金条件〕`,
    `動作環境: ${products.some((x) => x.operatingEnvironment) ? '各商品ページに記載します。' : '〔要記入: 対応OS/アプリ/バージョン等の動作環境〕'}`,
    p?.invoiceRegistrationNumber ? `適格請求書発行事業者登録番号: ${p.invoiceRegistrationNumber}` : '適格請求書発行事業者登録番号: 〔未登録の場合は記載不要〕',
    '',
    '— 本表記は草案です。公開前に消費者庁 特定商取引法ガイド(通信販売)に照らし、実際の販売形態・居住地・公開方針に合わせて確認してください。',
  ];
  const body = lines.join('\n');
  return {
    docType: 'tokushoho',
    title: '特定商取引法に基づく表記(草案)',
    versionLabel: TODAY_LABEL,
    body,
    sourceIds: ['S5', 'S6'],
    placeholderCount: countPlaceholders(body),
  };
}

/** 利用規約の草案(章立てテンプレ)。出典 S6。 */
export function generateTerms(db: DB): GeneratedDraft {
  const p = firstProfile(db);
  const name = ph(p?.tradeName, '屋号または氏名');
  const lines = [
    '# 利用規約',
    '',
    `本規約は、${name}(以下「当方」)が提供する商品・サービスの利用条件を定めるものです。`,
    '',
    '## 第1条(適用範囲)',
    '本規約は、利用者と当方との間の本サービスの利用に関わる一切の関係に適用されます。',
    '## 第2条(アカウント登録と管理)',
    '利用者は、登録情報を正確に保ち、アカウントを自己の責任で管理するものとします。',
    '## 第3条(商品・会員サービスの内容)',
    '〔要記入: 提供する商品・会員サービスの範囲、ダウンロード/講座/会員限定投稿等の内容〕',
    '## 第4条(料金、支払い、更新、解約)',
    '料金は税込価格を商品ページおよび決済画面で表示します。〔要記入: 更新周期・更新価格・解約方法・解約期限・無料期間終了後の扱い〕',
    '## 第5条(デジタル商品のライセンス)',
    '〔要記入: 利用範囲(購入者本人のみ/商用利用可否)、再配布・転売・改変・生成AI学習への投入の禁止、成果物への組込み可否、クレジット表記要否〕',
    '## 第6条(禁止事項)',
    '法令違反、第三者の権利侵害、不正アクセス、再配布・転売、当方の運営を妨害する行為を禁止します。',
    '## 第7条(知的財産権)',
    '本サービスおよび提供物に関する著作権その他の知的財産権は当方または正当な権利者に帰属します。',
    '## 第8条(投稿・コミュニティ機能)',
    '〔要記入: コミュニティ機能がある場合の投稿ルール・削除条件。無い場合は本条を削除〕',
    '## 第9条(サービスの停止・変更・終了)',
    '当方は、必要と判断した場合、利用者へ通知のうえ本サービスを変更・停止・終了できるものとします。',
    '## 第10条(返金・キャンセル)',
    '〔要記入: デジタル商品の返金条件、サブスク解約後の扱い〕',
    '## 第11条(免責・責任制限)',
    '当方は、法令で許容される範囲で、本サービスに関する損害について責任を負わないものとします。',
    '## 第12条(準拠法・管轄)',
    '本規約は日本法に準拠します。〔要記入: 合意管轄裁判所〕',
    '## 第13条(規約の変更)',
    '当方は本規約を変更することがあります。変更後の規約は、当方所定の方法で通知・掲示した時点から効力を生じます。',
    '',
    '— 本規約は草案です。公開前に専門家確認を推奨します。',
  ];
  const body = lines.join('\n');
  return {
    docType: 'terms',
    title: '利用規約(草案)',
    versionLabel: TODAY_LABEL,
    body,
    sourceIds: ['S6'],
    placeholderCount: countPlaceholders(body),
  };
}

/** プライバシーポリシーの草案。出典 S9(個人情報保護法)。 */
export function generatePrivacy(db: DB): GeneratedDraft {
  const p = firstProfile(db);
  const name = ph(p?.tradeName, '屋号または氏名');
  const lines = [
    '# プライバシーポリシー',
    '',
    `${name}(以下「当方」)は、利用者の個人情報を以下の方針に基づき取り扱います。`,
    '',
    '## 1. 取得する情報',
    '氏名、メールアドレス、決済識別子、注文履歴、問い合わせ内容、アクセスログ等。',
    '## 2. 利用目的',
    '商品提供、本人確認、課金、問い合わせ対応、メール配信、サービス改善、不正防止、法令対応のため。',
    '## 3. 第三者提供',
    '法令に基づく場合を除き、本人の同意なく第三者に提供しません。',
    '## 4. 委託先',
    '〔要記入: 決済代行・ECプラットフォーム・メール配信等の委託先の種類〕',
    '## 5. 保管期間',
    '税務・契約・問い合わせ対応に必要な期間保管し、目的達成後は適切に消去します。',
    '## 6. 安全管理',
    'アクセス制限、2要素認証、暗号化、バックアップ、権限管理等の安全管理措置を講じます。',
    '## 7. 開示・訂正・利用停止等',
    `保有個人データの開示・訂正・利用停止等の請求は、${ph(p?.tradeName, '問い合わせ窓口')}までご連絡ください。`,
    '## 8. Cookie・解析ツール',
    '〔要記入: アクセス解析・広告タグの利用有無と内容。利用しない場合はその旨〕',
    '',
    '— 本ポリシーは草案です。個人情報保護委員会のガイドラインに照らし、公開前に確認してください。',
  ];
  const body = lines.join('\n');
  return {
    docType: 'privacy',
    title: 'プライバシーポリシー(草案)',
    versionLabel: TODAY_LABEL,
    body,
    sourceIds: ['S9'],
    placeholderCount: countPlaceholders(body),
  };
}

export type GeneratableDocType = 'tokushoho' | 'terms' | 'privacy';

/** docType を指定して草案を生成する。 */
export function generateLegalDraft(db: DB, docType: GeneratableDocType): GeneratedDraft {
  switch (docType) {
    case 'tokushoho':
      return generateTokushoho(db);
    case 'terms':
      return generateTerms(db);
    case 'privacy':
      return generatePrivacy(db);
  }
}
