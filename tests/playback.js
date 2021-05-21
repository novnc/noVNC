/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2018 The noVNC Authors
 * Licensed under MPL 2.0 (see LICENSE.txt)
 */

import RFB from '../core/rfb.js';
import * as Log from '../core/util/logging.js';

// Immediate polyfill
if (window.setImmediate === undefined) {
    let _immediateIdCounter = 1;
    const _immediateFuncs = {};

    window.setImmediate = (func) => {
        const index = _immediateIdCounter++;
        _immediateFuncs[index] = func;
        window.postMessage("noVNC immediate trigger:" + index, "*");
        return index;
    };

    window.clearImmediate = (id) => {
        _immediateFuncs[id];
    };

    window.addEventListener("message", (event) => {
        if ((typeof event.data !== "string") ||
            (event.data.indexOf("noVNC immediate trigger:") !== 0)) {
            return;
        }

        const index = event.data.slice("noVNC immediate trigger:".length);

        const callback = _immediateFuncs[index];
        if (callback === undefined) {
            return;
        }

        delete _immediateFuncs[index];

        callback();
    });
}

export default class RecordingPlayer {
    constructor(frames, disconnected) {
        this._frames = frames;

        this._disconnected = disconnected;

        this._rfb = undefined;
        this._frame_length = this._frames.length;

        this._frame_index = 0;
        this._start_time = undefined;
        this._realtime = true;
        this._trafficManagement = true;

        this._running = false;

        this.onfinish = () => {};
    }

    run(realtime, trafficManagement) {
        // initialize a new RFB
        this._rfb = new RFB(document.getElementById('VNC_screen'), 'wss://test');
        this._rfb.viewOnly = true;
        this._rfb.addEventListener("disconnect",
                                   this._handleDisconnect.bind(this));
        this._rfb.addEventListener("credentialsrequired",
                                   this._handleCredentials.bind(this));
        this._enablePlaybackMode();

        // reset the frame index and timer
        this._frame_index = 0;
        this._start_time = (new Date()).getTime();

        this._realtime = realtime;
        this._trafficManagement = (trafficManagement === undefined) ? !realtime : trafficManagement;

        this._running = true;
    }

    // _enablePlaybackMode mocks out things not required for running playback
    _enablePlaybackMode() {
        const self = this;
        this._rfb._sock.send = () => {};
        this._rfb._sock.close = () => {};
        this._rfb._sock.flush = () => {};
        this._rfb._sock.open = function () {
            this.init();
            this._eventHandlers.open();
            self._queueNextPacket();
        };
    }

    _queueNextPacket() {
        if (!this._running) { return; }

        let frame = this._frames[this._frame_index];

        // skip send frames
        while (this._frame_index < this._frame_length && frame.fromClient) {
            this._frame_index++;
            frame = this._frames[this._frame_index];
        }

        if (this._frame_index >= this._frame_length) {
            Log.Debug('Finished, no more frames');
            this._finish();
            return;
        }

        if (this._realtime) {
            const toffset = (new Date()).getTime() - this._start_time;
            let delay = frame.timestamp - toffset;
            if (delay < 1) delay = 1;

            setTimeout(this._doPacket.bind(this), delay);
        } else {
            setImmediate(this._doPacket.bind(this));
        }
    }

    _doPacket() {
        // Avoid having excessive queue buildup in non-realtime mode
        if (this._trafficManagement && this._rfb._flushing) {
            const orig = this._rfb._display.onflush;
            this._rfb._display.onflush = () => {
                this._rfb._display.onflush = orig;
                this._rfb._onFlush();
                this._doPacket();
            };
            return;
        }

        const frame = this._frames[this._frame_index];

        this._rfb._sock._recv_message({'data': frame.data});
        this._frame_index++;

        this._queueNextPacket();
    }

    _finish() {
        if (this._rfb._display.pending()) {
            this._rfb._display.onflush = () => {
                if (this._rfb._flushing) {
                    this._rfb._onFlush();
                }
                this._finish();
            };
            this._rfb._display.flush();
        } else {
            this._running = false;
            this._rfb._sock._eventHandlers.close({code: 1000, reason: ""});
            delete this._rfb;
            this.onfinish((new Date()).getTime() - this._start_time);
        }
    }

    _handleDisconnect(evt) {
        this._running = false;
        this._disconnected(evt.detail.clean, this._frame_index);
    }

    _handleCredentials(evt) {
        this._rfb.sendCredentials({"username": "Foo",
                                   "password": "Bar",
                                   "target": "Baz"});
    }
}
