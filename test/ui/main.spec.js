import { test, expect } from '@playwright/test';
import { gotoMain, waitConnected } from './helpers.js';

test.describe('Main screen', () => {
  test.beforeEach(({ page }) => gotoMain(page));

  test('starts in the idle state', async ({ page }) => {
    await expect(page.locator('#orb')).toHaveClass(/\bidle\b/);
    await expect(page.locator('#state-label')).toContainText(/press mic button or OK/i);
  });

  test('clicking the orb (once connected) starts listening', async ({ page }) => {
    await waitConnected(page);
    await page.locator('#orb').click({ force: true }); // orb pixel-shifts for burn-in; assert the state, not hit-testing
    await expect(page.locator('#orb')).toHaveClass(/\blistening\b/);
    await expect(page.locator('#voice-overlay')).toHaveClass(/\bactive\b/);
  });

  test('settings button returns to the config screen', async ({ page }) => {
    await page.locator('#btn-settings').click();
    await expect(page.locator('#screen-config')).toHaveClass(/active/);
  });
});
