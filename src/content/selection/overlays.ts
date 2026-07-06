// Imperative highlight overlays (hover box, selection boxes, label chips)
// rendered into the shadow root beside the React app. Kept out of React for
// per-frame repositioning performance.
import { describeElement } from '../dom-utils';
import { primarySelection, type MorphStore } from '../store';

const BOX_POOL_LIMIT = 64;

export class OverlayController {
  private layer: HTMLDivElement;
  private hoverBox: HTMLDivElement;
  private hoverLabel: HTMLDivElement;
  private selBoxes: HTMLDivElement[] = [];
  private raf = 0;
  private ro: ResizeObserver;
  private disposers: Array<() => void> = [];

  private marqueeBox: HTMLDivElement;

  constructor(
    private store: MorphStore,
    container: HTMLElement,
  ) {
    this.layer = document.createElement('div');
    this.layer.className = 'morph-overlays';

    this.hoverBox = document.createElement('div');
    this.hoverBox.className = 'morph-box morph-box-hover';
    this.hoverLabel = document.createElement('div');
    this.hoverLabel.className = 'morph-box-label';
    this.hoverBox.appendChild(this.hoverLabel);
    this.layer.appendChild(this.hoverBox);

    this.marqueeBox = document.createElement('div');
    this.marqueeBox.className = 'morph-marquee';
    this.marqueeBox.style.display = 'none';
    this.layer.appendChild(this.marqueeBox);

    container.appendChild(this.layer);

    this.ro = new ResizeObserver(() => this.schedule());
    this.ro.observe(document.documentElement);

    const onScroll = () => this.schedule();
    const onResize = () => this.schedule();
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('resize', onResize, { passive: true });
    this.disposers.push(
      () => window.removeEventListener('scroll', onScroll, { capture: true }),
      () => window.removeEventListener('resize', onResize),
      this.store.subscribe(() => {
        this.syncObservedElements();
        this.schedule();
      }),
    );
    this.schedule();
  }

  /** Ask for a reposition on the next animation frame (rAF-batched). */
  schedule(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.position();
    });
  }

  private observed = new Set<Element>();
  private syncObservedElements(): void {
    const { selection } = this.store.getState();
    const next = new Set(selection);
    for (const el of this.observed) {
      if (!next.has(el)) this.ro.unobserve(el);
    }
    for (const el of next) {
      if (!this.observed.has(el) && el.isConnected) this.ro.observe(el);
    }
    this.observed = next;
  }

  private ensureSelBox(i: number): HTMLDivElement {
    while (this.selBoxes.length <= i) {
      const box = document.createElement('div');
      box.className = 'morph-box morph-box-selected';
      const label = document.createElement('div');
      label.className = 'morph-box-label';
      box.appendChild(label);
      this.layer.appendChild(box);
      this.selBoxes.push(box);
    }
    return this.selBoxes[i]!;
  }

  private placeBox(box: HTMLDivElement, el: Element, label: string | null): void {
    if (!el.isConnected) {
      box.style.display = 'none';
      return;
    }
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) {
      box.style.display = 'none';
      return;
    }
    box.style.display = 'block';
    box.style.transform = `translate(${r.left}px, ${r.top}px)`;
    box.style.width = `${r.width}px`;
    box.style.height = `${r.height}px`;
    const labelEl = box.firstElementChild as HTMLDivElement | null;
    if (labelEl) {
      if (label) {
        labelEl.style.display = 'block';
        labelEl.textContent = `${label}  ${Math.round(r.width)}×${Math.round(r.height)}`;
        // Flip the chip inside the box when there is no room above.
        labelEl.classList.toggle('inside', r.top < 26);
      } else {
        labelEl.style.display = 'none';
      }
    }
  }

  private position(): void {
    const { active, mode, hovered, selection } = this.store.getState();
    if (!active) {
      this.layer.style.display = 'none';
      return;
    }
    this.layer.style.display = 'block';

    const showHover = mode === 'select' && hovered && !selection.includes(hovered);
    if (showHover) {
      this.placeBox(this.hoverBox, hovered, describeElement(hovered));
    } else {
      this.hoverBox.style.display = 'none';
    }

    const primary = primarySelection({ selection });
    const visible = selection.slice(0, BOX_POOL_LIMIT);
    visible.forEach((el, i) => {
      const box = this.ensureSelBox(i);
      this.placeBox(box, el, el === primary ? describeElement(el) : null);
    });
    for (let i = visible.length; i < this.selBoxes.length; i++) {
      this.selBoxes[i]!.style.display = 'none';
    }
  }

  /** MarqueeController feeds the drag rectangle here (viewport coords). */
  setMarquee(rect: { x: number; y: number; w: number; h: number } | null): void {
    if (!rect) {
      this.marqueeBox.style.display = 'none';
      return;
    }
    this.marqueeBox.style.display = 'block';
    this.marqueeBox.style.transform = `translate(${rect.x}px, ${rect.y}px)`;
    this.marqueeBox.style.width = `${rect.w}px`;
    this.marqueeBox.style.height = `${rect.h}px`;
  }

  destroy(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    for (const d of this.disposers) d();
    this.layer.remove();
  }
}
