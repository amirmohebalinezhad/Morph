import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

async function startEditing(page: Page, activate: (p: Page) => Promise<{ active: boolean }>, path = '/') {
  await page.goto(path);
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

test('AI behavior runs live, undoes, and redoes', async ({ context, activate }) => {
  const page = await context.newPage();
  await startEditing(page, activate);

  const counter = page.locator('#counter-btn');
  await counter.click();
  await prompt(page, 'count clicks on this'); // mock: addBehavior with a badge

  // No "Skipped" note — the behavior actually ran (tier 2 on this page).
  const lastMsg = page.locator('#morph-extension-root .chat-msg.assistant').last();
  await expect(lastMsg).not.toContainText('Skipped');

  const badge = page.locator('[data-morph-badge=counter]');
  await expect(badge).toHaveText(' (0 clicks)');

  // Interact with the working prototype: both the page's own handler and the
  // injected behavior respond to clicks.
  await btn(page, 'mode-interact').click();
  await counter.click();
  await counter.click();
  await expect(badge).toHaveText(' (2 clicks)');
  await expect(counter).toContainText('Clicked 2 times');

  // Undo removes the badge AND disarms the listener.
  await btn(page, 'mode-select').click();
  await btn(page, 'undo').click();
  await expect(badge).toHaveCount(0);
  await btn(page, 'mode-interact').click();
  await counter.click();
  await expect(page.locator('[data-morph-badge=counter]')).toHaveCount(0);

  // Redo re-executes the stored behavior fresh.
  await btn(page, 'mode-select').click();
  await btn(page, 'redo').click();
  await expect(page.locator('[data-morph-badge=counter]')).toHaveText(' (0 clicks)');
  await btn(page, 'mode-interact').click();
  await counter.click();
  await expect(page.locator('[data-morph-badge=counter]')).toHaveText(' (1 clicks)');
});

test('replacing a behavior with the same id tears the old one down', async ({ context, activate }) => {
  const page = await context.newPage();
  await startEditing(page, activate);

  await page.locator('#counter-btn').click();
  await prompt(page, 'count clicks please');
  await prompt(page, 'count clicks differently'); // same mock behavior id

  // Only one badge exists — begin() tore down the previous instance.
  await expect(page.locator('[data-morph-badge=counter]')).toHaveCount(1);
});
