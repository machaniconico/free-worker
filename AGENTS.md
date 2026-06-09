# AGENTS.md — 実装規約 (Codex 向け)

このリポジトリは個人事業主・フリーランス向けの**ローカルファースト業務支援アプリ**。
クラウドLLM/外部APIに**実行時依存しない**ことが絶対条件。

## 不変条件 (違反したら実装を差し戻す)

1. **実行時にネットワークへ出ない。** サーバは `127.0.0.1` のみbind。外部HTTP呼び出しは「AI補助」アダプタ経由の任意機能だけで、既定OFF・未接続でも全機能が動く。
2. **顧客データ・税番号・契約原本をクラウドへ送らない。** テスト/開発は `fixtures/` の合成データのみ。
3. **金額は整数(税込・最小通貨単位=円)で保持。** 浮動小数で金額計算しない。丸めは `@free-worker/core` の money ユーティリティに集約。
4. **SQLは必ずプレースホルダ。** 文字列連結でSQLを組まない (SQL injection 禁止)。
5. **破壊的操作の前に監査ログ + バックアップ。** create/update/delete は `audit_logs` に記録。

## ディレクトリ

```
packages/core/    ドメインロジック・DB・マイグレーション・CSV・バックアップ・AIアダプタIF (ヘッドレスでテスト可能)
packages/server/  Fastify HTTP API (coreの薄いラッパ、127.0.0.1 bind、web/dist を静的配信)
packages/web/     Vite + React + TS SPA
fixtures/         合成データ (synthetic_*.csv) — 実データ禁止
docs/             spec / data_model / compliance_sources / threat_model / reference(元パック)
```

## コマンド

- 型: `npm run typecheck`
- テスト: `npm run test` (vitest, ネットワーク不要)
- ビルド: `npm run build`
- 起動: `npm run start` (ビルド後) / 開発: `npm run dev`

## 完了条件 (各ストーリー)

- 対象 `touchedFiles` のみ変更。スコープ外を触らない。
- `npm run typecheck` と関連 vitest が green。
- 新規ファイルは `git add -N` 済み(レビューのdiffに乗せるため)。
- 受け入れ条件 (PRDの acceptance) を満たす最小実装 + テスト。

## 禁止

- クラウドLLM/有料API呼び出しの実装(配線=アダプタIFのみ可、既定OFF)。
- スクラッチの `*.probe.*` / `any` まみれの検証ファイルを作業ツリーに残す。
- 既存の合意済みスキーマ列の破壊的変更(マイグレーションで追加する)。
