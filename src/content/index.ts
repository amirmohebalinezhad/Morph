// Content script entry. Injected programmatically by the service worker on
// first activation; subsequent toolbar clicks toggle edit mode via messages.
// The bundle is an IIFE — this module-level guard makes re-injection a no-op.
import type { TabRequest, TabResponseMap } from '../shared/messages';
import { Session } from './session';

interface MorphGlobal {
  __morphInstalled?: boolean;
}

const g = window as Window & MorphGlobal;

if (!g.__morphInstalled) {
  g.__morphInstalled = true;

  let session: Session | null = null;

  chrome.runtime.onMessage.addListener(
    (msg: TabRequest, _sender, sendResponse: (r: TabResponseMap[TabRequest['type']]) => void) => {
      switch (msg?.type) {
        case 'MORPH_PING':
          sendResponse({ ok: true });
          return false;
        case 'MORPH_TOGGLE': {
          session ??= new Session();
          session.setActive(!session.active);
          sendResponse({ active: session.active });
          return false;
        }
        default:
          return undefined;
      }
    },
  );
}
