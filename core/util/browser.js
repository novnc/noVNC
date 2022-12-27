/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2019 The noVNC Authors
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 *
 * Browser feature support detection
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

let _hasScrollbarGutter = true;
try {
    // Create invisible container
    const container = document.createElement('div');
    container.style.visibility = 'hidden';
    container.style.overflow = 'scroll'; // forcing scrollbars
    document.body.appendChild(container);

    // Create a div and place it in the container
    const child = document.createElement('div');
    container.appendChild(child);

    // Calculate the difference between the container's full width
    // and the child's width - the difference is the scrollbars
    const scrollbarWidth = (container.offsetWidth - child.offsetWidth);

    // Clean up
    container.parentNode.removeChild(container);

    _hasScrollbarGutter = scrollbarWidth != 0;
} catch (exc) {
    Log.Error("Scrollbar test exception: " + exc);
}
export const hasScrollbarGutter = _hasScrollbarGutter;

/*
 * The functions for detection of platforms and browsers below are exported
 * but the use of these should be minimized as much as possible.
 *
 * It's better to use feature detection than platform detection.
 */

/* OS */

export function isMac() {
    return !!(/mac/i).exec(navigator.platform);
}

export function isWindows() {
    return !!(/win/i).exec(navigator.platform);
}

export function isIOS() {
    return (!!(/ipad/i).exec(navigator.platform) ||
            !!(/iphone/i).exec(navigator.platform) ||
            !!(/ipod/i).exec(navigator.platform));
}

export function isAndroid() {
    /* Android sets navigator.platform to Linux :/ */
    return !!navigator.userAgent.match('Android ');
}

export function isChromeOS() {
    /* ChromeOS sets navigator.platform to Linux :/ */
    return !!navigator.userAgent.match(' CrOS ');
}

/* Browser */

export function isSafari() {
    return !!navigator.userAgent.match('Safari/...') &&
           !navigator.userAgent.match('Chrome/...') &&
           !navigator.userAgent.match('Chromium/...') &&
           !navigator.userAgent.match('Epiphany/...');
}

export function isFirefox() {
    return !!navigator.userAgent.match('Firefox/...') &&
           !navigator.userAgent.match('Seamonkey/...');
}

export function isChrome() {
    return !!navigator.userAgent.match('Chrome/...') &&
           !navigator.userAgent.match('Chromium/...') &&
           !navigator.userAgent.match('Edg/...') &&
           !navigator.userAgent.match('OPR/...');
}

export function isChromium() {
    return !!navigator.userAgent.match('Chromium/...');
}

export function isOpera() {
    return !!navigator.userAgent.match('OPR/...');
}

export function isEdge() {
    return !!navigator.userAgent.match('Edg/...');
}

/* Engine */

export function isGecko() {
    return !!navigator.userAgent.match('Gecko/...');
}

export function isWebKit() {
    return !!navigator.userAgent.match('AppleWebKit/...') &&
           !navigator.userAgent.match('Chrome/...');
}

export function isBlink() {
    return !!navigator.userAgent.match('Chrome/...');
}
