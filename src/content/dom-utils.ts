export const MORPH_HOST_ID = 'morph-extension-root';

export function getMorphHost(): HTMLElement | null {
  return document.getElementById(MORPH_HOST_ID);
}

/** True for our own UI host (or anything inside it). */
export function isMorphNode(node: Node | null): boolean {
  if (!node) return false;
  const el = node instanceof Element ? node : node.parentElement;
  if (!el) return false;
  const host = getMorphHost();
  return host !== null && (el === host || host.contains(el));
}

/** True if the event originated inside our shadow UI. */
export function eventFromMorphUI(ev: Event): boolean {
  const host = getMorphHost();
  if (!host) return false;
  return ev.composedPath().includes(host);
}

/** Elements that never make sense as a user selection target. */
export function isSelectable(el: Element | null): boolean {
  if (!el) return false;
  if (el === document.documentElement || el === document.head) return false;
  const tag = el.tagName;
  if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK' || tag === 'META' || tag === 'TITLE') return false;
  return !isMorphNode(el);
}

/** Class attribute as a plain string (SVG className is an SVGAnimatedString). */
export function classString(el: Element): string {
  return el.getAttribute('class')?.trim() ?? '';
}

/** Short human/AI-readable descriptor: `button#save.btn.btn-primary`. */
export function describeElement(el: Element, maxClasses = 2): string {
  let out = el.tagName.toLowerCase();
  if (el.id) out += `#${el.id}`;
  const classes = classString(el).split(/\s+/).filter(Boolean);
  for (const c of classes.slice(0, maxClasses)) out += `.${c}`;
  if (classes.length > maxClasses) out += '…';
  return out;
}

export function roundRect(r: DOMRect): { x: number; y: number; w: number; h: number } {
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
}

/** Ancestor chain from <body> down to (and including) el; skips our own UI. */
export function ancestorChain(el: Element): Element[] {
  const chain: Element[] = [];
  let cur: Element | null = el;
  while (cur && cur !== document.documentElement) {
    if (!isMorphNode(cur)) chain.unshift(cur);
    cur = cur.parentElement;
  }
  return chain;
}
