// Trusted-Types-safe HTML handling. AI-provided HTML is sanitized by
// DOMPurify (which registers its own TT policy on enforcing pages) into a
// detached DocumentFragment, adopted into the live document, and inserted
// with node APIs — we never assign innerHTML on the live document, so pages
// like GitHub (require-trusted-types-for 'script') keep working.
import DOMPurify from 'dompurify';

const PURIFY_CONFIG = {
  // Behaviors go exclusively through the addBehavior op — never inline script.
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'base', 'link', 'meta'],
  FORBID_ATTR: ['srcdoc'],
  // Keep aria-*/data-*/role etc. DOMPurify already strips on* handlers and
  // javascript: URLs by default.
  ADD_ATTR: ['data-morph-id'],
  RETURN_DOM_FRAGMENT: true as const,
};

/** Sanitizes an HTML string into a fragment owned by the live document. */
export function sanitizeToFragment(html: string): DocumentFragment {
  const fragment = DOMPurify.sanitize(html, PURIFY_CONFIG);
  return document.adoptNode(fragment);
}

/**
 * Sanitizes HTML expected to contain exactly one root element (insertElement,
 * wrapElements…). Throws if there is no element to insert.
 */
export function sanitizeToElement(html: string): Element {
  const fragment = sanitizeToFragment(html);
  const elements = Array.from(fragment.children);
  if (elements.length === 0) {
    throw new Error('HTML payload contained no element after sanitization');
  }
  if (elements.length === 1) return elements[0]!;
  // Multiple roots: wrap them so the op still has a single handle.
  const wrapper = document.createElement('div');
  wrapper.append(...fragment.childNodes);
  return wrapper;
}
