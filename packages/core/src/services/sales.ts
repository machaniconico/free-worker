import { writeAudit } from '../audit.js';
import type { DB } from '../db/connection.js';
import { parseCsv, serializeCsv, type CsvRow } from '../util/csv.js';
import { yearMonth } from '../util/dates.js';
import {
  cellToInteger,
  cellToNonNegativeInteger,
  cellToNullableInteger,
  nullableText,
  requireNonNegativeInteger,
  requirePositiveInteger,
  requireText,
} from '../util/validate.js';

export type PaymentStatus = 'pending' | 'paid' | 'overdue' | 'cancelled' | string;
export type DeliveryStatus = 'not_delivered' | 'delivered' | 'cancelled' | string;
export type RefundStatus = 'none' | 'partial' | 'refunded' | string;

export interface OrderItem {
  id: number;
  orderId: number;
  productId: number;
  quantity: number;
  unitPriceTaxIncluded: number;
}

export interface Invoice {
  id: number;
  invoiceNo: string;
  orderId: number | null;
  issuedAt: string;
  buyerName: string | null;
  qualifiedInvoiceFlag: boolean;
  taxRateSummary: string | null;
  attachmentId: number | null;
}

export interface Order {
  id: number;
  orderNo: string;
  customerId: number | null;
  orderedAt: string;
  channel: string;
  subtotalTaxIncluded: number;
  taxAmount: number | null;
  withholdingTax: number | null;
  paymentStatus: PaymentStatus;
  deliveryStatus: DeliveryStatus;
  refundStatus: RefundStatus;
  items: OrderItem[];
  invoice: Invoice | null;
}

export interface OrderItemInput {
  productId: number;
  quantity?: number;
  unitPriceTaxIncluded: number;
}

export interface InvoiceInput {
  invoiceNo: string;
  issuedAt: string;
  buyerName?: string | null;
  qualifiedInvoiceFlag?: boolean;
  taxRateSummary?: string | null;
  attachmentId?: number | null;
}

export interface CreateOrderInput {
  orderNo: string;
  customerId?: number | null;
  orderedAt: string;
  channel: string;
  subtotalTaxIncluded: number;
  taxAmount?: number | null;
  withholdingTax?: number | null;
  paymentStatus?: PaymentStatus;
  deliveryStatus?: DeliveryStatus;
  refundStatus?: RefundStatus;
  items?: OrderItemInput[];
  invoice?: InvoiceInput | null;
}

export type UpdateOrderInput = Partial<CreateOrderInput>;

export interface ImportOrdersCsvResult {
  imported: number;
  created: number;
  updated: number;
}

export interface MonthlySalesSummary {
  month: string;
  salesTaxIncluded: number;
  taxAmount: number;
  uncollectedAmount: number;
  refundAmount: number;
  cancelledAmount: number;
  orderCount: number;
}

interface OrderRow {
  id: number;
  order_no: string;
  customer_id: number | null;
  ordered_at: string;
  channel: string;
  subtotal_tax_included: number;
  tax_amount: number | null;
  withholding_tax: number | null;
  payment_status: string;
  delivery_status: string;
  refund_status: string;
}

interface OrderItemRow {
  id: number;
  order_id: number;
  product_id: number;
  quantity: number;
  unit_price_tax_included: number;
}

interface InvoiceRow {
  id: number;
  invoice_no: string;
  order_id: number | null;
  issued_at: string;
  buyer_name: string | null;
  qualified_invoice_flag: number;
  tax_rate_summary: string | null;
  attachment_id: number | null;
}

const ORDER_ENTITY = 'order';
const CSV_COLUMNS = [
  'orderNo',
  'customerId',
  'orderedAt',
  'channel',
  'subtotalTaxIncluded',
  'taxAmount',
  'paymentStatus',
  'deliveryStatus',
  'refundStatus',
  'itemsJson',
  'invoiceNo',
  'invoiceIssuedAt',
  'buyerName',
  'qualifiedInvoiceFlag',
  'taxRateSummary',
  'attachmentId',
  'withholdingTax',
];

export function createOrder(db: DB, input: CreateOrderInput, actor = 'local_user'): Order {
  const payload = normalizeCreate(input);
  return db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO orders
          (order_no, customer_id, ordered_at, channel, subtotal_tax_included, tax_amount,
           withholding_tax, payment_status, delivery_status, refund_status)
         VALUES
          (@orderNo, @customerId, @orderedAt, @channel, @subtotalTaxIncluded, @taxAmount,
           @withholdingTax, @paymentStatus, @deliveryStatus, @refundStatus)`,
      )
      .run(payload);
    const orderId = Number(result.lastInsertRowid);
    replaceItems(db, orderId, payload.items);
    replaceInvoice(db, orderId, payload.invoice);
    const created = getOrderOrThrow(db, orderId);
    writeAudit(db, { actor, action: 'create', entityType: ORDER_ENTITY, entityId: orderId, after: created });
    return created;
  })();
}

export function getOrder(db: DB, id: number): Order | null {
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as OrderRow | undefined;
  return row ? mapOrder(db, row) : null;
}

export function listOrders(db: DB): Order[] {
  const rows = db.prepare('SELECT * FROM orders ORDER BY ordered_at ASC, id ASC').all() as OrderRow[];
  return rows.map((row) => mapOrder(db, row));
}

export function updateOrder(db: DB, id: number, input: UpdateOrderInput, actor = 'local_user'): Order | null {
  const before = getOrder(db, id);
  if (!before) return null;
  const payload = normalizeUpdate(input);
  return db.transaction(() => {
    db.prepare(
      `UPDATE orders
       SET order_no = CASE WHEN @hasOrderNo = 1 THEN @orderNo ELSE order_no END,
           customer_id = CASE WHEN @hasCustomerId = 1 THEN @customerId ELSE customer_id END,
           ordered_at = CASE WHEN @hasOrderedAt = 1 THEN @orderedAt ELSE ordered_at END,
           channel = CASE WHEN @hasChannel = 1 THEN @channel ELSE channel END,
           subtotal_tax_included = CASE
             WHEN @hasSubtotalTaxIncluded = 1 THEN @subtotalTaxIncluded
             ELSE subtotal_tax_included
           END,
           tax_amount = CASE WHEN @hasTaxAmount = 1 THEN @taxAmount ELSE tax_amount END,
           withholding_tax = CASE WHEN @hasWithholdingTax = 1 THEN @withholdingTax ELSE withholding_tax END,
           payment_status = CASE WHEN @hasPaymentStatus = 1 THEN @paymentStatus ELSE payment_status END,
           delivery_status = CASE WHEN @hasDeliveryStatus = 1 THEN @deliveryStatus ELSE delivery_status END,
           refund_status = CASE WHEN @hasRefundStatus = 1 THEN @refundStatus ELSE refund_status END
       WHERE id = @id`,
    ).run({ id, ...payload.order });
    if (payload.hasItems) replaceItems(db, id, payload.items);
    if (payload.hasInvoice) replaceInvoice(db, id, payload.invoice);
    const after = getOrderOrThrow(db, id);
    writeAudit(db, { actor, action: 'update', entityType: ORDER_ENTITY, entityId: id, before, after });
    return after;
  })();
}

export function deleteOrder(db: DB, id: number, actor = 'local_user'): boolean {
  const before = getOrder(db, id);
  if (!before) return false;
  db.transaction(() => {
    writeAudit(db, { actor, action: 'delete', entityType: ORDER_ENTITY, entityId: id, before });
    db.prepare('DELETE FROM invoices WHERE order_id = ?').run(id);
    db.prepare('DELETE FROM orders WHERE id = ?').run(id);
  })();
  return true;
}

export function updatePaymentStatus(db: DB, id: number, status: PaymentStatus, actor = 'local_user'): Order | null {
  return updateOrder(db, id, { paymentStatus: requireText(status, 'paymentStatus') }, actor);
}

export function updateRefundStatus(db: DB, id: number, status: RefundStatus, actor = 'local_user'): Order | null {
  return updateOrder(db, id, { refundStatus: requireText(status, 'refundStatus') }, actor);
}

export function updateDeliveryStatus(db: DB, id: number, status: DeliveryStatus, actor = 'local_user'): Order | null {
  return updateOrder(db, id, { deliveryStatus: requireText(status, 'deliveryStatus') }, actor);
}

export function exportOrdersCsv(db: DB): string {
  const rows: CsvRow[] = listOrders(db).map((order) => ({
    orderNo: order.orderNo,
    customerId: numberToCell(order.customerId),
    orderedAt: order.orderedAt,
    channel: order.channel,
    subtotalTaxIncluded: String(order.subtotalTaxIncluded),
    taxAmount: numberToCell(order.taxAmount),
    paymentStatus: order.paymentStatus,
    deliveryStatus: order.deliveryStatus,
    refundStatus: order.refundStatus,
    itemsJson: JSON.stringify(
      order.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        unitPriceTaxIncluded: item.unitPriceTaxIncluded,
      })),
    ),
    invoiceNo: order.invoice?.invoiceNo ?? '',
    invoiceIssuedAt: order.invoice?.issuedAt ?? '',
    buyerName: order.invoice?.buyerName ?? '',
    qualifiedInvoiceFlag: order.invoice ? (order.invoice.qualifiedInvoiceFlag ? '1' : '0') : '',
    taxRateSummary: order.invoice?.taxRateSummary ?? '',
    attachmentId: numberToCell(order.invoice?.attachmentId ?? null),
    withholdingTax: numberToCell(order.withholdingTax),
  }));
  return serializeCsv(rows, { columns: CSV_COLUMNS, bom: false });
}

export function importOrdersCsv(db: DB, text: string, actor = 'local_user'): ImportOrdersCsvResult {
  const rows = parseCsv(text);
  const result: ImportOrdersCsvResult = { imported: 0, created: 0, updated: 0 };
  db.transaction(() => {
    for (const row of rows) {
      const input = orderInputFromCsv(row);
      const existing = getOrderByNo(db, input.orderNo);
      if (existing) {
        updateOrder(db, existing.id, input, actor);
        result.updated++;
      } else {
        createOrder(db, input, actor);
        result.created++;
      }
      result.imported++;
    }
  })();
  return result;
}

export function monthlySummary(db: DB, month?: string): MonthlySalesSummary[] {
  const summaries = new Map<string, MonthlySalesSummary>();
  for (const order of listOrders(db)) {
    const key = yearMonth(order.orderedAt);
    if (month && key !== month) continue;
    const current =
      summaries.get(key) ??
      ({
        month: key,
        salesTaxIncluded: 0,
        taxAmount: 0,
        uncollectedAmount: 0,
        refundAmount: 0,
        cancelledAmount: 0,
        orderCount: 0,
      } satisfies MonthlySalesSummary);
    current.salesTaxIncluded += order.subtotalTaxIncluded;
    current.taxAmount += order.taxAmount ?? 0;
    if (order.paymentStatus !== 'paid') current.uncollectedAmount += order.subtotalTaxIncluded;
    if (order.refundStatus !== 'none') current.refundAmount += order.subtotalTaxIncluded;
    if (order.paymentStatus === 'cancelled') current.cancelledAmount += order.subtotalTaxIncluded;
    current.orderCount += 1;
    summaries.set(key, current);
  }
  return [...summaries.values()].sort((a, b) => a.month.localeCompare(b.month));
}

function getOrderByNo(db: DB, orderNo: string): Order | null {
  const row = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(orderNo) as OrderRow | undefined;
  return row ? mapOrder(db, row) : null;
}

function getOrderOrThrow(db: DB, id: number): Order {
  const order = getOrder(db, id);
  if (!order) throw new Error(`order not found: ${id}`);
  return order;
}

function normalizeCreate(input: CreateOrderInput): Required<CreateOrderInput> {
  return {
    orderNo: requireText(input.orderNo, 'orderNo'),
    customerId: nullableInteger(input.customerId, 'customerId'),
    orderedAt: requireText(input.orderedAt, 'orderedAt'),
    channel: requireText(input.channel, 'channel'),
    subtotalTaxIncluded: requireNonNegativeInteger(input.subtotalTaxIncluded, 'subtotalTaxIncluded'),
    taxAmount: input.taxAmount == null ? null : requireNonNegativeInteger(input.taxAmount, 'taxAmount'),
    withholdingTax:
      input.withholdingTax == null ? null : requireNonNegativeInteger(input.withholdingTax, 'withholdingTax'),
    paymentStatus: requireText(input.paymentStatus ?? 'pending', 'paymentStatus'),
    deliveryStatus: requireText(input.deliveryStatus ?? 'not_delivered', 'deliveryStatus'),
    refundStatus: requireText(input.refundStatus ?? 'none', 'refundStatus'),
    items: normalizeItems(input.items ?? []),
    invoice: input.invoice === undefined ? null : normalizeInvoice(input.invoice),
  };
}

function normalizeUpdate(input: UpdateOrderInput): {
  order: Record<string, string | number | null>;
  hasItems: boolean;
  items: OrderItemInput[];
  hasInvoice: boolean;
  invoice: InvoiceInput | null;
} {
  const order: Record<string, string | number | null> = {
    hasOrderNo: 0,
    orderNo: null,
    hasCustomerId: 0,
    customerId: null,
    hasOrderedAt: 0,
    orderedAt: null,
    hasChannel: 0,
    channel: null,
    hasSubtotalTaxIncluded: 0,
    subtotalTaxIncluded: null,
    hasTaxAmount: 0,
    taxAmount: null,
    hasWithholdingTax: 0,
    withholdingTax: null,
    hasPaymentStatus: 0,
    paymentStatus: null,
    hasDeliveryStatus: 0,
    deliveryStatus: null,
    hasRefundStatus: 0,
    refundStatus: null,
  };
  if (input.orderNo !== undefined) setPatch(order, 'OrderNo', 'orderNo', requireText(input.orderNo, 'orderNo'));
  if (input.customerId !== undefined) {
    setPatch(order, 'CustomerId', 'customerId', nullableInteger(input.customerId, 'customerId'));
  }
  if (input.orderedAt !== undefined) setPatch(order, 'OrderedAt', 'orderedAt', requireText(input.orderedAt, 'orderedAt'));
  if (input.channel !== undefined) setPatch(order, 'Channel', 'channel', requireText(input.channel, 'channel'));
  if (input.subtotalTaxIncluded !== undefined) {
    setPatch(
      order,
      'SubtotalTaxIncluded',
      'subtotalTaxIncluded',
      requireNonNegativeInteger(input.subtotalTaxIncluded, 'subtotalTaxIncluded'),
    );
  }
  if (input.taxAmount !== undefined) {
    setPatch(order, 'TaxAmount', 'taxAmount', input.taxAmount == null ? null : requireNonNegativeInteger(input.taxAmount, 'taxAmount'));
  }
  if (input.withholdingTax !== undefined) {
    setPatch(
      order,
      'WithholdingTax',
      'withholdingTax',
      input.withholdingTax == null ? null : requireNonNegativeInteger(input.withholdingTax, 'withholdingTax'),
    );
  }
  if (input.paymentStatus !== undefined) {
    setPatch(order, 'PaymentStatus', 'paymentStatus', requireText(input.paymentStatus, 'paymentStatus'));
  }
  if (input.deliveryStatus !== undefined) {
    setPatch(order, 'DeliveryStatus', 'deliveryStatus', requireText(input.deliveryStatus, 'deliveryStatus'));
  }
  if (input.refundStatus !== undefined) {
    setPatch(order, 'RefundStatus', 'refundStatus', requireText(input.refundStatus, 'refundStatus'));
  }
  return {
    order,
    hasItems: input.items !== undefined,
    items: input.items === undefined ? [] : normalizeItems(input.items),
    hasInvoice: input.invoice !== undefined,
    invoice: input.invoice === undefined ? null : normalizeInvoice(input.invoice),
  };
}

function setPatch(
  order: Record<string, string | number | null>,
  flagSuffix: string,
  valueKey: string,
  value: string | number | null,
): void {
  order[`has${flagSuffix}`] = 1;
  order[valueKey] = value;
}

function normalizeItems(items: OrderItemInput[]): OrderItemInput[] {
  return items.map((item) => ({
    productId: requirePositiveInteger(item.productId, 'productId'),
    quantity: requirePositiveInteger(item.quantity ?? 1, 'quantity'),
    unitPriceTaxIncluded: requireNonNegativeInteger(item.unitPriceTaxIncluded, 'unitPriceTaxIncluded'),
  }));
}

function normalizeInvoice(invoice: InvoiceInput | null): InvoiceInput | null {
  if (!invoice) return null;
  return {
    invoiceNo: requireText(invoice.invoiceNo, 'invoiceNo'),
    issuedAt: requireText(invoice.issuedAt, 'issuedAt'),
    buyerName: nullableText(invoice.buyerName),
    qualifiedInvoiceFlag: invoice.qualifiedInvoiceFlag ?? false,
    taxRateSummary: nullableText(invoice.taxRateSummary),
    attachmentId: nullableInteger(invoice.attachmentId, 'attachmentId'),
  };
}

function replaceItems(db: DB, orderId: number, items: OrderItemInput[]): void {
  db.prepare('DELETE FROM order_items WHERE order_id = ?').run(orderId);
  const insert = db.prepare(
    `INSERT INTO order_items (order_id, product_id, quantity, unit_price_tax_included)
     VALUES (@orderId, @productId, @quantity, @unitPriceTaxIncluded)`,
  );
  for (const item of items) {
    insert.run({ orderId, ...item });
  }
}

function replaceInvoice(db: DB, orderId: number, invoice: InvoiceInput | null): void {
  db.prepare('DELETE FROM invoices WHERE order_id = ?').run(orderId);
  if (!invoice) return;
  db.prepare(
    `INSERT INTO invoices
      (invoice_no, order_id, issued_at, buyer_name, qualified_invoice_flag, tax_rate_summary, attachment_id)
     VALUES
      (@invoiceNo, @orderId, @issuedAt, @buyerName, @qualifiedInvoiceFlag, @taxRateSummary, @attachmentId)`,
  ).run({
    orderId,
    invoiceNo: invoice.invoiceNo,
    issuedAt: invoice.issuedAt,
    buyerName: invoice.buyerName ?? null,
    qualifiedInvoiceFlag: invoice.qualifiedInvoiceFlag ? 1 : 0,
    taxRateSummary: invoice.taxRateSummary ?? null,
    attachmentId: invoice.attachmentId ?? null,
  });
}

function mapOrder(db: DB, row: OrderRow): Order {
  return {
    id: row.id,
    orderNo: row.order_no,
    customerId: row.customer_id,
    orderedAt: row.ordered_at,
    channel: row.channel,
    subtotalTaxIncluded: row.subtotal_tax_included,
    taxAmount: row.tax_amount,
    withholdingTax: row.withholding_tax,
    paymentStatus: row.payment_status,
    deliveryStatus: row.delivery_status,
    refundStatus: row.refund_status,
    items: listOrderItems(db, row.id),
    invoice: getInvoiceForOrder(db, row.id),
  };
}

function listOrderItems(db: DB, orderId: number): OrderItem[] {
  const rows = db
    .prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC')
    .all(orderId) as OrderItemRow[];
  return rows.map((row) => ({
    id: row.id,
    orderId: row.order_id,
    productId: row.product_id,
    quantity: row.quantity,
    unitPriceTaxIncluded: row.unit_price_tax_included,
  }));
}

function getInvoiceForOrder(db: DB, orderId: number): Invoice | null {
  const row = db.prepare('SELECT * FROM invoices WHERE order_id = ? ORDER BY id ASC LIMIT 1').get(orderId) as
    | InvoiceRow
    | undefined;
  return row
    ? {
        id: row.id,
        invoiceNo: row.invoice_no,
        orderId: row.order_id,
        issuedAt: row.issued_at,
        buyerName: row.buyer_name,
        qualifiedInvoiceFlag: row.qualified_invoice_flag === 1,
        taxRateSummary: row.tax_rate_summary,
        attachmentId: row.attachment_id,
      }
    : null;
}

function orderInputFromCsv(row: CsvRow): CreateOrderInput {
  return {
    orderNo: requireText(row.orderNo, 'orderNo'),
    customerId: cellToNullableInteger(row.customerId, 'customerId'),
    orderedAt: requireText(row.orderedAt, 'orderedAt'),
    channel: requireText(row.channel, 'channel'),
    subtotalTaxIncluded: cellToNonNegativeInteger(row.subtotalTaxIncluded, 'subtotalTaxIncluded'),
    taxAmount: row.taxAmount?.trim()
      ? requireNonNegativeInteger(cellToInteger(row.taxAmount, 'taxAmount'), 'taxAmount')
      : null,
    withholdingTax: row.withholdingTax?.trim()
      ? requireNonNegativeInteger(cellToInteger(row.withholdingTax, 'withholdingTax'), 'withholdingTax')
      : null,
    paymentStatus: requireText(row.paymentStatus || 'pending', 'paymentStatus'),
    deliveryStatus: requireText(row.deliveryStatus || 'not_delivered', 'deliveryStatus'),
    refundStatus: requireText(row.refundStatus || 'none', 'refundStatus'),
    items: parseItemsJson(row.itemsJson),
    invoice: row.invoiceNo
      ? {
          invoiceNo: requireText(row.invoiceNo, 'invoiceNo'),
          issuedAt: requireText(row.invoiceIssuedAt, 'invoiceIssuedAt'),
          buyerName: nullableText(row.buyerName),
          qualifiedInvoiceFlag: row.qualifiedInvoiceFlag === '1' || row.qualifiedInvoiceFlag === 'true',
          taxRateSummary: nullableText(row.taxRateSummary),
          attachmentId: cellToNullableInteger(row.attachmentId, 'attachmentId'),
        }
      : null,
  };
}

function parseItemsJson(value: string | undefined): OrderItemInput[] {
  if (!value?.trim()) return [];
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new Error('itemsJson must be an array');
  return parsed.map((item) => {
    const candidate = item as Partial<OrderItemInput>;
    if (candidate.productId == null) throw new Error('productId is required');
    if (candidate.unitPriceTaxIncluded == null) throw new Error('unitPriceTaxIncluded is required');
    return {
      productId: requirePositiveInteger(candidate.productId, 'productId'),
      quantity: requirePositiveInteger(candidate.quantity ?? 1, 'quantity'),
      unitPriceTaxIncluded: requireNonNegativeInteger(candidate.unitPriceTaxIncluded, 'unitPriceTaxIncluded'),
    };
  });
}

function requireInteger(value: number | null | undefined, field: string): number {
  if (!Number.isInteger(value)) throw new Error(`${field} must be an integer`);
  return Number(value);
}

function nullableInteger(value: number | null | undefined, field: string): number | null {
  if (value == null) return null;
  return requireInteger(value, field);
}

function numberToCell(value: number | null): string {
  return value == null ? '' : String(value);
}
