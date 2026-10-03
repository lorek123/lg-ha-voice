/**
 * Browser dev shim — simulates the webOS Luna voice service so the app can be
 * iterated on in a desktop browser without deploying to a TV.
 *
 * Loaded only via src/dev-entry.js; never included in production builds.
 *
 * Keyboard shortcuts (not in an input):
 *   v  jump to listening
 *   t  jump to processing
 *   s  jump to speaking  (with sample transcript)
 *   i  jump to idle
 *   e  jump to error
 *
 * Normal flow also works: clicking the orb calls voice/start → shim drives the
 * full listening → processing → speaking → idle progression automatically.
 */

// ── State bus ─────────────────────────────────────────────────────────────────

const _subscribers = [];
let _state = 'idle';

function pushState(state, extra = {}) {
  _state = state;
  const msg = JSON.stringify({ returnValue: true, state, ...extra });
  _subscribers.forEach(cb => cb(msg));
  const el = document.getElementById('_dev-state');
  if (el) el.textContent = state;
}

// Deterministic control surface for UI tests (dev build only — dev-shim is never
// bundled into production). Lets Playwright set a voice state without depending on
// the shim's internal setTimeout timing.
window.__havoice = {
  setState: (state, extra = {}) => pushState(state, extra),
  getState: () => _state,
};

// ── Fake PalmServiceBridge ────────────────────────────────────────────────────

class FakePalmServiceBridge {
  constructor() {
    this.onservicecallback = null;
    this._subCb = null;
  }

  call(uri, paramsJson) {
    const params = JSON.parse(paramsJson);
    // Defer so call() always returns before callbacks fire — matches real bridge.
    setTimeout(() => this._handle(uri, params), 10);
  }

  cancel() {
    const idx = _subscribers.indexOf(this._subCb);
    if (idx !== -1) _subscribers.splice(idx, 1);
  }

  _reply(payload) {
    this.onservicecallback?.(JSON.stringify(payload));
  }

  _handle(uri, params) {
    // ── Subscriptions ──────────────────────────────────────────────────────
    if (params.subscribe) {
      this._subCb = msg => this.onservicecallback?.(msg);
      _subscribers.push(this._subCb);
      // Push current state as the initial subscription response.
      if (uri.includes('/voice/state')) {
        this._reply({ returnValue: true, state: _state });
      } else {
        // Generic subscription (TV power etc.) — single benign response.
        this._reply({ returnValue: true });
      }
      return;
    }

    // ── Voice commands ─────────────────────────────────────────────────────
    if (uri.includes('/voice/start')) {
      setTimeout(() => pushState('listening'), 150);
      this._reply({ returnValue: true });
      return;
    }
    if (uri.includes('/voice/stop')) {
      setTimeout(() => pushState('processing'), 150);
      setTimeout(() => pushState('speaking', { transcript: 'Turn on the living room lights' }), 1200);
      setTimeout(() => pushState('idle'), 3500);
      this._reply({ returnValue: true });
      return;
    }
    if (uri.includes('/voice/abort')) {
      setTimeout(() => pushState('idle'), 80);
      this._reply({ returnValue: true });
      return;
    }

    // ── Setup / config ─────────────────────────────────────────────────────
    if (uri.includes('isSetupDone')) {
      this._reply({ returnValue: true, done: true });
      return;
    }
    if (uri.includes('getConfig')) {
      // Tests can stand in a "service-persisted" config for the recovery path.
      if (window.__havoiceSvcConfig) { this._reply({ returnValue: true, ...window.__havoiceSvcConfig }); return; }
      // No saved config — let the app fall through to the config screen.
      this._reply({ returnValue: false, errorText: 'dev mode' });
      return;
    }
    if (uri.includes('getPendingConfig')) {
      // No phone-completed config in dev; polling continues harmlessly.
      this._reply({ returnValue: true, config: null });
      return;
    }
    if (uri.includes('startSetupServer')) {
      // Return the dev server URL; config polling will 404 harmlessly.
      this._reply({ returnValue: true, url: `http://${location.host}` });
      return;
    }

    // ── Everything else (setHAConfig, toast, audio mix, TTS, elevate…) ────
    this._reply({ returnValue: true });
  }
}

window.PalmServiceBridge = FakePalmServiceBridge;

// ── Silence /pending-config polling ───────────────────────────────────────────
// startConfigPolling() fetches /pending-config every 2s while on the config
// screen.  Intercept it here so the esbuild serve log stays clean.
const _origFetch = window.fetch.bind(window);
window.fetch = (url, ...args) => {
  if (typeof url === 'string' && url.includes('/pending-config')) {
    return Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
  }
  return _origFetch(url, ...args);
};

// ── Fake WebSocket (completes HA auth so haClient.connected = true) ───────────
// Without this, orb clicks are no-ops because handleVoiceActivation() bails on
// !haClient?.connected.  The fake WS handles auth and silently drops everything
// else — voice state is still driven by PalmServiceBridge shim above.

class FakeHAWebSocket {
  static CONNECTING = 0;
  static OPEN       = 1;
  static CLOSING    = 2;
  static CLOSED     = 3;

  constructor(_url) {
    this.readyState = 0;
    this.onopen = null; this.onmessage = null;
    this.onerror = null; this.onclose  = null;
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.();
      this._recv({ type: 'auth_required' });
    }, 30);
  }

  send(dataStr) {
    const msg = JSON.parse(dataStr);
    if (msg.type === 'auth') {
      const bad = window.__havoiceBadToken && msg.access_token === window.__havoiceBadToken;
      setTimeout(() => this._recv(bad ? { type: 'auth_invalid', message: 'Invalid token' } : { type: 'auth_ok' }), 20);
    } else if (msg.type === 'assist_pipeline/run') {
      setTimeout(() => this._recv({ type: 'result', id: msg.id, success: true, result: {} }), 20);
    }
  }

  close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }

  _recv(data) { this.onmessage?.({ data: JSON.stringify(data) }); }
}

window.WebSocket = FakeHAWebSocket;

// ── Dev HUD ───────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const hud = document.createElement('div');
  hud.style.cssText = [
    'position:fixed', 'bottom:12px', 'right:12px', 'z-index:9999',
    'background:rgba(0,0,0,.8)', 'color:#0f0', 'font:11px/1.7 monospace',
    'padding:7px 10px', 'border-radius:6px', 'pointer-events:none',
    'border:1px solid #0f04',
  ].join(';');
  hud.innerHTML =
    '<b style="color:#0f8">[DEV]</b> state: <span id="_dev-state">idle</span><br>' +
    'v=listen &nbsp;t=process &nbsp;s=speak &nbsp;i=idle &nbsp;e=error';
  document.body.appendChild(hud);
});

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

document.addEventListener('keydown', (evt) => {
  if (evt.target.tagName === 'INPUT' || evt.target.tagName === 'TEXTAREA') return;
  if (evt.key === 'v') pushState('listening');
  if (evt.key === 't') pushState('processing');
  if (evt.key === 's') pushState('speaking', { transcript: 'Turn on the living room lights' });
  if (evt.key === 'i') pushState('idle');
  if (evt.key === 'e') pushState('error');
});
