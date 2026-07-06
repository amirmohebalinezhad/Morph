// Chat/conversation UI state, mutated by ChatController and rendered by
// React via useStore.
import { createStore } from 'zustand/vanilla';
import type { AiPhase } from '../shared/messages';
import type { PublicSettings } from '../shared/settings';
import type { AiError, TokenUsage } from '../shared/wire-types';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  status: 'streaming' | 'done' | 'error' | 'question';
  phase?: AiPhase;
  error?: AiError;
  usage?: TokenUsage;
  /** Ops that could not run (e.g. behaviors blocked by page CSP). */
  skippedNotes?: string[];
  notes?: string | null;
}

export interface ChatState {
  messages: ChatMessage[];
  busy: boolean;
  settings: PublicSettings | null;

  add(msg: ChatMessage): void;
  update(id: string, patch: Partial<ChatMessage>): void;
  appendText(id: string, delta: string): void;
  setBusy(busy: boolean): void;
  setSettings(settings: PublicSettings): void;
}

export type ChatStore = ReturnType<typeof createChatStore>;

export function createChatStore() {
  return createStore<ChatState>()((set) => ({
    messages: [],
    busy: false,
    settings: null,

    add: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
    update: (id, patch) =>
      set((s) => ({
        messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
      })),
    appendText: (id, delta) =>
      set((s) => ({
        messages: s.messages.map((m) => (m.id === id ? { ...m, text: m.text + delta } : m)),
      })),
    setBusy: (busy) => set({ busy }),
    setSettings: (settings) => set({ settings }),
  }));
}
