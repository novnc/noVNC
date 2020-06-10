/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2019 The noVNC Authors
 * Licensed under MPL 2.0 or any later version (see LICENSE.txt)
 */

import * as Log from '../util/logging.js';
import { setCapture, stopEvent, getPointerEvent } from '../util/events.js';

export default class Mouse {
    constructor(target) {
        this._target = target || document;

        this._pos = null;

        this._eventHandlers = {
            'mousedown': this._handleMouseDown.bind(this),
            'mouseup': this._handleMouseUp.bind(this),
            'mousemove': this._handleMouseMove.bind(this),
            'mousedisable': this._handleMouseDisable.bind(this)
        };

        // ===== EVENT HANDLERS =====

        this.onmousebutton = () => {}; // Handler for mouse button press/release
        this.onmousemove = () => {}; // Handler for mouse movement
    }

    // ===== PRIVATE METHODS =====

    _resetDoubleClickTimer() {
        this._doubleClickTimer = null;
    }

    _handleMouseButton(e, down) {
        this._updateMousePosition(e);
        let pos = this._pos;

        let bmask = 1 << e.button;

        Log.Debug("onmousebutton " + (down ? "down" : "up") +
                  ", x: " + pos.x + ", y: " + pos.y + ", bmask: " + bmask);
        this.onmousebutton(pos.x, pos.y, down, bmask);

        stopEvent(e);
    }

    _handleMouseDown(e) {
        setCapture(this._target);

        this._handleMouseButton(e, 1);
    }

    _handleMouseUp(e) {
        this._handleMouseButton(e, 0);
    }

    _handleMouseMove(e) {
        this._updateMousePosition(e);
        this.onmousemove(this._pos.x, this._pos.y);
        stopEvent(e);
    }

    _handleMouseDisable(e) {
        /*
         * Stop propagation if inside canvas area
         * Note: This is only needed for the 'click' event as it fails
         *       to fire properly for the target element so we have
         *       to listen on the document element instead.
         */
        if (e.target == this._target) {
            stopEvent(e);
        }
    }

    // Update coordinates relative to target
    _updateMousePosition(e) {
        e = getPointerEvent(e);
        const bounds = this._target.getBoundingClientRect();
        let x;
        let y;
        // Clip to target bounds
        if (e.clientX < bounds.left) {
            x = 0;
        } else if (e.clientX >= bounds.right) {
            x = bounds.width - 1;
        } else {
            x = e.clientX - bounds.left;
        }
        if (e.clientY < bounds.top) {
            y = 0;
        } else if (e.clientY >= bounds.bottom) {
            y = bounds.height - 1;
        } else {
            y = e.clientY - bounds.top;
        }
        this._pos = {x: x, y: y};
    }

    // ===== PUBLIC METHODS =====

    grab() {
        const t = this._target;
        t.addEventListener('mousedown', this._eventHandlers.mousedown);
        t.addEventListener('mouseup', this._eventHandlers.mouseup);
        t.addEventListener('mousemove', this._eventHandlers.mousemove);

        // Prevent middle-click pasting (see above for why we bind to document)
        document.addEventListener('click', this._eventHandlers.mousedisable);

        // preventDefault() on mousedown doesn't stop this event for some
        // reason so we have to explicitly block it
        t.addEventListener('contextmenu', this._eventHandlers.mousedisable);
    }

    ungrab() {
        const t = this._target;

        t.removeEventListener('mousedown', this._eventHandlers.mousedown);
        t.removeEventListener('mouseup', this._eventHandlers.mouseup);
        t.removeEventListener('mousemove', this._eventHandlers.mousemove);

        document.removeEventListener('click', this._eventHandlers.mousedisable);

        t.removeEventListener('contextmenu', this._eventHandlers.mousedisable);
    }
}
