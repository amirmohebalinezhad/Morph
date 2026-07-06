import { useStore } from 'zustand';
import type { Session } from '../../content/session';
import { ancestorChain, describeElement } from '../../content/dom-utils';
import { primarySelection } from '../../content/store';

export function Breadcrumb({ session }: { session: Session }) {
  const primary = useStore(session.store, (s) => primarySelection(s));
  if (!primary || !primary.isConnected) return null;

  const chain = ancestorChain(primary);
  const st = session.store.getState();

  return (
    <div className="morph-breadcrumb" data-morph-breadcrumb>
      {chain.map((el, i) => (
        <span key={i} className="crumb-wrap">
          {i > 0 && <span className="crumb-sep">›</span>}
          <button
            type="button"
            className={`crumb ${el === primary ? 'on' : ''}`}
            title={describeElement(el, 6)}
            onClick={() => st.select(el)}
            onMouseEnter={() => st.setHovered(el)}
            onMouseLeave={() => st.setHovered(null)}
          >
            {describeElement(el)}
          </button>
        </span>
      ))}
    </div>
  );
}
