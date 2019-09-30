/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2019 The noVNC Authors
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

let _supportsCursorURIs = false;

try {
    const target = document.createElement('canvas');
    target.style.cursor = 'url("data:image/x-icon;base64,AAACAAEACAgAAAIAAgA4AQAAFgAAACgAAAAIAAAAEAAAAAEAIAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAD/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////AAAAAAAAAAAAAAAAAAAAAA==") 2 2, default';

    if (target.style.cursor.indexOf("url") === 0) {
        Log.Info("Data URI scheme cursor supported");
        _supportsCursorURIs = true;
    } else {
        Log.Warn("Data URI scheme cursor not supported");
    }
} catch (exc) {
    Log.Error("Data URI scheme cursor test exception: " + exc);
}

export const supportsCursorURIs = _supportsCursorURIs;

let _supportsImageMetadata = false;
try {
    new ImageData(new Uint8ClampedArray(4), 1, 1);
    _supportsImageMetadata = true;
} catch (ex) {
    // ignore failure
}
export const supportsImageMetadata = _supportsImageMetadata;

export function isMac() {
    return navigator && !!(/mac/i).exec(navigator.platform);
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

export function isAndroid() {
    return navigator && !!(/android/i).exec(navigator.userAgent);
}

export function isSafari() {
    return navigator && (navigator.userAgent.indexOf('Safari') !== -1 &&
                         navigator.userAgent.indexOf('Chrome') === -1);
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

