import type { DB } from '../db/connection.js';
import { diffDays, toIsoDate } from '../util/dates.js';

export interface AgingBucket {
  label: '0-30' | '31-60' | '61-90' | '90+';
  count: number;
  amount: number;
}

export interface OutstandingOrder {
  id: number;
  orderNo: string;
  orderedAt: string;
  customerId: number | null;
  customerName: string | null;
  amount: number;
  daysOutstanding: number;
  bucket: string;
  paymentStatus: string;
}

export interface ArAgingReport {
  asOf: string;
  buckets: AgingBucket[];
  total: { count: number; amount: number };
  orders: OutstandingOrder[];
}

interface OutstandingRow {
  id: number;
  order_no: string;
  ordered_at: string;
  customer_id: number | null;
  subtotal_tax_included: number;
  payment_status: string;
  display_name: string | null;
}

const BUCKET_LABELS: AgingBucket['label'][] = ['0-30', '31-60', '61-90', '90+'];

function assignBucket(days: number): AgingBucket['label'] {
  if (days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

export function accountsReceivableAging(db: DB, asOf?: string): ArAgingReport {
  const asOfDate = asOf ?? toIsoDate(new Date());

  const rows = db
    .prepare(
      `SELECT o.id, o.order_no, o.ordered_at, o.customer_id, o.subtotal_tax_included, o.payment_status,
              c.display_name
       FROM orders o
       LEFT JOIN customers c ON c.id = o.customer_id
       WHERE o.payment_status NOT IN ('paid', 'cancelled')
       ORDER BY o.ordered_at ASC, o.id ASC`,
    )
    .all() as OutstandingRow[];

  const bucketMap = new Map<AgingBucket['label'], AgingBucket>(
    BUCKET_LABELS.map((label) => [label, { label, count: 0, amount: 0 }]),
  );

  const orders: OutstandingOrder[] = rows.map((row) => {
    const daysOutstanding = Math.max(0, diffDays(asOfDate, row.ordered_at));
    const bucket = assignBucket(daysOutstanding);
    const b = bucketMap.get(bucket)!;
    b.count += 1;
    b.amount += row.subtotal_tax_included;
    return {
      id: row.id,
      orderNo: row.order_no,
      orderedAt: row.ordered_at,
      customerId: row.customer_id,
      customerName: row.display_name,
      amount: row.subtotal_tax_included,
      daysOutstanding,
      bucket,
      paymentStatus: row.payment_status,
    };
  });

  // Sort by daysOutstanding descending (oldest = highest priority)
  orders.sort((a, b) => b.daysOutstanding - a.daysOutstanding || a.id - b.id);

  const total = orders.reduce(
    (acc, o) => {
      acc.count += 1;
      acc.amount += o.amount;
      return acc;
    },
    { count: 0, amount: 0 },
  );

  return {
    asOf: asOfDate,
    buckets: BUCKET_LABELS.map((label) => bucketMap.get(label)!),
    total,
    orders,
  };
}
