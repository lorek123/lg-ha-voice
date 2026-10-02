import { test, expect } from '@playwright/test';
import { gotoMain, driveState } from './helpers.js';

const ACTIVE = { listening: 'Listening…', processing: 'Processing…', speaking: 'Speaking…' };

test.describe('Voice states', () => {
  test.beforeEach(({ page }) => gotoMain(page));

  for (const [state, label] of Object.entries(ACTIVE)) {
    test(`${state}: orb + overlay reflect the state`, async ({ page }) => {
      await driveState(page, state);
      await expect(page.locator('#orb')).toHaveClass(new RegExp(`\\b${state}\\b`));
      await expect(page.locator('#voice-overlay')).toHaveClass(new RegExp(`\\bactive\\b.*\\b${state}\\b`));
      await expect(page.locator('#overlay-label')).toHaveText(label);
    });
  }

  test('speaking renders the transcript', async ({ page }) => {
    await driveState(page, 'speaking', { transcript: 'Turn on the living room lights' });
    await expect(page.locator('#transcript-text')).toHaveText('Turn on the living room lights');
    await expect(page.locator('#transcript-box')).not.toHaveClass(/hidden/);
  });

  test('idle clears the overlay', async ({ page }) => {
    await driveState(page, 'speaking');
    await driveState(page, 'idle');
    await expect(page.locator('#voice-overlay')).not.toHaveClass(/\bactive\b/);
    await expect(page.locator('#orb')).toHaveClass(/\bidle\b/);
  });

  test('error state shows the error label', async ({ page }) => {
    await driveState(page, 'error');
    await expect(page.locator('#orb')).toHaveClass(/\berror\b/);
    await expect(page.locator('#state-label')).toContainText(/something went wrong/i);
  });
});
