/**
 * Audio capture (mic → PCM16 base64 chunks) and TTS playback.
 * webOS uses a Chromium-based engine so Web Audio API is available.
 *
 * Recording produces 16kHz mono PCM16 chunks that HA's STT pipeline expects.
 */

const SAMPLE_RATE = 16000;
const CHUNK_DURATION_MS = 100; // send a chunk every 100ms

export class AudioManager {
  #audioCtx = null;
  #mediaStream = null;
  #sourceNode = null;
  #processorNode = null;
  #onChunk = null;
  #onStopped = null;
  #recording = false;

  // ── Recording ───────────────────────────────────────────────────────────────

  async startRecording({ onChunk, onStopped }) {
    if (this.#recording) return;
    this.#onChunk = onChunk;
    this.#onStopped = onStopped;

    this.#mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: SAMPLE_RATE,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });

    this.#audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
    this.#sourceNode = this.#audioCtx.createMediaStreamSource(this.#mediaStream);

    // ScriptProcessorNode is deprecated but has wide webOS/Chromium support.
    // Buffer size 4096 @ 16kHz ≈ 256ms per callback; we accumulate to target chunk size.
    const bufferSize = 4096;
    this.#processorNode = this.#audioCtx.createScriptProcessor(bufferSize, 1, 1);

    let accumulated = new Float32Array(0);
    const targetSamples = Math.floor(SAMPLE_RATE * CHUNK_DURATION_MS / 1000);

    this.#processorNode.onaudioprocess = (e) => {
      if (!this.#recording) return;
      const input = e.inputBuffer.getChannelData(0);
      const merged = new Float32Array(accumulated.length + input.length);
      merged.set(accumulated);
      merged.set(input, accumulated.length);
      accumulated = merged;

      while (accumulated.length >= targetSamples) {
        const chunk = accumulated.slice(0, targetSamples);
        accumulated = accumulated.slice(targetSamples);
        this.#onChunk?.(float32ToBase64PCM16(chunk));
      }
    };

    this.#sourceNode.connect(this.#processorNode);
    this.#processorNode.connect(this.#audioCtx.destination);
    this.#recording = true;
  }

  stopRecording() {
    if (!this.#recording) return;
    this.#recording = false;

    this.#processorNode?.disconnect();
    this.#sourceNode?.disconnect();
    this.#processorNode = null;
    this.#sourceNode = null;

    this.#mediaStream?.getTracks().forEach(t => t.stop());
    this.#mediaStream = null;

    this.#audioCtx?.close();
    this.#audioCtx = null;

    this.#onStopped?.();
  }

  get isRecording() {
    return this.#recording;
  }

  // ── Playback (TTS) ──────────────────────────────────────────────────────────

  /**
   * Play a TTS audio URL from Home Assistant.
   * HA returns a URL like /api/tts_proxy/... that we fetch and play.
   *
   * @param {string} haBaseUrl  - e.g. http://homeassistant.local:8123
   * @param {string} ttsUrl     - relative or absolute URL to the audio
   * @returns {Promise<void>}   - resolves when playback finishes
   */
  async playTTS(haBaseUrl, ttsUrl) {
    const url = ttsUrl.startsWith('http') ? ttsUrl : haBaseUrl.replace(/\/$/, '') + ttsUrl;

    return new Promise((resolve, reject) => {
      const audio = new Audio(url);
      audio.onended = resolve;
      audio.onerror = () => reject(new Error('TTS playback failed'));
      audio.play().catch(reject);
    });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert Float32Array samples to base64-encoded little-endian PCM16.
 * HA's stt pipeline expects raw 16-bit signed PCM at 16kHz.
 */
function float32ToBase64PCM16(float32) {
  const pcm16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  // Convert ArrayBuffer to base64
  const bytes = new Uint8Array(pcm16.buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
