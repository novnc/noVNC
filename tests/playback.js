/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2018 The noVNC authors
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

        this._running = false;

        this.onfinish = () => {};
        this.onclientevent = () => {};  // Callback for client events

        this._lastButtonMask = 0;  // Track previous button state for down/up detection
    }

    // Decode client-to-server RFB message
    _decodeClientMessage(data) {
        if (data.length < 1) return null;

        const msgType = data[0];

        switch (msgType) {
            case 0: // SetPixelFormat
                return { type: 'SetPixelFormat' };

            case 2: // SetEncodings
                if (data.length >= 4) {
                    const numEncodings = (data[2] << 8) | data[3];
                    return { type: 'SetEncodings', count: numEncodings };
                }
                return { type: 'SetEncodings' };

            case 3: // FramebufferUpdateRequest
                if (data.length >= 10) {
                    const incremental = data[1];
                    const x = (data[2] << 8) | data[3];
                    const y = (data[4] << 8) | data[5];
                    const width = (data[6] << 8) | data[7];
                    const height = (data[8] << 8) | data[9];
                    return {
                        type: 'FramebufferUpdateRequest',
                        incremental: incremental === 1,
                        x, y, width, height
                    };
                }
                return { type: 'FramebufferUpdateRequest' };

            case 4: // KeyEvent
                if (data.length >= 8) {
                    const down = data[1] === 1;
                    const keysym = (data[4] << 24) | (data[5] << 16) | (data[6] << 8) | data[7];
                    // Try to convert keysym to character
                    let keyName = '0x' + keysym.toString(16);
                    if (keysym >= 0x20 && keysym <= 0x7e) {
                        keyName = String.fromCharCode(keysym);
                    } else if (keysym >= 0xff00) {
                        // Special keys
                        const specialKeys = {
                            0xff08: 'BackSpace', 0xff09: 'Tab', 0xff0d: 'Return',
                            0xff1b: 'Escape', 0xff50: 'Home', 0xff51: 'Left',
                            0xff52: 'Up', 0xff53: 'Right', 0xff54: 'Down',
                            0xff55: 'PageUp', 0xff56: 'PageDown', 0xff57: 'End',
                            0xff63: 'Insert', 0xffff: 'Delete',
                            0xffe1: 'Shift_L', 0xffe2: 'Shift_R',
                            0xffe3: 'Control_L', 0xffe4: 'Control_R',
                            0xffe9: 'Alt_L', 0xffea: 'Alt_R',
                            0xffeb: 'Super_L', 0xffec: 'Super_R',
                        };
                        keyName = specialKeys[keysym] || keyName;
                    }
                    return { type: 'KeyEvent', down, keysym, keyName };
                }
                return { type: 'KeyEvent' };

            case 5: // PointerEvent
                if (data.length >= 6) {
                    const buttonMask = data[1];
                    const x = (data[2] << 8) | data[3];
                    const y = (data[4] << 8) | data[5];

                    // Detect button changes by comparing with previous state
                    const prevMask = this._lastButtonMask;
                    const pressed = buttonMask & ~prevMask;  // Bits that are now 1 but were 0
                    const released = prevMask & ~buttonMask; // Bits that are now 0 but were 1
                    this._lastButtonMask = buttonMask;

                    const events = [];
                    // Check each button for down/up
                    const buttonNames = ['left', 'middle', 'right', 'scrollUp', 'scrollDown'];
                    for (let i = 0; i < 5; i++) {
                        const bit = 1 << i;
                        if (pressed & bit) {
                            events.push({ button: buttonNames[i], action: 'down' });
                        }
                        if (released & bit) {
                            events.push({ button: buttonNames[i], action: 'up' });
                        }
                    }

                    return {
                        type: 'PointerEvent',
                        x, y,
                        buttonMask,
                        events: events,  // Array of {button, action} for changes
                        isMove: events.length === 0
                    };
                }
                return { type: 'PointerEvent' };

            case 6: // ClientCutText
                if (data.length >= 8) {
                    const length = (data[4] << 24) | (data[5] << 16) | (data[6] << 8) | data[7];
                    let text = '';
                    for (let i = 8; i < Math.min(8 + length, data.length); i++) {
                        text += String.fromCharCode(data[i]);
                    }
                    return { type: 'ClientCutText', text: text.substring(0, 50) + (length > 50 ? '...' : '') };
                }
                return { type: 'ClientCutText' };

            default:
                return { type: 'Unknown', msgType };
        }
    }

    run(realtime, trafficManagement) {
        // initialize a new RFB
        this._ws = new FakeWebSocket();
        this._rfb = new RFB(document.getElementById('VNC_screen'), this._ws);
        this._rfb.viewOnly = true;
        this._rfb.addEventListener("disconnect",
                                   this._handleDisconnect.bind(this));
        this._rfb.addEventListener("credentialsrequired",
                                   this._handleCredentials.bind(this));

        // reset the frame index and timer
        this._frameIndex = 0;
        this._startTime = (new Date()).getTime();

        this._realtime = realtime;
        this._trafficManagement = (trafficManagement === undefined) ? !realtime : trafficManagement;

        this._running = true;
        this._queueNextPacket();
    }

    _queueNextPacket() {
        if (!this._running) { return; }

        let frame = this._frames[this._frameIndex];

        // Process and report client frames, then skip them
        while (this._frameIndex < this._frameLength && frame.fromClient) {
            // Decode and report the client event
            const decoded = this._decodeClientMessage(frame.data);
            if (decoded) {
                this.onclientevent(frame.timestamp, decoded);
            }
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
        } else {
            setImmediate(this._doPacket.bind(this));
        }
    }

    _doPacket() {
        // Avoid having excessive queue buildup in non-realtime mode
        if (this._trafficManagement && this._rfb._flushing) {
            this._rfb.flush()
                .then(() => {
                    this._doPacket();
                });
            return;
        }

        const frame = this._frames[this._frameIndex];

        this._ws.onmessage({'data': frame.data});
        this._frameIndex++;

        this._queueNextPacket();
    }

    _finish() {
        if (this._rfb._display.pending()) {
            this._rfb._display.flush()
                .then(() => { this._finish(); });
        } else {
            this._running = false;
            this._ws.onclose({code: 1000, reason: ""});
            delete this._rfb;
            this.onfinish((new Date()).getTime() - this._startTime);
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
