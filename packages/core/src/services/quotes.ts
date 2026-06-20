import { writeAudit } from '../audit.js';
import type { DB } from '../db/connection.js';
import { nullableText, requireNonNegativeInteger, requirePositiveInteger, requireText } from '../util/validate.js';
import { createOrder } from './sales.js';

export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'expired' | 'converted';

const ALLOWED_STATUSES: readonly string[] = ['draft', 'sent', 'accepted', 'declined', 'expired', 'converted'];

export interface QuoteItem {
  id: number;
  quoteId: number;
  productId: number | null;
  description: string | null;
  quantity: number;
  unitPriceTaxIncluded: number;
  subtotalTaxIncluded: number;
}

export interface Quote {
  id: number;
  quoteNo: string;
  customerId: number | null;
  issuedAt: string;
  validUntil: string | null;
  status: QuoteStatus;
  subtotalTaxIncluded: number;
  taxAmount: number | null;
  note: string | null;
  convertedOrderId: number | null;
  createdAt: string;
  items: QuoteItem[];
}

export interface QuoteItemInput {
  productId?: number | null;
  description?: string | null;
  quantity?: number;
  unitPriceTaxIncluded: number;
}

export interface CreateQuoteInput {
  quoteNo: string;
  customerId?: number | null;
  issuedAt: string;
  validUntil?: string | null;
  status?: QuoteStatus;
  taxAmount?: number | null;
  note?: string | null;
  items?: QuoteItemInput[];
}

export type UpdateQuoteInput = Partial<CreateQuoteInput>;

interface QuoteRow {
  id: number;
  quote_no: string;
  customer_id: number | null;
  issued_at: string;
  valid_until: string | null;
  status: string;
  subtotal_tax_included: number;
  tax_amount: number | null;
  note: string | null;
  converted_order_id: number | null;
  created_at: string;
}

interface QuoteItemRow {
  id: number;
  quote_id: number;
  product_id: number | null;
  description: string | null;
  quantity: number;
  unit_price_tax_included: number;
}

const ENTITY_TYPE = 'quote';

function nullableInteger(value: number | null | undefined, field: string): number | null {
  if (value == null) return null;
  if (!Number.isInteger(value)) throw new Error(`${field} must be an integer`);
  return value;
}

function computeSubtotal(items: QuoteItemInput[]): number {
  return items.reduce((sum, item) => {
    const qty = requirePositiveInteger(item.quantity ?? 1, 'quantity');
    const price = requireNonNegativeInteger(item.unitPriceTaxIncluded, 'unitPriceTaxIncluded');
    return sum + qty * price;
  }, 0);
}

function normalizeItems(items: QuoteItemInput[]): Array<Required<QuoteItemInput> & { quantity: number }> {
  return items.map((item) => ({
    productId: item.productId != null ? nullableInteger(item.productId, 'productId') : null,
    description: nullableText(item.description),
    quantity: requirePositiveInteger(item.quantity ?? 1, 'quantity'),
    unitPriceTaxIncluded: requireNonNegativeInteger(item.unitPriceTaxIncluded, 'unitPriceTaxIncluded'),
  }));
}

function insertItems(db: DB, quoteId: number, items: QuoteItemInput[]): void {
  const normalized = normalizeItems(items);
  const insert = db.prepare(
    `INSERT INTO quote_items (quote_id, product_id, description, quantity, unit_price_tax_included)
     VALUES (@quoteId, @productId, @description, @quantity, @unitPriceTaxIncluded)`,
  );
  for (const item of normalized) {
    insert.run({
      quoteId,
      productId: item.productId,
      description: item.description,
      quantity: item.quantity,
      unitPriceTaxIncluded: item.unitPriceTaxIncluded,
    });
  }
}

function replaceItems(db: DB, quoteId: number, items: QuoteItemInput[]): void {
  db.prepare('DELETE FROM quote_items WHERE quote_id = ?').run(quoteId);
  insertItems(db, quoteId, items);
}

function listQuoteItems(db: DB, quoteId: number): QuoteItem[] {
  const rows = db
    .prepare('SELECT * FROM quote_items WHERE quote_id = ? ORDER BY id ASC')
    .all(quoteId) as QuoteItemRow[];
  return rows.map((row) => ({
    id: row.id,
    quoteId: row.quote_id,
    productId: row.product_id,
    description: row.description,
    quantity: row.quantity,
    unitPriceTaxIncluded: row.unit_price_tax_included,
    subtotalTaxIncluded: row.quantity * row.unit_price_tax_included,
  }));
}

function mapRow(db: DB, row: QuoteRow): Quote {
  return {
    id: row.id,
    quoteNo: row.quote_no,
    customerId: row.customer_id,
    issuedAt: row.issued_at,
    validUntil: row.valid_until,
    status: row.status as QuoteStatus,
    subtotalTaxIncluded: row.subtotal_tax_included,
    taxAmount: row.tax_amount,
    note: row.note,
    convertedOrderId: row.converted_order_id,
    createdAt: row.created_at,
    items: listQuoteItems(db, row.id),
  };
}

function getQuoteRow(db: DB, id: number): QuoteRow | null {
  return (db.prepare('SELECT * FROM quotes WHERE id = ?').get(id) as QuoteRow | undefined) ?? null;
}

function getQuoteOrThrow(db: DB, id: number): Quote {
  const row = getQuoteRow(db, id);
  if (!row) throw new Error(`quote not found: ${id}`);
  return mapRow(db, row);
}

export function getQuote(db: DB, id: number): Quote | null {
  const row = getQuoteRow(db, id);
  return row ? mapRow(db, row) : null;
}

export function listQuotes(db: DB): Quote[] {
  const rows = db
    .prepare('SELECT * FROM quotes ORDER BY issued_at DESC, id DESC')
    .all() as QuoteRow[];
  return rows.map((row) => mapRow(db, row));
}

export function createQuote(db: DB, input: CreateQuoteInput, actor = 'local_user'): Quote {
  const quoteNo = requireText(input.quoteNo, 'quoteNo');
  const issuedAt = requireText(input.issuedAt, 'issuedAt');
  const status = (nullableText(input.status) ?? 'draft') as QuoteStatus;
  const customerId = nullableInteger(input.customerId, 'customerId');
  const validUntil = nullableText(input.validUntil);
  const taxAmount = input.taxAmount == null ? null : requireNonNegativeInteger(input.taxAmount, 'taxAmount');
  const note = nullableText(input.note);
  const items = input.items ?? [];
  const subtotalTaxIncluded = computeSubtotal(items);

  return db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO quotes
          (quote_no, customer_id, issued_at, valid_until, status, subtotal_tax_included, tax_amount, note)
         VALUES
          (@quoteNo, @customerId, @issuedAt, @validUntil, @status, @subtotalTaxIncluded, @taxAmount, @note)`,
      )
      .run({ quoteNo, customerId, issuedAt, validUntil, status, subtotalTaxIncluded, taxAmount, note });
    const quoteId = Number(result.lastInsertRowid);
    insertItems(db, quoteId, items);
    const created = getQuoteOrThrow(db, quoteId);
    writeAudit(db, { actor, action: 'create', entityType: ENTITY_TYPE, entityId: quoteId, after: created });
    return created;
  })();
}

export function updateQuote(db: DB, id: number, input: UpdateQuoteInput, actor = 'local_user'): Quote {
  const before = getQuoteOrThrow(db, id);
  const items = input.items;
  const subtotalTaxIncluded = items !== undefined ? computeSubtotal(items) : before.subtotalTaxIncluded;

  return db.transaction(() => {
    db.prepare(
      `UPDATE quotes SET
         quote_no = CASE WHEN @hasQuoteNo = 1 THEN @quoteNo ELSE quote_no END,
         customer_id = CASE WHEN @hasCustomerId = 1 THEN @customerId ELSE customer_id END,
         issued_at = CASE WHEN @hasIssuedAt = 1 THEN @issuedAt ELSE issued_at END,
         valid_until = CASE WHEN @hasValidUntil = 1 THEN @validUntil ELSE valid_until END,
         status = CASE WHEN @hasStatus = 1 THEN @status ELSE status END,
         subtotal_tax_included = CASE WHEN @hasItems = 1 THEN @subtotalTaxIncluded ELSE subtotal_tax_included END,
         tax_amount = CASE WHEN @hasTaxAmount = 1 THEN @taxAmount ELSE tax_amount END,
         note = CASE WHEN @hasNote = 1 THEN @note ELSE note END
       WHERE id = @id`,
    ).run({
      id,
      hasQuoteNo: input.quoteNo !== undefined ? 1 : 0,
      quoteNo: input.quoteNo !== undefined ? requireText(input.quoteNo, 'quoteNo') : null,
      hasCustomerId: input.customerId !== undefined ? 1 : 0,
      customerId: input.customerId !== undefined ? nullableInteger(input.customerId, 'customerId') : null,
      hasIssuedAt: input.issuedAt !== undefined ? 1 : 0,
      issuedAt: input.issuedAt !== undefined ? requireText(input.issuedAt, 'issuedAt') : null,
      hasValidUntil: input.validUntil !== undefined ? 1 : 0,
      validUntil: input.validUntil !== undefined ? nullableText(input.validUntil) : null,
      hasStatus: input.status !== undefined ? 1 : 0,
      status: input.status !== undefined ? requireText(input.status, 'status') : null,
      hasItems: items !== undefined ? 1 : 0,
      subtotalTaxIncluded,
      hasTaxAmount: input.taxAmount !== undefined ? 1 : 0,
      taxAmount:
        input.taxAmount !== undefined
          ? input.taxAmount == null
            ? null
            : requireNonNegativeInteger(input.taxAmount, 'taxAmount')
          : null,
      hasNote: input.note !== undefined ? 1 : 0,
      note: input.note !== undefined ? nullableText(input.note) : null,
    });
    if (items !== undefined) replaceItems(db, id, items);
    const after = getQuoteOrThrow(db, id);
    writeAudit(db, { actor, action: 'update', entityType: ENTITY_TYPE, entityId: id, before, after });
    return after;
  })();
}

export function updateQuoteStatus(db: DB, id: number, status: string, actor = 'local_user'): Quote {
  const trimmed = status.trim();
  if (!ALLOWED_STATUSES.includes(trimmed)) {
    throw new Error(`invalid status: ${trimmed}. Must be one of: ${ALLOWED_STATUSES.join(', ')}`);
  }
  return updateQuote(db, id, { status: trimmed as QuoteStatus }, actor);
}

export function deleteQuote(db: DB, id: number, actor = 'local_user'): void {
  const before = getQuoteOrThrow(db, id);
  db.transaction(() => {
    writeAudit(db, { actor, action: 'delete', entityType: ENTITY_TYPE, entityId: id, before });
    db.prepare('DELETE FROM quotes WHERE id = ?').run(id);
  })();
}

export function convertQuoteToOrder(
  db: DB,
  quoteId: number,
  actor = 'local_user',
): { quote: Quote; order: ReturnType<typeof createOrder> } {
  return db.transaction(() => {
    const quote = getQuote(db, quoteId);
    if (!quote) throw new Error(`quote not found: ${quoteId}`);
    if (quote.status === 'converted') throw new Error('already converted');

    // All items must have productId (free-text lines without product cannot be converted to order_items)
    const freeTextItems = quote.items.filter((item) => item.productId == null);
    if (freeTextItems.length > 0) {
      throw new Error(
        `cannot convert: ${freeTextItems.length} item(s) have no product_id. All items must reference a product to create an order.`,
      );
    }

    // createOrder handles its own 'create' audit for entity 'order'
    const order = createOrder(
      db,
      {
        orderNo: quote.quoteNo,
        customerId: quote.customerId,
        orderedAt: quote.issuedAt,
        channel: 'quote',
        subtotalTaxIncluded: quote.subtotalTaxIncluded,
        taxAmount: quote.taxAmount,
        items: quote.items.map((item) => ({
          productId: item.productId!,
          quantity: item.quantity,
          unitPriceTaxIncluded: item.unitPriceTaxIncluded,
        })),
      },
      actor,
    );

    // Update quote status to converted
    db.prepare(
      'UPDATE quotes SET status = @status, converted_order_id = @orderId WHERE id = @id',
    ).run({ status: 'converted', orderId: order.id, id: quoteId });

    const updatedQuote = getQuoteOrThrow(db, quoteId);

    // Audit the conversion on the quote entity (separate from order 'create' audit)
    writeAudit(db, {
      actor,
      action: 'convert',
      entityType: ENTITY_TYPE,
      entityId: quoteId,
      after: { order_id: order.id },
    });

    return { quote: updatedQuote, order };
  })();
}
