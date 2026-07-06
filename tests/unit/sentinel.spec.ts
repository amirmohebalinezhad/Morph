// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Sentinel } from '../../src/content/sentinel';

describe('Sentinel', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="a"><span id="tracked">x</span></div><div id="b">y</div>';
  });

  function makeSentinel(tracked: () => Element[]) {
    const onStale = vi.fn();
    const s = new Sentinel({ trackedElements: tracked, onStale });
    s.start();
    return { s, onStale };
  }

  it('fires when external code removes a tracked element', async () => {
    const tracked = document.getElementById('tracked')!;
    const { s, onStale } = makeSentinel(() => [tracked]);

    // Simulate an SPA blowing away the region.
    document.getElementById('a')!.remove();

    await new Promise((r) => setTimeout(r, 350));
    expect(onStale).toHaveBeenCalled();
    expect(s.store.getState().staleDetected).toBe(true);
    expect(s.store.getState().affectedCount).toBe(1);
    s.stop();
  });

  it('stays quiet for removals of untracked elements', async () => {
    const tracked = document.getElementById('tracked')!;
    const { s, onStale } = makeSentinel(() => [tracked]);

    document.getElementById('b')!.remove(); // not tracked

    await new Promise((r) => setTimeout(r, 350));
    expect(onStale).not.toHaveBeenCalled();
    expect(s.store.getState().staleDetected).toBe(false);
    s.stop();
  });

  it('ignores mutations wrapped in shield() (Morph’s own edits)', async () => {
    const tracked = document.getElementById('tracked')!;
    const { s, onStale } = makeSentinel(() => [tracked]);

    s.shield(() => document.getElementById('a')!.remove());

    await new Promise((r) => setTimeout(r, 350));
    expect(onStale).not.toHaveBeenCalled();
    s.stop();
  });

  it('ignores async mutations wrapped in suspendDuring()', async () => {
    const tracked = document.getElementById('tracked')!;
    const { s, onStale } = makeSentinel(() => [tracked]);

    await s.suspendDuring(async () => {
      await Promise.resolve();
      document.getElementById('a')!.remove();
    });

    await new Promise((r) => setTimeout(r, 350));
    expect(onStale).not.toHaveBeenCalled();
    s.stop();
  });
});
