# threat_model.md — 脅威モデル

## 守るべき機密データ
顧客情報(氏名・連絡先)、注文・売上、税番号/インボイス登録番号、契約原本、認証情報。

## 主な漏えい経路と対策(実装状況)

| 経路 | 対策 | 実装 |
|---|---|---|
| 外部API/クラウドへの送信 | サーバは `127.0.0.1` のみ。実行時にネットワークへ出ない。AI補助は任意・既定OFF | `server/src/config.ts`(host固定)、`core/src/ai/adapter.ts`、`server/test/offline.test.ts` |
| バックアップファイルの流出 | aes-256-gcm + scrypt で暗号化。平文DBを出力しない。パスフレーズは保存しない | `core/src/services/backup.ts` |
| 顧客個人情報の過剰保存 | email は平文保存せず hash/encrypted のみ。情報は最小限 | `customers` スキーマ / `services/customers.ts` |
| SQL injection | 全SQLはプレースホルダ。文字列連結でSQLを組まない | 全 service |
| CSV フォーミュラインジェクション | エクスポートCSVのセルが `= + - @`(先頭空白/`'` 挟みを含む)や TAB/CR で始まる場合、先頭に `'` を付与し Excel/Sheets での数式実行を防ぐ。自前エクスポート→インポートの往復は単射で値を完全復元 | `core/src/util/csv.ts`(guard/unguard) |
| バックアップヘッダの改ざん | ヘッダ(salt/iv/sourceDbPath)を AAD として GCM 認証タグに含め、改ざんは復元時に検知して失敗 | `core/src/services/backup.ts` |
| 改ざん・誤操作の追跡不能 | 重要データの create/update/delete を `audit_logs` に記録、CSV出力可 | `core/src/audit.ts` / `services/audit-query.ts` |
| データ消失 | 暗号化バックアップ + 復元テストログ(integrity_check) | `backup_history` / `restore_test_logs` |
| 開発時の機密投入 | 開発・テストは合成データのみ。実データをプロンプトに入れない | `AGENTS.md` 規約 |

## 残存リスク / 運用で担保
- 端末そのものの盗難・マルウェア → OS のディスク暗号化・2FA・バックアップの外部ドライブ保管。
- パスフレーズ管理 → ユーザー責任(忘れると復元不可、アプリ側で復旧不可)。
- ローカルLLM/Gemini Flash を有効化した場合の送信内容 → ユーザーが投入データを管理。
- CSV取り込み時、先頭が `'`+数式文字のセルは数式エスケープ解除として先頭 `'` を1つ除去する(自前エクスポートの往復を保証する仕様)。Excel が付与する数式エスケープと同義のため通常は正しい解釈だが、他ツール由来CSVで意図的な先頭 `'` を持つ値はこの限りでない。
