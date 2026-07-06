// Per-page composition root: wires the store, engines, and UI together.
// Created once on first activation; toggling off hides the UI and removes
// listeners but keeps state (history survives until the page unloads).
import type { EditPlan } from '../shared/edit-ops';
import { sendToBackground } from '../shared/messages';
import { mountUI, type UIHandle } from '../ui/mount';
import { PageBehaviorHost } from './behaviors/runtime-client';
import { ChatController, type PlanOutcome } from './chat-controller';
import { createChatStore, type ChatStore } from './chat-store';
import { describeElement } from './dom-utils';
import { EditModeController } from './edit-mode';
import { HistoryController } from './history/history-controller';
import type { ApplyDeps } from './ops/apply';
import { RefRegistry } from './refs/ref-registry';
import { OverlayController } from './selection/overlays';
import { createMorphStore, type MorphStore } from './store';

export class Session {
  readonly store: MorphStore;
  readonly chatStore: ChatStore;
  readonly chat: ChatController;
  readonly refs: RefRegistry;
  readonly history: HistoryController;
  readonly behaviors: PageBehaviorHost;
  private applyDeps: ApplyDeps;
  private ui: UIHandle;
  private overlays: OverlayController;
  private editMode: EditModeController;

  constructor() {
    this.store = createMorphStore();
    this.chatStore = createChatStore();
    this.refs = new RefRegistry();
    this.behaviors = new PageBehaviorHost();
    this.applyDeps = { refs: this.refs, behaviors: this.behaviors };
    this.ui = mountUI(this);
    this.overlays = new OverlayController(this.store, this.ui.overlayContainer);
    this.history = new HistoryController(this.store, this.applyDeps, () => this.overlays.schedule());
    this.editMode = new EditModeController(this.store, {
      onPromptRequested: () => this.ui.focusPrompt(),
      onUndo: () => this.history.undo(),
      onRedo: () => this.history.redo(),
      onDeleteRequested: () => void this.deleteSelection(),
    });

    this.chat = new ChatController({
      store: this.store,
      chat: this.chatStore,
      applyDeps: this.applyDeps,
      hideUIDuring: (fn) => this.hideUIDuring(fn),
      onPlanApplied: (outcome) => this.recordPlan(outcome),
      getRevisionSummaries: () => this.history.appliedSummaries(),
    });

    this.store.subscribe((state, prev) => {
      if (state.active !== prev.active) {
        this.ui.host.style.display = state.active ? '' : 'none';
        if (state.active) {
          document.documentElement.dataset['morphActive'] = 'true';
          void this.chat.refreshSettings();
        } else {
          delete document.documentElement.dataset['morphActive'];
        }
      }
    });
  }

  get active(): boolean {
    return this.store.getState().active;
  }

  setActive(on: boolean): void {
    this.store.getState().setActive(on);
  }

  /** Close from our own UI (badge must be told, unlike toolbar toggles). */
  requestClose(): void {
    this.setActive(false);
    void sendToBackground({ type: 'SET_BADGE', active: false }).catch(() => {});
  }

  openOptions(): void {
    void sendToBackground({ type: 'OPEN_OPTIONS' }).catch(() => {});
  }

  private recordPlan(outcome: PlanOutcome): void {
    this.history.commit('ai', outcome.instruction, outcome.plan, outcome.result);
  }

  /** Toolbar/keyboard delete: remove every selected element as one revision. */
  async deleteSelection(): Promise<void> {
    const selection = this.store.getState().selection.filter((el) => el.isConnected);
    if (!selection.length) return;
    const names = selection.map((el) => describeElement(el)).join(', ');
    const plan: EditPlan = {
      summary: `Deleted ${names}.`,
      operations: selection.map((el) => ({ op: 'removeElement', ref: this.refs.refFor(el) })),
      question: null,
      notes: null,
    };
    this.store.getState().clearSelection();
    await this.history.applyAndCommitManual(`Manual: delete ${names}`, plan);
    this.chat.noteExternalChange(plan.summary);
  }

  /** Toolbar duplicate: clone the primary selected element. */
  async duplicateSelection(): Promise<void> {
    const selection = this.store.getState().selection.filter((el) => el.isConnected);
    const primary = selection[selection.length - 1];
    if (!primary) return;
    const name = describeElement(primary);
    const plan: EditPlan = {
      summary: `Duplicated ${name}.`,
      operations: [
        { op: 'duplicateElement', ref: this.refs.refFor(primary), newRef: this.refs.uniqueNewRef() },
      ],
      question: null,
      notes: null,
    };
    await this.history.applyAndCommitManual(`Manual: duplicate ${name}`, plan);
    this.chat.noteExternalChange(plan.summary);
  }

  /** Hides all Morph chrome (panels + overlays) while fn runs — screenshots. */
  private async hideUIDuring<T>(fn: () => Promise<T>): Promise<T> {
    this.ui.host.style.visibility = 'hidden';
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      return await fn();
    } finally {
      this.ui.host.style.visibility = '';
    }
  }

  destroy(): void {
    this.editMode.destroy();
    this.overlays.destroy();
    this.ui.unmount();
  }
}
