// Per-page composition root: wires the store, engines, and UI together.
// Created once on first activation; toggling off hides the UI and removes
// listeners but keeps state (history survives until the page unloads).
import { sendToBackground } from '../shared/messages';
import { mountUI, type UIHandle } from '../ui/mount';
import { EditModeController } from './edit-mode';
import { OverlayController } from './selection/overlays';
import { createMorphStore, type MorphStore } from './store';

export class Session {
  readonly store: MorphStore;
  private ui: UIHandle;
  private overlays: OverlayController;
  private editMode: EditModeController;

  constructor() {
    this.store = createMorphStore();
    this.ui = mountUI(this);
    this.overlays = new OverlayController(this.store, this.ui.overlayContainer);
    this.editMode = new EditModeController(this.store, {
      onPromptRequested: () => this.ui.focusPrompt(),
    });

    this.store.subscribe((state, prev) => {
      if (state.active !== prev.active) {
        this.ui.host.style.display = state.active ? '' : 'none';
        if (state.active) {
          document.documentElement.dataset['morphActive'] = 'true';
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

  destroy(): void {
    this.editMode.destroy();
    this.overlays.destroy();
    this.ui.unmount();
  }
}
