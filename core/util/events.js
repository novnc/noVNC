/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2012 Joel Martin
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 */

/*
 * Cross-browser event and position routines
 */

export function getPointerEvent (e) {
    return e.changedTouches ? e.changedTouches[0] : e.touches ? e.touches[0] : e;
}

export function stopEvent (e) {
    e.stopPropagation();
    e.preventDefault();
}

// Emulate Element.setCapture() when not supported
let _captureRecursion = false;
let _captureElem = null;
function _captureProxy(e) {
    // Recursion protection as we'll see our own event
    if (_captureRecursion) return;

    // Clone the event as we cannot dispatch an already dispatched event
    const newEv = new e.constructor(e.type, e);

    _captureRecursion = true;
    _captureElem.dispatchEvent(newEv);
    _captureRecursion = false;

    // Avoid double events
    e.stopPropagation();

    // Respect the wishes of the redirected event handlers
    if (newEv.defaultPrevented) {
        e.preventDefault();
    }

    // Implicitly release the capture on button release
    if (e.type === "mouseup") {
        releaseCapture();
    }
}

// Follow cursor style of target element
function _captureElemChanged() {
    const captureElem = document.getElementById("noVNC_mouse_capture_elem");
    captureElem.style.cursor = window.getComputedStyle(_captureElem).cursor;
}

const _captureObserver = new MutationObserver(_captureElemChanged);

let _captureIndex = 0;

export function setCapture (elem) {
    if (elem.setCapture) {

        elem.setCapture();

        // IE releases capture on 'click' events which might not trigger
        elem.addEventListener('mouseup', releaseCapture);

    } else {
        // Release any existing capture in case this method is
        // called multiple times without coordination
        releaseCapture();

        let captureElem = document.getElementById("noVNC_mouse_capture_elem");

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

            // This is to make sure callers don't get confused by having
            // our blocking element as the target
            captureElem.addEventListener('contextmenu', _captureProxy);

            captureElem.addEventListener('mousemove', _captureProxy);
            captureElem.addEventListener('mouseup', _captureProxy);
        }

        _captureElem = elem;
        _captureIndex++;

        // Track cursor and get initial cursor
        _captureObserver.observe(elem, {attributes:true});
        _captureElemChanged();

        captureElem.style.display = "";

        // We listen to events on window in order to keep tracking if it
        // happens to leave the viewport
        window.addEventListener('mousemove', _captureProxy);
        window.addEventListener('mouseup', _captureProxy);
    }
}

export function releaseCapture () {
    if (document.releaseCapture) {

        document.releaseCapture();

    } else {
        if (!_captureElem) {
            return;
        }

        // There might be events already queued, so we need to wait for
        // them to flush. E.g. contextmenu in Microsoft Edge
        window.setTimeout(function(expected) {
            // Only clear it if it's the expected grab (i.e. no one
            // else has initiated a new grab)
            if (_captureIndex === expected) {
                _captureElem = null;
            }
        }, 0, _captureIndex);

        _captureObserver.disconnect();

        const captureElem = document.getElementById("noVNC_mouse_capture_elem");
        captureElem.style.display = "none";

        window.removeEventListener('mousemove', _captureProxy);
        window.removeEventListener('mouseup', _captureProxy);
    }
}
