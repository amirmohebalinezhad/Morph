// Turns rapid manual style tweaks (inspector steppers, sliders, drags) into
// single history revisions. Changes preview live on the element immediately;
// after a quiet period the preview is reverted and the final values are
// re-applied through the normal applyPlan pipeline so the revision's inverse
// data is exactly right.
import type { EditPlan, StyleChange } from '../../shared/edit-ops';

interface StagedElement {
  el: HTMLElement | SVGElement;
  descriptor: string;
  /** First-seen inline value per property (the gesture's true "before"). */
  original: Map<string, string>;
  current: Map<string, string>;
}

export interface CoalescerDeps {
  debounceMs?: number;
  describe(el: Element): string;
  refFor(el: Element): string;
  commit(instruction: string, plan: EditPlan): Promise<unknown>;
  onCommitted?(summary: string): void;
}

export class ManualEditCoalescer {
  private staged = new Map<Element, StagedElement>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private deps: CoalescerDeps) {}

  /** Applies a live preview and schedules the debounced commit. */
  stage(el: Element, property: string, value: string): void {
    const styled = el as HTMLElement | SVGElement;
    let entry = this.staged.get(el);
    if (!entry) {
      entry = { el: styled, descriptor: this.deps.describe(el), original: new Map(), current: new Map() };
      this.staged.set(el, entry);
    }
    if (!entry.original.has(property)) {
      entry.original.set(property, styled.style.getPropertyValue(property));
    }
    entry.current.set(property, value);
    styled.style.setProperty(property, value);
    this.schedule();
  }

  hasPending(): boolean {
    return this.staged.size > 0;
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.deps.debounceMs ?? 900);
  }

  /** Commits everything staged as one manual revision. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.staged.size === 0) return;
    const entries = Array.from(this.staged.values()).filter((e) => e.el.isConnected);
    this.staged.clear();
    if (!entries.length) return;

    // Revert previews so applyPlan captures the pre-gesture inline values.
    for (const entry of entries) {
      for (const [prop, orig] of entry.original) {
        if (orig) entry.el.style.setProperty(prop, orig);
        else entry.el.style.removeProperty(prop);
      }
    }

    const descriptions: string[] = [];
    const operations = entries.map((entry) => {
      const styles: StyleChange[] = Array.from(entry.current, ([property, value]) => ({ property, value }));
      for (const [prop, value] of entry.current) {
        const from = entry.original.get(prop);
        descriptions.push(`${prop}: ${from || '(unset)'} → ${value} on ${entry.descriptor}`);
      }
      return { op: 'setStyles' as const, ref: this.deps.refFor(entry.el), styles };
    });

    const detail = descriptions.slice(0, 4).join('; ') + (descriptions.length > 4 ? '; …' : '');
    const plan: EditPlan = {
      summary: `Manually adjusted ${detail}.`,
      operations,
      question: null,
      notes: null,
    };

    try {
      await this.deps.commit(`Manual: ${detail}`, plan);
      this.deps.onCommitted?.(plan.summary);
    } catch (err) {
      console.warn('[morph] manual edit commit failed', err);
    }
  }
}
