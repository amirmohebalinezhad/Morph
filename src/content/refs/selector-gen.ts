import { classString } from '../dom-utils';

function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

function isUnique(selector: string, el: Element): boolean {
  try {
    const matches = el.ownerDocument.querySelectorAll(selector);
    return matches.length === 1 && matches[0] === el;
  } catch {
    return false;
  }
}

function segmentFor(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const parent = el.parentElement;
  if (!parent) return tag;

  // Prefer a stable-looking class if it disambiguates among siblings.
  const classes = classString(el)
    .split(/\s+/)
    .filter((c) => c && !/[0-9a-f]{6,}|^(js-|is-|has-)/i.test(c));
  for (const cls of classes.slice(0, 3)) {
    const sel = `${tag}.${cssEscape(cls)}`;
    let count = 0;
    for (const sib of parent.children) {
      if (sib.matches(sel)) count++;
    }
    if (count === 1) return sel;
  }

  // Fall back to positional addressing.
  let index = 1;
  for (let sib = el.previousElementSibling; sib; sib = sib.previousElementSibling) {
    if (sib.tagName === el.tagName) index++;
  }
  return `${tag}:nth-of-type(${index})`;
}

/**
 * Best-effort unique CSS selector for an element, used to re-anchor refs when
 * the page re-renders and the original node is gone. Anchors at the nearest
 * ancestor with a unique id when possible.
 */
export function generateSelector(el: Element): string {
  if (el.id) {
    const idSel = `#${cssEscape(el.id)}`;
    if (isUnique(idSel, el)) return idSel;
  }

  const segments: string[] = [];
  let cur: Element | null = el;
  let guard = 0;

  while (cur && cur !== el.ownerDocument.documentElement && guard++ < 32) {
    if (cur.id) {
      const idSel = `#${cssEscape(cur.id)}`;
      if (isUnique(idSel, cur)) {
        segments.unshift(idSel);
        break;
      }
    }
    segments.unshift(segmentFor(cur));
    const candidate = segments.join(' > ');
    if (isUnique(candidate, el)) return candidate;
    cur = cur.parentElement;
  }

  return segments.join(' > ') || el.tagName.toLowerCase();
}
