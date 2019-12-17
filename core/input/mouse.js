/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2019 The noVNC Authors
 * Licensed under MPL 2.0 or any later version (see LICENSE.txt)
 */

import * as Log from '../util/logging.js';
import { setCapture, stopEvent } from '../util/events.js';

const WHEEL_STEP = 10; // Delta threshold for a mouse wheel step
const WHEEL_STEP_TIMEOUT = 50; // ms
const WHEEL_LINE_HEIGHT = 19;
const MOUSE_MOVE_DELAY = 17; // Minimum wait (ms) between two mouse moves

export default class Mouse {
    constructor(target) {
        this._target = target || document;

        this._wheelStepXTimer = null;
        this._wheelStepYTimer = null;
        this._oldMouseMoveTime = 0;
        this._accumulatedWheelDeltaX = 0;
        this._accumulatedWheelDeltaY = 0;

        this._eventHandlers = {
            'mousedown': this._handleMouseDown.bind(this),
            'mouseup': this._handleMouseUp.bind(this),
            'mousemove': this._handleMouseMove.bind(this),
            'mousewheel': this._handleMouseWheel.bind(this),
            'mousedisable': this._handleMouseDisable.bind(this)
        };

        // ===== EVENT HANDLERS =====

        this.onmousebutton = () => {}; // Handler for mouse button press/release
        this.onmousemove = () => {}; // Handler for mouse movement
    }

    // ===== PRIVATE METHODS =====

    _handleMouseButton(e, down) {
        const position = this._getMousePosition(e);

        let bmask;
        if (e.which) {
            /* everything except IE */
            bmask = 1 << e.button;
        } else {
            /* IE including 9 */
            bmask = (e.button & 0x1) +      // Left
                    (e.button & 0x2) * 2 +  // Right
                    (e.button & 0x4) / 2;   // Middle
        }

        Log.Debug("onmousebutton " + (down ? "down" : "up") +
                  ", x: " + position.x + ", y: " + position.y + ", bmask: " + bmask);
        this.onmousebutton(position.x, position.y, down, bmask);

        stopEvent(e);
    }

    _handleMouseDown(e) {
        setCapture(this._target);
        this._handleMouseButton(e, 1);
    }

    _handleMouseUp(e) {
        this._handleMouseButton(e, 0);
    }

    // Mouse wheel events are sent in steps over VNC. This means that the VNC
    // protocol can't handle a wheel event with specific distance or speed.
    // Therefor, if we get a lot of small mouse wheel events we combine them.
    _generateWheelStepX(position) {
        if (this._accumulatedWheelDeltaX < 0) {
            this.onmousebutton(position.x, position.y, 1, 1 << 5);
            this.onmousebutton(position.x, position.y, 0, 1 << 5);
        } else if (this._accumulatedWheelDeltaX > 0) {
            this.onmousebutton(position.x, position.y, 1, 1 << 6);
            this.onmousebutton(position.x, position.y, 0, 1 << 6);
        }

        this._accumulatedWheelDeltaX = 0;
    }

    _generateWheelStepY(position) {
        if (this._accumulatedWheelDeltaY < 0) {
            this.onmousebutton(position.x, position.y, 1, 1 << 3);
            this.onmousebutton(position.x, position.y, 0, 1 << 3);
        } else if (this._accumulatedWheelDeltaY > 0) {
            this.onmousebutton(position.x, position.y, 1, 1 << 4);
            this.onmousebutton(position.x, position.y, 0, 1 << 4);
        }

        this._accumulatedWheelDeltaY = 0;
    }

    _resetWheelStepTimers() {
        window.clearTimeout(this._wheelStepXTimer);
        window.clearTimeout(this._wheelStepYTimer);
        this._wheelStepXTimer = null;
        this._wheelStepYTimer = null;
    }

    _handleMouseWheel(e) {
        this._resetWheelStepTimers();

        const position = this._getMousePosition(e);

        let dX = e.deltaX;
        let dY = e.deltaY;

        // Pixel units unless it's non-zero.
        // Note that if deltamode is line or page won't matter since we aren't
        // sending the mouse wheel delta to the server anyway.
        // The difference between pixel and line can be important however since
        // we have a threshold that can be smaller than the line height.
        if (e.deltaMode !== 0) {
            dX *= WHEEL_LINE_HEIGHT;
            dY *= WHEEL_LINE_HEIGHT;
        }

        this._accumulatedWheelDeltaX += dX;
        this._accumulatedWheelDeltaY += dY;

        // Generate a mouse wheel step event when the accumulated delta
        // for one of the axes is large enough.
        // Small delta events that do not pass the threshold get sent
        // after a timeout.
        if (Math.abs(this._accumulatedWheelDeltaX) > WHEEL_STEP) {
            this._generateWheelStepX(position);
        } else {
            this._wheelStepXTimer =
                window.setTimeout(() => this._generateWheelStepX(position),
                                  WHEEL_STEP_TIMEOUT);
        }
        if (Math.abs(this._accumulatedWheelDeltaY) > WHEEL_STEP) {
            this._generateWheelStepY(position);
        } else {
            this._wheelStepYTimer =
                window.setTimeout(() => this._generateWheelStepY(position),
                                  WHEEL_STEP_TIMEOUT);
        }

        stopEvent(e);
    }

    _handleMouseMove(e) {
        const position = this._getMousePosition(e);

        // Limit mouse move events to one every MOUSE_MOVE_DELAY ms
        clearTimeout(this.mouseMoveTimer);
        const newMouseMoveTime = Date.now();
        if (newMouseMoveTime < this._oldMouseMoveTime + MOUSE_MOVE_DELAY) {
            this.mouseMoveTimer = setTimeout(this.onmousemove.bind(this),
                                             MOUSE_MOVE_DELAY,
                                             position.x, position.y);
        } else {
            this.onmousemove(position.x, position.y);
        }
        this._oldMouseMoveTime = newMouseMoveTime;

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

    // Get coordinates relative to target
    _getMousePosition(e) {
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
        return { x, y };
    }

    // ===== PUBLIC METHODS =====

    grab() {
        const t = this._target;
        t.addEventListener('mousedown', this._eventHandlers.mousedown);
        t.addEventListener('mouseup', this._eventHandlers.mouseup);
        t.addEventListener('mousemove', this._eventHandlers.mousemove);
        t.addEventListener('wheel', this._eventHandlers.mousewheel);

        // Prevent middle-click pasting (see above for why we bind to document)
        document.addEventListener('click', this._eventHandlers.mousedisable);

        // preventDefault() on mousedown doesn't stop this event for some
        // reason so we have to explicitly block it
        t.addEventListener('contextmenu', this._eventHandlers.mousedisable);
    }

    ungrab() {
        const t = this._target;

        this._resetWheelStepTimers();

        t.removeEventListener('mousedown', this._eventHandlers.mousedown);
        t.removeEventListener('mouseup', this._eventHandlers.mouseup);
        t.removeEventListener('mousemove', this._eventHandlers.mousemove);
        t.removeEventListener('wheel', this._eventHandlers.mousewheel);

        document.removeEventListener('click', this._eventHandlers.mousedisable);

        t.removeEventListener('contextmenu', this._eventHandlers.mousedisable);
    }
}
