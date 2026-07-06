import { describe, expect, it } from 'vitest';
import { serializeElement } from '../../src/content/context/serialize-dom';

function buildDeepTree(depth: number, breadth: number): HTMLElement {
  const root = document.createElement('div');
  root.className = 'root';
  let current: HTMLElement = root;
  for (let d = 0; d < depth; d++) {
    const child = document.createElement('div');
    child.className = `level-${d}`;
    for (let b = 0; b < breadth; b++) {
      const leaf = document.createElement('span');
      leaf.textContent = `leaf ${d}-${b} with a reasonable amount of text content`;
      child.appendChild(leaf);
    }
    current.appendChild(child);
    current = child;
  }
  return root;
}

describe('serializeElement', () => {
  it('respects the character budget on huge trees', () => {
    const el = buildDeepTree(30, 20);
    const out = serializeElement(el, { maxChars: 3000 });
    expect(out.length).toBeLessThan(3600); // budget + closing tags/markers slack
    expect(out).toContain('⟨');
  });

  it('marks depth elision instead of dumping deep subtrees', () => {
    const el = buildDeepTree(10, 2);
    const out = serializeElement(el, { maxDepth: 2, maxChars: 50_000 });
    expect(out).toMatch(/omitted⟩/);
    expect(out).not.toContain('level-5');
  });

  it('caps children per element with a marker', () => {
    const el = document.createElement('ul');
    for (let i = 0; i < 30; i++) {
      const li = document.createElement('li');
      li.textContent = `item ${i}`;
      el.appendChild(li);
    }
    const out = serializeElement(el, { maxChildren: 5, maxChars: 50_000 });
    expect(out).toContain('item 4');
    expect(out).not.toContain('item 20');
    expect(out).toContain('25 more children omitted');
  });

  it('truncates long attributes and data URLs', () => {
    const el = document.createElement('img');
    el.setAttribute('src', `data:image/png;base64,${'A'.repeat(500)}`);
    el.setAttribute('alt', 'x'.repeat(400));
    const out = serializeElement(el);
    expect(out.length).toBeLessThan(300);
    expect(out).toContain('…');
  });

  it('skips script/style children', () => {
    const el = document.createElement('div');
    el.innerHTML = '<script>alert(1)</script><style>.x{}</style><p>keep me</p>';
    const out = serializeElement(el);
    expect(out).toContain('keep me');
    expect(out).not.toContain('alert');
    expect(out).not.toContain('<style');
  });
});
