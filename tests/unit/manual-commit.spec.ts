// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditPlan } from '../../src/shared/edit-ops';
import { ManualEditCoalescer } from '../../src/content/manual/manual-commit';
import { applyPlan, unavailableBehaviorHost, type AppliedOp } from '../../src/content/ops/apply';
import { RefRegistry } from '../../src/content/refs/ref-registry';

describe('ManualEditCoalescer', () => {
  let refs: RefRegistry;
  let commits: Array<{ instruction: string; plan: EditPlan; applied: AppliedOp[] }>;

  function makeCoalescer(debounceMs = 40) {
    refs = new RefRegistry();
    commits = [];
    return new ManualEditCoalescer({
      debounceMs,
      describe: (el) => el.tagName.toLowerCase(),
      refFor: (el) => refs.refFor(el),
      commit: async (instruction, plan) => {
        const result = await applyPlan(plan, { refs, behaviors: unavailableBehaviorHost('n/a') });
        commits.push({ instruction, plan, applied: result.applied });
      },
    });
  }

  beforeEach(() => {
    document.body.innerHTML = '<button id="b" style="color: blue;">x</button>';
  });

  it('coalesces rapid changes into one revision with final values', async () => {
    vi.useFakeTimers();
    const c = makeCoalescer();
    const el = document.getElementById('b')!;

    c.stage(el, 'padding-top', '12px');
    c.stage(el, 'padding-top', '14px');
    c.stage(el, 'padding-top', '16px');
    c.stage(el, 'color', 'red');

    // Live preview is immediate.
    expect((el as HTMLElement).style.paddingTop).toBe('16px');
    expect(commits).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(120);
    vi.useRealTimers();

    expect(commits).toHaveLength(1);
    const op = commits[0]!.plan.operations[0]!;
    expect(op.op).toBe('setStyles');
    if (op.op === 'setStyles') {
      expect(op.styles).toEqual([
        { property: 'padding-top', value: '16px' },
        { property: 'color', value: 'red' },
      ]);
    }
    expect((el as HTMLElement).style.paddingTop).toBe('16px');
  });

  it('undo of the committed revision restores pre-gesture values', async () => {
    vi.useFakeTimers();
    const c = makeCoalescer();
    const el = document.getElementById('b') as HTMLElement;

    c.stage(el, 'color', 'red'); // had inline color: blue
    c.stage(el, 'margin-left', '30px'); // had nothing
    await vi.advanceTimersByTimeAsync(120);
    vi.useRealTimers();

    expect(el.style.color).toBe('red');
    for (const ap of [...commits[0]!.applied].reverse()) ap.undo();
    expect(el.style.color).toBe('blue');
    expect(el.style.marginLeft).toBe('');
  });

  it('separate elements staged together commit as one revision with two ops', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<p id="p1">a</p><p id="p2">b</p>';
    const c = makeCoalescer();
    c.stage(document.getElementById('p1')!, 'font-size', '20px');
    c.stage(document.getElementById('p2')!, 'font-size', '22px');
    await vi.advanceTimersByTimeAsync(120);
    vi.useRealTimers();

    expect(commits).toHaveLength(1);
    expect(commits[0]!.plan.operations).toHaveLength(2);
  });

  it('skips elements that left the DOM before the flush', async () => {
    vi.useFakeTimers();
    const c = makeCoalescer();
    const el = document.getElementById('b')!;
    c.stage(el, 'color', 'red');
    el.remove();
    await vi.advanceTimersByTimeAsync(120);
    vi.useRealTimers();
    expect(commits).toHaveLength(0);
  });
});
