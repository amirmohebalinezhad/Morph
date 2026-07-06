// Content-script wrapper for the AI streaming port. One port per request:
// simple lifecycle, and the open port keeps the service worker alive for the
// duration of the call.
import type { EditPlan } from '../shared/edit-ops';
import { genId } from '../shared/ids';
import { AI_PORT_NAME, type AiPhase, type AiPortClientMsg, type AiPortServerMsg } from '../shared/messages';
import type { AiError, EditPlanRequestWire, ExportRequestWire, TokenUsage } from '../shared/wire-types';

export interface AiStreamHandlers {
  onPhase?(phase: AiPhase): void;
  onDelta?(text: string): void;
}

export class AiRequestError extends Error {
  constructor(public readonly aiError: AiError) {
    super(aiError.message);
    this.name = 'AiRequestError';
  }
}

function runPortRequest<T>(
  msg: AiPortClientMsg,
  handlers: AiStreamHandlers,
  pick: (m: AiPortServerMsg) => T | undefined,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const port = chrome.runtime.connect({ name: AI_PORT_NAME });
    const requestId = 'requestId' in msg ? msg.requestId : '';
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      try {
        port.disconnect();
      } catch {
        // already gone
      }
      fn();
    };

    const onAbort = () => {
      try {
        port.postMessage({ type: 'CANCEL', requestId } satisfies AiPortClientMsg);
      } catch {
        // port already closed
      }
      finish(() =>
        reject(new AiRequestError({ code: 'canceled', message: 'Request canceled', retryable: false })),
      );
    };
    signal?.addEventListener('abort', onAbort);

    port.onMessage.addListener((server: AiPortServerMsg) => {
      if (server.requestId !== requestId) return;
      switch (server.type) {
        case 'STATUS':
          handlers.onPhase?.(server.phase);
          break;
        case 'SUMMARY_DELTA':
          handlers.onDelta?.(server.text);
          break;
        case 'ERROR':
          finish(() => reject(new AiRequestError(server.error)));
          break;
        default: {
          const value = pick(server);
          if (value !== undefined) finish(() => resolve(value));
        }
      }
    });

    port.onDisconnect.addListener(() => {
      finish(() =>
        reject(
          new AiRequestError({
            code: 'network',
            message: 'Lost connection to the extension background worker.',
            retryable: true,
          }),
        ),
      );
    });

    port.postMessage(msg);
  });
}

export function generatePlan(
  payload: EditPlanRequestWire,
  handlers: AiStreamHandlers,
  signal?: AbortSignal,
): Promise<{ plan: EditPlan; usage: TokenUsage }> {
  return runPortRequest(
    { type: 'GENERATE_PLAN', requestId: genId('req'), payload },
    handlers,
    (m) => (m.type === 'RESULT_PLAN' ? { plan: m.plan, usage: m.usage } : undefined),
    signal,
  );
}

export function generateExport(
  payload: ExportRequestWire,
  handlers: AiStreamHandlers,
  signal?: AbortSignal,
): Promise<{ markdown: string; usage: TokenUsage }> {
  return runPortRequest(
    { type: 'GENERATE_EXPORT', requestId: genId('req'), payload },
    handlers,
    (m) => (m.type === 'RESULT_EXPORT' ? { markdown: m.markdown, usage: m.usage } : undefined),
    signal,
  );
}
