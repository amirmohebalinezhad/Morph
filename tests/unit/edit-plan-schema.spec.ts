import { describe, expect, it } from 'vitest';
import { EDIT_PLAN_JSON_SCHEMA } from '../../src/shared/edit-plan-schema';
import { EditPlanSchema } from '../../src/shared/edit-ops';

function walkObjects(node: unknown, visit: (obj: Record<string, unknown>) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walkObjects(item, visit);
    return;
  }
  if (!node || typeof node !== 'object') return;
  visit(node as Record<string, unknown>);
  for (const value of Object.values(node)) walkObjects(value, visit);
}

describe('EDIT_PLAN_JSON_SCHEMA (strict tool use requirements)', () => {
  it('closes every object and requires every property', () => {
    let objects = 0;
    walkObjects(EDIT_PLAN_JSON_SCHEMA, (obj) => {
      if (obj['type'] === 'object' || obj['properties']) {
        objects++;
        expect(obj['additionalProperties'], JSON.stringify(obj).slice(0, 120)).toBe(false);
        const props = obj['properties'] as Record<string, unknown> | undefined;
        if (props) {
          expect(obj['required']).toEqual(Object.keys(props));
        }
      }
    });
    expect(objects).toBeGreaterThan(10); // the op union expands to many objects
  });

  it('contains no unsupported constraint keywords or oneOf', () => {
    const banned = ['minLength', 'maxLength', 'minimum', 'maximum', 'pattern', 'minItems', 'maxItems', 'oneOf'];
    walkObjects(EDIT_PLAN_JSON_SCHEMA, (obj) => {
      for (const kw of banned) expect(obj[kw], kw).toBeUndefined();
    });
  });

  it('exposes all twelve op variants through anyOf', () => {
    const json = JSON.stringify(EDIT_PLAN_JSON_SCHEMA);
    for (const op of [
      'setStyles', 'setAttributes', 'setText', 'setHTML', 'insertElement', 'removeElement',
      'moveElement', 'duplicateElement', 'wrapElements', 'upsertStylesheet', 'addBehavior', 'mockNetwork',
    ]) {
      expect(json).toContain(`"const":"${op}"`);
    }
  });
});

describe('EditPlanSchema validation', () => {
  it('accepts a realistic plan', () => {
    const plan = {
      summary: 'Turning the button red.',
      operations: [
        { op: 'setStyles', ref: 'e1', styles: [{ property: 'background-color', value: '#f00' }] },
        {
          op: 'insertElement',
          targetRef: 'e1',
          position: 'after',
          html: '<span>hi</span>',
          newRef: 'n1',
        },
        { op: 'upsertStylesheet', id: 's1', css: '.morph-x{color:red}' },
      ],
      question: null,
      notes: null,
    };
    expect(EditPlanSchema.safeParse(plan).success).toBe(true);
  });

  it('rejects unknown op types and missing fields', () => {
    expect(
      EditPlanSchema.safeParse({
        summary: 'x',
        operations: [{ op: 'explodeElement', ref: 'e1' }],
        question: null,
        notes: null,
      }).success,
    ).toBe(false);
    expect(
      EditPlanSchema.safeParse({
        summary: 'x',
        operations: [{ op: 'setText', ref: 'e1' }], // missing text
        question: null,
        notes: null,
      }).success,
    ).toBe(false);
  });
});
