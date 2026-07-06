import { describe, expect, it } from 'vitest';
import { assembleChangeLog } from '../../src/content/export/export-doc';
import type { Revision } from '../../src/content/history/revision-tree';
import type { EditOp } from '../../src/shared/edit-ops';

function rev(id: string, parentId: string | null, instruction: string, summary: string, ops: EditOp[]): Revision {
  return {
    id,
    parentId,
    kind: 'ai',
    instruction,
    summary,
    ops,
    applied: [],
    skipped: [],
    childIds: [],
    activeChildId: null,
    createdAt: 0,
    stale: false,
  };
}

const META = { url: 'https://example.com/app', title: 'Acme Dashboard' };

describe('assembleChangeLog', () => {
  it('produces a stable golden document for a fixed revision set', () => {
    const revisions: Revision[] = [
      rev('root', null, 'Original page', 'The page as it loaded.', []),
      rev('r1', 'root', 'make the button red', 'Making the primary button red.', [
        { op: 'setStyles', ref: 'e1', styles: [{ property: 'background-color', value: '#dc2626' }] },
      ]),
      rev('r2', 'r1', 'turn the table into cards', 'Replacing the table with a card grid.', [
        { op: 'insertElement', targetRef: 'e2', position: 'replace', html: '<div class="grid"><div class="card">A</div></div>', newRef: 'n1' },
        { op: 'upsertStylesheet', id: 'grid', css: '.grid{display:grid;gap:12px}' },
      ]),
      rev('r3', 'r2', 'add a copy button', 'Adding a copy-to-clipboard interaction.', [
        {
          op: 'addBehavior',
          id: 'copy',
          description: 'Copies text and shows a checkmark for 2s',
          js: "const btn = morph.el('n1');\nmorph.on(btn, 'click', () => morph.toast('Copied!'));",
        },
      ]),
    ];

    const md = assembleChangeLog(revisions, META);
    expect(md).toBe(GOLDEN);
  });

  it('reports an empty log when only the root exists', () => {
    const md = assembleChangeLog([rev('root', null, 'Original page', 'x', [])], META);
    expect(md).toContain('No changes were made');
  });

  it('surfaces skipped operations as implement-directly notes', () => {
    const r = rev('r1', 'root', 'add hover', 'Adds a hover effect.', [
      { op: 'addBehavior', id: 'h', description: 'hover glow', js: '// ...' },
    ]);
    r.skipped = [
      { op: { op: 'addBehavior', id: 'h', description: 'hover glow', js: '// ...' }, reason: "page's security policy blocks injected scripts" },
    ];
    const md = assembleChangeLog([rev('root', null, 'Original', 'x', []), r], META);
    expect(md).toContain('Not applied in the prototype');
    expect(md).toContain('security policy');
  });

  it('includes code blocks for HTML, CSS, JS, and mock rules', () => {
    const md = assembleChangeLog(
      [
        rev('root', null, 'Original', 'x', []),
        rev('r1', 'root', 'mock', 'Mocks the API.', [
          {
            op: 'mockNetwork',
            rules: [{ urlPattern: '/api/stats', method: null, status: 200, contentType: null, body: '{"users":5}', delayMs: null }],
          },
        ]),
      ],
      META,
    );
    expect(md).toContain('```json');
    expect(md).toContain('"users": 5'); // body parsed and pretty-printed
    expect(md).toContain('implement the real API');
  });
});

const GOLDEN = `# Prototype change log

Prototyped live on **Acme Dashboard** (https://example.com/app) using Morph.
3 revisions applied, in order:

## 1. make the button red

_Making the primary button red._

- Set inline styles on \`e1\`: \`background-color: #dc2626\`

## 2. turn the table into cards

_Replacing the table with a card grid._

- Insert a new element (\`n1\`) replace \`e2\` (see snippet below)
- Add/update stylesheet \`grid\` (CSS below)

\`\`\`html
<div class="grid"><div class="card">A</div></div>
\`\`\`

\`\`\`css
.grid{display:grid;gap:12px}
\`\`\`

## 3. add a copy button

_Adding a copy-to-clipboard interaction._

- Add interaction "Copies text and shows a checkmark for 2s" (behavior \`copy\`, JS below)

\`\`\`js
// Prototype behavior — adapt to your framework
const btn = morph.el('n1');
morph.on(btn, 'click', () => morph.toast('Copied!'));
\`\`\`
`;
