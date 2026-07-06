import { useStore } from 'zustand';
import type { Session } from '../../content/session';

export function ExportDialog({ session }: { session: Session }) {
  const s = useStore(session.exporter.store, (st) => st);
  if (!s.open) return null;

  const exporter = session.exporter;
  const shown = s.view === 'changelog' ? s.changeLog : s.polished || s.changeLog;
  const usingPolished = s.view === 'prompt' && !!s.polished;

  return (
    <div className="morph-modal-backdrop" data-morph-export onClick={() => exporter.close()}>
      <div className="morph-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Implementation prompt</h2>
          <button type="button" className="mbtn" data-morph-btn="export-close" onClick={() => exporter.close()}>
            ✕
          </button>
        </div>

        <p className="modal-sub">
          Paste this into your AI coding agent to implement the prototype in your real source code.
        </p>

        <div className="modal-toolbar">
          <div className="seg small">
            <button
              type="button"
              className={`seg-btn ${s.view === 'prompt' ? 'on' : ''}`}
              data-morph-btn="export-view-prompt"
              onClick={() => exporter.setView('prompt')}
            >
              Prompt
            </button>
            <button
              type="button"
              className={`seg-btn ${s.view === 'changelog' ? 'on' : ''}`}
              data-morph-btn="export-view-changelog"
              onClick={() => exporter.setView('changelog')}
            >
              Raw change log
            </button>
          </div>
          <div className="spacer" />
          {s.polishing && <span className="modal-status">Polishing with AI…</span>}
          {usingPolished && !s.polishing && <span className="modal-status ok">AI-polished</span>}
          {!exporter.hasProvider() && (
            <button
              type="button"
              className="modal-link"
              data-morph-btn="export-configure"
              onClick={() => exporter.openOptions()}
            >
              Configure AI for a polished brief →
            </button>
          )}
        </div>

        {s.polishError && (
          <div className="modal-error">
            AI polish failed ({s.polishError.message}). Showing the raw change log — still fully usable.
          </div>
        )}

        <textarea
          className="modal-output"
          data-morph-export-output
          readOnly
          value={shown}
          onFocus={(e) => e.currentTarget.select()}
        />

        <div className="modal-notes">
          <input
            type="text"
            data-morph-export-notes
            placeholder="Optional: framework/stack hint (e.g. “React + Tailwind”) — improves the prompt"
            value={s.userNotes}
            onChange={(e) => exporter.setNotes(e.target.value)}
          />
          <button
            type="button"
            className="mbtn-text"
            data-morph-btn="export-repolish"
            disabled={!exporter.hasProvider() || s.polishing}
            onClick={() => void exporter.polish()}
          >
            Regenerate
          </button>
        </div>

        <div className="modal-actions">
          <button
            type="button"
            className="primary"
            data-morph-btn="export-copy"
            onClick={() => void exporter.copy()}
          >
            {s.copied ? '✓ Copied' : 'Copy to clipboard'}
          </button>
          <button type="button" className="ghost" data-morph-btn="export-download" onClick={() => exporter.download()}>
            Download .md
          </button>
          <button
            type="button"
            className="ghost"
            data-morph-btn="export-download-html"
            onClick={() => exporter.downloadHtmlSnapshot()}
          >
            Download HTML snapshot
          </button>
        </div>
      </div>
    </div>
  );
}
