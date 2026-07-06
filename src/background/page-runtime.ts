// The Morph page runtime, injected into the page's MAIN world via
// chrome.scripting.executeScript({ world: 'MAIN', func: installPageRuntime }).
// Browser-injected functions are exempt from page CSP, so the runtime (and
// with it network mocking and behavior cleanup) works on every site.
//
// ⚠️ This function is SERIALIZED — it must be completely self-contained:
// no imports, no references to module scope, no TypeScript-only constructs
// that survive to runtime. A unit test asserts no bundler artifacts leak in.
//
// Cross-world protocol (isolated content script ⇄ MAIN world), all payloads
// JSON strings in CustomEvent.detail:
//   morph:behavior-exec      {id, js}        CS → runtime (tier-2 execution:
//                                            new Function under the PAGE CSP)
//   morph:behavior-teardown  {id}            CS → runtime
//   morph:behavior-result    {id, error}     runtime → CS
//   morph:mock-set           {key, rules}    CS → runtime
//   morph:mock-remove        {key}           CS → runtime
export function installPageRuntime(): boolean {
  interface MockRuleWire {
    urlPattern: string;
    method: string | null;
    status: number | null;
    contentType: string | null;
    body: string;
    delayMs: number | null;
  }

  interface MorphHelpers {
    el(ref: string): Element | null;
    on(
      target: Element | Document | Window | string,
      event: string,
      handler: EventListener,
      options?: AddEventListenerOptions,
    ): void;
    setInterval(fn: () => void, ms: number): number;
    setTimeout(fn: () => void, ms: number): number;
    toast(message: string): void;
    onCleanup(fn: () => void): void;
  }

  interface MorphRuntime {
    begin(id: string): MorphHelpers;
    teardown(id: string): void;
    teardownAll(): void;
    notifyResult(id: string, error: string | null): void;
    setMockRules(key: string, rules: MockRuleWire[]): void;
    removeMockRules(key: string): void;
  }

  const w = window as Window & { __morphRuntime?: MorphRuntime };
  if (w.__morphRuntime) return true;

  const cleanups = new Map<string, Array<() => void>>();
  const mockRules = new Map<string, MockRuleWire[]>();

  // ---------------------------------------------------------------- mocking
  const nativeFetch = window.fetch.bind(window);

  function findRule(url: string, method: string): MockRuleWire | null {
    const entries = Array.from(mockRules.entries());
    for (let i = entries.length - 1; i >= 0; i--) {
      for (const rule of entries[i]![1]) {
        if (!url.includes(rule.urlPattern)) continue;
        if (rule.method && rule.method.toUpperCase() !== method.toUpperCase()) continue;
        return rule;
      }
    }
    return null;
  }

  window.fetch = function morphFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    try {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      const rule = findRule(url, method);
      if (rule) {
        const delay = rule.delayMs ?? 0;
        return new Promise((resolve) =>
          setTimeout(
            () =>
              resolve(
                new Response(rule.body, {
                  status: rule.status ?? 200,
                  headers: { 'content-type': rule.contentType ?? 'application/json' },
                }),
              ),
            delay,
          ),
        );
      }
    } catch {
      // never break the page's own fetch
    }
    return nativeFetch(input as RequestInfo, init);
  };

  const NativeXHR = window.XMLHttpRequest;
  function MorphXHR(this: XMLHttpRequest & { __morphMeta?: { url: string; method: string } }) {
    const xhr = new NativeXHR();
    const nativeOpen = xhr.open.bind(xhr);
    const nativeSend = xhr.send.bind(xhr);
    xhr.open = function (method: string, url: string | URL, ...rest: unknown[]) {
      (xhr as { __morphMeta?: { url: string; method: string } }).__morphMeta = {
        url: String(url),
        method,
      };
      return (nativeOpen as (...a: unknown[]) => void)(method, url, ...rest);
    } as typeof xhr.open;
    xhr.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
      const meta = (xhr as { __morphMeta?: { url: string; method: string } }).__morphMeta;
      const rule = meta ? findRule(meta.url, meta.method) : null;
      if (rule) {
        setTimeout(() => {
          try {
            Object.defineProperty(xhr, 'readyState', { value: 4, configurable: true });
            Object.defineProperty(xhr, 'status', { value: rule.status ?? 200, configurable: true });
            Object.defineProperty(xhr, 'statusText', { value: 'OK', configurable: true });
            Object.defineProperty(xhr, 'responseText', { value: rule.body, configurable: true });
            Object.defineProperty(xhr, 'response', { value: rule.body, configurable: true });
            Object.defineProperty(xhr, 'getResponseHeader', {
              value: (name: string) =>
                name.toLowerCase() === 'content-type' ? (rule.contentType ?? 'application/json') : null,
              configurable: true,
            });
            xhr.dispatchEvent(new Event('readystatechange'));
            xhr.dispatchEvent(new ProgressEvent('load'));
            xhr.dispatchEvent(new ProgressEvent('loadend'));
          } catch {
            // fall through silently
          }
        }, rule.delayMs ?? 0);
        return;
      }
      return nativeSend(body);
    };
    return xhr;
  }
  MorphXHR.prototype = NativeXHR.prototype;
  (window as { XMLHttpRequest: unknown }).XMLHttpRequest = MorphXHR;

  // -------------------------------------------------------------- behaviors
  function cssEscape(v: string): string {
    return window.CSS && CSS.escape ? CSS.escape(v) : v.replace(/["\\]/g, '\\$&');
  }

  function ensureToastHost(): HTMLElement {
    let host = document.getElementById('morph-toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'morph-toast-host';
      host.setAttribute(
        'style',
        'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2147483645;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none;',
      );
      document.documentElement.appendChild(host);
    }
    return host;
  }

  const runtime: MorphRuntime = {
    begin(id: string): MorphHelpers {
      runtime.teardown(id);
      const fns: Array<() => void> = [];
      cleanups.set(id, fns);
      return {
        el(ref: string): Element | null {
          return document.querySelector('[data-morph-id="' + cssEscape(ref) + '"]');
        },
        on(target, event, handler, options) {
          const el = typeof target === 'string' ? document.querySelector(target) : target;
          if (!el) return;
          el.addEventListener(event, handler, options);
          fns.push(() => el.removeEventListener(event, handler, options));
        },
        setInterval(fn: () => void, ms: number): number {
          const handle = window.setInterval(fn, ms);
          fns.push(() => window.clearInterval(handle));
          return handle;
        },
        setTimeout(fn: () => void, ms: number): number {
          const handle = window.setTimeout(fn, ms);
          fns.push(() => window.clearTimeout(handle));
          return handle;
        },
        toast(message: string) {
          const host = ensureToastHost();
          const toast = document.createElement('div');
          toast.textContent = message;
          toast.setAttribute(
            'style',
            'background:#1b1b24;color:#ececf3;border:1px solid #34344a;border-radius:9px;padding:9px 16px;font:13px/1.4 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.35);opacity:0;transition:opacity .18s ease;',
          );
          host.appendChild(toast);
          requestAnimationFrame(() => (toast.style.opacity = '1'));
          window.setTimeout(() => {
            toast.style.opacity = '0';
            window.setTimeout(() => toast.remove(), 220);
          }, 2400);
        },
        onCleanup(fn: () => void) {
          fns.push(fn);
        },
      };
    },

    teardown(id: string) {
      const fns = cleanups.get(id);
      if (!fns) return;
      cleanups.delete(id);
      for (let i = fns.length - 1; i >= 0; i--) {
        try {
          fns[i]!();
        } catch {
          // best effort
        }
      }
    },

    teardownAll() {
      for (const id of Array.from(cleanups.keys())) runtime.teardown(id);
    },

    notifyResult(id: string, error: string | null) {
      document.dispatchEvent(
        new CustomEvent('morph:behavior-result', { detail: JSON.stringify({ id, error }) }),
      );
    },

    setMockRules(key: string, rules: MockRuleWire[]) {
      mockRules.set(key, rules);
    },

    removeMockRules(key: string) {
      mockRules.delete(key);
    },
  };

  document.addEventListener('morph:behavior-exec', (ev) => {
    let id = '';
    try {
      const payload = JSON.parse(String((ev as CustomEvent).detail)) as { id: string; js: string };
      id = payload.id;
      let fn: (morph: MorphHelpers) => void;
      try {
        // Runs under the PAGE's CSP: fine on most sites, an EvalError where
        // 'unsafe-eval' is forbidden — reported so the ladder can degrade.
        fn = new Function('morph', payload.js) as (morph: MorphHelpers) => void;
      } catch (evalErr) {
        runtime.notifyResult(id, 'CSP_EVAL_BLOCKED: ' + String((evalErr as Error)?.message ?? evalErr));
        return;
      }
      const morph = runtime.begin(id);
      try {
        fn(morph);
        runtime.notifyResult(id, null);
      } catch (runErr) {
        runtime.teardown(id);
        runtime.notifyResult(id, String((runErr as Error)?.message ?? runErr));
      }
    } catch (err) {
      if (id) runtime.notifyResult(id, String((err as Error)?.message ?? err));
    }
  });
  document.addEventListener('morph:behavior-teardown', (ev) => {
    try {
      const { id } = JSON.parse(String((ev as CustomEvent).detail)) as { id: string };
      runtime.teardown(id);
    } catch {
      // malformed — ignore
    }
  });
  document.addEventListener('morph:mock-set', (ev) => {
    try {
      const { key, rules } = JSON.parse(String((ev as CustomEvent).detail)) as {
        key: string;
        rules: MockRuleWire[];
      };
      runtime.setMockRules(key, rules);
    } catch {
      // ignore
    }
  });
  document.addEventListener('morph:mock-remove', (ev) => {
    try {
      const { key } = JSON.parse(String((ev as CustomEvent).detail)) as { key: string };
      runtime.removeMockRules(key);
    } catch {
      // ignore
    }
  });

  w.__morphRuntime = runtime;
  // Readable from the isolated world (shared DOM) as the "installed" signal.
  document.documentElement.setAttribute('data-morph-runtime', '1');
  return true;
}
