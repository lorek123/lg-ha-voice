import { test, expect } from '@playwright/test';
import { gotoMain, driveState } from './helpers.js';

// Short thresholds so the test doesn't wait a real minute; saver disabled.
async function fastIdle(page) {
  await page.addInitScript(() => { window.__havoiceIdle = { dimMs: 300, saverMs: 10_000_000 }; });
}

test.describe('OLED idle screen-protection', () => {
  test('dims the screen after idle, wakes on activity', async ({ page }) => {
    await fastIdle(page);
    await gotoMain(page);
    await expect(page.locator('#app')).toHaveClass(/screen-dim/, { timeout: 3000 });
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#app')).not.toHaveClass(/screen-dim/);
  });

  test('does not dim during an active voice interaction', async ({ page }) => {
    await fastIdle(page);
    await gotoMain(page);
    await driveState(page, 'listening');
    await page.waitForTimeout(600);
    await expect(page.locator('#app')).not.toHaveClass(/screen-dim/);
  });
});
