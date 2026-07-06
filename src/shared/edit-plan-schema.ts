// Converts the zod EditPlan schema into the JSON Schema used for strict tool
// use (Anthropic `strict: true` tools / OpenAI `json_schema` response format).
// Strict mode requirements: `additionalProperties: false` on every object,
// every property listed in `required`, and no numeric/string constraint
// keywords. The post-pass walks SCHEMA nodes only (never the `properties`
// container itself — a property named "id" or "pattern" must survive).
import { z } from 'zod';
import { EditPlanSchema } from './edit-ops';

const STRIPPED_KEYWORDS = [
  'minLength',
  'maxLength',
  'pattern',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minItems',
  'maxItems',
  'uniqueItems',
  'default',
] as const;

type SchemaNode = Record<string, unknown>;

function isObjectNode(v: unknown): v is SchemaNode {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function makeStrict(node: unknown): void {
  if (!isObjectNode(node)) return;

  for (const kw of STRIPPED_KEYWORDS) delete node[kw];

  // Strict tool use supports anyOf but not oneOf; for a discriminated union
  // (every branch keyed by a const `op`) they are equivalent.
  if (Array.isArray(node['oneOf']) && node['anyOf'] === undefined) {
    node['anyOf'] = node['oneOf'];
    delete node['oneOf'];
  }

  const props = node['properties'];
  if (node['type'] === 'object' || isObjectNode(props)) {
    node['additionalProperties'] = false;
    if (isObjectNode(props)) {
      node['required'] = Object.keys(props);
      for (const propSchema of Object.values(props)) makeStrict(propSchema);
    }
  }

  // Recurse only into positions that hold schemas.
  for (const key of ['items', 'additionalItems', 'not', 'if', 'then', 'else', 'contains'] as const) {
    if (node[key] !== undefined && node[key] !== false) makeStrict(node[key]);
  }
  for (const key of ['anyOf', 'oneOf', 'allOf', 'prefixItems'] as const) {
    const arr = node[key];
    if (Array.isArray(arr)) for (const sub of arr) makeStrict(sub);
  }
  for (const key of ['$defs', 'definitions'] as const) {
    const defs = node[key];
    if (isObjectNode(defs)) for (const sub of Object.values(defs)) makeStrict(sub);
  }
}

export function buildEditPlanJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(EditPlanSchema, { target: 'draft-2020-12' }) as SchemaNode;
  delete schema['$schema'];
  makeStrict(schema);
  return schema;
}

export const EDIT_PLAN_JSON_SCHEMA = buildEditPlanJsonSchema();
