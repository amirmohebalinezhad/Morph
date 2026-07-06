// Standalone HTML snapshot of the current prototype: the live DOM with Morph's
// own UI stripped, injected stylesheets kept, scripts removed and behaviors
// noted as comments. A quick way to hand someone the visual result; the
// implementation prompt remains the primary deliverable.
import { MORPH_HOST_ID } from '../dom-utils';
import { allStylesheets } from '../ops/stylesheets';

export function buildHtmlSnapshot(behaviorCount: number): string {
  const clone = document.documentElement.cloneNode(true) as HTMLElement;

  // Strip Morph's own UI host and any scripts.
  clone.querySelector(`#${MORPH_HOST_ID}`)?.remove();
  for (const s of clone.querySelectorAll('script')) s.remove();
  clone.removeAttribute('data-morph-active');
  clone.removeAttribute('data-morph-runtime');

  // Inline the injected stylesheets so the snapshot is self-contained.
  const injected = allStylesheets();
  const head = clone.querySelector('head') ?? clone;
  for (const sheet of injected) {
    const style = document.createElement('style');
    style.textContent = `/* morph:${sheet.id} */\n${sheet.css}`;
    head.appendChild(style);
  }

  const note = behaviorCount
    ? `<!-- ${behaviorCount} interactive behavior(s) were prototyped with JavaScript and are NOT included in this static snapshot. See the implementation prompt for the code. -->\n`
    : '';

  return `<!DOCTYPE html>\n${note}${clone.outerHTML}`;
}
