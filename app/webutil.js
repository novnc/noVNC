/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2012 Joel Martin
 * Copyright (C) 2013 NTT corp.
 * Copyright (C) 2017 Pierre Ossman for Cendio AB
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 */

/*jslint bitwise: false, white: false, browser: true, devel: true */

"use strict";

define(['core/util'],
function(Util) {
    var WebUtil = {};

    // init log level reading the logging HTTP param
    WebUtil.init_logging = function (level) {
        if (typeof level === "undefined") {
            var param = document.location.href.match(/logging=([A-Za-z0-9\._\-]*)/);
            if (param !== undefined)
                level = param;
        }
        Util.init_logging(level);
    };


    WebUtil.dirObj = function (obj, depth, parent) {
        if (! depth) { depth = 2; }
        if (! parent) { parent = ""; }

        // Print the properties of the passed-in object
        var msg = "";
        for (var i in obj) {
            if ((depth > 1) && (typeof obj[i] === "object")) {
                // Recurse attributes that are objects
                msg += WebUtil.dirObj(obj[i], depth - 1, parent + "." + i);
            } else {
                //val = new String(obj[i]).replace("\n", " ");
                var val = "";
                if (typeof(obj[i]) === "undefined") {
                    val = "undefined";
                } else {
                    val = obj[i].toString().replace("\n", " ");
                }
                if (val.length > 30) {
                    val = val.substr(0, 30) + "...";
                }
                msg += parent + "." + i + ": " + val + "\n";
            }
        }
        return msg;
    };

    // Read a query string variable
    WebUtil.getQueryVar = function (name, defVal) {
        var re = new RegExp('.*[?&]' + name + '=([^&#]*)'),
            match = document.location.href.match(re);
        if (typeof defVal === 'undefined') { defVal = null; }
        if (match) {
            return decodeURIComponent(match[1]);
        } else {
            return defVal;
        }
    };

    // Read a hash fragment variable
    WebUtil.getHashVar = function (name, defVal) {
        var re = new RegExp('.*[&#]' + name + '=([^&]*)'),
            match = document.location.hash.match(re);
        if (typeof defVal === 'undefined') { defVal = null; }
        if (match) {
            return decodeURIComponent(match[1]);
        } else {
            return defVal;
        }
    };

    // Read a variable from the fragment or the query string
    // Fragment takes precedence
    WebUtil.getConfigVar = function (name, defVal) {
        var val = WebUtil.getHashVar(name);
        if (val === null) {
            val = WebUtil.getQueryVar(name, defVal);
        }
        return val;
    };

    /*
     * Cookie handling. Dervied from: http://www.quirksmode.org/js/cookies.html
     */

    // No days means only for this browser session
    WebUtil.createCookie = function (name, value, days) {
        var date, expires;
        if (days) {
            date = new Date();
            date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
            expires = "; expires=" + date.toGMTString();
        } else {
            expires = "";
        }

        var secure;
        if (document.location.protocol === "https:") {
            secure = "; secure";
        } else {
            secure = "";
        }
        document.cookie = name + "=" + value + expires + "; path=/" + secure;
    };

    WebUtil.readCookie = function (name, defaultValue) {
        var nameEQ = name + "=",
            ca = document.cookie.split(';');

        for (var i = 0; i < ca.length; i += 1) {
            var c = ca[i];
            while (c.charAt(0) === ' ') { c = c.substring(1, c.length); }
            if (c.indexOf(nameEQ) === 0) { return c.substring(nameEQ.length, c.length); }
        }
        return (typeof defaultValue !== 'undefined') ? defaultValue : null;
    };

    WebUtil.eraseCookie = function (name) {
        WebUtil.createCookie(name, "", -1);
    };

    /*
     * Setting handling.
     */

    WebUtil.initSettings = function (callback /*, ...callbackArgs */) {
        var callbackArgs = Array.prototype.slice.call(arguments, 1);
        if (window.chrome && window.chrome.storage) {
            window.chrome.storage.sync.get(function (cfg) {
                WebUtil.settings = cfg;
                console.log(WebUtil.settings);
                if (callback) {
                    callback.apply(this, callbackArgs);
                }
            });
        } else {
            // No-op
            if (callback) {
                callback.apply(this, callbackArgs);
            }
        }
    };

    // No days means only for this browser session
    WebUtil.writeSetting = function (name, value) {
        if (window.chrome && window.chrome.storage) {
            //console.log("writeSetting:", name, value);
            if (WebUtil.settings[name] !== value) {
                WebUtil.settings[name] = value;
                window.chrome.storage.sync.set(WebUtil.settings);
            }
        } else {
            localStorage.setItem(name, value);
        }
    };

    WebUtil.readSetting = function (name, defaultValue) {
        var value;
        if (window.chrome && window.chrome.storage) {
            value = WebUtil.settings[name];
        } else {
            value = localStorage.getItem(name);
        }
        if (typeof value === "undefined") {
            value = null;
        }
        if (value === null && typeof defaultValue !== undefined) {
            return defaultValue;
        } else {
            return value;
        }
    };

    WebUtil.eraseSetting = function (name) {
        if (window.chrome && window.chrome.storage) {
            window.chrome.storage.sync.remove(name);
            delete WebUtil.settings[name];
        } else {
            localStorage.removeItem(name);
        }
    };

    WebUtil.injectParamIfMissing = function (path, param, value) {
        // force pretend that we're dealing with a relative path
        // (assume that we wanted an extra if we pass one in)
        path = "/" + path;

        var elem = document.createElement('a');
        elem.href = path;

        var param_eq = encodeURIComponent(param) + "=";
        var query;
        if (elem.search) {
            query = elem.search.slice(1).split('&');
        } else {
            query = [];
        }

        if (!query.some(function (v) { return v.startsWith(param_eq); })) {
            query.push(param_eq + encodeURIComponent(value));
            elem.search = "?" + query.join("&");
        }

        // some browsers (e.g. IE11) may occasionally omit the leading slash
        // in the elem.pathname string. Handle that case gracefully.
        if (elem.pathname.charAt(0) == "/") {
            return elem.pathname.slice(1) + elem.search + elem.hash;
        } else {
            return elem.pathname + elem.search + elem.hash;
        }
    };

    // Emulate Element.setCapture() when not supported

    var _captureElem;
    var _captureRecursion = false;
    var _captureProxy = function (e) {
        // Recursion protection as we'll see our own event
        if (_captureRecursion) return;

        // Clone the event as we cannot dispatch an already dispatched event
        var newEv = new e.constructor(e.type, e);

        _captureRecursion = true;
        _captureElem.dispatchEvent(newEv);
        _captureRecursion = false;

        // Implicitly release the capture on button release
        if ((e.type === "mouseup") || (e.type === "touchend")) {
            WebUtil.releaseCapture();
        }
    };

    WebUtil.setCapture = function (elem) {
        if (elem.setCapture) {

            elem.setCapture();

            // IE releases capture on 'click' events which might not trigger
            elem.addEventListener('mouseup', WebUtil.releaseCapture);
            elem.addEventListener('touchend', WebUtil.releaseCapture);

        } else {
            // Safari on iOS 9 has a broken constructor for TouchEvent.
            // We are fine in this case however, since Safari seems to
            // have some sort of implicit setCapture magic anyway.
            if (window.TouchEvent !== undefined) {
                try {
                    new TouchEvent("touchstart");
                } catch (TypeError) {
                    return;
                }
            }

            var captureElem = document.getElementById("noVNC_mouse_capture_elem");

            if (captureElem === null) {
                captureElem = document.createElement("div");
                captureElem.id = "noVNC_mouse_capture_elem";
                captureElem.style.position = "fixed";
                captureElem.style.top = "0px";
                captureElem.style.left = "0px";
                captureElem.style.width = "100%";
                captureElem.style.height = "100%";
                captureElem.style.zIndex = 10000;
                captureElem.style.display = "none";
                document.body.appendChild(captureElem);

                captureElem.addEventListener('mousemove', _captureProxy);
                captureElem.addEventListener('mouseup', _captureProxy);

                captureElem.addEventListener('touchmove', _captureProxy);
                captureElem.addEventListener('touchend', _captureProxy);
            }

            _captureElem = elem;
            captureElem.style.display = null;

            // We listen to events on window in order to keep tracking if it
            // happens to leave the viewport
            window.addEventListener('mousemove', _captureProxy);
            window.addEventListener('mouseup', _captureProxy);

            window.addEventListener('touchmove', _captureProxy);
            window.addEventListener('touchend', _captureProxy);
        }
    };

    WebUtil.releaseCapture = function () {
        if (document.releaseCapture) {

            document.releaseCapture();

        } else {
            var captureElem = document.getElementById("noVNC_mouse_capture_elem");
            _captureElem = null;
            captureElem.style.display = "none";

            window.removeEventListener('mousemove', _captureProxy);
            window.removeEventListener('mouseup', _captureProxy);

            window.removeEventListener('touchmove', _captureProxy);
            window.removeEventListener('touchend', _captureProxy);
        }
    };

    return WebUtil;
});
