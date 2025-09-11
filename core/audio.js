// The RFB protocol (VNC) is designed for real-time user interactions
// and allows transferring audio messages together with screen content.
// It is not possible to use any kind of buffering, because that would
// introduce large delays between user interaction and content display.
//
// This is not really a problem with screen content, because the human
// brain is quite tolerate about slight speed changes in video content,
// and we mostly transfer non-video data anyways.
//
// With audio, the situation is quite different, as it must be played
// at a constant speed. Any delay leads to audio distortion, which is
// unpleasant for humans.
//
// Without buffering, it is always possible for audio frames to arrive
// too late or too early due to changing network speeds.
//
// We use the following algorithm:
//
// - small Jitter buffer to tolerate small speed changes (20ms)
// - simply discard late audio frame
// - Queue early frames with slight speedup (pitch scale) to re-sync audio
// - if we get to many early frames, skip frames for fast re-sync
//
// ## Audio format
//
// We use/expect U16, little endian, raw audio data,
// interleaved channel data:  [L0, R0, L1, R1, ...]

import * as Log from './util/logging.js';

export default class Audio {
    constructor(sample_rate, nchannels) {
        this._next_start = 0;
        this._context = null;
        this._jitter = 0.02;
        this._resample_trigger = 5*this._jitter;
        this._stable_time = 1.0;

        // ===== PROPERTIES =====
        this._sample_rate = sample_rate;
        this._nchannels = nchannels;
        this._little_endian = true;
    }

    // ===== PROPERTIES =====
    get sample_rate() { return this._sample_rate; }
    get nchannels() { return this._nchannels; }

    // ===== PUBLIC METHODS =====

    // Stop audio playback
    //
    // Further audio frames are simply dropped.
    stop() {
        this._context = null;
        this._next_start = 0;
    }

    start() {
        this._context = new AudioContext({
            latencyHint: "interactive",
            sampleRate: this._sample_rate,
        });
        this._next_start = 0;
    }

    play(payload) {
        if (this._context === null) {
            return true;
        }

        let ctime = this._context.currentTime;

        let time_offset = this._next_start - ctime;

        let sample_bytes = 2*this._nchannels;

        if ((time_offset < this._jitter) && (this._resample_trigger !== 5*this._jitter)) {
            Log.Debug("Stop resampling because audio is in sync (delay = " + time_offset + " sec)");
            this._resample_trigger = 5*this._jitter;
        }

        let buffer = null;
        if (time_offset > this._resample_trigger && (payload.length > (100*sample_bytes))) {
            if (this._resample_trigger !== this._jitter) {
                Log.Debug("Start resampling to re-sync audio (delay = " + time_offset + " sec)");
                this._resample_trigger = this._jitter;
            }
            buffer = this._pitchScale(payload, 1.01); // increase pitch by 1%
        } else {
            buffer = this._createBuffer(payload);
        }

        if (this._next_start > 0) {
            if (time_offset < -buffer.duration) {
                Log.Warn("Skip delayed audio frame (delay = " + (-time_offset) + " sec)");
                this._next_start = ctime + this._jitter;
                return true; // do not play delayed frame - skip it!
            }
            if  (time_offset > 0.5) {
                Log.Warn("Move fast audio frame (offset = " + time_offset + " sec)");
                this._stable_time = 0;
                return true; // skip frame.
            }
        }

        this._stable_time += buffer.duration;

        if (this._next_start === 0) {
            this._next_start = ctime + this._jitter;
        }

        let start_time = this._next_start;
        this._next_start += buffer.duration;

        if (this._stable_time >= 1.0) {
            let source = this._context.createBufferSource();
            source.buffer = buffer;
            source.connect(this._context.destination);
            source.start(start_time);
        }

        return true;
    }

    // ===== PRIVATE METHODS =====

    // see: https://en.wikipedia.org/wiki/Audio_time_stretching_and_pitch_scaling
    _pitchScale(payload, factor) {
        let sample_bytes = 2*this._nchannels;
        let new_length = Math.ceil(payload.length/(factor*sample_bytes));
        const payload_view = new DataView(payload);

        let buffer = this._context.createBuffer(this._nchannels, new_length, this._sample_rate);
        for (let ch = 0; ch < this._nchannels; ch++) {
            const channel = buffer.getChannelData(ch);
            let channel_offset = ch*2;
            for (let i = 0; i < buffer.length; i++) {
                let pos_float = i*factor;
                let j = Math.trunc(pos_float);
                let second_weight = pos_float % 1;
                let first_weight = 1 - second_weight;
                let p = j*sample_bytes + channel_offset;
                let value0 = payload_view.getUint16(p, this._little_endian);
                p += sample_bytes;
                let value1 = value0;
                if (p < payload.length) {
                    value1 = payload_view.getUint16(p, this._little_endian);
                }
                let value = (value0*first_weight + value1*second_weight);
                channel[i] = (value - 32768) / 32768.0;
            }
        }
        return buffer;
    }

    _createBuffer(payload) {
        let sample_bytes = 2*this._nchannels;
        let buffer = this._context.createBuffer(
            this._nchannels, payload.length/sample_bytes, this._sample_rate);

        for (let ch = 0; ch < this._nchannels; ch++) {
            const channel = buffer.getChannelData(ch);
            let channel_offset = ch*2;
            for (let i = 0; i < buffer.length; i++) {
                let p = i*sample_bytes + channel_offset;
                let value = payload[p] + payload[p+1]*256;
                channel[i] = (value / 32768.0) - 1.0;
            }
        }
        return buffer;
    }
}
