/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2019 The noVNC authors
 * Licensed under MPL 2.0 or any later version (see LICENSE.txt)
 */

import { supportsCursorURIs, isTouchDevice } from './browser.js';

const useFallback = !supportsCursorURIs || isTouchDevice;

export default class Cursor {
    constructor() {
        this._target = null;

        this._canvas = document.createElement('canvas');

        this._canvas.style.position = 'fixed';
        this._canvas.style.zIndex = '65535';
        this._canvas.style.pointerEvents = 'none';
        // Safari on iOS can select the cursor image
        // https://bugs.webkit.org/show_bug.cgi?id=249223
        this._canvas.style.userSelect = 'none';
        this._canvas.style.WebkitUserSelect = 'none';
        // Can't use "display" because of Firefox bug #1445997
        this._canvas.style.visibility = 'hidden';

        this._position = { x: 0, y: 0 };
        this._hotSpot = { x: 0, y: 0 };

        this._eventHandlers = {
            'mouseover': this._handleMouseOver.bind(this),
            'mouseleave': this._handleMouseLeave.bind(this),
            'mousemove': this._handleMouseMove.bind(this),
            'mouseup': this._handleMouseUp.bind(this),
        };

        this._mouseOver = false;
        this._viewOnly = false;
    }

    get viewOnly() { return this._viewOnly; }
    set viewOnly(viewOnly) {
        if (viewOnly !== this._viewOnly) {
            this._viewOnly = viewOnly;
            this._resetNativeCursorStyle();
            if (this._viewOnly) {
                this._showCursor();
            }
        }
    }

    attach(target) {
        if (this._target) {
            this.detach();
        }

        this._target = target;

        document.body.appendChild(this._canvas);

        const options = { capture: true, passive: true };
        this._target.addEventListener('mouseover', this._eventHandlers.mouseover, options);
        this._target.addEventListener('mouseleave', this._eventHandlers.mouseleave, options);

        if (useFallback) {
            this._target.addEventListener('mousemove', this._eventHandlers.mousemove, options);
            this._target.addEventListener('mouseup', this._eventHandlers.mouseup, options);
        }

        this.clear();
    }

    detach() {
        if (!this._target) {
            return;
        }

        const options = { capture: true, passive: true };
        this._target.removeEventListener('mouseover', this._eventHandlers.mouseover, options);
        this._target.removeEventListener('mouseleave', this._eventHandlers.mouseleave, options);

        if (useFallback) {
            this._target.removeEventListener('mousemove', this._eventHandlers.mousemove, options);
            this._target.removeEventListener('mouseup', this._eventHandlers.mouseup, options);
        }

        if (document.contains(this._canvas)) {
            document.body.removeChild(this._canvas);
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

        let img = new ImageData(new Uint8ClampedArray(rgba), w, h);
        ctx.clearRect(0, 0, w, h);
        ctx.putImageData(img, 0, 0);

        if (useFallback || this._viewOnly || !this._mouseOver) {
            this._updatePosition();
        }
        if (!useFallback && !this._viewOnly) {
            let url = this._canvas.toDataURL();
            this._target.style.cursor = 'url(' + url + ')' + hotx + ' ' + hoty + ', default';
        }
    }

    clear() {
        this._resetNativeCursorStyle();
        this._canvas.width = 0;
        this._canvas.height = 0;
        this._position.x = this._position.x + this._hotSpot.x;
        this._position.y = this._position.y + this._hotSpot.y;
        this._hotSpot.x = 0;
        this._hotSpot.y = 0;
    }

    _resetNativeCursorStyle() {
        if (this._target) {
            this._target.style.cursor = this._viewOnly ? 'not-allowed' : 'none';
        }
    }

    // Mouse events might be emulated, this allows
    // moving the cursor in such cases
    move(clientX, clientY) {
        if (!useFallback) {
            return;
        }
        // clientX/clientY are relative the _visual viewport_,
        // but our position is relative the _layout viewport_,
        // so try to compensate when we can
        if (window.visualViewport) {
            this._position.x = clientX + window.visualViewport.offsetLeft;
            this._position.y = clientY + window.visualViewport.offsetTop;
        } else {
            this._position.x = clientX;
            this._position.y = clientY;
        }
        this._updatePosition();
        let target = document.elementFromPoint(clientX, clientY);
        this._updateVisibility(target);
    }

    moveRemote(remoteX, remoteY, scale) {
        if (this._mouseOver && !this._viewOnly) {
            return;
        }

        let targetBounds = this._target.getBoundingClientRect();
        this._position.x = targetBounds.left + remoteX * scale - this._hotSpot.x;
        this._position.y = targetBounds.top + remoteY * scale - this._hotSpot.y;

        this._updatePosition();
    }

    _handleMouseOver(event) {
        // This event could be because we're entering the target, or
        // moving around amongst its sub elements. Let the move handler
        // sort things out.
        this._mouseOver = true;
        this._handleMouseMove(event);
    }

    _handleMouseLeave(event) {
        if (this._viewOnly) {
            return;
        }

        let targetBounds = this._getVisibleBoundingRect(this._target);
        this._mouseOver = event.clientX >= targetBounds.left && event.clientX < targetBounds.right &&
                          event.clientY >= targetBounds.top && event.clientY < targetBounds.bottom;
        // Check if we should show the cursor on the element we are leaving to
        this._updateVisibility(event.relatedTarget);
    }

    _getVisibleBoundingRect(element) {
        let rect = element.getBoundingClientRect();
        let bounds = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
        if (element.parentElement) {
            let parentBounds = element.parentElement.getBoundingClientRect();
            bounds = {
                left: Math.max(bounds.left, parentBounds.left),
                top: Math.max(bounds.top, parentBounds.top),
                right: Math.min(bounds.right, parentBounds.right),
                bottom: Math.min(bounds.bottom, parentBounds.bottom)
            };
        }
        return bounds;
    }

    _handleMouseMove(event) {
        if (this._viewOnly) {
            return;
        }

        this._updateVisibility(event.target);

        this._position.x = event.clientX - this._hotSpot.x;
        this._position.y = event.clientY - this._hotSpot.y;

        this._updatePosition();
    }

    _handleMouseUp(event) {
        if (this._viewOnly) {
            return;
        }

        // We might get this event because of a drag operation that
        // moved outside of the target. Check what's under the cursor
        // now and adjust visibility based on that.
        let target = document.elementFromPoint(event.clientX, event.clientY);
        this._updateVisibility(target);

        // Captures end with a mouseup but we can't know the event order of
        // mouseup vs releaseCapture.
        //
        // In the cases when releaseCapture comes first, the code above is
        // enough.
        //
        // In the cases when the mouseup comes first, we need wait for the
        // browser to flush all events and then check again if the cursor
        // should be visible.
        if (this._captureIsActive()) {
            window.setTimeout(() => {
                // We might have detached at this point
                if (!this._target) {
                    return;
                }
                // Refresh the target from elementFromPoint since queued events
                // might have altered the DOM
                target = document.elementFromPoint(event.clientX,
                                                   event.clientY);
                this._updateVisibility(target);
            }, 0);
        }
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
        if (!target) {
            return false;
        }
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
        // When the cursor target has capture we want to show the cursor.
        // So, if a capture is active - look at the captured element instead.
        if (this._captureIsActive()) {
            target = document.captureElement;
        }
        if (!this._mouseOver || (useFallback && this._shouldShowCursor(target))) {
            this._showCursor();
        } else {
            this._hideCursor();
        }
    }

    _updatePosition() {
        this._canvas.style.left = this._position.x + "px";
        this._canvas.style.top = this._position.y + "px";
    }

    _captureIsActive() {
        return document.captureElement &&
            document.documentElement.contains(document.captureElement);
    }
}
