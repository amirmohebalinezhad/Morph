// Global event interception. In select mode, capture-phase listeners on
// window swallow the page's pointer interactions and turn them into
// selection; our own shadow UI is exempted via composedPath. In interact
// mode nothing is intercepted — the prototype behaves like the real page.
import { eventFromMorphUI } from './dom-utils';
import { deepElementFromPoint } from './selection/hit-test';
import { navigateFrom } from './selection/keyboard-nav';
import { primarySelection, type MorphStore } from './store';

export interface EditModeHooks {
  /** Enter pressed with a selection → focus the prompt input (wired in M2). */
  onPromptRequested?: () => void;
  /** Delete pressed with a selection (wired to a manual revision in M3). */
  onDeleteRequested?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
}

const BLOCKED_EVENTS = [
  'pointerdown',
  'mousedown',
  'pointerup',
  'mouseup',
  'click',
  'dblclick',
  'auxclick',
  'touchstart',
  'touchend',
] as const;

export class EditModeController {
  private disposeSelect: (() => void) | null = null;
  private disposeAlways: (() => void) | null = null;
  private hoverRaf = 0;
  private lastPoint: { x: number; y: number } | null = null;

  constructor(
    private store: MorphStore,
    private hooks: EditModeHooks = {},
  ) {
    this.store.subscribe(() => this.sync());
    this.sync();
  }

  private sync(): void {
    const { active, mode } = this.store.getState();
    const wantSelect = active && mode === 'select';
    if (wantSelect && !this.disposeSelect) this.disposeSelect = this.installSelectListeners();
    if (!wantSelect && this.disposeSelect) {
      this.disposeSelect();
      this.disposeSelect = null;
      this.store.getState().setHovered(null);
    }
    if (active && !this.disposeAlways) this.disposeAlways = this.installKeyListener();
    if (!active && this.disposeAlways) {
      this.disposeAlways();
      this.disposeAlways = null;
    }
  }

  private installSelectListeners(): () => void {
    const opts: AddEventListenerOptions = { capture: true };

    const block = (ev: Event) => {
      if (eventFromMorphUI(ev)) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      if (ev.type === 'click') this.handleSelectClick(ev as MouseEvent);
    };

    const onPointerMove = (ev: PointerEvent) => {
      if (eventFromMorphUI(ev)) {
        this.lastPoint = null;
        this.store.getState().setHovered(null);
        return;
      }
      this.lastPoint = { x: ev.clientX, y: ev.clientY };
      if (this.hoverRaf) return;
      this.hoverRaf = requestAnimationFrame(() => {
        this.hoverRaf = 0;
        if (!this.lastPoint) return;
        const el = deepElementFromPoint(this.lastPoint.x, this.lastPoint.y);
        this.store.getState().setHovered(el);
      });
    };

    for (const type of BLOCKED_EVENTS) window.addEventListener(type, block, opts);
    window.addEventListener('pointermove', onPointerMove, { capture: true, passive: true });

    return () => {
      for (const type of BLOCKED_EVENTS) window.removeEventListener(type, block, opts);
      window.removeEventListener('pointermove', onPointerMove, { capture: true });
      if (this.hoverRaf) {
        cancelAnimationFrame(this.hoverRaf);
        this.hoverRaf = 0;
      }
    };
  }

  private handleSelectClick(ev: MouseEvent): void {
    const el = deepElementFromPoint(ev.clientX, ev.clientY);
    if (!el) return;
    this.store.getState().select(el, { additive: ev.shiftKey });
  }

  /** Keyboard shortcuts live while Morph is active (both modes). */
  private installKeyListener(): () => void {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (eventFromMorphUI(ev)) return; // typing in our panels
      const state = this.store.getState();
      if (state.mode !== 'select') return;

      const primary = primarySelection(state);
      const mod = ev.metaKey || ev.ctrlKey;

      if (mod && (ev.key === 'z' || ev.key === 'Z')) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        if (ev.shiftKey) this.hooks.onRedo?.();
        else this.hooks.onUndo?.();
        return;
      }
      if (ev.key === 'Escape') {
        if (state.selection.length) {
          ev.preventDefault();
          ev.stopImmediatePropagation();
          state.clearSelection();
        }
        return;
      }
      if (!primary) return;

      if (ev.key.startsWith('Arrow')) {
        const next = navigateFrom(primary, ev.key);
        if (next) {
          ev.preventDefault();
          ev.stopImmediatePropagation();
          state.select(next);
        }
        return;
      }
      if (ev.key === 'Enter' && !mod) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        this.hooks.onPromptRequested?.();
        return;
      }
      if (ev.key === 'Delete' || ev.key === 'Backspace') {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        this.hooks.onDeleteRequested?.();
      }
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }

  destroy(): void {
    this.disposeSelect?.();
    this.disposeAlways?.();
    this.disposeSelect = null;
    this.disposeAlways = null;
  }
}
