// @vitest-environment jsdom
// apply → undo must restore the DOM exactly; redo must reproduce the applied
// state. Runs under jsdom because the apply pipeline sanitizes via DOMPurify.
import { beforeEach, describe, expect, it } from 'vitest';
import type { EditOp, EditPlan } from '../../src/shared/edit-ops';
import { applyPlan, unavailableBehaviorHost, type ApplyDeps, type AppliedOp } from '../../src/content/ops/apply';
import { RefRegistry } from '../../src/content/refs/ref-registry';

function makeDeps(): ApplyDeps {
  return { refs: new RefRegistry(), behaviors: unavailableBehaviorHost('unavailable in tests') };
}

function plan(ops: EditOp[]): EditPlan {
  return { summary: 'test', operations: ops, question: null, notes: null };
}

function undoAll(applied: AppliedOp[]): void {
  for (const ap of [...applied].reverse()) ap.undo();
}

function redoAll(applied: AppliedOp[]): void {
  for (const ap of applied) ap.redo();
}

/**
 * data-morph-id stamps are inert working metadata (ref resolution / CSS
 * targeting); they survive undo by design. Comparisons ignore them.
 */
function normalize(html: string): string {
  return html.replace(/ data-morph-id="[^"]*"/g, '');
}

beforeEach(() => {
  document.body.innerHTML = `
    <main id="app">
      <section id="hero"><h1 id="title">Hello</h1><p id="sub">Sub</p></section>
      <ul id="list"><li id="a">A</li><li id="b">B</li><li id="c">C</li></ul>
      <button id="btn" class="primary" style="color: blue;">Click</button>
    </main>`;
  document.head.querySelectorAll('style[data-morph-sheet]').forEach((el) => el.remove());
});

describe('per-op inverse fidelity', () => {
  async function roundTrip(ops: EditOp[], deps = makeDeps()) {
    const before = normalize(document.body.innerHTML);
    const { applied, skipped } = await applyPlan(plan(ops), deps);
    expect(skipped).toHaveLength(0);
    const after = normalize(document.body.innerHTML);
    expect(after).not.toBe(before);
    undoAll(applied);
    expect(normalize(document.body.innerHTML)).toBe(before);
    redoAll(applied);
    expect(normalize(document.body.innerHTML)).toBe(after);
    return applied;
  }

  it('setStyles restores prior inline values including absence', async () => {
    const deps = makeDeps();
    const btn = document.getElementById('btn')!;
    const ref = deps.refs.refFor(btn);
    await roundTrip(
      [
        {
          op: 'setStyles',
          ref,
          styles: [
            { property: 'color', value: 'red' }, // had a prior inline value
            { property: 'background-color', value: 'black' }, // did not
          ],
        },
      ],
      deps,
    );
  });

  it('setAttributes restores prior values and removals', async () => {
    const deps = makeDeps();
    const btn = document.getElementById('btn')!;
    const ref = deps.refs.refFor(btn);
    await roundTrip(
      [
        {
          op: 'setAttributes',
          ref,
          attributes: [
            { name: 'class', value: 'secondary' },
            { name: 'aria-label', value: 'Do it' },
          ],
        },
      ],
      deps,
    );
  });

  it('setText keeps the original child nodes alive', async () => {
    const deps = makeDeps();
    const hero = document.getElementById('hero')!;
    const ref = deps.refs.refFor(hero);
    const originalH1 = document.getElementById('title')!;
    const { applied } = await applyPlan(plan([{ op: 'setText', ref, text: 'plain' }]), deps);
    expect(hero.textContent).toBe('plain');
    undoAll(applied);
    // The very same node returns — not a serialized copy.
    expect(document.getElementById('title')).toBe(originalH1);
  });

  it('setHTML round-trips', async () => {
    const deps = makeDeps();
    const ref = deps.refs.refFor(document.getElementById('list')!);
    await roundTrip([{ op: 'setHTML', ref, html: '<li>only</li>' }], deps);
  });

  it('insertElement before/after/prepend/append/replace', async () => {
    for (const position of ['before', 'after', 'prepend', 'append', 'replace'] as const) {
      document.body.innerHTML = `<div id="host"><span id="x">x</span></div>`;
      const deps = makeDeps();
      const ref = deps.refs.refFor(document.getElementById('x')!);
      await roundTrip(
        [{ op: 'insertElement', targetRef: ref, position, html: '<em>new</em>', newRef: 'n1' }],
        deps,
      );
    }
  });

  it('removeElement reinserts the same node at the same position', async () => {
    const deps = makeDeps();
    const b = document.getElementById('b')!;
    const ref = deps.refs.refFor(b);
    const { applied } = await applyPlan(plan([{ op: 'removeElement', ref }]), deps);
    expect(document.getElementById('b')).toBeNull();
    undoAll(applied);
    expect(document.getElementById('b')).toBe(b);
    expect(Array.from(document.querySelectorAll('#list li')).map((li) => li.id)).toEqual(['a', 'b', 'c']);
  });

  it('removeElement undo preserves page event listeners', async () => {
    const deps = makeDeps();
    const btn = document.getElementById('btn')!;
    let clicks = 0;
    btn.addEventListener('click', () => clicks++);
    const { applied } = await applyPlan(plan([{ op: 'removeElement', ref: deps.refs.refFor(btn) }]), deps);
    undoAll(applied);
    document.getElementById('btn')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(clicks).toBe(1);
  });

  it('moveElement returns the node to its original slot', async () => {
    const deps = makeDeps();
    const a = deps.refs.refFor(document.getElementById('a')!);
    const c = deps.refs.refFor(document.getElementById('c')!);
    await roundTrip([{ op: 'moveElement', ref: a, targetRef: c, position: 'after' }], deps);
  });

  it('duplicateElement strips morph ids from the clone', async () => {
    const deps = makeDeps();
    const btn = document.getElementById('btn')!;
    const ref = deps.refs.refFor(btn);
    btn.setAttribute('data-morph-id', ref);
    const { applied } = await applyPlan(plan([{ op: 'duplicateElement', ref, newRef: 'n1' }]), deps);
    const clones = document.querySelectorAll('#app button');
    expect(clones).toHaveLength(2);
    expect(clones[1]!.getAttribute('data-morph-id')).toBe('n1');
    undoAll(applied);
    expect(document.querySelectorAll('#app button')).toHaveLength(1);
  });

  it('wrapElements unwraps cleanly', async () => {
    const deps = makeDeps();
    const a = deps.refs.refFor(document.getElementById('a')!);
    const b = deps.refs.refFor(document.getElementById('b')!);
    await roundTrip(
      [{ op: 'wrapElements', refs: [a, b], wrapperHtml: '<div class="wrap"></div>', newRef: 'n1' }],
      deps,
    );
  });

  it('upsertStylesheet restores prior css and absence', async () => {
    const deps = makeDeps();
    const first = await applyPlan(plan([{ op: 'upsertStylesheet', id: 's', css: '.a{color:red}' }]), deps);
    const second = await applyPlan(plan([{ op: 'upsertStylesheet', id: 's', css: '.a{color:blue}' }]), deps);
    expect(document.head.querySelector('style[data-morph-sheet="s"]')!.textContent).toBe('.a{color:blue}');
    undoAll(second.applied);
    expect(document.head.querySelector('style[data-morph-sheet="s"]')!.textContent).toBe('.a{color:red}');
    undoAll(first.applied);
    expect(document.head.querySelector('style[data-morph-sheet="s"]')).toBeNull();
  });

  it('rolls back atomically when a later op fails', async () => {
    const deps = makeDeps();
    const before = normalize(document.body.innerHTML);
    const ref = deps.refs.refFor(document.getElementById('btn')!);
    await expect(
      applyPlan(
        plan([
          { op: 'setStyles', ref, styles: [{ property: 'color', value: 'red' }] },
          { op: 'removeElement', ref: 'e999' }, // unknown ref → throws
        ]),
        deps,
      ),
    ).rejects.toThrow(/e999/);
    expect(normalize(document.body.innerHTML)).toBe(before);
  });

  it('renames colliding newRefs across plans', async () => {
    const deps = makeDeps();
    const ref = deps.refs.refFor(document.getElementById('btn')!);
    await applyPlan(
      plan([{ op: 'insertElement', targetRef: ref, position: 'after', html: '<i>1</i>', newRef: 'n1' }]),
      deps,
    );
    const p2 = plan([
      { op: 'insertElement', targetRef: ref, position: 'after', html: '<i>2</i>', newRef: 'n1' },
      { op: 'setStyles', ref: 'n1', styles: [{ property: 'color', value: 'red' }] },
    ]);
    await applyPlan(p2, deps);
    const marks = document.querySelectorAll('i');
    expect(marks).toHaveLength(2);
    const ids = Array.from(marks).map((m) => m.getAttribute('data-morph-id'));
    expect(new Set(ids).size).toBe(2); // no duplicate morph ids
    // The follow-up op inside plan 2 targeted the RENAMED element.
    const renamed = Array.from(marks).find((m) => m.textContent === '2')!;
    expect((renamed as HTMLElement).style.color).toBe('red');
  });
});

describe('randomized op sequences invert perfectly', () => {
  function lcg(seed: number) {
    let s = seed;
    return () => (s = (s * 48271) % 2147483647) / 2147483647;
  }

  it('20 random ops undo to the exact original DOM (3 seeds)', async () => {
    for (const seed of [7, 99, 12345]) {
      document.body.innerHTML = `
        <div id="root">
          <section class="s1"><p>one</p><p>two</p><button>b1</button></section>
          <section class="s2"><span>alpha</span><span>beta</span><ul><li>1</li><li>2</li><li>3</li></ul></section>
        </div>`;
      const rand = lcg(seed);
      const deps = makeDeps();
      const before = normalize(document.body.innerHTML);
      const allApplied: AppliedOp[] = [];

      const pickEl = (): Element | null => {
        const all = Array.from(document.querySelectorAll('#root *'));
        return all.length ? (all[Math.floor(rand() * all.length)] ?? null) : null;
      };

      for (let i = 0; i < 20; i++) {
        const el = pickEl();
        if (!el) break;
        const ref = deps.refs.refFor(el);
        const roll = rand();
        let op: EditOp;
        if (roll < 0.2) {
          op = { op: 'setStyles', ref, styles: [{ property: 'margin-top', value: `${i}px` }] };
        } else if (roll < 0.35) {
          op = { op: 'setAttributes', ref, attributes: [{ name: `data-t${i}`, value: 'x' }] };
        } else if (roll < 0.5) {
          op = { op: 'insertElement', targetRef: ref, position: 'after', html: `<b>ins${i}</b>`, newRef: `n${i}` };
        } else if (roll < 0.62) {
          const target = pickEl();
          if (!target || target === el || el.contains(target) || target.contains(el)) continue;
          op = { op: 'moveElement', ref, targetRef: deps.refs.refFor(target), position: 'append' };
        } else if (roll < 0.74) {
          if (el.id === 'root') continue;
          op = { op: 'removeElement', ref };
        } else if (roll < 0.86) {
          op = { op: 'duplicateElement', ref, newRef: `d${i}` };
        } else {
          if (el.id === 'root') continue;
          op = { op: 'wrapElements', refs: [ref], wrapperHtml: `<div data-wrap="${i}"></div>`, newRef: `w${i}` };
        }
        try {
          const { applied } = await applyPlan(plan([op]), deps);
          allApplied.push(...applied);
        } catch {
          // some random combos legitimately fail (e.g. move into detached) —
          // applyPlan rolls itself back, so state stays consistent
        }
      }

      expect(allApplied.length).toBeGreaterThan(5);
      undoAll(allApplied);
      expect(normalize(document.body.innerHTML)).toBe(before);
    }
  });
});
