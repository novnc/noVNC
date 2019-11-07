/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2019 The noVNC Authors
 * Licensed under MPL 2.0 or any later version (see LICENSE.txt)
 */

import * as Log from '../util/logging.js';
import { stopEvent } from '../util/events.js';
import * as KeyboardUtil from "./util.js";
import KeyTable from "./keysym.js";
import * as browser from "../util/browser.js";

//
// Keyboard event handler
//

export default class Keyboard {
    constructor(target) {
        this._target = target || null;

        this._keyDownList = {};         // List of depressed keys
                                        // (even if they are happy)
        this._pendingKey = null;        // Key waiting for keypress
        this._altGrArmed = false;       // Windows AltGr detection

        // keep these here so we can refer to them later
        this._eventHandlers = {
            'keyup': this._handleKeyUp.bind(this),
            'keydown': this._handleKeyDown.bind(this),
            'keypress': this._handleKeyPress.bind(this),
            'blur': this._allKeysUp.bind(this),
            'checkalt': this._checkAlt.bind(this),
        };

        // ===== EVENT HANDLERS =====

        this.onkeyevent = () => {}; // Handler for key press/release
    }

    // ===== PRIVATE METHODS =====

    _sendKeyEvent(keysym, code, down) {
        if (down) {
            this._keyDownList[code] = keysym;
        } else {
            // Do we really think this key is down?
            if (!(code in this._keyDownList)) {
                return;
            }
            delete this._keyDownList[code];
        }

        Log.Debug("onkeyevent " + (down ? "down" : "up") +
                  ", keysym: " + keysym, ", code: " + code);
        this.onkeyevent(keysym, code, down);
    }

    _getKeyCode(e) {
        const code = KeyboardUtil.getKeycode(e);
        if (code !== 'Unidentified') {
            return code;
        }

        // Unstable, but we don't have anything else to go on
        // (don't use it for 'keypress' events thought since
        // WebKit sets it to the same as charCode)
        if (e.keyCode && (e.type !== 'keypress')) {
            // 229 is used for composition events
            if (e.keyCode !== 229) {
                return 'Platform' + e.keyCode;
            }
        }

        // A precursor to the final DOM3 standard. Unfortunately it
        // is not layout independent, so it is as bad as using keyCode
        if (e.keyIdentifier) {
            // Non-character key?
            if (e.keyIdentifier.substr(0, 2) !== 'U+') {
                return e.keyIdentifier;
            }

            const codepoint = parseInt(e.keyIdentifier.substr(2), 16);
            const char = String.fromCharCode(codepoint).toUpperCase();

            return 'Platform' + char.charCodeAt();
        }

        return 'Unidentified';
    }

    _handleKeyDown(e) {
        const code = this._getKeyCode(e);
        let keysym = KeyboardUtil.getKeysym(e);

        // Windows doesn't have a proper AltGr, but handles it using
        // fake Ctrl+Alt. However the remote end might not be Windows,
        // so we need to merge those in to a single AltGr event. We
        // detect this case by seeing the two key events directly after
        // each other with a very short time between them (<50ms).
        if (this._altGrArmed) {
            this._altGrArmed = false;
            clearTimeout(this._altGrTimeout);

            if ((code === "AltRight") &&
                ((e.timeStamp - this._altGrCtrlTime) < 50)) {
                // FIXME: We fail to detect this if either Ctrl key is
                //        first manually pressed as Windows then no
                //        longer sends the fake Ctrl down event. It
                //        does however happily send real Ctrl events
                //        even when AltGr is already down. Some
                //        browsers detect this for us though and set the
                //        key to "AltGraph".
                keysym = KeyTable.XK_ISO_Level3_Shift;
            } else {
                this._sendKeyEvent(KeyTable.XK_Control_L, "ControlLeft", true);
            }
        }

        // We cannot handle keys we cannot track, but we also need
        // to deal with virtual keyboards which omit key info
        if (code === 'Unidentified') {
            if (keysym) {
                // If it's a virtual keyboard then it should be
                // sufficient to just send press and release right
                // after each other
                this._sendKeyEvent(keysym, code, true);
                this._sendKeyEvent(keysym, code, false);
            }

            stopEvent(e);
            return;
        }

        // Alt behaves more like AltGraph on macOS, so shuffle the
        // keys around a bit to make things more sane for the remote
        // server. This method is used by RealVNC and TigerVNC (and
        // possibly others).
        if (browser.isMac() || browser.isIOS()) {
            switch (keysym) {
                case KeyTable.XK_Super_L:
                    keysym = KeyTable.XK_Alt_L;
                    break;
                case KeyTable.XK_Super_R:
                    keysym = KeyTable.XK_Super_L;
                    break;
                case KeyTable.XK_Alt_L:
                    keysym = KeyTable.XK_Mode_switch;
                    break;
                case KeyTable.XK_Alt_R:
                    keysym = KeyTable.XK_ISO_Level3_Shift;
                    break;
            }
        }

        // Is this key already pressed? If so, then we must use the
        // same keysym or we'll confuse the server
        if (code in this._keyDownList) {
            keysym = this._keyDownList[code];
        }

        // macOS doesn't send proper key events for modifiers, only
        // state change events. That gets extra confusing for CapsLock
        // which toggles on each press, but not on release. So pretend
        // it was a quick press and release of the button.
        if ((browser.isMac() || browser.isIOS()) && (code === 'CapsLock')) {
            this._sendKeyEvent(KeyTable.XK_Caps_Lock, 'CapsLock', true);
            this._sendKeyEvent(KeyTable.XK_Caps_Lock, 'CapsLock', false);
            stopEvent(e);
            return;
        }

        // If this is a legacy browser then we'll need to wait for
        // a keypress event as well
        // (IE and Edge has a broken KeyboardEvent.key, so we can't
        // just check for the presence of that field)
        if (!keysym && (!e.key || browser.isIE() || browser.isEdge())) {
            this._pendingKey = code;
            // However we might not get a keypress event if the key
            // is non-printable, which needs some special fallback
            // handling
            setTimeout(this._handleKeyPressTimeout.bind(this), 10, e);
            return;
        }

        this._pendingKey = null;
        stopEvent(e);

        // Possible start of AltGr sequence? (see above)
        if ((code === "ControlLeft") && browser.isWindows() &&
            !("ControlLeft" in this._keyDownList)) {
            this._altGrArmed = true;
            this._altGrTimeout = setTimeout(this._handleAltGrTimeout.bind(this), 100);
            this._altGrCtrlTime = e.timeStamp;
            return;
        }

        this._sendKeyEvent(keysym, code, true);
    }

    // Legacy event for browsers without code/key
    _handleKeyPress(e) {
        stopEvent(e);

        // Are we expecting a keypress?
        if (this._pendingKey === null) {
            return;
        }

        let code = this._getKeyCode(e);
        const keysym = KeyboardUtil.getKeysym(e);

        // The key we were waiting for?
        if ((code !== 'Unidentified') && (code != this._pendingKey)) {
            return;
        }

        code = this._pendingKey;
        this._pendingKey = null;

        if (!keysym) {
            Log.Info('keypress with no keysym:', e);
            return;
        }

        this._sendKeyEvent(keysym, code, true);
    }

    _handleKeyPressTimeout(e) {
        // Did someone manage to sort out the key already?
        if (this._pendingKey === null) {
            return;
        }

        let keysym;

        const code = this._pendingKey;
        this._pendingKey = null;

        // We have no way of knowing the proper keysym with the
        // information given, but the following are true for most
        // layouts
        if ((e.keyCode >= 0x30) && (e.keyCode <= 0x39)) {
            // Digit
            keysym = e.keyCode;
        } else if ((e.keyCode >= 0x41) && (e.keyCode <= 0x5a)) {
            // Character (A-Z)
            let char = String.fromCharCode(e.keyCode);
            // A feeble attempt at the correct case
            if (e.shiftKey) {
                char = char.toUpperCase();
            } else {
                char = char.toLowerCase();
            }
            keysym = char.charCodeAt();
        } else {
            // Unknown, give up
            keysym = 0;
        }

        this._sendKeyEvent(keysym, code, true);
    }

    _handleKeyUp(e) {
        stopEvent(e);

        const code = this._getKeyCode(e);

        // We can't get a release in the middle of an AltGr sequence, so
        // abort that detection
        if (this._altGrArmed) {
            this._altGrArmed = false;
            clearTimeout(this._altGrTimeout);
            this._sendKeyEvent(KeyTable.XK_Control_L, "ControlLeft", true);
        }

        // See comment in _handleKeyDown()
        if ((browser.isMac() || browser.isIOS()) && (code === 'CapsLock')) {
            this._sendKeyEvent(KeyTable.XK_Caps_Lock, 'CapsLock', true);
            this._sendKeyEvent(KeyTable.XK_Caps_Lock, 'CapsLock', false);
            return;
        }

        this._sendKeyEvent(this._keyDownList[code], code, false);

        // Windows has a rather nasty bug where it won't send key
        // release events for a Shift button if the other Shift is still
        // pressed
        if (browser.isWindows() && ((code === 'ShiftLeft') ||
                                    (code === 'ShiftRight'))) {
            if ('ShiftRight' in this._keyDownList) {
                this._sendKeyEvent(this._keyDownList['ShiftRight'],
                                   'ShiftRight', false);
            }
            if ('ShiftLeft' in this._keyDownList) {
                this._sendKeyEvent(this._keyDownList['ShiftLeft'],
                                   'ShiftLeft', false);
            }
        }
    }

    _handleAltGrTimeout() {
        this._altGrArmed = false;
        clearTimeout(this._altGrTimeout);
        this._sendKeyEvent(KeyTable.XK_Control_L, "ControlLeft", true);
    }

    _allKeysUp() {
        Log.Debug(">> Keyboard.allKeysUp");
        for (let code in this._keyDownList) {
            this._sendKeyEvent(this._keyDownList[code], code, false);
        }
        Log.Debug("<< Keyboard.allKeysUp");
    }

    // Alt workaround for Firefox on Windows, see below
    _checkAlt(e) {
        if (e.skipCheckAlt) {
            return;
        }
        if (e.altKey) {
            return;
        }

        const target = this._target;
        const downList = this._keyDownList;
        ['AltLeft', 'AltRight'].forEach((code) => {
            if (!(code in downList)) {
                return;
            }

            const event = new KeyboardEvent('keyup',
                                            { key: downList[code],
                                              code: code });
            event.skipCheckAlt = true;
            target.dispatchEvent(event);
        });
    }

    // ===== PUBLIC METHODS =====

    grab() {
        //Log.Debug(">> Keyboard.grab");

        this._target.addEventListener('keydown', this._eventHandlers.keydown);
        this._target.addEventListener('keyup', this._eventHandlers.keyup);
        this._target.addEventListener('keypress', this._eventHandlers.keypress);

        // Release (key up) if window loses focus
        window.addEventListener('blur', this._eventHandlers.blur);

        // Firefox on Windows has broken handling of Alt, so we need to
        // poll as best we can for releases (still doesn't prevent the
        // menu from popping up though as we can't call
        // preventDefault())
        if (browser.isWindows() && browser.isFirefox()) {
            const handler = this._eventHandlers.checkalt;
            ['mousedown', 'mouseup', 'mousemove', 'wheel',
             'touchstart', 'touchend', 'touchmove',
             'keydown', 'keyup'].forEach(type =>
                document.addEventListener(type, handler,
                                          { capture: true,
                                            passive: true }));
        }

        //Log.Debug("<< Keyboard.grab");
    }

    ungrab() {
        //Log.Debug(">> Keyboard.ungrab");

        if (browser.isWindows() && browser.isFirefox()) {
            const handler = this._eventHandlers.checkalt;
            ['mousedown', 'mouseup', 'mousemove', 'wheel',
             'touchstart', 'touchend', 'touchmove',
             'keydown', 'keyup'].forEach(type => document.removeEventListener(type, handler));
        }

        this._target.removeEventListener('keydown', this._eventHandlers.keydown);
        this._target.removeEventListener('keyup', this._eventHandlers.keyup);
        this._target.removeEventListener('keypress', this._eventHandlers.keypress);
        window.removeEventListener('blur', this._eventHandlers.blur);

        // Release (key up) all keys that are in a down state
        this._allKeysUp();

        //Log.Debug(">> Keyboard.ungrab");
    }
}
