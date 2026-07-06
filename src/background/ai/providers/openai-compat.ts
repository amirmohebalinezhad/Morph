// Generic OpenAI-compatible provider (fetch-based, no SDK dependency).
// Covers OpenAI, OpenRouter, Ollama, LM Studio, Groq, vLLM, etc. Prefers
// `response_format: json_schema`; falls back to `json_object` + schema in the
// system prompt for servers that don't support structured outputs.
import { EDIT_PLAN_JSON_SCHEMA } from '../../../shared/edit-plan-schema';
import { EditPlanSchema, type EditPlan } from '../../../shared/edit-ops';
import type { Settings } from '../../../shared/settings';
import type { EditPlanRequestWire, ExportRequestWire, TokenUsage } from '../../../shared/wire-types';
import { ProviderError, type AIProvider, type StreamCallbacks } from '../provider';
import { EDIT_SYSTEM_PROMPT, EXPORT_SYSTEM_PROMPT, formatContextBlock } from '../prompts';
import { extractStreamingSummary } from './anthropic';

interface OaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
}

interface StreamOutcome {
  content: string;
  usage: TokenUsage;
}

export class OpenAICompatProvider implements AIProvider {
  readonly id = 'openai-compat';
  private supportsJsonSchema = true;

  constructor(private config: Settings['openaiCompat']) {}

  capabilities() {
    return { vision: this.config.vision };
  }

  private async streamChat(
    body: Record<string, unknown>,
    cb: StreamCallbacks,
    signal: AbortSignal,
    onDelta: (full: string, delta: string) => void,
  ): Promise<StreamOutcome> {
    cb.onPhase('sending');
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.config.apiKey) headers['authorization'] = `Bearer ${this.config.apiKey}`;

    let res: Response;
    try {
      res = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...body, stream: true, stream_options: { include_usage: true } }),
        signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw err;
      throw new ProviderError({
        code: 'network',
        message: `Could not reach ${this.config.baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
        retryable: true,
      });
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (res.status === 401 || res.status === 403) {
        throw new ProviderError({ code: 'auth', message: `Endpoint rejected the API key (${res.status}).`, retryable: false });
      }
      if (res.status === 429) {
        throw new ProviderError({ code: 'rate_limit', message: 'Rate limited by the endpoint.', retryable: true });
      }
      if (res.status === 400 && /response_format|json_schema/i.test(text) && this.supportsJsonSchema) {
        // Signal the caller to retry without json_schema.
        this.supportsJsonSchema = false;
        throw new UnsupportedJsonSchemaError();
      }
      throw new ProviderError({
        code: res.status >= 500 ? 'overloaded' : 'unknown',
        message: `Endpoint error ${res.status}: ${text.slice(0, 300)}`,
        retryable: res.status >= 500,
      });
    }

    if (!res.body) {
      throw new ProviderError({ code: 'network', message: 'Endpoint returned no body.', retryable: true });
    }

    cb.onPhase('streaming');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    const usage: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const chunk = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string | null } }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
          };
          const delta = chunk.choices?.[0]?.delta?.content ?? '';
          if (delta) {
            content += delta;
            onDelta(content, delta);
          }
          if (chunk.usage) {
            usage.inputTokens = chunk.usage.prompt_tokens ?? 0;
            usage.outputTokens = chunk.usage.completion_tokens ?? 0;
          }
        } catch {
          // ignore malformed keep-alives
        }
      }
    }
    return { content, usage };
  }

  private userContent(req: EditPlanRequestWire): OaMessage['content'] {
    const text = formatContextBlock(req);
    if (req.screenshot && this.config.vision) {
      return [
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${req.screenshot}` } },
        { type: 'text', text },
      ];
    }
    return text;
  }

  async generateEditPlan(
    req: EditPlanRequestWire,
    cb: StreamCallbacks,
    signal: AbortSignal,
  ): Promise<{ plan: EditPlan; usage: TokenUsage }> {
    const schemaFallbackNote = `\n\nRespond ONLY with a single JSON object (no markdown fences, no prose) matching this JSON Schema:\n${JSON.stringify(EDIT_PLAN_JSON_SCHEMA)}`;

    const messages: OaMessage[] = [
      { role: 'system', content: EDIT_SYSTEM_PROMPT + (this.supportsJsonSchema ? '' : schemaFallbackNote) },
      ...req.conversation.map((t) => ({ role: t.role, content: t.text }) as OaMessage),
      { role: 'user', content: this.userContent(req) },
    ];

    const totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

    for (let attempt = 0; attempt < 3; attempt++) {
      // Rebuild system message if json_schema support was just disproven.
      messages[0] = {
        role: 'system',
        content: EDIT_SYSTEM_PROMPT + (this.supportsJsonSchema ? '' : schemaFallbackNote),
      };
      const body: Record<string, unknown> = {
        model: this.config.model,
        messages,
        response_format: this.supportsJsonSchema
          ? { type: 'json_schema', json_schema: { name: 'edit_plan', strict: true, schema: EDIT_PLAN_JSON_SCHEMA } }
          : { type: 'json_object' },
      };

      let outcome: StreamOutcome;
      try {
        let sentSummary = '';
        outcome = await this.streamChat(body, cb, signal, (full) => {
          const summary = extractStreamingSummary(full);
          if (summary.length > sentSummary.length) {
            cb.onSummaryDelta(summary.slice(sentSummary.length));
            sentSummary = summary;
          }
        });
      } catch (err) {
        if (err instanceof UnsupportedJsonSchemaError) continue; // retry with fallback format
        throw err;
      }

      totalUsage.inputTokens += outcome.usage.inputTokens;
      totalUsage.outputTokens += outcome.usage.outputTokens;

      cb.onPhase('validating');
      const parsed = parsePlanJson(outcome.content);
      if (parsed.success) return { plan: parsed.plan, usage: totalUsage };

      messages.push({ role: 'assistant', content: outcome.content });
      messages.push({
        role: 'user',
        content: `That JSON failed validation:\n${parsed.issues}\nRespond again with a complete, corrected JSON plan only.`,
      });
    }

    throw new ProviderError({
      code: 'schema',
      message: 'The endpoint kept returning invalid edit plans.',
      retryable: true,
    });
  }

  async generateExportDoc(
    req: ExportRequestWire,
    cb: StreamCallbacks,
    signal: AbortSignal,
  ): Promise<{ markdown: string; usage: TokenUsage }> {
    const messages: OaMessage[] = [
      { role: 'system', content: EXPORT_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `${req.userNotes ? `Developer notes: ${req.userNotes}\n\n` : ''}Page: ${req.title} (${req.url})\n\n${req.changeLog}`,
      },
    ];
    const outcome = await this.streamChat({ model: this.config.model, messages }, cb, signal, (_full, delta) =>
      cb.onSummaryDelta(delta),
    );
    return { markdown: outcome.content, usage: outcome.usage };
  }
}

class UnsupportedJsonSchemaError extends Error {}

function parsePlanJson(
  content: string,
): { success: true; plan: EditPlan } | { success: false; issues: string } {
  let text = content.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1]!.trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return { success: false, issues: 'no JSON object found in response' };
  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as unknown;
    const parsed = EditPlanSchema.safeParse(raw);
    if (parsed.success) return { success: true, plan: parsed.data };
    return {
      success: false,
      issues: parsed.error.issues.map((i) => `- ${i.path.join('.')}: ${i.message}`).join('\n'),
    };
  } catch (err) {
    return { success: false, issues: `invalid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
}
