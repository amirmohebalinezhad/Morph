import { describe, expect, it } from 'vitest';
import { RevisionTree } from '../../src/content/history/revision-tree';
import type { AppliedOp } from '../../src/content/ops/apply';

function fakeOps(log: string[], name: string, count = 2): AppliedOp[] {
  return Array.from({ length: count }, (_, i) => ({
    op: { op: 'setText', ref: 'e1', text: `${name}${i}` },
    undo: () => log.push(`undo:${name}${i}`),
    redo: () => log.push(`redo:${name}${i}`),
  }));
}

function commit(tree: RevisionTree, log: string[], name: string, count = 2) {
  return tree.commit({
    kind: 'ai',
    instruction: name,
    summary: `${name} summary`,
    ops: [],
    applied: fakeOps(log, name, count),
    skipped: [],
  });
}

describe('RevisionTree', () => {
  it('undo runs a revision’s ops in reverse order; redo forward', () => {
    const tree = new RevisionTree();
    const log: string[] = [];
    commit(tree, log, 'A');
    tree.undo();
    expect(log).toEqual(['undo:A1', 'undo:A0']);
    log.length = 0;
    tree.redo();
    expect(log).toEqual(['redo:A0', 'redo:A1']);
  });

  it('undo walks newest revision first', () => {
    const tree = new RevisionTree();
    const log: string[] = [];
    commit(tree, log, 'A', 1);
    commit(tree, log, 'B', 1);
    tree.checkout('root');
    expect(log).toEqual(['undo:B0', 'undo:A0']);
  });

  it('committing after undo creates a branch and redo follows the new one', () => {
    const tree = new RevisionTree();
    const log: string[] = [];
    const a = commit(tree, log, 'A', 1);
    commit(tree, log, 'B', 1);
    tree.undo(); // head = A
    expect(tree.head.id).toBe(a.id);
    const c = commit(tree, log, 'C', 1);
    expect(tree.childrenOf(a.id).map((r) => r.instruction)).toEqual(['B', 'C']);
    expect(a.activeChildId).toBe(c.id);

    tree.undo();
    log.length = 0;
    tree.redo(); // follows the active (new) branch
    expect(log).toEqual(['redo:C0']);
    expect(tree.head.id).toBe(c.id);
  });

  it('checkout across a fork undoes to the LCA then redoes down', () => {
    const tree = new RevisionTree();
    const log: string[] = [];
    commit(tree, log, 'A', 1);
    const b = commit(tree, log, 'B', 1);
    tree.undo(); // back to A
    const c = commit(tree, log, 'C', 1);
    const d = commit(tree, log, 'D', 1);
    expect(tree.head.id).toBe(d.id);

    log.length = 0;
    tree.checkout(b.id); // D → C → (A = LCA) → B
    expect(log).toEqual(['undo:D0', 'undo:C0', 'redo:B0']);
    expect(tree.head.id).toBe(b.id);

    log.length = 0;
    tree.checkout(c.id); // B → (A) → C
    expect(log).toEqual(['undo:B0', 'redo:C0']);
    expect(tree.head.id).toBe(c.id);
  });

  it('jump to root and back replays everything in order', () => {
    const tree = new RevisionTree();
    const log: string[] = [];
    commit(tree, log, 'A', 1);
    commit(tree, log, 'B', 1);
    const c = commit(tree, log, 'C', 1);
    log.length = 0;
    tree.checkout('root');
    expect(log).toEqual(['undo:C0', 'undo:B0', 'undo:A0']);
    log.length = 0;
    tree.checkout(c.id);
    expect(log).toEqual(['redo:A0', 'redo:B0', 'redo:C0']);
  });

  it('lineage shows the redo preview beyond head', () => {
    const tree = new RevisionTree();
    const log: string[] = [];
    commit(tree, log, 'A', 1);
    commit(tree, log, 'B', 1);
    tree.undo();
    const names = tree.lineage().map((r) => r.instruction);
    expect(names).toEqual(['Original page', 'A', 'B']);
    expect(tree.head.instruction).toBe('A');
    expect(tree.canRedo()).toBe(true);
  });

  it('appliedSummaries covers only root→head', () => {
    const tree = new RevisionTree();
    const log: string[] = [];
    commit(tree, log, 'A', 1);
    commit(tree, log, 'B', 1);
    tree.undo();
    expect(tree.appliedSummaries()).toEqual(['A summary']);
  });
});
