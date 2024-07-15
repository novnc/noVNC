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

export function isMac() {
    return navigator && !!(/mac/i).exec(navigator.platform);
}

export function isWindows() {
    return navigator && !!(/win/i).exec(navigator.platform);
}

export function isLinux() {
    return navigator && !!(/linux/i).exec(navigator.platform)
}

export function isIOS() {
    return navigator &&
           (!!(/ipad/i).exec(navigator.platform) ||
            !!(/iphone/i).exec(navigator.platform) ||
            !!(/ipod/i).exec(navigator.platform));
}

export function isSafari() {
    return navigator && (navigator.userAgent.indexOf('Safari') !== -1 &&
                         navigator.userAgent.indexOf('Chrome') === -1);
}

//is the client a desktop like operating system
export function isDesktop() {
    var userAgent = navigator.userAgent;
    if (isIOS() || userAgent.indexOf("OculusBrowser") != -1 || userAgent.indexOf("SamsungBrowser") != -1) {
        return false
    } else if (userAgent.indexOf("Windows") != -1 || userAgent.indexOf("Mac") != -1 || userAgent.indexOf("X11") != -1 || userAgent.indexOf("Linux") != -1) {
      return true;
    } else {
      return false;
    }
  }

// Returns IE version number if IE or older Edge browser
export function isIE() {
    var ua = window.navigator.userAgent;

    // Test values; Uncomment to check result &

    // IE 10
    // ua = 'Mozilla/5.0 (compatible; MSIE 10.0; Windows NT 6.2; Trident/6.0)';

    // IE 11
    // ua = 'Mozilla/5.0 (Windows NT 6.3; Trident/7.0; rv:11.0) like Gecko';

    // Edge 12 (Spartan)
    // ua = 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/39.0.2171.71 Safari/537.36 Edge/12.0';

    // Edge 13
    // ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/46.0.2486.0 Safari/537.36 Edge/13.10586';

    var msie = ua.indexOf('MSIE ');
    var ie_ver = false;
    if (msie > 0) {
    // IE 10 or older => return version number
        ie_ver = parseInt(ua.substring(msie + 5, ua.indexOf('.', msie)), 10);
    }

    var trident = ua.indexOf('Trident/');
    if (trident > 0) {
        // IE 11 => return version number
        var rv = ua.indexOf('rv:');
        ie_ver = parseInt(ua.substring(rv + 3, ua.indexOf('.', rv)), 10);
    }

    var edge = ua.indexOf('Edge/');
    if (edge > 0) {
        // Edge (IE 12+) => return version number
        ie_ver = parseInt(ua.substring(edge + 5, ua.indexOf('.', edge)), 10);
    }

    return ie_ver;
}

export function isChromiumBased() {
    return (!!window.chrome);
}

export function isFirefox() {
    return navigator && !!(/firefox/i).exec(navigator.userAgent);
}

export function supportsBinaryClipboard() {
    //Safari does support the clipbaord API but has a lot of security restrictions
    if (isSafari() || isFirefox()) { return false; }
    return (navigator.clipboard && typeof navigator.clipboard.read === "function");
}

export function supportsPointerLock() {
    //Older versions of edge do support browser lock, but seems to not behave as expected
    //Disable on browsers that don't fully support or work as expected
    if (isIOS() || isIE()) { return false; }
    return (document.exitPointerLock);
}

