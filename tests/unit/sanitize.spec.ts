// @vitest-environment jsdom
// DOMPurify needs a spec-complete DOM; it silently passes content through
// under happy-dom, so this suite (and anything exercising sanitize) uses jsdom.
import { describe, expect, it } from 'vitest';
import { sanitizeToElement, sanitizeToFragment } from '../../src/content/ops/sanitize';

describe('sanitizeToFragment', () => {
  it('strips script tags and inline handlers', () => {
    const frag = sanitizeToFragment(
      '<div onclick="alert(1)"><script>alert(2)</script><b onmouseover="x()">bold</b></div>',
    );
    const div = frag.firstElementChild!;
    expect(div.querySelector('script')).toBeNull();
    expect(div.hasAttribute('onclick')).toBe(false);
    expect(div.querySelector('b')!.hasAttribute('onmouseover')).toBe(false);
    expect(div.textContent).toContain('bold');
  });

  it('strips javascript: URLs but keeps normal links', () => {
    const frag = sanitizeToFragment('<a href="javascript:alert(1)">bad</a><a href="/ok">good</a>');
    const links = frag.querySelectorAll('a');
    expect(links[0]!.getAttribute('href')).toBeNull();
    expect(links[1]!.getAttribute('href')).toBe('/ok');
  });

  it('strips iframes/objects/embeds', () => {
    const frag = sanitizeToFragment('<div><iframe src="x"></iframe><embed src="y"><object></object>ok</div>');
    const div = frag.firstElementChild!;
    expect(div.querySelector('iframe, embed, object')).toBeNull();
    expect(div.textContent).toContain('ok');
  });

  it('keeps aria, data attributes, classes, and inline style', () => {
    const frag = sanitizeToFragment(
      '<button class="x" style="color:red" aria-label="Close" data-morph-id="n1" data-foo="1">×</button>',
    );
    const btn = frag.firstElementChild!;
    expect(btn.getAttribute('aria-label')).toBe('Close');
    expect(btn.getAttribute('data-morph-id')).toBe('n1');
    expect(btn.getAttribute('data-foo')).toBe('1');
    expect(btn.getAttribute('class')).toBe('x');
    expect(btn.getAttribute('style')).toContain('color');
  });

  it('adopts nodes into the live document (no detached-document leaks)', () => {
    const frag = sanitizeToFragment('<p>hello</p>');
    expect(frag.ownerDocument).toBe(document);
  });
});

describe('sanitizeToElement', () => {
  it('returns the single root element', () => {
    const el = sanitizeToElement('<section id="a"><p>x</p></section>');
    expect(el.tagName).toBe('SECTION');
  });

  it('wraps multiple roots', () => {
    const el = sanitizeToElement('<p>a</p><p>b</p>');
    expect(el.tagName).toBe('DIV');
    expect(el.querySelectorAll('p').length).toBe(2);
  });

  it('throws when nothing survives sanitization', () => {
    expect(() => sanitizeToElement('<script>x</script>')).toThrow();
  });
});
