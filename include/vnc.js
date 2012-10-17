/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2012 Joel Martin
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 */

/*jslint evil: true */
/*global window, document, INCLUDE_URI */

var NoVnc = {};
NoVnc.onload = null;
NoVnc.init_scripts = [];

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
    function onloadhook () {
        if (this.initState)  //Already initialized
            return;
        this.initState = true;
        NoVnc.init_scripts.splice(0, 1);
        if (NoVnc.init_scripts.length > 0)
            start_loading();
        else if (!!NoVnc.onload) {
            NoVnc.onload();
            NoVnc.onload = null;
        }
    }
    function start_loading() {
        var head = document.getElementsByTagName('head')[0];
        var script = document.createElement('script');
        script.type = 'text/javascript';
        script.onload = onloadhook;
        script.onreadystatechange = function () {
            if (this.readyState == 'complete' || this.readyState == 'loaded')
                this.onload();
        }
        script.initState = false;
        script.src = NoVnc.init_scripts[0];
        head.appendChild(script);
    }

    var needtokick = (NoVnc.init_scripts.length === 0);
    for (var i=0; i<files.length; i++) {
        NoVnc.init_scripts = NoVnc.init_scripts.concat([base + files[i]]);
    }
    if (needtokick)
        start_loading();
}

load_scripts(get_INCLUDE_URI(),
    ["util.js", "webutil.js", "base64.js", "websock.js", "des.js",
     "input.js", "display.js", "rfb.js", "jsunzip.js"]);

