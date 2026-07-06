// Background service worker: stateless broker.
// Owns extension activation (programmatic content-script injection), screenshot
// capture, and (from M2) AI provider calls. All prototype/session state lives
// in the content script.
import type { RuntimeRequest, RuntimeResponseMap } from '../shared/messages';
import { sendToTab } from '../shared/messages';

async function isContentScriptAlive(tabId: number): Promise<boolean> {
  try {
    const res = await sendToTab(tabId, { type: 'MORPH_PING' });
    return res?.ok === true;
  } catch {
    return false;
  }
}

/**
 * Shared activation path for toolbar clicks and the e2e test hook: make sure
 * the content script is present, then toggle edit mode and reflect the state
 * on the action badge.
 */
async function activateTab(tabId: number): Promise<{ active: boolean }> {
  if (!(await isContentScriptAlive(tabId))) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
  }
  const { active } = await sendToTab(tabId, { type: 'MORPH_TOGGLE' });
  await chrome.action.setBadgeText({ tabId, text: active ? 'ON' : '' });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: '#6d5ef1' });
  return { active };
}

chrome.action.onClicked.addListener((tab) => {
  if (tab.id === undefined || tab.id === chrome.tabs.TAB_ID_NONE) return;
  const url = tab.url ?? '';
  if (/^(chrome|chrome-extension|edge|about|devtools):/.test(url)) return;
  void activateTab(tab.id).catch((err) => {
    console.error('[morph] activation failed', err);
  });
});

// ---------------------------------------------------------------------------
// One-shot message router

type Responder = (response: unknown) => void;

function handleRuntimeMessage(
  msg: RuntimeRequest,
  sender: chrome.runtime.MessageSender,
  sendResponse: Responder,
): boolean {
  switch (msg.type) {
    case 'GET_PUBLIC_SETTINGS': {
      void (async () => {
        const { loadSettings, toPublicSettings } = await import('../shared/settings');
        sendResponse(toPublicSettings(await loadSettings()) satisfies RuntimeResponseMap['GET_PUBLIC_SETTINGS']);
      })();
      return true;
    }
    case 'CAPTURE_VIEWPORT': {
      void (async () => {
        try {
          const windowId = sender.tab?.windowId;
          const dataUrl = await chrome.tabs.captureVisibleTab(windowId ?? chrome.windows.WINDOW_ID_CURRENT, {
            format: 'jpeg',
            quality: Math.round(msg.quality * 100),
          });
          sendResponse({ dataUrl } satisfies RuntimeResponseMap['CAPTURE_VIEWPORT']);
        } catch (err) {
          sendResponse({
            dataUrl: null,
            error: err instanceof Error ? err.message : String(err),
          } satisfies RuntimeResponseMap['CAPTURE_VIEWPORT']);
        }
      })();
      return true;
    }
    case 'SET_BADGE': {
      const tabId = sender.tab?.id;
      if (tabId !== undefined) {
        void chrome.action.setBadgeText({ tabId, text: msg.active ? 'ON' : '' });
      }
      sendResponse({ ok: true } satisfies RuntimeResponseMap['SET_BADGE']);
      return false;
    }
    case 'OPEN_OPTIONS': {
      void chrome.runtime.openOptionsPage();
      sendResponse({ ok: true } satisfies RuntimeResponseMap['OPEN_OPTIONS']);
      return false;
    }
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object' || !('type' in msg)) return undefined;
  return handleRuntimeMessage(msg as RuntimeRequest, sender, sendResponse);
});

// ---------------------------------------------------------------------------
// Test hook: e2e suites cannot click the real toolbar button, so they evaluate
// this global inside the service worker instead. It follows the exact same
// code path as a user click.
(globalThis as Record<string, unknown>)['__morphActivateForTest'] = async (urlPattern: string) => {
  const tabs = await chrome.tabs.query({ url: urlPattern });
  const tab = tabs[0];
  if (!tab?.id) throw new Error(`no tab matching ${urlPattern}`);
  return activateTab(tab.id);
};
