// Maps short refs (e1, e2… for existing page elements; n1… for AI-created
// nodes) to live Elements. Refs are how the AI addresses the page across the
// whole conversation, so resolution has fallbacks for pages that re-render:
//   1. the WeakRef (fast path)
//   2. [data-morph-id="<ref>"] lookup (AI-created or previously-edited nodes)
//   3. the selector snapshot captured when the ref was assigned
import { generateSelector } from './selector-gen';

export const MORPH_ID_ATTR = 'data-morph-id';

interface RefRecord {
  weak: WeakRef<Element>;
  selector: string | null;
}

export class RefRegistry {
  private byRef = new Map<string, RefRecord>();
  private byElement = new WeakMap<Element, string>();
  private counter = 0;
  private newRefCounter = 0;

  /** Live elements currently addressable by a ref (for the sentinel). */
  trackedElements(): Element[] {
    const out: Element[] = [];
    for (const rec of this.byRef.values()) {
      const el = rec.weak.deref();
      if (el) out.push(el);
    }
    return out;
  }

  /**
   * Returns `proposed` if it is still free, otherwise a fresh unique n-ref.
   * Needed because the model restarts its newRef numbering (n1, n2…) on
   * every plan, and manual edits mint refs too.
   */
  uniqueNewRef(proposed?: string): string {
    if (proposed && !this.isRefTaken(proposed)) return proposed;
    let ref: string;
    do {
      this.newRefCounter += 1;
      ref = `n${this.newRefCounter}x`;
    } while (this.isRefTaken(ref));
    return ref;
  }

  private isRefTaken(ref: string): boolean {
    if (this.byRef.has(ref)) return true;
    try {
      return document.querySelector(`[${MORPH_ID_ATTR}="${cssAttrEscape(ref)}"]`) !== null;
    } catch {
      return true;
    }
  }

  /** Existing ref for the element, or assigns the next `e<N>` ref. */
  refFor(el: Element): string {
    const existing = this.byElement.get(el);
    if (existing) {
      // Refresh the selector snapshot — the page may have changed around it.
      const rec = this.byRef.get(existing);
      if (rec) rec.selector = safeSelector(el);
      return existing;
    }
    this.counter += 1;
    const ref = `e${this.counter}`;
    this.byElement.set(el, ref);
    this.byRef.set(ref, { weak: new WeakRef(el), selector: safeSelector(el) });
    return ref;
  }

  /**
   * Registers an AI-created element under its declared ref (n1…), stamping
   * data-morph-id so future turns (and injected behaviors/stylesheets) can
   * target it by attribute.
   */
  register(ref: string, el: Element): void {
    el.setAttribute(MORPH_ID_ATTR, ref);
    this.byElement.set(el, ref);
    this.byRef.set(ref, { weak: new WeakRef(el), selector: `[${MORPH_ID_ATTR}="${ref}"]` });
  }

  /**
   * Stamps data-morph-id on an existing element so MAIN-world code and
   * injected stylesheets can address it. Keeps the ref mapping intact.
   */
  stamp(ref: string, el: Element): void {
    if (!el.getAttribute(MORPH_ID_ATTR)) el.setAttribute(MORPH_ID_ATTR, ref);
  }

  resolve(ref: string): Element | null {
    const rec = this.byRef.get(ref);
    if (rec) {
      const el = rec.weak.deref();
      if (el?.isConnected) return el;
    }

    const byAttr = document.querySelector(`[${MORPH_ID_ATTR}="${cssAttrEscape(ref)}"]`);
    if (byAttr) {
      this.rebind(ref, byAttr);
      return byAttr;
    }

    if (rec?.selector) {
      try {
        const bySelector = document.querySelector(rec.selector);
        if (bySelector) {
          this.rebind(ref, bySelector);
          return bySelector;
        }
      } catch {
        // stale/invalid selector — fall through
      }
    }
    return null;
  }

  private rebind(ref: string, el: Element): void {
    this.byElement.set(el, ref);
    const rec = this.byRef.get(ref);
    if (rec) rec.weak = new WeakRef(el);
    else this.byRef.set(ref, { weak: new WeakRef(el), selector: safeSelector(el) });
  }
}

function safeSelector(el: Element): string | null {
  try {
    return generateSelector(el);
  } catch {
    return null;
  }
}

function cssAttrEscape(v: string): string {
  return v.replace(/["\\]/g, '\\$&');
}
