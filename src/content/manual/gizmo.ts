// Resize + move gizmo for the primary selection: 8 resize handles and a move
// grip rendered in the shadow overlay layer (pointer-events on, unlike the
// highlight boxes). Gestures preview live and commit one manual revision on
// release, via the same pipeline as AI edits.
import type { EditPlan, StyleChange } from '../../shared/edit-ops';
import { primarySelection, type MorphStore } from '../store';

type HandleDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const RESIZE_DIRS: HandleDir[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const CURSORS: Record<HandleDir, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
};

export interface GizmoDeps {
  describe(el: Element): string;
  refFor(el: Element): string;
  commit(instruction: string, plan: EditPlan): Promise<unknown>;
  onCommitted?(summary: string): void;
}

interface Gesture {
  kind: 'resize' | 'move';
  el: HTMLElement | SVGElement;
  dir: HandleDir | null;
  startX: number;
  startY: number;
  startW: number;
  startH: number;
  baseTransform: string;
  original: Map<string, string>;
  changed: Map<string, string>;
}

export class ManualGizmo {
  private layer: HTMLDivElement;
  private handles = new Map<HandleDir, HTMLDivElement>();
  private moveGrip: HTMLDivElement;
  private raf = 0;
  private ro: ResizeObserver;
  private disposers: Array<() => void> = [];
  private gesture: Gesture | null = null;

  constructor(
    private store: MorphStore,
    container: HTMLElement,
    private deps: GizmoDeps,
  ) {
    this.layer = document.createElement('div');
    this.layer.className = 'morph-gizmo';
    this.layer.style.display = 'none';

    for (const dir of RESIZE_DIRS) {
      const h = document.createElement('div');
      h.className = `morph-gizmo-handle dir-${dir}`;
      h.dataset['morphHandle'] = dir;
      h.style.cursor = CURSORS[dir];
      h.addEventListener('pointerdown', (ev) => this.beginResize(dir, ev));
      this.layer.appendChild(h);
      this.handles.set(dir, h);
    }

    this.moveGrip = document.createElement('div');
    this.moveGrip.className = 'morph-gizmo-move';
    this.moveGrip.dataset['morphHandle'] = 'move';
    this.moveGrip.title = 'Drag to move (adds a CSS translate)';
    this.moveGrip.textContent = '✥';
    this.moveGrip.addEventListener('pointerdown', (ev) => this.beginMove(ev));
    this.layer.appendChild(this.moveGrip);

    container.appendChild(this.layer);

    this.ro = new ResizeObserver(() => this.schedule());
    this.ro.observe(document.documentElement);
    const onScroll = () => this.schedule();
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    this.disposers.push(
      () => window.removeEventListener('scroll', onScroll, { capture: true }),
      () => window.removeEventListener('resize', onScroll),
      this.store.subscribe(() => this.schedule()),
    );
    this.schedule();
  }

  private target(): (HTMLElement | SVGElement) | null {
    const { active, mode } = this.store.getState();
    if (!active || mode !== 'select') return null;
    const primary = primarySelection(this.store.getState());
    if (!primary || !primary.isConnected) return null;
    if (primary === document.body || primary === document.documentElement) return null;
    return primary as HTMLElement | SVGElement;
  }

  schedule(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.position();
    });
  }

  private position(): void {
    const el = this.target();
    if (!el) {
      this.layer.style.display = 'none';
      return;
    }
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) {
      this.layer.style.display = 'none';
      return;
    }
    this.layer.style.display = 'block';
    this.layer.style.transform = `translate(${r.left}px, ${r.top}px)`;
    this.layer.style.width = `${r.width}px`;
    this.layer.style.height = `${r.height}px`;
  }

  private beginGesture(kind: Gesture['kind'], dir: HandleDir | null, ev: PointerEvent): void {
    const el = this.target();
    if (!el) return;
    ev.preventDefault();
    ev.stopPropagation();
    const rect = el.getBoundingClientRect();
    const style = el.style;
    this.gesture = {
      kind,
      el,
      dir,
      startX: ev.clientX,
      startY: ev.clientY,
      startW: rect.width,
      startH: rect.height,
      baseTransform: style.transform && style.transform !== 'none' ? style.transform : '',
      original: new Map([
        ['width', style.getPropertyValue('width')],
        ['height', style.getPropertyValue('height')],
        ['transform', style.getPropertyValue('transform')],
      ]),
      changed: new Map(),
    };
    const onMove = (e: PointerEvent) => this.onPointerMove(e);
    const onUp = (e: PointerEvent) => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      this.endGesture(e);
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
  }

  private beginResize(dir: HandleDir, ev: PointerEvent): void {
    this.beginGesture('resize', dir, ev);
  }

  private beginMove(ev: PointerEvent): void {
    this.beginGesture('move', null, ev);
  }

  private onPointerMove(ev: PointerEvent): void {
    const g = this.gesture;
    if (!g) return;
    ev.preventDefault();
    ev.stopPropagation();
    const dx = ev.clientX - g.startX;
    const dy = ev.clientY - g.startY;

    if (g.kind === 'move') {
      const translate = `translate(${Math.round(dx)}px, ${Math.round(dy)}px)`;
      const value = g.baseTransform ? `${g.baseTransform} ${translate}` : translate;
      g.el.style.setProperty('transform', value);
      g.changed.set('transform', value);
    } else if (g.dir) {
      if (g.dir.includes('e')) this.setSize(g, 'width', g.startW + dx);
      if (g.dir.includes('w')) this.setSize(g, 'width', g.startW - dx);
      if (g.dir.includes('s')) this.setSize(g, 'height', g.startH + dy);
      if (g.dir.includes('n')) this.setSize(g, 'height', g.startH - dy);
    }
    this.schedule();
  }

  private setSize(g: Gesture, prop: 'width' | 'height', px: number): void {
    const value = `${Math.max(8, Math.round(px))}px`;
    g.el.style.setProperty(prop, value);
    g.changed.set(prop, value);
  }

  private endGesture(ev: PointerEvent): void {
    const g = this.gesture;
    this.gesture = null;
    if (!g) return;
    ev.preventDefault();
    ev.stopPropagation();

    if (g.changed.size === 0) {
      this.schedule();
      return;
    }

    // Revert the live preview, then commit through the normal pipeline so the
    // revision's inverse captures the true pre-gesture values.
    for (const [prop, orig] of g.original) {
      if (orig) g.el.style.setProperty(prop, orig);
      else g.el.style.removeProperty(prop);
    }

    const styles: StyleChange[] = Array.from(g.changed, ([property, value]) => ({ property, value }));
    const descriptor = this.deps.describe(g.el);
    const what =
      g.kind === 'move'
        ? `moved ${descriptor}`
        : `resized ${descriptor} to ${g.changed.get('width') ?? 'auto'} × ${g.changed.get('height') ?? 'auto'}`;
    const plan: EditPlan = {
      summary: `Manually ${what}.`,
      operations: [{ op: 'setStyles', ref: this.deps.refFor(g.el), styles }],
      question: null,
      notes: null,
    };
    void this.deps
      .commit(`Manual: ${what}`, plan)
      .then(() => this.deps.onCommitted?.(plan.summary))
      .catch((err) => console.warn('[morph] gizmo commit failed', err))
      .finally(() => this.schedule());
  }

  destroy(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    for (const d of this.disposers) d();
    this.layer.remove();
  }
}
