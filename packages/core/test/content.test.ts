import { describe, expect, it } from 'vitest';
import { bootstrap } from '../src/db/bootstrap.js';
import {
  createContentProject,
  createContentTask,
  deleteContentProject,
  deleteContentTask,
  getContentProject,
  getContentTask,
  listContentProjects,
  listContentTasksForProject,
  preReleaseCheck,
  transitionContentProjectStatus,
  updateContentProject,
  updateContentTask,
  updateContentTaskStatus,
  updateRightsCheckStatus,
} from '../src/services/content.js';
import { createProduct, createSubscriptionPlan } from '../src/services/products.js';

describe('content service', () => {
  it('creates, updates, transitions, and deletes content projects with audit logs', () => {
    const db = bootstrap({ filename: ':memory:' });
    const project = createContentProject(db, {
      title: '確定申告テンプレート制作',
      plannedReleaseDate: '2026-08-01',
    });

    expect(project).toMatchObject({
      id: expect.any(Number),
      title: '確定申告テンプレート制作',
      status: 'idea',
      rightsCheckStatus: '未確認',
      plannedReleaseDate: '2026-08-01',
    });
    expect(listContentProjects(db)).toHaveLength(1);
    expect(getContentProject(db, project.id)?.title).toBe('確定申告テンプレート制作');

    const renamed = updateContentProject(db, project.id, { title: '確定申告テンプレート制作 v2' });
    expect(renamed).toMatchObject({ id: project.id, title: '確定申告テンプレート制作 v2' });

    expect(transitionContentProjectStatus(db, project.id, 'production')).toMatchObject({ status: 'production' });
    expect(transitionContentProjectStatus(db, project.id, 'rights_review')).toMatchObject({ status: 'rights_review' });
    expect(transitionContentProjectStatus(db, project.id, 'sales_prep')).toMatchObject({ status: 'sales_prep' });
    expect(transitionContentProjectStatus(db, project.id, 'published')).toMatchObject({ status: 'published' });
    expect(() => transitionContentProjectStatus(db, project.id, 'sales_prep')).toThrow(/invalid content project status/);

    expect(updateRightsCheckStatus(db, project.id, '確認済')).toMatchObject({ rightsCheckStatus: '確認済' });
    expect(deleteContentProject(db, project.id)).toBe(true);
    expect(getContentProject(db, project.id)).toBeNull();

    const actions = db
      .prepare('SELECT action FROM audit_logs WHERE entity_type = ? ORDER BY id ASC')
      .all('content_project')
      .map((row) => (row as { action: string }).action);
    expect(actions).toEqual(['create', 'update', 'update', 'update', 'update', 'update', 'update', 'delete']);
    db.close();
  });

  it('creates, updates, changes status, and deletes content tasks with audit logs', () => {
    const db = bootstrap({ filename: ':memory:' });
    const project = createContentProject(db, { title: '講座制作' });
    const task = createContentTask(db, {
      projectId: project.id,
      title: '台本を作る',
      priority: 'high',
      dueDate: '2026-07-15',
      checklistRef: 'rights.music',
    });

    expect(task).toMatchObject({
      id: expect.any(Number),
      projectId: project.id,
      title: '台本を作る',
      status: 'todo',
      priority: 'high',
      checklistRef: 'rights.music',
    });
    expect(listContentTasksForProject(db, project.id)).toHaveLength(1);
    expect(getContentTask(db, task.id)?.title).toBe('台本を作る');

    expect(updateContentTask(db, task.id, { title: '台本を完成させる', priority: 'medium' })).toMatchObject({
      title: '台本を完成させる',
      priority: 'medium',
    });
    expect(updateContentTaskStatus(db, task.id, 'done')).toMatchObject({ status: 'done' });
    expect(deleteContentTask(db, task.id)).toBe(true);
    expect(getContentTask(db, task.id)).toBeNull();

    const actions = db
      .prepare('SELECT action FROM audit_logs WHERE entity_type = ? ORDER BY id ASC')
      .all('content_task')
      .map((row) => (row as { action: string }).action);
    expect(actions).toEqual(['create', 'update', 'update', 'delete']);
    db.close();
  });

  it('preReleaseCheck returns blockers for rights, linked product completeness, and incomplete tasks', () => {
    const db = bootstrap({ filename: ':memory:' });
    const product = createProduct(db, {
      sku: 'CONTENT-WARN-001',
      title: '不足商品',
      productType: 'membership',
      priceTaxIncluded: 1500,
    });
    const project = createContentProject(db, {
      title: '未完了プロジェクト',
      status: 'idea',
      rightsCheckStatus: '確認中',
      productId: product.id,
    });
    createContentTask(db, { projectId: project.id, title: '権利元に確認する', status: 'doing' });

    const result = preReleaseCheck(db, project.id);

    expect(result).toMatchObject({ projectId: project.id, ready: false });
    expect(result?.blockers.map((blocker) => blocker.type)).toEqual([
      'rights_unconfirmed',
      'product_incomplete',
      'task_incomplete',
    ]);
    const productBlocker = result?.blockers.find((blocker) => blocker.type === 'product_incomplete');
    expect(productBlocker && productBlocker.type === 'product_incomplete' ? productBlocker.warnings.map((w) => w.field) : []).toEqual([
      'operatingEnvironment',
      'licenseSummary',
      'refundPolicy',
      'subscriptionPlans',
    ]);

    const audit = db
      .prepare('SELECT action, after_json FROM audit_logs WHERE entity_type = ? ORDER BY id DESC LIMIT 1')
      .get('content_project') as { action: string; after_json: string };
    expect(audit.action).toBe('pre_release_check');
    expect(JSON.parse(audit.after_json)).toMatchObject({ ready: false });
    db.close();
  });

  it('preReleaseCheck is ready when rights, product fields, and tasks are complete', () => {
    const db = bootstrap({ filename: ':memory:' });
    const product = createProduct(db, {
      sku: 'CONTENT-OK-001',
      title: '完成商品',
      productType: 'membership',
      priceTaxIncluded: 3000,
      licenseSummary: '1契約1名まで利用可能',
      operatingEnvironment: 'Chrome最新版',
      refundPolicy: '提供後の返金不可',
    });
    createSubscriptionPlan(db, {
      productId: product.id,
      planName: '月額',
      billingPeriod: 'monthly',
      renewalPolicy: '毎月1日に税込3,000円で自動更新',
      cancellationPolicy: '更新日前日までに解約',
      postCancelAccessPolicy: '解約月末まで閲覧可能',
    });
    const project = createContentProject(db, {
      title: '完成プロジェクト',
      rightsCheckStatus: '確認済',
      productId: product.id,
    });
    createContentTask(db, { projectId: project.id, title: '最終確認', status: 'done' });

    expect(preReleaseCheck(db, project.id)).toEqual({ projectId: project.id, ready: true, blockers: [] });
    db.close();
  });
});
