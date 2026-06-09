import type { FastifyInstance } from 'fastify';
import { parseCsv, serializeCsv, writeAudit, yearMonth, type CsvRow, type DB } from '@free-worker/core';

interface Order {
  id: number;
  orderNo: string;
  customerId: number | null;
  orderedAt: string;
  channel: string;
  subtotalTaxIncluded: number;
  taxAmount: number | null;
  paymentStatus: string;
  deliveryStatus: string;
  refundStatus: string;
  items: OrderItem[];
  invoice: Invoice | null;
}

interface OrderItem {
  id: number;
  orderId: number;
  productId: number;
  quantity: number;
  unitPriceTaxIncluded: number;
}

interface Invoice {
  id: number;
  invoiceNo: string;
  orderId: number | null;
  issuedAt: string;
  buyerName: string | null;
  qualifiedInvoiceFlag: boolean;
  taxRateSummary: string | null;
  attachmentId: number | null;
}

interface OrderPayload {
  orderNo?: unknown;
  customerId?: unknown;
  orderedAt?: unknown;
  channel?: unknown;
  subtotalTaxIncluded?: unknown;
  taxAmount?: unknown;
  paymentStatus?: unknown;
  deliveryStatus?: unknown;
  refundStatus?: unknown;
  items?: unknown;
  invoice?: unknown;
}

interface OrderItemPayload {
  productId?: unknown;
  quantity?: unknown;
  unitPriceTaxIncluded?: unknown;
}

interface InvoicePayload {
  invoiceNo?: unknown;
  issuedAt?: unknown;
  buyerName?: unknown;
  qualifiedInvoiceFlag?: unknown;
  taxRateSummary?: unknown;
  attachmentId?: unknown;
}

interface OrderRow {
  id: number;
  order_no: string;
  customer_id: number | null;
  ordered_at: string;
  channel: string;
  subtotal_tax_included: number;
  tax_amount: number | null;
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

interface IdParams {
  id: string;
}

interface SummaryQuery {
  month?: string;
}

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
];

export async function salesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/sales', async () => listOrders(app.db));

  app.get<{ Querystring: SummaryQuery }>('/api/sales/summary', async (req) => monthlySummary(app.db, req.query.month));

  app.get('/api/sales/export', async (_req, reply) => {
    reply.header('content-type', 'text/csv; charset=utf-8');
    return exportOrdersCsv(app.db);
  });

  app.post<{ Body: { csv?: unknown } }>('/api/sales/import', async (req, reply) => {
    if (typeof req.body?.csv !== 'string') {
      reply.code(400);
      return { error: 'csv_required' };
    }
    try {
      return importOrdersCsv(app.db, req.body.csv);
    } catch (error) {
      reply.code(400);
      return { error: 'invalid_csv', message: error instanceof Error ? error.message : 'invalid csv' };
    }
  });

  app.get<{ Params: IdParams }>('/api/sales/:id', async (req, reply) => {
    const id = parseId(req.params.id);
    if (id == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    const order = getOrder(app.db, id);
    if (!order) {
      reply.code(404);
      return { error: 'not_found' };
    }
    return order;
  });

  app.post<{ Body: OrderPayload }>('/api/sales', async (req, reply) => {
    try {
      const created = createOrder(app.db, req.body ?? {});
      reply.code(201);
      return created;
    } catch (error) {
      reply.code(400);
      return { error: 'invalid_payload', message: error instanceof Error ? error.message : 'invalid payload' };
    }
  });

  app.put<{ Body: OrderPayload; Params: IdParams }>('/api/sales/:id', async (req, reply) => {
    const id = parseId(req.params.id);
    if (id == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    if (!getOrder(app.db, id)) {
      reply.code(404);
      return { error: 'not_found' };
    }
    try {
      return updateOrder(app.db, id, req.body ?? {});
    } catch (error) {
      reply.code(400);
      return { error: 'invalid_payload', message: error instanceof Error ? error.message : 'invalid payload' };
    }
  });

  app.patch<{ Body: { status?: unknown }; Params: IdParams }>('/api/sales/:id/payment', async (req, reply) => {
    return updateStatus(app, req.params.id, req.body?.status, 'paymentStatus', reply);
  });

  app.patch<{ Body: { status?: unknown }; Params: IdParams }>('/api/sales/:id/refund', async (req, reply) => {
    return updateStatus(app, req.params.id, req.body?.status, 'refundStatus', reply);
  });

  app.patch<{ Body: { status?: unknown }; Params: IdParams }>('/api/sales/:id/delivery', async (req, reply) => {
    return updateStatus(app, req.params.id, req.body?.status, 'deliveryStatus', reply);
  });

  app.delete<{ Params: IdParams }>('/api/sales/:id', async (req, reply) => {
    const id = parseId(req.params.id);
    if (id == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    const before = getOrder(app.db, id);
    if (!before) {
      reply.code(404);
      return { error: 'not_found' };
    }
    app.db.transaction(() => {
      writeAudit(app.db, { action: 'delete', entityType: 'order', entityId: id, before });
      app.db.prepare('DELETE FROM invoices WHERE order_id = ?').run(id);
      app.db.prepare('DELETE FROM orders WHERE id = ?').run(id);
    })();
    reply.code(204);
    return undefined;
  });
}

function createOrder(db: DB, body: OrderPayload): Order {
  const payload = normalizeCreate(body);
  return db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO orders
          (order_no, customer_id, ordered_at, channel, subtotal_tax_included, tax_amount,
           payment_status, delivery_status, refund_status)
         VALUES
          (@orderNo, @customerId, @orderedAt, @channel, @subtotalTaxIncluded, @taxAmount,
           @paymentStatus, @deliveryStatus, @refundStatus)`,
      )
      .run(payload);
    const orderId = Number(result.lastInsertRowid);
    replaceItems(db, orderId, payload.items);
    replaceInvoice(db, orderId, payload.invoice);
    const created = getOrderOrThrow(db, orderId);
    writeAudit(db, { action: 'create', entityType: 'order', entityId: orderId, after: created });
    return created;
  })();
}

function updateOrder(db: DB, id: number, body: OrderPayload): Order {
  const before = getOrderOrThrow(db, id);
  const payload = normalizePatch(body);
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
           payment_status = CASE WHEN @hasPaymentStatus = 1 THEN @paymentStatus ELSE payment_status END,
           delivery_status = CASE WHEN @hasDeliveryStatus = 1 THEN @deliveryStatus ELSE delivery_status END,
           refund_status = CASE WHEN @hasRefundStatus = 1 THEN @refundStatus ELSE refund_status END
       WHERE id = @id`,
    ).run({ id, ...payload.order });
    if (payload.hasItems) replaceItems(db, id, payload.items);
    if (payload.hasInvoice) replaceInvoice(db, id, payload.invoice);
    const after = getOrderOrThrow(db, id);
    writeAudit(db, { action: 'update', entityType: 'order', entityId: id, before, after });
    return after;
  })();
}

function updateStatus(
  app: FastifyInstance,
  idText: string,
  statusValue: unknown,
  field: 'paymentStatus' | 'refundStatus' | 'deliveryStatus',
  reply: { code: (statusCode: number) => unknown },
): Order | { error: string; message?: string } {
  const id = parseId(idText);
  if (id == null) {
    reply.code(400);
    return { error: 'invalid_id' };
  }
  if (!getOrder(app.db, id)) {
    reply.code(404);
    return { error: 'not_found' };
  }
  try {
    return updateOrder(app.db, id, { [field]: parseRequiredString(statusValue, 'status') });
  } catch (error) {
    reply.code(400);
    return { error: 'invalid_payload', message: error instanceof Error ? error.message : 'invalid payload' };
  }
}

function listOrders(db: DB): Order[] {
  const rows = db.prepare('SELECT * FROM orders ORDER BY ordered_at ASC, id ASC').all() as OrderRow[];
  return rows.map((row) => mapOrder(db, row));
}

function getOrder(db: DB, id: number): Order | null {
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as OrderRow | undefined;
  return row ? mapOrder(db, row) : null;
}

function getOrderOrThrow(db: DB, id: number): Order {
  const order = getOrder(db, id);
  if (!order) throw new Error(`order not found: ${id}`);
  return order;
}

function getOrderByNo(db: DB, orderNo: string): Order | null {
  const row = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(orderNo) as OrderRow | undefined;
  return row ? mapOrder(db, row) : null;
}

function normalizeCreate(body: OrderPayload): {
  orderNo: string;
  customerId: number | null;
  orderedAt: string;
  channel: string;
  subtotalTaxIncluded: number;
  taxAmount: number | null;
  paymentStatus: string;
  deliveryStatus: string;
  refundStatus: string;
  items: OrderItemPayload[];
  invoice: InvoicePayload | null;
} {
  return {
    orderNo: parseRequiredString(body.orderNo, 'orderNo'),
    customerId: parseNullableInteger(body.customerId, 'customerId'),
    orderedAt: parseRequiredString(body.orderedAt, 'orderedAt'),
    channel: parseRequiredString(body.channel, 'channel'),
    subtotalTaxIncluded: parseRequiredInteger(body.subtotalTaxIncluded, 'subtotalTaxIncluded'),
    taxAmount: parseNullableInteger(body.taxAmount, 'taxAmount'),
    paymentStatus: parseOptionalString(body.paymentStatus, 'paymentStatus') ?? 'pending',
    deliveryStatus: parseOptionalString(body.deliveryStatus, 'deliveryStatus') ?? 'not_delivered',
    refundStatus: parseOptionalString(body.refundStatus, 'refundStatus') ?? 'none',
    items: parseItems(body.items),
    invoice: parseInvoice(body.invoice),
  };
}

function normalizePatch(body: OrderPayload): {
  order: Record<string, string | number | null>;
  hasItems: boolean;
  items: OrderItemPayload[];
  hasInvoice: boolean;
  invoice: InvoicePayload | null;
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
    hasPaymentStatus: 0,
    paymentStatus: null,
    hasDeliveryStatus: 0,
    deliveryStatus: null,
    hasRefundStatus: 0,
    refundStatus: null,
  };
  if (body.orderNo !== undefined) setPatch(order, 'OrderNo', 'orderNo', parseRequiredString(body.orderNo, 'orderNo'));
  if (body.customerId !== undefined) {
    setPatch(order, 'CustomerId', 'customerId', parseNullableInteger(body.customerId, 'customerId'));
  }
  if (body.orderedAt !== undefined) {
    setPatch(order, 'OrderedAt', 'orderedAt', parseRequiredString(body.orderedAt, 'orderedAt'));
  }
  if (body.channel !== undefined) setPatch(order, 'Channel', 'channel', parseRequiredString(body.channel, 'channel'));
  if (body.subtotalTaxIncluded !== undefined) {
    setPatch(
      order,
      'SubtotalTaxIncluded',
      'subtotalTaxIncluded',
      parseRequiredInteger(body.subtotalTaxIncluded, 'subtotalTaxIncluded'),
    );
  }
  if (body.taxAmount !== undefined) setPatch(order, 'TaxAmount', 'taxAmount', parseNullableInteger(body.taxAmount, 'taxAmount'));
  if (body.paymentStatus !== undefined) {
    setPatch(order, 'PaymentStatus', 'paymentStatus', parseRequiredString(body.paymentStatus, 'paymentStatus'));
  }
  if (body.deliveryStatus !== undefined) {
    setPatch(order, 'DeliveryStatus', 'deliveryStatus', parseRequiredString(body.deliveryStatus, 'deliveryStatus'));
  }
  if (body.refundStatus !== undefined) {
    setPatch(order, 'RefundStatus', 'refundStatus', parseRequiredString(body.refundStatus, 'refundStatus'));
  }
  return {
    order,
    hasItems: body.items !== undefined,
    items: body.items === undefined ? [] : parseItems(body.items),
    hasInvoice: body.invoice !== undefined,
    invoice: body.invoice === undefined ? null : parseInvoice(body.invoice),
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

function replaceItems(db: DB, orderId: number, items: OrderItemPayload[]): void {
  db.prepare('DELETE FROM order_items WHERE order_id = ?').run(orderId);
  const insert = db.prepare(
    `INSERT INTO order_items (order_id, product_id, quantity, unit_price_tax_included)
     VALUES (@orderId, @productId, @quantity, @unitPriceTaxIncluded)`,
  );
  for (const item of items) {
    insert.run({
      orderId,
      productId: parseRequiredInteger(item.productId, 'productId'),
      quantity: parseRequiredInteger(item.quantity ?? 1, 'quantity'),
      unitPriceTaxIncluded: parseRequiredInteger(item.unitPriceTaxIncluded, 'unitPriceTaxIncluded'),
    });
  }
}

function replaceInvoice(db: DB, orderId: number, invoice: InvoicePayload | null): void {
  db.prepare('DELETE FROM invoices WHERE order_id = ?').run(orderId);
  if (!invoice) return;
  db.prepare(
    `INSERT INTO invoices
      (invoice_no, order_id, issued_at, buyer_name, qualified_invoice_flag, tax_rate_summary, attachment_id)
     VALUES
      (@invoiceNo, @orderId, @issuedAt, @buyerName, @qualifiedInvoiceFlag, @taxRateSummary, @attachmentId)`,
  ).run({
    orderId,
    invoiceNo: parseRequiredString(invoice.invoiceNo, 'invoiceNo'),
    issuedAt: parseRequiredString(invoice.issuedAt, 'issuedAt'),
    buyerName: parseOptionalString(invoice.buyerName, 'buyerName'),
    qualifiedInvoiceFlag: parseOptionalBoolean(invoice.qualifiedInvoiceFlag),
    taxRateSummary: parseOptionalString(invoice.taxRateSummary, 'taxRateSummary'),
    attachmentId: parseNullableInteger(invoice.attachmentId, 'attachmentId'),
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
    paymentStatus: row.payment_status,
    deliveryStatus: row.delivery_status,
    refundStatus: row.refund_status,
    items: listOrderItems(db, row.id),
    invoice: getInvoice(db, row.id),
  };
}

function listOrderItems(db: DB, orderId: number): OrderItem[] {
  const rows = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC').all(orderId) as OrderItemRow[];
  return rows.map((row) => ({
    id: row.id,
    orderId: row.order_id,
    productId: row.product_id,
    quantity: row.quantity,
    unitPriceTaxIncluded: row.unit_price_tax_included,
  }));
}

function getInvoice(db: DB, orderId: number): Invoice | null {
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

function exportOrdersCsv(db: DB): string {
  const rows: CsvRow[] = listOrders(db).map((order) => ({
    orderNo: order.orderNo,
    customerId: numberCell(order.customerId),
    orderedAt: order.orderedAt,
    channel: order.channel,
    subtotalTaxIncluded: String(order.subtotalTaxIncluded),
    taxAmount: numberCell(order.taxAmount),
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
    attachmentId: numberCell(order.invoice?.attachmentId ?? null),
  }));
  return serializeCsv(rows, { columns: CSV_COLUMNS, bom: false });
}

function importOrdersCsv(db: DB, csv: string): { imported: number; created: number; updated: number } {
  const result = { imported: 0, created: 0, updated: 0 };
  db.transaction(() => {
    for (const row of parseCsv(csv)) {
      const payload = payloadFromCsv(row);
      const existing = getOrderByNo(db, parseRequiredString(payload.orderNo, 'orderNo'));
      if (existing) {
        updateOrder(db, existing.id, payload);
        result.updated++;
      } else {
        createOrder(db, payload);
        result.created++;
      }
      result.imported++;
    }
  })();
  return result;
}

function payloadFromCsv(row: CsvRow): OrderPayload {
  return {
    orderNo: row.orderNo,
    customerId: row.customerId,
    orderedAt: row.orderedAt,
    channel: row.channel,
    subtotalTaxIncluded: row.subtotalTaxIncluded,
    taxAmount: row.taxAmount,
    paymentStatus: row.paymentStatus,
    deliveryStatus: row.deliveryStatus,
    refundStatus: row.refundStatus,
    items: parseItemsJson(row.itemsJson),
    invoice: row.invoiceNo
      ? {
          invoiceNo: row.invoiceNo,
          issuedAt: row.invoiceIssuedAt,
          buyerName: row.buyerName,
          qualifiedInvoiceFlag: row.qualifiedInvoiceFlag,
          taxRateSummary: row.taxRateSummary,
          attachmentId: row.attachmentId,
        }
      : null,
  };
}

function monthlySummary(
  db: DB,
  month?: string,
): Array<{ month: string; salesTaxIncluded: number; taxAmount: number; uncollectedAmount: number; refundAmount: number; orderCount: number }> {
  const summaries = new Map<
    string,
    { month: string; salesTaxIncluded: number; taxAmount: number; uncollectedAmount: number; refundAmount: number; orderCount: number }
  >();
  for (const order of listOrders(db)) {
    const key = yearMonth(order.orderedAt);
    if (month && key !== month) continue;
    const current =
      summaries.get(key) ??
      ({ month: key, salesTaxIncluded: 0, taxAmount: 0, uncollectedAmount: 0, refundAmount: 0, orderCount: 0 });
    current.salesTaxIncluded += order.subtotalTaxIncluded;
    current.taxAmount += order.taxAmount ?? 0;
    if (order.paymentStatus !== 'paid') current.uncollectedAmount += order.subtotalTaxIncluded;
    if (order.refundStatus !== 'none') current.refundAmount += order.subtotalTaxIncluded;
    current.orderCount++;
    summaries.set(key, current);
  }
  return [...summaries.values()].sort((a, b) => a.month.localeCompare(b.month));
}

function parseItems(value: unknown): OrderItemPayload[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error('items must be an array');
  return value.map((item) => item as OrderItemPayload);
}

function parseItemsJson(value: string | undefined): OrderItemPayload[] {
  if (!value?.trim()) return [];
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new Error('itemsJson must be an array');
  return parsed.map((item) => item as OrderItemPayload);
}

function parseInvoice(value: unknown): InvoicePayload | null {
  if (value == null) return null;
  return value as InvoicePayload;
}

function parseId(id: string): number | null {
  if (!/^\d+$/.test(id)) return null;
  const parsed = Number(id);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  const text = value.trim();
  if (text.length === 0) throw new Error(`${field} is required`);
  return text;
}

function parseOptionalString(value: unknown, field: string): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  const text = value.trim();
  return text.length > 0 ? text : null;
}

function parseRequiredInteger(value: unknown, field: string): number {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (!Number.isInteger(parsed)) throw new Error(`${field} must be an integer`);
  return parsed as number;
}

function parseNullableInteger(value: unknown, field: string): number | null {
  if (value == null || value === '') return null;
  return parseRequiredInteger(value, field);
}

function parseOptionalBoolean(value: unknown): number {
  if (value == null || value === '') return 0;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value === 1 || value === '1' || value === 'true') return 1;
  if (value === 0 || value === '0' || value === 'false') return 0;
  throw new Error('qualifiedInvoiceFlag must be a boolean');
}

function numberCell(value: number | null): string {
  return value == null ? '' : String(value);
}
