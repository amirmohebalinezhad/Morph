// Typed protocol between the content script (CS) and the background service
// worker (SW). Two channels:
//   1. One-shot request/response via chrome.runtime.sendMessage / tabs.sendMessage.
//   2. A long-lived Port named `morph-ai` for streaming AI requests (added in M2).
import type { PublicSettings } from './settings';

// ---------------------------------------------------------------------------
// One-shot messages

/** SW -> CS */
export type TabRequest =
  | { type: 'MORPH_PING' }
  | { type: 'MORPH_TOGGLE' };

export interface TabResponseMap {
  MORPH_PING: { ok: true };
  MORPH_TOGGLE: { active: boolean };
}

/** CS/options -> SW */
export type RuntimeRequest =
  | { type: 'GET_PUBLIC_SETTINGS' }
  | { type: 'CAPTURE_VIEWPORT'; maxWidth: number; quality: number }
  | { type: 'OPEN_OPTIONS' };

export interface RuntimeResponseMap {
  GET_PUBLIC_SETTINGS: PublicSettings;
  CAPTURE_VIEWPORT: { dataUrl: string | null; error?: string };
  OPEN_OPTIONS: { ok: true };
}

export function sendToBackground<T extends RuntimeRequest>(
  msg: T,
): Promise<RuntimeResponseMap[T['type']]> {
  return chrome.runtime.sendMessage(msg);
}

export function sendToTab<T extends TabRequest>(
  tabId: number,
  msg: T,
): Promise<TabResponseMap[T['type']]> {
  return chrome.tabs.sendMessage(tabId, msg);
}
