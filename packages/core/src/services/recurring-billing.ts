import { writeAudit } from '../audit.js';
import type { DB } from '../db/connection.js';
import { addMonths, parseIsoDate } from '../util/dates.js';
import { nullableText, requireNonNegativeInteger, requirePositiveInteger, requireText } from '../util/validate.js';
import { createOrder, type Order } from './sales.js';

export type RecurringBillingPeriod = 'monthly' | 'yearly';
export type RecurringBillingStatus = 'active' | 'paused' | 'ended';

const ALLOWED_STATUSES: readonly string[] = ['active', 'paused', 'ended'];
const ALLOWED_PERIODS: readonly string[] = ['monthly', 'yearly'];

/** 1 回の generateDueBillings 実行で 1 billing が catch-up できる安全上限。無限ループ防止。 */
const MAX_CATCHUP_PER_BILLING = 36;

const ENTITY_TYPE = 'recurring_billing';

export interface RecurringBilling {
  id: number;
  customerId: number | null;
  productId: number;
  planName: string;
  amountTaxIncluded: number;
  taxAmount: number | null;
  billingPeriod: RecurringBillingPeriod;
  startDate: string;
  nextBillingDate: string;
  status: RecurringBillingStatus;
  lastGeneratedOrderId: number | null;
  note: string | null;
  createdAt: string;
}

export interface CreateRecurringBillingInput {
  customerId?: number | null;
  productId: number;
  planName: string;
  amountTaxIncluded: number;
  taxAmount?: number | null;
  billingPeriod: RecurringBillingPeriod;
  startDate: string;
  nextBillingDate?: string;
  status?: RecurringBillingStatus;
  note?: string | null;
}

export type UpdateRecurringBillingInput = Partial<CreateRecurringBillingInput>;

export interface GenerateDueBillingsResult {
  asOf: string;
  generated: Array<{ billingId: number; order: Order }>;
  /** 1 billing の処理が失敗してもバッチ全体を止めず、失敗内容をここに記録する。 */
  errors: Array<{ billingId: number; message: string }>;
}

interface RecurringBillingRow {
  id: number;
  customer_id: number | null;
  product_id: number;
  plan_name: string;
  amount_tax_included: number;
  tax_amount: number | null;
  billing_period: string;
  start_date: string;
  next_billing_date: string;
  status: string;
  last_generated_order_id: number | null;
  note: string | null;
  created_at: string;
}

function nullableInteger(value: number | null | undefined, field: string): number | null {
  if (value == null) return null;
  if (!Number.isInteger(value)) throw new Error(`${field} must be an integer`);
  return value;
}

/** 必須の ISO 日付('YYYY-MM-DD')。空・形式不正・意味的に無効な日付を弾く。 */
function requireIsoDate(value: string | null | undefined, field: string): string {
  const text = requireText(value, field);
  parseIsoDate(text); // 形式/妥当性を検証(不正なら throw)
  return text;
}

function requirePeriod(value: string | null | undefined, field: string): RecurringBillingPeriod {
  const text = requireText(value, field);
  if (!ALLOWED_PERIODS.includes(text)) {
    throw new Error(`invalid ${field}: ${text}. Must be one of: ${ALLOWED_PERIODS.join(', ')}`);
  }
  return text as RecurringBillingPeriod;
}

function mapRow(row: RecurringBillingRow): RecurringBilling {
  return {
    id: row.id,
    customerId: row.customer_id,
    productId: row.product_id,
    planName: row.plan_name,
    amountTaxIncluded: row.amount_tax_included,
    taxAmount: row.tax_amount,
    billingPeriod: row.billing_period as RecurringBillingPeriod,
    startDate: row.start_date,
    nextBillingDate: row.next_billing_date,
    status: row.status as RecurringBillingStatus,
    lastGeneratedOrderId: row.last_generated_order_id,
    note: row.note,
    createdAt: row.created_at,
  };
}

function getRow(db: DB, id: number): RecurringBillingRow | null {
  return (
    (db.prepare('SELECT * FROM recurring_billings WHERE id = ?').get(id) as RecurringBillingRow | undefined) ?? null
  );
}

function getRecurringBillingOrThrow(db: DB, id: number): RecurringBilling {
  const row = getRow(db, id);
  if (!row) throw new Error(`recurring billing not found: ${id}`);
  return mapRow(row);
}

export function getRecurringBilling(db: DB, id: number): RecurringBilling | null {
  const row = getRow(db, id);
  return row ? mapRow(row) : null;
}

export function listRecurringBillings(db: DB): RecurringBilling[] {
  const rows = db
    .prepare('SELECT * FROM recurring_billings ORDER BY next_billing_date ASC, id ASC')
    .all() as RecurringBillingRow[];
  return rows.map(mapRow);
}

export function createRecurringBilling(
  db: DB,
  input: CreateRecurringBillingInput,
  actor = 'local_user',
): RecurringBilling {
  const productId = requirePositiveInteger(input.productId, 'productId');
  const planName = requireText(input.planName, 'planName');
  const amountTaxIncluded = requireNonNegativeInteger(input.amountTaxIncluded, 'amountTaxIncluded');
  const billingPeriod = requirePeriod(input.billingPeriod, 'billingPeriod');
  const startDate = requireIsoDate(input.startDate, 'startDate');
  const nextBillingDateRaw = nullableText(input.nextBillingDate);
  const nextBillingDate = nextBillingDateRaw == null ? startDate : requireIsoDate(nextBillingDateRaw, 'nextBillingDate');
  const customerId = nullableInteger(input.customerId, 'customerId');
  const taxAmount = input.taxAmount == null ? null : requireNonNegativeInteger(input.taxAmount, 'taxAmount');
  const status = (nullableText(input.status) ?? 'active') as RecurringBillingStatus;
  if (!ALLOWED_STATUSES.includes(status)) {
    throw new Error(`invalid status: ${status}. Must be one of: ${ALLOWED_STATUSES.join(', ')}`);
  }
  const note = nullableText(input.note);

  return db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO recurring_billings
          (customer_id, product_id, plan_name, amount_tax_included, tax_amount, billing_period,
           start_date, next_billing_date, status, note)
         VALUES
          (@customerId, @productId, @planName, @amountTaxIncluded, @taxAmount, @billingPeriod,
           @startDate, @nextBillingDate, @status, @note)`,
      )
      .run({
        customerId,
        productId,
        planName,
        amountTaxIncluded,
        taxAmount,
        billingPeriod,
        startDate,
        nextBillingDate,
        status,
        note,
      });
    const id = Number(result.lastInsertRowid);
    const created = getRecurringBillingOrThrow(db, id);
    writeAudit(db, { actor, action: 'create', entityType: ENTITY_TYPE, entityId: id, after: created });
    return created;
  })();
}

export function updateRecurringBilling(
  db: DB,
  id: number,
  input: UpdateRecurringBillingInput,
  actor = 'local_user',
): RecurringBilling {
  const before = getRecurringBillingOrThrow(db, id);

  return db.transaction(() => {
    db.prepare(
      `UPDATE recurring_billings SET
         customer_id = CASE WHEN @hasCustomerId = 1 THEN @customerId ELSE customer_id END,
         product_id = CASE WHEN @hasProductId = 1 THEN @productId ELSE product_id END,
         plan_name = CASE WHEN @hasPlanName = 1 THEN @planName ELSE plan_name END,
         amount_tax_included = CASE WHEN @hasAmount = 1 THEN @amountTaxIncluded ELSE amount_tax_included END,
         tax_amount = CASE WHEN @hasTaxAmount = 1 THEN @taxAmount ELSE tax_amount END,
         billing_period = CASE WHEN @hasBillingPeriod = 1 THEN @billingPeriod ELSE billing_period END,
         start_date = CASE WHEN @hasStartDate = 1 THEN @startDate ELSE start_date END,
         next_billing_date = CASE WHEN @hasNextBillingDate = 1 THEN @nextBillingDate ELSE next_billing_date END,
         status = CASE WHEN @hasStatus = 1 THEN @status ELSE status END,
         note = CASE WHEN @hasNote = 1 THEN @note ELSE note END
       WHERE id = @id`,
    ).run({
      id,
      hasCustomerId: input.customerId !== undefined ? 1 : 0,
      customerId: input.customerId !== undefined ? nullableInteger(input.customerId, 'customerId') : null,
      hasProductId: input.productId !== undefined ? 1 : 0,
      productId: input.productId !== undefined ? requirePositiveInteger(input.productId, 'productId') : null,
      hasPlanName: input.planName !== undefined ? 1 : 0,
      planName: input.planName !== undefined ? requireText(input.planName, 'planName') : null,
      hasAmount: input.amountTaxIncluded !== undefined ? 1 : 0,
      amountTaxIncluded:
        input.amountTaxIncluded !== undefined
          ? requireNonNegativeInteger(input.amountTaxIncluded, 'amountTaxIncluded')
          : null,
      hasTaxAmount: input.taxAmount !== undefined ? 1 : 0,
      taxAmount:
        input.taxAmount !== undefined
          ? input.taxAmount == null
            ? null
            : requireNonNegativeInteger(input.taxAmount, 'taxAmount')
          : null,
      hasBillingPeriod: input.billingPeriod !== undefined ? 1 : 0,
      billingPeriod: input.billingPeriod !== undefined ? requirePeriod(input.billingPeriod, 'billingPeriod') : null,
      hasStartDate: input.startDate !== undefined ? 1 : 0,
      startDate: input.startDate !== undefined ? requireIsoDate(input.startDate, 'startDate') : null,
      hasNextBillingDate: input.nextBillingDate !== undefined ? 1 : 0,
      nextBillingDate:
        input.nextBillingDate !== undefined ? requireIsoDate(input.nextBillingDate, 'nextBillingDate') : null,
      hasStatus: input.status !== undefined ? 1 : 0,
      status: input.status !== undefined ? requireStatus(input.status) : null,
      hasNote: input.note !== undefined ? 1 : 0,
      note: input.note !== undefined ? nullableText(input.note) : null,
    });
    const after = getRecurringBillingOrThrow(db, id);
    writeAudit(db, { actor, action: 'update', entityType: ENTITY_TYPE, entityId: id, before, after });
    return after;
  })();
}

function requireStatus(status: string): RecurringBillingStatus {
  const trimmed = status.trim();
  if (!ALLOWED_STATUSES.includes(trimmed)) {
    throw new Error(`invalid status: ${trimmed}. Must be one of: ${ALLOWED_STATUSES.join(', ')}`);
  }
  return trimmed as RecurringBillingStatus;
}

export function updateRecurringBillingStatus(
  db: DB,
  id: number,
  status: string,
  actor = 'local_user',
): RecurringBilling {
  return updateRecurringBilling(db, id, { status: requireStatus(status) }, actor);
}

export function deleteRecurringBilling(db: DB, id: number, actor = 'local_user'): void {
  const before = getRecurringBillingOrThrow(db, id);
  db.transaction(() => {
    writeAudit(db, { actor, action: 'delete', entityType: ENTITY_TYPE, entityId: id, before });
    db.prepare('DELETE FROM recurring_billings WHERE id = ?').run(id);
  })();
}

/**
 * asOf('YYYY-MM-DD')基準で期日到来分の注文を生成する。
 * status='active' かつ next_billing_date <= asOf の各 billing について、
 * next_billing_date が asOf を超えるまで catch-up でループし(1回ごとに1注文)、
 * 安全上限 MAX_CATCHUP_PER_BILLING/billing でcapする。
 * Date.now() に依存せず、基準日は引数 asOf で受ける。
 */
export function generateDueBillings(db: DB, asOf: string, actor = 'local_user'): GenerateDueBillingsResult {
  // asOf を ISO 日付として厳密検証する。不正なら throw(route 側は 400)。
  // SQL の `next_billing_date <= ?` は字句比較のため、非日付文字列を弾かないと誤生成を招く。
  const asOfDate = requireIsoDate(asOf, 'asOf');
  const generated: Array<{ billingId: number; order: Order }> = [];
  const errors: Array<{ billingId: number; message: string }> = [];

  // dueRows の読み出しは1回で済ませるが、各 billing の生成は個別トランザクション
  // (savepoint)で囲み、1件の失敗(order_no 衝突・不正日付・参照切れ等)が
  // 他の健全な billing を巻き添えにロールバックしないよう分離する。
  const dueRows = db
    .prepare(
      `SELECT * FROM recurring_billings
       WHERE status = 'active' AND next_billing_date <= ?
       ORDER BY next_billing_date ASC, id ASC`,
    )
    .all(asOfDate) as RecurringBillingRow[];

  for (const row of dueRows) {
    const billingId = row.id;
    try {
      const billingGenerated = db.transaction(() => generateForBilling(db, row, asOfDate, actor))();
      generated.push(...billingGenerated);
    } catch (e) {
      // 失敗 billing は savepoint ごとロールバックされ、結果に記録して継続する。
      errors.push({ billingId, message: (e as Error).message });
    }
  }

  return { asOf: asOfDate, generated, errors };
}

/**
 * 1 billing 分の catch-up 生成。db.transaction でこの単位を savepoint 化して呼び出す。
 * order_no 衝突(過去日への巻き戻し等で既に生成済み)は冪等に扱い、既存注文を再利用して
 * next_billing_date のみ前進させ、重複生成を黙ってスキップする。
 */
function generateForBilling(
  db: DB,
  row: RecurringBillingRow,
  asOfDate: string,
  actor: string,
): Array<{ billingId: number; order: Order }> {
  const billingId = row.id;
  const generated: Array<{ billingId: number; order: Order }> = [];
  let billingDate = row.next_billing_date;
  let count = 0;

  while (billingDate <= asOfDate && count < MAX_CATCHUP_PER_BILLING) {
    const orderNo = `RB-${billingId}-${billingDate}`;
    const existing = getOrderByNo(db, orderNo);
    const nextDate = addMonths(billingDate, row.billing_period === 'monthly' ? 1 : 12);

    if (existing) {
      // 既にこの (billing, date) の注文が存在する(巻き戻し後の再実行等)。
      // order_no 衝突で run を落とさず、既存注文を再利用して next_billing_date のみ前進。
      // 重複生成にあたるため 'generate' 監査・generated への追加は行わない(冪等スキップ)。
      db.prepare(
        'UPDATE recurring_billings SET next_billing_date = @nextDate, last_generated_order_id = @orderId WHERE id = @id',
      ).run({ nextDate, orderId: existing.id, id: billingId });
    } else {
      // createOrder は order の 'create' 監査を自前で書く。
      const order = createOrder(
        db,
        {
          orderNo,
          customerId: row.customer_id,
          orderedAt: billingDate,
          channel: 'recurring',
          subtotalTaxIncluded: row.amount_tax_included,
          taxAmount: row.tax_amount,
          items: [
            {
              productId: row.product_id,
              quantity: 1,
              unitPriceTaxIncluded: row.amount_tax_included,
            },
          ],
        },
        actor,
      );
      db.prepare(
        'UPDATE recurring_billings SET next_billing_date = @nextDate, last_generated_order_id = @orderId WHERE id = @id',
      ).run({ nextDate, orderId: order.id, id: billingId });

      // billing 側にも 1 注文ごとに 'generate' 監査を残す(order の create 監査とは別)。
      writeAudit(db, {
        actor,
        action: 'generate',
        entityType: ENTITY_TYPE,
        entityId: billingId,
        after: { order_id: order.id, ordered_at: billingDate, next_billing_date: nextDate },
      });
      generated.push({ billingId, order });
    }

    billingDate = nextDate;
    count += 1;
  }

  return generated;
}

function getOrderByNo(db: DB, orderNo: string): { id: number } | null {
  return (db.prepare('SELECT id FROM orders WHERE order_no = ?').get(orderNo) as { id: number } | undefined) ?? null;
}
