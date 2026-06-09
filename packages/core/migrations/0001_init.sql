-- 0001_init.sql
-- ベーススキーマ。出典: docs/reference/data_model.sql (startup pack 2026-06-09)。
-- 金額は整数(円・税込)で保持。日時は TEXT(ISO8601)。

CREATE TABLE business_profiles (
  id INTEGER PRIMARY KEY,
  trade_name TEXT NOT NULL,
  legal_name_public_policy TEXT NOT NULL DEFAULT '未設定',
  business_start_date TEXT,
  tax_office TEXT,
  blue_return_enabled INTEGER NOT NULL DEFAULT 0,
  invoice_registration_number TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  checked_on TEXT NOT NULL,
  note TEXT
);

CREATE TABLE attachments (
  id INTEGER PRIMARY KEY,
  file_path TEXT NOT NULL,
  sha256 TEXT,
  label TEXT,
  confidential_level TEXT NOT NULL DEFAULT 'internal',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE obligations (
  id INTEGER PRIMARY KEY,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  due_date TEXT,
  recurrence TEXT,
  status TEXT NOT NULL DEFAULT '未着手',
  source_id TEXT REFERENCES sources(id),
  evidence_attachment_id INTEGER REFERENCES attachments(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  sku TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  product_type TEXT NOT NULL CHECK(product_type IN ('download','course','membership','template','service','other')),
  price_tax_included INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'JPY',
  license_summary TEXT,
  operating_environment TEXT,
  refund_policy TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE subscription_plans (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  plan_name TEXT NOT NULL,
  billing_period TEXT NOT NULL CHECK(billing_period IN ('monthly','yearly','one_time','other')),
  renewal_policy TEXT NOT NULL,
  cancellation_policy TEXT NOT NULL,
  trial_policy TEXT,
  post_cancel_access_policy TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  display_name TEXT,
  email_hash TEXT,
  email_encrypted TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE consents (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  consent_type TEXT NOT NULL,
  consented_at TEXT NOT NULL,
  source TEXT,
  revoked_at TEXT,
  evidence_attachment_id INTEGER REFERENCES attachments(id)
);

CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  order_no TEXT UNIQUE NOT NULL,
  customer_id INTEGER REFERENCES customers(id),
  ordered_at TEXT NOT NULL,
  channel TEXT NOT NULL,
  subtotal_tax_included INTEGER NOT NULL,
  tax_amount INTEGER,
  payment_status TEXT NOT NULL DEFAULT 'pending',
  delivery_status TEXT NOT NULL DEFAULT 'not_delivered',
  refund_status TEXT NOT NULL DEFAULT 'none'
);

CREATE TABLE order_items (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price_tax_included INTEGER NOT NULL
);

CREATE TABLE invoices (
  id INTEGER PRIMARY KEY,
  invoice_no TEXT UNIQUE NOT NULL,
  order_id INTEGER REFERENCES orders(id),
  issued_at TEXT NOT NULL,
  buyer_name TEXT,
  qualified_invoice_flag INTEGER NOT NULL DEFAULT 0,
  tax_rate_summary TEXT,
  attachment_id INTEGER REFERENCES attachments(id)
);

CREATE TABLE expenses (
  id INTEGER PRIMARY KEY,
  spent_at TEXT NOT NULL,
  vendor TEXT,
  category TEXT NOT NULL,
  amount_tax_included INTEGER NOT NULL,
  tax_amount INTEGER,
  payment_method TEXT,
  purpose TEXT,
  attachment_id INTEGER REFERENCES attachments(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE content_projects (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idea',
  planned_release_date TEXT,
  rights_check_status TEXT NOT NULL DEFAULT '未確認',
  product_id INTEGER REFERENCES products(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE tasks (
  id INTEGER PRIMARY KEY,
  project_id INTEGER REFERENCES content_projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo',
  priority TEXT NOT NULL DEFAULT 'medium',
  due_date TEXT,
  checklist_ref TEXT
);

CREATE TABLE risks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  severity TEXT NOT NULL,
  impact TEXT,
  mitigation TEXT,
  status TEXT NOT NULL DEFAULT 'open'
);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY,
  actor TEXT NOT NULL DEFAULT 'local_user',
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_obligations_due ON obligations(due_date);
CREATE INDEX idx_obligations_status ON obligations(status);
CREATE INDEX idx_subscription_plans_product ON subscription_plans(product_id);
CREATE INDEX idx_orders_ordered_at ON orders(ordered_at);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_invoices_order ON invoices(order_id);
CREATE INDEX idx_expenses_spent_at ON expenses(spent_at);
CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_consents_customer ON consents(customer_id);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);
