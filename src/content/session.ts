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
import { ExportController } from './export-controller';
import { HistoryController } from './history/history-controller';
import { ManualGizmo } from './manual/gizmo';
import { ManualEditCoalescer } from './manual/manual-commit';
import type { ApplyDeps } from './ops/apply';
import { RefRegistry } from './refs/ref-registry';
import { MarqueeController } from './selection/marquee';
import { OverlayController } from './selection/overlays';
import { Sentinel } from './sentinel';
import { createMorphStore, type MorphStore } from './store';

export class Session {
  readonly store: MorphStore;
  readonly chatStore: ChatStore;
  readonly chat: ChatController;
  readonly refs: RefRegistry;
  readonly history: HistoryController;
  readonly behaviors: PageBehaviorHost;
  readonly exporter: ExportController;
  readonly sentinel: Sentinel;
  private applyDeps: ApplyDeps;
  private ui: UIHandle;
  private overlays: OverlayController;
  private editMode: EditModeController;
  private coalescer: ManualEditCoalescer;
  private gizmo: ManualGizmo;
  private marquee: MarqueeController;
  /** Timestamp until which click-selection is suppressed (after a marquee). */
  private suppressClickUntil = 0;

  constructor() {
    this.store = createMorphStore();
    this.chatStore = createChatStore();
    this.refs = new RefRegistry();
    this.behaviors = new PageBehaviorHost();
    this.applyDeps = { refs: this.refs, behaviors: this.behaviors };
    this.ui = mountUI(this);
    this.overlays = new OverlayController(this.store, this.ui.overlayContainer);
    this.sentinel = new Sentinel({
      trackedElements: () => this.refs.trackedElements(),
      onStale: () => {},
    });

    this.history = new HistoryController(this.store, this.applyDeps, () => {
      this.overlays.schedule();
      this.gizmo.schedule();
    });
    // Shield Morph's own DOM mutations from the sentinel (which watches for
    // page-initiated re-renders, not our edits).
    this.history.shield = (fn) => this.sentinel.shield(fn);
    this.history.shieldAsync = (fn) => this.sentinel.suspendDuring(fn);

    const manualDeps = {
      describe: (el: Element) => describeElement(el),
      refFor: (el: Element) => this.refs.refFor(el),
      commit: (instruction: string, plan: EditPlan) => this.history.applyAndCommitManual(instruction, plan),
      onCommitted: (summary: string) => this.chat.noteExternalChange(summary),
    };
    this.coalescer = new ManualEditCoalescer(manualDeps);
    this.gizmo = new ManualGizmo(this.store, this.ui.overlayContainer, manualDeps);
    this.exporter = new ExportController(this.history, this.behaviors, this.chatStore);
    this.marquee = new MarqueeController(this.store, {
      setRect: (rect) => this.overlays.setMarquee(rect),
      suppressNextClick: () => {
        this.suppressClickUntil = Date.now() + 350;
      },
    });
    this.editMode = new EditModeController(this.store, {
      onPromptRequested: () => this.ui.focusPrompt(),
      onUndo: () => this.history.undo(),
      onRedo: () => this.history.redo(),
      onDeleteRequested: () => void this.deleteSelection(),
      shouldSuppressClick: () => Date.now() < this.suppressClickUntil,
    });

    this.chat = new ChatController({
      store: this.store,
      chat: this.chatStore,
      applyDeps: this.applyDeps,
      hideUIDuring: (fn) => this.hideUIDuring(fn),
      shield: (fn) => this.sentinel.suspendDuring(fn),
      onPlanApplied: (outcome) => this.recordPlan(outcome),
      getRevisionSummaries: () => this.history.appliedSummaries(),
    });

    this.store.subscribe((state, prev) => {
      if (state.active !== prev.active) {
        this.ui.host.style.display = state.active ? '' : 'none';
        if (state.active) {
          document.documentElement.dataset['morphActive'] = 'true';
          void this.chat.refreshSettings();
          this.sentinel.start();
        } else {
          delete document.documentElement.dataset['morphActive'];
          this.sentinel.stop();
        }
      }
    });
  }

  /** Re-apply all edits after the page re-rendered over them. */
  async recoverFromReRender(): Promise<void> {
    const { staleCount } = await this.sentinel.suspendDuring(() => this.history.replayFromRoot());
    this.sentinel.reset();
    if (staleCount > 0) {
      this.chat.noteExternalChange(`${staleCount} edit(s) could not be re-applied after a page re-render.`);
    }
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

  /** Inspector editors stage live-previewed style changes here (debounced commit). */
  manualStage(el: Element, property: string, cssValue: string): void {
    this.coalescer.stage(el, property, cssValue);
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
    this.gizmo.destroy();
    this.ui.unmount();
  }
}
