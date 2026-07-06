import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

// The /spa fixture rebuilds #spa-root wholesale on "Re-render now". An edit
// inside that region gets clobbered; the sentinel should detect it and offer
// a one-click re-apply.

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

test('sentinel detects an external re-render and re-applies edits', async ({ context, activate }) => {
  const page = await context.newPage();
  await page.goto('/spa');
  await activate(page);
  await expect(page.locator('#morph-extension-root [data-morph-toolbar]')).toBeVisible();

  // Edit an element inside the SPA-managed region.
  const action = page.locator('#spa-action');
  await action.click();
  await prompt(page, 'make this red');
  await expect(action).toHaveCSS('background-color', 'rgb(220, 38, 38)');

  // The page re-renders that region from scratch, wiping the edit.
  await btn(page, 'mode-interact').click();
  await page.locator('#rerender-btn').click();
  await expect(page.locator('#spa-action')).not.toHaveCSS('background-color', 'rgb(220, 38, 38)');

  // The recovery toast appears.
  const toast = page.locator('#morph-extension-root [data-morph-recovery]');
  await expect(toast).toBeVisible({ timeout: 5_000 });

  // Re-apply restores the edit via selector re-anchoring.
  await btn(page, 'recovery-reapply').click();
  await expect(page.locator('#spa-action')).toHaveCSS('background-color', 'rgb(220, 38, 38)', {
    timeout: 5_000,
  });
  await expect(toast).toBeHidden();
});

test('sentinel stays quiet during normal Morph edits and undo', async ({ context, activate }) => {
  const page = await context.newPage();
  await page.goto('/spa');
  await activate(page);
  await expect(page.locator('#morph-extension-root [data-morph-toolbar]')).toBeVisible();

  // A Morph removeElement must NOT trip the sentinel.
  await page.locator('#spa-action').click();
  await btn(page, 'delete').click();
  await page.waitForTimeout(600);
  await expect(page.locator('#morph-extension-root [data-morph-recovery]')).toHaveCount(0);

  // Nor should undo (which re-inserts / mutates DOM).
  await btn(page, 'undo').click();
  await page.waitForTimeout(600);
  await expect(page.locator('#morph-extension-root [data-morph-recovery]')).toHaveCount(0);
});
