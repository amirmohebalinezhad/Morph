// Managed <style data-morph-sheet="id"> elements in <head>. Injected CSS is
// how the AI does classes, hover states, keyframes, and media queries without
// touching the page's own stylesheets.

const SHEET_ATTR = 'data-morph-sheet';

export function getStylesheet(id: string): HTMLStyleElement | null {
  return document.head.querySelector<HTMLStyleElement>(`style[${SHEET_ATTR}="${cssAttrEscape(id)}"]`);
}

/** Returns the previous CSS text (null if the sheet didn't exist). */
export function upsertStylesheet(id: string, css: string): string | null {
  let el = getStylesheet(id);
  const prev = el ? el.textContent : null;
  if (!el) {
    el = document.createElement('style');
    el.setAttribute(SHEET_ATTR, id);
    document.head.appendChild(el);
  }
  el.textContent = css;
  return prev;
}

export function removeStylesheet(id: string): void {
  getStylesheet(id)?.remove();
}

/** All Morph-injected stylesheets, for export/snapshot. */
export function allStylesheets(): Array<{ id: string; css: string }> {
  return Array.from(document.head.querySelectorAll<HTMLStyleElement>(`style[${SHEET_ATTR}]`)).map((el) => ({
    id: el.getAttribute(SHEET_ATTR) ?? '',
    css: el.textContent ?? '',
  }));
}

function cssAttrEscape(v: string): string {
  return v.replace(/["\\]/g, '\\$&');
}
