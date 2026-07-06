export type ProviderId = 'anthropic' | 'openai-compat' | 'mock';

export interface Settings {
  provider: ProviderId;
  anthropic: {
    apiKey: string;
    model: string;
  };
  openaiCompat: {
    apiKey: string;
    baseUrl: string;
    model: string;
    /** Whether the endpoint accepts image content parts. */
    vision: boolean;
  };
  /** Include a viewport screenshot in AI context when the provider supports vision. */
  sendScreenshots: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  provider: 'anthropic',
  anthropic: {
    apiKey: '',
    model: 'claude-sonnet-5',
  },
  openaiCompat: {
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    model: '',
    vision: false,
  },
  sendScreenshots: true,
};

const STORAGE_KEY = 'morph:settings';

function mergeSettings(stored: unknown): Settings {
  const s = (stored ?? {}) as Partial<Settings>;
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    anthropic: { ...DEFAULT_SETTINGS.anthropic, ...s.anthropic },
    openaiCompat: { ...DEFAULT_SETTINGS.openaiCompat, ...s.openaiCompat },
  };
}

/** Only call from extension contexts that may hold secrets (service worker, options page). */
export async function loadSettings(): Promise<Settings> {
  const raw = await chrome.storage.local.get(STORAGE_KEY);
  return mergeSettings(raw[STORAGE_KEY]);
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await loadSettings();
  const next: Settings = mergeSettings({
    ...current,
    ...patch,
    anthropic: { ...current.anthropic, ...patch.anthropic },
    openaiCompat: { ...current.openaiCompat, ...patch.openaiCompat },
  });
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}

/**
 * Settings safe to expose to the content script (no API keys). The content
 * script only ever needs to know which capabilities are available.
 */
export interface PublicSettings {
  provider: ProviderId;
  providerConfigured: boolean;
  vision: boolean;
  sendScreenshots: boolean;
}

export function toPublicSettings(s: Settings): PublicSettings {
  const providerConfigured =
    s.provider === 'mock' ||
    (s.provider === 'anthropic' && s.anthropic.apiKey.length > 0) ||
    (s.provider === 'openai-compat' && s.openaiCompat.baseUrl.length > 0 && s.openaiCompat.model.length > 0);
  const vision = s.provider === 'anthropic' || s.provider === 'mock' ? true : s.openaiCompat.vision;
  return { provider: s.provider, providerConfigured, vision, sendScreenshots: s.sendScreenshots };
}
