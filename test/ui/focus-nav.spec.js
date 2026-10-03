import { test, expect } from '@playwright/test';
import { gotoConfig, gotoMain } from './helpers.js';

test.describe('Spatial focus navigation (remote)', () => {
  test('config: first field focused, arrows move, Enter activates', async ({ page }) => {
    await gotoConfig(page);
    await expect(page.locator('#ha-url')).toHaveAttribute('data-focused', 'true');

    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#ha-token')).toHaveAttribute('data-focused', 'true');
    await expect(page.locator('#ha-url')).not.toHaveAttribute('data-focused', 'true');

    // walk down to Save and activate it with OK → empty-form validation fires
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
    await expect(page.locator('#btn-save')).toHaveAttribute('data-focused', 'true');
    await page.keyboard.press('Enter');
    await expect(page.locator('#config-status')).toContainText(/required/i);
  });

  test('main: orb focused by default, arrow reaches settings', async ({ page }) => {
    await gotoMain(page);
    await expect(page.locator('#orb')).toHaveAttribute('data-focused', 'true');
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#btn-settings')).toHaveAttribute('data-focused', 'true');
  });
});
