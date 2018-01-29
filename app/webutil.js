/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2012 Joel Martin
 * Copyright (C) 2013 NTT corp.
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 */

import { init_logging as main_init_logging } from '../core/util/logging.js';

// init log level reading the logging HTTP param
export function init_logging (level) {
    if (typeof level !== "undefined") {
        main_init_logging(level);
    } else {
        const param = document.location.href.match(/logging=([A-Za-z0-9._-]*)/);
        main_init_logging(param || undefined);
    }
}

// Read a query string variable
export function getQueryVar (name, defVal) {
    const re = new RegExp('.*[?&]' + name + '=([^&#]*)'),
        match = document.location.href.match(re);
    if (typeof defVal === 'undefined') { defVal = null; }
    if (match) {
        return decodeURIComponent(match[1]);
    } else {
        return defVal;
    }
}

// Read a hash fragment variable
export function getHashVar (name, defVal) {
    const re = new RegExp('.*[&#]' + name + '=([^&]*)'),
        match = document.location.hash.match(re);
    if (typeof defVal === 'undefined') { defVal = null; }
    if (match) {
        return decodeURIComponent(match[1]);
    } else {
        return defVal;
    }
}

// Read a variable from the fragment or the query string
// Fragment takes precedence
export function getConfigVar (name, defVal) {
    let val = getHashVar(name);
    if (val === null) {
        val = getQueryVar(name, defVal);
    }
    return val;
}

/*
 * Cookie handling. Dervied from: http://www.quirksmode.org/js/cookies.html
 */

// No days means only for this browser session
export function createCookie (name, value, days) {
    let date, expires;
    if (days) {
        date = new Date();
        date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
        expires = "; expires=" + date.toGMTString();
    } else {
        expires = "";
    }

    const secure = (document.location.protocol === "https:")
        ? "; secure"
        : "";

    document.cookie = name + "=" + value + expires + "; path=/" + secure;
}

export function readCookie (name, defaultValue) {
    const nameEQ = name + "=",
        ca = document.cookie.split(';');

    for (let i = 0; i < ca.length; i += 1) {
        let c = ca[i];
        while (c.charAt(0) === ' ') { c = c.substring(1, c.length); }
        if (c.indexOf(nameEQ) === 0) { return c.substring(nameEQ.length, c.length); }
    }

    return (typeof defaultValue !== 'undefined') ? defaultValue : null;
}

export function eraseCookie (name) {
    createCookie(name, "", -1);
}

/*
 * Setting handling.
 */

let settings = {};

export function initSettings (callback /*, ...callbackArgs */) {
    const callbackArgs = Array.prototype.slice.call(arguments, 1);
    if (window.chrome && window.chrome.storage) {
        window.chrome.storage.sync.get((cfg) => {
            settings = cfg;
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
}

// No days means only for this browser session
export function writeSetting (name, value) {
    if (window.chrome && window.chrome.storage) {
        //console.log("writeSetting:", name, value);
        if (settings[name] !== value) {
            settings[name] = value;
            window.chrome.storage.sync.set(settings);
        }
    } else {
        localStorage.setItem(name, value);
    }
}

export function readSetting (name, defaultValue) {
    let value;
    if (window.chrome && window.chrome.storage) {
        value = settings[name];
    } else {
        value = localStorage.getItem(name);
    }
    if (typeof value === "undefined") {
        value = null;
    }
    if (value === null && typeof defaultValue !== "undefined") {
        return defaultValue;
    } else {
        return value;
    }
}

export function eraseSetting (name) {
    if (window.chrome && window.chrome.storage) {
        window.chrome.storage.sync.remove(name);
        delete settings[name];
    } else {
        localStorage.removeItem(name);
    }
}

export function injectParamIfMissing (path, param, value) {
    // force pretend that we're dealing with a relative path
    // (assume that we wanted an extra if we pass one in)
    path = "/" + path;

    const elem = document.createElement('a');
    elem.href = path;

    const param_eq = encodeURIComponent(param) + "=";
    const query = elem.search
        ? elem.search.slice(1).split('&')
        : [];

    if (!query.some(function (v) { return v.startsWith(param_eq); })) {
        query.push(param_eq + encodeURIComponent(value));
        elem.search = "?" + query.join("&");
    }

    // some browsers (e.g. IE11) may occasionally omit the leading slash
    // in the elem.pathname string. Handle that case gracefully.
    if (elem.pathname.charAt(0) == "/") {
        return elem.pathname.slice(1) + elem.search + elem.hash;
    }

    return elem.pathname + elem.search + elem.hash;
}

// sadly, we can't use the Fetch API until we decide to drop
// IE11 support or polyfill promises and fetch in IE11.
// resolve will receive an object on success, while reject
// will receive either an event or an error on failure.
export function fetchJSON(path, resolve, reject) {
    // NB: IE11 doesn't support JSON as a responseType
    const req = new XMLHttpRequest();
    req.open('GET', path);

    req.onload = () => {
        if (req.status === 200) {
            try {
                resolve(JSON.parse(req.responseText));
            } catch (err) {
                reject(err);
            }
        } else {
            reject(new Error("XHR got non-200 status while trying to load '" + path + "': " + req.status));
        }
    };

    req.onerror = (evt) => {
        reject(new Error("XHR encountered an error while trying to load '" + path + "': " + evt.message));
    };

    req.ontimeout = () => {
        reject(new Error("XHR timed out while trying to load '" + path + "'"));
    };

    req.send();
}
