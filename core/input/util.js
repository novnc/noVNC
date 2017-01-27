import KeyTable from "./keysym.js";
import keysyms from "./keysymdef.js";
import vkeys from "./vkeys.js";
import fixedkeys from "./fixedkeys.js";

function isMac() {
    return navigator && !!(/mac/i).exec(navigator.platform);
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
export function getKeysym(evt){

    // We start with layout independent keys
    var code = getKeycode(evt);
    if (code in fixedkeys) {
        return fixedkeys[code];
    }

    // Next with mildly layout or state sensitive stuff

    // Like AltGraph
    if (code === 'AltRight') {
        if (evt.key === 'AltGraph') {
            return KeyTable.XK_ISO_Level3_Shift;
        } else {
            return KeyTable.XK_Alt_R;
        }
    }

    // Or the numpad
    if (evt.location === 3) {
        var key = evt.key;

        // IE and Edge use some ancient version of the spec
        // https://developer.microsoft.com/en-us/microsoft-edge/platform/issues/8860571/
        switch (key) {
            case 'Up': key = 'ArrowUp'; break;
            case 'Left': key = 'ArrowLeft'; break;
            case 'Right': key = 'ArrowRight'; break;
            case 'Down': key = 'ArrowDown'; break;
            case 'Del': key = 'Delete'; break;
        }

        // Safari doesn't support KeyboardEvent.key yet
        if ((key === undefined) && (evt.charCode)) {
            key = String.fromCharCode(evt.charCode);
        }

        switch (key) {
            case '0': return KeyTable.XK_KP_0;
            case '1': return KeyTable.XK_KP_1;
            case '2': return KeyTable.XK_KP_2;
            case '3': return KeyTable.XK_KP_3;
            case '4': return KeyTable.XK_KP_4;
            case '5': return KeyTable.XK_KP_5;
            case '6': return KeyTable.XK_KP_6;
            case '7': return KeyTable.XK_KP_7;
            case '8': return KeyTable.XK_KP_8;
            case '9': return KeyTable.XK_KP_9;
            // There is utter mayhem in the world when it comes to which
            // character to use as a decimal separator...
            case '.': return KeyTable.XK_KP_Decimal;
            case ',': return KeyTable.XK_KP_Separator;
            case 'Home': return KeyTable.XK_KP_Home;
            case 'End': return KeyTable.XK_KP_End;
            case 'PageUp': return KeyTable.XK_KP_Prior;
            case 'PageDown': return KeyTable.XK_KP_Next;
            case 'Insert': return KeyTable.XK_KP_Insert;
            case 'Delete': return KeyTable.XK_KP_Delete;
            case 'ArrowUp': return KeyTable.XK_KP_Up;
            case 'ArrowLeft': return KeyTable.XK_KP_Left;
            case 'ArrowRight': return KeyTable.XK_KP_Right;
            case 'ArrowDown': return KeyTable.XK_KP_Down;
        }
    }

    // Now we need to look at the Unicode symbol instead

    var codepoint;

    if ('key' in evt) {
        // Special key? (FIXME: Should have been caught earlier)
        if (evt.key.length !== 1) {
            return null;
        }

        codepoint = evt.key.charCodeAt();
    } else if ('charCode' in evt) {
        codepoint = evt.charCode;
    }

    if (codepoint) {
        return keysyms.lookup(codepoint);
    }

    return null;
}
