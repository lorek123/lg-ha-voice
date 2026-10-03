import { test, expect } from '@playwright/test';
import { gotoConfig } from './helpers.js';

test.describe('Config screen', () => {
  test.beforeEach(({ page }) => gotoConfig(page));

  test('shown on first run, main screen hidden', async ({ page }) => {
    await expect(page.locator('#screen-config')).toHaveClass(/active/);
    await expect(page.locator('#screen-main')).not.toHaveClass(/active/);
  });

  test('renders all setup fields', async ({ page }) => {
    for (const id of ['#ha-url', '#ha-token', '#pipeline-id', '#stt-mode', '#btn-save']) {
      await expect(page.locator(id)).toBeVisible();
    }
  });

  test('empty save is rejected with a validation message', async ({ page }) => {
    await page.locator('#btn-save').click();
    await expect(page.locator('#config-status')).toContainText(/required/i);
    await expect(page.locator('#screen-config')).toHaveClass(/active/);
  });

  test('saving URL + token moves to the main screen', async ({ page }) => {
    await page.locator('#ha-url').fill('http://ha.local:8123');
    await page.locator('#ha-token').fill('test-token');
    await page.locator('#btn-save').click();
    await expect(page.locator('#screen-main')).toHaveClass(/active/);
  });
});
