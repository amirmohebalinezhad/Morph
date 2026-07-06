import { useStore } from 'zustand';
import type { Session } from '../../content/session';
import type { RevisionView } from '../../content/history/history-controller';

function RevisionRow({ rev, session }: { rev: RevisionView; session: Session }) {
  const icon = rev.id === 'root' ? '⌂' : rev.kind === 'ai' ? '✦' : '✎';
  return (
    <div
      className={`tl-row ${rev.isHead ? 'head' : ''} ${rev.isAhead ? 'ahead' : ''}`}
      data-morph-revision={rev.id}
      data-morph-revision-head={rev.isHead ? 'true' : 'false'}
    >
      <button
        type="button"
        className="tl-main"
        title={rev.summary}
        onClick={() => session.history.jumpTo(rev.id)}
      >
        <span className="tl-icon">{icon}</span>
        <span className="tl-text">
          <span className="tl-instruction">{rev.instruction}</span>
          <span className="tl-summary">{rev.summary}</span>
          {rev.skippedCount > 0 && <span className="tl-badge warn">{rev.skippedCount} skipped</span>}
          {rev.stale && <span className="tl-badge stale">page re-rendered</span>}
        </span>
      </button>
      {rev.siblingCount > 1 && (
        <span className="tl-branch" title="This point has alternative branches">
          <button
            type="button"
            className="tl-branch-btn"
            data-morph-btn="branch-prev"
            onClick={() => session.history.switchBranch(rev, -1)}
          >
            ‹
          </button>
          ⑂ {rev.siblingIndex + 1}/{rev.siblingCount}
          <button
            type="button"
            className="tl-branch-btn"
            data-morph-btn="branch-next"
            onClick={() => session.history.switchBranch(rev, 1)}
          >
            ›
          </button>
        </span>
      )}
    </div>
  );
}

export function Timeline({ session }: { session: Session }) {
  const lineage = useStore(session.history.view, (s) => s.lineage);

  return (
    <div className="tl" data-morph-timeline>
      {lineage.map((rev) => (
        <RevisionRow key={rev.id} rev={rev} session={session} />
      ))}
      {lineage.length === 1 && (
        <p className="ph-hint tl-empty">Every instruction becomes a revision here — undo, redo, jump, and branch freely.</p>
      )}
    </div>
  );
}
