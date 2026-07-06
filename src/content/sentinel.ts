// Watches for PAGE-initiated mutations (SPA re-renders, framework hydration)
// that clobber Morph's edits. It is NOT an undo mechanism — inverses are
// captured at apply time. When an edited element is removed by code other than
// Morph, the sentinel marks the affected revisions stale and surfaces a
// one-click "re-apply" so the user can recover.
import { createStore } from 'zustand/vanilla';
import { isMorphNode } from './dom-utils';

export interface SentinelState {
  /** True when external code removed elements an applied revision touched. */
  staleDetected: boolean;
  /** How many applied revisions look affected. */
  affectedCount: number;
  dismissed: boolean;
}

export type SentinelStore = ReturnType<typeof createSentinelStore>;

function createSentinelStore() {
  return createStore<SentinelState>()(() => ({
    staleDetected: false,
    affectedCount: 0,
    dismissed: false,
  }));
}

export interface SentinelDeps {
  /** Elements currently tracked by refs that Morph edited. */
  trackedElements(): Element[];
  onStale(): void;
}

export class Sentinel {
  readonly store: SentinelStore = createSentinelStore();
  private observer: MutationObserver;
  private suspended = 0;
  private debounce: ReturnType<typeof setTimeout> | null = null;

  constructor(private deps: SentinelDeps) {
    this.observer = new MutationObserver((records) => this.onMutations(records));
  }

  start(): void {
    this.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  stop(): void {
    this.observer.disconnect();
    if (this.debounce) clearTimeout(this.debounce);
  }

  /** Run a synchronous mutation Morph owns without tripping the sentinel. */
  shield<T>(fn: () => T): T {
    this.suspended += 1;
    try {
      return fn();
    } finally {
      // Let our own mutation records flush (microtask) before re-arming.
      const token = this.suspended;
      queueMicrotask(() => {
        if (this.suspended === token) this.suspended -= 1;
        else this.suspended = Math.max(0, this.suspended - 1);
      });
    }
  }

  /** Run an async mutation Morph owns without tripping the sentinel. */
  async suspendDuring<T>(fn: () => Promise<T>): Promise<T> {
    this.suspended += 1;
    try {
      return await fn();
    } finally {
      // Let our own mutation records flush before re-arming.
      await new Promise<void>((r) => queueMicrotask(r));
      this.suspended = Math.max(0, this.suspended - 1);
    }
  }

  reset(): void {
    this.store.setState({ staleDetected: false, affectedCount: 0, dismissed: false });
  }

  dismiss(): void {
    this.store.setState({ dismissed: true });
  }

  private onMutations(records: MutationRecord[]): void {
    if (this.suspended > 0) return;

    let externalRemoval = false;
    for (const record of records) {
      if (record.type !== 'childList') continue;
      if (isMorphNode(record.target)) continue;
      for (const removed of record.removedNodes) {
        if (removed.nodeType !== Node.ELEMENT_NODE) continue;
        if (isMorphNode(removed)) continue;
        externalRemoval = true;
        break;
      }
      if (externalRemoval) break;
    }
    if (!externalRemoval) return;

    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.evaluate(), 250);
  }

  /** After the dust settles, check whether tracked elements actually vanished. */
  private evaluate(): void {
    const tracked = this.deps.trackedElements();
    const missing = tracked.filter((el) => !el.isConnected).length;
    if (missing === 0) return;
    const prev = this.store.getState();
    this.store.setState({ staleDetected: true, affectedCount: missing, dismissed: prev.dismissed });
    this.deps.onStale();
  }
}
