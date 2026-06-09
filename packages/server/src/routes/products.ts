import type { FastifyInstance } from 'fastify';

type ProductType = 'download' | 'course' | 'membership' | 'template' | 'service' | 'other';
type BillingPeriod = 'monthly' | 'yearly' | 'one_time' | 'other';

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

interface ProductPayload {
  sku?: unknown;
  title?: unknown;
  productType?: unknown;
  priceTaxIncluded?: unknown;
  currency?: unknown;
  licenseSummary?: unknown;
  operatingEnvironment?: unknown;
  refundPolicy?: unknown;
  status?: unknown;
}

interface PlanPayload {
  productId?: unknown;
  planName?: unknown;
  billingPeriod?: unknown;
  renewalPolicy?: unknown;
  cancellationPolicy?: unknown;
  trialPolicy?: unknown;
  postCancelAccessPolicy?: unknown;
}

const PRODUCT_TYPES: ProductType[] = ['download', 'course', 'membership', 'template', 'service', 'other'];
const BILLING_PERIODS: BillingPeriod[] = ['monthly', 'yearly', 'one_time', 'other'];

export async function productRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/products', async () => {
    return listProducts(app);
  });

  app.get('/api/products/:id', async (req, reply) => {
    const id = routeId(req.params);
    if (id == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    const product = getProduct(app, id);
    if (!product) {
      reply.code(404);
      return { error: 'not_found' };
    }
    return product;
  });

  app.post('/api/products', async (req, reply) => {
    try {
      const body = (req.body ?? {}) as ProductPayload;
      const payload = normalizeCreateProduct(body);
      const created = app.db.transaction(() => {
        const result = app.db
          .prepare(
            `INSERT INTO products
              (sku, title, product_type, price_tax_included, currency, license_summary,
               operating_environment, refund_policy, status)
             VALUES
              (@sku, @title, @productType, @priceTaxIncluded, @currency, @licenseSummary,
               @operatingEnvironment, @refundPolicy, @status)`,
          )
          .run(payload);
        const product = getProductOrThrow(app, Number(result.lastInsertRowid));
        writeAudit(app, 'product', 'create', product.id, undefined, product);
        return product;
      })();
      reply.code(201);
      return created;
    } catch (error) {
      reply.code(400);
      return invalidPayload(error);
    }
  });

  app.put('/api/products/:id', async (req, reply) => {
    const id = routeId(req.params);
    if (id == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    const before = getProduct(app, id);
    if (!before) {
      reply.code(404);
      return { error: 'not_found' };
    }

    try {
      const next = { ...before, ...normalizeUpdateProduct((req.body ?? {}) as ProductPayload) };
      const updated = app.db.transaction(() => {
        app.db
          .prepare(
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
          )
          .run({
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
        const after = getProductOrThrow(app, id);
        writeAudit(app, 'product', 'update', id, before, after);
        return after;
      })();
      return updated;
    } catch (error) {
      reply.code(400);
      return invalidPayload(error);
    }
  });

  app.delete('/api/products/:id', async (req, reply) => {
    const id = routeId(req.params);
    if (id == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    const before = getProduct(app, id);
    if (!before) {
      reply.code(404);
      return { error: 'not_found' };
    }
    app.db.transaction(() => {
      const plans = listPlansForProduct(app, id);
      writeAudit(app, 'product', 'delete', id, { ...before, plans }, undefined);
      app.db.prepare('DELETE FROM products WHERE id = ?').run(id);
    })();
    reply.code(204);
    return undefined;
  });

  app.get('/api/products/:id/plans', async (req, reply) => {
    const productId = routeId(req.params);
    if (productId == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    if (!getProduct(app, productId)) {
      reply.code(404);
      return { error: 'not_found' };
    }
    return listPlansForProduct(app, productId);
  });

  app.post('/api/products/:id/plans', async (req, reply) => {
    const productId = routeId(req.params);
    if (productId == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    if (!getProduct(app, productId)) {
      reply.code(404);
      return { error: 'not_found' };
    }

    try {
      const payload = normalizeCreatePlan({ ...((req.body ?? {}) as PlanPayload), productId });
      const created = app.db.transaction(() => {
        const result = app.db
          .prepare(
            `INSERT INTO subscription_plans
              (product_id, plan_name, billing_period, renewal_policy, cancellation_policy,
               trial_policy, post_cancel_access_policy)
             VALUES
              (@productId, @planName, @billingPeriod, @renewalPolicy, @cancellationPolicy,
               @trialPolicy, @postCancelAccessPolicy)`,
          )
          .run(payload);
        const plan = getPlanOrThrow(app, Number(result.lastInsertRowid));
        writeAudit(app, 'subscription_plan', 'create', plan.id, undefined, plan);
        return plan;
      })();
      reply.code(201);
      return created;
    } catch (error) {
      reply.code(400);
      return invalidPayload(error);
    }
  });

  app.put('/api/products/:productId/plans/:planId', async (req, reply) => {
    const productId = routeParamId(req.params, 'productId');
    const planId = routeParamId(req.params, 'planId');
    if (productId == null || planId == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    if (!getProduct(app, productId)) {
      reply.code(404);
      return { error: 'not_found' };
    }
    const before = getPlan(app, planId);
    if (!before || before.productId !== productId) {
      reply.code(404);
      return { error: 'not_found' };
    }

    try {
      const next = { ...before, ...normalizeUpdatePlan((req.body ?? {}) as PlanPayload), productId };
      const updated = app.db.transaction(() => {
        app.db
          .prepare(
            `UPDATE subscription_plans SET
               product_id = @productId,
               plan_name = @planName,
               billing_period = @billingPeriod,
               renewal_policy = @renewalPolicy,
               cancellation_policy = @cancellationPolicy,
               trial_policy = @trialPolicy,
               post_cancel_access_policy = @postCancelAccessPolicy
             WHERE id = @id`,
          )
          .run({
            id: planId,
            productId: next.productId,
            planName: next.planName,
            billingPeriod: next.billingPeriod,
            renewalPolicy: next.renewalPolicy,
            cancellationPolicy: next.cancellationPolicy,
            trialPolicy: next.trialPolicy,
            postCancelAccessPolicy: next.postCancelAccessPolicy,
          });
        const after = getPlanOrThrow(app, planId);
        writeAudit(app, 'subscription_plan', 'update', planId, before, after);
        return after;
      })();
      return updated;
    } catch (error) {
      reply.code(400);
      return invalidPayload(error);
    }
  });

  app.delete('/api/products/:productId/plans/:planId', async (req, reply) => {
    const productId = routeParamId(req.params, 'productId');
    const planId = routeParamId(req.params, 'planId');
    if (productId == null || planId == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    const before = getPlan(app, planId);
    if (!before || before.productId !== productId) {
      reply.code(404);
      return { error: 'not_found' };
    }
    app.db.transaction(() => {
      writeAudit(app, 'subscription_plan', 'delete', planId, before, undefined);
      app.db.prepare('DELETE FROM subscription_plans WHERE id = ?').run(planId);
    })();
    reply.code(204);
    return undefined;
  });

  app.get('/api/products/:id/completeness', async (req, reply) => {
    const id = routeId(req.params);
    if (id == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    const product = getProduct(app, id);
    if (!product) {
      reply.code(404);
      return { error: 'not_found' };
    }
    const plans = listPlansForProduct(app, id);
    return { product, plans, ...checkCompleteness(product, plans) };
  });
}

function listProducts(app: FastifyInstance): ReturnType<typeof mapProduct>[] {
  return app
    .db.prepare('SELECT * FROM products ORDER BY id ASC')
    .all()
    .map((row) => mapProduct(row as ProductRow));
}

function getProduct(app: FastifyInstance, id: number): ReturnType<typeof mapProduct> | null {
  const row = app.db.prepare('SELECT * FROM products WHERE id = ?').get(id) as ProductRow | undefined;
  return row ? mapProduct(row) : null;
}

function getProductOrThrow(app: FastifyInstance, id: number): ReturnType<typeof mapProduct> {
  const product = getProduct(app, id);
  if (!product) throw new Error(`product not found: ${id}`);
  return product;
}

function listPlansForProduct(app: FastifyInstance, productId: number): ReturnType<typeof mapPlan>[] {
  return app
    .db.prepare('SELECT * FROM subscription_plans WHERE product_id = ? ORDER BY id ASC')
    .all(productId)
    .map((row) => mapPlan(row as SubscriptionPlanRow));
}

function getPlan(app: FastifyInstance, id: number): ReturnType<typeof mapPlan> | null {
  const row = app.db.prepare('SELECT * FROM subscription_plans WHERE id = ?').get(id) as SubscriptionPlanRow | undefined;
  return row ? mapPlan(row) : null;
}

function getPlanOrThrow(app: FastifyInstance, id: number): ReturnType<typeof mapPlan> {
  const plan = getPlan(app, id);
  if (!plan) throw new Error(`subscription plan not found: ${id}`);
  return plan;
}

function normalizeCreateProduct(body: ProductPayload): Record<string, string | number | null> {
  return {
    sku: requireText(body.sku, 'sku'),
    title: requireText(body.title, 'title'),
    productType: requireProductType(body.productType),
    priceTaxIncluded: requirePrice(body.priceTaxIncluded),
    currency: nullableText(body.currency, 'currency') ?? 'JPY',
    licenseSummary: nullableText(body.licenseSummary, 'licenseSummary'),
    operatingEnvironment: nullableText(body.operatingEnvironment, 'operatingEnvironment'),
    refundPolicy: nullableText(body.refundPolicy, 'refundPolicy'),
    status: nullableText(body.status, 'status') ?? 'draft',
  };
}

function normalizeUpdateProduct(body: ProductPayload): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  if (body.sku !== undefined) out.sku = requireText(body.sku, 'sku');
  if (body.title !== undefined) out.title = requireText(body.title, 'title');
  if (body.productType !== undefined) out.productType = requireProductType(body.productType);
  if (body.priceTaxIncluded !== undefined) out.priceTaxIncluded = requirePrice(body.priceTaxIncluded);
  if (body.currency !== undefined) out.currency = nullableText(body.currency, 'currency') ?? 'JPY';
  if (body.licenseSummary !== undefined) out.licenseSummary = nullableText(body.licenseSummary, 'licenseSummary');
  if (body.operatingEnvironment !== undefined) {
    out.operatingEnvironment = nullableText(body.operatingEnvironment, 'operatingEnvironment');
  }
  if (body.refundPolicy !== undefined) out.refundPolicy = nullableText(body.refundPolicy, 'refundPolicy');
  if (body.status !== undefined) out.status = nullableText(body.status, 'status') ?? 'draft';
  return out;
}

function normalizeCreatePlan(body: PlanPayload): Record<string, string | number | null> {
  return {
    productId: requirePositiveInteger(body.productId, 'productId'),
    planName: requireText(body.planName, 'planName'),
    billingPeriod: requireBillingPeriod(body.billingPeriod),
    renewalPolicy: requireText(body.renewalPolicy, 'renewalPolicy'),
    cancellationPolicy: requireText(body.cancellationPolicy, 'cancellationPolicy'),
    trialPolicy: nullableText(body.trialPolicy, 'trialPolicy'),
    postCancelAccessPolicy: nullableText(body.postCancelAccessPolicy, 'postCancelAccessPolicy'),
  };
}

function normalizeUpdatePlan(body: PlanPayload): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  if (body.productId !== undefined) out.productId = requirePositiveInteger(body.productId, 'productId');
  if (body.planName !== undefined) out.planName = requireText(body.planName, 'planName');
  if (body.billingPeriod !== undefined) out.billingPeriod = requireBillingPeriod(body.billingPeriod);
  if (body.renewalPolicy !== undefined) out.renewalPolicy = requireText(body.renewalPolicy, 'renewalPolicy');
  if (body.cancellationPolicy !== undefined) out.cancellationPolicy = requireText(body.cancellationPolicy, 'cancellationPolicy');
  if (body.trialPolicy !== undefined) out.trialPolicy = nullableText(body.trialPolicy, 'trialPolicy');
  if (body.postCancelAccessPolicy !== undefined) {
    out.postCancelAccessPolicy = nullableText(body.postCancelAccessPolicy, 'postCancelAccessPolicy');
  }
  return out;
}

function checkCompleteness(
  product: ReturnType<typeof mapProduct>,
  plans: ReturnType<typeof mapPlan>[],
): {
  complete: boolean;
  warnings: Array<{ field: string; message: string; sourceIds: string[]; reason: string }>;
} {
  const warnings: Array<{ field: string; message: string; sourceIds: string[]; reason: string }> = [];
  if (!Number.isSafeInteger(product.priceTaxIncluded) || product.priceTaxIncluded < 0) {
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

function writeAudit(
  app: FastifyInstance,
  entityType: string,
  action: string,
  entityId: number,
  before: unknown,
  after: unknown,
): void {
  app.db
    .prepare(
      `INSERT INTO audit_logs (actor, action, entity_type, entity_id, before_json, after_json)
       VALUES (@actor, @action, @entityType, @entityId, @before, @after)`,
    )
    .run({
      actor: 'local_user',
      action,
      entityType,
      entityId: String(entityId),
      before: before === undefined ? null : JSON.stringify(before),
      after: after === undefined ? null : JSON.stringify(after),
    });
}

function routeId(params: unknown): number | null {
  return routeParamId(params, 'id');
}

function routeParamId(params: unknown, key: string): number | null {
  const value = (params as Record<string, string | undefined>)[key];
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function requireProductType(value: unknown): ProductType {
  if (typeof value !== 'string' || !PRODUCT_TYPES.includes(value as ProductType)) {
    throw new Error('productType is invalid');
  }
  return value as ProductType;
}

function requireBillingPeriod(value: unknown): BillingPeriod {
  if (typeof value !== 'string' || !BILLING_PERIODS.includes(value as BillingPeriod)) {
    throw new Error('billingPeriod is invalid');
  }
  return value as BillingPeriod;
}

function requirePrice(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('priceTaxIncluded must be a non-negative integer yen amount');
  }
  return value;
}

function requirePositiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return value;
}

function requireText(value: unknown, field: string): string {
  const text = nullableText(value, field);
  if (!text) throw new Error(`${field} is required`);
  return text;
}

function nullableText(value: unknown, field: string): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  const text = value.trim();
  return text.length > 0 ? text : null;
}

function hasText(value: string | null | undefined): boolean {
  return value != null && value.trim().length > 0;
}

function invalidPayload(error: unknown): { error: string; message: string } {
  return { error: 'invalid_payload', message: error instanceof Error ? error.message : 'invalid payload' };
}

function mapProduct(row: ProductRow): {
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
} {
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

function mapPlan(row: SubscriptionPlanRow): {
  id: number;
  productId: number;
  planName: string;
  billingPeriod: BillingPeriod;
  renewalPolicy: string | null;
  cancellationPolicy: string | null;
  trialPolicy: string | null;
  postCancelAccessPolicy: string | null;
  createdAt: string;
} {
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
