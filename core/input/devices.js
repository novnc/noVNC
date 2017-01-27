/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2012 Joel Martin
 * Copyright (C) 2013 Samuel Mannehed for Cendio AB
 * Licensed under MPL 2.0 or any later version (see LICENSE.txt)
 */

/*jslint browser: true, white: false */
/*global window, Util */

import * as Log from '../util/logging.js';
import { isTouchDevice } from '../util/browsers.js'
import { setCapture, releaseCapture, stopEvent, getPointerEvent } from '../util/events.js';
import { set_defaults, make_properties } from '../util/properties.js';
import * as KeyboardUtil from "./util.js";

//
// Keyboard event handler
//

const Keyboard = function (defaults) {
    this._keyDownList = [];         // List of depressed keys
                                    // (even if they are happy)

    this._modifierState = KeyboardUtil.ModifierSync();

    set_defaults(this, defaults, {
        'target': document,
        'focused': true
    });

    // keep these here so we can refer to them later
    this._eventHandlers = {
        'keyup': this._handleKeyUp.bind(this),
        'keydown': this._handleKeyDown.bind(this),
        'keypress': this._handleKeyPress.bind(this),
        'blur': this._allKeysUp.bind(this)
    };
};

Keyboard.prototype = {
    // private methods

    _sendKeyEvent: function (keysym, code, down) {
        if (!this._onKeyEvent) {
            return;
        }

        Log.Debug("onKeyEvent " + (down ? "down" : "up") +
                  ", keysym: " + keysym, ", code: " + code);

        this._onKeyEvent(keysym, code, down);
    },

    _getKeyCode: function (e) {
        var code = KeyboardUtil.getKeycode(e);
        if (code === 'Unidentified') {
            // Unstable, but we don't have anything else to go on
            // (don't use it for 'keypress' events thought since
            // WebKit sets it to the same as charCode)
            if (e.keyCode && (e.type !== 'keypress')) {
                code = 'Platform' + e.keyCode;
            }
        }

        return code;
    },

    _handleKeyDown: function (e) {
        if (!this._focused) { return; }

        this._modifierState.keydown(e);

        var code = this._getKeyCode(e);
        var keysym = KeyboardUtil.getKeysym(e);

        // If this is a legacy browser then we'll need to wait for
        // a keypress event as well. Otherwise we supress the
        // browser's handling at this point
        if (keysym) {
            stopEvent(e);
        }

        // if a char modifier is pressed, get the keys it consists
        // of (on Windows, AltGr is equivalent to Ctrl+Alt)
        var active = this._modifierState.activeCharModifier();

        // If we have a char modifier down, and we're able to
        // determine a keysym reliably then (a) we know to treat
        // the modifier as a char modifier, and (b) we'll have to
        // "escape" the modifier to undo the modifier when sending
        // the char.
        if (active && keysym) {
            var isCharModifier = false;
            for (var i  = 0; i < active.length; ++i) {
                if (active[i] === keysym) {
                    isCharModifier = true;
                }
            }
            if (!isCharModifier) {
                var escape = this._modifierState.activeCharModifier();
            }
        }

        var last;
        if (this._keyDownList.length === 0) {
            last = null;
        } else {
            last = this._keyDownList[this._keyDownList.length-1];
        }

        // insert a new entry if last seen key was different.
        if (!last || code === 'Unidentified' || last.code !== code) {
            last = {code: code, keysyms: {}};
            this._keyDownList.push(last);
        }

        // Wait for keypress?
        if (!keysym) {
            return;
        }

        // make sure last event contains this keysym (a single "logical" keyevent
        // can cause multiple key events to be sent to the VNC server)
        last.keysyms[keysym] = keysym;
        last.ignoreKeyPress = true;

        // undo modifiers
        if (escape) {
            for (var i = 0; i < escape.length; ++i) {
                this._sendKeyEvent(escape[i], 'Unidentified', false);
            }
        }

        // send the character event
        this._sendKeyEvent(keysym, code, true);

        // redo modifiers
        if (escape) {
            for (i = 0; i < escape.length; ++i) {
                this._sendKeyEvent(escape[i], 'Unidentified', true);
            }
        }
    },

    // Legacy event for browsers without code/key
    _handleKeyPress: function (e) {
        if (!this._focused) { return; }

        stopEvent(e);

        var code = this._getKeyCode(e);
        var keysym = KeyboardUtil.getKeysym(e);

        // if a char modifier is pressed, get the keys it consists
        // of (on Windows, AltGr is equivalent to Ctrl+Alt)
        var active = this._modifierState.activeCharModifier();

        // If we have a char modifier down, and we're able to
        // determine a keysym reliably then (a) we know to treat
        // the modifier as a char modifier, and (b) we'll have to
        // "escape" the modifier to undo the modifier when sending
        // the char.
        if (active && keysym) {
            var isCharModifier = false;
            for (var i  = 0; i < active.length; ++i) {
                if (active[i] === keysym) {
                    isCharModifier = true;
                }
            }
            if (!isCharModifier) {
                var escape = this._modifierState.activeCharModifier();
            }
        }

        var last;
        if (this._keyDownList.length === 0) {
            last = null;
        } else {
            last = this._keyDownList[this._keyDownList.length-1];
        }

        if (!last) {
            last = {code: code, keysyms: {}};
            this._keyDownList.push(last);
        }
        if (!keysym) {
            console.log('keypress with no keysym:', e);
            return;
        }

        // If we didn't expect a keypress, and already sent a keydown to the VNC server
        // based on the keydown, make sure to skip this event.
        if (last.ignoreKeyPress) {
            return;
        }

        last.keysyms[keysym] = keysym;

        // undo modifiers
        if (escape) {
            for (var i = 0; i < escape.length; ++i) {
                this._sendKeyEvent(escape[i], 'Unidentified', false);
            }
        }

        // send the character event
        this._sendKeyEvent(keysym, code, true);

        // redo modifiers
        if (escape) {
            for (i = 0; i < escape.length; ++i) {
                this._sendKeyEvent(escape[i], 'Unidentified', true);
            }
        }
    },

    _handleKeyUp: function (e) {
        if (!this._focused) { return; }

        stopEvent(e);

        this._modifierState.keyup(e);

        var code = this._getKeyCode(e);

        if (this._keyDownList.length === 0) {
            return;
        }
        var idx = null;
        // do we have a matching key tracked as being down?
        for (var i = 0; i !== this._keyDownList.length; ++i) {
            if (this._keyDownList[i].code === code) {
                idx = i;
                break;
            }
        }
        // if we couldn't find a match (it happens), assume it was the last key pressed
        if (idx === null) {
            idx = this._keyDownList.length - 1;
        }

        var item = this._keyDownList.splice(idx, 1)[0];
        for (var key in item.keysyms) {
            this._sendKeyEvent(item.keysyms[key], code, false);
        }
    },

    _allKeysUp: function () {
        Log.Debug(">> Keyboard.allKeysUp");
        for (var i = 0; i < this._keyDownList.length; i++) {
            var item = this._keyDownList[i];
            for (var key in item.keysyms) {
                this._sendKeyEvent(item.keysyms[key], 'Unidentified', false);
            }
        };
        this._keyDownList = [];
        Log.Debug("<< Keyboard.allKeysUp");
    },

    // Public methods

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

make_properties(Keyboard, [
    ['target',     'wo', 'dom'],  // DOM element that captures keyboard input
    ['focused',    'rw', 'bool'], // Capture and send key events

    ['onKeyEvent', 'rw', 'func'] // Handler for key press/release
]);

const Mouse = function (defaults) {
    this._mouseCaptured  = false;

    this._doubleClickTimer = null;
    this._lastTouchPos = null;

    // Configuration attributes
    set_defaults(this, defaults, {
        'target': document,
        'focused': true,
        'touchButton': 1
    });

    this._eventHandlers = {
        'mousedown': this._handleMouseDown.bind(this),
        'mouseup': this._handleMouseUp.bind(this),
        'mousemove': this._handleMouseMove.bind(this),
        'mousewheel': this._handleMouseWheel.bind(this),
        'mousedisable': this._handleMouseDisable.bind(this)
    };
};

Mouse.prototype = {
    // private methods
    _captureMouse: function () {
        // capturing the mouse ensures we get the mouseup event
        setCapture(this._target);

        // some browsers give us mouseup events regardless,
        // so if we never captured the mouse, we can disregard the event
        this._mouseCaptured = true;
    },

    _releaseMouse: function () {
        releaseCapture();
        this._mouseCaptured = false;
    },

    _resetDoubleClickTimer: function () {
        this._doubleClickTimer = null;
    },

    _handleMouseButton: function (e, down) {
        if (!this._focused) { return; }

        var pos = this._getMousePosition(e);

        var bmask;
        if (e.touches || e.changedTouches) {
            // Touch device

            // When two touches occur within 500 ms of each other and are
            // close enough together a double click is triggered.
            if (down == 1) {
                if (this._doubleClickTimer === null) {
                    this._lastTouchPos = pos;
                } else {
                    clearTimeout(this._doubleClickTimer);

                    // When the distance between the two touches is small enough
                    // force the position of the latter touch to the position of
                    // the first.

                    var xs = this._lastTouchPos.x - pos.x;
                    var ys = this._lastTouchPos.y - pos.y;
                    var d = Math.sqrt((xs * xs) + (ys * ys));

                    // The goal is to trigger on a certain physical width, the
                    // devicePixelRatio brings us a bit closer but is not optimal.
                    var threshold = 20 * (window.devicePixelRatio || 1);
                    if (d < threshold) {
                        pos = this._lastTouchPos;
                    }
                }
                this._doubleClickTimer = setTimeout(this._resetDoubleClickTimer.bind(this), 500);
            }
            bmask = this._touchButton;
            // If bmask is set
        } else if (e.which) {
            /* everything except IE */
            bmask = 1 << e.button;
        } else {
            /* IE including 9 */
            bmask = (e.button & 0x1) +      // Left
                    (e.button & 0x2) * 2 +  // Right
                    (e.button & 0x4) / 2;   // Middle
        }

        if (this._onMouseButton) {
            Log.Debug("onMouseButton " + (down ? "down" : "up") +
                       ", x: " + pos.x + ", y: " + pos.y + ", bmask: " + bmask);
            this._onMouseButton(pos.x, pos.y, down, bmask);
        }
        stopEvent(e);
    },

    _handleMouseDown: function (e) {
        this._captureMouse();
        this._handleMouseButton(e, 1);
    },

    _handleMouseUp: function (e) {
        if (!this._mouseCaptured) { return; }

        this._handleMouseButton(e, 0);
        this._releaseMouse();
    },

    _handleMouseWheel: function (e) {
        if (!this._focused) { return; }

        var pos = this._getMousePosition(e);

        if (this._onMouseButton) {
            if (e.deltaX < 0) {
                this._onMouseButton(pos.x, pos.y, 1, 1 << 5);
                this._onMouseButton(pos.x, pos.y, 0, 1 << 5);
            } else if (e.deltaX > 0) {
                this._onMouseButton(pos.x, pos.y, 1, 1 << 6);
                this._onMouseButton(pos.x, pos.y, 0, 1 << 6);
            }

            if (e.deltaY < 0) {
                this._onMouseButton(pos.x, pos.y, 1, 1 << 3);
                this._onMouseButton(pos.x, pos.y, 0, 1 << 3);
            } else if (e.deltaY > 0) {
                this._onMouseButton(pos.x, pos.y, 1, 1 << 4);
                this._onMouseButton(pos.x, pos.y, 0, 1 << 4);
            }
        }

        stopEvent(e);
    },

    _handleMouseMove: function (e) {
        if (! this._focused) { return; }

        var pos = this._getMousePosition(e);
        if (this._onMouseMove) {
            this._onMouseMove(pos.x, pos.y);
        }
        stopEvent(e);
    },

    _handleMouseDisable: function (e) {
        if (!this._focused) { return; }

        /*
         * Stop propagation if inside canvas area
         * Note: This is only needed for the 'click' event as it fails
         *       to fire properly for the target element so we have
         *       to listen on the document element instead.
         */
        if (e.target == this._target) {
            stopEvent(e);
        }
    },

    // Return coordinates relative to target
    _getMousePosition: function(e) {
        e = getPointerEvent(e);
        var bounds = this._target.getBoundingClientRect();
        var x, y;
        // Clip to target bounds
        if (e.clientX < bounds.left) {
            x = 0;
        } else if (e.clientX >= bounds.right) {
            x = bounds.width - 1;
        } else {
            x = e.clientX - bounds.left;
        }
        if (e.clientY < bounds.top) {
            y = 0;
        } else if (e.clientY >= bounds.bottom) {
            y = bounds.height - 1;
        } else {
            y = e.clientY - bounds.top;
        }
        return {x:x, y:y};
    },

    // Public methods
    grab: function () {
        var c = this._target;

        if (isTouchDevice) {
            c.addEventListener('touchstart', this._eventHandlers.mousedown);
            window.addEventListener('touchend', this._eventHandlers.mouseup);
            c.addEventListener('touchend', this._eventHandlers.mouseup);
            c.addEventListener('touchmove', this._eventHandlers.mousemove);
        }
        c.addEventListener('mousedown', this._eventHandlers.mousedown);
        window.addEventListener('mouseup', this._eventHandlers.mouseup);
        c.addEventListener('mouseup', this._eventHandlers.mouseup);
        c.addEventListener('mousemove', this._eventHandlers.mousemove);
        c.addEventListener('wheel', this._eventHandlers.mousewheel);

        /* Prevent middle-click pasting (see above for why we bind to document) */
        document.addEventListener('click', this._eventHandlers.mousedisable);

        /* preventDefault() on mousedown doesn't stop this event for some
           reason so we have to explicitly block it */
        c.addEventListener('contextmenu', this._eventHandlers.mousedisable);
    },

    ungrab: function () {
        var c = this._target;

        if (isTouchDevice) {
            c.removeEventListener('touchstart', this._eventHandlers.mousedown);
            window.removeEventListener('touchend', this._eventHandlers.mouseup);
            c.removeEventListener('touchend', this._eventHandlers.mouseup);
            c.removeEventListener('touchmove', this._eventHandlers.mousemove);
        }
        c.removeEventListener('mousedown', this._eventHandlers.mousedown);
        window.removeEventListener('mouseup', this._eventHandlers.mouseup);
        c.removeEventListener('mouseup', this._eventHandlers.mouseup);
        c.removeEventListener('mousemove', this._eventHandlers.mousemove);
        c.removeEventListener('wheel', this._eventHandlers.mousewheel);

        document.removeEventListener('click', this._eventHandlers.mousedisable);

        c.removeEventListener('contextmenu', this._eventHandlers.mousedisable);
    }
};

make_properties(Mouse, [
    ['target',         'ro', 'dom'],   // DOM element that captures mouse input
    ['focused',        'rw', 'bool'],  // Capture and send mouse clicks/movement

    ['onMouseButton',  'rw', 'func'],  // Handler for mouse button click/release
    ['onMouseMove',    'rw', 'func'],  // Handler for mouse movement
    ['touchButton',    'rw', 'int']    // Button mask (1, 2, 4) for touch devices (0 means ignore clicks)
]);

export { Keyboard, Mouse };
