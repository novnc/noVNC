/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2020 The noVNC Authors
 * Licensed under MPL 2.0 or any later version (see LICENSE.txt)
 */

/* Polyfills to provide new APIs in old browsers */

/* CustomEvent constructor (taken from MDN) */
(() => {
    function CustomEvent(event, params) {
        params = params || { bubbles: false, cancelable: false, detail: undefined };
        const evt = document.createEvent( 'CustomEvent' );
        evt.initCustomEvent( event, params.bubbles, params.cancelable, params.detail );
        return evt;
    }

    CustomEvent.prototype = window.Event.prototype;

    if (typeof window.CustomEvent !== "function") {
        window.CustomEvent = CustomEvent;
    }
})();
