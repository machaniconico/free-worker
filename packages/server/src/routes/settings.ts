import type { FastifyInstance } from 'fastify';
import { getAiConfig, setAiConfig, type AiConfig, type AiProvider } from '@free-worker/core';

const VALID_PROVIDERS: AiProvider[] = ['none', 'ollama', 'lmstudio', 'gemini_flash'];

/** AI補助設定の取得/更新。既定は無効。ここでクラウドへ送信は行わない(設定保存のみ)。 */
export async function registerSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ai', async () => {
    return getAiConfig(app.db);
  });

  app.put('/ai', async (req, reply) => {
    const body = (req.body ?? {}) as Partial<AiConfig>;
    if (body.provider !== undefined && !VALID_PROVIDERS.includes(body.provider)) {
      reply.code(400);
      return { error: 'invalid_provider', allowed: VALID_PROVIDERS };
    }
    const current = getAiConfig(app.db);
    const next: AiConfig = {
      enabled: body.enabled ?? current.enabled,
      provider: body.provider ?? current.provider,
      ...(body.endpoint !== undefined ? { endpoint: body.endpoint } : current.endpoint ? { endpoint: current.endpoint } : {}),
      ...(body.model !== undefined ? { model: body.model } : current.model ? { model: current.model } : {}),
      ...(body.apiKey !== undefined ? { apiKey: body.apiKey } : current.apiKey ? { apiKey: current.apiKey } : {}),
    };
    setAiConfig(app.db, next);
    return next;
  });
}
