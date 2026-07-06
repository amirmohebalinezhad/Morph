// Deterministic provider for development and e2e tests: canned edit plans
// keyed by instruction patterns, fake streaming with realistic pacing, zero
// network. Selected via settings.provider = 'mock'.
import type { EditPlan } from '../../../shared/edit-ops';
import type { EditPlanRequestWire, ExportRequestWire, TokenUsage } from '../../../shared/wire-types';
import { EMPTY_USAGE, type AIProvider, type StreamCallbacks } from '../provider';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type PlanFactory = (req: EditPlanRequestWire, primaryRef: string) => EditPlan;

const PLANS: Array<{ pattern: RegExp; make: PlanFactory }> = [
  {
    pattern: /red/i,
    make: (_req, ref) => ({
      summary: 'Making the selected element red with white text.',
      operations: [
        {
          op: 'setStyles',
          ref,
          styles: [
            { property: 'background-color', value: '#dc2626' },
            { property: 'color', value: '#ffffff' },
          ],
        },
      ],
      question: null,
      notes: null,
    }),
  },
  {
    pattern: /taller/i,
    make: (_req, ref) => ({
      summary: 'Increasing the element height to 240px.',
      operations: [{ op: 'setStyles', ref, styles: [{ property: 'height', value: '240px' }] }],
      question: null,
      notes: null,
    }),
  },
  {
    pattern: /cards?/i,
    make: (_req, ref) => ({
      summary: 'Replacing the selected element with a responsive card grid.',
      operations: [
        {
          op: 'insertElement',
          targetRef: ref,
          position: 'replace',
          html: `<div class="morph-card-grid" role="list"><div class="morph-card" role="listitem"><h3>Ada Lovelace</h3><p>ada@example.com</p><span class="morph-chip">Pro</span></div><div class="morph-card" role="listitem"><h3>Grace Hopper</h3><p>grace@example.com</p><span class="morph-chip">Team</span></div><div class="morph-card" role="listitem"><h3>Alan Turing</h3><p>alan@example.com</p><span class="morph-chip">Free</span></div></div>`,
          newRef: 'n1',
        },
        {
          op: 'upsertStylesheet',
          id: 'card-grid',
          css: `.morph-card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}.morph-card{background:#fff;border:1px solid #e3e7ee;border-radius:10px;padding:14px}.morph-card h3{margin:0 0 4px;font-size:15px}.morph-card p{margin:0 0 8px;color:#5d6982;font-size:13px}.morph-chip{display:inline-block;background:#eef1ff;color:#2f4bff;border-radius:99px;padding:2px 10px;font-size:12px;font-weight:600}`,
        },
      ],
      question: null,
      notes: null,
    }),
  },
  {
    pattern: /counter|click/i,
    make: (_req, ref) => ({
      summary: 'Adding a click-count behavior to the selected element.',
      operations: [
        {
          op: 'addBehavior',
          id: 'mock-counter',
          description: 'Counts clicks on the element and shows the tally in a badge.',
          js: `const el = morph.el('${ref}');\nlet n = 0;\nconst badge = document.createElement('span');\nbadge.setAttribute('data-morph-badge', 'counter');\nbadge.textContent = ' (0 clicks)';\nel.appendChild(badge);\nmorph.onCleanup(() => badge.remove());\nmorph.on(el, 'click', () => { n += 1; badge.textContent = ' (' + n + ' clicks)'; });`,
        },
      ],
      question: null,
      notes: null,
    }),
  },
  {
    pattern: /mock|fake|api/i,
    make: () => ({
      summary: 'Mocking the stats API with impressive fake numbers.',
      operations: [
        {
          op: 'mockNetwork',
          rules: [
            {
              urlPattern: '/api/stats',
              method: null,
              status: 200,
              contentType: 'application/json',
              body: '{"users": 99999, "revenue": "$1,000,000", "uptime": "100%"}',
              delayMs: null,
            },
          ],
        },
      ],
      question: null,
      notes: null,
    }),
  },
  {
    pattern: /question/i,
    make: () => ({
      summary: 'I need one clarification before changing anything.',
      operations: [],
      question: 'Should this apply to all cards or only the selected one?',
      notes: null,
    }),
  },
];

const DEFAULT_PLAN: PlanFactory = (_req, ref) => ({
  summary: 'Marking the selected element as touched (mock provider default).',
  operations: [
    { op: 'setAttributes', ref, attributes: [{ name: 'data-morph-touched', value: 'true' }] },
  ],
  question: null,
  notes: 'Mock provider: no real AI was called.',
});

export class MockProvider implements AIProvider {
  readonly id = 'mock';

  capabilities() {
    return { vision: true };
  }

  async generateEditPlan(
    req: EditPlanRequestWire,
    cb: StreamCallbacks,
    signal: AbortSignal,
  ): Promise<{ plan: EditPlan; usage: TokenUsage }> {
    const primaryRef = req.selected[req.selected.length - 1]?.ref ?? 'e1';
    const factory = PLANS.find((p) => p.pattern.test(req.instruction))?.make ?? DEFAULT_PLAN;
    const plan = factory(req, primaryRef);

    cb.onPhase('sending');
    await sleep(30);
    if (signal.aborted) throw new DOMException('aborted', 'AbortError');
    cb.onPhase('streaming');

    // Stream the summary in three chunks to exercise the streaming UI.
    const third = Math.ceil(plan.summary.length / 3);
    for (let i = 0; i < plan.summary.length; i += third) {
      await sleep(30);
      if (signal.aborted) throw new DOMException('aborted', 'AbortError');
      cb.onSummaryDelta(plan.summary.slice(i, i + third));
    }
    cb.onPhase('validating');
    await sleep(20);
    return { plan, usage: EMPTY_USAGE };
  }

  async generateExportDoc(
    req: ExportRequestWire,
    cb: StreamCallbacks,
    _signal: AbortSignal,
  ): Promise<{ markdown: string; usage: TokenUsage }> {
    cb.onPhase('streaming');
    const markdown = [
      `# Implementation prompt (mock provider)`,
      '',
      `This prototype introduces UI changes on **${req.title}** (${req.url}).`,
      '',
      '## Changes',
      req.changeLog,
      '',
      '## Note',
      'Generated by the mock provider — configure a real AI provider for a polished brief.',
    ].join('\n');
    for (const chunk of markdown.split('\n\n')) {
      await sleep(15);
      cb.onSummaryDelta(chunk + '\n\n');
    }
    return { markdown, usage: EMPTY_USAGE };
  }
}
