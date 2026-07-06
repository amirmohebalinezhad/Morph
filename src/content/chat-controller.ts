// Orchestrates one AI edit turn: build context (+screenshot) → stream the
// plan → apply it atomically → record the outcome for conversation memory
// and (M3) the revision tree.
import { describeOp, type EditPlan } from '../shared/edit-ops';
import { genId } from '../shared/ids';
import { sendToBackground } from '../shared/messages';
import type { ChatTurnWire } from '../shared/wire-types';
import { AiRequestError, generatePlan } from './ai-client';
import type { ChatStore } from './chat-store';
import { buildEditPlanRequest } from './context/context-builder';
import { ApplyError, applyPlan, type ApplyDeps, type ApplyResult } from './ops/apply';
import type { MorphStore } from './store';

export interface PlanOutcome {
  instruction: string;
  plan: EditPlan;
  result: ApplyResult;
}

export interface ChatControllerDeps {
  store: MorphStore;
  chat: ChatStore;
  applyDeps: ApplyDeps;
  /** Hides the Morph UI (overlays + panels) while fn runs — for screenshots. */
  hideUIDuring<T>(fn: () => Promise<T>): Promise<T>;
  /** Called after a plan applies successfully (M3 commits a revision here). */
  onPlanApplied(outcome: PlanOutcome): void;
  /** Summaries of currently-applied revisions, oldest first. */
  getRevisionSummaries(): string[];
}

export class ChatController {
  private conversation: ChatTurnWire[] = [];
  private abort: AbortController | null = null;

  constructor(private deps: ChatControllerDeps) {
    void this.refreshSettings();
  }

  async refreshSettings(): Promise<void> {
    try {
      this.deps.chat.getState().setSettings(await sendToBackground({ type: 'GET_PUBLIC_SETTINGS' }));
    } catch {
      // background unavailable; leave null — UI shows a generic hint
    }
  }

  cancel(): void {
    this.abort?.abort();
  }

  async submit(rawInstruction: string): Promise<void> {
    const instruction = rawInstruction.trim();
    const chat = this.deps.chat.getState();
    if (!instruction || this.deps.chat.getState().busy) return;

    const settings = this.deps.chat.getState().settings;
    chat.add({ id: genId('msg'), role: 'user', text: instruction, status: 'done' });
    const assistantId = genId('msg');
    chat.add({ id: assistantId, role: 'assistant', text: '', status: 'streaming', phase: 'sending' });
    chat.setBusy(true);
    this.abort = new AbortController();

    try {
      const screenshot =
        settings?.sendScreenshots !== false && settings?.vision !== false
          ? await this.captureScreenshot()
          : null;

      const payload = buildEditPlanRequest({
        instruction,
        selection: this.deps.store.getState().selection.filter((el) => el.isConnected),
        refs: this.deps.applyDeps.refs,
        conversation: this.conversation,
        revisionSummaries: this.deps.getRevisionSummaries(),
        screenshot,
      });

      const { plan, usage } = await generatePlan(
        payload,
        {
          onPhase: (phase) => chat.update(assistantId, { phase }),
          onDelta: (delta) => chat.appendText(assistantId, delta),
        },
        this.abort.signal,
      );

      if (plan.question && plan.operations.length === 0) {
        chat.update(assistantId, { text: plan.question, status: 'question', usage });
        this.pushTurn(instruction, `(asked for clarification: ${plan.question})`);
        return;
      }

      const result = await applyPlan(plan, this.deps.applyDeps);
      this.deps.onPlanApplied({ instruction, plan, result });

      const digest = plan.operations.map(describeOp).join('; ');
      this.pushTurn(instruction, `${plan.summary}\nApplied ops: ${digest || '(none)'}`);

      chat.update(assistantId, {
        text: plan.summary,
        status: 'done',
        usage,
        notes: plan.notes,
        skippedNotes: result.skipped.length
          ? result.skipped.map((s) => `${describeOp(s.op)} — ${s.reason}`)
          : undefined,
      });
    } catch (err) {
      if (err instanceof ApplyError) {
        chat.update(assistantId, {
          status: 'error',
          error: { code: 'unknown', message: `The plan could not be applied: ${err.message}`, retryable: true },
        });
        this.pushTurn(instruction, `(the plan failed to apply: ${err.message})`);
      } else if (err instanceof AiRequestError) {
        chat.update(assistantId, { status: 'error', error: err.aiError });
      } else {
        chat.update(assistantId, {
          status: 'error',
          error: {
            code: 'unknown',
            message: err instanceof Error ? err.message : String(err),
            retryable: true,
          },
        });
      }
    } finally {
      this.abort = null;
      chat.setBusy(false);
    }
  }

  /** Records a completed exchange for future-turn context. */
  private pushTurn(user: string, assistant: string): void {
    this.conversation.push({ role: 'user', text: user }, { role: 'assistant', text: assistant });
  }

  /** Manual edits (M3+) also become conversation context. */
  noteExternalChange(summary: string): void {
    this.conversation.push(
      { role: 'user', text: '(manual edit via inspector)' },
      { role: 'assistant', text: summary },
    );
  }

  private async captureScreenshot(): Promise<string | null> {
    try {
      return await this.deps.hideUIDuring(async () => {
        const res = await sendToBackground({ type: 'CAPTURE_VIEWPORT', maxWidth: 1024, quality: 0.8 });
        return res.base64;
      });
    } catch {
      return null; // capture failure degrades to text-only context
    }
  }
}
