/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2024 The noVNC authors
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 *
 */

import * as Log from '../util/logging.js';

// Tolerate a couple of dropped frames before throttling: an occasional
// hiccup shouldn't slow down an otherwise-healthy stream.
const BACKOFF_DROP_THRESHOLD = 2;
const BACKOFF_BASE_DELAY_MS = 50;
const BACKOFF_MAX_DELAY_MS = 2000;

export class H264Parser {
    constructor(data) {
        this._data = data;
        this._index = 0;
        this.profileIdc = null;
        this.constraintSet = null;
        this.levelIdc = null;
    }

    _getStartSequenceLen(index) {
        let data = this._data;
        if (data[index + 0] == 0 && data[index + 1] == 0 && data[index + 2] == 0 && data[index + 3] == 1) {
            return 4;
        }
        if (data[index + 0] == 0 && data[index + 1] == 0 && data[index + 2] == 1) {
            return 3;
        }
        return 0;
    }

    _indexOfNextNalUnit(index) {
        let data = this._data;
        for (let i = index; i < data.length; ++i) {
            if (this._getStartSequenceLen(i) != 0) {
                return i;
            }
        }
        return -1;
    }

    _parseSps(index) {
        this.profileIdc = this._data[index];
        this.constraintSet = this._data[index + 1];
        this.levelIdc = this._data[index + 2];
    }

    _parseNalUnit(index) {
        const firstByte = this._data[index];
        if (firstByte & 0x80) {
            throw new Error('H264 parsing sanity check failed, forbidden zero bit is set');
        }
        const unitType = firstByte & 0x1f;

        switch (unitType) {
            case 1: // coded slice, non-idr
                return { slice: true };
            case 5: // coded slice, idr
                return { slice: true, key: true };
            case 6: // sei
                return {};
            case 7: // sps
                this._parseSps(index + 1);
                return {};
            case 8: // pps
                return {};
            default:
                Log.Warn("Unhandled unit type: ", unitType);
                break;
        }
        return {};
    }

    parse() {
        const startIndex = this._index;
        let isKey = false;

        while (this._index < this._data.length) {
            const startSequenceLen = this._getStartSequenceLen(this._index);
            if (startSequenceLen == 0) {
                throw new Error('Invalid start sequence in bit stream');
            }

            const { slice, key } = this._parseNalUnit(this._index + startSequenceLen);

            let nextIndex = this._indexOfNextNalUnit(this._index + startSequenceLen);
            if (nextIndex == -1) {
                this._index = this._data.length;
            } else {
                this._index = nextIndex;
            }

            if (key) {
                isKey = true;
            }
            if (slice) {
                break;
            }
        }

        if (startIndex === this._index) {
            return null;
        }

        return {
            frame: this._data.subarray(startIndex, this._index),
            key: isKey,
        };
    }
}

export class H264Context {
    constructor(width, height) {
        this.lastUsed = 0;
        this._width = width;
        this._height = height;
        this._profileIdc = null;
        this._constraintSet = null;
        this._levelIdc = null;
        this._decoder = null;
        this._pendingFrames = [];
        this._consecutiveDrops = 0;
    }

    // How long to hold off resolving a dropped frame's promise. The render
    // queue (display.js) already waits on this promise before letting rfb.js
    // read any more data from the server, so delaying it here throttles our
    // own FramebufferUpdateRequest rate whenever decoding keeps failing --
    // otherwise a stream that never successfully decodes turns into an
    // unthrottled request loop that starves every other client sharing the
    // same hardware encoder on the server.
    _backoffDelay() {
        if (this._consecutiveDrops <= BACKOFF_DROP_THRESHOLD) {
            return 0;
        }
        const exponent = this._consecutiveDrops - BACKOFF_DROP_THRESHOLD;
        return Math.min(BACKOFF_BASE_DELAY_MS * (2 ** exponent), BACKOFF_MAX_DELAY_MS);
    }

    _dropPending(pending) {
        this._consecutiveDrops++;
        pending.ready = true;

        const delay = this._backoffDelay();
        if (delay > 0) {
            Log.Warn("H264: " + this._consecutiveDrops +
                " consecutive dropped frames, backing off " + delay + "ms");
            setTimeout(() => pending.resolve(), delay);
        } else {
            pending.resolve();
        }
    }

    _handleFrame(frame) {
        let pending = this._pendingFrames.shift();
        if (pending === undefined) {
            this._consecutiveDrops++;
            Log.Warn("Pending frame queue empty when receiving frame from decoder, dropping frame");
            frame.close();
            return;
        }

        if (pending.timestamp != frame.timestamp) {
            // The queue is desynced from the decoder's output order. Drop
            // this frame rather than throwing: an uncaught throw here would
            // leave `pending` (and the render queue entry awaiting its
            // promise) stuck unresolved forever.
            Log.Warn("Video frame timestamp mismatch, dropping frame. Expected " +
                pending.timestamp + " but got " + frame.timestamp);
            frame.close();
            this._dropPending(pending);
            return;
        }

        this._consecutiveDrops = 0;
        pending.frame = frame;
        pending.ready = true;
        pending.resolve();

        if (!pending.keep) {
            frame.close();
        }
    }

    _handleError(e) {
        // The decoder aborts every in-flight decode() on error, so none of
        // them will ever reach _handleFrame(). Resolve them all now (as
        // dropped frames) instead of throwing, so nothing is left waiting
        // forever on a promise that will never resolve.
        Log.Warn("Failed to decode frame: " + e.message);
        while (this._pendingFrames.length > 0) {
            let pending = this._pendingFrames.shift();
            this._dropPending(pending);
        }
    }

    _configureDecoder(profileIdc, constraintSet, levelIdc) {
        if (this._decoder === null || this._decoder.state === 'closed') {
            this._decoder = new VideoDecoder({
                output: frame => this._handleFrame(frame),
                error: e => this._handleError(e),
            });
        }
        const codec = 'avc1.' +
            profileIdc.toString(16).padStart(2, '0') +
            constraintSet.toString(16).padStart(2, '0') +
            levelIdc.toString(16).padStart(2, '0');

        this._decoder.configure({
            codec: codec,
            codedWidth: this._width,
            codedHeight: this._height,
            optimizeForLatency: true,
            // Hardware decode sessions on this platform accept configure()
            // and decode() but silently never invoke output()/error() --
            // confirmed by isConfigSupported() reporting hardware as
            // supported while frames never resolved. Software decode is the
            // only path that actually delivers frames.
            hardwareAcceleration: 'prefer-software',
            // The stream is Annex-B (start-code delimited NAL units, see
            // H264Parser above) -- without this, VideoDecoderConfig defaults
            // to AVCC (length-prefixed) framing.
            avc: { format: 'annexb' },
        });
    }

    _preparePendingFrame(timestamp) {
        let pending = {
            timestamp: timestamp,
            promise: null,
            resolve: null,
            frame: null,
            ready: false,
            keep: false,
        };
        pending.promise = new Promise((resolve) => {
            pending.resolve = resolve;
        });
        this._pendingFrames.push(pending);

        return pending;
    }

    decode(payload) {
        let parser = new H264Parser(payload);
        let result = null;

        // Ideally, this timestamp should come from the server, but we'll just
        // approximate it instead.
        let timestamp = Math.round(window.performance.now() * 1e3);

        while (true) {
            let encodedFrame = parser.parse();
            if (encodedFrame === null) {
                break;
            }

            if (parser.profileIdc !== null) {
                this._profileIdc = parser.profileIdc;
                this._constraintSet = parser.constraintSet;
                this._levelIdc = parser.levelIdc;
            }

            if (this._decoder === null || this._decoder.state !== 'configured') {
                if (!encodedFrame.key) {
                    Log.Warn("Missing key frame. Can't decode until one arrives");
                    continue;
                }
                if (this._profileIdc === null) {
                    Log.Warn('Cannot config decoder. Have not received SPS and PPS yet.');
                    continue;
                }
                this._configureDecoder(this._profileIdc, this._constraintSet,
                                       this._levelIdc);
            }

            result = this._preparePendingFrame(timestamp);

            const chunk = new EncodedVideoChunk({
                timestamp: timestamp,
                type: encodedFrame.key ? 'key' : 'delta',
                data: encodedFrame.frame,
            });

            try {
                this._decoder.decode(chunk);
            } catch (e) {
                // decode() rejected the chunk synchronously -- it will never
                // reach the decoder's output/error callback, so the pending
                // frame just queued above would otherwise sit unresolved
                // forever, permanently blocking the render queue (and this
                // connection's FramebufferUpdateRequest loop) behind it.
                Log.Warn("Failed to decode:", e);
                this._pendingFrames.pop();
                this._dropPending(result);
            }
        }

        // We only keep last frame of each payload
        if (result !== null) {
            result.keep = true;
        }

        return result;
    }
}

export default class H264Decoder {
    constructor() {
        this._tick = 0;
        this._contexts = {};
    }

    _contextId(x, y, width, height) {
        return [x, y, width, height].join(',');
    }

    _findOldestContextId() {
        let oldestTick = Number.MAX_VALUE;
        let oldestKey = undefined;
        for (const [key, value] of Object.entries(this._contexts)) {
            if (value.lastUsed < oldestTick) {
                oldestTick = value.lastUsed;
                oldestKey = key;
            }
        }
        return oldestKey;
    }

    _createContext(x, y, width, height) {
        const maxContexts = 64;
        if (Object.keys(this._contexts).length >= maxContexts) {
            let oldestContextId = this._findOldestContextId();
            delete this._contexts[oldestContextId];
        }
        let context = new H264Context(width, height);
        this._contexts[this._contextId(x, y, width, height)] = context;
        return context;
    }

    _getContext(x, y, width, height) {
        let context = this._contexts[this._contextId(x, y, width, height)];
        return context !== undefined ? context : this._createContext(x, y, width, height);
    }

    _resetContext(x, y, width, height) {
        delete this._contexts[this._contextId(x, y, width, height)];
    }

    _resetAllContexts() {
        this._contexts = {};
    }

    decodeRect(x, y, width, height, sock, display, depth) {
        const resetContextFlag = 1;
        const resetAllContextsFlag = 2;

        if (sock.rQwait("h264 header", 8)) {
            return false;
        }

        const length = sock.rQshift32();
        const flags = sock.rQshift32();

        if (sock.rQwait("h264 payload", length, 8)) {
            return false;
        }

        if (flags & resetAllContextsFlag) {
            this._resetAllContexts();
        } else if (flags & resetContextFlag) {
            this._resetContext(x, y, width, height);
        }

        let context = this._getContext(x, y, width, height);
        context.lastUsed = this._tick++;

        if (length !== 0) {
            let payload = sock.rQshiftBytes(length, false);
            let frame = context.decode(payload);
            if (frame !== null) {
                display.videoFrame(x, y, width, height, frame);
            }
        }

        return true;
    }
}
