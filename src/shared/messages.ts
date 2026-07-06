// Typed protocol between the content script (CS) and the background service
// worker (SW). Two channels:
//   1. One-shot request/response via chrome.runtime.sendMessage / tabs.sendMessage.
//   2. A long-lived Port named `morph-ai` for streaming AI requests.
import type { EditPlan } from './edit-ops';
import type { PublicSettings } from './settings';
import type { AiError, EditPlanRequestWire, ExportRequestWire, TokenUsage } from './wire-types';

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
  | { type: 'SET_BADGE'; active: boolean }
  | { type: 'OPEN_OPTIONS' };

export interface RuntimeResponseMap {
  GET_PUBLIC_SETTINGS: PublicSettings;
  /** base64 is JPEG data without the data-URL prefix. */
  CAPTURE_VIEWPORT: { base64: string | null; error?: string };
  SET_BADGE: { ok: true };
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

// ---------------------------------------------------------------------------
// AI streaming port (name: 'morph-ai')

export const AI_PORT_NAME = 'morph-ai';

export type AiPhase = 'sending' | 'streaming' | 'validating';

export type AiPortClientMsg =
  | { type: 'GENERATE_PLAN'; requestId: string; payload: EditPlanRequestWire }
  | { type: 'GENERATE_EXPORT'; requestId: string; payload: ExportRequestWire }
  | { type: 'CANCEL'; requestId: string };

export type AiPortServerMsg =
  | { type: 'STATUS'; requestId: string; phase: AiPhase }
  | { type: 'SUMMARY_DELTA'; requestId: string; text: string }
  | { type: 'RESULT_PLAN'; requestId: string; plan: EditPlan; usage: TokenUsage }
  | { type: 'RESULT_EXPORT'; requestId: string; markdown: string; usage: TokenUsage }
  | { type: 'ERROR'; requestId: string; error: AiError };
