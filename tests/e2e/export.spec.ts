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

test.beforeEach(async ({ context, seedSettings }) => {
  await seedSettings({ provider: 'mock' });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
});

test('export assembles a change log covering every edit and copies it', async ({ context, activate }) => {
  const page = await context.newPage();
  await startEditing(page, activate);

  // Three edits of different kinds.
  await page.locator('#counter-btn').click();
  await prompt(page, 'make this red');
  await prompt(page, 'count clicks on this');

  await page.locator('#stats').click();
  await prompt(page, 'fake the api data');

  // Open the export dialog and inspect the deterministic change log.
  await btn(page, 'export').click();
  await expect(page.locator('#morph-extension-root [data-morph-export]')).toBeVisible();

  // The mock provider's polish returns immediately; view the raw log to assert
  // the deterministic content is complete regardless of polish.
  await btn(page, 'export-view-changelog').click();
  const output = page.locator('#morph-extension-root [data-morph-export-output]');
  const text = await output.inputValue();

  expect(text).toContain('# Prototype change log');
  expect(text).toContain('make this red');
  expect(text).toContain('background-color');
  expect(text).toContain('count clicks on this');
  expect(text).toContain('```js'); // behavior source included
  expect(text).toContain('morph.on'); // the actual behavior code
  expect(text).toContain('fake the api data');
  expect(text).toContain('```json'); // mock rules
  expect(text).toContain('implement the real API');

  // Copy to clipboard and verify the OS clipboard actually received it.
  await btn(page, 'export-copy').click();
  await expect(btn(page, 'export-copy')).toContainText('Copied');
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain('# Prototype change log');
  expect(clip).toContain('count clicks on this');
});

test('export works with no AI provider (deterministic path)', async ({ context, activate, seedSettings }) => {
  // Force an unconfigured provider: anthropic with no key.
  await seedSettings({ provider: 'anthropic', anthropic: { apiKey: '', model: 'claude-sonnet-5' } });

  const page = await context.newPage();
  await startEditing(page, activate);

  // Manual edit needs no provider.
  await page.locator('#new-report-btn').click();
  await btn(page, 'duplicate').click();

  await btn(page, 'export').click();
  const output = page.locator('#morph-extension-root [data-morph-export-output]');
  await expect(output).toBeVisible();
  const text = await output.inputValue();
  expect(text).toContain('# Prototype change log');
  expect(text).toContain('Duplicate');

  // The polished view falls back to the deterministic log (no provider ran).
  await expect(page.locator('#morph-extension-root [data-morph-btn=export-configure]')).toBeVisible();
});

test('polished implementation prompt streams in when a provider is set', async ({ context, activate }) => {
  const page = await context.newPage();
  await startEditing(page, activate);

  await page.locator('#counter-btn').click();
  await prompt(page, 'make this red');

  await btn(page, 'export').click();
  const output = page.locator('#morph-extension-root [data-morph-export-output]');
  // Mock provider's export writer emits a titled implementation prompt.
  await expect(output).toHaveValue(/Implementation prompt \(mock provider\)/, { timeout: 8_000 });
  await expect(page.locator('#morph-extension-root .modal-status.ok')).toContainText('AI-polished');
});
