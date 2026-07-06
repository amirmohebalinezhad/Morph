import { useState } from 'react';
import { useStore } from 'zustand';
import type { Session } from '../../content/session';

type DockTab = 'chat' | 'timeline' | 'inspect';

export function Dock({ session }: { session: Session }) {
  const [tab, setTab] = useState<DockTab>('chat');
  const [collapsed, setCollapsed] = useState(false);
  const selectionCount = useStore(session.store, (s) => s.selection.length);

  if (collapsed) {
    return (
      <button
        type="button"
        className="morph-dock-fab"
        data-morph-btn="dock-expand"
        title="Open Morph panel"
        onClick={() => setCollapsed(false)}
      >
        ✦
      </button>
    );
  }

  return (
    <div className="morph-dock" data-morph-dock>
      <div className="dock-tabs">
        {(['chat', 'timeline', 'inspect'] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={`dock-tab ${tab === t ? 'on' : ''}`}
            data-morph-btn={`tab-${t}`}
            onClick={() => setTab(t)}
          >
            {t === 'chat' ? 'Chat' : t === 'timeline' ? 'History' : 'Inspect'}
          </button>
        ))}
        <div className="spacer" />
        <button
          type="button"
          className="mbtn"
          data-morph-btn="dock-collapse"
          title="Collapse panel"
          onClick={() => setCollapsed(true)}
        >
          –
        </button>
      </div>

      <div className="dock-body">
        {tab === 'chat' && (
          <div className="dock-placeholder" data-morph-pane="chat">
            <p className="ph-title">Describe a change</p>
            <p className="ph-hint">
              {selectionCount > 0
                ? 'AI editing arrives in the next milestone.'
                : 'Click an element on the page to select it (shift-click adds more), then describe what you want.'}
            </p>
          </div>
        )}
        {tab === 'timeline' && (
          <div className="dock-placeholder" data-morph-pane="timeline">
            <p className="ph-title">History</p>
            <p className="ph-hint">Every instruction becomes a revision you can undo, branch, and compare.</p>
          </div>
        )}
        {tab === 'inspect' && (
          <div className="dock-placeholder" data-morph-pane="inspect">
            <p className="ph-title">Inspect</p>
            <p className="ph-hint">Style editors arrive in a later milestone.</p>
          </div>
        )}
      </div>
    </div>
  );
}
