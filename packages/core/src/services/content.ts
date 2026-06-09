import { writeAudit } from '../audit.js';
import type { DB } from '../db/connection.js';
import {
  checkProductCompleteness,
  getProduct,
  listSubscriptionPlansForProduct,
  type ProductCompletenessWarning,
} from './products.js';

export type ContentProjectStatus =
  | 'idea'
  | 'production'
  | 'rights_review'
  | 'sales_prep'
  | 'published'
  | 'updating'
  | 'retired';
export type RightsCheckStatus = '未確認' | '確認中' | '確認済';
export type ContentTaskStatus = 'todo' | 'doing' | 'done' | 'blocked';
export type ContentTaskPriority = 'low' | 'medium' | 'high';

export interface ContentProject {
  id: number;
  title: string;
  status: ContentProjectStatus;
  plannedReleaseDate: string | null;
  rightsCheckStatus: RightsCheckStatus;
  productId: number | null;
  createdAt: string;
}

export interface ContentTask {
  id: number;
  projectId: number;
  title: string;
  status: ContentTaskStatus;
  priority: ContentTaskPriority;
  dueDate: string | null;
  checklistRef: string | null;
}

export interface CreateContentProjectInput {
  title: string;
  status?: ContentProjectStatus | null;
  plannedReleaseDate?: string | null;
  rightsCheckStatus?: RightsCheckStatus | null;
  productId?: number | null;
}

export type UpdateContentProjectInput = Partial<CreateContentProjectInput>;

export interface CreateContentTaskInput {
  projectId: number;
  title: string;
  status?: ContentTaskStatus | null;
  priority?: ContentTaskPriority | null;
  dueDate?: string | null;
  checklistRef?: string | null;
}

export type UpdateContentTaskInput = Partial<CreateContentTaskInput>;

export type PreReleaseBlocker =
  | {
      type: 'rights_unconfirmed';
      message: string;
      rightsCheckStatus: RightsCheckStatus;
    }
  | {
      type: 'product_incomplete';
      message: string;
      productId: number;
      warnings: ProductCompletenessWarning[];
    }
  | {
      type: 'task_incomplete';
      message: string;
      tasks: ContentTask[];
    };

export interface PreReleaseCheckResult {
  projectId: number;
  ready: boolean;
  blockers: PreReleaseBlocker[];
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

export function listContentProjects(db: DB): ContentProject[] {
  return db
    .prepare('SELECT * FROM content_projects ORDER BY planned_release_date IS NULL, planned_release_date ASC, id ASC')
    .all()
    .map((row) => mapProject(row as ContentProjectRow));
}

export function getContentProject(db: DB, id: number): ContentProject | null {
  const row = db.prepare('SELECT * FROM content_projects WHERE id = ?').get(id) as ContentProjectRow | undefined;
  return row ? mapProject(row) : null;
}

export function createContentProject(
  db: DB,
  input: CreateContentProjectInput,
  actor = 'local_user',
): ContentProject {
  const payload = normalizeCreateProject(db, input);
  const run = db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO content_projects
          (title, status, planned_release_date, rights_check_status, product_id)
         VALUES
          (@title, @status, @plannedReleaseDate, @rightsCheckStatus, @productId)`,
      )
      .run(payload);
    const created = getContentProjectOrThrow(db, Number(result.lastInsertRowid));
    writeAudit(db, { actor, action: 'create', entityType: PROJECT_ENTITY, entityId: created.id, after: created });
    return created;
  });
  return run();
}

export function updateContentProject(
  db: DB,
  id: number,
  input: UpdateContentProjectInput,
  actor = 'local_user',
): ContentProject | null {
  const before = getContentProject(db, id);
  if (!before) return null;
  const update = normalizeUpdateProject(db, input);
  const next = { ...before, ...update };
  if (update.status !== undefined && before.status !== next.status) {
    assertStatusTransition(before.status, next.status);
  }

  const run = db.transaction(() => {
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
    const after = getContentProjectOrThrow(db, id);
    writeAudit(db, { actor, action: 'update', entityType: PROJECT_ENTITY, entityId: id, before, after });
    return after;
  });
  return run();
}

export function transitionContentProjectStatus(
  db: DB,
  id: number,
  status: ContentProjectStatus,
  actor = 'local_user',
): ContentProject | null {
  return updateContentProject(db, id, { status }, actor);
}

export function updateRightsCheckStatus(
  db: DB,
  id: number,
  rightsCheckStatus: RightsCheckStatus,
  actor = 'local_user',
): ContentProject | null {
  return updateContentProject(db, id, { rightsCheckStatus }, actor);
}

export function deleteContentProject(db: DB, id: number, actor = 'local_user'): boolean {
  const before = getContentProject(db, id);
  if (!before) return false;

  const run = db.transaction(() => {
    const tasks = listContentTasksForProject(db, id);
    writeAudit(db, { actor, action: 'delete', entityType: PROJECT_ENTITY, entityId: id, before: { ...before, tasks } });
    db.prepare('DELETE FROM content_projects WHERE id = ?').run(id);
  });
  run();
  return true;
}

export function listContentTasks(db: DB): ContentTask[] {
  return db
    .prepare('SELECT * FROM tasks ORDER BY project_id ASC, due_date IS NULL, due_date ASC, id ASC')
    .all()
    .map((row) => mapTask(row as ContentTaskRow));
}

export function listContentTasksForProject(db: DB, projectId: number): ContentTask[] {
  return db
    .prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY due_date IS NULL, due_date ASC, id ASC')
    .all(projectId)
    .map((row) => mapTask(row as ContentTaskRow));
}

export function getContentTask(db: DB, id: number): ContentTask | null {
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as ContentTaskRow | undefined;
  return row ? mapTask(row) : null;
}

export function createContentTask(db: DB, input: CreateContentTaskInput, actor = 'local_user'): ContentTask {
  const payload = normalizeCreateTask(db, input);
  const run = db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO tasks
          (project_id, title, status, priority, due_date, checklist_ref)
         VALUES
          (@projectId, @title, @status, @priority, @dueDate, @checklistRef)`,
      )
      .run(payload);
    const created = getContentTaskOrThrow(db, Number(result.lastInsertRowid));
    writeAudit(db, { actor, action: 'create', entityType: TASK_ENTITY, entityId: created.id, after: created });
    return created;
  });
  return run();
}

export function updateContentTask(
  db: DB,
  id: number,
  input: UpdateContentTaskInput,
  actor = 'local_user',
): ContentTask | null {
  const before = getContentTask(db, id);
  if (!before) return null;
  const next = { ...before, ...normalizeUpdateTask(db, input) };

  const run = db.transaction(() => {
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
    const after = getContentTaskOrThrow(db, id);
    writeAudit(db, { actor, action: 'update', entityType: TASK_ENTITY, entityId: id, before, after });
    return after;
  });
  return run();
}

export function updateContentTaskStatus(
  db: DB,
  id: number,
  status: ContentTaskStatus,
  actor = 'local_user',
): ContentTask | null {
  return updateContentTask(db, id, { status }, actor);
}

export function deleteContentTask(db: DB, id: number, actor = 'local_user'): boolean {
  const before = getContentTask(db, id);
  if (!before) return false;

  const run = db.transaction(() => {
    writeAudit(db, { actor, action: 'delete', entityType: TASK_ENTITY, entityId: id, before });
    db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  });
  run();
  return true;
}

export function preReleaseCheck(db: DB, projectId: number, actor = 'local_user'): PreReleaseCheckResult | null {
  const project = getContentProject(db, projectId);
  if (!project) return null;

  const blockers: PreReleaseBlocker[] = [];
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
      const completeness = checkProductCompleteness(product, listSubscriptionPlansForProduct(db, product.id));
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

  const incompleteTasks = listContentTasksForProject(db, projectId).filter((task) => task.status !== 'done');
  if (incompleteTasks.length > 0) {
    blockers.push({
      type: 'task_incomplete',
      message: '未完了タスクがあります。',
      tasks: incompleteTasks,
    });
  }

  const result = { projectId, ready: blockers.length === 0, blockers };
  writeAudit(db, { actor, action: 'pre_release_check', entityType: PROJECT_ENTITY, entityId: projectId, after: result });
  return result;
}

function getContentProjectOrThrow(db: DB, id: number): ContentProject {
  const project = getContentProject(db, id);
  if (!project) throw new Error(`content project not found: ${id}`);
  return project;
}

function getContentTaskOrThrow(db: DB, id: number): ContentTask {
  const task = getContentTask(db, id);
  if (!task) throw new Error(`content task not found: ${id}`);
  return task;
}

function normalizeCreateProject(
  db: DB,
  input: CreateContentProjectInput,
): Omit<ContentProject, 'id' | 'createdAt'> {
  const productId = nullablePositiveInteger(input.productId, 'productId');
  ensureProductExists(db, productId);
  return {
    title: requireText(input.title, 'title'),
    status: input.status == null ? 'idea' : requireProjectStatus(input.status),
    plannedReleaseDate: nullableText(input.plannedReleaseDate),
    rightsCheckStatus: input.rightsCheckStatus == null ? '未確認' : requireRightsStatus(input.rightsCheckStatus),
    productId,
  };
}

function normalizeUpdateProject(db: DB, input: UpdateContentProjectInput): Partial<Omit<ContentProject, 'id' | 'createdAt'>> {
  const out: Partial<Omit<ContentProject, 'id' | 'createdAt'>> = {};
  if (input.title !== undefined) out.title = requireText(input.title, 'title');
  if (input.status !== undefined && input.status !== null) out.status = requireProjectStatus(input.status);
  if (input.plannedReleaseDate !== undefined) out.plannedReleaseDate = nullableText(input.plannedReleaseDate);
  if (input.rightsCheckStatus !== undefined && input.rightsCheckStatus !== null) {
    out.rightsCheckStatus = requireRightsStatus(input.rightsCheckStatus);
  }
  if (input.productId !== undefined) {
    out.productId = nullablePositiveInteger(input.productId, 'productId');
    ensureProductExists(db, out.productId);
  }
  return out;
}

function normalizeCreateTask(db: DB, input: CreateContentTaskInput): Omit<ContentTask, 'id'> {
  const projectId = requirePositiveInteger(input.projectId, 'projectId');
  ensureProjectExists(db, projectId);
  return {
    projectId,
    title: requireText(input.title, 'title'),
    status: input.status == null ? 'todo' : requireTaskStatus(input.status),
    priority: input.priority == null ? 'medium' : requireTaskPriority(input.priority),
    dueDate: nullableText(input.dueDate),
    checklistRef: nullableText(input.checklistRef),
  };
}

function normalizeUpdateTask(db: DB, input: UpdateContentTaskInput): Partial<Omit<ContentTask, 'id'>> {
  const out: Partial<Omit<ContentTask, 'id'>> = {};
  if (input.projectId !== undefined) {
    out.projectId = requirePositiveInteger(input.projectId, 'projectId');
    ensureProjectExists(db, out.projectId);
  }
  if (input.title !== undefined) out.title = requireText(input.title, 'title');
  if (input.status !== undefined && input.status !== null) out.status = requireTaskStatus(input.status);
  if (input.priority !== undefined && input.priority !== null) out.priority = requireTaskPriority(input.priority);
  if (input.dueDate !== undefined) out.dueDate = nullableText(input.dueDate);
  if (input.checklistRef !== undefined) out.checklistRef = nullableText(input.checklistRef);
  return out;
}

function ensureProductExists(db: DB, productId: number | null): void {
  if (productId == null) return;
  if (!getProduct(db, productId)) throw new Error(`product not found: ${productId}`);
}

function ensureProjectExists(db: DB, projectId: number): void {
  if (!getContentProject(db, projectId)) throw new Error(`content project not found: ${projectId}`);
}

function assertStatusTransition(from: ContentProjectStatus, to: ContentProjectStatus): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new Error(`invalid content project status transition: ${from} -> ${to}`);
  }
}

function requireProjectStatus(value: ContentProjectStatus): ContentProjectStatus {
  if (!PROJECT_STATUSES.includes(value)) throw new Error('status is invalid');
  return value;
}

function requireRightsStatus(value: RightsCheckStatus): RightsCheckStatus {
  if (!RIGHTS_STATUSES.includes(value)) throw new Error('rightsCheckStatus is invalid');
  return value;
}

function requireTaskStatus(value: ContentTaskStatus): ContentTaskStatus {
  if (!TASK_STATUSES.includes(value)) throw new Error('status is invalid');
  return value;
}

function requireTaskPriority(value: ContentTaskPriority): ContentTaskPriority {
  if (!TASK_PRIORITIES.includes(value)) throw new Error('priority is invalid');
  return value;
}

function requirePositiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${field} must be a positive integer`);
  return value;
}

function nullablePositiveInteger(value: number | null | undefined, field: string): number | null {
  if (value == null) return null;
  return requirePositiveInteger(value, field);
}

function requireText(value: string | null | undefined, field: string): string {
  const text = nullableText(value);
  if (!text) throw new Error(`${field} is required`);
  return text;
}

function nullableText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const text = value.trim();
  return text.length > 0 ? text : null;
}

function mapProject(row: ContentProjectRow): ContentProject {
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

function mapTask(row: ContentTaskRow): ContentTask {
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
