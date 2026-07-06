import { useStore } from 'zustand';
import type { Session } from '../content/session';
import { Breadcrumb } from './components/Breadcrumb';
import { Dock } from './components/Dock';
import { ExportDialog } from './components/ExportDialog';
import { RecoveryToast } from './components/RecoveryToast';
import { Toolbar } from './components/Toolbar';

export function App({ session }: { session: Session }) {
  const active = useStore(session.store, (s) => s.active);
  if (!active) return null;
  return (
    <>
      <Toolbar session={session} />
      <Dock session={session} />
      <Breadcrumb session={session} />
      <RecoveryToast session={session} />
      <ExportDialog session={session} />
    </>
  );
}
