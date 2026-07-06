import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

async function startEditing(page: Page, activate: (p: Page) => Promise<{ active: boolean }>) {
  await page.goto('/');
  await activate(page);
  await expect(page.locator('#morph-extension-root [data-morph-toolbar]')).toBeVisible();
}

async function prompt(page: Page, text: string) {
  const input = page.locator('#morph-extension-root [data-morph-prompt-input]');
  await input.fill(text);
  await input.press('Enter');
  await expect(
    page.locator('#morph-extension-root .chat-msg.assistant').last(),
  ).toHaveAttribute('data-morph-msg-status', /done|question/, { timeout: 15_000 });
}

const btn = (page: Page, id: string) => page.locator(`#morph-extension-root [data-morph-btn=${id}]`);

test.beforeEach(async ({ seedSettings }) => {
  await seedSettings({ provider: 'mock' });
});

test('mockNetwork intercepts the page fetch; undo restores the real API', async ({ context, activate }) => {
  const page = await context.newPage();
  await startEditing(page, activate);

  // Real backend values first.
  await expect(page.locator('#stat-users')).toHaveText('1284');

  await page.locator('#stats').click();
  await prompt(page, 'fake the api data');

  const lastMsg = page.locator('#morph-extension-root .chat-msg.assistant').last();
  await expect(lastMsg).not.toContainText('Skipped');

  // The page's own refresh button now gets mocked data.
  await btn(page, 'mode-interact').click();
  await page.locator('#refresh-stats').click();
  await expect(page.locator('#stat-users')).toHaveText('99999');
  await expect(page.locator('#stat-revenue')).toHaveText('$1,000,000');

  // Undo removes the rules; the real endpoint answers again.
  await btn(page, 'mode-select').click();
  await btn(page, 'undo').click();
  await btn(page, 'mode-interact').click();
  await page.locator('#refresh-stats').click();
  await expect(page.locator('#stat-users')).toHaveText('1284');

  // Redo re-arms the mock.
  await btn(page, 'mode-select').click();
  await btn(page, 'redo').click();
  await btn(page, 'mode-interact').click();
  await page.locator('#refresh-stats').click();
  await expect(page.locator('#stat-users')).toHaveText('99999');
});
