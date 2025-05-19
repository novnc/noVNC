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

class FakeWebSocket {
    constructor() {
        this.binaryType = "arraybuffer";
        this.protocol = "";
        this.readyState = "open";

        this.onerror = () => {};
        this.onmessage = () => {};
        this.onopen = () => {};
    }

    send() {
    }

    close() {
    }
}

export default class RecordingPlayer {
    constructor(frames, disconnected) {
        this._frames = frames;

        this._disconnected = disconnected;

        this._rfb = undefined;
        this._frameLength = this._frames.length;

        this._frameIndex = 0;
        this._startTime = undefined;
        this._realtime = true;
        this._trafficManagement = true;
        this._frameTimeLimit = 0;

        this._running = false;

        this.onfinish = () => {};

        this._lastFrameTime = null;
    }

    run(realtime, trafficManagement, targetFramerate, threaded_decoding) {
        // initialize a new RFB
        this._ws = new FakeWebSocket();
        this._rfb = new RFB(document.getElementById('VNC_screen'), document.getElementById('noVNC_keyboardinput'), this._ws);
        this._rfb.viewOnly = true;
        this._rfb.addEventListener("disconnect",
                                   this._handleDisconnect.bind(this));
        this._rfb.addEventListener("credentialsrequired",
                                   this._handleCredentials.bind(this));
        this._rfb.threading = threaded_decoding;
        
        //clear the stats counter function so that we get totals at the end
        clearInterval(this._rfb._display._frameStatsInterval);

        // reset the frame index and timer
        this._frameIndex = 0;
        this._startTime = (new Date()).getTime();

        this._realtime = realtime;
        this._trafficManagement = (trafficManagement === undefined) ? !realtime : trafficManagement;
        this._frameTimeLimit = (targetFramerate > 0) ? 1000 / targetFramerate : 0;

        this._running = true;
        this._queueNextPacket();
    }

    _queueNextPacket() {
        if (!this._running) { return; }

        let frame = this._frames[this._frameIndex];

        // skip send frames
        while (this._frameIndex < this._frameLength && frame.fromClient) {
            this._frameIndex++;
            frame = this._frames[this._frameIndex];
        }

        if (this._frameIndex >= this._frameLength) {
            Log.Debug('Finished, no more frames');
            this._finish();
            return;
        }

        if (this._realtime) {
            const toffset = (new Date()).getTime() - this._startTime;
            let delay = frame.timestamp - toffset;
            if (delay < 1) delay = 1;

            setTimeout(this._doPacket.bind(this), delay);
        }
        else if (this._frameTimeLimit > 0 && this._lastFrameTime !== null) {
            const now = performance.now()
            const frameDelay = this._frameTimeLimit - (now - this._lastFrameTime)
            if (frameDelay > 0) {
                setTimeout(this._doPacket.bind(this), frameDelay)
            } else {
                setImmediate(this._doPacket.bind(this));
            }
            this._lastFrameTime = now
        } else {
            if (this._frameTimeLimit) {
                this._lastFrameTime = performance.now()
            }
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

        const frame = this._frames[this._frameIndex];

        this._ws.onmessage({'data': frame.data});
        this._frameIndex++;

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
            this._ws.onclose({code: 1000, reason: ""});
            let droppedFrames = this._rfb._display._droppedFrames;
            let droppedRects = this._rfb._display._droppedRects;
            let numFrames = this._rfb._display._flipCnt;
            delete this._rfb;
            this.onfinish((new Date()).getTime() - this._startTime, droppedFrames, droppedRects, numFrames);
        }
    }

    _handleDisconnect(evt) {
        this._running = false;
        this._disconnected(evt.detail.clean, this._frameIndex);
    }

    _handleCredentials(evt) {
        this._rfb.sendCredentials({"username": "Foo",
                                   "password": "Bar",
                                   "target": "Baz"});
    }
}
