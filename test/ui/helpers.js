import { expect } from '@playwright/test';

export const VALID_CONFIG = { url: 'http://ha.local:8123', token: 'test-token', sttMode: 'lg' };

/** Boot straight to the main screen by seeding a saved config in localStorage. */
export async function gotoMain(page, cfg = VALID_CONFIG) {
  await page.addInitScript(
    (c) => localStorage.setItem('ha_voice_config', JSON.stringify(c)),
    cfg,
  );
  await page.goto('/');
  await expect(page.locator('#screen-main')).toHaveClass(/active/);
}

/** Boot to the config screen (no saved config). */
export async function gotoConfig(page) {
  await page.addInitScript(() => localStorage.removeItem('ha_voice_config'));
  await page.goto('/');
  await expect(page.locator('#screen-config')).toHaveClass(/active/);
}

/** Deterministically drive a voice state via the dev-shim control hook. */
export async function driveState(page, state, extra = {}) {
  await page.evaluate(([s, e]) => window.__havoice.setState(s, e), [state, extra]);
}

/** Wait until the fake HA WebSocket handshake completes (orb clicks become active). */
export async function waitConnected(page) {
  // \bconnected\b avoids matching "disconnected".
  await expect(page.locator('#conn-indicator')).toHaveClass(/\bconnected\b/, { timeout: 10_000 });
}
