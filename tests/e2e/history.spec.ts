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
  ).toHaveAttribute('data-morph-msg-status', /done|question/);
}

const btn = (page: Page, id: string) => page.locator(`#morph-extension-root [data-morph-btn=${id}]`);

test.beforeEach(async ({ seedSettings }) => {
  await seedSettings({ provider: 'mock' });
});

test('undo/redo round-trips an AI edit', async ({ context, activate }) => {
  const page = await context.newPage();
  await startEditing(page, activate);

  const counter = page.locator('#counter-btn');
  const originalBg = await counter.evaluate((el) => getComputedStyle(el).backgroundColor);

  await expect(btn(page, 'undo')).toBeDisabled();

  await counter.click();
  await prompt(page, 'make this red');
  await expect(counter).toHaveCSS('background-color', 'rgb(220, 38, 38)');

  await btn(page, 'undo').click();
  await expect(counter).toHaveCSS('background-color', originalBg);
  await expect(btn(page, 'undo')).toBeDisabled();
  await expect(btn(page, 'redo')).toBeEnabled();

  await btn(page, 'redo').click();
  await expect(counter).toHaveCSS('background-color', 'rgb(220, 38, 38)');
  await expect(btn(page, 'redo')).toBeDisabled();
});

test('timeline jump and branching', async ({ context, activate }) => {
  const page = await context.newPage();
  await startEditing(page, activate);

  const counter = page.locator('#counter-btn');
  await counter.click();
  await prompt(page, 'make this red');
  await prompt(page, 'now make it taller');
  await expect(counter).toHaveCSS('height', '240px');

  // Open the history tab; three entries: root, red, taller.
  await btn(page, 'tab-timeline').click();
  const rows = page.locator('#morph-extension-root [data-morph-timeline] [data-morph-revision]');
  await expect(rows).toHaveCount(3);

  // Jump to the "red" revision → taller is undone but previewed ahead.
  await rows.nth(1).locator('.tl-main').click();
  await expect(counter).not.toHaveCSS('height', '240px');
  await expect(counter).toHaveCSS('background-color', 'rgb(220, 38, 38)');
  await expect(rows.nth(1)).toHaveAttribute('data-morph-revision-head', 'true');

  // New edit from here forks a branch (prompting lives in the Chat tab).
  await btn(page, 'tab-chat').click();
  await prompt(page, 'do something'); // mock default: data-morph-touched
  await expect(page.locator('[data-morph-touched]')).toHaveCount(1);
  await expect(counter).not.toHaveCSS('height', '240px');

  // ...and the fork point shows a branch switcher (2 alternatives).
  await btn(page, 'tab-timeline').click();
  const branchChip = page.locator('#morph-extension-root .tl-branch').first();
  await expect(branchChip).toContainText('2/2');

  // Switching branches restores the other timeline (taller, no touched attr).
  await branchChip.locator('[data-morph-btn=branch-next]').click();
  await expect(counter).toHaveCSS('height', '240px');
  await expect(page.locator('[data-morph-touched]')).toHaveCount(0);
});

test('manual delete commits a revision; undo preserves page listeners', async ({ context, activate }) => {
  const page = await context.newPage();
  await startEditing(page, activate);

  const counter = page.locator('#counter-btn');
  await counter.click();
  await btn(page, 'delete').click();
  await expect(counter).toHaveCount(0);

  // The manual revision shows up in history.
  await btn(page, 'tab-timeline').click();
  await expect(
    page.locator('#morph-extension-root [data-morph-timeline]'),
  ).toContainText('Manual: delete');

  await btn(page, 'undo').click();
  await expect(counter).toHaveCount(1);

  // The page's own click handler still works on the resurrected node.
  await btn(page, 'mode-interact').click();
  await counter.click();
  await expect(counter).toHaveText('Clicked 1 times');
});

test('manual duplicate creates a tracked clone', async ({ context, activate }) => {
  const page = await context.newPage();
  await startEditing(page, activate);

  await page.locator('#new-report-btn').click();
  await btn(page, 'duplicate').click();

  const buttons = page.locator('.hero-actions .btn-primary');
  await expect(buttons).toHaveCount(2);
  await expect(buttons.nth(1)).toHaveAttribute('data-morph-id', /.+/);

  await btn(page, 'undo').click();
  await expect(buttons).toHaveCount(1);
});

test('keyboard undo/redo works in select mode', async ({ context, activate }) => {
  const page = await context.newPage();
  await startEditing(page, activate);

  const counter = page.locator('#counter-btn');
  await counter.click();
  await prompt(page, 'make this red');
  await expect(counter).toHaveCSS('background-color', 'rgb(220, 38, 38)');

  await page.keyboard.press('Control+z');
  await expect(counter).not.toHaveCSS('background-color', 'rgb(220, 38, 38)');

  await page.keyboard.press('Control+Shift+z');
  await expect(counter).toHaveCSS('background-color', 'rgb(220, 38, 38)');
});
