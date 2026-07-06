// Assembles the provider-agnostic AI request from the current page state,
// under hard per-section token budgets. Never the whole DOM.
import type { ChatTurnWire, EditPlanRequestWire, SerializedElement } from '../../shared/wire-types';
import { ancestorChain, describeElement, isSelectable, roundRect } from '../dom-utils';
import type { RefRegistry } from '../refs/ref-registry';
import { compactComputedStyles, layoutHint } from './computed-styles';
import { buildDesignTokens } from './design-tokens';
import { serializeElement } from './serialize-dom';
import { capListFromEnd, capTokens, tokensToChars } from './token-budget';

const BUDGET = {
  perElementHtml: 1500, // tokens
  perElementStyles: 350,
  detailedElements: 4,
  ancestors: 8,
  siblingsEachSide: 3,
  designTokens: 400,
  revisionSummaries: 600,
  conversation: 1200,
  conversationTurn: 220,
};

export interface ContextInputs {
  instruction: string;
  selection: Element[];
  refs: RefRegistry;
  conversation: ChatTurnWire[];
  revisionSummaries: string[];
  screenshot: string | null;
}

export function buildEditPlanRequest(inputs: ContextInputs): EditPlanRequestWire {
  const { selection, refs } = inputs;

  const selected: SerializedElement[] = selection.map((el, i) => {
    const ref = refs.refFor(el);
    // Stamp so injected stylesheets/behaviors can target [data-morph-id="…"].
    refs.stamp(ref, el);
    const detailed = i < BUDGET.detailedElements;
    return {
      ref,
      descriptor: describeElement(el, 4),
      html: detailed
        ? serializeElement(el, { maxChars: tokensToChars(BUDGET.perElementHtml) })
        : `⟨element serialized as descriptor only: ${describeElement(el, 4)}⟩`,
      styles: detailed ? capTokens(compactComputedStyles(el), BUDGET.perElementStyles) : '',
      rect: roundRect(el.getBoundingClientRect()),
    };
  });

  const primary = selection[selection.length - 1] ?? null;

  const ancestors: string[] = [];
  const siblings: string[] = [];
  if (primary) {
    const chain = ancestorChain(primary);
    for (const ancestor of chain.slice(0, -1).slice(-BUDGET.ancestors)) {
      ancestors.push(`${describeElement(ancestor, 3)} — ${layoutHint(ancestor)}`);
    }

    const parent = primary.parentElement;
    if (parent) {
      const sibs = Array.from(parent.children).filter((c) => isSelectable(c));
      const idx = sibs.indexOf(primary);
      const from = Math.max(0, idx - BUDGET.siblingsEachSide);
      const to = Math.min(sibs.length, idx + BUDGET.siblingsEachSide + 1);
      for (let i = from; i < to; i++) {
        const sib = sibs[i]!;
        const marker = sib === primary ? ' ← selected' : selection.includes(sib) ? ' ← also selected' : '';
        siblings.push(`${describeElement(sib, 3)}${marker}`);
      }
    }
  }

  return {
    url: location.href,
    title: document.title,
    viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
    instruction: inputs.instruction,
    selected,
    ancestors,
    siblings,
    designTokens: capTokens(safeDesignTokens(), BUDGET.designTokens),
    revisionSummaries: capListFromEnd(inputs.revisionSummaries.slice(-15), BUDGET.revisionSummaries),
    conversation: capConversation(inputs.conversation),
    screenshot: inputs.screenshot,
  };
}

function capConversation(turns: ChatTurnWire[]): ChatTurnWire[] {
  const recent = turns.slice(-8).map((t) => ({ ...t, text: capTokens(t.text, BUDGET.conversationTurn) }));
  const capped = capListFromEnd(recent.map((t) => t.text), BUDGET.conversation);
  return recent.slice(recent.length - capped.length);
}

function safeDesignTokens(): string {
  try {
    return buildDesignTokens();
  } catch {
    return '';
  }
}
