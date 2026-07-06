// Anthropic provider: streaming Messages API with forced strict tool use.
// Runs in the extension service worker — host_permissions make CORS moot and
// the API key never leaves this context.
import Anthropic from '@anthropic-ai/sdk';
import { EDIT_PLAN_JSON_SCHEMA } from '../../../shared/edit-plan-schema';
import { EditPlanSchema, type EditPlan } from '../../../shared/edit-ops';
import type { Settings } from '../../../shared/settings';
import type { EditPlanRequestWire, ExportRequestWire, TokenUsage } from '../../../shared/wire-types';
import { ProviderError, type AIProvider, type StreamCallbacks } from '../provider';
import { EDIT_SYSTEM_PROMPT, EXPORT_SYSTEM_PROMPT, formatContextBlock } from '../prompts';

const APPLY_EDITS_TOOL: Anthropic.Messages.ToolUnion = {
  name: 'apply_edits',
  description:
    'Apply a set of live DOM edit operations to the current page. This is the only way to respond.',
  strict: true,
  input_schema: EDIT_PLAN_JSON_SCHEMA as Anthropic.Messages.Tool.InputSchema,
};

/** Models where the `thinking` field must be omitted entirely. */
function supportsThinkingDisabled(model: string): boolean {
  return !/fable|mythos/.test(model);
}

function mapUsage(usage: Anthropic.Messages.Usage): TokenUsage {
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  };
}

function mapError(err: unknown): never {
  if (err instanceof Anthropic.AuthenticationError) {
    throw new ProviderError({ code: 'auth', message: 'Anthropic rejected the API key. Check Morph settings.', retryable: false });
  }
  if (err instanceof Anthropic.RateLimitError) {
    throw new ProviderError({ code: 'rate_limit', message: 'Rate limited by Anthropic — wait a moment and retry.', retryable: true });
  }
  if (err instanceof Anthropic.APIConnectionError) {
    throw new ProviderError({ code: 'network', message: `Could not reach the Anthropic API: ${err.message}`, retryable: true });
  }
  if (err instanceof Anthropic.APIError) {
    const status = err.status ?? 0;
    if (status === 529) {
      throw new ProviderError({ code: 'overloaded', message: 'Anthropic API is overloaded — retry shortly.', retryable: true });
    }
    throw new ProviderError({ code: 'unknown', message: `Anthropic API error ${status}: ${err.message}`, retryable: status >= 500 });
  }
  throw err;
}

/** Extracts the (possibly incomplete) summary string from partial tool JSON. */
export function extractStreamingSummary(buffer: string): string {
  const match = buffer.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)/);
  if (!match) return '';
  let raw = match[1]!;
  // Drop a trailing lone backslash (an escape sequence cut mid-stream).
  if (/(?:^|[^\\])(?:\\\\)*\\$/.test(raw)) raw = raw.slice(0, -1);
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return '';
  }
}

export class AnthropicProvider implements AIProvider {
  readonly id = 'anthropic';
  private client: Anthropic;
  private model: string;

  constructor(config: Settings['anthropic']) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
      // Safe here: this runs in the extension service worker, never in page
      // context, and host_permissions authorize the cross-origin call.
      dangerouslyAllowBrowser: true,
      maxRetries: 1,
    });
    this.model = config.model;
  }

  capabilities() {
    return { vision: true };
  }

  private buildMessages(req: EditPlanRequestWire): Anthropic.Messages.MessageParam[] {
    const messages: Anthropic.Messages.MessageParam[] = [];

    // Prior turns as compact text pairs — this is what makes "actually keep
    // the old height" resolvable without resending old context.
    for (const turn of req.conversation) {
      messages.push({ role: turn.role, content: turn.text });
    }
    // Second cache breakpoint: the growing conversation prefix caches
    // turn-over-turn; only the final (volatile) user turn is re-read.
    const last = messages[messages.length - 1];
    if (last && Array.isArray(last.content) === false) {
      last.content = [
        { type: 'text', text: last.content as string, cache_control: { type: 'ephemeral' } },
      ];
    }

    const content: Anthropic.Messages.ContentBlockParam[] = [];
    if (req.screenshot) {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: req.screenshot },
      });
    }
    content.push({ type: 'text', text: formatContextBlock(req) });
    messages.push({ role: 'user', content });
    return messages;
  }

  async generateEditPlan(
    req: EditPlanRequestWire,
    cb: StreamCallbacks,
    signal: AbortSignal,
  ): Promise<{ plan: EditPlan; usage: TokenUsage }> {
    const messages = this.buildMessages(req);
    const usageTotal: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

    for (let attempt = 0; attempt < 2; attempt++) {
      cb.onPhase(attempt === 0 ? 'sending' : 'validating');
      let message: Anthropic.Messages.Message;
      try {
        const stream = this.client.messages.stream(
          {
            model: this.model,
            max_tokens: 16000,
            ...(supportsThinkingDisabled(this.model) ? { thinking: { type: 'disabled' as const } } : {}),
            system: [
              { type: 'text', text: EDIT_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
            ],
            tools: [APPLY_EDITS_TOOL],
            tool_choice: { type: 'tool', name: 'apply_edits' },
            messages,
          },
          { signal },
        );

        let jsonBuffer = '';
        let sentSummary = '';
        let streaming = false;
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'input_json_delta') {
            if (!streaming) {
              streaming = true;
              cb.onPhase('streaming');
            }
            jsonBuffer += event.delta.partial_json;
            const summary = extractStreamingSummary(jsonBuffer);
            if (summary.length > sentSummary.length) {
              cb.onSummaryDelta(summary.slice(sentSummary.length));
              sentSummary = summary;
            }
          }
        }
        message = await stream.finalMessage();
      } catch (err) {
        mapError(err);
      }

      const u = mapUsage(message.usage);
      usageTotal.inputTokens += u.inputTokens;
      usageTotal.outputTokens += u.outputTokens;
      usageTotal.cacheReadTokens += u.cacheReadTokens;
      usageTotal.cacheWriteTokens += u.cacheWriteTokens;

      if (message.stop_reason === 'refusal') {
        throw new ProviderError({
          code: 'refusal',
          message: 'The model declined this request.',
          retryable: false,
        });
      }

      const toolUse = message.content.find(
        (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use' && b.name === 'apply_edits',
      );
      if (!toolUse) {
        throw new ProviderError({
          code: 'schema',
          message: 'The model did not return an edit plan.',
          retryable: true,
        });
      }

      cb.onPhase('validating');
      const parsed = EditPlanSchema.safeParse(toolUse.input);
      if (parsed.success) {
        return { plan: parsed.data, usage: usageTotal };
      }

      // One corrective retry: echo the tool_use and report the validation
      // failure as an errored tool_result.
      messages.push({ role: 'assistant', content: message.content });
      messages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: toolUse.id,
            is_error: true,
            content: `The plan failed validation:\n${parsed.error.issues
              .map((i) => `- ${i.path.join('.')}: ${i.message}`)
              .join('\n')}\nCall apply_edits again with a complete, corrected plan.`,
          },
        ],
      });
    }

    throw new ProviderError({
      code: 'schema',
      message: 'The model returned an invalid edit plan twice.',
      retryable: true,
    });
  }

  async generateExportDoc(
    req: ExportRequestWire,
    cb: StreamCallbacks,
    signal: AbortSignal,
  ): Promise<{ markdown: string; usage: TokenUsage }> {
    cb.onPhase('sending');
    try {
      const stream = this.client.messages.stream(
        {
          model: this.model,
          max_tokens: 16000,
          ...(supportsThinkingDisabled(this.model) ? { thinking: { type: 'disabled' as const } } : {}),
          system: [{ type: 'text', text: EXPORT_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `${req.userNotes ? `Developer notes: ${req.userNotes}\n\n` : ''}Page: ${req.title} (${req.url})\n\n${req.changeLog}`,
                },
              ],
            },
          ],
        },
        { signal },
      );

      let started = false;
      stream.on('text', (delta) => {
        if (!started) {
          started = true;
          cb.onPhase('streaming');
        }
        cb.onSummaryDelta(delta);
      });

      const message = await stream.finalMessage();
      const markdown = message.content
        .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      return { markdown, usage: mapUsage(message.usage) };
    } catch (err) {
      mapError(err);
    }
  }
}
