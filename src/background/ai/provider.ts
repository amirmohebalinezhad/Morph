import type { EditPlan } from '../../shared/edit-ops';
import type { Settings } from '../../shared/settings';
import type { AiError, EditPlanRequestWire, ExportRequestWire, TokenUsage } from '../../shared/wire-types';
import type { AiPhase } from '../../shared/messages';

export interface StreamCallbacks {
  onPhase(phase: AiPhase): void;
  /** Incremental text of the plan summary (or export markdown) as it streams. */
  onSummaryDelta(text: string): void;
}

export interface AIProvider {
  readonly id: string;
  capabilities(): { vision: boolean };
  generateEditPlan(
    req: EditPlanRequestWire,
    cb: StreamCallbacks,
    signal: AbortSignal,
  ): Promise<{ plan: EditPlan; usage: TokenUsage }>;
  generateExportDoc(
    req: ExportRequestWire,
    cb: StreamCallbacks,
    signal: AbortSignal,
  ): Promise<{ markdown: string; usage: TokenUsage }>;
}

export class ProviderError extends Error {
  constructor(public readonly aiError: AiError) {
    super(aiError.message);
    this.name = 'ProviderError';
  }
}

export function toAiError(err: unknown): AiError {
  if (err instanceof ProviderError) return err.aiError;
  if (err instanceof Error && err.name === 'AbortError') {
    return { code: 'canceled', message: 'Request canceled', retryable: false };
  }
  return {
    code: 'unknown',
    message: err instanceof Error ? err.message : String(err),
    retryable: true,
  };
}

export const EMPTY_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

/**
 * Registry. Adding a provider = one implementation file + one case here.
 * Imported lazily by the caller so provider SDKs stay out of hot paths.
 */
export async function createProvider(settings: Settings): Promise<AIProvider> {
  switch (settings.provider) {
    case 'anthropic': {
      if (!settings.anthropic.apiKey) {
        throw new ProviderError({
          code: 'not_configured',
          message: 'Add your Anthropic API key in Morph settings.',
          retryable: false,
        });
      }
      const { AnthropicProvider } = await import('./providers/anthropic');
      return new AnthropicProvider(settings.anthropic);
    }
    case 'openai-compat': {
      if (!settings.openaiCompat.baseUrl || !settings.openaiCompat.model) {
        throw new ProviderError({
          code: 'not_configured',
          message: 'Configure the OpenAI-compatible endpoint (base URL and model) in Morph settings.',
          retryable: false,
        });
      }
      const { OpenAICompatProvider } = await import('./providers/openai-compat');
      return new OpenAICompatProvider(settings.openaiCompat);
    }
    case 'mock': {
      const { MockProvider } = await import('./providers/mock');
      return new MockProvider();
    }
  }
}
