// Drives the Export dialog: assembles the deterministic change log, optionally
// runs the AI polish pass, and exposes copy/download. State lives in a zustand
// store the ExportDialog subscribes to.
import { createStore } from 'zustand/vanilla';
import { sendToBackground } from '../shared/messages';
import type { AiError } from '../shared/wire-types';
import { AiRequestError, generateExport } from './ai-client';
import { buildHtmlSnapshot } from './export/export-html';
import { assembleChangeLog } from './export/export-doc';
import type { HistoryController } from './history/history-controller';
import type { PageBehaviorHost } from './behaviors/runtime-client';
import type { ChatStore } from './chat-store';

export interface ExportState {
  open: boolean;
  /** Deterministic change log (always available). */
  changeLog: string;
  /** AI-polished implementation prompt (when a provider ran). */
  polished: string;
  polishing: boolean;
  polishError: AiError | null;
  userNotes: string;
  view: 'prompt' | 'changelog';
  copied: boolean;

  set(patch: Partial<ExportState>): void;
}

export type ExportStore = ReturnType<typeof createExportStore>;

function createExportStore() {
  return createStore<ExportState>()((set) => ({
    open: false,
    changeLog: '',
    polished: '',
    polishing: false,
    polishError: null,
    userNotes: '',
    view: 'prompt',
    copied: false,
    set: (patch) => set(patch),
  }));
}

export class ExportController {
  readonly store: ExportStore = createExportStore();
  private abort: AbortController | null = null;

  constructor(
    private history: HistoryController,
    private behaviors: PageBehaviorHost,
    private chat: ChatStore,
  ) {}

  /** The markdown currently shown (polished if present, else deterministic). */
  currentMarkdown(): string {
    const s = this.store.getState();
    return s.view === 'changelog' ? s.changeLog : s.polished || s.changeLog;
  }

  open(): void {
    const revisions = this.history.tree
      .pathToRoot(this.history.tree.head.id)
      .reverse();
    const changeLog = assembleChangeLog(revisions, { url: location.href, title: document.title });
    this.store.getState().set({
      open: true,
      changeLog,
      polished: '',
      polishError: null,
      copied: false,
      view: 'prompt',
    });
    void this.polish(changeLog);
  }

  close(): void {
    this.abort?.abort();
    this.store.getState().set({ open: false });
  }

  setNotes(notes: string): void {
    this.store.getState().set({ userNotes: notes });
  }

  setView(view: 'prompt' | 'changelog'): void {
    this.store.getState().set({ view, copied: false });
  }

  /** Runs the AI polish pass; falls back silently to the deterministic log. */
  async polish(changeLog?: string): Promise<void> {
    const s = this.store.getState();
    const log = changeLog ?? s.changeLog;
    const provider = this.chat.getState().settings;
    if (!provider?.providerConfigured) {
      // No provider: the deterministic change log is the export.
      s.set({ polishing: false, polished: '', polishError: null });
      return;
    }

    this.abort?.abort();
    this.abort = new AbortController();
    s.set({ polishing: true, polished: '', polishError: null });

    try {
      const { markdown } = await generateExport(
        {
          url: location.href,
          title: document.title,
          changeLog: log,
          userNotes: s.userNotes.trim() || null,
        },
        {
          onDelta: (delta) =>
            this.store.getState().set({ polished: this.store.getState().polished + delta }),
        },
        this.abort.signal,
      );
      this.store.getState().set({ polished: markdown, polishing: false });
    } catch (err) {
      const aiError =
        err instanceof AiRequestError
          ? err.aiError
          : { code: 'unknown' as const, message: String(err), retryable: true };
      this.store.getState().set({
        polishing: false,
        polishError: aiError.code === 'canceled' ? null : aiError,
      });
    }
  }

  async copy(): Promise<void> {
    const text = this.currentMarkdown();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API can be blocked; fall back to a hidden textarea.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } finally {
        ta.remove();
      }
    }
    this.store.getState().set({ copied: true });
    setTimeout(() => this.store.getState().set({ copied: false }), 1800);
  }

  download(): void {
    this.downloadFile('morph-implementation-prompt.md', this.currentMarkdown(), 'text/markdown');
  }

  downloadHtmlSnapshot(): void {
    const html = buildHtmlSnapshot(this.behaviors.storedBehaviors().length);
    this.downloadFile('morph-prototype.html', html, 'text/html');
  }

  private downloadFile(name: string, content: string, type: string): void {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** Whether a provider is configured (drives the polish UI). */
  hasProvider(): boolean {
    return this.chat.getState().settings?.providerConfigured ?? false;
  }

  openOptions(): void {
    void sendToBackground({ type: 'OPEN_OPTIONS' }).catch(() => {});
  }
}
