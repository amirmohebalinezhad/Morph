// The prototype's history: a tree of revisions (committing on a non-leaf head
// forks a branch). Each revision owns the live AppliedOp closures captured at
// apply time; checkout walks undo up to the lowest common ancestor and redo
// down to the target. All state is in-memory and dies with the page — by
// design.
import type { EditOp } from '../../shared/edit-ops';
import { genId } from '../../shared/ids';
import type { AppliedOp, SkippedOp } from '../ops/apply';

export type RevisionKind = 'ai' | 'manual';

export interface Revision {
  id: string;
  parentId: string | null;
  kind: RevisionKind;
  /** User prompt, or e.g. "Manual: deleted button#save". */
  instruction: string;
  summary: string;
  /** Serializable intent — replay/recovery and export read these. */
  ops: EditOp[];
  /** Live closures — undo/redo/checkout run these. */
  applied: AppliedOp[];
  skipped: SkippedOp[];
  childIds: string[];
  /** Which child "redo" follows (the most recently taken path). */
  activeChildId: string | null;
  createdAt: number;
  /** Set when an external re-render likely clobbered this revision's work. */
  stale: boolean;
}

export interface CommitInput {
  kind: RevisionKind;
  instruction: string;
  summary: string;
  ops: EditOp[];
  applied: AppliedOp[];
  skipped: SkippedOp[];
}

export class RevisionTree {
  readonly nodes = new Map<string, Revision>();
  readonly root: Revision;
  head: Revision;

  constructor() {
    this.root = {
      id: 'root',
      parentId: null,
      kind: 'manual',
      instruction: 'Original page',
      summary: 'The page as it loaded, before any Morph edits.',
      ops: [],
      applied: [],
      skipped: [],
      childIds: [],
      activeChildId: null,
      createdAt: Date.now(),
      stale: false,
    };
    this.nodes.set(this.root.id, this.root);
    this.head = this.root;
  }

  commit(input: CommitInput): Revision {
    const rev: Revision = {
      id: genId('rev'),
      parentId: this.head.id,
      kind: input.kind,
      instruction: input.instruction,
      summary: input.summary,
      ops: input.ops,
      applied: input.applied,
      skipped: input.skipped,
      childIds: [],
      activeChildId: null,
      createdAt: Date.now(),
      stale: false,
    };
    this.nodes.set(rev.id, rev);
    this.head.childIds.push(rev.id); // second+ child = a branch
    this.head.activeChildId = rev.id;
    this.head = rev;
    return rev;
  }

  canUndo(): boolean {
    return this.head !== this.root;
  }

  canRedo(): boolean {
    return this.head.activeChildId !== null;
  }

  undo(): boolean {
    if (!this.canUndo()) return false;
    this.checkout(this.head.parentId!);
    return true;
  }

  redo(): boolean {
    const next = this.head.activeChildId;
    if (!next) return false;
    this.checkout(next);
    return true;
  }

  /** Path from the given revision up to (and including) the root. */
  pathToRoot(id: string): Revision[] {
    const path: Revision[] = [];
    let cur = this.nodes.get(id) ?? null;
    while (cur) {
      path.push(cur);
      cur = cur.parentId ? (this.nodes.get(cur.parentId) ?? null) : null;
    }
    return path;
  }

  /**
   * Moves head to `targetId`, undoing/redoing along the tree path. Marks the
   * taken path as active so redo follows it.
   */
  checkout(targetId: string): void {
    const target = this.nodes.get(targetId);
    if (!target || target === this.head) return;

    const upPath = this.pathToRoot(this.head.id);
    const downIds = new Set(this.pathToRoot(targetId).map((r) => r.id));
    const lca = upPath.find((r) => downIds.has(r.id)) ?? this.root;

    // Undo newest → oldest until (exclusive) the LCA.
    for (const rev of upPath) {
      if (rev.id === lca.id) break;
      for (const ap of [...rev.applied].reverse()) ap.undo();
    }

    // Redo oldest → newest along target's path, strictly below the LCA.
    const down: Revision[] = [];
    for (const rev of this.pathToRoot(targetId)) {
      if (rev.id === lca.id) break;
      down.push(rev);
    }
    down.reverse();
    for (const rev of down) {
      for (const ap of rev.applied) ap.redo();
      const parent = rev.parentId ? this.nodes.get(rev.parentId) : null;
      if (parent) parent.activeChildId = rev.id;
    }

    this.head = target;
  }

  /**
   * The timeline to display: root → head, then the forward activeChild chain
   * beyond head (redo preview).
   */
  lineage(): Revision[] {
    const back = this.pathToRoot(this.head.id);
    back.reverse();
    let cur = this.head;
    while (cur.activeChildId) {
      const next = this.nodes.get(cur.activeChildId);
      if (!next) break;
      back.push(next);
      cur = next;
    }
    return back;
  }

  childrenOf(id: string): Revision[] {
    const rev = this.nodes.get(id);
    if (!rev) return [];
    return rev.childIds
      .map((cid) => this.nodes.get(cid))
      .filter((r): r is Revision => r !== undefined);
  }

  /** Summaries of everything currently applied (root exclusive → head). */
  appliedSummaries(): string[] {
    return this.pathToRoot(this.head.id)
      .reverse()
      .filter((r) => r !== this.root)
      .map((r) => r.summary);
  }
}
