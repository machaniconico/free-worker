import type { FastifyInstance } from 'fastify';
import { writeAudit, type DB } from '@free-worker/core';

type ContentProjectStatus = 'idea' | 'production' | 'rights_review' | 'sales_prep' | 'published' | 'updating' | 'retired';
type RightsCheckStatus = '未確認' | '確認中' | '確認済';
type ContentTaskStatus = 'todo' | 'doing' | 'done' | 'blocked';
type ContentTaskPriority = 'low' | 'medium' | 'high';
type ProductType = 'download' | 'course' | 'membership' | 'template' | 'service' | 'other';
type BillingPeriod = 'monthly' | 'yearly' | 'one_time' | 'other';

interface ProjectPayload {
  title?: unknown;
  status?: unknown;
  plannedReleaseDate?: unknown;
  rightsCheckStatus?: unknown;
  productId?: unknown;
}

interface TaskPayload {
  projectId?: unknown;
  title?: unknown;
  status?: unknown;
  priority?: unknown;
  dueDate?: unknown;
  checklistRef?: unknown;
}

interface IdParams {
  id: string;
}

interface ProjectTaskParams {
  id: string;
  taskId: string;
}

interface ContentProjectRow {
  id: number;
  title: string;
  status: ContentProjectStatus;
  planned_release_date: string | null;
  rights_check_status: RightsCheckStatus;
  product_id: number | null;
  created_at: string;
}

interface ContentTaskRow {
  id: number;
  project_id: number;
  title: string;
  status: ContentTaskStatus;
  priority: ContentTaskPriority;
  due_date: string | null;
  checklist_ref: string | null;
}

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

const PROJECT_ENTITY = 'content_project';
const TASK_ENTITY = 'content_task';
const PROJECT_STATUSES: ContentProjectStatus[] = [
  'idea',
  'production',
  'rights_review',
  'sales_prep',
  'published',
  'updating',
  'retired',
];
const RIGHTS_STATUSES: RightsCheckStatus[] = ['未確認', '確認中', '確認済'];
const TASK_STATUSES: ContentTaskStatus[] = ['todo', 'doing', 'done', 'blocked'];
const TASK_PRIORITIES: ContentTaskPriority[] = ['low', 'medium', 'high'];
const ALLOWED_TRANSITIONS: Record<ContentProjectStatus, ContentProjectStatus[]> = {
  idea: ['production'],
  production: ['rights_review'],
  rights_review: ['sales_prep'],
  sales_prep: ['published'],
  published: ['updating', 'retired'],
  updating: ['published', 'retired'],
  retired: [],
};

export async function contentRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/content/projects', async () => listProjects(app.db));

  app.get<{ Params: IdParams }>('/api/content/projects/:id', async (req, reply) => {
    const id = routeId(req.params.id);
    if (id == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    const project = getProject(app.db, id);
    if (!project) {
      reply.code(404);
      return { error: 'not_found' };
    }
    return project;
  });

  app.post<{ Body: ProjectPayload }>('/api/content/projects', async (req, reply) => {
    try {
      const created = createProject(app.db, req.body ?? {});
      reply.code(201);
      return created;
    } catch (error) {
      reply.code(400);
      return invalidPayload(error);
    }
  });

  app.put<{ Body: ProjectPayload; Params: IdParams }>('/api/content/projects/:id', async (req, reply) => {
    const id = routeId(req.params.id);
    if (id == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    if (!getProject(app.db, id)) {
      reply.code(404);
      return { error: 'not_found' };
    }
    try {
      return updateProject(app.db, id, req.body ?? {});
    } catch (error) {
      reply.code(400);
      return invalidPayload(error);
    }
  });

  app.patch<{ Body: ProjectPayload; Params: IdParams }>('/api/content/projects/:id/status', async (req, reply) => {
    const id = routeId(req.params.id);
    if (id == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    if (!getProject(app.db, id)) {
      reply.code(404);
      return { error: 'not_found' };
    }
    try {
      return updateProject(app.db, id, { status: (req.body ?? {}).status });
    } catch (error) {
      reply.code(400);
      return invalidPayload(error);
    }
  });

  app.patch<{ Body: ProjectPayload; Params: IdParams }>('/api/content/projects/:id/rights', async (req, reply) => {
    const id = routeId(req.params.id);
    if (id == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    if (!getProject(app.db, id)) {
      reply.code(404);
      return { error: 'not_found' };
    }
    try {
      return updateProject(app.db, id, { rightsCheckStatus: (req.body ?? {}).rightsCheckStatus });
    } catch (error) {
      reply.code(400);
      return invalidPayload(error);
    }
  });

  app.delete<{ Params: IdParams }>('/api/content/projects/:id', async (req, reply) => {
    const id = routeId(req.params.id);
    if (id == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    const before = getProject(app.db, id);
    if (!before) {
      reply.code(404);
      return { error: 'not_found' };
    }
    app.db.transaction(() => {
      const tasks = listTasksForProject(app.db, id);
      writeAudit(app.db, { action: 'delete', entityType: PROJECT_ENTITY, entityId: id, before: { ...before, tasks } });
      app.db.prepare('DELETE FROM content_projects WHERE id = ?').run(id);
    })();
    reply.code(204);
    return undefined;
  });

  app.get<{ Params: IdParams }>('/api/content/projects/:id/tasks', async (req, reply) => {
    const id = routeId(req.params.id);
    if (id == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    if (!getProject(app.db, id)) {
      reply.code(404);
      return { error: 'not_found' };
    }
    return listTasksForProject(app.db, id);
  });

  app.post<{ Body: TaskPayload; Params: IdParams }>('/api/content/projects/:id/tasks', async (req, reply) => {
    const projectId = routeId(req.params.id);
    if (projectId == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    if (!getProject(app.db, projectId)) {
      reply.code(404);
      return { error: 'not_found' };
    }
    try {
      const created = createTask(app.db, { ...(req.body ?? {}), projectId });
      reply.code(201);
      return created;
    } catch (error) {
      reply.code(400);
      return invalidPayload(error);
    }
  });

  app.get<{ Params: IdParams }>('/api/content/tasks/:id', async (req, reply) => {
    const id = routeId(req.params.id);
    if (id == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    const task = getTask(app.db, id);
    if (!task) {
      reply.code(404);
      return { error: 'not_found' };
    }
    return task;
  });

  app.put<{ Body: TaskPayload; Params: IdParams }>('/api/content/tasks/:id', async (req, reply) => {
    const id = routeId(req.params.id);
    if (id == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    if (!getTask(app.db, id)) {
      reply.code(404);
      return { error: 'not_found' };
    }
    try {
      return updateTask(app.db, id, req.body ?? {});
    } catch (error) {
      reply.code(400);
      return invalidPayload(error);
    }
  });

  app.patch<{ Body: TaskPayload; Params: IdParams }>('/api/content/tasks/:id/status', async (req, reply) => {
    const id = routeId(req.params.id);
    if (id == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    if (!getTask(app.db, id)) {
      reply.code(404);
      return { error: 'not_found' };
    }
    try {
      return updateTask(app.db, id, { status: (req.body ?? {}).status });
    } catch (error) {
      reply.code(400);
      return invalidPayload(error);
    }
  });

  app.delete<{ Params: IdParams }>('/api/content/tasks/:id', async (req, reply) => {
    const id = routeId(req.params.id);
    if (id == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    const before = getTask(app.db, id);
    if (!before) {
      reply.code(404);
      return { error: 'not_found' };
    }
    app.db.transaction(() => {
      writeAudit(app.db, { action: 'delete', entityType: TASK_ENTITY, entityId: id, before });
      app.db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    })();
    reply.code(204);
    return undefined;
  });

  app.delete<{ Params: ProjectTaskParams }>('/api/content/projects/:id/tasks/:taskId', async (req, reply) => {
    const projectId = routeId(req.params.id);
    const taskId = routeId(req.params.taskId);
    if (projectId == null || taskId == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    const before = getTask(app.db, taskId);
    if (!before || before.projectId !== projectId) {
      reply.code(404);
      return { error: 'not_found' };
    }
    app.db.transaction(() => {
      writeAudit(app.db, { action: 'delete', entityType: TASK_ENTITY, entityId: taskId, before });
      app.db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
    })();
    reply.code(204);
    return undefined;
  });

  app.get<{ Params: IdParams }>('/api/content/projects/:id/pre-release-check', async (req, reply) => {
    const id = routeId(req.params.id);
    if (id == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    const result = preReleaseCheck(app.db, id);
    if (!result) {
      reply.code(404);
      return { error: 'not_found' };
    }
    return result;
  });
}

function listProjects(db: DB): ReturnType<typeof mapProject>[] {
  return db
    .prepare('SELECT * FROM content_projects ORDER BY planned_release_date IS NULL, planned_release_date ASC, id ASC')
    .all()
    .map((row) => mapProject(row as ContentProjectRow));
}

function getProject(db: DB, id: number): ReturnType<typeof mapProject> | null {
  const row = db.prepare('SELECT * FROM content_projects WHERE id = ?').get(id) as ContentProjectRow | undefined;
  return row ? mapProject(row) : null;
}

function getProjectOrThrow(db: DB, id: number): ReturnType<typeof mapProject> {
  const project = getProject(db, id);
  if (!project) throw new Error(`content project not found: ${id}`);
  return project;
}

function createProject(db: DB, body: ProjectPayload): ReturnType<typeof mapProject> {
  const payload = normalizeCreateProject(db, body);
  return db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO content_projects
          (title, status, planned_release_date, rights_check_status, product_id)
         VALUES
          (@title, @status, @plannedReleaseDate, @rightsCheckStatus, @productId)`,
      )
      .run(payload);
    const created = getProjectOrThrow(db, Number(result.lastInsertRowid));
    writeAudit(db, { action: 'create', entityType: PROJECT_ENTITY, entityId: created.id, after: created });
    return created;
  })();
}

function updateProject(db: DB, id: number, body: ProjectPayload): ReturnType<typeof mapProject> {
  const before = getProjectOrThrow(db, id);
  const update = normalizeUpdateProject(db, body);
  const next = { ...before, ...update };
  if (update.status !== undefined && before.status !== next.status) assertStatusTransition(before.status, next.status);
  return db.transaction(() => {
    db.prepare(
      `UPDATE content_projects SET
         title = @title,
         status = @status,
         planned_release_date = @plannedReleaseDate,
         rights_check_status = @rightsCheckStatus,
         product_id = @productId
       WHERE id = @id`,
    ).run({
      id,
      title: next.title,
      status: next.status,
      plannedReleaseDate: next.plannedReleaseDate,
      rightsCheckStatus: next.rightsCheckStatus,
      productId: next.productId,
    });
    const after = getProjectOrThrow(db, id);
    writeAudit(db, { action: 'update', entityType: PROJECT_ENTITY, entityId: id, before, after });
    return after;
  })();
}

function listTasksForProject(db: DB, projectId: number): ReturnType<typeof mapTask>[] {
  return db
    .prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY due_date IS NULL, due_date ASC, id ASC')
    .all(projectId)
    .map((row) => mapTask(row as ContentTaskRow));
}

function getTask(db: DB, id: number): ReturnType<typeof mapTask> | null {
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as ContentTaskRow | undefined;
  return row ? mapTask(row) : null;
}

function getTaskOrThrow(db: DB, id: number): ReturnType<typeof mapTask> {
  const task = getTask(db, id);
  if (!task) throw new Error(`content task not found: ${id}`);
  return task;
}

function createTask(db: DB, body: TaskPayload): ReturnType<typeof mapTask> {
  const payload = normalizeCreateTask(db, body);
  return db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO tasks
          (project_id, title, status, priority, due_date, checklist_ref)
         VALUES
          (@projectId, @title, @status, @priority, @dueDate, @checklistRef)`,
      )
      .run(payload);
    const created = getTaskOrThrow(db, Number(result.lastInsertRowid));
    writeAudit(db, { action: 'create', entityType: TASK_ENTITY, entityId: created.id, after: created });
    return created;
  })();
}

function updateTask(db: DB, id: number, body: TaskPayload): ReturnType<typeof mapTask> {
  const before = getTaskOrThrow(db, id);
  const next = { ...before, ...normalizeUpdateTask(db, body) };
  return db.transaction(() => {
    db.prepare(
      `UPDATE tasks SET
         project_id = @projectId,
         title = @title,
         status = @status,
         priority = @priority,
         due_date = @dueDate,
         checklist_ref = @checklistRef
       WHERE id = @id`,
    ).run({
      id,
      projectId: next.projectId,
      title: next.title,
      status: next.status,
      priority: next.priority,
      dueDate: next.dueDate,
      checklistRef: next.checklistRef,
    });
    const after = getTaskOrThrow(db, id);
    writeAudit(db, { action: 'update', entityType: TASK_ENTITY, entityId: id, before, after });
    return after;
  })();
}

function preReleaseCheck(
  db: DB,
  projectId: number,
): { projectId: number; ready: boolean; blockers: Array<Record<string, unknown>> } | null {
  const project = getProject(db, projectId);
  if (!project) return null;
  const blockers: Array<Record<string, unknown>> = [];

  if (project.rightsCheckStatus !== '確認済') {
    blockers.push({
      type: 'rights_unconfirmed',
      message: '権利確認が完了していません。',
      rightsCheckStatus: project.rightsCheckStatus,
    });
  }

  if (project.productId != null) {
    const product = getProduct(db, project.productId);
    if (product) {
      const completeness = checkProductCompleteness(product, listPlansForProduct(db, product.id));
      if (!completeness.complete) {
        blockers.push({
          type: 'product_incomplete',
          message: '紐付く商品の掲載項目に不足があります。',
          productId: product.id,
          warnings: completeness.warnings,
        });
      }
    }
  }

  const incompleteTasks = listTasksForProject(db, projectId).filter((task) => task.status !== 'done');
  if (incompleteTasks.length > 0) {
    blockers.push({ type: 'task_incomplete', message: '未完了タスクがあります。', tasks: incompleteTasks });
  }

  const result = { projectId, ready: blockers.length === 0, blockers };
  writeAudit(db, { action: 'pre_release_check', entityType: PROJECT_ENTITY, entityId: projectId, after: result });
  return result;
}

function normalizeCreateProject(db: DB, body: ProjectPayload): Record<string, string | number | null> {
  const productId = nullablePositiveInteger(body.productId, 'productId');
  ensureProductExists(db, productId);
  return {
    title: requireText(body.title, 'title'),
    status: body.status == null ? 'idea' : requireProjectStatus(body.status),
    plannedReleaseDate: nullableText(body.plannedReleaseDate, 'plannedReleaseDate'),
    rightsCheckStatus: body.rightsCheckStatus == null ? '未確認' : requireRightsStatus(body.rightsCheckStatus),
    productId,
  };
}

function normalizeUpdateProject(db: DB, body: ProjectPayload): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  if (body.title !== undefined) out.title = requireText(body.title, 'title');
  if (body.status !== undefined) out.status = requireProjectStatus(body.status);
  if (body.plannedReleaseDate !== undefined) {
    out.plannedReleaseDate = nullableText(body.plannedReleaseDate, 'plannedReleaseDate');
  }
  if (body.rightsCheckStatus !== undefined) out.rightsCheckStatus = requireRightsStatus(body.rightsCheckStatus);
  if (body.productId !== undefined) {
    out.productId = nullablePositiveInteger(body.productId, 'productId');
    ensureProductExists(db, out.productId);
  }
  return out;
}

function normalizeCreateTask(db: DB, body: TaskPayload): Record<string, string | number | null> {
  const projectId = requirePositiveInteger(body.projectId, 'projectId');
  ensureProjectExists(db, projectId);
  return {
    projectId,
    title: requireText(body.title, 'title'),
    status: body.status == null ? 'todo' : requireTaskStatus(body.status),
    priority: body.priority == null ? 'medium' : requireTaskPriority(body.priority),
    dueDate: nullableText(body.dueDate, 'dueDate'),
    checklistRef: nullableText(body.checklistRef, 'checklistRef'),
  };
}

function normalizeUpdateTask(db: DB, body: TaskPayload): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  if (body.projectId !== undefined) {
    out.projectId = requirePositiveInteger(body.projectId, 'projectId');
    ensureProjectExists(db, out.projectId);
  }
  if (body.title !== undefined) out.title = requireText(body.title, 'title');
  if (body.status !== undefined) out.status = requireTaskStatus(body.status);
  if (body.priority !== undefined) out.priority = requireTaskPriority(body.priority);
  if (body.dueDate !== undefined) out.dueDate = nullableText(body.dueDate, 'dueDate');
  if (body.checklistRef !== undefined) out.checklistRef = nullableText(body.checklistRef, 'checklistRef');
  return out;
}

function checkProductCompleteness(
  product: ReturnType<typeof mapProduct>,
  plans: ReturnType<typeof mapPlan>[],
): { complete: boolean; warnings: Array<{ field: string; message: string; sourceIds: string[]; reason: string }> } {
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

function getProduct(db: DB, id: number): ReturnType<typeof mapProduct> | null {
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as ProductRow | undefined;
  return row ? mapProduct(row) : null;
}

function listPlansForProduct(db: DB, productId: number): ReturnType<typeof mapPlan>[] {
  return db
    .prepare('SELECT * FROM subscription_plans WHERE product_id = ? ORDER BY id ASC')
    .all(productId)
    .map((row) => mapPlan(row as SubscriptionPlanRow));
}

function ensureProductExists(db: DB, productId: number | null): void {
  if (productId == null) return;
  if (!getProduct(db, productId)) throw new Error(`product not found: ${productId}`);
}

function ensureProjectExists(db: DB, projectId: number): void {
  if (!getProject(db, projectId)) throw new Error(`content project not found: ${projectId}`);
}

function assertStatusTransition(from: ContentProjectStatus, to: ContentProjectStatus): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new Error(`invalid content project status transition: ${from} -> ${to}`);
  }
}

function routeId(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function requireProjectStatus(value: unknown): ContentProjectStatus {
  if (typeof value !== 'string' || !PROJECT_STATUSES.includes(value as ContentProjectStatus)) {
    throw new Error('status is invalid');
  }
  return value as ContentProjectStatus;
}

function requireRightsStatus(value: unknown): RightsCheckStatus {
  if (typeof value !== 'string' || !RIGHTS_STATUSES.includes(value as RightsCheckStatus)) {
    throw new Error('rightsCheckStatus is invalid');
  }
  return value as RightsCheckStatus;
}

function requireTaskStatus(value: unknown): ContentTaskStatus {
  if (typeof value !== 'string' || !TASK_STATUSES.includes(value as ContentTaskStatus)) {
    throw new Error('status is invalid');
  }
  return value as ContentTaskStatus;
}

function requireTaskPriority(value: unknown): ContentTaskPriority {
  if (typeof value !== 'string' || !TASK_PRIORITIES.includes(value as ContentTaskPriority)) {
    throw new Error('priority is invalid');
  }
  return value as ContentTaskPriority;
}

function requirePositiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return value;
}

function nullablePositiveInteger(value: unknown, field: string): number | null {
  if (value == null) return null;
  return requirePositiveInteger(value, field);
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
  return { error: 'invalid_payload', message: error instanceof Error ? error.message : String(error) };
}

function mapProject(row: ContentProjectRow) {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    plannedReleaseDate: row.planned_release_date,
    rightsCheckStatus: row.rights_check_status,
    productId: row.product_id,
    createdAt: row.created_at,
  };
}

function mapTask(row: ContentTaskRow) {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    dueDate: row.due_date,
    checklistRef: row.checklist_ref,
  };
}

function mapProduct(row: ProductRow) {
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

function mapPlan(row: SubscriptionPlanRow) {
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
