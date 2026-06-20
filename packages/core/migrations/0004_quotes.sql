CREATE TABLE quotes (
  id INTEGER PRIMARY KEY,
  quote_no TEXT UNIQUE NOT NULL,
  customer_id INTEGER REFERENCES customers(id),
  issued_at TEXT NOT NULL,
  valid_until TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  subtotal_tax_included INTEGER NOT NULL DEFAULT 0,
  tax_amount INTEGER,
  note TEXT,
  converted_order_id INTEGER REFERENCES orders(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE quote_items (
  id INTEGER PRIMARY KEY,
  quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  description TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price_tax_included INTEGER NOT NULL
);
CREATE INDEX idx_quotes_status ON quotes(status);
