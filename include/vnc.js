/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2011 Joel Martin
 * Licensed under LGPL-3 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 */

/*jslint evil: true */
/*global window, document, INCLUDE_URI */

/*
 * Load supporting scripts
 */
function get_INCLUDE_URI() {
    return (typeof INCLUDE_URI !== "undefined") ? INCLUDE_URI : "include/";
}

(function () {
    "use strict";

    var extra = "", start, end;

    start = "<script src='" + get_INCLUDE_URI();
    end = "'><\/script>";

    // Uncomment to activate firebug lite
    //extra += "<script src='http://getfirebug.com/releases/lite/1.2/" + 
    //         "firebug-lite-compressed.js'><\/script>";

    extra += start + "util.js" + end;
    extra += start + "webutil.js" + end;
    extra += start + "base64.js" + end;
    extra += start + "websock.js" + end;
    extra += start + "des.js" + end;
    extra += start + "input.js" + end;
    extra += start + "display.js" + end;
    extra += start + "rfb.js" + end;
    extra += start + "jsunzip.js" + end;

    document.write(extra);
}());

