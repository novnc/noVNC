/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2012 Joel Martin
 * Licensed under MPL 2.0 (see LICENSE.txt)
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
/*
 * Dynamically load a script without using document.write()
 * Reference: http://unixpapa.com/js/dyna.html
 */
function load_scripts(base, files) {
    var head = document.getElementsByTagName('head')[0];
    for (var i=0; i<files.length; i++) {
        var script = document.createElement('script');
        script.type = 'text/javascript';
        script.src = base + files[i];
        head.appendChild(script);
    }
}

load_scripts(get_INCLUDE_URI(),
    ["util.js", "webutil.js", "base64.js", "websock.js", "des.js",
     "input.js", "display.js", "rfb.js", "jsunzip.js"]);

