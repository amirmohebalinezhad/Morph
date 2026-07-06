import { isSelectable } from '../dom-utils';

/**
 * DevTools-style structural navigation from the current element.
 * Returns null when there is no valid target in that direction.
 */
export function navigateFrom(current: Element, key: string): Element | null {
  switch (key) {
    case 'ArrowUp': {
      const parent = current.parentElement;
      return parent && isSelectable(parent) ? parent : null;
    }
    case 'ArrowDown': {
      for (const child of current.children) {
        if (isSelectable(child)) return child;
      }
      return null;
    }
    case 'ArrowLeft': {
      for (let sib = current.previousElementSibling; sib; sib = sib.previousElementSibling) {
        if (isSelectable(sib)) return sib;
      }
      return null;
    }
    case 'ArrowRight': {
      for (let sib = current.nextElementSibling; sib; sib = sib.nextElementSibling) {
        if (isSelectable(sib)) return sib;
      }
      return null;
    }
    default:
      return null;
  }
}
