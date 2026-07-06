import { useState } from 'react';
import { useStore } from 'zustand';
import type { Session } from '../../content/session';
import { describeOp } from '../../shared/edit-ops';

function RevisionColumn({ session, revId }: { session: Session; revId: string | null }) {
  const rev = revId ? session.history.tree.nodes.get(revId) : null;
  if (!rev) return <div className="cmp-col empty">Pick a revision</div>;
  return (
    <div className="cmp-col" data-morph-compare-col>
      <div className="cmp-head">{rev.instruction}</div>
      <div className="cmp-summary">{rev.summary}</div>
      <ul className="cmp-ops">
        {rev.ops.length === 0 && <li className="cmp-op muted">no operations</li>}
        {rev.ops.map((op, i) => (
          <li key={i} className="cmp-op">
            {describeOp(op)}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CompareView({ session, onClose }: { session: Session; onClose: () => void }) {
  const lineage = useStore(session.history.view, (s) => s.lineage);
  const [left, setLeft] = useState<string | null>(lineage[0]?.id ?? null);
  const [right, setRight] = useState<string | null>(lineage[lineage.length - 1]?.id ?? null);

  const options = lineage.map((r) => ({ id: r.id, label: `${r.instruction}` }));

  return (
    <div className="cmp" data-morph-compare>
      <div className="cmp-bar">
        <select value={left ?? ''} data-morph-compare-left onChange={(e) => setLeft(e.target.value || null)}>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <span className="cmp-vs">vs</span>
        <select value={right ?? ''} data-morph-compare-right onChange={(e) => setRight(e.target.value || null)}>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <div className="spacer" />
        <button type="button" className="mbtn" data-morph-btn="compare-close" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="cmp-cols">
        <RevisionColumn session={session} revId={left} />
        <RevisionColumn session={session} revId={right} />
      </div>
    </div>
  );
}
