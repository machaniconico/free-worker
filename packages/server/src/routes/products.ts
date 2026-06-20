import type { FastifyInstance } from 'fastify';
import {
  createProduct,
  updateProduct,
  deleteProduct,
  getProduct,
  listProducts,
  createSubscriptionPlan,
  updateSubscriptionPlan,
  deleteSubscriptionPlan,
  getSubscriptionPlan,
  listSubscriptionPlansForProduct,
  checkProductCompleteness,
  type CreateProductInput,
  type UpdateProductInput,
  type CreateSubscriptionPlanInput,
  type UpdateSubscriptionPlanInput,
} from '@free-worker/core';

export async function productRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/products', async () => {
    return listProducts(app.db);
  });

  app.get('/api/products/:id', async (req, reply) => {
    const id = routeId(req.params);
    if (id == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    const product = getProduct(app.db, id);
    if (!product) {
      reply.code(404);
      return { error: 'not_found' };
    }
    return product;
  });

  app.post('/api/products', async (req, reply) => {
    try {
      const body = req.body as CreateProductInput;
      const created = createProduct(app.db, body);
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
    if (!getProduct(app.db, id)) {
      reply.code(404);
      return { error: 'not_found' };
    }

    try {
      const body = req.body as UpdateProductInput;
      const updated = updateProduct(app.db, id, body);
      if (!updated) {
        reply.code(404);
        return { error: 'not_found' };
      }
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
    if (!getProduct(app.db, id)) {
      reply.code(404);
      return { error: 'not_found' };
    }
    deleteProduct(app.db, id);
    reply.code(204);
    return undefined;
  });

  app.get('/api/products/:id/plans', async (req, reply) => {
    const productId = routeId(req.params);
    if (productId == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    if (!getProduct(app.db, productId)) {
      reply.code(404);
      return { error: 'not_found' };
    }
    return listSubscriptionPlansForProduct(app.db, productId);
  });

  app.post('/api/products/:id/plans', async (req, reply) => {
    const productId = routeId(req.params);
    if (productId == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    if (!getProduct(app.db, productId)) {
      reply.code(404);
      return { error: 'not_found' };
    }

    try {
      const body = { ...((req.body ?? {}) as Omit<CreateSubscriptionPlanInput, 'productId'>), productId };
      const created = createSubscriptionPlan(app.db, body as CreateSubscriptionPlanInput);
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
    if (!getProduct(app.db, productId)) {
      reply.code(404);
      return { error: 'not_found' };
    }
    const before = getSubscriptionPlan(app.db, planId);
    if (!before || before.productId !== productId) {
      reply.code(404);
      return { error: 'not_found' };
    }

    try {
      const body = req.body as UpdateSubscriptionPlanInput;
      const updated = updateSubscriptionPlan(app.db, planId, body);
      if (!updated) {
        reply.code(404);
        return { error: 'not_found' };
      }
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
    const before = getSubscriptionPlan(app.db, planId);
    if (!before || before.productId !== productId) {
      reply.code(404);
      return { error: 'not_found' };
    }
    deleteSubscriptionPlan(app.db, planId);
    reply.code(204);
    return undefined;
  });

  app.get('/api/products/:id/completeness', async (req, reply) => {
    const id = routeId(req.params);
    if (id == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    const product = getProduct(app.db, id);
    if (!product) {
      reply.code(404);
      return { error: 'not_found' };
    }
    const plans = listSubscriptionPlansForProduct(app.db, id);
    return { product, plans, ...checkProductCompleteness(product, plans) };
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

function invalidPayload(error: unknown): { error: string; message: string } {
  return { error: 'invalid_payload', message: error instanceof Error ? error.message : 'invalid payload' };
}
