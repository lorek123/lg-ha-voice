/**
 * Orchestrates a full voice interaction:
 *   idle → listening → processing → speaking → idle
 *
 * Coordinates AudioManager (mic capture) and HAClient (pipeline).
 */

export const State = Object.freeze({
  IDLE: 'idle',
  LISTENING: 'listening',
  PROCESSING: 'processing',
  SPEAKING: 'speaking',
  ERROR: 'error',
});

export class VoicePipeline {
  #audio;
  #ha;
  #haBaseUrl;
  #pipelineId;
  #state = State.IDLE;
  #onStateChange;
  #onTranscript;
  #pipelineController = null;

  constructor({ audio, ha, haBaseUrl, pipelineId, onStateChange, onTranscript }) {
    this.#audio = audio;
    this.#ha = ha;
    this.#haBaseUrl = haBaseUrl;
    this.#pipelineId = pipelineId;
    this.#onStateChange = onStateChange;
    this.#onTranscript = onTranscript;
  }

  get state() { return this.#state; }

  get isActive() {
    return this.#state !== State.IDLE && this.#state !== State.ERROR;
  }

  /** Start a voice interaction. No-op if already active. */
  async start() {
    if (this.isActive) return;
    if (!this.#ha.connected) {
      this.#setState(State.ERROR);
      return;
    }

    this.#setState(State.LISTENING);

    try {
      this.#pipelineController = this.#ha.runVoicePipeline({
        pipelineId: this.#pipelineId || undefined,
        onSttEnd: (text) => {
          this.#onTranscript?.(text);
          this.#setState(State.PROCESSING);
        },
        onTtsStart: async (data) => {
          this.#setState(State.SPEAKING);
          const ttsUrl = data?.tts_output?.url;
          if (ttsUrl) {
            try {
              await this.#audio.playTTS(this.#haBaseUrl, ttsUrl);
            } catch (err) {
              console.error('[VoicePipeline] TTS playback error', err);
            }
          }
        },
        onIntentEnd: (intent) => {
          console.log('[VoicePipeline] intent-end', intent);
        },
        onError: (msg) => {
          console.error('[VoicePipeline] pipeline error:', msg);
          this.#cleanup(State.ERROR);
          // Auto-recover after 2s
          setTimeout(() => {
            if (this.#state === State.ERROR) this.#setState(State.IDLE);
          }, 2000);
        },
        onDone: () => {
          this.#cleanup(State.IDLE);
        },
      });

      await this.#audio.startRecording({
        onChunk: (base64) => {
          this.#pipelineController?.sendAudio(base64);
        },
        onStopped: () => {
          this.#pipelineController?.stop();
        },
      });

    } catch (err) {
      console.error('[VoicePipeline] start error', err);
      this.#cleanup(State.ERROR);
      setTimeout(() => {
        if (this.#state === State.ERROR) this.#setState(State.IDLE);
      }, 2000);
    }
  }

  /** Stop recording; let the pipeline finish STT → TTS. */
  stopListening() {
    if (this.#state !== State.LISTENING) return;
    this.#audio.stopRecording();
    // pipeline controller.stop() is called in onStopped callback
  }

  /** Abort everything and return to idle immediately. */
  abort() {
    this.#audio.stopRecording();
    this.#pipelineController = null;
    this.#setState(State.IDLE);
  }

  #cleanup(nextState) {
    if (this.#audio.isRecording) this.#audio.stopRecording();
    this.#pipelineController = null;
    this.#setState(nextState);
  }

  #setState(s) {
    if (this.#state === s) return;
    this.#state = s;
    this.#onStateChange?.(s);
  }
}
