// Tier-1 behavior execution: chrome.userScripts.execute (Chrome 135+).
// Requires the "userScripts" optional permission AND the user's per-extension
// "Allow user scripts" toggle — feature-detected, never assumed.

interface UserScriptsExecuteAPI {
  execute(injection: {
    target: { tabId: number };
    world?: 'MAIN' | 'USER_SCRIPT';
    js: Array<{ code: string }>;
    injectImmediately?: boolean;
  }): Promise<unknown>;
  getScripts(): Promise<unknown>;
}

function userScriptsApi(): UserScriptsExecuteAPI | null {
  const api = (chrome as unknown as { userScripts?: UserScriptsExecuteAPI }).userScripts;
  if (!api || typeof api.execute !== 'function') return null;
  return api;
}

/** True when the API is usable right now (permission + toggle both on). */
export async function userScriptsAvailable(): Promise<boolean> {
  const api = userScriptsApi();
  if (!api) return false;
  try {
    // Throws unless the user has enabled the user-scripts toggle.
    await api.getScripts();
    return true;
  } catch {
    return false;
  }
}

export async function executeUserScript(
  tabId: number,
  code: string,
): Promise<{ ok: boolean; error?: string }> {
  const api = userScriptsApi();
  if (!api) return { ok: false, error: 'userscripts-unavailable' };
  try {
    await api.getScripts(); // availability check w/ toggle
  } catch {
    return { ok: false, error: 'userscripts-unavailable' };
  }
  try {
    await api.execute({ target: { tabId }, world: 'MAIN', js: [{ code }], injectImmediately: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
