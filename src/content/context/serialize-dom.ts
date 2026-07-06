// Capped outerHTML serialization: enough structure for the model to reason
// about, never the whole subtree. Depth, child-count, attribute-length, and
// total-character budgets all apply, with explicit elision markers so the
// model knows content was omitted.

export interface SerializeOptions {
  maxDepth: number;
  maxChars: number;
  maxChildren: number;
  maxAttrLen: number;
  maxTextLen: number;
}

export const DEFAULT_SERIALIZE_OPTIONS: SerializeOptions = {
  maxDepth: 5,
  maxChars: 5400, // ≈1500 tokens
  maxChildren: 12,
  maxAttrLen: 120,
  maxTextLen: 200,
};

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'source', 'track', 'wbr',
]);

const SKIPPED_TAGS = new Set(['script', 'style', 'noscript', 'template']);

function escapeAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function escapeText(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

function truncate(v: string, max: number): string {
  return v.length > max ? `${v.slice(0, max)}…` : v;
}

function serializeAttrs(el: Element, opts: SerializeOptions): string {
  const parts: string[] = [];
  for (const attr of el.attributes) {
    let value = attr.value;
    // Data URLs and SVG path data blow the budget without informing anything.
    if (value.startsWith('data:') || attr.name === 'd' || attr.name === 'points') {
      value = truncate(value, 24);
    } else {
      value = truncate(value, opts.maxAttrLen);
    }
    parts.push(`${attr.name}="${escapeAttr(value)}"`);
  }
  return parts.length ? ` ${parts.join(' ')}` : '';
}

interface Budget {
  remaining: number;
}

function write(out: string[], budget: Budget, text: string): boolean {
  if (budget.remaining <= 0) return false;
  out.push(text);
  budget.remaining -= text.length;
  return true;
}

function serializeNode(node: Node, depth: number, opts: SerializeOptions, out: string[], budget: Budget): void {
  if (budget.remaining <= 0) return;

  if (node.nodeType === Node.TEXT_NODE) {
    const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text) write(out, budget, escapeText(truncate(text, opts.maxTextLen)));
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (SKIPPED_TAGS.has(tag)) return;

  write(out, budget, `<${tag}${serializeAttrs(el, opts)}>`);
  if (VOID_TAGS.has(tag)) return;

  const childNodes = Array.from(el.childNodes).filter(
    (n) =>
      n.nodeType === Node.ELEMENT_NODE ||
      (n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim().length > 0),
  );

  if (childNodes.length > 0) {
    if (depth <= 0) {
      write(out, budget, `⟨${describeOmitted(el)} omitted⟩`);
    } else {
      const visible = childNodes.slice(0, opts.maxChildren);
      for (const child of visible) {
        if (budget.remaining <= 0) {
          write(out, budget, '⟨…⟩');
          break;
        }
        serializeNode(child, depth - 1, opts, out, budget);
      }
      if (childNodes.length > visible.length) {
        write(out, budget, `⟨${childNodes.length - visible.length} more children omitted⟩`);
      }
    }
  }
  write(out, budget, `</${tag}>`);
}

function describeOmitted(el: Element): string {
  const n = el.children.length;
  if (n === 0) return 'text content';
  return `${n} child element${n === 1 ? '' : 's'}`;
}

export function serializeElement(el: Element, options: Partial<SerializeOptions> = {}): string {
  const opts = { ...DEFAULT_SERIALIZE_OPTIONS, ...options };
  const out: string[] = [];
  const budget: Budget = { remaining: opts.maxChars };
  serializeNode(el, opts.maxDepth, opts, out, budget);
  if (budget.remaining <= 0) out.push('⟨output truncated⟩');
  return out.join('');
}
