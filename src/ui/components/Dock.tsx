import { useState } from 'react';
import type { Session } from '../../content/session';
import { ChatPanel } from './ChatPanel';
import { InspectPanel } from './InspectPanel';
import { Timeline } from './Timeline';

type DockTab = 'chat' | 'timeline' | 'inspect';

export function Dock({ session }: { session: Session }) {
  const [tab, setTab] = useState<DockTab>('chat');
  const [collapsed, setCollapsed] = useState(false);

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
        {tab === 'chat' && <ChatPanel session={session} />}
        {tab === 'timeline' && <Timeline session={session} />}
        {tab === 'inspect' && <InspectPanel session={session} />}
      </div>
    </div>
  );
}
