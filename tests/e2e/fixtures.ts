// Shared Playwright harness: launches Chromium with the built extension
// (dist-test/, whose manifest adds localhost host permissions so programmatic
// injection works without a real toolbar click).
import { test as base, chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(dirname, '../../dist-test');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Waits until the extension service worker is fully initialized. Right after
 * install Chrome may restart the worker, and a freshly-adopted target can
 * briefly expose a half-built `chrome` global (no chrome.storage yet) — so
 * poll readiness, re-acquiring the newest worker target each round.
 */
async function readyServiceWorker(context: BrowserContext): Promise<Worker> {
  let lastError: unknown = new Error('no service worker appeared');
  for (let attempt = 0; attempt < 30; attempt++) {
    const workers = context.serviceWorkers();
    const sw: Worker | undefined =
      workers[workers.length - 1] ??
      (await context.waitForEvent('serviceworker', { timeout: 5_000 }).catch(() => undefined));
    if (sw) {
      try {
        const ready = await sw.evaluate(
          () =>
            typeof chrome !== 'undefined' &&
            !!chrome.storage?.local &&
            !!chrome.tabs &&
            !!chrome.scripting,
        );
        if (ready) return sw;
      } catch (err) {
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (!/restarted|closed|destroyed|No target/i.test(msg)) throw err;
      }
    }
    await sleep(200);
  }
  throw lastError;
}

/** Evaluates inside a ready extension service worker, retrying restarts. */
async function evalInServiceWorker<R, Arg>(
  context: BrowserContext,
  fn: (arg: Arg) => R | Promise<R>,
  arg: Arg,
): Promise<R> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    const sw = await readyServiceWorker(context);
    try {
      // Playwright's Unboxed<Arg> mapping fights plain generics; the values we
      // pass are always structured-cloneable.
      return await sw.evaluate(fn as (arg: Arg) => R | Promise<R> & { __pw?: never }, arg as never);
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!/restarted|closed|destroyed|No target/i.test(msg)) throw err;
      await sleep(150 * (attempt + 1));
    }
  }
  throw lastError;
}

export interface ExtFixtures {
  context: BrowserContext;
  /** Toggle Morph on the given page via the same code path as a toolbar click. */
  activate: (page: Page) => Promise<{ active: boolean }>;
  /** Merge a patch into stored settings (e.g. switch to the mock provider). */
  seedSettings: (patch: Record<string, unknown>) => Promise<void>;
}

export const test = base.extend<ExtFixtures>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    if (!fs.existsSync(path.join(extensionPath, 'manifest.json'))) {
      throw new Error(`dist-test/ not built — run "npm run e2e" (or node scripts/build.mjs --test) first`);
    }
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'morph-e2e-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
      executablePath: '/opt/pw-browsers/chromium',
      headless: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    // Make sure the extension service worker has registered before tests run.
    if (context.serviceWorkers().length === 0) {
      await context.waitForEvent('serviceworker', { timeout: 10_000 });
    }
    await use(context);
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  },

  activate: async ({ context }, use) => {
    await use(async (page: Page) =>
      evalInServiceWorker(
        context,
        (u: string) =>
          (globalThis as unknown as { __morphActivateForTest(url: string): Promise<{ active: boolean }> })
            .__morphActivateForTest(u),
        page.url(),
      ),
    );
  },

  seedSettings: async ({ context }, use) => {
    await use(async (patch: Record<string, unknown>) => {
      await evalInServiceWorker(
        context,
        async (p: Record<string, unknown>) => {
          const key = 'morph:settings';
          const raw = await chrome.storage.local.get(key);
          const current = (raw[key] as Record<string, unknown>) ?? {};
          await chrome.storage.local.set({ [key]: { ...current, ...p } });
        },
        patch,
      );
    });
  },
});

export const expect = test.expect;
