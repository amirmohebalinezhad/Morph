import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { Session } from '../../content/session';
import { describeElement } from '../../content/dom-utils';
import type { ChatMessage } from '../../content/chat-store';

function MessageBubble({ msg }: { msg: ChatMessage }) {
  if (msg.role === 'user') {
    return <div className="chat-msg user">{msg.text}</div>;
  }
  return (
    <div className={`chat-msg assistant ${msg.status}`} data-morph-msg-status={msg.status}>
      {msg.status === 'streaming' && (
        <span className="chat-phase">
          {msg.phase === 'sending' ? 'thinking…' : msg.phase === 'validating' ? 'applying…' : ''}
        </span>
      )}
      {msg.text || (msg.status === 'streaming' ? <span className="chat-dots">●●●</span> : null)}
      {msg.status === 'question' && <span className="chat-tag">needs answer</span>}
      {msg.status === 'error' && msg.error && (
        <div className="chat-error">
          {msg.error.message}
          {msg.error.code === 'not_configured' && ' (open settings from the toolbar ⚙)'}
        </div>
      )}
      {msg.notes && <div className="chat-note">Note: {msg.notes}</div>}
      {msg.skippedNotes?.map((n, i) => (
        <div key={i} className="chat-note warn">
          Skipped: {n}
        </div>
      ))}
      {msg.usage && msg.usage.inputTokens > 0 && (
        <div className="chat-usage">
          {msg.usage.inputTokens.toLocaleString()} in / {msg.usage.outputTokens.toLocaleString()} out
          {msg.usage.cacheReadTokens > 0 && ` · ${msg.usage.cacheReadTokens.toLocaleString()} cached`}
        </div>
      )}
    </div>
  );
}

export function ChatPanel({ session }: { session: Session }) {
  const messages = useStore(session.chatStore, (s) => s.messages);
  const busy = useStore(session.chatStore, (s) => s.busy);
  const settings = useStore(session.chatStore, (s) => s.settings);
  const selection = useStore(session.store, (s) => s.selection);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const configured = settings?.providerConfigured ?? false;
  const canSend = !busy && draft.trim().length > 0 && configured;

  const send = () => {
    if (!canSend) return;
    const text = draft;
    setDraft('');
    void session.chat.submit(text);
  };

  return (
    <div className="chat-panel" data-morph-chat>
      <div className="chat-scroll" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            <p className="ph-title">Describe a change</p>
            <p className="ph-hint">
              Click an element (shift-click adds more), then say what you want: “make this button
              red”, “turn this table into cards”, “add a copy button here”…
            </p>
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} msg={m} />
        ))}
      </div>

      {!configured && settings !== null && (
        <button
          type="button"
          className="chat-configure"
          data-morph-btn="configure-provider"
          onClick={() => session.openOptions()}
        >
          Set up an AI provider to start editing →
        </button>
      )}

      <div className="chat-selection" data-morph-chat-selection>
        {selection.length === 0
          ? 'No selection — instructions apply to the page'
          : selection
              .filter((el) => el.isConnected)
              .map((el) => describeElement(el))
              .join(', ')}
      </div>

      <div className="chat-inputrow">
        <textarea
          data-morph-prompt-input
          className="chat-input"
          placeholder={busy ? 'Working…' : 'Describe a change…'}
          rows={2}
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        {busy ? (
          <button
            type="button"
            className="chat-send cancel"
            data-morph-btn="chat-cancel"
            title="Cancel"
            onClick={() => session.chat.cancel()}
          >
            ◼
          </button>
        ) : (
          <button
            type="button"
            className="chat-send"
            data-morph-btn="chat-send"
            title="Send (Enter)"
            disabled={!canSend}
            onClick={send}
          >
            ➤
          </button>
        )}
      </div>
    </div>
  );
}
