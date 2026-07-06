// Options page: provider configuration. Runs in the extension context, so it
// may read/write API keys directly via chrome.storage.
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type ProviderId, type Settings } from '../shared/settings';

const app = document.getElementById('app')!;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  node.append(...children);
  return node;
}

function field(labelText: string, input: HTMLElement, hint?: string): HTMLElement {
  const wrap = el('label', { class: 'field' }, [el('span', { class: 'field-label' }, [labelText]), input]);
  if (hint) wrap.append(el('span', { class: 'hint' }, [hint]));
  return wrap;
}

async function requestHostPermissionIfNeeded(baseUrl: string): Promise<string | null> {
  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return 'Base URL is not a valid URL.';
  }
  const pattern = `${origin}/*`;
  const already = await chrome.permissions.contains({ origins: [pattern] }).catch(() => false);
  if (already) return null;
  const granted = await chrome.permissions.request({ origins: [pattern] }).catch(() => false);
  return granted ? null : `Permission for ${origin} was not granted — requests to this endpoint will fail.`;
}

async function render() {
  const settings = await loadSettings();
  app.replaceChildren();

  const status = el('p', { class: 'status', role: 'status' });

  const providerSelect = el('select', { id: 'provider' }) as HTMLSelectElement;
  const providers: Array<{ id: ProviderId; label: string }> = [
    { id: 'anthropic', label: 'Anthropic (Claude)' },
    { id: 'openai-compat', label: 'OpenAI-compatible endpoint' },
    { id: 'mock', label: 'Mock (development/testing — no API calls)' },
  ];
  for (const p of providers) {
    const opt = el('option', { value: p.id }, [p.label]) as HTMLOptionElement;
    opt.selected = settings.provider === p.id;
    providerSelect.append(opt);
  }

  const anthropicKey = el('input', {
    type: 'password',
    value: settings.anthropic.apiKey,
    placeholder: 'sk-ant-…',
    autocomplete: 'off',
  }) as HTMLInputElement;
  const anthropicModel = el('input', {
    type: 'text',
    value: settings.anthropic.model,
    placeholder: DEFAULT_SETTINGS.anthropic.model,
  }) as HTMLInputElement;

  const oaBase = el('input', {
    type: 'text',
    value: settings.openaiCompat.baseUrl,
    placeholder: 'https://api.openai.com/v1',
  }) as HTMLInputElement;
  const oaKey = el('input', {
    type: 'password',
    value: settings.openaiCompat.apiKey,
    placeholder: 'sk-… (optional for local servers)',
    autocomplete: 'off',
  }) as HTMLInputElement;
  const oaModel = el('input', {
    type: 'text',
    value: settings.openaiCompat.model,
    placeholder: 'e.g. gpt-4.1, llama3.3, qwen2.5-coder',
  }) as HTMLInputElement;
  const oaVision = el('input', { type: 'checkbox' }) as HTMLInputElement;
  oaVision.checked = settings.openaiCompat.vision;

  const screenshots = el('input', { type: 'checkbox' }) as HTMLInputElement;
  screenshots.checked = settings.sendScreenshots;

  const anthropicSection = el('section', { class: 'card', id: 'anthropic-section' }, [
    el('h2', {}, ['Anthropic']),
    field('API key', anthropicKey, 'Stored in chrome.storage.local on this device. Only the background service worker reads it.'),
    field('Model', anthropicModel, 'Any vision-capable Claude model id.'),
  ]);

  const oaSection = el('section', { class: 'card', id: 'openai-section' }, [
    el('h2', {}, ['OpenAI-compatible endpoint']),
    field('Base URL', oaBase, 'e.g. https://api.openai.com/v1, https://openrouter.ai/api/v1, http://localhost:11434/v1 (Ollama). Saving requests host permission for this origin.'),
    field('API key', oaKey),
    field('Model', oaModel),
    field('Endpoint supports images (vision)', oaVision, 'When off, Morph sends text-only context to this provider.'),
  ]);

  function syncVisibility() {
    anthropicSection.style.display = providerSelect.value === 'anthropic' ? '' : 'none';
    oaSection.style.display = providerSelect.value === 'openai-compat' ? '' : 'none';
  }
  providerSelect.addEventListener('change', syncVisibility);

  const saveBtn = el('button', { class: 'primary' }, ['Save settings']) as HTMLButtonElement;
  saveBtn.addEventListener('click', () => {
    void (async () => {
      saveBtn.disabled = true;
      status.textContent = 'Saving…';
      status.className = 'status';
      try {
        const provider = providerSelect.value as ProviderId;
        const patch: Partial<Settings> = {
          provider,
          anthropic: { apiKey: anthropicKey.value.trim(), model: anthropicModel.value.trim() || DEFAULT_SETTINGS.anthropic.model },
          openaiCompat: {
            apiKey: oaKey.value.trim(),
            baseUrl: oaBase.value.trim().replace(/\/$/, ''),
            model: oaModel.value.trim(),
            vision: oaVision.checked,
          },
          sendScreenshots: screenshots.checked,
        };
        let warning: string | null = null;
        if (provider === 'openai-compat' && patch.openaiCompat?.baseUrl) {
          warning = await requestHostPermissionIfNeeded(patch.openaiCompat.baseUrl);
        }
        await saveSettings(patch);
        status.textContent = warning ? `Saved. ⚠ ${warning}` : 'Saved.';
        status.className = warning ? 'status warn' : 'status ok';
      } catch (err) {
        status.textContent = `Failed to save: ${err instanceof Error ? err.message : String(err)}`;
        status.className = 'status error';
      } finally {
        saveBtn.disabled = false;
      }
    })();
  });

  app.append(
    el('h1', {}, ['Morph settings']),
    el('section', { class: 'card' }, [
      el('h2', {}, ['AI provider']),
      field('Provider', providerSelect),
      field('Include page screenshots in AI context', screenshots, 'Screenshots of the visible viewport help the model see what you see. Disable for sensitive pages.'),
    ]),
    anthropicSection,
    oaSection,
    buildBehaviorSection(),
    saveBtn,
    status,
  );
  syncVisibility();
}

/**
 * Interactive behaviors run everywhere (even strict-CSP sites) once the
 * userScripts API is available: the optional permission + Chrome's
 * per-extension "Allow user scripts" toggle.
 */
function buildBehaviorSection(): HTMLElement {
  const statusLine = el('p', { class: 'hint' }, ['Checking…']);
  const grantBtn = el('button', { class: 'primary', type: 'button' }, ['Enable advanced behaviors']) as HTMLButtonElement;

  async function refresh() {
    const hasPermission = await chrome.permissions
      .contains({ permissions: ['userScripts'] })
      .catch(() => false);
    let toggleOn = false;
    if (hasPermission) {
      try {
        const probe = (await chrome.runtime.sendMessage({ type: 'PROBE_CAPABILITIES' })) as {
          userScripts: boolean;
        };
        toggleOn = probe.userScripts;
      } catch {
        toggleOn = false;
      }
    }
    if (toggleOn) {
      statusLine.textContent = '✓ Ready — AI behaviors run on every site, including strict-CSP pages.';
      grantBtn.style.display = 'none';
    } else if (hasPermission) {
      statusLine.textContent =
        'Almost there: open chrome://extensions, find Morph, and turn on “Allow user scripts” (Chrome 138+; on older Chrome enable Developer mode). Morph works without this — but on sites with a strict Content-Security-Policy, interactive behaviors will be skipped.';
      grantBtn.style.display = 'none';
    } else {
      statusLine.textContent =
        'Optional: without this, styling and layout edits work everywhere, but AI-generated interactions (click handlers, animations, keyboard shortcuts) are skipped on sites with a strict Content-Security-Policy.';
      grantBtn.style.display = '';
    }
  }

  grantBtn.addEventListener('click', () => {
    void (async () => {
      await chrome.permissions.request({ permissions: ['userScripts'] }).catch(() => false);
      await refresh();
    })();
  });

  void refresh();
  return el('section', { class: 'card' }, [el('h2', {}, ['Advanced behaviors (optional)']), statusLine, grantBtn]);
}

void render();
