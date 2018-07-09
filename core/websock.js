/*
 * Websock: high-performance binary WebSockets
 * Copyright (C) 2012 Joel Martin
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * Websock is similar to the standard WebSocket object but with extra
 * buffer handling.
 *
 * Websock has built-in receive queue buffering; the message event
 * does not contain actual data but is simply a notification that
 * there is new data available. Several rQ* methods are available to
 * read binary data off of the receive queue.
 */

import * as Log from './util/logging.js';

// this has performance issues in some versions Chromium, and
// doesn't gain a tremendous amount of performance increase in Firefox
// at the moment.  It may be valuable to turn it on in the future.
const ENABLE_COPYWITHIN = false;
const MAX_RQ_GROW_SIZE = 40 * 1024 * 1024;  // 40 MiB

export default class Websock {
    constructor() {
        this._websocket = null;  // WebSocket object

        this._rQi = 0;           // Receive queue index
        this._rQlen = 0;         // Next write position in the receive queue
        this._rQbufferSize = 1024 * 1024 * 4; // Receive queue buffer size (4 MiB)
        this._rQmax = this._rQbufferSize / 8;
        // called in init: this._rQ = new Uint8Array(this._rQbufferSize);
        this._rQ = null; // Receive queue

        this._sQbufferSize = 1024 * 10;  // 10 KiB
        // called in init: this._sQ = new Uint8Array(this._sQbufferSize);
        this._sQlen = 0;
        this._sQ = null;  // Send queue

        this._eventHandlers = {
            message: () => {},
            open: () => {},
            close: () => {},
            error: () => {}
        };
    }

    // Getters and Setters
    get_sQ() {
        return this._sQ;
    }

    get_rQ() {
        return this._rQ;
    }

    get_rQi() {
        return this._rQi;
    }

    set_rQi(val) {
        this._rQi = val;
    }

    // Receive Queue
    rQlen() {
        return this._rQlen - this._rQi;
    }

    rQpeek8() {
        return this._rQ[this._rQi];
    }

    rQshift8() {
        return this._rQ[this._rQi++];
    }

    rQskip8() {
        this._rQi++;
    }

    rQskipBytes(num) {
        this._rQi += num;
    }

    // TODO(directxman12): test performance with these vs a DataView
    rQshift16() {
        return (this._rQ[this._rQi++] << 8) +
               this._rQ[this._rQi++];
    }

    rQshift32() {
        return (this._rQ[this._rQi++] << 24) +
               (this._rQ[this._rQi++] << 16) +
               (this._rQ[this._rQi++] << 8) +
               this._rQ[this._rQi++];
    }

    rQshiftStr(len) {
        if (typeof(len) === 'undefined') { len = this.rQlen(); }
        let str = "";
        // Handle large arrays in steps to avoid long strings on the stack
        for (let i = 0; i < len; i += 4096) {
            let part = this.rQshiftBytes(Math.min(4096, len - i));
            str += String.fromCharCode.apply(null, part);
        }
        return str;
    }

    rQshiftBytes(len) {
        if (typeof(len) === 'undefined') { len = this.rQlen(); }
        this._rQi += len;
        return new Uint8Array(this._rQ.buffer, this._rQi - len, len);
    }

    rQshiftTo(target, len) {
        if (len === undefined) { len = this.rQlen(); }
        // TODO: make this just use set with views when using a ArrayBuffer to store the rQ
        target.set(new Uint8Array(this._rQ.buffer, this._rQi, len));
        this._rQi += len;
    }

    rQwhole() {
        return new Uint8Array(this._rQ.buffer, 0, this._rQlen);
    }

    rQslice(start, end) {
        if (end) {
            return new Uint8Array(this._rQ.buffer, this._rQi + start, end - start);
        } else {
            return new Uint8Array(this._rQ.buffer, this._rQi + start, this._rQlen - this._rQi - start);
        }
    }

    // Check to see if we must wait for 'num' bytes (default to FBU.bytes)
    // to be available in the receive queue. Return true if we need to
    // wait (and possibly print a debug message), otherwise false.
    rQwait(msg, num, goback) {
        const rQlen = this._rQlen - this._rQi; // Skip rQlen() function call
        if (rQlen < num) {
            if (goback) {
                if (this._rQi < goback) {
                    throw new Error("rQwait cannot backup " + goback + " bytes");
                }
                this._rQi -= goback;
            }
            return true; // true means need more data
        }
        return false;
    }

    // Send Queue

    flush() {
        if (this._sQlen > 0 && this._websocket.readyState === WebSocket.OPEN) {
            this._websocket.send(this._encode_message());
            this._sQlen = 0;
        }
    }

    send(arr) {
        this._sQ.set(arr, this._sQlen);
        this._sQlen += arr.length;
        this.flush();
    }

    send_string(str) {
        this.send(str.split('').map(chr => chr.charCodeAt(0)));
    }

    // Event Handlers
    off(evt) {
        this._eventHandlers[evt] = () => {};
    }

    on(evt, handler) {
        this._eventHandlers[evt] = handler;
    }

    _allocate_buffers() {
        this._rQ = new Uint8Array(this._rQbufferSize);
        this._sQ = new Uint8Array(this._sQbufferSize);
    }

    init() {
        this._allocate_buffers();
        this._rQi = 0;
        this._websocket = null;
    }

    open(uri, protocols) {
        this.init();

        this._websocket = new WebSocket(uri, protocols);
        this._websocket.binaryType = 'arraybuffer';

        this._websocket.onmessage = this._recv_message.bind(this);
        this._websocket.onopen = () => {
            Log.Debug('>> WebSock.onopen');
            if (this._websocket.protocol) {
                Log.Info("Server choose sub-protocol: " + this._websocket.protocol);
            }

            this._eventHandlers.open();
            Log.Debug("<< WebSock.onopen");
        };
        this._websocket.onclose = (e) => {
            Log.Debug(">> WebSock.onclose");
            this._eventHandlers.close(e);
            Log.Debug("<< WebSock.onclose");
        };
        this._websocket.onerror = (e) => {
            Log.Debug(">> WebSock.onerror: " + e);
            this._eventHandlers.error(e);
            Log.Debug("<< WebSock.onerror: " + e);
        };
    }

    close() {
        if (this._websocket) {
            if ((this._websocket.readyState === WebSocket.OPEN) ||
                    (this._websocket.readyState === WebSocket.CONNECTING)) {
                Log.Info("Closing WebSocket connection");
                this._websocket.close();
            }

            this._websocket.onmessage = () => {};
        }
    }

    // private methods
    _encode_message() {
        // Put in a binary arraybuffer
        // according to the spec, you can send ArrayBufferViews with the send method
        return new Uint8Array(this._sQ.buffer, 0, this._sQlen);
    }

    _expand_compact_rQ(min_fit) {
        const resizeNeeded = min_fit || this._rQlen - this._rQi > this._rQbufferSize / 2;
        if (resizeNeeded) {
            if (!min_fit) {
                // just double the size if we need to do compaction
                this._rQbufferSize *= 2;
            } else {
                // otherwise, make sure we satisy rQlen - rQi + min_fit < rQbufferSize / 8
                this._rQbufferSize = (this._rQlen - this._rQi + min_fit) * 8;
            }
        }

        // we don't want to grow unboundedly
        if (this._rQbufferSize > MAX_RQ_GROW_SIZE) {
            this._rQbufferSize = MAX_RQ_GROW_SIZE;
            if (this._rQbufferSize - this._rQlen - this._rQi < min_fit) {
                throw new Error("Receive Queue buffer exceeded " + MAX_RQ_GROW_SIZE + " bytes, and the new message could not fit");
            }
        }

        if (resizeNeeded) {
            const old_rQbuffer = this._rQ.buffer;
            this._rQmax = this._rQbufferSize / 8;
            this._rQ = new Uint8Array(this._rQbufferSize);
            this._rQ.set(new Uint8Array(old_rQbuffer, this._rQi));
        } else {
            if (ENABLE_COPYWITHIN) {
                this._rQ.copyWithin(0, this._rQi);
            } else {
                this._rQ.set(new Uint8Array(this._rQ.buffer, this._rQi));
            }
        }

        this._rQlen = this._rQlen - this._rQi;
        this._rQi = 0;
    }

    _decode_message(data) {
        // push arraybuffer values onto the end
        const u8 = new Uint8Array(data);
        if (u8.length > this._rQbufferSize - this._rQlen) {
            this._expand_compact_rQ(u8.length);
        }
        this._rQ.set(u8, this._rQlen);
        this._rQlen += u8.length;
    }

    _recv_message(e) {
        this._decode_message(e.data);
        if (this.rQlen() > 0) {
            this._eventHandlers.message();
            // Compact the receive queue
            if (this._rQlen == this._rQi) {
                this._rQlen = 0;
                this._rQi = 0;
            } else if (this._rQlen > this._rQmax) {
                this._expand_compact_rQ();
            }
        } else {
            Log.Debug("Ignoring empty message");
        }
    }
}
