/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2018 The noVNC Authors
 * Licensed under MPL 2.0 or any later version (see LICENSE.txt)
 */

import { supportsCursorURIs, isTouchDevice } from './browser.js';

const useFallback = !supportsCursorURIs || isTouchDevice;

export default class Cursor {
    constructor() {
        this._target = null;

        this._canvas = document.createElement('canvas');

        if (useFallback) {
            this._canvas.style.position = 'fixed';
            this._canvas.style.zIndex = '65535';
            this._canvas.style.pointerEvents = 'none';
            // Can't use "display" because of Firefox bug #1445997
            this._canvas.style.visibility = 'hidden';
            document.body.appendChild(this._canvas);
        }

        this._position = { x: 0, y: 0 };
        this._hotSpot = { x: 0, y: 0 };

        this._eventHandlers = {
            'mouseover': this._handleMouseOver.bind(this),
            'mouseleave': this._handleMouseLeave.bind(this),
            'mousemove': this._handleMouseMove.bind(this),
            'mouseup': this._handleMouseUp.bind(this),
            'touchstart': this._handleTouchStart.bind(this),
            'touchmove': this._handleTouchMove.bind(this),
            'touchend': this._handleTouchEnd.bind(this),
        };
    }

    attach(target) {
        if (this._target) {
            this.detach();
        }

        this._target = target;

        if (useFallback) {
            // FIXME: These don't fire properly except for mouse
            ///       movement in IE. We want to also capture element
            //        movement, size changes, visibility, etc.
            const options = { capture: true, passive: true };
            this._target.addEventListener('mouseover', this._eventHandlers.mouseover, options);
            this._target.addEventListener('mouseleave', this._eventHandlers.mouseleave, options);
            this._target.addEventListener('mousemove', this._eventHandlers.mousemove, options);
            this._target.addEventListener('mouseup', this._eventHandlers.mouseup, options);

            // There is no "touchleave" so we monitor touchstart globally
            window.addEventListener('touchstart', this._eventHandlers.touchstart, options);
            this._target.addEventListener('touchmove', this._eventHandlers.touchmove, options);
            this._target.addEventListener('touchend', this._eventHandlers.touchend, options);
        }

        this.clear();
    }

    detach() {
        if (useFallback) {
            const options = { capture: true, passive: true };
            this._target.removeEventListener('mouseover', this._eventHandlers.mouseover, options);
            this._target.removeEventListener('mouseleave', this._eventHandlers.mouseleave, options);
            this._target.removeEventListener('mousemove', this._eventHandlers.mousemove, options);
            this._target.removeEventListener('mouseup', this._eventHandlers.mouseup, options);

            window.removeEventListener('touchstart', this._eventHandlers.touchstart, options);
            this._target.removeEventListener('touchmove', this._eventHandlers.touchmove, options);
            this._target.removeEventListener('touchend', this._eventHandlers.touchend, options);
        }

        this._target = null;
    }

    change(rgba, hotx, hoty, w, h) {
        if ((w === 0) || (h === 0)) {
            this.clear();
            return;
        }

        this._position.x = this._position.x + this._hotSpot.x - hotx;
        this._position.y = this._position.y + this._hotSpot.y - hoty;
        this._hotSpot.x = hotx;
        this._hotSpot.y = hoty;

        let ctx = this._canvas.getContext('2d');

        this._canvas.width = w;
        this._canvas.height = h;

        let img;
        try {
            // IE doesn't support this
            img = new ImageData(new Uint8ClampedArray(rgba), w, h);
        } catch (ex) {
            img = ctx.createImageData(w, h);
            img.data.set(new Uint8ClampedArray(rgba));
        }
        ctx.clearRect(0, 0, w, h);
        ctx.putImageData(img, 0, 0);

        if (useFallback) {
            this._updatePosition();
        } else {
            let url = this._canvas.toDataURL();
            this._target.style.cursor = 'url(' + url + ')' + hotx + ' ' + hoty + ', default';
        }
    }

    clear() {
        this._target.style.cursor = 'none';
        this._canvas.width = 0;
        this._canvas.height = 0;
        this._position.x = this._position.x + this._hotSpot.x;
        this._position.y = this._position.y + this._hotSpot.y;
        this._hotSpot.x = 0;
        this._hotSpot.y = 0;
    }

    _handleMouseOver(event) {
        // This event could be because we're entering the target, or
        // moving around amongst its sub elements. Let the move handler
        // sort things out.
        this._handleMouseMove(event);
    }

    _handleMouseLeave(event) {
        this._hideCursor();
    }

    _handleMouseMove(event) {
        this._updateVisibility(event.target);

        this._position.x = event.clientX - this._hotSpot.x;
        this._position.y = event.clientY - this._hotSpot.y;

        this._updatePosition();
    }

    _handleMouseUp(event) {
        // We might get this event because of a drag operation that
        // moved outside of the target. Check what's under the cursor
        // now and adjust visibility based on that.
        let target = document.elementFromPoint(event.clientX, event.clientY);
        this._updateVisibility(target);
    }

    _handleTouchStart(event) {
        // Just as for mouseover, we let the move handler deal with it
        this._handleTouchMove(event);
    }

    _handleTouchMove(event) {
        this._updateVisibility(event.target);

        this._position.x = event.changedTouches[0].clientX - this._hotSpot.x;
        this._position.y = event.changedTouches[0].clientY - this._hotSpot.y;

        this._updatePosition();
    }

    _handleTouchEnd(event) {
        // Same principle as for mouseup
        let target = document.elementFromPoint(event.changedTouches[0].clientX,
                                               event.changedTouches[0].clientY);
        this._updateVisibility(target);
    }

    _showCursor() {
        if (this._canvas.style.visibility === 'hidden') {
            this._canvas.style.visibility = '';
        }
    }

    _hideCursor() {
        if (this._canvas.style.visibility !== 'hidden') {
            this._canvas.style.visibility = 'hidden';
        }
    }

    // Should we currently display the cursor?
    // (i.e. are we over the target, or a child of the target without a
    // different cursor set)
    _shouldShowCursor(target) {
        // Easy case
        if (target === this._target) {
            return true;
        }
        // Other part of the DOM?
        if (!this._target.contains(target)) {
            return false;
        }
        // Has the child its own cursor?
        // FIXME: How can we tell that a sub element has an
        //        explicit "cursor: none;"?
        if (window.getComputedStyle(target).cursor !== 'none') {
            return false;
        }
        return true;
    }

    _updateVisibility(target) {
        if (this._shouldShowCursor(target)) {
            this._showCursor();
        } else {
            this._hideCursor();
        }
    }

    _updatePosition() {
        this._canvas.style.left = this._position.x + "px";
        this._canvas.style.top = this._position.y + "px";
    }
}
