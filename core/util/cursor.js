/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2019 The noVNC authors
 * Licensed under MPL 2.0 or any later version (see LICENSE.txt)
 */

export default class Cursor {
    constructor() {
        this._target = null;
        this._parent = null;
        this._parentPosition = null;

        this._container = document.createElement('div');
        this._container.style.position = 'absolute';
        this._container.style.zIndex = '65535';
        this._container.style.overflow = 'hidden';
        this._container.style.pointerEvents = 'none';

        this._canvas = document.createElement('canvas');
        this._canvas.style.position = 'absolute';
        this._canvas.style.pointerEvents = 'none';
        // Safari on iOS can select the cursor image
        // https://bugs.webkit.org/show_bug.cgi?id=249223
        this._canvas.style.userSelect = 'none';
        this._canvas.style.WebkitUserSelect = 'none';
        // Can't use "display" because of Firefox bug #1445997
        this._canvas.style.visibility = 'hidden';

        this._container.appendChild(this._canvas);

        // The position is the cursor hotspot in framebuffer canvas
        // coordinates. Keeping it in the same coordinate system as the
        // cursor bitmap makes browser pinch zoom irrelevant to positioning.
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
        this._parent = this._target.parentElement;

        if (!this._parent) {
            throw new Error("Cursor target must have a parent element");
        }

        if (window.getComputedStyle(this._parent).position === 'static') {
            this._parentPosition = this._parent.style.position;
            this._parent.style.position = 'relative';
        }

        this._parent.appendChild(this._container);

        const options = { capture: true, passive: true };
        this._target.addEventListener('mouseover', this._eventHandlers.mouseover, options);
        this._target.addEventListener('mouseleave', this._eventHandlers.mouseleave, options);
        this._target.addEventListener('mousemove', this._eventHandlers.mousemove, options);
        this._target.addEventListener('mouseup', this._eventHandlers.mouseup, options);

        // Local scaling changes the canvas's CSS size without changing its
        // framebuffer dimensions. Recalculate the cursor even if the mouse is
        // stationary when that happens, or when scrolling moves the canvas.
        this._resizeObserver.observe(this._target);
        this._resizeObserver.observe(this._parent);
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

        if (this._parent.contains(this._container)) {
            this._parent.removeChild(this._container);
        }

        if (this._parentPosition !== null) {
            this._parent.style.position = this._parentPosition;
        }

        this._target = null;
        this._parent = null;
        this._parentPosition = null;
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
        this._setPosition(clientX, clientY);
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

        this._setPosition(event.clientX, event.clientY);

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

    _setPosition(clientX, clientY) {
        const targetRect = this._target.getBoundingClientRect();
        const scaleX = this._target.width ? targetRect.width / this._target.width : 1;
        const scaleY = this._target.height ? targetRect.height / this._target.height : 1;

        // Use the same client-to-canvas conversion as noVNC's mouse input.
        // The visual viewport offset from Android pinch zoom is already
        // reflected in client coordinates and the target rectangle.
        this._position.x = scaleX ? (clientX - targetRect.left) / scaleX : 0;
        this._position.y = scaleY ? (clientY - targetRect.top) / scaleY : 0;
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
        const left = (this._position.x - this._hotSpot.x) * scaleX;
        const top = (this._position.y - this._hotSpot.y) * scaleY;

        // Keep the cursor overlay in the same layout and scrolling coordinate
        // system as the framebuffer canvas. This avoids any mismatch between
        // client coordinates and page-level fixed positioning.
        this._container.style.left = this._target.offsetLeft + "px";
        this._container.style.top = this._target.offsetTop + "px";
        this._container.style.width = targetRect.width + "px";
        this._container.style.height = targetRect.height + "px";

        this._canvas.style.width = width + "px";
        this._canvas.style.height = height + "px";
        this._canvas.style.left = left + "px";
        this._canvas.style.top = top + "px";
    }

    _captureIsActive() {
        return document.captureElement &&
            document.documentElement.contains(document.captureElement);
    }
}
