import { test, expect } from '@playwright/test';

// Regression: a localStorage config whose token fails auth and has no refresh
// creds must be rescued from the service's getConfig (which holds the refresh
// token), not dumped onto the setup screen.
test('recovers from service config instead of showing setup', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('ha_voice_config', JSON.stringify({
      url: 'http://ha.local:8123', token: 'BAD-EXPIRED', sttMode: 'lg', refreshToken: '', clientId: '',
    }));
    window.__havoiceBadToken = 'BAD-EXPIRED';                 // WS rejects this token
    window.__havoiceSvcConfig = {                              // service holds a good one
      url: 'http://ha.local:8123', token: 'GOOD', refreshToken: 'r', clientId: 'c', sttMode: 'lg', pipelineId: '',
    };
  });
  await page.goto('/');
  // Must NOT fall back to the config screen…
  await expect(page.locator('#screen-main')).toHaveClass(/active/);
  await expect(page.locator('#screen-config')).not.toHaveClass(/active/);
  // …and should end up connected on the recovered token.
  await expect(page.locator('#conn-indicator')).toHaveClass(/\bconnected\b/, { timeout: 10000 });
});
