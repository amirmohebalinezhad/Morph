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

export interface ExtFixtures {
  context: BrowserContext;
  serviceWorker: Worker;
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
    await use(context);
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  },

  serviceWorker: async ({ context }, use) => {
    let sw = context.serviceWorkers()[0];
    sw ??= await context.waitForEvent('serviceworker');
    await use(sw);
  },

  activate: async ({ serviceWorker }, use) => {
    await use(async (page: Page) => {
      const url = page.url();
      return serviceWorker.evaluate(
        (u) =>
          (globalThis as unknown as { __morphActivateForTest(url: string): Promise<{ active: boolean }> })
            .__morphActivateForTest(u),
        url,
      );
    });
  },

  seedSettings: async ({ serviceWorker }, use) => {
    await use(async (patch: Record<string, unknown>) => {
      await serviceWorker.evaluate(async (p) => {
        const key = 'morph:settings';
        const raw = await chrome.storage.local.get(key);
        const current = (raw[key] as Record<string, unknown>) ?? {};
        await chrome.storage.local.set({ [key]: { ...current, ...p } });
      }, patch);
    });
  },
});

export const expect = test.expect;
