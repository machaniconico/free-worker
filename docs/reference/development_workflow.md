# Claude Code + Codex 併用 開発ワークフロー案

目的: アプリの実行時はクラウドAI/APIに依存しない。Claude Code と Codex は「開発支援」に限定し、顧客データ・税務番号・契約原本を渡さない。

## 方針

- ローカルファースト: SQLite + ローカル添付ファイル + ローカル暗号化バックアップ。
- AIなしで全機能が動く: AI要約や補助入力は任意機能に分離。
- 機密を出さない: 実データは開発用プロンプトに入れず、合成データ・ダミー契約のみ使う。
- 再現性: issue -> branch -> test -> review -> merge の流れを固定。

## 役割分担

- Claude Code: 既存コードベース理解、設計変更、複数ファイル編集、テスト追加、リファクタ。
- Codex: 実装の別案、バグ探索、セキュリティレビュー、テストケース生成、SQL/型の検証。
- 人間: 要件決定、法務/税務判断、顧客データ取扱い、公開可否、最終レビュー。

## リポジトリ初期構成案

```text
app/
  src/
  migrations/
  tests/
  docs/
    spec.md
    data_model.md
    compliance_sources.md
    threat_model.md
  fixtures/
    synthetic_orders.csv
    synthetic_expenses.csv
  CLAUDE.md
  AGENTS.md
  README.md
```

## 最初に作るファイル

- `docs/spec.md`: 目的、対象ユーザー、非対象、MVP、受け入れ条件。
- `docs/compliance_sources.md`: 出典URL、確認日、アプリで管理する項目。
- `docs/threat_model.md`: 機密データ、漏えい経路、対策。
- `AGENTS.md`: Codex向けの実装規約、テストコマンド、禁止事項。
- `CLAUDE.md`: Claude Code向けのプロジェクト規約、アーキテクチャ、変更時のチェックリスト。

## Claude Code 用プロンプト例

```text
このリポジトリの docs/spec.md と docs/data_model.md を読んで、
MVPの「商品・サブスク管理」だけ実装計画を作ってください。
実装前に、変更予定ファイル、DBマイグレーション、テスト方針を提示してください。
実データや外部APIは使わず、fixtures/synthetic_*.csv のみ使ってください。
```

## Codex 用レビュー依頼例

```text
以下の差分をレビューしてください。
観点: データ消失、SQL injection、個人情報の過剰保存、税込価格の丸め、テスト不足。
実装変更はせず、指摘と修正案だけ出してください。
```

## 完了条件

- ネットワークを切ってもアプリが起動し、主要CRUD、検索、CSV出力、バックアップが動く。
- テスト、型チェック、lint、DB migration検証が通る。
- 実顧客データをクラウドAIへ送っていない。
- `sources.md` に参照元と確認日が残っている。
