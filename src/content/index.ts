// Content script entry. Injected programmatically by the service worker on
// first activation; subsequent toolbar clicks toggle edit mode via messages.
// The bundle is an IIFE — this module-level guard makes re-injection a no-op.
import type { TabRequest, TabResponseMap } from '../shared/messages';

interface MorphGlobal {
  __morphInstalled?: boolean;
}

const g = window as Window & MorphGlobal;

if (!g.__morphInstalled) {
  g.__morphInstalled = true;

  let active = false;
  let sessionPromise: Promise<{ setActive(on: boolean): void }> | null = null;

  // The Session (selection engine, UI, history…) arrives in M1+. Until then a
  // minimal stand-in records activation state on <html> so the pipeline is
  // verifiable end-to-end.
  function ensureSession() {
    sessionPromise ??= Promise.resolve({
      setActive(on: boolean) {
        if (on) {
          document.documentElement.dataset['morphActive'] = 'true';
        } else {
          delete document.documentElement.dataset['morphActive'];
        }
      },
    });
    return sessionPromise;
  }

  chrome.runtime.onMessage.addListener(
    (msg: TabRequest, _sender, sendResponse: (r: TabResponseMap[TabRequest['type']]) => void) => {
      switch (msg?.type) {
        case 'MORPH_PING':
          sendResponse({ ok: true });
          return false;
        case 'MORPH_TOGGLE':
          void (async () => {
            active = !active;
            (await ensureSession()).setActive(active);
            sendResponse({ active });
          })();
          return true;
        default:
          return undefined;
      }
    },
  );
}
