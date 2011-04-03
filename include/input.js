/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2011 Joel Martin
 * Licensed under LGPL-3 (see LICENSE.txt)
 */

/*jslint browser: true, white: false, bitwise: false */
/*global window, Util */


//
// Keyboard event handler
//

function Keyboard(conf) {
    "use strict";

conf               = conf || {}; // Configuration
var that           = {};         // Public API interface


// Configuration settings
function cdef(v, type, defval, desc) {
    Util.conf_default(conf, that, v, type, defval, desc); }

// Capability settings, default can be overridden
cdef('target',         'dom',  document, 'DOM element that grabs keyboard input');
cdef('focused',        'bool', true, 'Capture and send key strokes');

cdef('keyPress',       'func', null, 'Handler for key press/release');

that.set_target = function () { throw("target cannot be changed"); }

// 
// Private functions
//

function onKeyDown(e) {
    //Util.Debug("keydown: " + that.getKeysym(e));
    if (! conf.focused) {
        return true;
    }
    if (conf.keyPress) {
        conf.keyPress(that.getKeysym(e), 1, e.ctrlKey, e.shiftKey, e.altKey);
    }
    Util.stopEvent(e);
    return false;
}

function onKeyUp(e) {
    //Util.Debug("keyup: " + that.getKeysym(e));
    if (! conf.focused) {
        return true;
    }
    if (conf.keyPress) {
        conf.keyPress(that.getKeysym(e), 0, e.ctrlKey, e.shiftKey, e.altKey);
    }
    Util.stopEvent(e);
    return false;
}

function onKeyPress(e) {
    //Util.Debug("keypress: " + e.charCode);
    if (! conf.focused) {
        return true;
    }
    // Stop keypress events. Necessary for Opera because stopping
    // keydown and keyup events still results in a keypress event.
    Util.stopEvent(e);
    return false;
}

//
// Public API interface functions
//

/* Translate DOM key down/up event to keysym value */
that.getKeysym = function getKeysym(e) {
    var evt, keysym;
    evt = (e ? e : window.event);
    /*
    Util.Debug(">> getKeysym - keyCode: " + evt.keyCode + ", which: " + evt.which +
            ", charCode: " + evt.charCode + ", keyIdentifier: " + evt.keyIdentifier +
            ", altKey: " + evt.altKey + ", ctrlKey: " + evt.ctrlKey +
            ", shiftKey: " + evt.shiftKey + ", metaKey: " + evt.metaKey +
            ", type: " + evt.type + ", keyLocation: " + evt.keyLocation);
    */

    /* Remap modifier and special keys */
    switch ( evt.keyCode ) {
        case 8         : keysym = 0xFF08; break; // BACKSPACE
        case 9         : keysym = 0xFF09; break; // TAB
        case 13        : keysym = 0xFF0D; break; // ENTER
        case 27        : keysym = 0xFF1B; break; // ESCAPE
        case 45        : keysym = 0xFF63; break; // INSERT
        case 46        : keysym = 0xFFFF; break; // DELETE
        case 36        : keysym = 0xFF50; break; // HOME
        case 35        : keysym = 0xFF57; break; // END
        case 33        : keysym = 0xFF55; break; // PAGE_UP
        case 34        : keysym = 0xFF56; break; // PAGE_DOWN
        case 37        : keysym = 0xFF51; break; // LEFT
        case 38        : keysym = 0xFF52; break; // UP
        case 39        : keysym = 0xFF53; break; // RIGHT
        case 40        : keysym = 0xFF54; break; // DOWN
        case 112       : keysym = 0xFFBE; break; // F1
        case 113       : keysym = 0xFFBF; break; // F2
        case 114       : keysym = 0xFFC0; break; // F3
        case 115       : keysym = 0xFFC1; break; // F4
        case 116       : keysym = 0xFFC2; break; // F5
        case 117       : keysym = 0xFFC3; break; // F6
        case 118       : keysym = 0xFFC4; break; // F7
        case 119       : keysym = 0xFFC5; break; // F8
        case 120       : keysym = 0xFFC6; break; // F9
        case 121       : keysym = 0xFFC7; break; // F10
        case 122       : keysym = 0xFFC8; break; // F11
        case 123       : keysym = 0xFFC9; break; // F12
        case 16        : keysym = 0xFFE1; break; // SHIFT
        case 17        : keysym = 0xFFE3; break; // CONTROL
        //case 18        : keysym = 0xFFE7; break; // Left Meta (Mac Option)
        case 18        : keysym = 0xFFE9; break; // Left ALT (Mac Command)
        default        : keysym = evt.keyCode; break;
    }

    /* Remap symbols */
    switch (keysym) {
        case 186       : keysym = 59; break; // ;  (IE)
        case 187       : keysym = 61; break; // =  (IE)
        case 188       : keysym = 44; break; // ,  (Mozilla, IE)
        case 109       :                     // -  (Mozilla, Opera)
            if (Util.Engine.gecko || Util.Engine.presto) {
                         keysym = 45; }
                                      break;
        case 189       : keysym = 45; break; // -  (IE)
        case 190       : keysym = 46; break; // .  (Mozilla, IE)
        case 191       : keysym = 47; break; // /  (Mozilla, IE)
        case 192       : keysym = 96; break; // `  (Mozilla, IE)
        case 219       : keysym = 91; break; // [  (Mozilla, IE)
        case 220       : keysym = 92; break; // \  (Mozilla, IE)
        case 221       : keysym = 93; break; // ]  (Mozilla, IE)
        case 222       : keysym = 39; break; // '  (Mozilla, IE)
    }
    
    /* Remap shifted and unshifted keys */
    if (!!evt.shiftKey) {
        switch (keysym) {
            case 48        : keysym = 41 ; break; // )  (shifted 0)
            case 49        : keysym = 33 ; break; // !  (shifted 1)
            case 50        : keysym = 64 ; break; // @  (shifted 2)
            case 51        : keysym = 35 ; break; // #  (shifted 3)
            case 52        : keysym = 36 ; break; // $  (shifted 4)
            case 53        : keysym = 37 ; break; // %  (shifted 5)
            case 54        : keysym = 94 ; break; // ^  (shifted 6)
            case 55        : keysym = 38 ; break; // &  (shifted 7)
            case 56        : keysym = 42 ; break; // *  (shifted 8)
            case 57        : keysym = 40 ; break; // (  (shifted 9)

            case 59        : keysym = 58 ; break; // :  (shifted `)
            case 61        : keysym = 43 ; break; // +  (shifted ;)
            case 44        : keysym = 60 ; break; // <  (shifted ,)
            case 45        : keysym = 95 ; break; // _  (shifted -)
            case 46        : keysym = 62 ; break; // >  (shifted .)
            case 47        : keysym = 63 ; break; // ?  (shifted /)
            case 96        : keysym = 126; break; // ~  (shifted `)
            case 91        : keysym = 123; break; // {  (shifted [)
            case 92        : keysym = 124; break; // |  (shifted \)
            case 93        : keysym = 125; break; // }  (shifted ])
            case 39        : keysym = 34 ; break; // "  (shifted ')
        }
    } else if ((keysym >= 65) && (keysym <=90)) {
        /* Remap unshifted A-Z */
        keysym += 32;
    } else if (evt.keyLocation === 3) {
        // numpad keys
        switch (keysym) {
            case 96 : keysym = 48; break; // 0
            case 97 : keysym = 49; break; // 1
            case 98 : keysym = 50; break; // 2
            case 99 : keysym = 51; break; // 3
            case 100: keysym = 52; break; // 4
            case 101: keysym = 53; break; // 5
            case 102: keysym = 54; break; // 6
            case 103: keysym = 55; break; // 7
            case 104: keysym = 56; break; // 8
            case 105: keysym = 57; break; // 9
            case 109: keysym = 45; break; // -
            case 110: keysym = 46; break; // .
            case 111: keysym = 47; break; // /
        }
    }

    return keysym;
};


that.grab = function() {
    //Util.Debug(">> Keyboard.grab");
    var c = conf.target;

    Util.addEvent(c, 'keydown', onKeyDown);
    Util.addEvent(c, 'keyup', onKeyUp);
    Util.addEvent(c, 'keypress', onKeyPress);

    //Util.Debug("<< Keyboard.grab");
};

that.ungrab = function() {
    //Util.Debug(">> Keyboard.ungrab");
    var c = conf.target;

    Util.removeEvent(c, 'keydown', onKeyDown);
    Util.removeEvent(c, 'keyup', onKeyUp);
    Util.removeEvent(c, 'keypress', onKeyPress);

    //Util.Debug(">> Keyboard.ungrab");
};

return that;  // Return the public API interface

}  // End of Keyboard()


//
// Mouse event handler
//

function Mouse(conf) {
    "use strict";

conf               = conf || {}; // Configuration
var that           = {};         // Public API interface


// Configuration settings
function cdef(v, type, defval, desc) {
    Util.conf_default(conf, that, v, type, defval, desc); }

// Capability settings, default can be overridden
cdef('target',         'dom',  document, 'DOM element that grabs mouse input');
cdef('focused',        'bool', true, 'Capture and send mouse clicks/movement');

cdef('mouseButton',    'func', null, 'Handler for mouse button click/release');
cdef('mouseMove',      'func', null, 'Handler for mouse movement');

that.set_target = function () { throw("target cannot be changed"); }

// 
// Private functions
//

function onMouseButton(e, down) {
    var evt, pos, bmask;
    if (! conf.focused) {
        return true;
    }
    evt = (e ? e : window.event);
    pos = Util.getEventPosition(e, conf.target, conf.scale);
    if (evt.which) {
        /* everything except IE */
        bmask = 1 << evt.button;
    } else {
        /* IE including 9 */
        bmask = (evt.button & 0x1) +      // Left
                (evt.button & 0x2) * 2 +  // Right
                (evt.button & 0x4) / 2;   // Middle
    }
    //Util.Debug("mouse " + pos.x + "," + pos.y + " down: " + down +
    //           " bmask: " + bmask + "(evt.button: " + evt.button + ")");
    if (conf.mouseButton) {
        conf.mouseButton(pos.x, pos.y, down, bmask);
    }
    Util.stopEvent(e);
    return false;
}

function onMouseDown(e) {
    onMouseButton(e, 1);
}

function onMouseUp(e) {
    onMouseButton(e, 0);
}

function onMouseWheel(e) {
    var evt, pos, bmask, wheelData;
    if (! conf.focused) {
        return true;
    }
    evt = (e ? e : window.event);
    pos = Util.getEventPosition(e, conf.target, conf.scale);
    wheelData = evt.detail ? evt.detail * -1 : evt.wheelDelta / 40;
    if (wheelData > 0) {
        bmask = 1 << 3;
    } else {
        bmask = 1 << 4;
    }
    //Util.Debug('mouse scroll by ' + wheelData + ':' + pos.x + "," + pos.y);
    if (conf.mouseButton) {
        conf.mouseButton(pos.x, pos.y, 1, bmask);
        conf.mouseButton(pos.x, pos.y, 0, bmask);
    }
    Util.stopEvent(e);
    return false;
}

function onMouseMove(e) {
    var evt, pos;
    if (! conf.focused) {
        return true;
    }
    evt = (e ? e : window.event);
    pos = Util.getEventPosition(e, conf.target, conf.scale);
    //Util.Debug('mouse ' + evt.which + '/' + evt.button + ' up:' + pos.x + "," + pos.y);
    if (conf.mouseMove) {
        conf.mouseMove(pos.x, pos.y);
    }
}

function onMouseDisable(e) {
    var evt, pos;
    if (! conf.focused) {
        return true;
    }
    evt = (e ? e : window.event);
    pos = Util.getEventPosition(e, conf.target, conf.scale);
    /* Stop propagation if inside canvas area */
    if ((pos.x >= 0) && (pos.y >= 0) &&
        (pos.x < conf.target.offsetWidth) &&
        (pos.y < conf.target.offsetHeight)) {
        //Util.Debug("mouse event disabled");
        Util.stopEvent(e);
        return false;
    }
    //Util.Debug("mouse event not disabled");
    return true;
}

//
// Public API interface functions
//

that.grab = function() {
    //Util.Debug(">> Mouse.grab");
    var c = conf.target;

    Util.addEvent(c, 'mousedown', onMouseDown);
    Util.addEvent(c, 'mouseup', onMouseUp);
    Util.addEvent(c, 'mousemove', onMouseMove);
    Util.addEvent(c, (Util.Engine.gecko) ? 'DOMMouseScroll' : 'mousewheel',
            onMouseWheel);

    /* Work around right and middle click browser behaviors */
    Util.addEvent(document, 'click', onMouseDisable);
    Util.addEvent(document.body, 'contextmenu', onMouseDisable);

    //Util.Debug("<< Mouse.grab");
};

that.ungrab = function() {
    //Util.Debug(">> Mouse.ungrab");
    var c = conf.target;

    Util.removeEvent(c, 'mousedown', onMouseDown);
    Util.removeEvent(c, 'mouseup', onMouseUp);
    Util.removeEvent(c, 'mousemove', onMouseMove);
    Util.removeEvent(c, (Util.Engine.gecko) ? 'DOMMouseScroll' : 'mousewheel',
            onMouseWheel);

    /* Work around right and middle click browser behaviors */
    Util.removeEvent(document, 'click', onMouseDisable);
    Util.removeEvent(document.body, 'contextmenu', onMouseDisable);

    //Util.Debug(">> Mouse.ungrab");
};

return that;  // Return the public API interface

}  // End of Mouse()

