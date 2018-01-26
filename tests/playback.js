/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2012 Joel Martin
 * Licensed under MPL 2.0 (see LICENSE.txt)
 */

import RFB from '../core/rfb.js';
import * as Log from '../core/util/logging.js';
import Base64 from '../core/base64.js';

// Immediate polyfill
if (setImmediate === undefined) {
    var _immediateIdCounter = 1;
    var _immediateFuncs = {};

    var setImmediate = function (func) {
        var index = _immediateIdCounter++;
        _immediateFuncs[index] = func;
        window.postMessage("noVNC immediate trigger:" + index, "*");
        return index;
    };

    window.clearImmediate = function (id) {
        _immediateFuncs[id];
    };

    var _onMessage = function (event) {
        if ((typeof event.data !== "string") ||
            (event.data.indexOf("noVNC immediate trigger:") !== 0)) {
            return;
        }

        var index = event.data.slice("noVNC immediate trigger:".length);

        var callback = _immediateFuncs[index];
        if (callback === undefined) {
            return;
        }

        delete _immediateFuncs[index];

        callback();
    };
    window.addEventListener("message", _onMessage);
}

export default function RecordingPlayer (frames, encoding, disconnected) {
    this._frames = frames;
    this._encoding = encoding;

    this._disconnected = disconnected;

    if (this._encoding === undefined) {
        let frame = this._frames[0];
        let start = frame.indexOf('{', 1) + 1;
        if (frame.slice(start).startsWith('UkZC')) {
            this._encoding = 'base64';
        } else {
            this._encoding = 'binary';
        }
    }

    this._rfb = undefined;
    this._frame_length = this._frames.length;

    this._frame_index = 0;
    this._start_time = undefined;
    this._realtime = true;
    this._trafficManagement = true;

    this._running = false;

    this.onfinish = function () {};
}

RecordingPlayer.prototype = {
    run: function (realtime, trafficManagement) {
        // initialize a new RFB
        this._rfb = new RFB(document.getElementById('VNC_screen'), 'wss://test');
        this._rfb.viewOnly = true;
        this._rfb.addEventListener("disconnect",
                                   this._handleDisconnect.bind(this));
        this._enablePlaybackMode();

        // reset the frame index and timer
        this._frame_index = 0;
        this._start_time = (new Date()).getTime();

        this._realtime = realtime;
        this._trafficManagement = (trafficManagement === undefined) ? !realtime : trafficManagement;

        this._running = true;

        this._queueNextPacket();
    },

    // _enablePlaybackMode mocks out things not required for running playback
    _enablePlaybackMode: function () {
        this._rfb._sock.send = function (arr) {};
        this._rfb._sock.close = function () {};
        this._rfb._sock.flush = function () {};
        this._rfb._sock.open = function () {
            this.init();
            this._eventHandlers.open();
        };
    },

    _queueNextPacket: function () {
        if (!this._running) { return; }

        var frame = this._frames[this._frame_index];

        // skip send frames
        while (this._frame_index < this._frame_length && frame.charAt(0) === "}") {
            this._frame_index++;
            frame = this._frames[this._frame_index];
        }

        if (frame === 'EOF') {
            Log.Debug('Finished, found EOF');
            this._finish();
            return;
        }

        if (this._frame_index >= this._frame_length) {
            Log.Debug('Finished, no more frames');
            this._finish();
            return;
        }

        if (this._realtime) {
            let foffset = frame.slice(1, frame.indexOf('{', 1));
            let toffset = (new Date()).getTime() - this._start_time;
            let delay = foffset - toffset;
            if (delay < 1) delay = 1;

            setTimeout(this._doPacket.bind(this), delay);
        } else {
            setImmediate(this._doPacket.bind(this));
        }
    },

    _doPacket: function () {
        // Avoid having excessive queue buildup in non-realtime mode
        if (this._trafficManagement && this._rfb._flushing) {
            let player = this;
            let orig = this._rfb._display.onflush;
            this._rfb._display.onflush = function () {
                player._rfb._display.onflush = orig;
                player._rfb._onFlush();
                player._doPacket();
            };
            return;
        }

        const frame = this._frames[this._frame_index];
        var start = frame.indexOf('{', 1) + 1;
        if (this._encoding === 'base64') {
            var u8 = Base64.decode(frame.slice(start));
            start = 0;
        } else {
            var u8 = new Uint8Array(frame.length - start);
            for (let i = 0; i < frame.length - start; i++) {
                u8[i] = frame.charCodeAt(start + i);
            }
        }

        this._rfb._sock._recv_message({'data': u8});
        this._frame_index++;

        this._queueNextPacket();
    },

    _finish() {
        if (this._rfb._display.pending()) {
            var player = this;
            this._rfb._display.onflush = function () {
                if (player._rfb._flushing) {
                    player._rfb._onFlush();
                }
                player._finish();
            };
            this._rfb._display.flush();
        } else {
            this._running = false;
            this._rfb._sock._eventHandlers.close({code: 1000, reason: ""});
            delete this._rfb;
            this.onfinish((new Date()).getTime() - this._start_time);
        }
    },

    _handleDisconnect(evt) {
        this._running = false;
        this._disconnected(evt.detail.clean, this._frame_index);
    }
};
