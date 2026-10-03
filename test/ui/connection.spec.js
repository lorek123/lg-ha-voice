import { test, expect } from '@playwright/test';
import { gotoMain } from './helpers.js';

test('connection indicator reaches "connected"', async ({ page }) => {
  await gotoMain(page);
  await expect(page.locator('#conn-indicator')).toHaveClass(/\bconnected\b/, { timeout: 10_000 });
  await expect(page.locator('#conn-label')).toHaveText('Connected');
});
