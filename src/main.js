/**
 * Entry point – wires UI and HAClient together.
 * Voice pipeline runs in the Luna service (service/index.js) because the
 * Magic Remote mic is only accessible via com.webos.service.voiceinput, not
 * via WebRTC getUserMedia.  The browser app drives the UI and TTS playback.
 *
 * webOS Magic Remote key codes relevant to us:
 *   409  – RECORD / MIC button (on some models)
 *   1060 – webOS AI button (some firmwares)
 *   13   – OK / Enter (also triggers voice)
 *   461  – BACK
 *
 * Mic button (keycode 428) is handled by the inputhook → service/voice/start
 * and service/voice/stop.  The OK button and orb click are handled here via
 * luna calls to the same service endpoints.
 */

import { HAClient } from './ha-client.js';
import { lunaCall } from './luna.js';

// ── Key codes ──────────────────────────────────────────────────────────────────
const KEY = {
  OK: 13,
  BACK: 461,
  MIC: 409,
  AI: 1060,
};
const VOICE_KEYS = new Set([KEY.OK, KEY.MIC, KEY.AI]);

// ── Voice state (mirrored from service, updated by polling) ───────────────────
const SvcState = Object.freeze({
  IDLE:       'idle',
  LISTENING:  'listening',
  PROCESSING: 'processing',
  SPEAKING:   'speaking',
  ERROR:      'error',
});

let svcState        = SvcState.IDLE;
let svcTranscript   = '';
let _statePollTimer = null;
let _pollInFlight   = false;

// ── Config storage ─────────────────────────────────────────────────────────────
const CONFIG_KEY = 'ha_voice_config';

function loadConfig() {
  try {
    return JSON.parse(localStorage.getItem(CONFIG_KEY) ?? 'null') ?? {};
  } catch (_) { return {}; }
}

function saveConfig(cfg) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

function syncServiceConfig(overrideToken) {
  if (!config.url) return Promise.resolve();
  return lunaCall('luna://com.homebrew.havoice.service/setHAConfig', {
    url:          config.url,
    token:        overrideToken || config.token,
    pipelineId:   config.pipelineId   || '',
    refreshToken: config.refreshToken || '',
    clientId:     config.clientId     || '',
    sttMode:      config.sttMode      || 'lg',
  }).catch(err => console.warn('[main] setHAConfig failed:', err.message));
}

function updateStoredToken(newToken) {
  config.token = newToken;  // keep in-memory config in sync too
  const cfg = loadConfig();
  cfg.token = newToken;
  saveConfig(cfg);
  syncServiceConfig(newToken);
}

// ── DOM refs ───────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const screenConfig  = $('screen-config');
const screenMain    = $('screen-main');
const inputUrl      = $('ha-url');
const inputToken    = $('ha-token');
const inputPipeline = $('pipeline-id');
const selectSttMode = $('stt-mode');
const btnSave       = $('btn-save');
const configStatus  = $('config-status');
const orb           = $('orb');
const stateLabel    = $('state-label');
const transcriptBox = $('transcript-box');
const transcriptText = $('transcript-text');
const connIndicator = $('conn-indicator');
const connLabel     = $('conn-label');
const btnSettings      = $('btn-settings');
const setupNotice      = $('setup-notice');
const btnSetup         = $('btn-setup');
const setupStatus      = $('setup-status');
const setupUrl         = $('setup-url');
const voiceOverlay     = $('voice-overlay');
const overlayLabel     = $('overlay-label');
const overlayTranscript = $('overlay-transcript');

// ── App state ──────────────────────────────────────────────────────────────────
let haClient     = null;
let config       = loadConfig();
let _overlayMode = false;  // true when launched from another app via overlay param

// ── webOS launch params ────────────────────────────────────────────────────────
function getLaunchParams() {
  try {
    return JSON.parse(window.PalmSystem?.launchParams ?? '{}');
  } catch (_) { return {}; }
}

if (window.PalmSystem) {
  document.addEventListener('webOSRelaunch', (e) => {
    let params = {};
    try { params = JSON.parse(e.detail ?? '{}'); } catch (_) {}
    handleLaunchParams(params);
  });
}

// ── Launch param handling ───────────────────────────────────────────────────────
function handleLaunchParams(params) {
  if (params.config) {
    const { url, token, refreshToken, clientId } = params.config;
    if (url && token) {
      config = { url, token, refreshToken: refreshToken ?? '', clientId: clientId ?? '', pipelineId: '', sttMode: config.sttMode || 'lg' };
      saveConfig(config);
      haClient?.disconnect();
      haClient = null;
      _overlayMode = false;
      showMain();
      initClient({});
    }
    return;
  }

  if (!haClient?.connected) return;

  if (params.action === 'overlay') {
    // Launched from another app via mic button – show overlay, auto-hide when done.
    _overlayMode = true;
    showMain();
    return;
  }

  if (params.action === 'start') {
    voiceStart();
  } else if (params.action === 'stop') {
    voiceStop();
  } else if (params.autoListen) {
    voiceStart();
  }
}

// ── Boot ───────────────────────────────────────────────────────────────────────
const launchParams = getLaunchParams();

if (config.url && config.token) {
  showMain();
  initClient(launchParams);
} else {
  showConfig();
}

// ── Config screen ──────────────────────────────────────────────────────────────
function showConfig() {
  screenConfig.classList.add('active');
  screenMain.classList.remove('active');

  inputUrl.value      = config.url ?? '';
  inputToken.value    = config.token ?? '';
  inputPipeline.value = config.pipelineId ?? '';
  selectSttMode.value = config.sttMode ?? 'lg';

  setTimeout(() => inputUrl.focus(), 100);
  startSetupServer();
}

let _configPollTimer = null;

function stopConfigPolling() {
  if (_configPollTimer) { clearInterval(_configPollTimer); _configPollTimer = null; }
}

function startConfigPolling(baseUrl) {
  stopConfigPolling();
  _configPollTimer = setInterval(async () => {
    if (!screenConfig.classList.contains('active')) { stopConfigPolling(); return; }
    try {
      const res = await fetch(baseUrl + '/pending-config');
      const cfg = await res.json();
      if (cfg && cfg.url && cfg.token) {
        stopConfigPolling();
        config = { url: cfg.url, token: cfg.token, refreshToken: cfg.refreshToken || '', clientId: cfg.clientId || '', pipelineId: '' };
        saveConfig(config);
        showMain();
        initClient({});
      }
    } catch (_) {}
  }, 2000);
}

async function startSetupServer() {
  if (!window.PalmServiceBridge) return;

  setupUrl.textContent = 'Starting…';

  let lastErr = '';
  for (let i = 0; i < 8; i++) {
    try {
      const res = await lunaCall('luna://com.homebrew.havoice.service/startSetupServer', {});
      if (res.url) {
        setupUrl.textContent = res.url;
        startConfigPolling(res.url);
        return;
      }
      lastErr = 'no url in response';
    } catch (e) {
      lastErr = e.message;
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  setupUrl.textContent = 'Error: ' + lastErr;
}

function showMain() {
  screenConfig.classList.remove('active');
  screenMain.classList.add('active');
}

function showConfigStatus(msg, type) {
  configStatus.textContent = msg;
  configStatus.className = `status-msg ${type}`;
}

btnSave.addEventListener('click', () => {
  const url        = inputUrl.value.trim();
  const token      = inputToken.value.trim();
  const pipelineId = inputPipeline.value.trim();
  const sttMode    = selectSttMode.value || 'lg';

  if (!url || !token) {
    showConfigStatus('URL and token are required.', 'error');
    return;
  }

  stopConfigPolling();
  config = { url, token, pipelineId, sttMode, refreshToken: '', clientId: '' };
  saveConfig(config);
  lunaCall('luna://com.homebrew.havoice.service/stopSetupServer', {}).catch(() => {});
  showConfigStatus('Connecting…', '');

  haClient?.disconnect();
  haClient = null;

  showMain();
  initClient({});
});

btnSettings.addEventListener('click', () => {
  haClient?.disconnect();
  haClient = null;
  stopStatePoll();
  showConfig();
});

// ── HA Client ──────────────────────────────────────────────────────────────────
function initClient(initialParams = {}) {
  haClient = new HAClient({
    url:              config.url,
    token:            config.token,
    refreshToken:     config.refreshToken ?? '',
    clientId:         config.clientId ?? '',
    onTokenRefreshed: updateStoredToken,
  });

  haClient.on('connecting',    () => setConnState('connecting', 'Connecting…'));
  haClient.on('reconnecting', (delay) => setConnState('connecting', `Reconnecting in ${Math.round(delay/1000)}s…`));

  haClient.on('connected', () => {
    setConnState('connected', 'Connected');

    // Push HA config to service so it can run the voice pipeline.
    syncServiceConfig();

    checkSetup();
    startStatePoll();

    if (initialParams && Object.keys(initialParams).length) {
      const p = initialParams;
      initialParams = {};
      setTimeout(() => handleLaunchParams(p), 300);
    }
  });

  haClient.on('disconnected', () => {
    setConnState('disconnected', 'Disconnected');
    stopStatePoll();
    setOrbState(SvcState.IDLE);
  });

  haClient.on('auth_error', (msg) => {
    setConnState('disconnected', 'Auth failed');
    showConfig();
    showConfigStatus(`Authentication failed: ${msg}`, 'error');
  });

  haClient.connect();
}

function setConnState(cls, label) {
  connIndicator.className = `conn-dot ${cls}`;
  connLabel.textContent = label;
}

// ── First-run setup ────────────────────────────────────────────────────────────
async function checkSetup() {
  try {
    const res = await lunaCall('luna://com.homebrew.havoice.service/isSetupDone', {});
    if (!res.done) showSetupNotice();
  } catch (_) {}
}

function showSetupNotice() { setupNotice.classList.remove('hidden'); }
function hideSetupNotice() { setupNotice.classList.add('hidden'); }

btnSetup.addEventListener('click', async () => {
  btnSetup.disabled  = true;
  setupStatus.textContent = 'Requesting elevation…';

  try {
    await lunaCall('luna://org.webosbrew.hbchannel.service/elevateService', {
      id: 'com.homebrew.havoice.service',
    });
  } catch (err) {
    console.warn('[Setup] elevateService failed:', err.message);
  }

  setupStatus.textContent = 'Configuring mic button…';

  try {
    await lunaCall('luna://com.homebrew.havoice.service/setup', {});
    setupStatus.textContent = 'Done! Hold mic button to talk.';
    setTimeout(hideSetupNotice, 2000);
  } catch (err) {
    setupStatus.textContent = `Failed: ${err.message}. Run setup.sh via SSH.`;
    btnSetup.disabled = false;
  }
});

// ── Service state polling ──────────────────────────────────────────────────────
// Poll the service every 400 ms to update the orb UI and play TTS audio.

function startStatePoll() {
  stopStatePoll();
  _statePollTimer = setInterval(pollVoiceState, 400);
}

function stopStatePoll() {
  if (_statePollTimer) { clearInterval(_statePollTimer); _statePollTimer = null; }
}

async function pollVoiceState() {
  if (_pollInFlight) return;
  _pollInFlight = true;
  try {
    const res = await lunaCall('luna://com.homebrew.havoice.service/voice/state', {});
    const newState = res.state || SvcState.IDLE;

    if (newState !== svcState || res.transcript !== svcTranscript) {
      svcState      = newState;
      svcTranscript = res.transcript || '';
      setOrbState(svcState);
      if (svcTranscript) showTranscript(svcTranscript);
    }

    // TTS URL is delivered once (service clears it after responding).
    if (res.ttsUrl) {
      playTts(res.ttsUrl);
    }
  } catch (_) {
  } finally {
    _pollInFlight = false;
  }
}

function playTts(ttsUrl) {
  try {
    const url = ttsUrl.startsWith('http') ? ttsUrl : config.url.replace(/\/$/, '') + ttsUrl;
    const audio = new Audio(url);
    audio.onended = () => {};
    audio.onerror = (e) => console.warn('[TTS] playback error', e);
    audio.play().catch(e => console.warn('[TTS] play() rejected', e));
  } catch (e) {
    console.warn('[TTS] playTts error', e);
  }
}

// ── Voice control ─────────────────────────────────────────────────────────────

function voiceStart() {
  if (!haClient?.connected) return;
  lunaCall('luna://com.homebrew.havoice.service/voice/start', { fromApp: true }).catch(
    e => console.warn('[voice] start failed:', e.message)
  );
}

function voiceStop() {
  lunaCall('luna://com.homebrew.havoice.service/voice/stop', {}).catch(
    e => console.warn('[voice] stop failed:', e.message)
  );
}

function voiceAbort() {
  lunaCall('luna://com.homebrew.havoice.service/voice/abort', {}).catch(
    e => console.warn('[voice] abort failed:', e.message)
  );
}

// ── Orb UI ─────────────────────────────────────────────────────────────────────
const STATE_LABELS = {
  [SvcState.IDLE]:       'Press mic button or OK to talk',
  [SvcState.LISTENING]:  'Listening… release mic button to send',
  [SvcState.PROCESSING]: 'Processing…',
  [SvcState.SPEAKING]:   'Speaking…',
  [SvcState.ERROR]:      'Something went wrong',
};

const OVERLAY_LABELS = {
  [SvcState.LISTENING]:  'Listening…',
  [SvcState.PROCESSING]: 'Processing…',
  [SvcState.SPEAKING]:   'Speaking…',
};

const ACTIVE_STATES = new Set([SvcState.LISTENING, SvcState.PROCESSING, SvcState.SPEAKING]);

function setOrbState(state) {
  orb.className = `orb ${state}`;
  stateLabel.textContent = STATE_LABELS[state] ?? '';

  const overlayActive = ACTIVE_STATES.has(state);
  voiceOverlay.className = overlayActive ? `voice-overlay active ${state}` : 'voice-overlay';
  if (overlayActive) {
    overlayLabel.textContent = OVERLAY_LABELS[state] ?? '';
  } else {
    overlayTranscript.textContent = '';
  }

  if (state === SvcState.IDLE || state === SvcState.ERROR) {
    setTimeout(() => hideTranscript(), state === SvcState.IDLE ? 4000 : 0);

    if (_overlayMode && state === SvcState.IDLE) {
      _overlayMode = false;
      // Brief pause so the user sees speaking/result before the overlay hides.
      setTimeout(() => {
        if (window.PalmSystem) window.PalmSystem.hide();
      }, 1200);
    }
  }
}

function showTranscript(text) {
  transcriptText.textContent = text;
  transcriptBox.classList.remove('hidden');
  overlayTranscript.textContent = text;
}

function hideTranscript() {
  transcriptBox.classList.add('hidden');
  transcriptText.textContent = '';
}

// ── Input handling ─────────────────────────────────────────────────────────────
orb.addEventListener('click', handleVoiceActivation);

document.addEventListener('keydown', (e) => {
  if (screenConfig.classList.contains('active')) return;

  if (VOICE_KEYS.has(e.keyCode)) {
    e.preventDefault();
    handleVoiceActivation();
  } else if (e.keyCode === KEY.BACK) {
    if (svcState !== SvcState.IDLE && svcState !== SvcState.ERROR) {
      e.preventDefault();
      voiceAbort();
    }
  }
});

function handleVoiceActivation() {
  if (!haClient?.connected) return;

  if (svcState === SvcState.IDLE || svcState === SvcState.ERROR) {
    hideTranscript();
    voiceStart();
  } else if (svcState === SvcState.LISTENING) {
    voiceStop();
  } else if (svcState === SvcState.SPEAKING || svcState === SvcState.PROCESSING) {
    voiceAbort();
  }
}
