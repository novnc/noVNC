/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2019 The noVNC Authors
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 */

import { initLogging as mainInitLogging } from '../core/util/logging.js';

// init log level reading the logging HTTP param
export function initLogging(level) {
    "use strict";
    if (typeof level !== "undefined") {
        mainInitLogging(level);
    } else {
        const param = document.location.href.match(/logging=([A-Za-z0-9._-]*)/);
        mainInitLogging(param || undefined);
    }
}

// Read a query string variable
// A URL with a query parameter can look like this (But will most probably get logged on the http server):
// https://www.example.com?myqueryparam=myvalue
//
// For privacy (Using a hastag #, the parameters will not be sent to the server)
// the url can be requested in the following way:
// https://www.example.com#myqueryparam=myvalue&password=secreatvalue
//
// Even Mixing public and non public parameters will work:
// https://www.example.com?nonsecretparam=example.com#password=secreatvalue
export function getQueryVar(name, defVal) {
    "use strict";
    const re = new RegExp('.*[?&]' + name + '=([^&#]*)'),
          match = ''.concat(document.location.href, window.location.hash).match(re);
    if (typeof defVal === 'undefined') { defVal = null; }

    if (match) {
        return decodeURIComponent(match[1]);
    }

    return defVal;
}

// Read a hash fragment variable
export function getHashVar(name, defVal) {
    "use strict";
    const re = new RegExp('.*[&#]' + name + '=([^&]*)'),
          match = document.location.hash.match(re);
    if (typeof defVal === 'undefined') { defVal = null; }

    if (match) {
        return decodeURIComponent(match[1]);
    }

    return defVal;
}

// Read a variable from the fragment or the query string
// Fragment takes precedence
export function getConfigVar(name, defVal) {
    "use strict";
    const val = getHashVar(name);

    if (val === null) {
        return getQueryVar(name, defVal);
    }

    return val;
}

/*
 * Cookie handling. Dervied from: http://www.quirksmode.org/js/cookies.html
 */

// No days means only for this browser session
export function createCookie(name, value, days) {
    "use strict";
    let date, expires;
    if (days) {
        date = new Date();
        date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
        expires = "; expires=" + date.toGMTString();
    } else {
        expires = "";
    }

    let secure;
    if (document.location.protocol === "https:") {
        secure = "; secure";
    } else {
        secure = "";
    }
    document.cookie = name + "=" + value + expires + "; path=/" + secure;
}

export function readCookie(name, defaultValue) {
    "use strict";
    const nameEQ = name + "=";
    const ca = document.cookie.split(';');

    for (let i = 0; i < ca.length; i += 1) {
        let c = ca[i];
        while (c.charAt(0) === ' ') {
            c = c.substring(1, c.length);
        }
        if (c.indexOf(nameEQ) === 0) {
            return c.substring(nameEQ.length, c.length);
        }
    }

    return (typeof defaultValue !== 'undefined') ? defaultValue : null;
}

export function eraseCookie(name) {
    "use strict";
    createCookie(name, "", -1);
}

/*
 * Setting handling.
 */

let settings = {};

export function initSettings() {
    if (!window.chrome || !window.chrome.storage) {
        settings = {};
        return Promise.resolve();
    }

    return new Promise(resolve => window.chrome.storage.sync.get(resolve))
        .then((cfg) => { settings = cfg; });
}

// Update the settings cache, but do not write to permanent storage
export function setSetting(name, value) {
    settings[name] = value;
}

// No days means only for this browser session
export function writeSetting(name, value) {
    "use strict";
    if (settings[name] === value) return;
    settings[name] = value;
    if (window.chrome && window.chrome.storage) {
        window.chrome.storage.sync.set(settings);
    } else {
        localStorage.setItem(name, value);
    }
}

export function readSetting(name, defaultValue) {
    "use strict";
    let value;
    if ((name in settings) || (window.chrome && window.chrome.storage)) {
        value = settings[name];
    } else {
        value = localStorage.getItem(name);
        settings[name] = value;
    }
    if (typeof value === "undefined") {
        value = null;
    }

    if (value === null && typeof defaultValue !== "undefined") {
        return defaultValue;
    }

    return value;
}

export function eraseSetting(name) {
    "use strict";
    // Deleting here means that next time the setting is read when using local
    // storage, it will be pulled from local storage again.
    // If the setting in local storage is changed (e.g. in another tab)
    // between this delete and the next read, it could lead to an unexpected
    // value change.
    delete settings[name];
    if (window.chrome && window.chrome.storage) {
        window.chrome.storage.sync.remove(name);
    } else {
        localStorage.removeItem(name);
    }
}
