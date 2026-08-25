/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2019 The noVNC authors
 * Licensed under MPL 2.0 or any later version (see LICENSE.txt)
 */

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

        // The position is the cursor hotspot in client coordinates. Keeping
        // it separate from the bitmap position lets us apply the same local
        // scale to both the cursor image and its hotspot.
        this._position = { x: 0, y: 0 };
        this._hotSpot = { x: 0, y: 0 };

        this._eventHandlers = {
            'mouseover': this._handleMouseOver.bind(this),
            'mouseleave': this._handleMouseLeave.bind(this),
            'mousemove': this._handleMouseMove.bind(this),
            'mouseup': this._handleMouseUp.bind(this),
            'geometrychange': this._updatePosition.bind(this),
        };

        this._resizeObserver = new ResizeObserver(this._eventHandlers.geometrychange);
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
        this._target.addEventListener('mousemove', this._eventHandlers.mousemove, options);
        this._target.addEventListener('mouseup', this._eventHandlers.mouseup, options);

        // Local scaling changes the canvas's CSS size without changing its
        // framebuffer dimensions. Recalculate the cursor even if the mouse is
        // stationary when that happens, or when scrolling moves the canvas.
        this._resizeObserver.observe(this._target);
        window.addEventListener('resize', this._eventHandlers.geometrychange);
        window.addEventListener('scroll', this._eventHandlers.geometrychange, true);

        this.clear();
    }

    detach() {
        if (!this._target) {
            return;
        }

        const options = { capture: true, passive: true };
        this._target.removeEventListener('mouseover', this._eventHandlers.mouseover, options);
        this._target.removeEventListener('mouseleave', this._eventHandlers.mouseleave, options);
        this._target.removeEventListener('mousemove', this._eventHandlers.mousemove, options);
        this._target.removeEventListener('mouseup', this._eventHandlers.mouseup, options);

        this._resizeObserver.disconnect();
        window.removeEventListener('resize', this._eventHandlers.geometrychange);
        window.removeEventListener('scroll', this._eventHandlers.geometrychange, true);

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

        this._hotSpot.x = hotx;
        this._hotSpot.y = hoty;

        let ctx = this._canvas.getContext('2d');

        this._canvas.width = w;
        this._canvas.height = h;

        let img = new ImageData(new Uint8ClampedArray(rgba), w, h);
        ctx.clearRect(0, 0, w, h);
        ctx.putImageData(img, 0, 0);

        this._updatePosition();
    }

    clear() {
        this._target.style.cursor = 'none';
        this._canvas.width = 0;
        this._canvas.height = 0;
        this._canvas.style.width = '0px';
        this._canvas.style.height = '0px';
        this._hotSpot.x = 0;
        this._hotSpot.y = 0;
    }

    // Mouse events might be emulated, this allows
    // moving the cursor in such cases
    move(clientX, clientY) {
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

    _handleMouseOver(event) {
        // This event could be because we're entering the target, or
        // moving around amongst its sub elements. Let the move handler
        // sort things out.
        this._handleMouseMove(event);
    }

    _handleMouseLeave(event) {
        // Check if we should show the cursor on the element we are leaving to
        this._updateVisibility(event.relatedTarget);
    }

    _handleMouseMove(event) {
        this._updateVisibility(event.target);

        this._position.x = event.clientX;
        this._position.y = event.clientY;

        this._updatePosition();
    }

    _handleMouseUp(event) {
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
        if (this._shouldShowCursor(target)) {
            this._showCursor();
        } else {
            this._hideCursor();
        }
    }

    _getVisibleTargetRect() {
        const targetRect = this._target.getBoundingClientRect();
        const rect = {
            left: targetRect.left,
            top: targetRect.top,
            right: targetRect.right,
            bottom: targetRect.bottom,
        };

        // The canvas can be larger than noVNC's scrolling viewport. Limit the
        // cursor to the part of the canvas that each clipping ancestor exposes.
        let element = this._target.parentElement;
        while (element) {
            const style = window.getComputedStyle(element);
            const bounds = element.getBoundingClientRect();
            const overflowX = style.overflowX || style.overflow;
            const overflowY = style.overflowY || style.overflow;

            if (overflowX !== 'visible') {
                rect.left = Math.max(rect.left, bounds.left);
                rect.right = Math.min(rect.right, bounds.right);
            }
            if (overflowY !== 'visible') {
                rect.top = Math.max(rect.top, bounds.top);
                rect.bottom = Math.min(rect.bottom, bounds.bottom);
            }

            element = element.parentElement;
        }

        // A fixed-position cursor is also limited to the browser viewport.
        rect.left = Math.max(rect.left, 0);
        rect.top = Math.max(rect.top, 0);
        rect.right = Math.min(rect.right, document.documentElement.clientWidth);
        rect.bottom = Math.min(rect.bottom, document.documentElement.clientHeight);

        return rect;
    }

    _updatePosition() {
        if (!this._target) {
            return;
        }

        const targetRect = this._target.getBoundingClientRect();
        const scaleX = this._target.width ? targetRect.width / this._target.width : 1;
        const scaleY = this._target.height ? targetRect.height / this._target.height : 1;
        const width = this._canvas.width * scaleX;
        const height = this._canvas.height * scaleY;
        const left = this._position.x - this._hotSpot.x * scaleX;
        const top = this._position.y - this._hotSpot.y * scaleY;

        this._canvas.style.width = width + "px";
        this._canvas.style.height = height + "px";
        this._canvas.style.left = left + "px";
        this._canvas.style.top = top + "px";

        // A CSS cursor is allowed to paint outside its target element. Clip the
        // emulated cursor instead so it behaves like pixels in the framebuffer.
        const visibleRect = this._getVisibleTargetRect();
        const clipTop = Math.max(visibleRect.top - top, 0);
        const clipRight = Math.max(left + width - visibleRect.right, 0);
        const clipBottom = Math.max(top + height - visibleRect.bottom, 0);
        const clipLeft = Math.max(visibleRect.left - left, 0);

        this._canvas.style.clipPath = `inset(${clipTop}px ${clipRight}px ${clipBottom}px ${clipLeft}px)`;
    }

    _captureIsActive() {
        return document.captureElement &&
            document.documentElement.contains(document.captureElement);
    }
}
