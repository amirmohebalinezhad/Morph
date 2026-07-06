import type { ReactNode } from 'react';
import { useStore } from 'zustand';
import type { Session } from '../../content/session';

function IconButton(props: {
  id: string;
  title: string;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="mbtn"
      data-morph-btn={props.id}
      title={props.title}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

export function Toolbar({ session }: { session: Session }) {
  const mode = useStore(session.store, (s) => s.mode);
  const selectionCount = useStore(session.store, (s) => s.selection.length);
  const st = session.store.getState();

  return (
    <div className="morph-toolbar" data-morph-toolbar>
      <div className="brand" title="Morph — AI live UI prototyping">
        <span className="brand-dot" />
        Morph
      </div>

      <div className="seg" role="tablist" aria-label="Editor mode">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'select'}
          className={`seg-btn ${mode === 'select' ? 'on' : ''}`}
          data-morph-btn="mode-select"
          title="Select elements (page interactions paused)"
          onClick={() => st.setMode('select')}
        >
          Select
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'interact'}
          className={`seg-btn ${mode === 'interact' ? 'on' : ''}`}
          data-morph-btn="mode-interact"
          title="Interact with the live prototype"
          onClick={() => st.setMode('interact')}
        >
          Interact
        </button>
      </div>

      <span className="sel-count" data-morph-selcount>
        {selectionCount > 0 ? `${selectionCount} selected` : 'nothing selected'}
      </span>

      <div className="spacer" />

      <IconButton id="settings" title="Morph settings" onClick={() => session.openOptions()}>
        ⚙
      </IconButton>
      <IconButton id="close" title="Close Morph" onClick={() => session.requestClose()}>
        ✕
      </IconButton>
    </div>
  );
}
