-- 0005_recurring_billings.sql
-- 定期請求(月額/年額の継続契約)。期日到来分の注文を catch-up で自動生成する。

CREATE TABLE recurring_billings (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  plan_name TEXT NOT NULL,
  amount_tax_included INTEGER NOT NULL,
  tax_amount INTEGER,
  billing_period TEXT NOT NULL CHECK(billing_period IN ('monthly','yearly')),
  start_date TEXT NOT NULL,
  next_billing_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','ended')),
  last_generated_order_id INTEGER REFERENCES orders(id),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_recurring_billings_next ON recurring_billings(next_billing_date);
CREATE INDEX idx_recurring_billings_status ON recurring_billings(status);
