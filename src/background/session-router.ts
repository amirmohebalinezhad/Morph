// Routes AI-port traffic to providers. The service worker holds no session
// state — each request is self-contained; message activity keeps the SW
// alive for the duration; per-request AbortControllers cancel work when the
// client asks or the port dies (tab navigated, panel closed).
import type { AiPortClientMsg, AiPortServerMsg } from '../shared/messages';
import { loadSettings } from '../shared/settings';
import { createProvider, toAiError, type StreamCallbacks } from './ai/provider';

export function handleAiPort(port: chrome.runtime.Port): void {
  const inflight = new Map<string, AbortController>();
  let disconnected = false;

  const post = (msg: AiPortServerMsg) => {
    if (disconnected) return;
    try {
      port.postMessage(msg);
    } catch {
      disconnected = true;
    }
  };

  port.onDisconnect.addListener(() => {
    disconnected = true;
    for (const ac of inflight.values()) ac.abort();
    inflight.clear();
  });

  port.onMessage.addListener((raw: AiPortClientMsg) => {
    switch (raw.type) {
      case 'GENERATE_PLAN':
      case 'GENERATE_EXPORT': {
        const { requestId } = raw;
        const ac = new AbortController();
        inflight.set(requestId, ac);

        const callbacks: StreamCallbacks = {
          onPhase: (phase) => post({ type: 'STATUS', requestId, phase }),
          onSummaryDelta: (text) => post({ type: 'SUMMARY_DELTA', requestId, text }),
        };

        void (async () => {
          try {
            const settings = await loadSettings();
            const provider = await createProvider(settings);
            if (raw.type === 'GENERATE_PLAN') {
              const { plan, usage } = await provider.generateEditPlan(raw.payload, callbacks, ac.signal);
              post({ type: 'RESULT_PLAN', requestId, plan, usage });
            } else {
              const { markdown, usage } = await provider.generateExportDoc(raw.payload, callbacks, ac.signal);
              post({ type: 'RESULT_EXPORT', requestId, markdown, usage });
            }
          } catch (err) {
            post({ type: 'ERROR', requestId, error: toAiError(err) });
          } finally {
            inflight.delete(requestId);
          }
        })();
        break;
      }
      case 'CANCEL': {
        inflight.get(raw.requestId)?.abort();
        break;
      }
    }
  });
}
