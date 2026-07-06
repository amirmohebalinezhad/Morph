// Bridges the revision tree to the rest of the app: commits AI/manual edits,
// runs undo/redo/jump, and mirrors a serializable view into a zustand store
// for the timeline UI.
import { createStore } from 'zustand/vanilla';
import { describeOp, type EditOp, type EditPlan } from '../../shared/edit-ops';
import { applyPlan, type ApplyDeps, type ApplyResult } from '../ops/apply';
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
    const result = await applyPlan(plan, this.applyDeps);
    this.commit('manual', instruction, plan, result);
    return result;
  }

  undo(): void {
    if (this.tree.undo()) this.afterMutation();
  }

  redo(): void {
    if (this.tree.redo()) this.afterMutation();
  }

  jumpTo(id: string): void {
    if (id === this.tree.head.id) return;
    this.tree.checkout(id);
    this.afterMutation();
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
