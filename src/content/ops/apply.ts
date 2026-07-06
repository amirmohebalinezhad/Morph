// Executes a validated EditPlan against the live DOM. Every op captures a
// precise inverse AT APPLY TIME, holding real detached Node references — so
// undoing a removeElement reinserts the *same* node and page event listeners
// survive. DOM/style ops are atomic per plan: a failure at op N rolls back
// N-1..0. Behavior/mock ops degrade gracefully (skipped with a reason) since
// page CSP can legitimately block them.
import { describeOp, type EditOp, type EditPlan, type MockRule } from '../../shared/edit-ops';
import { genId } from '../../shared/ids';
import type { RefRegistry } from '../refs/ref-registry';
import { sanitizeToElement, sanitizeToFragment } from './sanitize';
import { removeStylesheet, upsertStylesheet } from './stylesheets';

export interface AppliedOp {
  op: EditOp;
  undo(): void;
  redo(): void;
}

export interface SkippedOp {
  op: EditOp;
  reason: string;
}

export interface ApplyResult {
  applied: AppliedOp[];
  skipped: SkippedOp[];
}

/** Behavior/network-mock execution, implemented by the M4 runtime. */
export interface BehaviorHost {
  addBehavior(id: string, description: string, js: string): Promise<{ ok: boolean; reason?: string }>;
  removeBehavior(id: string): void;
  /** Re-executes the stored js for a behavior previously added (redo path). */
  reAddBehavior(id: string): void;
  applyMockRules(key: string, rules: MockRule[]): Promise<{ ok: boolean; reason?: string }>;
  removeMockRules(key: string): void;
  reApplyMockRules(key: string): void;
}

export interface ApplyDeps {
  refs: RefRegistry;
  behaviors: BehaviorHost;
}

export class ApplyError extends Error {
  constructor(
    public readonly opIndex: number,
    public readonly opDigest: string,
    message: string,
  ) {
    super(`op ${opIndex + 1} (${opDigest}): ${message}`);
    this.name = 'ApplyError';
  }
}

type InsertPosition = 'before' | 'after' | 'prepend' | 'append';

function insertRelative(target: Element, node: Node, position: InsertPosition): void {
  switch (position) {
    case 'before':
      target.before(node);
      break;
    case 'after':
      target.after(node);
      break;
    case 'prepend':
      target.prepend(node);
      break;
    case 'append':
      target.append(node);
      break;
  }
}

function quiet(fn: () => void): void {
  try {
    fn();
  } catch (err) {
    console.warn('[morph] undo/redo step failed', err);
  }
}

/**
 * Applies the plan sequentially (later ops may reference n-refs created by
 * earlier ones). Throws ApplyError after rolling back on DOM-op failure.
 */
export async function applyPlan(plan: EditPlan, deps: ApplyDeps): Promise<ApplyResult> {
  const applied: AppliedOp[] = [];
  const skipped: SkippedOp[] = [];

  for (let i = 0; i < plan.operations.length; i++) {
    const op = plan.operations[i]!;
    try {
      const outcome = await executeOp(op, deps);
      if ('skip' in outcome) skipped.push({ op, reason: outcome.skip });
      else applied.push(outcome);
    } catch (err) {
      for (const done of [...applied].reverse()) quiet(() => done.undo());
      throw new ApplyError(i, describeOp(op), err instanceof Error ? err.message : String(err));
    }
  }
  return { applied, skipped };
}

function mustResolve(refs: RefRegistry, ref: string): Element {
  const el = refs.resolve(ref);
  if (!el) throw new Error(`element "${ref}" no longer exists on the page`);
  return el;
}

async function executeOp(op: EditOp, deps: ApplyDeps): Promise<AppliedOp | { skip: string }> {
  const { refs, behaviors } = deps;

  switch (op.op) {
    case 'setStyles': {
      const el = mustResolve(refs, op.ref) as HTMLElement | SVGElement;
      refs.stamp(op.ref, el);
      const style = el.style;
      const prev = op.styles.map((s) => ({
        property: s.property,
        value: style.getPropertyValue(s.property),
        priority: style.getPropertyPriority(s.property),
      }));
      const apply = () => {
        for (const s of op.styles) {
          if (s.value === null) {
            style.removeProperty(s.property);
          } else {
            const important = /\s*!important\s*$/i.test(s.value);
            const value = s.value.replace(/\s*!important\s*$/i, '');
            style.setProperty(s.property, value, important ? 'important' : '');
          }
        }
      };
      apply();
      return {
        op,
        undo: () =>
          quiet(() => {
            for (const p of prev) {
              if (p.value === '') style.removeProperty(p.property);
              else style.setProperty(p.property, p.value, p.priority);
            }
          }),
        redo: () => quiet(apply),
      };
    }

    case 'setAttributes': {
      const el = mustResolve(refs, op.ref);
      refs.stamp(op.ref, el);
      const prev = op.attributes.map((a) => ({ name: a.name, value: el.getAttribute(a.name) }));
      const apply = () => {
        for (const a of op.attributes) {
          if (isForbiddenAttribute(a.name)) continue;
          if (a.value === null) el.removeAttribute(a.name);
          else el.setAttribute(a.name, a.value);
        }
      };
      apply();
      return {
        op,
        undo: () =>
          quiet(() => {
            for (const p of prev) {
              if (p.value === null) el.removeAttribute(p.name);
              else el.setAttribute(p.name, p.value);
            }
          }),
        redo: () => quiet(apply),
      };
    }

    case 'setText': {
      const el = mustResolve(refs, op.ref);
      refs.stamp(op.ref, el);
      const prevChildren = Array.from(el.childNodes);
      const textNode = document.createTextNode(op.text);
      el.replaceChildren(textNode);
      return {
        op,
        undo: () => quiet(() => el.replaceChildren(...prevChildren)),
        redo: () => quiet(() => el.replaceChildren(textNode)),
      };
    }

    case 'setHTML': {
      const el = mustResolve(refs, op.ref);
      refs.stamp(op.ref, el);
      const prevChildren = Array.from(el.childNodes);
      const newChildren = Array.from(sanitizeToFragment(op.html).childNodes);
      el.replaceChildren(...newChildren);
      return {
        op,
        undo: () => quiet(() => el.replaceChildren(...prevChildren)),
        redo: () => quiet(() => el.replaceChildren(...newChildren)),
      };
    }

    case 'insertElement': {
      const target = mustResolve(refs, op.targetRef);
      const newEl = sanitizeToElement(op.html);
      refs.register(op.newRef, newEl);

      if (op.position === 'replace') {
        target.replaceWith(newEl);
        return {
          op,
          undo: () => quiet(() => newEl.replaceWith(target)),
          redo: () => quiet(() => target.replaceWith(newEl)),
        };
      }
      refs.stamp(op.targetRef, target);
      insertRelative(target, newEl, op.position);
      return {
        op,
        undo: () => quiet(() => newEl.remove()),
        redo: () => quiet(() => insertRelative(target, newEl, op.position as InsertPosition)),
      };
    }

    case 'removeElement': {
      const el = mustResolve(refs, op.ref);
      const parent = el.parentNode;
      const next = el.nextSibling;
      if (!parent) throw new Error(`element "${op.ref}" has no parent`);
      el.remove();
      return {
        op,
        undo: () => quiet(() => parent.insertBefore(el, next && next.parentNode === parent ? next : null)),
        redo: () => quiet(() => el.remove()),
      };
    }

    case 'moveElement': {
      const el = mustResolve(refs, op.ref);
      const target = mustResolve(refs, op.targetRef);
      if (el === target || el.contains(target)) {
        throw new Error('cannot move an element into itself');
      }
      const parent = el.parentNode;
      const next = el.nextSibling;
      if (!parent) throw new Error(`element "${op.ref}" has no parent`);
      refs.stamp(op.ref, el);
      insertRelative(target, el, op.position);
      return {
        op,
        undo: () => quiet(() => parent.insertBefore(el, next && next.parentNode === parent ? next : null)),
        redo: () => quiet(() => insertRelative(target, el, op.position)),
      };
    }

    case 'duplicateElement': {
      const el = mustResolve(refs, op.ref);
      const clone = el.cloneNode(true) as Element;
      // Our ids must stay unique; the page's own ids are left alone (this is
      // an in-memory prototype, not production markup).
      clone.removeAttribute('data-morph-id');
      for (const inner of clone.querySelectorAll('[data-morph-id]')) {
        inner.removeAttribute('data-morph-id');
      }
      refs.register(op.newRef, clone);
      el.after(clone);
      return {
        op,
        undo: () => quiet(() => clone.remove()),
        redo: () => quiet(() => el.after(clone)),
      };
    }

    case 'wrapElements': {
      if (op.refs.length === 0) throw new Error('wrapElements requires at least one ref');
      const els = op.refs.map((r) => mustResolve(refs, r));
      const parent = els[0]!.parentNode;
      if (!parent || els.some((e) => e.parentNode !== parent)) {
        throw new Error('wrapElements targets must be siblings');
      }
      const inDomOrder = [...els].sort((a, b) =>
        a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
      );
      const wrapper = sanitizeToElement(op.wrapperHtml);
      refs.register(op.newRef, wrapper);
      const first = inDomOrder[0]!;
      parent.insertBefore(wrapper, first);
      wrapper.append(...inDomOrder);
      return {
        op,
        undo: () =>
          quiet(() => {
            for (const el of inDomOrder) wrapper.before(el);
            wrapper.remove();
          }),
        redo: () =>
          quiet(() => {
            inDomOrder[0]!.before(wrapper);
            wrapper.append(...inDomOrder);
          }),
      };
    }

    case 'upsertStylesheet': {
      const prev = upsertStylesheet(op.id, op.css);
      return {
        op,
        undo: () =>
          quiet(() => {
            if (prev === null) removeStylesheet(op.id);
            else upsertStylesheet(op.id, prev);
          }),
        redo: () => quiet(() => upsertStylesheet(op.id, op.css)),
      };
    }

    case 'addBehavior': {
      const res = await behaviors.addBehavior(op.id, op.description, op.js);
      if (!res.ok) return { skip: res.reason ?? 'behavior could not run on this page' };
      return {
        op,
        undo: () => quiet(() => behaviors.removeBehavior(op.id)),
        redo: () => quiet(() => behaviors.reAddBehavior(op.id)),
      };
    }

    case 'mockNetwork': {
      const key = genId('mock');
      const res = await behaviors.applyMockRules(key, op.rules);
      if (!res.ok) return { skip: res.reason ?? 'network mocking unavailable on this page' };
      return {
        op,
        undo: () => quiet(() => behaviors.removeMockRules(key)),
        redo: () => quiet(() => behaviors.reApplyMockRules(key)),
      };
    }
  }
}

function isForbiddenAttribute(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith('on') || lower === 'srcdoc';
}

/** M2 placeholder host: behaviors/mocks arrive with the page runtime in M4. */
export function unavailableBehaviorHost(reason: string): BehaviorHost {
  return {
    addBehavior: async () => ({ ok: false, reason }),
    removeBehavior: () => {},
    reAddBehavior: () => {},
    applyMockRules: async () => ({ ok: false, reason }),
    removeMockRules: () => {},
    reApplyMockRules: () => {},
  };
}
