/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2019 The noVNC Authors
 * Licensed under MPL 2.0 or any later version (see LICENSE.txt)
 */

import * as Log from '../util/logging.js';
import { stopEvent } from '../util/events.js';
import * as KeyboardUtil from "./util.js";
import KeyTable from "./keysym.js";
import keysyms from "./keysymdef.js";
import imekeys from "./imekeys.js";
import * as browser from "../util/browser.js";

//
// Keyboard event handler
//

const thresholdTime = 16;
export default class Keyboard {
    constructor(screenInput, touchInput) {
        this._screenInput = screenInput;
        this._touchInput = touchInput;

        this._keyDownList = {};         // List of depressed keys
                                        // (even if they are happy)
        this._altGrArmed = false;       // Windows AltGr detection

        this._rfbKeyQueue = [];
        this._lastSendTime = 0;

        // keep these here so we can refer to them later
        this._eventHandlers = {
            'keyup': this._handleKeyUp.bind(this),
            'keydown': this._handleKeyDown.bind(this),
            'blur': this._allKeysUp.bind(this),
            'compositionstart': this._handleCompositionStart.bind(this),
            'compositionend': this._handleCompositionEnd.bind(this),
            'compositionupdate': this._handleCompositionUpdate.bind(this),
            'input': this._handleInput.bind(this)
        };

        // ===== EVENT HANDLERS =====
        this.onkeyevent = () => {}; // Handler for key press/release

        this._enableIME = false;
        this._imeStarted = false;
        this._lastKeyboardInput = null;
        this._defaultKeyboardInputLen = 100;
        this._keyboardInputReset();
        this._translateShortcuts = true;
    }

    // ===== PUBLIC METHODS =====

    get enableIME() { return this._enableIME; }
    set enableIME(val) {
        this._enableIME = val;
        this.focus();
    }

    get translateShortcuts() { return this._translateShortcuts; }
    set translateShortcuts(value) { this._translateShortcuts = value; }

    // ===== PRIVATE METHODS =====

    clearKeysDown(event) {
        // On some Operating systems, the browser will lose key up events when a shortcut key combination triggers something
        // on the OS that is outside the scope of the browser. For example, MacOS Cmd+Shift+Ctrl+4 brings up a screen capture
        // tool and the browser only recieves some of the key down events, but not the key up events. This leaves the server
        // out of sync, with cetain keys stuck down. This attempts to discover and fix these occurances in a OS nuetral way
        if (event) {
            for (const [key, value] of Object.entries(this._keyDownList)) {
                switch (key) {
                    case "ControlLeft":
                    case "ControlRight":
                        if (!event.ctrlKey) {
                            Log.Error("A control key is stuck down, sending up.");
                            this._sendKeyEvent(value, key, false);
                        }
                        break;
                    case "MetaLeft":
                    case "MetaRight":
                        if (!event.metaKey) {
                            Log.Error("A meta key is stuck down, sending up.");
                            this._sendKeyEvent(value, key, false);
                        }
                        break;
                    case "AltLeft":
                    case "AltRight":
                        if (!event.altKey) {
                            Log.Error("A alt key is stuck down, sending up. ");
                            this._sendKeyEvent(value, key, false);
                        }
                        break;
                    case "ShiftRight":
                    case "ShiftLeft":
                        if (!event.shiftKey) {
                            Log.Error("A shift key is stuck down, sending up.");
                            this._sendKeyEvent(value, key, false);
                        }
                        break;
                }
            }
        }
    }

    _scheduleRfbKeySend() {
        if (this._rfbKeyQueue.length === 0) return;

        const process = (timestamp) => {
            const elapsed = timestamp - this._lastSendTime;
            if (elapsed > thresholdTime) {
                while (this._rfbKeyQueue.length > 0) {
                    const event = this._rfbKeyQueue.shift();
                    Log.Debug("onkeyevent " + (event.down ? "down" : "up") +
                        ", keysym: " + event.keysym, ", code: " + event.code);
                    this.onkeyevent(event.keysym, event.code, event.down);
                }
                this._lastSendTime = timestamp;
            }

            if (this._rfbKeyQueue.length > 0) {
                requestAnimationFrame(process);
            }
        };

        requestAnimationFrame(process);
    }

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

        this._rfbKeyQueue.push({keysym: keysym, code: code, down: down});
        this._scheduleRfbKeySend();
    }

    _sendKeyStroke(keySym, code) {
        this._sendKeyEvent(keySym, code, true);
        this._sendKeyEvent(keySym, code, false);
    }

    _getKeyCode(e) {
        const code = KeyboardUtil.getKeycode(e);
        if (code !== 'Unidentified') {
            return code;
        }

        // Unstable, but we don't have anything else to go on
        if (e.keyCode) {
            // 229 is used for composition events
            if (e.keyCode !== 229) {
                return 'Platform' + e.keyCode;
            }
        }

        // A precursor to the final DOM3 standard. Unfortunately it
        // is not layout independent, so it is as bad as using keyCode
        if (e.keyIdentifier) {
            // Non-character key?
            if (!e.keyIdentifier.startsWith('U+')) {
                return e.keyIdentifier;
            }

            const codepoint = parseInt(e.keyIdentifier.substring(2), 16);
            const char = String.fromCharCode(codepoint).toUpperCase();

            return 'Platform' + char.charCodeAt();
        }

        return 'Unidentified';
    }

    _handleCompositionStart(e) {
        Log.Debug("Composition started: " + e.data);
        this._imeStarted = true;
        this._lastKeyboardInput = "";
    }

    _handleCompositionUpdate(e) {
        Log.Debug("Composition update: " + e.data);
        const oldValue = this._lastKeyboardInput;
        const newValue = e.data;
        let diffStart = 0;

        if (this._imeStarted) {
            this._sendKeyStroke(keysyms.lookup(newValue.charCodeAt(0)), 'Unidentified');
            this._imeStarted = false;
        } else {
            //find position where difference starts
            for (let i = 0; i < Math.min(oldValue.length, newValue.length); i++) {
                if (newValue.charAt(i) !== oldValue.charAt(i)) {
                    break;
                }
                diffStart++;
            }

            //send backspaces if needed
            Log.Debug("Backspace diffStart: " + diffStart);
            Log.Debug("Old value: " + oldValue + " Old value length: " + oldValue.length + " New value: " + newValue);
            for (let bs = oldValue.length - diffStart; bs > 0; bs--) {
                this._sendKeyStroke(KeyTable.XK_BackSpace, "Backspace");
            }

            //send new keys
            for (let i = diffStart; i < newValue.length; i++) {
                this._sendKeyStroke(keysyms.lookup(newValue.charCodeAt(i)), 'Unidentified');
            }
        }
        this._lastKeyboardInput = newValue;
        //this._touchInput.focus();
    }

    _handleCompositionEnd(e) {
        Log.Debug("Composition ended: " + e.data);
        this._touchInput.value = '';
    }

    _handleInput(e) {
        //input event occurs only when keyup keydown events don't prevent default
        //IME events will make this happen, for example
        //IME changes can back out old characters and replace, thus send differential if IME
        //otherwise send new characters
        Log.Debug("Current buffer: " + this._touchInput.value + " Input: " + e.data + " isComposing: " + e.isComposing + " input.type: " + e.inputType);
        if (!e.isComposing && e.inputType !== "insertCompositionText") {
            Log.Debug("Non-IME input change, sending new characters");
            const newValue = e.data;

            for (let i = 0; i < newValue.length; i++) {
                this._sendKeyStroke(keysyms.lookup(newValue.charCodeAt(i)), 'Unidentified');
            }

            this._touchInput.value = '';
        }
    }

    _keyboardInputReset() {
        this._touchInput.value = "";
        this._lastKeyboardInput = this._touchInput.value;
    }

    _handleKeyDown(e) {
        Log.Debug("Key Down: " + e.keyCode + " isComposing: " + e.isComposing);
        if (e.isComposing || e.keyCode === 229) {
            //skip event if IME related
            Log.Debug("Skipping keydown, IME interaction, keycode: " + e.keyCode);
            return;
        }

        const code = this._getKeyCode(e);
        let keysym = KeyboardUtil.getKeysym(e);
        this.clearKeysDown(e);
        Log.Debug("Key Down: " + e.keyCode + " code: " + code + " keysym: " + keysym);

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

        // Translate MacOs CMD based shortcuts to their CTRL based counterpart
        if (
            browser.isMac() &&
            this._translateShortcuts &&
            code !== "MetaLeft" && code !== "MetaRight" &&
            e.metaKey && !e.ctrlKey && !e.altKey
        ) {
            this._sendKeyEvent(this._keyDownList["MetaLeft"], "MetaLeft", false);
            this._sendKeyEvent(this._keyDownList["MetaRight"], "MetaRight", false);
            this._sendKeyEvent(KeyTable.XK_Control_L, "ControlLeft", true);
            this._sendKeyEvent(keysym, code, true);
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

        // Windows doesn't send proper key releases for a bunch of
        // Japanese IM keys so we have to fake the release right away
        const jpBadKeys = [ KeyTable.XK_Zenkaku_Hankaku,
                            KeyTable.XK_Eisu_toggle,
                            KeyTable.XK_Katakana,
                            KeyTable.XK_Hiragana,
                            KeyTable.XK_Romaji ];
        if (browser.isWindows() && jpBadKeys.includes(keysym)) {
            this._sendKeyEvent(keysym, code, true);
            this._sendKeyEvent(keysym, code, false);
            stopEvent(e);
            return;
        }

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

    _handleKeyUp(e) {
        Log.Debug("Key Up: " + e.keyCode + " Buffer: " + this._touchInput.value);
        if (e.isComposing || e.keyCode === 229) {
            //skip IME related events
            Log.Debug("Skipping keyup, IME interaction, keycode: " + e.keyCode);
            return;
        }
        const code = this._getKeyCode(e);
        stopEvent(e);

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

    _isIMEInteraction(e) {
        //input must come from touchinput (textarea) and ime must be enabled
        if (e.target !== this._touchInput || !this._enableIME) { return false; }

        //keyCode of 229 is IME composition
        if (e.keyCode === 229) {
            return true;
        }

        //unfortunately, IME interactions can come through as events
        //generally safe to ignore and let them come in as "input" events instead
        //we can't do that with none character keys though
        //Firefox does not seem to fire key events for IME interaction but Chrome does
        //TODO: potentially skip this for Firefox browsers, needs more testing with different IME types
        return e.keyCode in imekeys;
    }

    // ===== PUBLIC METHODS =====

    focus() {
        if (this._enableIME) {
            this._touchInput.focus();
        } else {
            this._screenInput.focus();
        }
    }

    blur() {
        if (this._enableIME) {
            this._touchInput.blur();
        } else {
            this._screenInput.blur();
        }
    }

    grab() {
        //Log.Debug(">> Keyboard.grab");
        this._screenInput.addEventListener('keydown', this._eventHandlers.keydown);
        this._screenInput.addEventListener('keyup', this._eventHandlers.keyup);

        this._touchInput.addEventListener('keydown', this._eventHandlers.keydown);
        this._touchInput.addEventListener('keyup', this._eventHandlers.keyup);
        this._touchInput.addEventListener('compositionstart', this._eventHandlers.compositionstart);
        this._touchInput.addEventListener('compositionupdate', this._eventHandlers.compositionupdate);
        this._touchInput.addEventListener('compositionend', this._eventHandlers.compositionend);
        this._touchInput.addEventListener('input', this._eventHandlers.input);

        // Release (key up) if window loses focus
        window.addEventListener('blur', this._eventHandlers.blur);

        //Log.Debug("<< Keyboard.grab");
    }

    ungrab() {
        //Log.Debug(">> Keyboard.ungrab");
        this._screenInput.removeEventListener('keydown', this._eventHandlers.keydown);
        this._screenInput.removeEventListener('keyup', this._eventHandlers.keyup);

        this._touchInput.removeEventListener('keydown', this._eventHandlers.keydown);
        this._touchInput.removeEventListener('keyup', this._eventHandlers.keyup);
        this._touchInput.removeEventListener('compositionstart', this._eventHandlers.compositionstart);
        this._touchInput.removeEventListener('compositionupdate', this._eventHandlers.compositionupdate);
        this._touchInput.removeEventListener('compositionend', this._eventHandlers.compositionend);
        this._touchInput.removeEventListener('input', this._eventHandlers.input);

        window.removeEventListener('blur', this._eventHandlers.blur);

        // Release (key up) all keys that are in a down state
        this._allKeysUp();

        //Log.Debug(">> Keyboard.ungrab");
    }
}
