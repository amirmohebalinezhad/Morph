// Drag-rectangle (marquee) selection: press and drag past a threshold to
// select every top-level element intersecting the rectangle. Runs only in
// select mode; a plain press-release (no drag) falls through to normal
// click-selection handled by edit-mode.
import { eventFromMorphUI, isSelectable } from '../dom-utils';
import type { MorphStore } from '../store';

const DRAG_THRESHOLD = 5;

export interface MarqueeDeps {
  /** Draws/positions the marquee rectangle in the overlay layer. */
  setRect(rect: { x: number; y: number; w: number; h: number } | null): void;
  /** Signal that a marquee just completed, so the follow-up click is ignored. */
  suppressNextClick(): void;
}

export class MarqueeController {
  private disposeMode: (() => void) | null = null;

  constructor(
    private store: MorphStore,
    private deps: MarqueeDeps,
  ) {
    this.store.subscribe(() => this.sync());
    this.sync();
  }

  private sync(): void {
    const { active, mode } = this.store.getState();
    const want = active && mode === 'select';
    if (want && !this.disposeMode) this.disposeMode = this.install();
    if (!want && this.disposeMode) {
      this.disposeMode();
      this.disposeMode = null;
      this.deps.setRect(null);
    }
  }

  private install(): () => void {
    let start: { x: number; y: number } | null = null;
    let dragging = false;

    // Runs in capture phase before edit-mode's pointerdown block, so it sees
    // the press. Arms a potential marquee anywhere; only a drag past the
    // threshold turns into one — a plain press-release stays a click.
    const onDown = (ev: PointerEvent) => {
      if (ev.button !== 0 || eventFromMorphUI(ev)) return;
      start = { x: ev.clientX, y: ev.clientY };
      dragging = false;
    };

    const onMove = (ev: PointerEvent) => {
      if (!start) return;
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (!dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      dragging = true;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      this.deps.setRect({
        x: Math.min(start.x, ev.clientX),
        y: Math.min(start.y, ev.clientY),
        w: Math.abs(dx),
        h: Math.abs(dy),
      });
    };

    const onUp = (ev: PointerEvent) => {
      if (!start) return;
      const wasDragging = dragging;
      const rect = {
        x: Math.min(start.x, ev.clientX),
        y: Math.min(start.y, ev.clientY),
        w: Math.abs(ev.clientX - start.x),
        h: Math.abs(ev.clientY - start.y),
      };
      start = null;
      dragging = false;
      this.deps.setRect(null);
      // wasDragging already means the pointer travelled past the threshold
      // diagonally; a thin horizontal or vertical band is still a valid marquee.
      if (!wasDragging) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();

      // Tell edit-mode to ignore the click that follows the drag, so its
      // click-selection (which targets the release point) doesn't overwrite
      // the marquee. Coordinated via the session because listener-registration
      // order can't guarantee we run before edit-mode's click handler.
      this.deps.suppressNextClick();

      const hits = this.elementsInRect(rect);
      if (hits.length) this.store.getState().selectMany(hits);
      else this.store.getState().clearSelection();
    };

    window.addEventListener('pointerdown', onDown, { capture: true });
    window.addEventListener('pointermove', onMove, { capture: true });
    window.addEventListener('pointerup', onUp, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', onDown, { capture: true });
      window.removeEventListener('pointermove', onMove, { capture: true });
      window.removeEventListener('pointerup', onUp, { capture: true });
    };
  }

  /**
   * Elements the marquee sweeps over: those that intersect the rectangle but
   * do NOT fully enclose it (enclosing elements are the background containers
   * the drag happened inside), keeping only the topmost of any nested pair.
   */
  private elementsInRect(rect: { x: number; y: number; w: number; h: number }): Element[] {
    const right = rect.x + rect.w;
    const bottom = rect.y + rect.h;
    const candidates: Element[] = [];
    for (const el of document.body.querySelectorAll('*')) {
      if (!isSelectable(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const intersects = r.left < right && r.right > rect.x && r.top < bottom && r.bottom > rect.y;
      if (!intersects) continue;
      // Skip containers that fully enclose the marquee (the drag surface).
      const encloses = r.left <= rect.x && r.top <= rect.y && r.right >= right && r.bottom >= bottom;
      if (encloses) continue;
      candidates.push(el);
    }
    // Keep only topmost: drop any element whose ancestor is also a candidate.
    return candidates.filter((el) => !candidates.some((other) => other !== el && other.contains(el)));
  }
}
