// Content-script side of the behavior system. Ensures the MAIN-world runtime
// is installed, executes AI behavior code through the CSP ladder, and drives
// teardown/re-execution (undo/redo) plus network-mock rules over the
// CustomEvent bridge.
//
// Execution ladder for arbitrary behavior JS:
//   1. chrome.userScripts.execute (Chrome 135+, needs the user's one-time
//      "Allow user scripts" toggle) — works regardless of page CSP.
//   2. Runtime-mediated execution: the MAIN-world runtime (itself injected
//      CSP-exempt via chrome.scripting.executeScript) receives the code over
//      the event bridge and runs it via new Function — allowed wherever the
//      PAGE's CSP permits eval, i.e. most sites. (Classic <script>-tag
//      injection is no longer viable: MV3 applies the extension's own CSP to
//      inline scripts inserted from the isolated world.)
//   3. Give up gracefully: DOM/style/mock ops still apply; the behavior code
//      still lands in the export prompt.
import type { MockRule } from '../../shared/edit-ops';
import { sendToBackground } from '../../shared/messages';
import type { BehaviorHost } from '../ops/apply';

const RESULT_EVENT = 'morph:behavior-result';
const RESULT_TIMEOUT_MS = 600;

export function wrapBehaviorCode(id: string, js: string): string {
  const idJson = JSON.stringify(id);
  // No eval/new Function — the AI code is inlined as a function body so it
  // runs even under page CSP once the outer script executes.
  return `(function(){
  var rt = window.__morphRuntime;
  if (!rt) { return; }
  try {
    var morph = rt.begin(${idJson});
    (function(morph){
${js}
    })(morph);
    rt.notifyResult(${idJson}, null);
  } catch (err) {
    try { rt.teardown(${idJson}); } catch (e) {}
    rt.notifyResult(${idJson}, String((err && err.message) || err));
  }
})();`;
}

function dispatchToRuntime(event: string, payload: unknown): void {
  document.dispatchEvent(new CustomEvent(event, { detail: JSON.stringify(payload) }));
}

function awaitBehaviorResult(id: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      document.removeEventListener(RESULT_EVENT, onResult);
      resolve({ ok: false, error: 'timeout' });
    }, RESULT_TIMEOUT_MS);

    function onResult(ev: Event): void {
      try {
        const detail = JSON.parse(String((ev as CustomEvent).detail)) as {
          id: string;
          error: string | null;
        };
        if (detail.id !== id) return;
        clearTimeout(timer);
        document.removeEventListener(RESULT_EVENT, onResult);
        resolve(detail.error ? { ok: false, error: detail.error } : { ok: true });
      } catch {
        // ignore malformed events
      }
    }
    document.addEventListener(RESULT_EVENT, onResult);
  });
}

export class PageBehaviorHost implements BehaviorHost {
  /** Stored source for redo re-execution. */
  private behaviors = new Map<string, { description: string; js: string }>();
  private mocks = new Map<string, MockRule[]>();
  private runtimeInstalled = false;

  private async ensureRuntime(): Promise<boolean> {
    if (this.runtimeInstalled || document.documentElement.getAttribute('data-morph-runtime') === '1') {
      this.runtimeInstalled = true;
      return true;
    }
    try {
      const res = await sendToBackground({ type: 'INSTALL_PAGE_RUNTIME' });
      this.runtimeInstalled = res.ok;
      return res.ok;
    } catch {
      return false;
    }
  }

  private async execute(id: string, js: string): Promise<{ ok: boolean; reason?: string }> {
    if (!(await this.ensureRuntime())) {
      return { ok: false, reason: 'the Morph page runtime could not be installed on this page' };
    }

    // Tier 1: userScripts (CSP-immune) — the AI code is inlined, no eval.
    try {
      const resultPromise = awaitBehaviorResult(id);
      const tier1 = await sendToBackground({ type: 'EXEC_USER_SCRIPT', code: wrapBehaviorCode(id, js) });
      if (tier1.ok) {
        const result = await resultPromise;
        if (result.ok) return { ok: true };
        if (result.error !== 'timeout') {
          return { ok: false, reason: `the behavior code threw: ${result.error}` };
        }
      }
    } catch {
      // background unavailable — fall through to tier 2
    }

    // Tier 2: MAIN-world runtime executes via new Function (page CSP allowing).
    const resultPromise = awaitBehaviorResult(id);
    dispatchToRuntime('morph:behavior-exec', { id, js });
    const result = await resultPromise;
    if (result.ok) return { ok: true };
    if (result.error && /CSP_EVAL_BLOCKED|unsafe-eval|Content Security Policy|EvalError/i.test(result.error)) {
      return {
        ok: false,
        reason:
          "this page's security policy blocks injected scripts. Enable the 'Allow user scripts' toggle for Morph in chrome://extensions (via Morph settings → Advanced behaviors) to run behaviors everywhere",
      };
    }
    if (result.error && result.error !== 'timeout') {
      return { ok: false, reason: `the behavior code threw: ${result.error}` };
    }
    return {
      ok: false,
      reason:
        'the behavior did not run on this page. Enable the userScripts toggle in Morph settings → Advanced behaviors for maximum compatibility',
    };
  }

  async addBehavior(id: string, description: string, js: string): Promise<{ ok: boolean; reason?: string }> {
    const result = await this.execute(id, js);
    if (result.ok) this.behaviors.set(id, { description, js });
    return result;
  }

  removeBehavior(id: string): void {
    dispatchToRuntime('morph:behavior-teardown', { id });
  }

  reAddBehavior(id: string): void {
    const stored = this.behaviors.get(id);
    if (!stored) return;
    void this.execute(id, stored.js);
  }

  async applyMockRules(key: string, rules: MockRule[]): Promise<{ ok: boolean; reason?: string }> {
    if (!(await this.ensureRuntime())) {
      return { ok: false, reason: 'the Morph page runtime could not be installed on this page' };
    }
    this.mocks.set(key, rules);
    dispatchToRuntime('morph:mock-set', { key, rules });
    return { ok: true };
  }

  removeMockRules(key: string): void {
    dispatchToRuntime('morph:mock-remove', { key });
  }

  reApplyMockRules(key: string): void {
    const rules = this.mocks.get(key);
    if (!rules) return;
    dispatchToRuntime('morph:mock-set', { key, rules });
  }

  /** All active behaviors (for export). */
  storedBehaviors(): Array<{ id: string; description: string; js: string }> {
    return Array.from(this.behaviors, ([id, b]) => ({ id, ...b }));
  }
}
