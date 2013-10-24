function isMac() {
    return navigator && !!(/macintosh/i).exec(navigator.appVersion);
}
function isWindows() {
    return navigator && !!(/windows/i).exec(navigator.appVersion);
}
function isLinux() {
    return navigator && !!(/linux/i).exec(navigator.appVersion);
}

// on Mac, Option (AKA Alt) is used as a char modifier
var charModifierListMac = [0xffe9];
// on Windows, Ctrl+Alt is used as a char modifier
var charModifierListWin = [0xffe9, 0xffe3];
// on Linux, AltGr is used as a char modifier
var charModifierListLinux = [0xfe03]

// Return true if a modifier which is not the specified char modifier (and is not shift) is down
function hasShortcutModifier(charModifier, currentModifiers) {
    var mods = {};
    for (var key in currentModifiers) {
        if (key != 0xffe1) {
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
function hasCharModifier(charModifier, currentModifiers) {
    if (charModifier == []) { return false; }

    for (var i = 0; i < charModifier.length; ++i) {
        if (!currentModifiers[charModifier[i]]) {
            return false;
        }
    }
    return true;
}

// Helper object tracking modifier key state
// and generates fake key events to compensate if it gets out of sync
function ModifierSync(charModifier) {
    if (!charModifier) {
        if (isMac()) {
            charModifier = charModifierListMac;
        }
        else if (isWindows()) {
            charModifier = charModifierListWin;
        }
        else if (isLinux()) {
            charModifier = charModifierListLinux;
        }
        else {
            charModifier = [];
        }
    }
    var ctrl = 0xffe3;
    var alt = 0xffe9;
    var altGr = 0xfe03;
    var shift = 0xffe1;
    var meta = 0xffe7; 

    var state = {};
    state[ctrl] = false;
    state[alt] = false;
    state[altGr] = false;
    state[shift] = false;
    state[meta] = false;

    
    function sync(evt, keysym) {
        var result = [];
        function syncKey(keysym) {
            return {keysym: keysyms.lookup(keysym), type: state[keysym] ? 'keydown' : 'keyup'};
        }
        
        if (evt.ctrlKey !== undefined && evt.ctrlKey !== state[ctrl] && keysym !== ctrl) {
            state[ctrl] = evt.ctrlKey;
            result.push(syncKey(ctrl));
        }
        if (evt.altKey !== undefined && evt.altKey !== state[alt] && keysym !== alt) {
            state[alt] = evt.altKey;
            result.push(syncKey(alt));
        }
        if (evt.altGraphKey !== undefined && evt.altGraphKey !== state[altGr] && keysym !== altGr) {
            state[altGr] = evt.altGraphKey;
            result.push(syncKey(altGr));
        }
        if (evt.shiftKey !== undefined && evt.shiftKey !== state[shift] && keysym !== shift) {
            state[shift] = evt.shiftKey;
            result.push(syncKey(shift));
        }
        if (evt.metaKey !== undefined && evt.metaKey !== state[meta] && keysym !== meta) {
            state[meta] = evt.metaKey;
            result.push(syncKey(meta));
        }
        return result;
    }
    function syncKeyEvent(evt, down) {
        var obj = getKeysym(evt);
        var keysym = obj ? obj.keysym : null;

        // first, apply the event itself, if relevant
        if (keysym != null && state[keysym] !== undefined) {
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

// Get a key ID from a keyboard event
// May be a string or an integer depending on the available properties
function getKey(evt){
    if (evt.key) {
        return evt.key;
    }
    else {
        return evt.keyCode;
    }
}

// Get the most reliable keysym value we can get from a key event
// if char/charCode is available, prefer those, otherwise fall back to key/keyCode/which
function getKeysym(evt){
    if (evt.char && evt.char.length === 1) {
        var codepoint = evt.char.charCodeAt();
        var res = keysyms.fromUnicode(codepoint);
        if (res) {
            return res;
        }
    }
    if (evt.charCode) {
        var res = keysyms.fromUnicode(evt.charCode);
        if (res) {
            return res;
        }
    }
    // we could check evt.key here.
    // Legal values are defined in http://www.w3.org/TR/DOM-Level-3-Events/#key-values-list,
    // so we "just" need to map them to keysym, but AFAIK this is only available in IE10, which also provides evt.key
    // so we don't *need* it yet
    if (evt.keyCode) {
        return keysyms.lookup(keysymFromKeyCode(evt.keyCode, evt.shiftKey));
    }
    if (evt.which) {
        return keysyms.lookup(keysymFromKeyCode(evt.which, evt.shiftKey));
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
		return 0xffb0 + (keycode - 0x60); // numpad 0-9
	}

    switch(keycode) {
		case 0x20: return 0x20; // space
		case 0x6a: return 0xffaa; // multiply
		case 0x6b: return 0xffab; // add
		case 0x6c: return 0xffac; // separator
		case 0x6d: return 0xffad; // subtract
		case 0x6e: return 0xffae; // decimal
		case 0x6f: return 0xffaf; // divide
		case 0xbb: return 0x2b; // +
		case 0xbc: return 0x2c; // ,
		case 0xbd: return 0x2d; // -
		case 0xbe: return 0x2e; // .
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
		return 0xffbe + keycode - 0x70; // F1-F24
	}
	switch (keycode) {
        
        case 8 : return 0xFF08; // BACKSPACE
        case 13 : return 0xFF0D; // ENTER

        case 9 : return 0xFF09; // TAB

		case 27 : return 0xFF1B; // ESCAPE
		case 46 : return 0xFFFF; // DELETE

		case 36 : return 0xFF50; // HOME
		case 35 : return 0xFF57; // END
		case 33 : return 0xFF55; // PAGE_UP
		case 34 : return 0xFF56; // PAGE_DOWN
		case 45 : return 0xFF63; // INSERT
												 
		case 37 : return 0xFF51; // LEFT
		case 38 : return 0xFF52; // UP
		case 39 : return 0xFF53; // RIGHT
		case 40 : return 0xFF54; // DOWN
		case 16 : return 0xFFE1; // SHIFT
		case 17 : return 0xFFE3; // CONTROL
		case 18 : return 0xFFE9; // Left ALT (Mac Option)

		case 224 : return 0xFE07; // Meta
        case 225 : return 0xFE03; // AltGr
		case 91 : return 0xFFEC; // Super_L (Win Key)
        case 92 : return 0xFFED; // Super_R (Win Key)
		case 93 : return 0xFF67; // Menu (Win Menu), Mac Command
		default: return null;
    }
}
