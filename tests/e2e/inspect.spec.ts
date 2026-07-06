import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

async function startEditing(page: Page, activate: (p: Page) => Promise<{ active: boolean }>) {
  await page.goto('/');
  await activate(page);
  await expect(page.locator('#morph-extension-root [data-morph-toolbar]')).toBeVisible();
}

const btn = (page: Page, id: string) => page.locator(`#morph-extension-root [data-morph-btn=${id}]`);

test.beforeEach(async ({ seedSettings }) => {
  await seedSettings({ provider: 'mock' });
});

test('padding stepper previews live and commits one manual revision', async ({ context, activate }) => {
  const page = await context.newPage();
  await startEditing(page, activate);

  const counter = page.locator('#counter-btn');
  await counter.click();
  await btn(page, 'tab-inspect').click();

  const padding = page.locator('#morph-extension-root [data-morph-inspect="padding-top"]');
  await expect(padding).toBeVisible();

  // Several rapid changes...
  await padding.fill('18');
  await padding.fill('22');
  await expect(counter).toHaveCSS('padding-top', '22px'); // live preview

  // ...coalesce into ONE manual revision after the debounce.
  await btn(page, 'tab-timeline').click();
  const rows = page.locator('#morph-extension-root [data-morph-timeline] [data-morph-revision]');
  await expect(rows).toHaveCount(2, { timeout: 5_000 }); // root + one manual
  await expect(rows.nth(1)).toContainText('Manual');
  await expect(counter).toHaveCSS('padding-top', '22px');

  await btn(page, 'undo').click();
  await expect(counter).toHaveCSS('padding-top', '9px'); // original .btn padding
});

test('opacity slider and background color stage through the same pipeline', async ({ context, activate }) => {
  const page = await context.newPage();
  await startEditing(page, activate);

  const counter = page.locator('#counter-btn');
  await counter.click();
  await btn(page, 'tab-inspect').click();

  const opacity = page.locator('#morph-extension-root [data-morph-inspect="opacity"]');
  await opacity.fill('50');
  await expect(counter).toHaveCSS('opacity', '0.5');

  await btn(page, 'tab-timeline').click();
  await expect(
    page.locator('#morph-extension-root [data-morph-timeline] [data-morph-revision]'),
  ).toHaveCount(2, { timeout: 5_000 });
  await btn(page, 'undo').click();
  await expect(counter).toHaveCSS('opacity', '1');
});

test('corner handle resize commits a revision on release', async ({ context, activate }) => {
  const page = await context.newPage();
  await startEditing(page, activate);

  const counter = page.locator('#counter-btn');
  await counter.click();

  const startBox = (await counter.boundingBox())!;
  const handle = page.locator('#morph-extension-root [data-morph-handle=se]');
  await expect(handle).toBeVisible();

  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + 40, hb.y + 20, { steps: 5 });
  await page.mouse.up();

  const after = (await counter.boundingBox())!;
  expect(after.width).toBeGreaterThan(startBox.width + 25);
  expect(after.height).toBeGreaterThan(startBox.height + 10);

  await btn(page, 'tab-timeline').click();
  await expect(
    page.locator('#morph-extension-root [data-morph-timeline] [data-morph-revision]'),
  ).toHaveCount(2, { timeout: 5_000 });
  await expect(page.locator('#morph-extension-root [data-morph-timeline]')).toContainText('resized');

  await btn(page, 'undo').click();
  const restored = (await counter.boundingBox())!;
  expect(Math.abs(restored.width - startBox.width)).toBeLessThanOrEqual(2);
});

test('move grip drags the element via transform and undoes', async ({ context, activate }) => {
  const page = await context.newPage();
  await startEditing(page, activate);

  const counter = page.locator('#counter-btn');
  await counter.click();

  const grip = page.locator('#morph-extension-root [data-morph-handle=move]');
  await expect(grip).toBeVisible();
  const gb = (await grip.boundingBox())!;

  await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
  await page.mouse.down();
  await page.mouse.move(gb.x + gb.width / 2 + 60, gb.y + gb.height / 2 + 25, { steps: 6 });
  await page.mouse.up();

  await expect(counter).toHaveCSS('transform', /matrix\(1, 0, 0, 1, 60, 25\)/);

  await btn(page, 'undo').click();
  await expect(counter).toHaveCSS('transform', 'none');
});
