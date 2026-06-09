import type { FastifyInstance } from 'fastify';
import {
  TAX_RATE_REDUCED,
  TAX_RATE_STANDARD,
  taxFromInclusive,
  type DB,
} from '@free-worker/core';

interface InvoiceView {
  qualified: boolean;
  issuer: InvoiceIssuer;
  buyer: InvoiceBuyer;
  order: InvoiceOrder;
  items: InvoiceViewItem[];
  taxRateBreakdown: InvoiceTaxRateBreakdown[];
  totalTaxIncluded: number;
}

interface InvoiceIssuer {
  name: string | null;
  invoiceRegistrationNumber: string | null;
}

interface InvoiceBuyer {
  name: string | null;
}

interface InvoiceOrder {
  id: number;
  orderNo: string;
  orderedAt: string;
}

interface InvoiceViewItem {
  id: number;
  productId: number;
  productTitle: string;
  quantity: number;
  unitPriceTaxIncluded: number;
  subtotalTaxIncluded: number;
  taxRate: 10 | 8;
}

interface InvoiceTaxRateBreakdown {
  taxRate: 10 | 8;
  taxableAmountTaxIncluded: number;
  taxAmount: number;
}

interface OrderRow {
  id: number;
  order_no: string;
  customer_id: number | null;
  ordered_at: string;
}

interface InvoiceRow {
  buyer_name: string | null;
}

interface CustomerRow {
  display_name: string | null;
}

interface ProfileRow {
  trade_name: string;
  invoice_registration_number: string | null;
}

interface ItemRow {
  id: number;
  product_id: number;
  product_title: string;
  quantity: number;
  unit_price_tax_included: number;
  product_tax_rate: unknown;
}

interface TableInfoRow {
  name: string;
}

interface InvoiceViewParams {
  orderId: string;
}

const TAX_RATE_COLUMNS = ['tax_rate', 'consumption_tax_rate', 'invoice_tax_rate'] as const;

export async function invoiceRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: InvoiceViewParams }>('/api/invoices/:orderId/view', async (req, reply) => {
    const orderId = parseId(req.params.orderId);
    if (orderId == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }

    const view = buildInvoiceView(app.db, orderId);
    if (!view) {
      reply.code(404);
      return { error: 'not_found' };
    }
    return view;
  });
}

function parseId(id: string): number | null {
  if (!/^\d+$/.test(id)) return null;
  const parsed = Number(id);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function buildInvoiceView(db: DB, orderId: number): InvoiceView | null {
  const order = db
    .prepare(
      `SELECT id, order_no, customer_id, ordered_at
       FROM orders
       WHERE id = ?`,
    )
    .get(orderId) as OrderRow | undefined;
  if (!order) return null;

  const profile = db
    .prepare(
      `SELECT trade_name, invoice_registration_number
       FROM business_profiles
       ORDER BY id ASC
       LIMIT 1`,
    )
    .get() as ProfileRow | undefined;
  const invoice = db
    .prepare(
      `SELECT buyer_name
       FROM invoices
       WHERE order_id = ?
       ORDER BY id ASC
       LIMIT 1`,
    )
    .get(order.id) as InvoiceRow | undefined;

  const items = listInvoiceItems(db, order.id);
  return {
    qualified: Boolean(profile?.invoice_registration_number),
    issuer: {
      name: profile?.trade_name ?? null,
      invoiceRegistrationNumber: profile?.invoice_registration_number ?? null,
    },
    buyer: {
      name: invoice?.buyer_name ?? getCustomerName(db, order.customer_id),
    },
    order: {
      id: order.id,
      orderNo: order.order_no,
      orderedAt: order.ordered_at,
    },
    items,
    taxRateBreakdown: buildTaxRateBreakdown(items),
    totalTaxIncluded: items.reduce((total, item) => total + item.subtotalTaxIncluded, 0),
  };
}

function getCustomerName(db: DB, customerId: number | null): string | null {
  if (customerId == null) return null;
  const customer = db
    .prepare(
      `SELECT display_name
       FROM customers
       WHERE id = ?`,
    )
    .get(customerId) as CustomerRow | undefined;
  return customer?.display_name ?? null;
}

function listInvoiceItems(db: DB, orderId: number): InvoiceViewItem[] {
  const taxRateColumn = getProductTaxRateColumn(db);
  const taxRateSelect = taxRateColumn ? `p.${taxRateColumn}` : 'NULL';
  const rows = db
    .prepare(
      `SELECT oi.id, oi.product_id, p.title AS product_title, oi.quantity,
              oi.unit_price_tax_included, ${taxRateSelect} AS product_tax_rate
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = ?
       ORDER BY oi.id ASC`,
    )
    .all(orderId) as ItemRow[];

  return rows.map((row) => {
    const taxRate = normalizeTaxRate(row.product_tax_rate);
    return {
      id: row.id,
      productId: row.product_id,
      productTitle: row.product_title,
      quantity: row.quantity,
      unitPriceTaxIncluded: row.unit_price_tax_included,
      subtotalTaxIncluded: row.unit_price_tax_included * row.quantity,
      taxRate,
    };
  });
}

function getProductTaxRateColumn(db: DB): string | null {
  const rows = db.prepare('PRAGMA table_info(products)').all() as TableInfoRow[];
  const names = new Set(rows.map((row) => row.name));
  return TAX_RATE_COLUMNS.find((name) => names.has(name)) ?? null;
}

function normalizeTaxRate(value: unknown): 10 | 8 {
  if (value === 8 || value === '8' || value === 0.08 || value === '0.08') return 8;
  return 10;
}

function buildTaxRateBreakdown(items: InvoiceViewItem[]): InvoiceTaxRateBreakdown[] {
  return [
    buildBreakdown(10, TAX_RATE_STANDARD, items),
    buildBreakdown(8, TAX_RATE_REDUCED, items),
  ];
}

function buildBreakdown(
  taxRate: 10 | 8,
  rate: typeof TAX_RATE_STANDARD | typeof TAX_RATE_REDUCED,
  items: InvoiceViewItem[],
): InvoiceTaxRateBreakdown {
  const taxableAmountTaxIncluded = items
    .filter((item) => item.taxRate === taxRate)
    .reduce((total, item) => total + item.subtotalTaxIncluded, 0);
  return {
    taxRate,
    taxableAmountTaxIncluded,
    taxAmount: taxFromInclusive(taxableAmountTaxIncluded, rate),
  };
}
