/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2012 Joel Martin
 * Copyright (C) 2018 Samuel Mannehed for Cendio AB
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 */

import * as Log from './logging.js';

// Touch detection
export let isTouchDevice = ('ontouchstart' in document.documentElement) ||
                                 // requried for Chrome debugger
                                 (document.ontouchstart !== undefined) ||
                                 // required for MS Surface
                                 (navigator.maxTouchPoints > 0) ||
                                 (navigator.msMaxTouchPoints > 0);
window.addEventListener('touchstart', function onFirstTouch() {
    isTouchDevice = true;
    window.removeEventListener('touchstart', onFirstTouch, false);
}, false);


// The goal is to find a certain physical width, the devicePixelRatio
// brings us a bit closer but is not optimal.
export let dragThreshold = 10 * (window.devicePixelRatio || 1);

let _cursor_uris_supported = null;

export function supportsCursorURIs () {
    if (_cursor_uris_supported === null) {
        try {
            const target = document.createElement('canvas');
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
}

export function isMac() {
    return navigator && !!(/mac/i).exec(navigator.platform);
}

export function isIE() {
    return navigator && !!(/trident/i).exec(navigator.userAgent);
}

export function isEdge() {
    return navigator && !!(/edge/i).exec(navigator.userAgent);
}

export function isFirefox() {
    return navigator && !!(/firefox/i).exec(navigator.userAgent);
}

export function isWindows() {
    return navigator && !!(/win/i).exec(navigator.platform);
}

export function isIOS() {
    return navigator &&
           (!!(/ipad/i).exec(navigator.platform) ||
            !!(/iphone/i).exec(navigator.platform) ||
            !!(/ipod/i).exec(navigator.platform));
}

