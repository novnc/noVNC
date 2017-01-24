import KeyTable from "./keysym.js";
import keysyms from "./keysymdef.js";
import vkeys from "./vkeys.js";

function isMac() {
    return navigator && !!(/mac/i).exec(navigator.platform);
}
function isWindows() {
    return navigator && !!(/win/i).exec(navigator.platform);
}
function isLinux() {
    return navigator && !!(/linux/i).exec(navigator.platform);
}

// Return true if a modifier which is not the specified char modifier (and is not shift) is down
export function hasShortcutModifier(charModifier, currentModifiers) {
    var mods = {};
    for (var key in currentModifiers) {
        if (parseInt(key) !== KeyTable.XK_Shift_L) {
            mods[key] = currentModifiers[key];
        }
    }

    var sum = 0;
    for (var k in currentModifiers) {
        if (mods[k]) {
            ++sum;
        }
    }
    if (hasCharModifier(charModifier, mods)) {
        return sum > charModifier.length;
    }
    else {
        return sum > 0;
    }
}

// Return true if the specified char modifier is currently down
export function hasCharModifier(charModifier, currentModifiers) {
    if (charModifier.length === 0) { return false; }

    for (var i = 0; i < charModifier.length; ++i) {
        if (!currentModifiers[charModifier[i]]) {
            return false;
        }
    }
    return true;
}

// Helper object tracking modifier key state
// and generates fake key events to compensate if it gets out of sync
export function ModifierSync(charModifier) {
    if (!charModifier) {
        if (isMac()) {
            // on Mac, Option (AKA Alt) is used as a char modifier
            charModifier = [KeyTable.XK_Alt_L];
        }
        else if (isWindows()) {
            // on Windows, Ctrl+Alt is used as a char modifier
            charModifier = [KeyTable.XK_Alt_L, KeyTable.XK_Control_L];
        }
        else if (isLinux()) {
            // on Linux, ISO Level 3 Shift (AltGr) is used as a char modifier
            charModifier = [KeyTable.XK_ISO_Level3_Shift];
        }
        else {
            charModifier = [];
        }
    }

    var state = {};
    state[KeyTable.XK_Control_L] = false;
    state[KeyTable.XK_Alt_L] = false;
    state[KeyTable.XK_ISO_Level3_Shift] = false;
    state[KeyTable.XK_Shift_L] = false;
    state[KeyTable.XK_Meta_L] = false;

    function sync(evt, keysym) {
        var result = [];
        function syncKey(keysym) {
            return {keysym: keysym, type: state[keysym] ? 'keydown' : 'keyup'};
        }

        if (evt.ctrlKey !== undefined &&
            evt.ctrlKey !== state[KeyTable.XK_Control_L] && keysym !== KeyTable.XK_Control_L) {
            state[KeyTable.XK_Control_L] = evt.ctrlKey;
            result.push(syncKey(KeyTable.XK_Control_L));
        }
        if (evt.altKey !== undefined &&
            evt.altKey !== state[KeyTable.XK_Alt_L] && keysym !== KeyTable.XK_Alt_L) {
            state[KeyTable.XK_Alt_L] = evt.altKey;
            result.push(syncKey(KeyTable.XK_Alt_L));
        }
        if (evt.altGraphKey !== undefined &&
            evt.altGraphKey !== state[KeyTable.XK_ISO_Level3_Shift] && keysym !== KeyTable.XK_ISO_Level3_Shift) {
            state[KeyTable.XK_ISO_Level3_Shift] = evt.altGraphKey;
            result.push(syncKey(KeyTable.XK_ISO_Level3_Shift));
        }
        if (evt.shiftKey !== undefined &&
            evt.shiftKey !== state[KeyTable.XK_Shift_L] && keysym !== KeyTable.XK_Shift_L) {
            state[KeyTable.XK_Shift_L] = evt.shiftKey;
            result.push(syncKey(KeyTable.XK_Shift_L));
        }
        if (evt.metaKey !== undefined &&
            evt.metaKey !== state[KeyTable.XK_Meta_L] && keysym !== KeyTable.XK_Meta_L) {
            state[KeyTable.XK_Meta_L] = evt.metaKey;
            result.push(syncKey(KeyTable.XK_Meta_L));
        }
        return result;
    }
    function syncKeyEvent(evt, down) {
        var keysym = getKeysym(evt);

        // first, apply the event itself, if relevant
        if (keysym !== null && state[keysym] !== undefined) {
            state[keysym] = down;
        }
        return sync(evt, keysym);
    }

    return {
        // sync on the appropriate keyboard event
        keydown: function(evt) { return syncKeyEvent(evt, true);},
        keyup: function(evt) { return syncKeyEvent(evt, false);},
        // Call this with a non-keyboard event (such as mouse events) to use its modifier state to synchronize anyway
        syncAny: function(evt) { return sync(evt);},

        // is a shortcut modifier down?
        hasShortcutModifier: function() { return hasShortcutModifier(charModifier, state); },
        // if a char modifier is down, return the keys it consists of, otherwise return null
        activeCharModifier: function() { return hasCharModifier(charModifier, state) ? charModifier : null; }
    };
}

// Get 'KeyboardEvent.code', handling legacy browsers
export function getKeycode(evt){
    // Are we getting proper key identifiers?
    // (unfortunately Firefox and Chrome are crappy here and gives
    // us an empty string on some platforms, rather than leaving it
    // undefined)
    if (evt.code) {
        // Mozilla isn't fully in sync with the spec yet
        switch (evt.code) {
            case 'OSLeft': return 'MetaLeft';
            case 'OSRight': return 'MetaRight';
        }

        return evt.code;
    }

    // The de-facto standard is to use Windows Virtual-Key codes
    // in the 'keyCode' field for non-printable characters. However
    // Webkit sets it to the same as charCode in 'keypress' events.
    if ((evt.type !== 'keypress') && (evt.keyCode in vkeys)) {
        var code = vkeys[evt.keyCode];

        // macOS has messed up this code for some reason
        if (isMac() && (code === 'ContextMenu')) {
            code = 'MetaRight';
        }

        // The keyCode doesn't distinguish between left and right
        // for the standard modifiers
        if (evt.location === 2) {
            switch (code) {
                case 'ShiftLeft': return 'ShiftRight';
                case 'ControlLeft': return 'ControlRight';
                case 'AltLeft': return 'AltRight';
            }
        }

        // Nor a bunch of the numpad keys
        if (evt.location === 3) {
            switch (code) {
                case 'Delete': return 'NumpadDecimal';
                case 'Insert': return 'Numpad0';
                case 'End': return 'Numpad1';
                case 'ArrowDown': return 'Numpad2';
                case 'PageDown': return 'Numpad3';
                case 'ArrowLeft': return 'Numpad4';
                case 'ArrowRight': return 'Numpad6';
                case 'Home': return 'Numpad7';
                case 'ArrowUp': return 'Numpad8';
                case 'PageUp': return 'Numpad9';
                case 'Enter': return 'NumpadEnter';
            }
        }

        return code;
    }

    return 'Unidentified';
}

// Get the most reliable keysym value we can get from a key event
// if char/charCode is available, prefer those, otherwise fall back to key/keyCode/which
export function getKeysym(evt){
    var codepoint;
    if (evt.char && evt.char.length === 1) {
        codepoint = evt.char.charCodeAt();
    }
    else if (evt.charCode) {
        codepoint = evt.charCode;
    }
    else if (evt.keyCode && evt.type === 'keypress') {
        // IE10 stores the char code as keyCode, and has no other useful properties
        codepoint = evt.keyCode;
    }
    if (codepoint) {
        return keysyms.lookup(codepoint);
    }
    // we could check evt.key here.
    // Legal values are defined in http://www.w3.org/TR/DOM-Level-3-Events/#key-values-list,
    // so we "just" need to map them to keysym, but AFAIK this is only available in IE10, which also provides evt.key
    // so we don't *need* it yet
    if (evt.keyCode) {
        return keysymFromKeyCode(evt.keyCode, evt.shiftKey);
    }
    if (evt.which) {
        return keysymFromKeyCode(evt.which, evt.shiftKey);
    }
    return null;
}

// Given a keycode, try to predict which keysym it might be.
// If the keycode is unknown, null is returned.
function keysymFromKeyCode(keycode, shiftPressed) {
    if (typeof(keycode) !== 'number') {
        return null;
    }
    // won't be accurate for azerty
    if (keycode >= 0x30 && keycode <= 0x39) {
        return keycode; // digit
    }
    if (keycode >= 0x41 && keycode <= 0x5a) {
        // remap to lowercase unless shift is down
        return shiftPressed ? keycode : keycode + 32; // A-Z
    }
    if (keycode >= 0x60 && keycode <= 0x69) {
        return KeyTable.XK_KP_0 + (keycode - 0x60); // numpad 0-9
    }

    switch(keycode) {
        case 0x20: return KeyTable.XK_space;
        case 0x6a: return KeyTable.XK_KP_Multiply;
        case 0x6b: return KeyTable.XK_KP_Add;
        case 0x6c: return KeyTable.XK_KP_Separator;
        case 0x6d: return KeyTable.XK_KP_Subtract;
        case 0x6e: return KeyTable.XK_KP_Decimal;
        case 0x6f: return KeyTable.XK_KP_Divide;
        case 0xbb: return KeyTable.XK_plus;
        case 0xbc: return KeyTable.XK_comma;
        case 0xbd: return KeyTable.XK_minus;
        case 0xbe: return KeyTable.XK_period;
    }

    return nonCharacterKey({keyCode: keycode});
}

// if the key is a known non-character key (any key which doesn't generate character data)
// return its keysym value. Otherwise return null
function nonCharacterKey(evt) {
    // evt.key not implemented yet
    if (!evt.keyCode) { return null; }
    var keycode = evt.keyCode;

    if (keycode >= 0x70 && keycode <= 0x87) {
        return KeyTable.XK_F1 + keycode - 0x70; // F1-F24
    }
    switch (keycode) {

        case 8 : return KeyTable.XK_BackSpace;
        case 13 : return KeyTable.XK_Return;

        case 9 : return KeyTable.XK_Tab;

        case 27 : return KeyTable.XK_Escape;
        case 46 : return KeyTable.XK_Delete;

        case 36 : return KeyTable.XK_Home;
        case 35 : return KeyTable.XK_End;
        case 33 : return KeyTable.XK_Page_Up;
        case 34 : return KeyTable.XK_Page_Down;
        case 45 : return KeyTable.XK_Insert;

        case 37 : return KeyTable.XK_Left;
        case 38 : return KeyTable.XK_Up;
        case 39 : return KeyTable.XK_Right;
        case 40 : return KeyTable.XK_Down;

        case 16 : return KeyTable.XK_Shift_L;
        case 17 : return KeyTable.XK_Control_L;
        case 18 : return KeyTable.XK_Alt_L; // also: Option-key on Mac

        case 224 : return KeyTable.XK_Meta_L;
        case 225 : return KeyTable.XK_ISO_Level3_Shift; // AltGr
        case 91 : return KeyTable.XK_Super_L; // also: Windows-key
        case 92 : return KeyTable.XK_Super_R; // also: Windows-key
        case 93 : return KeyTable.XK_Menu; // also: Windows-Menu, Command on Mac
        default: return null;
    }
}

export function QEMUKeyEventDecoder (modifierState, next) {
    "use strict";

    function sendAll(evts) {
        for (var i = 0; i < evts.length; ++i) {
            next(evts[i]);
        }
    }

    var numPadCodes = ["Numpad0", "Numpad1", "Numpad2",
        "Numpad3", "Numpad4", "Numpad5", "Numpad6",
        "Numpad7", "Numpad8", "Numpad9", "NumpadDecimal"];

    var numLockOnKeySyms = {
        "Numpad0": 0xffb0, "Numpad1": 0xffb1, "Numpad2": 0xffb2,
        "Numpad3": 0xffb3, "Numpad4": 0xffb4, "Numpad5": 0xffb5,
        "Numpad6": 0xffb6, "Numpad7": 0xffb7, "Numpad8": 0xffb8,
        "Numpad9": 0xffb9, "NumpadDecimal": 0xffac
    };

    var numLockOnKeyCodes = [96, 97, 98, 99, 100, 101, 102,
        103, 104, 105, 108, 110];

    function isNumPadMultiKey(evt) {
        return (numPadCodes.indexOf(evt.code) !== -1);
    }

    function getNumPadKeySym(evt) {
        if (numLockOnKeyCodes.indexOf(evt.keyCode) !== -1) {
            return numLockOnKeySyms[evt.code];
        }
        return 0;
    }

    function process(evt, type) {
        var result = {type: type};
        result.code = getKeycode(evt);
        result.keysym = 0;

        if (isNumPadMultiKey(evt)) {
            result.keysym = getNumPadKeySym(evt);
        }

        var hasModifier = modifierState.hasShortcutModifier() || !!modifierState.activeCharModifier();
        var isShift = result.code === 'ShiftLeft' || result.code === 'ShiftRight';

        var suppress = !isShift && (type !== 'keydown' || modifierState.hasShortcutModifier() || !!nonCharacterKey(evt));

        next(result);
        return suppress;
    }
    return {
        keydown: function(evt) {
            sendAll(modifierState.keydown(evt));
            return process(evt, 'keydown');
        },
        keypress: function(evt) {
            return true;
        },
        keyup: function(evt) {
            sendAll(modifierState.keyup(evt));
            return process(evt, 'keyup');
        },
        syncModifiers: function(evt) {
            sendAll(modifierState.syncAny(evt));
        },
        releaseAll: function() { next({type: 'releaseall'}); }
    };
};

export function TrackQEMUKeyState (next) {
    "use strict";
    var state = [];

    return function (evt) {
        var last = state.length !== 0 ? state[state.length-1] : null;

        switch (evt.type) {
        case 'keydown':

            if (!last || last.code !== evt.code) {
                last = {code: evt.code};

                if (state.length > 0 && state[state.length-1].code == 'ControlLeft') {
                     if (evt.code !== 'AltRight') {
                         next({code: 'ControlLeft', type: 'keydown', keysym: 0});
                     } else {
                         state.pop();
                     }
                }
                state.push(last);
            }
            if (evt.code !== 'ControlLeft') {
                next(evt);
            }
            break;

        case 'keyup':
            if (state.length === 0) {
                return;
            }
            var idx = null;
            // do we have a matching key tracked as being down?
            for (var i = 0; i !== state.length; ++i) {
                if (state[i].code === evt.code) {
                    idx = i;
                    break;
                }
            }
            // if we couldn't find a match (it happens), assume it was the last key pressed
            if (idx === null) {
                if (evt.code === 'ControlLeft') {
                    return;
                }
                idx = state.length - 1;
            }

            state.splice(idx, 1);
            next(evt);
            break;
        case 'releaseall':
            /* jshint shadow: true */
            for (var i = 0; i < state.length; ++i) {
                next({code: state[i].code, keysym: 0, type: 'keyup'});
            }
            /* jshint shadow: false */
            state = [];
        }
    };
};

// Takes a DOM keyboard event and:
// - determines which keysym it represents
// - determines a code identifying the key that was pressed (corresponding to the code/keyCode properties on the DOM event)
// - synthesizes events to synchronize modifier key state between which modifiers are actually down, and which we thought were down
// - marks each event with an 'escape' property if a modifier was down which should be "escaped"
// - generates a "stall" event in cases where it might be necessary to wait and see if a keypress event follows a keydown
// This information is collected into an object which is passed to the next() function. (one call per event)
export function KeyEventDecoder (modifierState, next) {
    "use strict";
    function sendAll(evts) {
        for (var i = 0; i < evts.length; ++i) {
            next(evts[i]);
        }
    }
    function process(evt, type) {
        var result = {type: type};
        var code = getKeycode(evt);
        if (code === 'Unidentified') {
            // Unstable, but we don't have anything else to go on
            // (don't use it for 'keypress' events thought since
            // WebKit sets it to the same as charCode)
            if (evt.keyCode && (evt.type !== 'keypress')) {
                code = 'Platform' + evt.keyCode;
            }
        }
        result.code = code;

        var keysym = getKeysym(evt);

        var hasModifier = modifierState.hasShortcutModifier() || !!modifierState.activeCharModifier();
        // Is this a case where we have to decide on the keysym right away, rather than waiting for the keypress?
        // "special" keys like enter, tab or backspace don't send keypress events,
        // and some browsers don't send keypresses at all if a modifier is down
        if (keysym && (type !== 'keydown' || nonCharacterKey(evt) || hasModifier)) {
            result.keysym = keysym;
        }

        var isShift = code === 'ShiftLeft' || code === 'ShiftRight';

        // Should we prevent the browser from handling the event?
        // Doing so on a keydown (in most browsers) prevents keypress from being generated
        // so only do that if we have to.
        var suppress = !isShift && (type !== 'keydown' || modifierState.hasShortcutModifier() || !!nonCharacterKey(evt));

        // If a char modifier is down on a keydown, we need to insert a stall,
        // so VerifyCharModifier knows to wait and see if a keypress is comnig
        var stall = type === 'keydown' && modifierState.activeCharModifier() && !nonCharacterKey(evt);

        // if a char modifier is pressed, get the keys it consists of (on Windows, AltGr is equivalent to Ctrl+Alt)
        var active = modifierState.activeCharModifier();

        // If we have a char modifier down, and we're able to determine a keysym reliably
        // then (a) we know to treat the modifier as a char modifier,
        // and (b) we'll have to "escape" the modifier to undo the modifier when sending the char.
        if (active && keysym) {
            var isCharModifier = false;
            for (var i  = 0; i < active.length; ++i) {
                if (active[i] === keysym) {
                    isCharModifier = true;
                }
            }
            if (type === 'keypress' && !isCharModifier) {
                result.escape = modifierState.activeCharModifier();
            }
        }

        if (stall) {
            // insert a fake "stall" event
            next({type: 'stall'});
        }
        next(result);

        return suppress;
    }

    return {
        keydown: function(evt) {
            sendAll(modifierState.keydown(evt));
            return process(evt, 'keydown');
        },
        keypress: function(evt) {
            return process(evt, 'keypress');
        },
        keyup: function(evt) {
            sendAll(modifierState.keyup(evt));
            return process(evt, 'keyup');
        },
        syncModifiers: function(evt) {
            sendAll(modifierState.syncAny(evt));
        },
        releaseAll: function() { next({type: 'releaseall'}); }
    };
};

// Combines keydown and keypress events where necessary to handle char modifiers.
// On some OS'es, a char modifier is sometimes used as a shortcut modifier.
// For example, on Windows, AltGr is synonymous with Ctrl-Alt. On a Danish keyboard layout, AltGr-2 yields a @, but Ctrl-Alt-D does nothing
// so when used with the '2' key, Ctrl-Alt counts as a char modifier (and should be escaped), but when used with 'D', it does not.
// The only way we can distinguish these cases is to wait and see if a keypress event arrives
// When we receive a "stall" event, wait a few ms before processing the next keydown. If a keypress has also arrived, merge the two
export function VerifyCharModifier (next) {
    "use strict";
    var queue = [];
    var timer = null;
    function process() {
        if (timer) {
            return;
        }

        var delayProcess = function () {
            clearTimeout(timer);
            timer = null;
            process();
        };

        while (queue.length !== 0) {
            var cur = queue[0];
            queue = queue.splice(1);
            switch (cur.type) {
            case 'stall':
                // insert a delay before processing available events.
                /* jshint loopfunc: true */
                timer = setTimeout(delayProcess, 5);
                /* jshint loopfunc: false */
                return;
            case 'keydown':
                // is the next element a keypress? Then we should merge the two
                if (queue.length !== 0 && queue[0].type === 'keypress') {
                    // Firefox sends keypress even when no char is generated.
                    // so, if keypress keysym is the same as we'd have guessed from keydown,
                    // the modifier didn't have any effect, and should not be escaped
                    if (queue[0].escape && (!cur.keysym || cur.keysym !== queue[0].keysym)) {
                        cur.escape = queue[0].escape;
                    }
                    cur.keysym = queue[0].keysym;
                    queue = queue.splice(1);
                }
                break;
            }

            // swallow stall events, and pass all others to the next stage
            if (cur.type !== 'stall') {
                next(cur);
            }
        }
    }
    return function(evt) {
        queue.push(evt);
        process();
    };
};

// Keeps track of which keys we (and the server) believe are down
// When a keyup is received, match it against this list, to determine the corresponding keysym(s)
// in some cases, a single key may produce multiple keysyms, so the corresponding keyup event must release all of these chars
// key repeat events should be merged into a single entry.
// Because we can't always identify which entry a keydown or keyup event corresponds to, we sometimes have to guess
export function TrackKeyState (next) {
    "use strict";
    var state = [];

    return function (evt) {
        var last = state.length !== 0 ? state[state.length-1] : null;

        switch (evt.type) {
        case 'keydown':
            // insert a new entry if last seen key was different.
            if (!last || evt.code === 'Unidentified' || last.code !== evt.code) {
                last = {code: evt.code, keysyms: {}};
                state.push(last);
            }
            if (evt.keysym) {
                // make sure last event contains this keysym (a single "logical" keyevent
                // can cause multiple key events to be sent to the VNC server)
                last.keysyms[evt.keysym] = evt.keysym;
                last.ignoreKeyPress = true;
                next(evt);
            }
            break;
        case 'keypress':
            if (!last) {
                last = {code: evt.code, keysyms: {}};
                state.push(last);
            }
            if (!evt.keysym) {
                console.log('keypress with no keysym:', evt);
            }

            // If we didn't expect a keypress, and already sent a keydown to the VNC server
            // based on the keydown, make sure to skip this event.
            if (evt.keysym && !last.ignoreKeyPress) {
                last.keysyms[evt.keysym] = evt.keysym;
                evt.type = 'keydown';
                next(evt);
            }
            break;
        case 'keyup':
            if (state.length === 0) {
                return;
            }
            var idx = null;
            // do we have a matching key tracked as being down?
            for (var i = 0; i !== state.length; ++i) {
                if (state[i].code === evt.code) {
                    idx = i;
                    break;
                }
            }
            // if we couldn't find a match (it happens), assume it was the last key pressed
            if (idx === null) {
                idx = state.length - 1;
            }

            var item = state.splice(idx, 1)[0];
            // for each keysym tracked by this key entry, clone the current event and override the keysym
            var clone = (function(){
                function Clone(){}
                return function (obj) { Clone.prototype=obj; return new Clone(); };
            }());
            for (var key in item.keysyms) {
                var out = clone(evt);
                out.keysym = item.keysyms[key];
                next(out);
            }
            break;
        case 'releaseall':
            /* jshint shadow: true */
            for (var i = 0; i < state.length; ++i) {
                for (var key in state[i].keysyms) {
                    var keysym = state[i].keysyms[key];
                    next({code: 'Unidentified', keysym: keysym, type: 'keyup'});
                }
            }
            /* jshint shadow: false */
            state = [];
        }
    };
};

// Handles "escaping" of modifiers: if a char modifier is used to produce a keysym (such as AltGr-2 to generate an @),
// then the modifier must be "undone" before sending the @, and "redone" afterwards.
export function EscapeModifiers (next) {
    "use strict";
    return function(evt) {
        if (evt.type !== 'keydown' || evt.escape === undefined) {
            next(evt);
            return;
        }
        // undo modifiers
        for (var i = 0; i < evt.escape.length; ++i) {
            next({type: 'keyup', code: 'Unidentified', keysym: evt.escape[i]});
        }
        // send the character event
        next(evt);
        // redo modifiers
        /* jshint shadow: true */
        for (var i = 0; i < evt.escape.length; ++i) {
            next({type: 'keydown', code: 'Unidentified', keysym: evt.escape[i]});
        }
        /* jshint shadow: false */
    };
};
