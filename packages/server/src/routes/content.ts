import type { FastifyInstance } from 'fastify';
import {
  listContentProjects,
  getContentProject,
  createContentProject,
  updateContentProject,
  transitionContentProjectStatus,
  updateRightsCheckStatus,
  deleteContentProject,
  listContentTasksForProject,
  getContentTask,
  createContentTask,
  updateContentTask,
  updateContentTaskStatus,
  deleteContentTask,
  preReleaseCheck,
  type CreateContentProjectInput,
  type UpdateContentProjectInput,
  type CreateContentTaskInput,
  type UpdateContentTaskInput,
  type ContentProjectStatus,
  type RightsCheckStatus,
  type ContentTaskStatus,
} from '@free-worker/core';

interface IdParams {
  id: string;
}

interface ProjectTaskParams {
  id: string;
  taskId: string;
}

export async function contentRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/content/projects', async () => listContentProjects(app.db));

  app.get<{ Params: IdParams }>('/api/content/projects/:id', async (req, reply) => {
    const id = routeId(req.params.id);
    if (id == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    const project = getContentProject(app.db, id);
    if (!project) {
      reply.code(404);
      return { error: 'not_found' };
    }
    return project;
  });

  app.post<{ Body: unknown }>('/api/content/projects', async (req, reply) => {
    try {
      const created = createContentProject(app.db, req.body as CreateContentProjectInput);
      reply.code(201);
      return created;
    } catch (error) {
      reply.code(400);
      return invalidPayload(error);
    }
  });

  app.put<{ Body: unknown; Params: IdParams }>('/api/content/projects/:id', async (req, reply) => {
    const id = routeId(req.params.id);
    if (id == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    if (!getContentProject(app.db, id)) {
      reply.code(404);
      return { error: 'not_found' };
    }
    try {
      return updateContentProject(app.db, id, req.body as UpdateContentProjectInput);
    } catch (error) {
      reply.code(400);
      return invalidPayload(error);
    }
  });

  app.patch<{ Body: unknown; Params: IdParams }>('/api/content/projects/:id/status', async (req, reply) => {
    const id = routeId(req.params.id);
    if (id == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    if (!getContentProject(app.db, id)) {
      reply.code(404);
      return { error: 'not_found' };
    }
    try {
      const body = req.body as { status?: ContentProjectStatus };
      return transitionContentProjectStatus(app.db, id, body.status as ContentProjectStatus);
    } catch (error) {
      reply.code(400);
      return invalidPayload(error);
    }
  });

  app.patch<{ Body: unknown; Params: IdParams }>('/api/content/projects/:id/rights', async (req, reply) => {
    const id = routeId(req.params.id);
    if (id == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    if (!getContentProject(app.db, id)) {
      reply.code(404);
      return { error: 'not_found' };
    }
    try {
      const body = req.body as { rightsCheckStatus?: RightsCheckStatus };
      return updateRightsCheckStatus(app.db, id, body.rightsCheckStatus as RightsCheckStatus);
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
    const deleted = deleteContentProject(app.db, id);
    if (!deleted) {
      reply.code(404);
      return { error: 'not_found' };
    }
    reply.code(204);
    return undefined;
  });

  app.get<{ Params: IdParams }>('/api/content/projects/:id/tasks', async (req, reply) => {
    const id = routeId(req.params.id);
    if (id == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    if (!getContentProject(app.db, id)) {
      reply.code(404);
      return { error: 'not_found' };
    }
    return listContentTasksForProject(app.db, id);
  });

  app.post<{ Body: unknown; Params: IdParams }>('/api/content/projects/:id/tasks', async (req, reply) => {
    const projectId = routeId(req.params.id);
    if (projectId == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    if (!getContentProject(app.db, projectId)) {
      reply.code(404);
      return { error: 'not_found' };
    }
    try {
      const body = (req.body ?? {}) as unknown as CreateContentTaskInput;
      const created = createContentTask(app.db, { ...body, projectId });
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
    const task = getContentTask(app.db, id);
    if (!task) {
      reply.code(404);
      return { error: 'not_found' };
    }
    return task;
  });

  app.put<{ Body: unknown; Params: IdParams }>('/api/content/tasks/:id', async (req, reply) => {
    const id = routeId(req.params.id);
    if (id == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    if (!getContentTask(app.db, id)) {
      reply.code(404);
      return { error: 'not_found' };
    }
    try {
      return updateContentTask(app.db, id, req.body as UpdateContentTaskInput);
    } catch (error) {
      reply.code(400);
      return invalidPayload(error);
    }
  });

  app.patch<{ Body: unknown; Params: IdParams }>('/api/content/tasks/:id/status', async (req, reply) => {
    const id = routeId(req.params.id);
    if (id == null) {
      reply.code(400);
      return { error: 'invalid_id' };
    }
    if (!getContentTask(app.db, id)) {
      reply.code(404);
      return { error: 'not_found' };
    }
    try {
      const body = req.body as { status?: ContentTaskStatus };
      return updateContentTaskStatus(app.db, id, body.status as ContentTaskStatus);
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
    const deleted = deleteContentTask(app.db, id);
    if (!deleted) {
      reply.code(404);
      return { error: 'not_found' };
    }
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
    const task = getContentTask(app.db, taskId);
    if (!task || task.projectId !== projectId) {
      reply.code(404);
      return { error: 'not_found' };
    }
    deleteContentTask(app.db, taskId);
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

function routeId(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function invalidPayload(error: unknown): { error: string; message: string } {
  return { error: 'invalid_payload', message: error instanceof Error ? error.message : String(error) };
}
