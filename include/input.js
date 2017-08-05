/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2012 Joel Martin
 * Copyright (C) 2013 Samuel Mannehed for Cendio AB
 * Licensed under MPL 2.0 or any later version (see LICENSE.txt)
 */

/*jslint browser: true, white: false, bitwise: false */
/*global window, Util */


//
// Keyboard event handler
//

function Keyboard(defaults) {
"use strict";

var that           = {},  // Public API methods
    conf           = {},  // Configuration attributes

    keyDownList    = [];         // List of depressed keys 
                                 // (even if they are happy)

// Configuration attributes
Util.conf_defaults(conf, that, defaults, [
    ['target',      'wo', 'dom',  document, 'DOM element that captures keyboard input'],
    ['focused',     'rw', 'bool', true, 'Capture and send key events'],

    ['onKeyPress',  'rw', 'func', null, 'Handler for key press/release']
    ]);


// 
// Private functions
//

/////// setup

function onRfbEvent(evt) {
    if (conf.onKeyPress) {
        Util.Debug("onKeyPress " + (evt.type == 'keydown' ? "down" : "up")
        + ", keysym: " + evt.keysym.keysym + "(" + evt.keysym.keyname + ")");
        conf.onKeyPress(evt.keysym.keysym, evt.type == 'keydown');
    }
}

// create the keyboard handler
var k = KeyEventDecoder(kbdUtil.ModifierSync(),
    VerifyCharModifier(
        TrackKeyState(
            EscapeModifiers(onRfbEvent)
        )
    )
);

function onKeyDown(e) {
    if (! conf.focused) {
        return true;
    }
    if (k.keydown(e)) {
        // Suppress bubbling/default actions
        Util.stopEvent(e);
        return false;
    } else {
        // Allow the event to bubble and become a keyPress event which
        // will have the character code translated
        return true;
    }
}
function onKeyPress(e) {
    if (! conf.focused) {
        return true;
    }
    if (k.keypress(e)) {
        // Suppress bubbling/default actions
        Util.stopEvent(e);
        return false;
    } else {
        // Allow the event to bubble and become a keyPress event which
        // will have the character code translated
        return true;
    }
}

function onKeyUp(e) {
    if (! conf.focused) {
        return true;
    }
    if (k.keyup(e)) {
        // Suppress bubbling/default actions
        Util.stopEvent(e);
        return false;
    } else {
        // Allow the event to bubble and become a keyPress event which
        // will have the character code translated
        return true;
    }
}

function onOther(e) {
    k.syncModifiers(e);
}

function allKeysUp() {
    Util.Debug(">> Keyboard.allKeysUp");

    k.releaseAll();
    Util.Debug("<< Keyboard.allKeysUp");
}

//
// Public API interface functions
//

that.grab = function() {
    //Util.Debug(">> Keyboard.grab");
    var c = conf.target;

    Util.addEvent(c, 'keydown', onKeyDown);
    Util.addEvent(c, 'keyup', onKeyUp);
    Util.addEvent(c, 'keypress', onKeyPress);

    // Release (key up) if window loses focus
    Util.addEvent(window, 'blur', allKeysUp);

    //Util.Debug("<< Keyboard.grab");
};

that.ungrab = function() {
    //Util.Debug(">> Keyboard.ungrab");
    var c = conf.target;

    Util.removeEvent(c, 'keydown', onKeyDown);
    Util.removeEvent(c, 'keyup', onKeyUp);
    Util.removeEvent(c, 'keypress', onKeyPress);
    Util.removeEvent(window, 'blur', allKeysUp);

    // Release (key up) all keys that are in a down state
    allKeysUp();

    //Util.Debug(">> Keyboard.ungrab");
};

that.sync = function(e) {
    k.syncModifiers(e);
}

return that;  // Return the public API interface

}  // End of Keyboard()


//
// Mouse event handler
//

function Mouse(defaults) {
"use strict";

var that           = {},  // Public API methods
    conf           = {},  // Configuration attributes
    mouseCaptured  = false;

var doubleClickTimer = null,
    lastTouchPos = null;

// Configuration attributes
Util.conf_defaults(conf, that, defaults, [
    ['target',         'ro', 'dom',  document, 'DOM element that captures mouse input'],
    ['notify',         'ro', 'func',  null, 'Function to call to notify whenever a mouse event is received'],
    ['focused',        'rw', 'bool', true, 'Capture and send mouse clicks/movement'],
    ['scale',          'rw', 'float', 1.0, 'Viewport scale factor 0.0 - 1.0'],

    ['onMouseButton',  'rw', 'func', null, 'Handler for mouse button click/release'],
    ['onMouseMove',    'rw', 'func', null, 'Handler for mouse movement'],
    ['touchButton',    'rw', 'int', 1, 'Button mask (1, 2, 4) for touch devices (0 means ignore clicks)']
    ]);

function captureMouse() {
    // capturing the mouse ensures we get the mouseup event
    if (conf.target.setCapture) {
        conf.target.setCapture();
    }

    // some browsers give us mouseup events regardless,
    // so if we never captured the mouse, we can disregard the event
    mouseCaptured = true;
}

function releaseMouse() {
    if (conf.target.releaseCapture) {
        conf.target.releaseCapture();
    }
    mouseCaptured = false;
}
// 
// Private functions
//

function resetDoubleClickTimer() {
    doubleClickTimer = null;
}

function onMouseButton(e, down) {
    var evt, pos, bmask;
    if (! conf.focused) {
        return true;
    }

    if (conf.notify) {
        conf.notify(e);
    }

    evt = (e ? e : window.event);
    pos = Util.getEventPosition(e, conf.target, conf.scale);

    if (e.touches || e.changedTouches) {
        // Touch device

        // When two touches occur within 500 ms of each other and are
        // closer than 20 pixels together a double click is triggered.
        if (down == 1) {
            if (doubleClickTimer == null) {
                lastTouchPos = pos;
            } else {
                clearTimeout(doubleClickTimer); 

                // When the distance between the two touches is small enough
                // force the position of the latter touch to the position of
                // the first.

                var xs = lastTouchPos.x - pos.x;
                var ys = lastTouchPos.y - pos.y;
                var d = Math.sqrt((xs * xs) + (ys * ys));

                // The goal is to trigger on a certain physical width, the
                // devicePixelRatio brings us a bit closer but is not optimal.
                if (d < 20 * window.devicePixelRatio) {
                    pos = lastTouchPos;
                }
            }
            doubleClickTimer = setTimeout(resetDoubleClickTimer, 500);
        }
        bmask = conf.touchButton;
        // If bmask is set
    } else if (evt.which) {
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
    if (conf.onMouseButton) {
        Util.Debug("onMouseButton " + (down ? "down" : "up") +
                   ", x: " + pos.x + ", y: " + pos.y + ", bmask: " + bmask);
        conf.onMouseButton(pos.x, pos.y, down, bmask);
    }
    Util.stopEvent(e);
    return false;
}

function onMouseDown(e) {
    captureMouse();
    onMouseButton(e, 1);
}

function onMouseUp(e) {
    if (!mouseCaptured) {
        return;
    }

    onMouseButton(e, 0);
    releaseMouse();
}

function onMouseWheel(e) {
    var evt, pos, bmask, wheelData;
    if (! conf.focused) {
        return true;
    }
    if (conf.notify) {
        conf.notify(e);
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
    if (conf.onMouseButton) {
        conf.onMouseButton(pos.x, pos.y, 1, bmask);
        conf.onMouseButton(pos.x, pos.y, 0, bmask);
    }
    Util.stopEvent(e);
    return false;
}

function onMouseMove(e) {
    var evt, pos;
    if (! conf.focused) {
        return true;
    }
    if (conf.notify) {
        conf.notify(e);
    }

    evt = (e ? e : window.event);
    pos = Util.getEventPosition(e, conf.target, conf.scale);
    //Util.Debug('mouse ' + evt.which + '/' + evt.button + ' up:' + pos.x + "," + pos.y);
    if (conf.onMouseMove) {
        conf.onMouseMove(pos.x, pos.y);
    }
    Util.stopEvent(e);
    return false;
}

function onMouseDisable(e) {
    var evt, pos;
    if (! conf.focused) {
        return true;
    }
    evt = (e ? e : window.event);
    pos = Util.getEventPosition(e, conf.target, conf.scale);
    /* Stop propagation if inside canvas area */
    if ((pos.realx >= 0) && (pos.realy >= 0) &&
        (pos.realx < conf.target.offsetWidth) &&
        (pos.realy < conf.target.offsetHeight)) {
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

    if ('ontouchstart' in document.documentElement) {
        Util.addEvent(c, 'touchstart', onMouseDown);
        Util.addEvent(window, 'touchend', onMouseUp);
        Util.addEvent(c, 'touchend', onMouseUp);
        Util.addEvent(c, 'touchmove', onMouseMove);
    } else {
        Util.addEvent(c, 'mousedown', onMouseDown);
        Util.addEvent(window, 'mouseup', onMouseUp);
        Util.addEvent(c, 'mouseup', onMouseUp);
        Util.addEvent(c, 'mousemove', onMouseMove);
        Util.addEvent(c, (Util.Engine.gecko) ? 'DOMMouseScroll' : 'mousewheel',
                onMouseWheel);
    }

    /* Work around right and middle click browser behaviors */
    Util.addEvent(document, 'click', onMouseDisable);
    Util.addEvent(document.body, 'contextmenu', onMouseDisable);

    //Util.Debug("<< Mouse.grab");
};

that.ungrab = function() {
    //Util.Debug(">> Mouse.ungrab");
    var c = conf.target;

    if ('ontouchstart' in document.documentElement) {
        Util.removeEvent(c, 'touchstart', onMouseDown);
        Util.removeEvent(window, 'touchend', onMouseUp);
        Util.removeEvent(c, 'touchend', onMouseUp);
        Util.removeEvent(c, 'touchmove', onMouseMove);
    } else {
        Util.removeEvent(c, 'mousedown', onMouseDown);
        Util.removeEvent(window, 'mouseup', onMouseUp);
        Util.removeEvent(c, 'mouseup', onMouseUp);
        Util.removeEvent(c, 'mousemove', onMouseMove);
        Util.removeEvent(c, (Util.Engine.gecko) ? 'DOMMouseScroll' : 'mousewheel',
                onMouseWheel);
    }

    /* Work around right and middle click browser behaviors */
    Util.removeEvent(document, 'click', onMouseDisable);
    Util.removeEvent(document.body, 'contextmenu', onMouseDisable);

    //Util.Debug(">> Mouse.ungrab");
};

return that;  // Return the public API interface

}  // End of Mouse()
