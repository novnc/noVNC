/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2012 Joel Martin
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 */

import * as Log from './logging.js';

// Set browser engine versions. Based on mootools.
const Features = {xpath: !!(document.evaluate), query: !!(document.querySelector)};

// 'presto': (function () { return (!window.opera) ? false : true; }()),
var detectPresto = function () {
    return !!window.opera;
};

// 'trident': (function () { return (!window.ActiveXObject) ? false : ((window.XMLHttpRequest) ? ((document.querySelectorAll) ? 6 : 5) : 4);
var detectTrident = function () {
    if (!window.ActiveXObject) {
        return false;
    } else {
        if (window.XMLHttpRequest) {
            return (document.querySelectorAll) ? 6 : 5;
        } else {
            return 4;
        }
    }
};

// 'webkit': (function () { try { return (navigator.taintEnabled) ? false : ((Features.xpath) ? ((Features.query) ? 525 : 420) : 419); } catch (e) { return false; } }()),
var detectInitialWebkit = function () {
    try {
        if (navigator.taintEnabled) {
            return false;
        } else {
            if (Features.xpath) {
                return (Features.query) ? 525 : 420;
            } else {
                return 419;
            }
        }
    } catch (e) {
        return false;
    }
};

var detectActualWebkit = function (initial_ver) {
    var re = /WebKit\/([0-9\.]*) /;
    var str_ver = (navigator.userAgent.match(re) || ['', initial_ver])[1];
    return parseFloat(str_ver, 10);
};

// 'gecko': (function () { return (!document.getBoxObjectFor && window.mozInnerScreenX == null) ? false : ((document.getElementsByClassName) ? 19ssName) ? 19 : 18 : 18); }())
var detectGecko = function () {
    /* jshint -W041 */
    if (!document.getBoxObjectFor && window.mozInnerScreenX == null) {
        return false;
    } else {
        return (document.getElementsByClassName) ? 19 : 18;
    }
    /* jshint +W041 */
};

const isWebkitInitial = detectInitialWebkit();

export const Engine = {
    // Version detection break in Opera 11.60 (errors on arguments.callee.caller reference)
    //'presto': (function() {
    //         return (!window.opera) ? false : ((arguments.callee.caller) ? 960 : ((document.getElementsByClassName) ? 950 : 925)); }()),
    'presto': detectPresto(),
    'trident': detectTrident(),
    'webkit': isWebkitInitial ? detectActualWebkit(isWebkitInitial) : false,
    'gecko': detectGecko()
};

// Touch detection
export var isTouchDevice = ('ontouchstart' in document.documentElement) ||
                                 // requried for Chrome debugger
                                 (document.ontouchstart !== undefined) ||
                                 // required for MS Surface
                                 (navigator.maxTouchPoints > 0) ||
                                 (navigator.msMaxTouchPoints > 0);
window.addEventListener('touchstart', function onFirstTouch() {
    isTouchDevice = true;
    window.removeEventListener('touchstart', onFirstTouch, false);
}, false);

var _cursor_uris_supported = null;

export function browserSupportsCursorURIs () {
    if (_cursor_uris_supported === null) {
        try {
            var target = document.createElement('canvas');
            target.style.cursor = 'url("data:image/x-icon;base64,AAACAAEACAgAAAIAAgA4AQAAFgAAACgAAAAIAAAAEAAAAAEAIAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAD/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////AAAAAAAAAAAAAAAAAAAAAA==") 2 2, default';

            if (target.style.cursor) {
                Log.Info("Data URI scheme cursor supported");
                _cursor_uris_supported = true;
            } else {
                Log.Warn("Data URI scheme cursor not supported");
                _cursor_uris_supported = false;
            }
        } catch (exc) {
            Log.Error("Data URI scheme cursor test exception: " + exc);
            _cursor_uris_supported = false;
        }
    }

    return _cursor_uris_supported;
};

export function _forceCursorURIs(enabled) {
    if (enabled === undefined || enabled) {
        _cursor_uris_supported = true;
    } else {
        _cursor_uris_supported = false;
    }
}
