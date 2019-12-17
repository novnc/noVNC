/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2020 The noVNC Authors
 * Licensed under MPL 2.0 or any later version (see LICENSE.txt)
 */

import * as Log from '../util/logging.js';
import { stopEvent, getPointerEvent } from '../util/events.js';

const TOUCH_MOVE_DELAY = 17; // Minimum wait (ms) between two touch moves

export default class Touch {
    constructor(target) {
        this._target = target || document;

        this._doubleClickTimer = null;
        this._lastTouchPos = null;
        this._oldTouchMoveTime = 0;

        this._eventHandlers = {
            'touchstart': this._handleTouchStart.bind(this),
            'touchend': this._handleTouchEnd.bind(this),
            'touchmove': this._handleTouchMove.bind(this)
        };

        // ===== PROPERTIES =====

        this.touchButton = 1;                 // Button mask (1, 2, 4) for touch devices (0 means ignore clicks)

        // ===== EVENT HANDLERS =====

        this.ontouch = () => {}; // Handler for mouse button click/release
        this.ontouchmove = () => {}; // Handler for mouse movement
    }

    // ===== PRIVATE METHODS =====

    _handleTouchStart(e) {
        this._handleTouchAsMouseButton(e, 1);
    }

    _handleTouchEnd(e) {
        this._handleTouchAsMouseButton(e, 0);
    }

    _handleTouchMove(e) {
        const position = this._getTouchPosition(e);

        // Limit touch move events to one every TOUCH_MOVE_DELAY ms
        clearTimeout(this.touchMoveTimer);
        const newTouchMoveTime = Date.now();
        if (newTouchMoveTime < this._oldTouchMoveTime + TOUCH_MOVE_DELAY) {
            this.touchMoveTimer = setTimeout(this.ontouchmove.bind(this),
                                             TOUCH_MOVE_DELAY,
                                             position.x, position.y);
        } else {
            this.ontouchmove(position.x, position.y);
        }
        this._oldTouchMoveTime = newTouchMoveTime;

        stopEvent(e);
    }

    _handleTouchAsMouseButton(e, down) {
        let position = this._getTouchPosition(e);

        // When two touches occur within 500 ms of each other and are
        // close enough together a double click is triggered.
        if (down == 1) {
            if (this._doubleClickTimer === null) {
                this._lastTouchPos = position;
            } else {
                clearTimeout(this._doubleClickTimer);

                // When the distance between the two touches is small enough
                // force the position of the latter touch to the position of
                // the first.

                const xs = this._lastTouchPos.x - position.x;
                const ys = this._lastTouchPos.y - position.y;
                const d = Math.sqrt((xs * xs) + (ys * ys));

                // The goal is to trigger on a certain physical width,
                // the devicePixelRatio brings us a bit closer but is
                // not optimal.
                const threshold = 20 * (window.devicePixelRatio || 1);
                if (d < threshold) {
                    position = this._lastTouchPos;
                }
            }
            this._doubleClickTimer = setTimeout(() => (this._doubleClickTimer = null), 500);
        }

        const bmask = this.touchButton;

        Log.Debug("onmousebutton " + (down ? "down" : "up") +
                  ", x: " + position.x + ", y: " + position.y + ", bmask: " + bmask);
        this.ontouch(position.x, position.y, down, bmask);

        stopEvent(e);
    }

   // Get coordinates relative to target
    _getTouchPosition(e) {
        const pointerEvent = getPointerEvent(e);
        const bounds = this._target.getBoundingClientRect();
        let x;
        let y;
        // Clip to target bounds
        if (pointerEvent.clientX < bounds.left) {
            x = 0;
        } else if (pointerEvent.clientX >= bounds.right) {
            x = bounds.width - 1;
        } else {
            x = pointerEvent.clientX - bounds.left;
        }
        if (pointerEvent.clientY < bounds.top) {
            y = 0;
        } else if (pointerEvent.clientY >= bounds.bottom) {
            y = bounds.height - 1;
        } else {
            y = pointerEvent.clientY - bounds.top;
        }
        return { x, y };
    }

    // ===== PUBLIC METHODS =====

    grab() {
        this._target.addEventListener('touchstart', this._eventHandlers.touchstart);
        this._target.addEventListener('touchend', this._eventHandlers.touchend);
        this._target.addEventListener('touchmove', this._eventHandlers.touchmove);
    }

    ungrab() {
        this._target.removeEventListener('touchstart', this._eventHandlers.touchstart);
        this._target.removeEventListener('touchend', this._eventHandlers.touchend);
        this._target.removeEventListener('touchmove', this._eventHandlers.touchmove);
    }
}
