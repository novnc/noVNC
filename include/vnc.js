/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2012 Joel Martin
 * Licensed under LGPL-3 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 */

/*jslint evil: true */
/*global window, document, INCLUDE_URI */

var NoVnc = {};
NoVnc.onload = null;
NoVnc.init_scripts = [];
NoVnc.loading = 0;


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

    function onloadhook () {
        if (this.initState)  //Already initialized
            return;
        this.initState = true;
        NoVnc.loading--;
        initscripts();
        if (NoVnc.loading === 0 && !!NoVnc.onload) {
            NoVnc.onload();
            NoVnc.onload = null;
        }
    }
    function initscripts() {
        // Call the initialization routines in register order when all
        // the scripts have been loaded.
        // Notice: These routines may also call load_scripts to start
        //         loading other scripts.
        while (NoVnc.loading === 0 && NoVnc.init_scripts.length > 0) {
            var script = NoVnc.init_scripts[0];
            NoVnc.init_scripts.splice(0, 1);
            // It is assumed that ABC.js should have _init_ABC() to
            // initialize itself.
            var f = script.src.split("/");
            f = "_init_" + f[f.length -1].split(".")[0].replace(/[\-\+]/,"_");
            eval("if (typeof " + f + " !== 'undefined') " + f + "()");
        }
    }

    for (var i=0; i<files.length; i++) {
        var script = document.createElement('script');
        script.type = 'text/javascript';
        NoVnc.loading++;
        script.onload = onloadhook;
        script.onreadystatechange = function () {
            if (this.readyState == 'complete' || this.readyState == 'loaded')
                this.onload();
        }
        script.initState = false;
        script.src = base + files[i];
        head.appendChild(script);
        NoVnc.init_scripts = NoVnc.init_scripts.concat([script]);

    }
}

load_scripts(get_INCLUDE_URI(),
    ["util.js", "webutil.js", "base64.js", "websock.js", "des.js",
     "input.js", "display.js", "rfb.js", "jsunzip.js"]);

