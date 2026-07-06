import { getMorphHost, isSelectable } from '../dom-utils';

/**
 * Element under the viewport point, descending into open shadow roots.
 * Returns null over our own UI (its interactive parts swallow the point) and
 * for structurally unselectable nodes.
 */
export function deepElementFromPoint(x: number, y: number): Element | null {
  let el = document.elementFromPoint(x, y);
  const host = getMorphHost();
  if (!el || el === host) return null;

  // Walk into open shadow roots until we land on the deepest element.
  let guard = 0;
  while (el.shadowRoot && guard++ < 32) {
    const inner = el.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === el) break;
    el = inner;
  }
  return isSelectable(el) ? el : null;
}
