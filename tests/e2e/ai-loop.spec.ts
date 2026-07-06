import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

// The full AI edit loop against the deterministic mock provider — no API key.

async function startEditing(page: Page, activate: (p: Page) => Promise<{ active: boolean }>) {
  await page.goto('/');
  await activate(page);
  await expect(page.locator('#morph-extension-root [data-morph-toolbar]')).toBeVisible();
}

async function prompt(page: Page, text: string) {
  const input = page.locator('#morph-extension-root [data-morph-prompt-input]');
  await input.fill(text);
  await input.press('Enter');
}

test.beforeEach(async ({ seedSettings }) => {
  await seedSettings({ provider: 'mock' });
});

test('select → prompt → live style edit lands on the page', async ({ context, activate }) => {
  const page = await context.newPage();
  await startEditing(page, activate);

  await page.locator('#counter-btn').click();
  await prompt(page, 'make this red');

  // The mock provider streams, then the plan applies to the real DOM.
  await expect(page.locator('#counter-btn')).toHaveCSS('background-color', 'rgb(220, 38, 38)');
  await expect(page.locator('#counter-btn')).toHaveCSS('color', 'rgb(255, 255, 255)');

  // Assistant bubble ends in done state with the summary text.
  const lastMsg = page.locator('#morph-extension-root .chat-msg.assistant').last();
  await expect(lastMsg).toHaveAttribute('data-morph-msg-status', 'done');
  await expect(lastMsg).toContainText('red');
});

test('structural edit: table replaced by a card grid with tracked refs', async ({ context, activate }) => {
  const page = await context.newPage();
  await startEditing(page, activate);

  await page.locator('#users-table').click({ position: { x: 4, y: 4 } });
  // Ensure the table itself is selected, not a cell: click breadcrumb crumb.
  await page
    .locator('#morph-extension-root [data-morph-breadcrumb] .crumb', { hasText: 'table#users-table' })
    .click();

  await prompt(page, 'replace this table with cards');

  await expect(page.locator('.morph-card-grid')).toBeVisible();
  await expect(page.locator('.morph-card')).toHaveCount(3);
  await expect(page.locator('#users-table')).toHaveCount(0);
  // New root carries the AI-assigned ref for future turns.
  await expect(page.locator('[data-morph-id="n1"]')).toHaveCount(1);
  // Injected stylesheet is registered and applied.
  const gridDisplay = await page
    .locator('.morph-card-grid')
    .evaluate((el) => getComputedStyle(el).display);
  expect(gridDisplay).toBe('grid');
});

test('summary streams into the chat before the result completes', async ({ context, activate }) => {
  const page = await context.newPage();
  await startEditing(page, activate);

  await page.locator('#counter-btn').click();
  const input = page.locator('#morph-extension-root [data-morph-prompt-input]');
  await input.fill('make this red');

  // Watch for a streaming-state assistant bubble appearing at any point.
  const sawStreaming = page
    .locator('#morph-extension-root .chat-msg.assistant[data-morph-msg-status="streaming"]')
    .waitFor({ state: 'attached', timeout: 5000 })
    .then(() => true)
    .catch(() => false);

  await input.press('Enter');
  expect(await sawStreaming).toBe(true);

  await expect(
    page.locator('#morph-extension-root .chat-msg.assistant[data-morph-msg-status="done"]').last(),
  ).toBeVisible();
});

test('clarifying question is surfaced without touching the page', async ({ context, activate }) => {
  const page = await context.newPage();
  await startEditing(page, activate);

  const h1Before = await page.locator('#hero h1').innerText();
  await page.locator('#hero h1').click();
  await prompt(page, 'question please');

  const lastMsg = page.locator('#morph-extension-root .chat-msg.assistant').last();
  await expect(lastMsg).toHaveAttribute('data-morph-msg-status', 'question');
  await expect(lastMsg).toContainText('all cards or only the selected one');

  // No edit ops ran: no marker attribute, no inline style, content unchanged.
  // (Selection itself stamps data-morph-id — that's expected and harmless.)
  expect(await page.locator('[data-morph-touched]').count()).toBe(0);
  await expect(page.locator('#hero h1')).toHaveText(h1Before);
  expect(await page.locator('#hero h1').getAttribute('style')).toBeNull();
});

test('behavior ops degrade gracefully before the runtime exists (M4)', async ({ context, activate }) => {
  const page = await context.newPage();
  await startEditing(page, activate);

  await page.locator('#counter-btn').click();
  await prompt(page, 'count clicks');

  const lastMsg = page.locator('#morph-extension-root .chat-msg.assistant').last();
  await expect(lastMsg).toHaveAttribute('data-morph-msg-status', 'done');
  await expect(lastMsg).toContainText('Skipped');
});
