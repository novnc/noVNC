/*
 * noVNC: HTML5 VNC client
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * Playback of the QEMU VNC audio extension.
 *
 * The server sends raw PCM. This class turns it into scheduled Web Audio
 * buffers with a small jitter buffer so network bursts do not crackle.
 */

import * as Log from './util/logging.js';

// Sample format ids used by the QEMU "set format" message
export const AUDIO_FORMAT_U8  = 0;
export const AUDIO_FORMAT_S16 = 3;   // little endian, as sent by QEMU

// If more than this much audio is already queued, new data is dropped
// so latency cannot grow without bound (QEMU itself throttles similarly).
const MAX_QUEUED_SECONDS = 0.6;

export default class QemuAudio {
    constructor(options) {
        options = options || {};
        this._frequency = options.frequency > 0 ? Math.min(options.frequency, 48000) : 44100;
        this._channels = options.channels === 1 ? 1 : 2;
        this._format = options.format === AUDIO_FORMAT_U8 ? AUDIO_FORMAT_U8 : AUDIO_FORMAT_S16;
        // Seconds of audio buffered before playback starts or restarts
        this._latency = options.latency >= 0 ? options.latency : 0.1;

        this._bytesPerSample = this._format === AUDIO_FORMAT_U8 ? 1 : 2;
        this._frameSize = this._bytesPerSample * this._channels;

        this._ctx = null;
        this._gain = null;
        this._volume = 1;
        this._nextTime = 0;
        this._pending = new Uint8Array(0);   // incomplete trailing frame
        this._gestureHandler = null;
    }

    get frequency() { return this._frequency; }
    get channels() { return this._channels; }
    get format() { return this._format; }
    get state() { return this._ctx ? this._ctx.state : 'closed'; }

    get volume() { return this._volume; }
    set volume(value) {
        this._volume = Math.max(0, Math.min(1, Number(value) || 0));
        if (this._gain) {
            this._gain.gain.value = this._volume;
        }
    }

    start() {
        if (this._ctx) { return; }
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) {
            Log.Warn("Web Audio is not available, audio disabled");
            return;
        }
        try {
            this._ctx = new Ctx({ sampleRate: this._frequency });
        } catch (e) {
            Log.Warn("Could not create AudioContext: " + e);
            this._ctx = null;
            return;
        }
        this._gain = this._ctx.createGain();
        this._gain.gain.value = this._volume;
        this._gain.connect(this._ctx.destination);

        // Browsers keep audio suspended until the user interacts with the page
        this.resume();
        if (this._ctx.state !== 'running') {
            this._gestureHandler = () => this.resume();
            for (const ev of ['pointerdown', 'keydown', 'touchend']) {
                document.addEventListener(ev, this._gestureHandler, true);
            }
        }
    }

    resume() {
        if (!this._ctx) { return; }
        if (this._ctx.state === 'suspended') {
            this._ctx.resume().catch(() => {});
        }
        if (this._ctx.state === 'running') {
            this._removeGestureHandler();
        }
    }

    // Server told us a capture started or stopped: restart scheduling
    begin() { this._nextTime = 0; this._pending = new Uint8Array(0); }
    end()   { this._nextTime = 0; this._pending = new Uint8Array(0); }

    push(bytes) {
        const ctx = this._ctx;
        if (!ctx || bytes.length === 0) { return; }

        // Data that arrives while the browser still blocks audio is dropped,
        // otherwise it would play as one huge delayed burst.
        if (ctx.state !== 'running') {
            this.resume();
            return;
        }

        // Join with leftover bytes from a frame split across messages
        let data = bytes;
        if (this._pending.length > 0) {
            data = new Uint8Array(this._pending.length + bytes.length);
            data.set(this._pending, 0);
            data.set(bytes, this._pending.length);
        }
        const frames = Math.floor(data.length / this._frameSize);
        const used = frames * this._frameSize;
        this._pending = data.slice(used);
        if (frames === 0) { return; }

        const now = ctx.currentTime;
        if (this._nextTime < now + 0.005) {
            // First chunk, or we ran dry: rebuild the jitter buffer
            this._nextTime = now + this._latency;
        } else if (this._nextTime - now > MAX_QUEUED_SECONDS) {
            return;
        }

        const buffer = ctx.createBuffer(this._channels, frames, this._frequency);
        const view = new DataView(data.buffer, data.byteOffset, used);
        for (let ch = 0; ch < this._channels; ch++) {
            const out = buffer.getChannelData(ch);
            for (let i = 0; i < frames; i++) {
                const pos = (i * this._channels + ch) * this._bytesPerSample;
                if (this._format === AUDIO_FORMAT_U8) {
                    out[i] = (view.getUint8(pos) - 128) / 128;
                } else {
                    out[i] = view.getInt16(pos, true) / 32768;
                }
            }
        }

        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(this._gain);
        src.start(this._nextTime);
        this._nextTime += buffer.duration;
    }

    stop() {
        this._removeGestureHandler();
        if (this._ctx) {
            this._ctx.close().catch(() => {});
        }
        this._ctx = null;
        this._gain = null;
        this._nextTime = 0;
        this._pending = new Uint8Array(0);
    }

    _removeGestureHandler() {
        if (!this._gestureHandler) { return; }
        for (const ev of ['pointerdown', 'keydown', 'touchend']) {
            document.removeEventListener(ev, this._gestureHandler, true);
        }
        this._gestureHandler = null;
    }
}
