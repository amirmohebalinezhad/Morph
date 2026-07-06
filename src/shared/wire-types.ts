// Provider-agnostic request/response shapes exchanged between the content
// script (which assembles context) and the background AI providers (which
// format it for a specific API).

export interface SerializedElement {
  ref: string;
  /** e.g. `button#save.btn.btn-primary` */
  descriptor: string;
  /** Capped outerHTML with depth/length elision markers. */
  html: string;
  /** Compact non-default computed styles: `display: flex; gap: 8px; …` */
  styles: string;
  rect: { x: number; y: number; w: number; h: number };
}

export interface ChatTurnWire {
  role: 'user' | 'assistant';
  text: string;
}

export interface EditPlanRequestWire {
  url: string;
  title: string;
  viewport: { w: number; h: number; dpr: number };
  instruction: string;
  selected: SerializedElement[];
  /** One-line descriptors from <body> down to the primary selection's parent. */
  ancestors: string[];
  /** One-line descriptors of nearby siblings of the primary selection. */
  siblings: string[];
  /** Preformatted design-token block (fonts, colors, radii, CSS custom props). */
  designTokens: string;
  /** Summaries of prior revisions currently applied to the page. */
  revisionSummaries: string[];
  /** Recent conversation turns (user instruction / assistant summary+digest). */
  conversation: ChatTurnWire[];
  /** Base64 JPEG (no data: prefix) of the visible viewport, or null. */
  screenshot: string | null;
}

export interface ExportRequestWire {
  url: string;
  title: string;
  /** The deterministic markdown assembled from the revision log. */
  changeLog: string;
  /** Optional user guidance, e.g. "the app is React + Tailwind". */
  userNotes: string | null;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface AiError {
  code:
    | 'auth'
    | 'not_configured'
    | 'rate_limit'
    | 'overloaded'
    | 'network'
    | 'schema'
    | 'refusal'
    | 'canceled'
    | 'unknown';
  message: string;
  retryable: boolean;
}
