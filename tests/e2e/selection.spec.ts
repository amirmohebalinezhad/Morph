import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

async function activateOn(page: Page, activate: (p: Page) => Promise<{ active: boolean }>) {
  await page.goto('/');
  const res = await activate(page);
  expect(res.active).toBe(true);
  await expect(page.locator('#morph-extension-root [data-morph-toolbar]')).toBeVisible();
}

/** Bounding box of the primary (labelled) selection overlay box. */
function selectionBox(page: Page) {
  return page.locator('#morph-extension-root .morph-box-selected').first();
}

test('hover highlights the element under the cursor', async ({ context, activate }) => {
  const page = await context.newPage();
  await activateOn(page, activate);

  // Hit-testing resolves the deepest element under the pointer, so hover a
  // leaf control and expect its exact bounds.
  const btn = page.locator('#counter-btn');
  await btn.hover();

  const hoverBox = page.locator('#morph-extension-root .morph-box-hover');
  await expect(hoverBox).toBeVisible();
  await expect(hoverBox.locator('.morph-box-label')).toContainText('button#counter-btn');

  const btnBB = await btn.boundingBox();
  const boxBB = await hoverBox.boundingBox();
  expect(btnBB).not.toBeNull();
  expect(boxBB).not.toBeNull();
  expect(Math.abs(boxBB!.x - btnBB!.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(boxBB!.y - btnBB!.y)).toBeLessThanOrEqual(2);
  expect(Math.abs(boxBB!.width - btnBB!.width)).toBeLessThanOrEqual(3);
  expect(Math.abs(boxBB!.height - btnBB!.height)).toBeLessThanOrEqual(3);
});

test('click selects; shift-click multi-selects; Escape clears', async ({ context, activate }) => {
  const page = await context.newPage();
  await activateOn(page, activate);

  await page.locator('#counter-btn').click();
  const count = page.locator('#morph-extension-root [data-morph-selcount]');
  await expect(count).toHaveText('1 selected');
  await expect(selectionBox(page)).toBeVisible();
  // The label chip names the element.
  await expect(page.locator('#morph-extension-root .morph-box-selected .morph-box-label').first()).toContainText(
    'button#counter-btn',
  );

  await page.locator('#new-report-btn').click({ modifiers: ['Shift'] });
  await expect(count).toHaveText('2 selected');

  // Shift-clicking an already-selected element removes it from the selection.
  await page.locator('#new-report-btn').click({ modifiers: ['Shift'] });
  await expect(count).toHaveText('1 selected');

  await page.keyboard.press('Escape');
  await expect(count).toHaveText('nothing selected');
});

test('select mode blocks page handlers; interact mode restores them', async ({ context, activate }) => {
  const page = await context.newPage();
  await activateOn(page, activate);

  const counter = page.locator('#counter-btn');

  // Select mode: the page's own click handler must NOT fire.
  await counter.click();
  await expect(counter).toHaveText('Clicked 0 times');

  // Interact mode: the prototype is live again.
  await page.locator('#morph-extension-root [data-morph-btn=mode-interact]').click();
  await counter.click();
  await expect(counter).toHaveText('Clicked 1 times');

  // Back to select mode: blocked again.
  await page.locator('#morph-extension-root [data-morph-btn=mode-select]').click();
  await counter.click();
  await expect(counter).toHaveText('Clicked 1 times');
});

test('breadcrumb shows ancestry and keyboard navigates the tree', async ({ context, activate }) => {
  const page = await context.newPage();
  await activateOn(page, activate);

  await page.locator('#users-table tbody tr td').first().click();

  const crumbs = page.locator('#morph-extension-root [data-morph-breadcrumb] .crumb');
  await expect(crumbs.last()).toHaveText(/^td/);
  await expect(page.locator('#morph-extension-root [data-morph-breadcrumb]')).toContainText('table#users-table');

  // ArrowUp selects the parent <tr>.
  await page.keyboard.press('ArrowUp');
  await expect(crumbs.last()).toHaveText(/^tr/);

  // ArrowRight moves to the next row sibling.
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#morph-extension-root .morph-box-selected .morph-box-label').first()).toContainText('tr');

  // ArrowDown goes into the row's first cell.
  await page.keyboard.press('ArrowDown');
  await expect(crumbs.last()).toHaveText(/^td/);

  // Clicking an ancestor crumb selects it.
  await page
    .locator('#morph-extension-root [data-morph-breadcrumb] .crumb', { hasText: 'table#users-table' })
    .click();
  await expect(crumbs.last()).toHaveText(/^table/);
});

test('closing from the toolbar deactivates edit mode', async ({ context, activate }) => {
  const page = await context.newPage();
  await activateOn(page, activate);

  await page.locator('#morph-extension-root [data-morph-btn=close]').click();
  await expect(page.locator('#morph-extension-root [data-morph-toolbar]')).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset['morphActive']))
    .toBeUndefined();

  // Page is fully live again.
  const counter = page.locator('#counter-btn');
  await counter.click();
  await expect(counter).toHaveText('Clicked 1 times');
});
