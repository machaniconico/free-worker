/** ローカルサーバ(同一オリジン)へのAPIクライアント。外部へは出ない。 */

export interface ApiError {
  error: string;
  [k: string]: unknown;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw Object.assign(new Error(`API ${method} ${path} failed: ${res.status}`), { data });
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};

export interface Health {
  status: string;
  offline: boolean;
  migrations: number;
  now: string;
}

export interface AiConfig {
  enabled: boolean;
  provider: 'none' | 'ollama' | 'lmstudio' | 'gemini_flash';
  endpoint?: string;
  model?: string;
}
