import { test, expect } from './fixtures';

test('service worker registers and reports the extension', async ({ serviceWorker }) => {
  expect(serviceWorker.url()).toMatch(/^chrome-extension:\/\/[a-p]{32}\/background\.js$/);
});

test('activation injects the content script and toggles edit mode', async ({ context, activate }) => {
  const page = await context.newPage();
  await page.goto('/');

  const first = await activate(page);
  expect(first.active).toBe(true);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset['morphActive']))
    .toBe('true');

  const second = await activate(page);
  expect(second.active).toBe(false);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset['morphActive']))
    .toBeUndefined();
});
