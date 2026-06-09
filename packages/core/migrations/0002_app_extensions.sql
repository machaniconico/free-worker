-- 0002_app_extensions.sql
-- アプリ運用に必要な追加テーブル(出典パックのスキーマには無いが本アプリで必要)。

-- アプリ設定(キー/値)。AI補助アダプタ設定もここに保持。既定はAI=OFF。
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- EPIC-04 契約・規約の版管理(特商法表記/利用規約/プライバシーポリシー/受託契約テンプレ)
CREATE TABLE document_versions (
  id INTEGER PRIMARY KEY,
  doc_type TEXT NOT NULL CHECK(doc_type IN ('tokushoho','terms','privacy','contract_template','license','other')),
  title TEXT NOT NULL,
  version_label TEXT NOT NULL,
  body TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','published','archived')),
  effective_date TEXT,
  next_review_date TEXT,
  source_id TEXT REFERENCES sources(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_document_versions_type ON document_versions(doc_type, state);

-- EPIC-10 バックアップ履歴
CREATE TABLE backup_history (
  id INTEGER PRIMARY KEY,
  file_path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  encrypted INTEGER NOT NULL DEFAULT 1,
  kind TEXT NOT NULL DEFAULT 'manual' CHECK(kind IN ('manual','auto','pre_restore')),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- EPIC-10 復元テストログ(復元が成功し整合性が取れたかの証跡)
CREATE TABLE restore_test_logs (
  id INTEGER PRIMARY KEY,
  backup_id INTEGER REFERENCES backup_history(id),
  backup_file TEXT NOT NULL,
  result TEXT NOT NULL CHECK(result IN ('success','failure')),
  integrity_check TEXT,
  restored_row_counts TEXT,
  message TEXT,
  tested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
