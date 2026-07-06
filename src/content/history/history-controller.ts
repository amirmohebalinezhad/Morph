// Bridges the revision tree to the rest of the app: commits AI/manual edits,
// runs undo/redo/jump, and mirrors a serializable view into a zustand store
// for the timeline UI.
import { createStore } from 'zustand/vanilla';
import { describeOp, type EditPlan } from '../../shared/edit-ops';
import { applyPlan, ApplyError, type ApplyDeps, type ApplyResult } from '../ops/apply';
import type { MorphStore } from '../store';
import { RevisionTree, type Revision, type RevisionKind } from './revision-tree';

export interface RevisionView {
  id: string;
  kind: RevisionKind;
  instruction: string;
  summary: string;
  createdAt: number;
  stale: boolean;
  isHead: boolean;
  /** True for lineage entries beyond head (redo preview). */
  isAhead: boolean;
  skippedCount: number;
  /** >1 means this node's parent has alternatives (branching point). */
  siblingCount: number;
  siblingIndex: number;
  parentId: string | null;
}

export interface HistoryViewState {
  lineage: RevisionView[];
  canUndo: boolean;
  canRedo: boolean;
  headId: string;
}

export type HistoryStore = ReturnType<typeof createHistoryViewStore>;

function createHistoryViewStore() {
  return createStore<HistoryViewState>()(() => ({
    lineage: [],
    canUndo: false,
    canRedo: false,
    headId: 'root',
  }));
}

export class HistoryController {
  readonly tree = new RevisionTree();
  readonly view: HistoryStore;
  /** Wraps synchronous DOM-mutating tree ops so the sentinel ignores them. */
  shield: <T>(fn: () => T) => T = (fn) => fn();
  /** Wraps async DOM-mutating apply so the sentinel ignores them. */
  shieldAsync: <T>(fn: () => Promise<T>) => Promise<T> = (fn) => fn();

  constructor(
    private morphStore: MorphStore,
    private applyDeps: ApplyDeps,
    private onHistoryChanged?: () => void,
  ) {
    this.view = createHistoryViewStore();
    this.publish();
  }

  commit(kind: RevisionKind, instruction: string, plan: EditPlan, result: ApplyResult): Revision {
    const rev = this.tree.commit({
      kind,
      instruction,
      summary: plan.summary,
      ops: plan.operations,
      applied: result.applied,
      skipped: result.skipped,
    });
    this.afterMutation();
    return rev;
  }

  /** Applies a synthesized (manual) plan and commits it in one step. */
  async applyAndCommitManual(instruction: string, plan: EditPlan): Promise<ApplyResult> {
    const result = await this.shieldAsync(() => applyPlan(plan, this.applyDeps));
    this.commit('manual', instruction, plan, result);
    return result;
  }

  undo(): void {
    if (this.shield(() => this.tree.undo())) this.afterMutation();
  }

  redo(): void {
    if (this.shield(() => this.tree.redo())) this.afterMutation();
  }

  jumpTo(id: string): void {
    if (id === this.tree.head.id) return;
    this.shield(() => this.tree.checkout(id));
    this.afterMutation();
  }

  /**
   * Recovery after an external re-render clobbered edits: replays every
   * applied revision root→head from its serializable ops (fresh ref
   * resolution), rebuilding the live inverse closures. Ops that no longer
   * resolve are dropped and their revision marked stale.
   * Returns the count of revisions that could not be fully re-applied.
   */
  async replayFromRoot(): Promise<{ replayed: number; staleCount: number }> {
    const lineage = this.tree.pathToRoot(this.tree.head.id).reverse().filter((r) => r.parentId !== null);
    let staleCount = 0;
    let replayed = 0;

    for (const rev of lineage) {
      if (rev.ops.length === 0) continue;
      const plan: EditPlan = {
        summary: rev.summary,
        operations: rev.ops.map((op) => ({ ...op })),
        question: null,
        notes: null,
      };
      try {
        const result = await applyPlan(plan, this.applyDeps);
        rev.applied = result.applied;
        rev.skipped = result.skipped;
        rev.stale = false;
        replayed += 1;
      } catch (err) {
        // Element(s) truly gone — keep the revision but mark it unrecoverable.
        rev.applied = [];
        rev.stale = true;
        staleCount += 1;
        if (!(err instanceof ApplyError)) console.warn('[morph] replay failed', err);
      }
    }

    this.afterMutation();
    return { replayed, staleCount };
  }

  appliedSummaries(): string[] {
    return this.tree.appliedSummaries();
  }

  /** Ops digest for conversation/export contexts. */
  describeRevision(rev: Revision): string {
    return `${rev.summary}\nOps: ${rev.ops.map(describeOp).join('; ') || '(none)'}`;
  }

  private afterMutation(): void {
    // Elements can vanish on undo/checkout; drop them from the selection.
    this.morphStore.getState().pruneSelection();
    this.publish();
    this.onHistoryChanged?.();
  }

  private publish(): void {
    const headPath = new Set(this.tree.pathToRoot(this.tree.head.id).map((r) => r.id));
    const lineage = this.tree.lineage().map((rev): RevisionView => {
      const siblings = rev.parentId ? this.tree.childrenOf(rev.parentId) : [];
      return {
        id: rev.id,
        kind: rev.kind,
        instruction: rev.instruction,
        summary: rev.summary,
        createdAt: rev.createdAt,
        stale: rev.stale,
        isHead: rev.id === this.tree.head.id,
        isAhead: !headPath.has(rev.id),
        skippedCount: rev.skipped.length,
        siblingCount: siblings.length,
        siblingIndex: siblings.findIndex((s) => s.id === rev.id),
        parentId: rev.parentId,
      };
    });
    this.view.setState({
      lineage,
      canUndo: this.tree.canUndo(),
      canRedo: this.tree.canRedo(),
      headId: this.tree.head.id,
    });
  }

  /** Switches to another child branch of the given revision's parent. */
  switchBranch(view: RevisionView, direction: 1 | -1): void {
    if (!view.parentId) return;
    const siblings = this.tree.childrenOf(view.parentId);
    if (siblings.length < 2) return;
    const next = siblings[(view.siblingIndex + direction + siblings.length) % siblings.length];
    if (next) this.jumpTo(next.id);
  }
}
