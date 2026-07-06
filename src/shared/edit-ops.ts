// The edit-plan schema: single source of truth for TS types (z.infer), the
// AI tool JSON Schema (edit-plan-schema.ts), and runtime validation of model
// output. Designed for strict tool use: every object is closed
// (additionalProperties: false), every field is required (nullable where
// semantically optional), and no records/maps (arbitrary keys are not allowed
// in strict schemas — style/attribute maps are arrays of pairs).
import { z } from 'zod';

/**
 * Element reference: `e<N>` = existing page element (assigned during context
 * serialization), `n<N>` = element created by the AI (declared via `newRef`,
 * stamped as data-morph-id, addressable in later ops and future turns).
 */
export const RefSchema = z.string().describe('Element ref, e.g. "e3" (existing) or "n1" (AI-created)');

const InsertPosition = z
  .enum(['before', 'after', 'prepend', 'append'])
  .describe('Where to place relative to the target element');

const StyleEntry = z.object({
  property: z.string().describe('CSS property name, e.g. "background-color"'),
  value: z
    .union([z.string(), z.null()])
    .describe('CSS value; null removes the inline property'),
});

const AttrEntry = z.object({
  name: z.string().describe('Attribute name, e.g. "aria-label"'),
  value: z.union([z.string(), z.null()]).describe('Attribute value; null removes the attribute'),
});

export const SetStylesOp = z.object({
  op: z.literal('setStyles'),
  ref: RefSchema,
  styles: z.array(StyleEntry).describe('Inline style changes applied to the element'),
});

export const SetAttributesOp = z.object({
  op: z.literal('setAttributes'),
  ref: RefSchema,
  attributes: z.array(AttrEntry),
});

export const SetTextOp = z.object({
  op: z.literal('setText'),
  ref: RefSchema,
  text: z.string().describe('New text content (replaces all children)'),
});

export const SetHTMLOp = z.object({
  op: z.literal('setHTML'),
  ref: RefSchema,
  html: z.string().describe('New inner HTML (replaces all children). Scripts are stripped.'),
});

export const InsertElementOp = z.object({
  op: z.literal('insertElement'),
  targetRef: RefSchema,
  position: z
    .enum(['before', 'after', 'prepend', 'append', 'replace'])
    .describe('"replace" swaps the target element out entirely'),
  html: z.string().describe('HTML of the new element (exactly one root element)'),
  newRef: z
    .string()
    .describe('Ref you assign to the created root element, e.g. "n1"; use it in later ops'),
});

export const RemoveElementOp = z.object({
  op: z.literal('removeElement'),
  ref: RefSchema,
});

export const MoveElementOp = z.object({
  op: z.literal('moveElement'),
  ref: RefSchema,
  targetRef: RefSchema,
  position: InsertPosition,
});

export const DuplicateElementOp = z.object({
  op: z.literal('duplicateElement'),
  ref: RefSchema,
  newRef: z.string().describe('Ref assigned to the clone (inserted after the original)'),
});

export const WrapElementsOp = z.object({
  op: z.literal('wrapElements'),
  refs: z.array(RefSchema).describe('Contiguous sibling elements to wrap, in DOM order'),
  wrapperHtml: z.string().describe('HTML of the wrapper element (single empty element)'),
  newRef: z.string().describe('Ref assigned to the wrapper'),
});

export const UpsertStylesheetOp = z.object({
  op: z.literal('upsertStylesheet'),
  id: z
    .string()
    .describe('Stable stylesheet id; reusing an id replaces that stylesheet (e.g. "card-grid")'),
  css: z
    .string()
    .describe(
      'CSS text. Use for classes, :hover/:focus states, @keyframes, @media. Scope selectors tightly (.morph-* classes or [data-morph-id="…"]); never bare tag/universal selectors.',
    ),
});

export const AddBehaviorOp = z.object({
  op: z.literal('addBehavior'),
  id: z.string().describe('Stable behavior id; reusing an id replaces that behavior'),
  description: z.string().describe('One sentence describing the interaction'),
  js: z
    .string()
    .describe(
      'JavaScript function body. It runs as `(morph) => { … }`. Use morph.el(ref), morph.on(target, event, handler), morph.setInterval/setTimeout, morph.toast(msg), morph.onCleanup(fn) so the behavior can be undone.',
    ),
});

export const MockRuleSchema = z.object({
  urlPattern: z.string().describe('Substring matched against the request URL'),
  method: z.union([z.string(), z.null()]).describe('HTTP method to match; null = any'),
  status: z.union([z.number(), z.null()]).describe('Response status; null = 200'),
  contentType: z
    .union([z.string(), z.null()])
    .describe('Response content-type; null = application/json'),
  body: z.string().describe('Response body to return'),
  delayMs: z.union([z.number(), z.null()]).describe('Artificial latency; null = 0'),
});

export const MockNetworkOp = z.object({
  op: z.literal('mockNetwork'),
  rules: z.array(MockRuleSchema).describe('fetch/XHR requests to intercept with fake responses'),
});

export const EditOpSchema = z.discriminatedUnion('op', [
  SetStylesOp,
  SetAttributesOp,
  SetTextOp,
  SetHTMLOp,
  InsertElementOp,
  RemoveElementOp,
  MoveElementOp,
  DuplicateElementOp,
  WrapElementsOp,
  UpsertStylesheetOp,
  AddBehaviorOp,
  MockNetworkOp,
]);

export const EditPlanSchema = z.object({
  // summary is FIRST so it can be extracted from the streaming JSON early.
  summary: z
    .string()
    .describe('1-2 sentences, present tense, describing the change being applied. FIRST field.'),
  operations: z.array(EditOpSchema),
  question: z
    .union([z.string(), z.null()])
    .describe('If the request is ambiguous, ask here and return zero operations'),
  notes: z
    .union([z.string(), z.null()])
    .describe('Assumptions or limitations worth surfacing to the user; usually null'),
});

export type EditOp = z.infer<typeof EditOpSchema>;
export type EditPlan = z.infer<typeof EditPlanSchema>;
export type MockRule = z.infer<typeof MockRuleSchema>;
export type StyleChange = z.infer<typeof StyleEntry>;
export type AttrChange = z.infer<typeof AttrEntry>;

/** Compact human/AI-readable digest of an op, used in conversation history. */
export function describeOp(op: EditOp): string {
  switch (op.op) {
    case 'setStyles':
      return `setStyles ${op.ref} {${op.styles.map((s) => s.property).join(', ')}}`;
    case 'setAttributes':
      return `setAttributes ${op.ref} {${op.attributes.map((a) => a.name).join(', ')}}`;
    case 'setText':
      return `setText ${op.ref} "${op.text.slice(0, 40)}${op.text.length > 40 ? '…' : ''}"`;
    case 'setHTML':
      return `setHTML ${op.ref} (${op.html.length} chars)`;
    case 'insertElement':
      return `insertElement ${op.position} ${op.targetRef} -> ${op.newRef}`;
    case 'removeElement':
      return `removeElement ${op.ref}`;
    case 'moveElement':
      return `moveElement ${op.ref} ${op.position} ${op.targetRef}`;
    case 'duplicateElement':
      return `duplicateElement ${op.ref} -> ${op.newRef}`;
    case 'wrapElements':
      return `wrapElements [${op.refs.join(', ')}] -> ${op.newRef}`;
    case 'upsertStylesheet':
      return `upsertStylesheet "${op.id}" (${op.css.length} chars)`;
    case 'addBehavior':
      return `addBehavior "${op.id}": ${op.description}`;
    case 'mockNetwork':
      return `mockNetwork [${op.rules.map((r) => r.urlPattern).join(', ')}]`;
  }
}
