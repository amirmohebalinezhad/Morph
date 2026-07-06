// Single source of truth for editor state, shared between the vanilla engine
// code (which mutates it) and the React UI (which subscribes via zustand's
// useStore). Holds live Element references on purpose — everything dies with
// the page, per product design.
import { createStore } from 'zustand/vanilla';

export type EditorMode = 'select' | 'interact';

export interface MorphState {
  active: boolean;
  mode: EditorMode;
  /** Ordered multi-selection; the last entry is the primary element. */
  selection: Element[];
  hovered: Element | null;

  setActive(active: boolean): void;
  setMode(mode: EditorMode): void;
  setHovered(el: Element | null): void;
  /** Click semantics: replace selection. Shift-click: toggle membership. */
  select(el: Element, opts?: { additive?: boolean }): void;
  selectMany(els: Element[]): void;
  clearSelection(): void;
  /** Drop selection entries that are no longer in the document. */
  pruneSelection(): void;
}

export type MorphStore = ReturnType<typeof createMorphStore>;

export function createMorphStore() {
  return createStore<MorphState>()((set, get) => ({
    active: false,
    mode: 'select',
    selection: [],
    hovered: null,

    setActive: (active) => set({ active, hovered: null }),
    setMode: (mode) => set({ mode, hovered: null }),
    setHovered: (hovered) => {
      if (get().hovered !== hovered) set({ hovered });
    },
    select: (el, opts) => {
      const { selection } = get();
      if (opts?.additive) {
        set({
          selection: selection.includes(el)
            ? selection.filter((s) => s !== el)
            : [...selection, el],
        });
      } else {
        set({ selection: [el] });
      }
    },
    selectMany: (els) => set({ selection: [...new Set(els)] }),
    clearSelection: () => set({ selection: [] }),
    pruneSelection: () => {
      const { selection, hovered } = get();
      const alive = selection.filter((el) => el.isConnected);
      const patch: Partial<MorphState> = {};
      if (alive.length !== selection.length) patch.selection = alive;
      if (hovered && !hovered.isConnected) patch.hovered = null;
      if (Object.keys(patch).length) set(patch);
    },
  }));
}

/** The primary (most recently added) selected element, if any. */
export function primarySelection(state: Pick<MorphState, 'selection'>): Element | null {
  return state.selection[state.selection.length - 1] ?? null;
}
