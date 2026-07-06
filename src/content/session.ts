// Per-page composition root: wires the store, engines, and UI together.
// Created once on first activation; toggling off hides the UI and removes
// listeners but keeps state (history survives until the page unloads).
import { sendToBackground } from '../shared/messages';
import { mountUI, type UIHandle } from '../ui/mount';
import { ChatController, type PlanOutcome } from './chat-controller';
import { createChatStore, type ChatStore } from './chat-store';
import { EditModeController } from './edit-mode';
import { unavailableBehaviorHost } from './ops/apply';
import { RefRegistry } from './refs/ref-registry';
import { OverlayController } from './selection/overlays';
import { createMorphStore, type MorphStore } from './store';

export class Session {
  readonly store: MorphStore;
  readonly chatStore: ChatStore;
  readonly chat: ChatController;
  readonly refs: RefRegistry;
  private ui: UIHandle;
  private overlays: OverlayController;
  private editMode: EditModeController;
  /** M2: flat log of applied plans; M3 replaces this with the revision tree. */
  private appliedSummaries: string[] = [];

  constructor() {
    this.store = createMorphStore();
    this.chatStore = createChatStore();
    this.refs = new RefRegistry();
    this.ui = mountUI(this);
    this.overlays = new OverlayController(this.store, this.ui.overlayContainer);
    this.editMode = new EditModeController(this.store, {
      onPromptRequested: () => this.ui.focusPrompt(),
    });

    this.chat = new ChatController({
      store: this.store,
      chat: this.chatStore,
      applyDeps: {
        refs: this.refs,
        behaviors: unavailableBehaviorHost(
          'Interactive behaviors need the Morph page runtime, which is not available yet.',
        ),
      },
      hideUIDuring: (fn) => this.hideUIDuring(fn),
      onPlanApplied: (outcome) => this.recordPlan(outcome),
      getRevisionSummaries: () => [...this.appliedSummaries],
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
    this.appliedSummaries.push(outcome.plan.summary);
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
