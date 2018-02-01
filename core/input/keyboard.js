/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2012 Joel Martin
 * Copyright (C) 2013 Samuel Mannehed for Cendio AB
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

export default function Keyboard(target) {
    this._target = target || null;

    this._keyDownList = {};         // List of depressed keys
                                    // (even if they are happy)
    this._pendingKey = null;        // Key waiting for keypress

    // keep these here so we can refer to them later
    this._eventHandlers = {
        'keyup': this._handleKeyUp.bind(this),
        'keydown': this._handleKeyDown.bind(this),
        'keypress': this._handleKeyPress.bind(this),
        'blur': this._allKeysUp.bind(this)
    };
};

Keyboard.prototype = {
    // ===== EVENT HANDLERS =====

    onkeyevent: function () {},     // Handler for key press/release

    // ===== PRIVATE METHODS =====

    _sendKeyEvent: function (keysym, code, down) {
        Log.Debug("onkeyevent " + (down ? "down" : "up") +
                  ", keysym: " + keysym, ", code: " + code);

        // Windows sends CtrlLeft+AltRight when you press
        // AltGraph, which tends to confuse the hell out of
        // remote systems. Fake a release of these keys until
        // there is a way to detect AltGraph properly.
        var fakeAltGraph = false;
        if (down && browser.isWindows()) {
            if ((code !== 'ControlLeft') &&
                (code !== 'AltRight') &&
                ('ControlLeft' in this._keyDownList) &&
                ('AltRight' in this._keyDownList)) {
                fakeAltGraph = true;
                this.onkeyevent(this._keyDownList['AltRight'],
                                 'AltRight', false);
                this.onkeyevent(this._keyDownList['ControlLeft'],
                                 'ControlLeft', false);
            }
        }

        this.onkeyevent(keysym, code, down);

        if (fakeAltGraph) {
            this.onkeyevent(this._keyDownList['ControlLeft'],
                             'ControlLeft', true);
            this.onkeyevent(this._keyDownList['AltRight'],
                             'AltRight', true);
        }
    },

    _getKeyCode: function (e) {
        var code = KeyboardUtil.getKeycode(e);
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

            var codepoint = parseInt(e.keyIdentifier.substr(2), 16);
            var char = String.fromCharCode(codepoint);
            // Some implementations fail to uppercase the symbols
            char = char.toUpperCase();

            return 'Platform' + char.charCodeAt();
        }

        return 'Unidentified';
    },

    _handleKeyDown: function (e) {
        var code = this._getKeyCode(e);
        var keysym = KeyboardUtil.getKeysym(e);

        // We cannot handle keys we cannot track, but we also need
        // to deal with virtual keyboards which omit key info
        // (iOS omits tracking info on keyup events, which forces us to
        // special treat that platform here)
        if ((code === 'Unidentified') || browser.isIOS()) {
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
        if (browser.isMac()) {
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
        if (browser.isMac() && (code === 'CapsLock')) {
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

        this._keyDownList[code] = keysym;

        this._sendKeyEvent(keysym, code, true);
    },

    // Legacy event for browsers without code/key
    _handleKeyPress: function (e) {
        stopEvent(e);

        // Are we expecting a keypress?
        if (this._pendingKey === null) {
            return;
        }

        var code = this._getKeyCode(e);
        var keysym = KeyboardUtil.getKeysym(e);

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

        this._keyDownList[code] = keysym;

        this._sendKeyEvent(keysym, code, true);
    },
    _handleKeyPressTimeout: function (e) {
        // Did someone manage to sort out the key already?
        if (this._pendingKey === null) {
            return;
        }

        var code, keysym;

        code = this._pendingKey;
        this._pendingKey = null;

        // We have no way of knowing the proper keysym with the
        // information given, but the following are true for most
        // layouts
        if ((e.keyCode >= 0x30) && (e.keyCode <= 0x39)) {
            // Digit
            keysym = e.keyCode;
        } else if ((e.keyCode >= 0x41) && (e.keyCode <= 0x5a)) {
            // Character (A-Z)
            var char = String.fromCharCode(e.keyCode);
            // A feeble attempt at the correct case
            if (e.shiftKey)
                char = char.toUpperCase();
            else
                char = char.toLowerCase();
            keysym = char.charCodeAt();
        } else {
            // Unknown, give up
            keysym = 0;
        }

        this._keyDownList[code] = keysym;

        this._sendKeyEvent(keysym, code, true);
    },

    _handleKeyUp: function (e) {
        stopEvent(e);

        var code = this._getKeyCode(e);

        // See comment in _handleKeyDown()
        if (browser.isMac() && (code === 'CapsLock')) {
            this._sendKeyEvent(KeyTable.XK_Caps_Lock, 'CapsLock', true);
            this._sendKeyEvent(KeyTable.XK_Caps_Lock, 'CapsLock', false);
            return;
        }

        // Do we really think this key is down?
        if (!(code in this._keyDownList)) {
            return;
        }

        this._sendKeyEvent(this._keyDownList[code], code, false);

        delete this._keyDownList[code];
    },

    _allKeysUp: function () {
        Log.Debug(">> Keyboard.allKeysUp");
        for (var code in this._keyDownList) {
            this._sendKeyEvent(this._keyDownList[code], code, false);
        };
        this._keyDownList = {};
        Log.Debug("<< Keyboard.allKeysUp");
    },

    // ===== PUBLIC METHODS =====

    grab: function () {
        //Log.Debug(">> Keyboard.grab");
        var c = this._target;

        c.addEventListener('keydown', this._eventHandlers.keydown);
        c.addEventListener('keyup', this._eventHandlers.keyup);
        c.addEventListener('keypress', this._eventHandlers.keypress);

        // Release (key up) if window loses focus
        window.addEventListener('blur', this._eventHandlers.blur);

        //Log.Debug("<< Keyboard.grab");
    },

    ungrab: function () {
        //Log.Debug(">> Keyboard.ungrab");
        var c = this._target;

        c.removeEventListener('keydown', this._eventHandlers.keydown);
        c.removeEventListener('keyup', this._eventHandlers.keyup);
        c.removeEventListener('keypress', this._eventHandlers.keypress);
        window.removeEventListener('blur', this._eventHandlers.blur);

        // Release (key up) all keys that are in a down state
        this._allKeysUp();

        //Log.Debug(">> Keyboard.ungrab");
    },
};
