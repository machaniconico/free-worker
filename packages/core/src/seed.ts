import type { DB } from './db/connection.js';

/** 出典(sources.md より, 確認日 2026-06-09)。法令チェックや表示項目が参照する。 */
export const SOURCES: ReadonlyArray<{ id: string; title: string; url: string; note: string }> = [
  { id: 'S1', title: '国税庁 No.2090 新たに事業を始めたときの届出など', url: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2090.htm', note: '開業時の代表的届出と期限。' },
  { id: 'S2', title: '国税庁 No.2070 青色申告制度', url: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2070.htm', note: '青色申告、帳簿保存、承認申請の期限、特別控除。' },
  { id: 'S3', title: '国税庁 No.6498 適格請求書等保存方式(インボイス制度)', url: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6498.htm', note: 'インボイス制度の概要、登録、登録後の義務。' },
  { id: 'S4', title: '国税庁 No.6625 適格請求書等の記載事項', url: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6625.htm', note: '適格請求書の記載事項と保存期間。' },
  { id: 'S5', title: '国税庁 No.6902 「総額表示」の義務付け', url: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6902.htm', note: '消費者向け価格の税込表示。' },
  { id: 'S6', title: '消費者庁 特定商取引法ガイド 通信販売', url: 'https://www.no-trouble.caa.go.jp/what/mailorder/', note: '広告表示事項、最終確認画面、返品特約等。' },
  { id: 'S7', title: '公正取引委員会 フリーランス法特設サイト', url: 'https://www.jftc.go.jp/freelancelaw_2024/index.html', note: '取引条件明示、支払期日、禁止行為等。' },
  { id: 'S8', title: '厚生労働省 フリーランスとして業務を行う方等へ', url: 'https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/koyou_roudou/koyoukintou/zaitaku/index_00002.html', note: 'フリーランス法・就業環境整備。' },
  { id: 'S9', title: '個人情報保護委員会 法令・ガイドライン等', url: 'https://www.ppc.go.jp/personalinfo/legal/', note: '個人情報保護法、ガイドライン、FAQ。' },
  { id: 'S10', title: '消費者庁 景品表示法', url: 'https://www.caa.go.jp/policies/policy/representation/fair_labeling/', note: '不当表示、ステマ等の表示規制。' },
  { id: 'S11', title: '文化庁 著作権施策に関する総合案内ページ', url: 'https://www.bunka.go.jp/seisaku/chosakuken/', note: '著作権の基本、契約書作成支援等。' },
  { id: 'S12', title: '特許庁 商標', url: 'https://www.jpo.go.jp/system/trademark/index.html', note: '屋号・サービス名・商品名の権利確認。' },
  { id: 'S13', title: '金融庁 商品券(プリペイドカード)の払戻しについて', url: 'https://www.fsa.go.jp/policy/prepaid/', note: '前払式支払手段。独自ポイント設計の注意。' },
  { id: 'S14', title: 'Claude Code Docs Overview', url: 'https://code.claude.com/docs/en/overview', note: '開発支援機能。' },
  { id: 'S15', title: 'OpenAI Developers Codex Docs', url: 'https://developers.openai.com/codex/cloud', note: 'Codex 公式ドキュメント。' },
];

const CHECKED_ON = '2026-06-09';

/** 出典を投入する(冪等)。 */
export function seedSources(db: DB): void {
  const stmt = db.prepare(
    `INSERT INTO sources (id, title, url, checked_on, note) VALUES (@id, @title, @url, @checked_on, @note)
     ON CONFLICT(id) DO UPDATE SET title = excluded.title, url = excluded.url, note = excluded.note`,
  );
  const tx = db.transaction(() => {
    for (const s of SOURCES) {
      stmt.run({ ...s, checked_on: CHECKED_ON });
    }
  });
  tx();
}
