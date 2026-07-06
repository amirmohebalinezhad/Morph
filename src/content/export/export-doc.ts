// Assembles a deterministic Markdown "change log" from the applied revision
// lineage, then (optionally) sends it to the AI to be rewritten into a polished
// implementation prompt. The deterministic path needs no API key, so export
// always works; the AI pass just improves prose and adds structure.
import { describeOp, type EditOp } from '../../shared/edit-ops';
import type { Revision } from '../history/revision-tree';

function opToMarkdown(op: EditOp): string {
  switch (op.op) {
    case 'setStyles':
      return `- Set inline styles on \`${op.ref}\`: ${op.styles
        .map((s) => (s.value === null ? `remove \`${s.property}\`` : `\`${s.property}: ${s.value}\``))
        .join(', ')}`;
    case 'setAttributes':
      return `- Set attributes on \`${op.ref}\`: ${op.attributes
        .map((a) => (a.value === null ? `remove \`${a.name}\`` : `\`${a.name}="${a.value}"\``))
        .join(', ')}`;
    case 'setText':
      return `- Replace the text of \`${op.ref}\` with: "${op.text}"`;
    case 'setHTML':
      return `- Replace the inner HTML of \`${op.ref}\` (see snippet below)`;
    case 'insertElement':
      return `- Insert a new element (\`${op.newRef}\`) ${op.position} \`${op.targetRef}\` (see snippet below)`;
    case 'removeElement':
      return `- Remove \`${op.ref}\``;
    case 'moveElement':
      return `- Move \`${op.ref}\` to ${op.position} \`${op.targetRef}\``;
    case 'duplicateElement':
      return `- Duplicate \`${op.ref}\` as \`${op.newRef}\``;
    case 'wrapElements':
      return `- Wrap ${op.refs.map((r) => `\`${r}\``).join(', ')} in a new element (\`${op.newRef}\`)`;
    case 'upsertStylesheet':
      return `- Add/update stylesheet \`${op.id}\` (CSS below)`;
    case 'addBehavior':
      return `- Add interaction "${op.description}" (behavior \`${op.id}\`, JS below)`;
    case 'mockNetwork':
      return `- Mock network responses for: ${op.rules.map((r) => `\`${r.urlPattern}\``).join(', ')} (used only for prototyping — implement the real API instead)`;
  }
}

function codeBlocks(op: EditOp): string[] {
  const blocks: string[] = [];
  if (op.op === 'insertElement' || op.op === 'setHTML') {
    const html = op.op === 'insertElement' ? op.html : op.html;
    blocks.push('```html\n' + html.trim() + '\n```');
  }
  if (op.op === 'wrapElements') blocks.push('```html\n' + op.wrapperHtml.trim() + '\n```');
  if (op.op === 'upsertStylesheet') blocks.push('```css\n' + op.css.trim() + '\n```');
  if (op.op === 'addBehavior') {
    blocks.push('```js\n// Prototype behavior — adapt to your framework\n' + op.js.trim() + '\n```');
  }
  if (op.op === 'mockNetwork') {
    blocks.push(
      '```json\n' +
        JSON.stringify(
          op.rules.map((r) => ({
            url: r.urlPattern,
            method: r.method ?? 'ANY',
            status: r.status ?? 200,
            responseBody: tryParse(r.body),
          })),
          null,
          2,
        ) +
        '\n```',
    );
  }
  return blocks;
}

function tryParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/** Deterministic change log — the assembler’s golden output. */
export function assembleChangeLog(revisions: Revision[], meta: { url: string; title: string }): string {
  const applied = revisions.filter((r) => r.parentId !== null);
  const lines: string[] = [];

  lines.push(`# Prototype change log`);
  lines.push('');
  lines.push(`Prototyped live on **${meta.title}** (${meta.url}) using Morph.`);
  lines.push(`${applied.length} revision${applied.length === 1 ? '' : 's'} applied, in order:`);
  lines.push('');

  if (applied.length === 0) {
    lines.push('_No changes were made._');
    return lines.join('\n');
  }

  applied.forEach((rev, i) => {
    lines.push(`## ${i + 1}. ${rev.instruction}`);
    lines.push('');
    lines.push(`_${rev.summary}_`);
    lines.push('');
    if (rev.ops.length === 0) {
      lines.push('(no operations recorded)');
    } else {
      for (const op of rev.ops) lines.push(opToMarkdown(op));
      lines.push('');
      for (const op of rev.ops) {
        for (const block of codeBlocks(op)) {
          lines.push(block);
          lines.push('');
        }
      }
    }
    if (rev.skipped.length) {
      lines.push(
        `> Not applied in the prototype (implement directly): ${rev.skipped
          .map((s) => `${describeOp(s.op)} — ${s.reason}`)
          .join('; ')}`,
      );
      lines.push('');
    }
  });

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
