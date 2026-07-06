import { useState } from 'react';
import { useStore } from 'zustand';
import type { Session } from '../../content/session';

export function RecoveryToast({ session }: { session: Session }) {
  const state = useStore(session.sentinel.store, (s) => s);
  const [working, setWorking] = useState(false);
  if (!state.staleDetected || state.dismissed) return null;

  const reapply = async () => {
    setWorking(true);
    try {
      await session.recoverFromReRender();
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="morph-recovery" data-morph-recovery role="alert">
      <span className="rec-icon">⟳</span>
      <span className="rec-text">
        The page re-rendered itself — {state.affectedCount} edit{state.affectedCount === 1 ? '' : 's'} may
        have been lost.
      </span>
      <button
        type="button"
        className="rec-apply"
        data-morph-btn="recovery-reapply"
        disabled={working}
        onClick={() => void reapply()}
      >
        {working ? 'Re-applying…' : 'Re-apply edits'}
      </button>
      <button
        type="button"
        className="rec-dismiss"
        data-morph-btn="recovery-dismiss"
        onClick={() => session.sentinel.dismiss()}
      >
        ✕
      </button>
    </div>
  );
}
