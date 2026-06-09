/**
 * AI補助アダプタ(配線のみ)。
 *
 * 重要: AIは「任意機能」。既定で無効。未接続・無効でもアプリの全機能が動くこと。
 * クラウドLLMは使わない。例外的に許可されるのは Gemini Flash の無料枠のみ。
 * ローカルLLM(Ollama / LM Studio)はローカル接続なので可。
 *
 * このファイルはインターフェースと無効時の既定実装(NoopAdapter)を提供する。
 * 実プロバイダ実装(ローカルHTTP呼び出し)は providers/ 配下に後付けする。
 */

export type AiProvider = 'none' | 'ollama' | 'lmstudio' | 'gemini_flash';

export interface AiConfig {
  enabled: boolean;
  provider: AiProvider;
  /** ローカルエンドポイント(例 http://127.0.0.1:11434)。gemini_flash 時は未使用。 */
  endpoint?: string;
  model?: string;
  /** gemini_flash 用。ローカル保管。空なら gemini は使えない。 */
  apiKey?: string;
}

export const DEFAULT_AI_CONFIG: AiConfig = {
  enabled: false,
  provider: 'none',
};

export interface AiRequest {
  system?: string;
  prompt: string;
  maxTokens?: number;
}

export interface AiResult {
  text: string;
  provider: AiProvider;
}

export interface AiAdapter {
  readonly provider: AiProvider;
  readonly enabled: boolean;
  /** 任意のテキスト生成(要約・下書き補助など)。無効時は AiDisabledError。 */
  complete(req: AiRequest): Promise<AiResult>;
}

export class AiDisabledError extends Error {
  constructor() {
    super('AI補助は無効です(設定でローカルLLM/Gemini Flashを有効化してください)。AIなしでも全機能は利用できます。');
    this.name = 'AiDisabledError';
  }
}

/** 無効時の既定アダプタ。常に AiDisabledError を投げる。 */
export class NoopAdapter implements AiAdapter {
  readonly provider: AiProvider = 'none';
  readonly enabled = false;
  async complete(): Promise<AiResult> {
    throw new AiDisabledError();
  }
}

/**
 * 設定からアダプタを生成する。現状は配線のみ(無効=NoopAdapter)。
 * 実プロバイダは未実装のため、enabled でも未対応プロバイダは Noop にフォールバックする。
 */
export function createAdapter(config: AiConfig): AiAdapter {
  if (!config.enabled || config.provider === 'none') {
    return new NoopAdapter();
  }
  // TODO(providers): ollama / lmstudio / gemini_flash の実装を providers/ に追加し、
  // ここで分岐して返す。実装するまでは無効と同等(全機能はAIなしで動く)。
  return new NoopAdapter();
}
