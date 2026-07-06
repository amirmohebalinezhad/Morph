# Morph — AI Live UI Prototyping

Morph is a standalone Chrome extension that turns any live website into a design surface. Activate it on a page, click elements, and describe changes in plain language — an AI mutates the running DOM immediately, in memory. Iterate conversationally, interact with the working prototype (including AI-generated JavaScript behaviors and mocked network responses), then export a comprehensive **implementation prompt** to hand to your coding agent (Claude Code, Cursor, Codex, Gemini CLI, …).

It's Photoshop for live websites: nothing touches your source code, Git, or IDE. Everything happens in the browser and is lost on refresh — that's the point. The deliverable is the prompt, not the edits.

## What it does

- **Select** — click, shift-click to multi-select, drag a marquee, or navigate the tree with the keyboard (arrows for parent/child/siblings) and the breadcrumb bar.
- **Prompt** — "make this button red", "turn this table into cards", "add a copy icon that shows a green checkmark for 2 seconds", "make this look like Linear". The AI returns a structured edit plan that applies to the live DOM instantly.
- **Interact** — flip to Interact mode and use the working prototype: click the new dropdown, submit the form, watch the injected animation.
- **Refine** — the conversation remembers prior edits, so "now make it taller" and "actually keep the old height" resolve naturally.
- **Inspect & hand-edit** — a properties panel for spacing, typography, color, radius, shadow, and opacity, plus drag-to-move and corner-resize handles. Manual tweaks become revisions too.
- **History** — every instruction is a revision. Undo, redo, jump to any point, branch, and compare revisions side by side.
- **Export** — generate a detailed, framework-agnostic implementation prompt covering layout, styling, behavior, accessibility, responsive notes, and a suggested component breakdown. Copy it or download it; a standalone HTML snapshot is available too.

## Architecture

| Piece | Role |
|---|---|
| **Background service worker** | Stateless AI broker. API keys live only here; `host_permissions` make cross-origin calls to the AI APIs work without CORS. Also captures/downscales screenshots and injects the MAIN-world page runtime. |
| **Content script** | Owns all session state: selection engine, ref registry, apply engine, revision tree, manual editing, and the UI. Injected programmatically on first activation (no `<all_urls>`). |
| **React UI** | Rendered inside a Shadow DOM host on the page so it never inherits or leaks page styles. |
| **MAIN-world page runtime** | Injected CSP-exempt via `chrome.scripting.executeScript`. Hosts the fetch/XHR mock engine, behavior cleanup registry, and `morph.*` helpers. |

Key design decisions:

- **Structured edit plans, not raw AI JavaScript, for DOM work.** The model returns a validated plan of granular operations (forced strict tool use, zod-checked). Each operation captures a precise inverse *at apply time* holding real detached DOM nodes — so undoing a delete reinserts the same node with its original event listeners intact.
- **Trusted-Types-safe.** AI HTML is parsed in a detached document, sanitized with DOMPurify, then adopted in — Morph never assigns `innerHTML` on the live page, so strict-CSP sites like GitHub keep working.
- **Behavior CSP ladder.** AI-generated interactions run via `chrome.userScripts` (best, needs a one-time toggle), falling back to runtime-mediated execution, and degrading gracefully with a clear notice where a page's CSP forbids it. DOM, style, and network-mock edits always work.
- **Provider-agnostic.** Anthropic and any OpenAI-compatible endpoint (OpenAI, OpenRouter, Ollama, LM Studio, …) plug into one interface. A deterministic mock provider drives the entire test suite with no API key.

## Install (unpacked)

```bash
npm install
npm run build      # produces dist/
```

Then in Chrome: `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the `dist/` folder.

Open the extension's **Options** (right-click the toolbar icon → Options, or the ⚙ button in Morph's toolbar) and configure an AI provider:

- **Anthropic** — paste an API key; the default model is `claude-sonnet-5` (any vision-capable Claude model works).
- **OpenAI-compatible** — set a base URL (e.g. `https://api.openai.com/v1`, `http://localhost:11434/v1` for Ollama), key, and model.

Then click the Morph toolbar icon (or press `Alt+Shift+M`) on any page to start.

### Advanced behaviors (optional)

To run AI-generated JavaScript interactions on *every* site — including ones with a strict Content-Security-Policy — enable the `userScripts` permission from Morph's Options page and turn on **"Allow user scripts"** for Morph in `chrome://extensions` (Chrome 138+; on older Chrome, Developer mode is enough). Without this, styling and layout edits still work everywhere; only interactive behaviors are skipped on strict-CSP pages (their code is still included in the export).

## Development

```bash
npm run dev         # esbuild watch → rebuilds dist/ on change
npm run typecheck   # tsc --noEmit (strict)
npm test            # vitest unit tests (happy-dom / jsdom)
npm run e2e         # Playwright: loads the built extension into headless
                    # Chromium and drives the full loop with the mock provider
npm run package     # zip dist/ → morph-<version>.zip
```

The e2e suite exercises activation, selection, the AI edit loop, history/branching, behaviors and network mocking (including a strict-CSP + Trusted-Types fixture), inspect/manual editing, export with a real clipboard read-back, the SPA re-render sentinel, and marquee selection — all keyless via the deterministic mock provider.

## Limitations (v1)

- **In-memory only.** Edits are lost on refresh, by design.
- **Cross-origin iframes** can't be edited (browser security); an `<iframe>` is selectable as an opaque element.
- **Closed shadow roots** and canvas-rendered UIs (e.g. Flutter, Google Docs) fall back to selecting the host element.
- **Behaviors** need either the `userScripts` toggle or a page whose CSP permits injected script; otherwise they degrade (with the code preserved in the export).
- API keys are stored in `chrome.storage.local` (plaintext on disk, readable only by the extension's own contexts) — use a scoped key.

## Layout

```
src/
  background/   service worker: activation, screenshots, page runtime, AI providers
  content/      selection, refs, apply engine, history, behaviors, context, manual, export
  ui/           React components inside the Shadow DOM
  shared/       edit-op schema (zod), messages, settings, wire types
  options/      provider configuration page
tests/
  unit/         vitest specs
  e2e/          Playwright specs + fixture pages + static server
```
