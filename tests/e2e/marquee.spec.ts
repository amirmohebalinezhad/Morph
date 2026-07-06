import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

async function startEditing(page: Page, activate: (p: Page) => Promise<{ active: boolean }>) {
  await page.goto('/');
  await activate(page);
  await expect(page.locator('#morph-extension-root [data-morph-toolbar]')).toBeVisible();
}

test.beforeEach(async ({ seedSettings }) => {
  await seedSettings({ provider: 'mock' });
});

test('drag marquee selects intersecting top-level elements', async ({ context, activate }) => {
  const page = await context.newPage();
  await startEditing(page, activate);

  // Drag a rectangle across the stat cards (they live in a grid container).
  const stats = page.locator('#stats');
  const box = (await stats.boundingBox())!;

  // Start the drag on the grid gap (background) and sweep across the cards.
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2 + 4, { steps: 8 });

  // The marquee rectangle is visible mid-drag.
  await expect(page.locator('#morph-extension-root .morph-marquee')).toBeVisible();

  await page.mouse.up();

  // Several cards got selected (top-level articles, not their nested children).
  const count = page.locator('#morph-extension-root [data-morph-selcount]');
  await expect(count).toContainText(/[2-9]\d* selected/);

  // No nested descendant leaked in: the primary selection (last breadcrumb
  // crumb) is a card-level element, not an inner <h3>/<p>.
  const primaryCrumb = page.locator('#morph-extension-root [data-morph-breadcrumb] .crumb.on');
  await expect(primaryCrumb).toHaveText(/article|section|button/i);
});

test('a plain click (no drag) still selects a single element', async ({ context, activate }) => {
  const page = await context.newPage();
  await startEditing(page, activate);

  await page.locator('#counter-btn').click();
  await expect(page.locator('#morph-extension-root [data-morph-selcount]')).toHaveText('1 selected');
});
