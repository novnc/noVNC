/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2010 Joel Martin
 * Licensed under LGPL-3 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 */

"use strict";
/*jslint evil: true */
/*global window, document, VNC_uri_prefix */

// Globals defined here
var VNC_native_ws, WEB_SOCKET_SWF_LOCATION;

/*
 * Load supporting scripts
 */
function get_VNC_uri_prefix() {
    return (typeof VNC_uri_prefix !== "undefined") ? VNC_uri_prefix : "include/";
}

(function () {
    var extra = "", start, end;

    start = "<script src='" + get_VNC_uri_prefix();
    end = "'><\/script>";

    // Uncomment to activate firebug lite
    //extra += "<script src='http://getfirebug.com/releases/lite/1.2/" + 
    //         "firebug-lite-compressed.js'><\/script>";

    extra += start + "util.js" + end;
    extra += start + "webutil.js" + end;
    extra += start + "base64.js" + end;
    extra += start + "des.js" + end;
    extra += start + "canvas.js" + end;
    extra += start + "rfb.js" + end;

    /* If no builtin websockets then load web_socket.js */
    if (window.WebSocket) {
        VNC_native_ws = true;
    } else {
        VNC_native_ws = false;
        WEB_SOCKET_SWF_LOCATION = get_VNC_uri_prefix() +
                    "web-socket-js/WebSocketMain.swf";
        extra += start + "web-socket-js/swfobject.js" + end;
        extra += start + "web-socket-js/FABridge.js" + end;
        extra += start + "web-socket-js/web_socket.js" + end;
    }
    document.write(extra);
}());

