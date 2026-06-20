import { writeAudit } from '../audit.js';
import type { DB } from '../db/connection.js';
import { hasText, nullableText, requirePositiveInteger, requireText } from '../util/validate.js';

export type ProductType = 'download' | 'course' | 'membership' | 'template' | 'service' | 'other';
export type BillingPeriod = 'monthly' | 'yearly' | 'one_time' | 'other';

export interface Product {
  id: number;
  sku: string;
  title: string;
  productType: ProductType;
  priceTaxIncluded: number;
  currency: string;
  licenseSummary: string | null;
  operatingEnvironment: string | null;
  refundPolicy: string | null;
  status: string;
  createdAt: string;
}

export interface SubscriptionPlan {
  id: number;
  productId: number;
  planName: string;
  billingPeriod: BillingPeriod;
  renewalPolicy: string | null;
  cancellationPolicy: string | null;
  trialPolicy: string | null;
  postCancelAccessPolicy: string | null;
  createdAt: string;
}

export interface ProductCompletenessWarning {
  field: string;
  message: string;
  sourceIds: Array<'S5' | 'S6'>;
  reason: string;
}

export interface ProductCompletenessResult {
  complete: boolean;
  warnings: ProductCompletenessWarning[];
}

export interface CreateProductInput {
  sku: string;
  title: string;
  productType: ProductType;
  priceTaxIncluded: number;
  currency?: string | null;
  licenseSummary?: string | null;
  operatingEnvironment?: string | null;
  refundPolicy?: string | null;
  status?: string | null;
}

export type UpdateProductInput = Partial<CreateProductInput>;

export interface CreateSubscriptionPlanInput {
  productId: number;
  planName: string;
  billingPeriod: BillingPeriod;
  renewalPolicy: string;
  cancellationPolicy: string;
  trialPolicy?: string | null;
  postCancelAccessPolicy?: string | null;
}

export type UpdateSubscriptionPlanInput = Partial<Omit<CreateSubscriptionPlanInput, 'productId'>> & {
  productId?: number;
};

interface ProductRow {
  id: number;
  sku: string;
  title: string;
  product_type: ProductType;
  price_tax_included: number;
  currency: string;
  license_summary: string | null;
  operating_environment: string | null;
  refund_policy: string | null;
  status: string;
  created_at: string;
}

interface SubscriptionPlanRow {
  id: number;
  product_id: number;
  plan_name: string;
  billing_period: BillingPeriod;
  renewal_policy: string | null;
  cancellation_policy: string | null;
  trial_policy: string | null;
  post_cancel_access_policy: string | null;
  created_at: string;
}

const PRODUCT_TYPES: ProductType[] = ['download', 'course', 'membership', 'template', 'service', 'other'];
const BILLING_PERIODS: BillingPeriod[] = ['monthly', 'yearly', 'one_time', 'other'];

export function listProducts(db: DB): Product[] {
  return db
    .prepare('SELECT * FROM products ORDER BY id ASC')
    .all()
    .map((row) => mapProduct(row as ProductRow));
}

export function getProduct(db: DB, id: number): Product | null {
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as ProductRow | undefined;
  return row ? mapProduct(row) : null;
}

export function createProduct(db: DB, input: CreateProductInput, actor = 'local_user'): Product {
  const payload = normalizeCreateProduct(input);
  const run = db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO products
          (sku, title, product_type, price_tax_included, currency, license_summary,
           operating_environment, refund_policy, status)
         VALUES
          (@sku, @title, @productType, @priceTaxIncluded, @currency, @licenseSummary,
           @operatingEnvironment, @refundPolicy, @status)`,
      )
      .run(payload);
    const created = getProductOrThrow(db, Number(result.lastInsertRowid));
    writeAudit(db, { actor, action: 'create', entityType: 'product', entityId: created.id, after: created });
    return created;
  });
  return run();
}

export function updateProduct(db: DB, id: number, input: UpdateProductInput, actor = 'local_user'): Product | null {
  const before = getProduct(db, id);
  if (!before) return null;
  const next = { ...before, ...normalizeUpdateProduct(input) };

  const run = db.transaction(() => {
    db.prepare(
      `UPDATE products SET
         sku = @sku,
         title = @title,
         product_type = @productType,
         price_tax_included = @priceTaxIncluded,
         currency = @currency,
         license_summary = @licenseSummary,
         operating_environment = @operatingEnvironment,
         refund_policy = @refundPolicy,
         status = @status
       WHERE id = @id`,
    ).run({
      id,
      sku: next.sku,
      title: next.title,
      productType: next.productType,
      priceTaxIncluded: next.priceTaxIncluded,
      currency: next.currency,
      licenseSummary: next.licenseSummary,
      operatingEnvironment: next.operatingEnvironment,
      refundPolicy: next.refundPolicy,
      status: next.status,
    });
    const after = getProductOrThrow(db, id);
    writeAudit(db, { actor, action: 'update', entityType: 'product', entityId: id, before, after });
    return after;
  });
  return run();
}

export function deleteProduct(db: DB, id: number, actor = 'local_user'): boolean {
  const before = getProduct(db, id);
  if (!before) return false;

  const run = db.transaction(() => {
    const plans = listSubscriptionPlansForProduct(db, id);
    writeAudit(db, { actor, action: 'delete', entityType: 'product', entityId: id, before: { ...before, plans } });
    db.prepare('DELETE FROM products WHERE id = ?').run(id);
  });
  run();
  return true;
}

export function listSubscriptionPlans(db: DB): SubscriptionPlan[] {
  return db
    .prepare('SELECT * FROM subscription_plans ORDER BY product_id ASC, id ASC')
    .all()
    .map((row) => mapSubscriptionPlan(row as SubscriptionPlanRow));
}

export function listSubscriptionPlansForProduct(db: DB, productId: number): SubscriptionPlan[] {
  return db
    .prepare('SELECT * FROM subscription_plans WHERE product_id = ? ORDER BY id ASC')
    .all(productId)
    .map((row) => mapSubscriptionPlan(row as SubscriptionPlanRow));
}

export function getSubscriptionPlan(db: DB, id: number): SubscriptionPlan | null {
  const row = db.prepare('SELECT * FROM subscription_plans WHERE id = ?').get(id) as SubscriptionPlanRow | undefined;
  return row ? mapSubscriptionPlan(row) : null;
}

export function createSubscriptionPlan(
  db: DB,
  input: CreateSubscriptionPlanInput,
  actor = 'local_user',
): SubscriptionPlan {
  const payload = normalizeCreateSubscriptionPlan(input);
  if (!getProduct(db, payload.productId)) {
    throw new Error(`product not found: ${payload.productId}`);
  }

  const run = db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO subscription_plans
          (product_id, plan_name, billing_period, renewal_policy, cancellation_policy,
           trial_policy, post_cancel_access_policy)
         VALUES
          (@productId, @planName, @billingPeriod, @renewalPolicy, @cancellationPolicy,
           @trialPolicy, @postCancelAccessPolicy)`,
      )
      .run(payload);
    const created = getSubscriptionPlanOrThrow(db, Number(result.lastInsertRowid));
    writeAudit(db, {
      actor,
      action: 'create',
      entityType: 'subscription_plan',
      entityId: created.id,
      after: created,
    });
    return created;
  });
  return run();
}

export function updateSubscriptionPlan(
  db: DB,
  id: number,
  input: UpdateSubscriptionPlanInput,
  actor = 'local_user',
): SubscriptionPlan | null {
  const before = getSubscriptionPlan(db, id);
  if (!before) return null;
  const next = { ...before, ...normalizeUpdateSubscriptionPlan(input) };
  if (!getProduct(db, next.productId)) {
    throw new Error(`product not found: ${next.productId}`);
  }

  const run = db.transaction(() => {
    db.prepare(
      `UPDATE subscription_plans SET
         product_id = @productId,
         plan_name = @planName,
         billing_period = @billingPeriod,
         renewal_policy = @renewalPolicy,
         cancellation_policy = @cancellationPolicy,
         trial_policy = @trialPolicy,
         post_cancel_access_policy = @postCancelAccessPolicy
       WHERE id = @id`,
    ).run({
      id,
      productId: next.productId,
      planName: next.planName,
      billingPeriod: next.billingPeriod,
      renewalPolicy: next.renewalPolicy,
      cancellationPolicy: next.cancellationPolicy,
      trialPolicy: next.trialPolicy,
      postCancelAccessPolicy: next.postCancelAccessPolicy,
    });
    const after = getSubscriptionPlanOrThrow(db, id);
    writeAudit(db, {
      actor,
      action: 'update',
      entityType: 'subscription_plan',
      entityId: id,
      before,
      after,
    });
    return after;
  });
  return run();
}

export function deleteSubscriptionPlan(db: DB, id: number, actor = 'local_user'): boolean {
  const before = getSubscriptionPlan(db, id);
  if (!before) return false;

  const run = db.transaction(() => {
    writeAudit(db, { actor, action: 'delete', entityType: 'subscription_plan', entityId: id, before });
    db.prepare('DELETE FROM subscription_plans WHERE id = ?').run(id);
  });
  run();
  return true;
}

export function checkProductCompleteness(
  product: Pick<Product, 'productType' | 'priceTaxIncluded' | 'licenseSummary' | 'operatingEnvironment' | 'refundPolicy'>,
  plans: Array<
    Pick<SubscriptionPlan, 'billingPeriod' | 'renewalPolicy' | 'cancellationPolicy' | 'postCancelAccessPolicy'>
  >,
): ProductCompletenessResult {
  const warnings: ProductCompletenessWarning[] = [];

  if (!isValidPrice(product.priceTaxIncluded)) {
    warnings.push({
      field: 'priceTaxIncluded',
      message: '税込販売価格を整数の円で設定してください。',
      sourceIds: ['S5', 'S6'],
      reason: 'S5は消費者向け価格の税込総額表示、S6は通信販売広告の販売価格表示を求めるため。',
    });
  }
  if (!hasText(product.operatingEnvironment)) {
    warnings.push({
      field: 'operatingEnvironment',
      message: '商品ページに動作環境を記載してください。',
      sourceIds: ['S6'],
      reason: 'S6は通信販売広告で商品の提供条件を明確に表示する必要があるため。',
    });
  }
  if (!hasText(product.licenseSummary)) {
    warnings.push({
      field: 'licenseSummary',
      message: '利用許諾や使用範囲の要約を記載してください。',
      sourceIds: ['S6'],
      reason: 'S6は購入前に契約条件や解除条件を確認できる表示を求めるため。',
    });
  }
  if (!hasText(product.refundPolicy)) {
    warnings.push({
      field: 'refundPolicy',
      message: '返品・解除・返金条件を記載してください。',
      sourceIds: ['S6'],
      reason: 'S6は返品特約や契約解除に関する事項の表示を求めるため。',
    });
  }

  const subscriptionPlans = plans
    .map((plan, index) => ({ plan, index }))
    .filter(({ plan }) => plan.billingPeriod !== 'one_time');
  if (product.productType === 'membership' && subscriptionPlans.length === 0) {
    warnings.push({
      field: 'subscriptionPlans',
      message: '継続課金商品のプラン条件を登録してください。',
      sourceIds: ['S6'],
      reason: 'S6は通信販売の申込み前に支払時期、契約期間、解除条件を明確にする必要があるため。',
    });
  }

  subscriptionPlans.forEach(({ plan, index }) => {
    if (!hasText(plan.renewalPolicy)) {
      warnings.push({
        field: `plans[${index}].renewalPolicy`,
        message: 'サブスクの更新日・更新価格・請求タイミングを記載してください。',
        sourceIds: ['S6'],
        reason: 'S6は継続課金の支払時期や契約条件を購入前に確認できる表示を求めるため。',
      });
    }
    if (!hasText(plan.cancellationPolicy)) {
      warnings.push({
        field: `plans[${index}].cancellationPolicy`,
        message: 'サブスクの解約方法と期限を記載してください。',
        sourceIds: ['S6'],
        reason: 'S6は契約解除に関する事項を通信販売広告や最終確認で明確にする必要があるため。',
      });
    }
    if (!hasText(plan.postCancelAccessPolicy)) {
      warnings.push({
        field: `plans[${index}].postCancelAccessPolicy`,
        message: '解約後の閲覧・利用可否を記載してください。',
        sourceIds: ['S6'],
        reason: 'S6は解除後の提供条件を含め、顧客が契約条件を誤認しない表示を求めるため。',
      });
    }
  });

  return { complete: warnings.length === 0, warnings };
}

function getProductOrThrow(db: DB, id: number): Product {
  const product = getProduct(db, id);
  if (!product) throw new Error(`product not found: ${id}`);
  return product;
}

function getSubscriptionPlanOrThrow(db: DB, id: number): SubscriptionPlan {
  const plan = getSubscriptionPlan(db, id);
  if (!plan) throw new Error(`subscription plan not found: ${id}`);
  return plan;
}

function normalizeCreateProduct(input: CreateProductInput): Omit<Product, 'id' | 'createdAt'> {
  return {
    sku: requireText(input.sku, 'sku'),
    title: requireText(input.title, 'title'),
    productType: requireProductType(input.productType),
    priceTaxIncluded: requirePrice(input.priceTaxIncluded),
    currency: normalizeCurrency(input.currency),
    licenseSummary: nullableText(input.licenseSummary),
    operatingEnvironment: nullableText(input.operatingEnvironment),
    refundPolicy: nullableText(input.refundPolicy),
    status: nullableText(input.status) ?? 'draft',
  };
}

function normalizeUpdateProduct(input: UpdateProductInput): Partial<Omit<Product, 'id' | 'createdAt'>> {
  const out: Partial<Omit<Product, 'id' | 'createdAt'>> = {};
  if (input.sku !== undefined) out.sku = requireText(input.sku, 'sku');
  if (input.title !== undefined) out.title = requireText(input.title, 'title');
  if (input.productType !== undefined) out.productType = requireProductType(input.productType);
  if (input.priceTaxIncluded !== undefined) out.priceTaxIncluded = requirePrice(input.priceTaxIncluded);
  if (input.currency !== undefined) out.currency = normalizeCurrency(input.currency);
  if (input.licenseSummary !== undefined) out.licenseSummary = nullableText(input.licenseSummary);
  if (input.operatingEnvironment !== undefined) out.operatingEnvironment = nullableText(input.operatingEnvironment);
  if (input.refundPolicy !== undefined) out.refundPolicy = nullableText(input.refundPolicy);
  if (input.status !== undefined) out.status = nullableText(input.status) ?? 'draft';
  return out;
}

function normalizeCreateSubscriptionPlan(
  input: CreateSubscriptionPlanInput,
): Omit<SubscriptionPlan, 'id' | 'createdAt'> {
  return {
    productId: requirePositiveInteger(input.productId, 'productId'),
    planName: requireText(input.planName, 'planName'),
    billingPeriod: requireBillingPeriod(input.billingPeriod),
    renewalPolicy: requireText(input.renewalPolicy, 'renewalPolicy'),
    cancellationPolicy: requireText(input.cancellationPolicy, 'cancellationPolicy'),
    trialPolicy: nullableText(input.trialPolicy),
    postCancelAccessPolicy: nullableText(input.postCancelAccessPolicy),
  };
}

function normalizeUpdateSubscriptionPlan(
  input: UpdateSubscriptionPlanInput,
): Partial<Omit<SubscriptionPlan, 'id' | 'createdAt'>> {
  const out: Partial<Omit<SubscriptionPlan, 'id' | 'createdAt'>> = {};
  if (input.productId !== undefined) out.productId = requirePositiveInteger(input.productId, 'productId');
  if (input.planName !== undefined) out.planName = requireText(input.planName, 'planName');
  if (input.billingPeriod !== undefined) out.billingPeriod = requireBillingPeriod(input.billingPeriod);
  if (input.renewalPolicy !== undefined) out.renewalPolicy = requireText(input.renewalPolicy, 'renewalPolicy');
  if (input.cancellationPolicy !== undefined) out.cancellationPolicy = requireText(input.cancellationPolicy, 'cancellationPolicy');
  if (input.trialPolicy !== undefined) out.trialPolicy = nullableText(input.trialPolicy);
  if (input.postCancelAccessPolicy !== undefined) {
    out.postCancelAccessPolicy = nullableText(input.postCancelAccessPolicy);
  }
  return out;
}

function requireProductType(value: ProductType): ProductType {
  if (!PRODUCT_TYPES.includes(value)) throw new Error('productType is invalid');
  return value;
}

function requireBillingPeriod(value: BillingPeriod): BillingPeriod {
  if (!BILLING_PERIODS.includes(value)) throw new Error('billingPeriod is invalid');
  return value;
}

function requirePrice(value: number): number {
  if (!isValidPrice(value)) throw new Error('priceTaxIncluded must be a non-negative integer yen amount');
  return value;
}

function normalizeCurrency(value: string | null | undefined): string {
  return nullableText(value) ?? 'JPY';
}

// 税込単価 × 数量などの下流計算で安全整数域を超えないよう、現実的な上限を設ける。
// 10億円/単価を上限とする(これを超える価格は入力ミスとみなす)。
const MAX_PRICE_TAX_INCLUDED = 1_000_000_000;

function isValidPrice(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_PRICE_TAX_INCLUDED;
}

function mapProduct(row: ProductRow): Product {
  return {
    id: row.id,
    sku: row.sku,
    title: row.title,
    productType: row.product_type,
    priceTaxIncluded: row.price_tax_included,
    currency: row.currency,
    licenseSummary: row.license_summary,
    operatingEnvironment: row.operating_environment,
    refundPolicy: row.refund_policy,
    status: row.status,
    createdAt: row.created_at,
  };
}

function mapSubscriptionPlan(row: SubscriptionPlanRow): SubscriptionPlan {
  return {
    id: row.id,
    productId: row.product_id,
    planName: row.plan_name,
    billingPeriod: row.billing_period,
    renewalPolicy: row.renewal_policy,
    cancellationPolicy: row.cancellation_policy,
    trialPolicy: row.trial_policy,
    postCancelAccessPolicy: row.post_cancel_access_policy,
    createdAt: row.created_at,
  };
}
