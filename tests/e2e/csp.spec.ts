import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

// The /csp fixture ships `script-src 'self'; require-trusted-types-for
// 'script'` — inline script injection is blocked AND Trusted Types are
// enforced on DOM sinks. Morph's DOM/style pipeline must keep working; only
// arbitrary behavior JS degrades (tier 3) without the userScripts toggle.

async function prompt(page: Page, text: string) {
  const input = page.locator('#morph-extension-root [data-morph-prompt-input]');
  await input.fill(text);
  await input.press('Enter');
  await expect(
    page.locator('#morph-extension-root .chat-msg.assistant').last(),
  ).toHaveAttribute('data-morph-msg-status', /done|question/, { timeout: 15_000 });
}

test.beforeEach(async ({ seedSettings }) => {
  await seedSettings({ provider: 'mock' });
});

test('style and structural edits work under strict CSP + Trusted Types', async ({ context, activate }) => {
  const page = await context.newPage();
  await page.goto('/csp');
  await activate(page);
  await expect(page.locator('#morph-extension-root [data-morph-toolbar]')).toBeVisible();

  const cspBtn = page.locator('#csp-btn');
  await cspBtn.click();
  await prompt(page, 'make this red');
  await expect(cspBtn).toHaveCSS('background-color', 'rgb(220, 38, 38)');

  // Structural insert exercises the Trusted-Types-safe sanitize path.
  await prompt(page, 'replace this with cards');
  await expect(page.locator('.morph-card')).toHaveCount(3);
});

test('behaviors degrade gracefully under strict CSP with a clear notice', async ({ context, activate }) => {
  const page = await context.newPage();
  await page.goto('/csp');
  await activate(page);
  await expect(page.locator('#morph-extension-root [data-morph-toolbar]')).toBeVisible();

  await page.locator('#csp-text').click();
  await prompt(page, 'count clicks on this');

  const lastMsg = page.locator('#morph-extension-root .chat-msg.assistant').last();
  await expect(lastMsg).toHaveAttribute('data-morph-msg-status', 'done');
  await expect(lastMsg).toContainText('Skipped');
  await expect(lastMsg).toContainText(/security policy|user scripts/i);
  await expect(page.locator('[data-morph-badge=counter]')).toHaveCount(0);
});

test('network mocking is CSP-immune (runtime injected via executeScript)', async ({ context, activate }) => {
  const page = await context.newPage();
  await page.goto('/csp');
  await activate(page);
  await expect(page.locator('#morph-extension-root [data-morph-toolbar]')).toBeVisible();

  await page.locator('#csp-text').click();
  await prompt(page, 'fake the api data');

  const lastMsg = page.locator('#morph-extension-root .chat-msg.assistant').last();
  await expect(lastMsg).not.toContainText('Skipped');

  // Prove the MAIN-world fetch patch is live on this locked-down page.
  const mocked = await page.evaluate(async () => {
    const res = await fetch('/api/stats');
    return res.json() as Promise<{ users: number }>;
  });
  expect(mocked.users).toBe(99999);
});
