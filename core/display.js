/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2012 Joel Martin
 * Copyright (C) 2015 Samuel Mannehed for Cendio AB
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 */

import * as Log from './util/logging.js';
import Base64 from "./base64.js";

let SUPPORTS_IMAGEDATA_CONSTRUCTOR = false;
try {
    new ImageData(new Uint8ClampedArray(4), 1, 1);
    SUPPORTS_IMAGEDATA_CONSTRUCTOR = true;
} catch (ex) {
    // ignore failure
}

export default class Display {
    constructor(target) {
        this._drawCtx = null;
        this._c_forceCanvas = false;

        this._renderQ = [];  // queue drawing actions for in-oder rendering
        this._flushing = false;

        // the full frame buffer (logical canvas) size
        this._fb_width = 0;
        this._fb_height = 0;

        this._prevDrawStyle = "";
        this._tile = null;
        this._tile16x16 = null;
        this._tile_x = 0;
        this._tile_y = 0;

        Log.Debug(">> Display.constructor");

        // The visible canvas
        this._target = target;

        if (!this._target) {
            throw new Error("Target must be set");
        }

        if (typeof this._target === 'string') {
            throw new Error('target must be a DOM element');
        }

        if (!this._target.getContext) {
            throw new Error("no getContext method");
        }

        this._targetCtx = this._target.getContext('2d');

        // the visible canvas viewport (i.e. what actually gets seen)
        this._viewportLoc = { 'x': 0, 'y': 0, 'w': this._target.width, 'h': this._target.height };

        // The hidden canvas, where we do the actual rendering
        this._backbuffer = document.createElement('canvas');
        this._drawCtx = this._backbuffer.getContext('2d');

        this._damageBounds = { left:0, top:0,
                               right: this._backbuffer.width,
                               bottom: this._backbuffer.height };

        Log.Debug("User Agent: " + navigator.userAgent);

        this.clear();

        // Check canvas features
        if (!('createImageData' in this._drawCtx)) {
            throw new Error("Canvas does not support createImageData");
        }

        this._tile16x16 = this._drawCtx.createImageData(16, 16);
        Log.Debug("<< Display.constructor");

        // ===== PROPERTIES =====

        this._scale = 1.0;
        this._clipViewport = false;
        this.logo = null;

        // ===== EVENT HANDLERS =====

        this.onflush = () => {}; // A flush request has finished
    }

    // ===== PROPERTIES =====

    get scale() { return this._scale; }
    set scale(scale) {
        this._rescale(scale);
    }

    get clipViewport() { return this._clipViewport; }
    set clipViewport(viewport) {
        this._clipViewport = viewport;
        // May need to readjust the viewport dimensions
        const vp = this._viewportLoc;
        this.viewportChangeSize(vp.w, vp.h);
        this.viewportChangePos(0, 0);
    }

    get width() {
        return this._fb_width;
    }

    get height() {
        return this._fb_height;
    }

    // ===== PUBLIC METHODS =====

    viewportChangePos(deltaX, deltaY) {
        const vp = this._viewportLoc;
        deltaX = Math.floor(deltaX);
        deltaY = Math.floor(deltaY);

        if (!this._clipViewport) {
            deltaX = -vp.w;  // clamped later of out of bounds
            deltaY = -vp.h;
        }

        const vx2 = vp.x + vp.w - 1;
        const vy2 = vp.y + vp.h - 1;

        // Position change

        if (deltaX < 0 && vp.x + deltaX < 0) {
            deltaX = -vp.x;
        }
        if (vx2 + deltaX >= this._fb_width) {
            deltaX -= vx2 + deltaX - this._fb_width + 1;
        }

        if (vp.y + deltaY < 0) {
            deltaY = -vp.y;
        }
        if (vy2 + deltaY >= this._fb_height) {
            deltaY -= (vy2 + deltaY - this._fb_height + 1);
        }

        if (deltaX === 0 && deltaY === 0) {
            return;
        }
        Log.Debug("viewportChange deltaX: " + deltaX + ", deltaY: " + deltaY);

        vp.x += deltaX;
        vp.y += deltaY;

        this._damage(vp.x, vp.y, vp.w, vp.h);

        this.flip();
    }

    viewportChangeSize(width, height) {

        if (!this._clipViewport ||
            typeof(width) === "undefined" ||
            typeof(height) === "undefined") {

            Log.Debug("Setting viewport to full display region");
            width = this._fb_width;
            height = this._fb_height;
        }

        width = Math.floor(width);
        height = Math.floor(height);

        if (width > this._fb_width) {
            width = this._fb_width;
        }
        if (height > this._fb_height) {
            height = this._fb_height;
        }

        const vp = this._viewportLoc;
        if (vp.w !== width || vp.h !== height) {
            vp.w = width;
            vp.h = height;

            const canvas = this._target;
            canvas.width = width;
            canvas.height = height;

            // The position might need to be updated if we've grown
            this.viewportChangePos(0, 0);

            this._damage(vp.x, vp.y, vp.w, vp.h);
            this.flip();

            // Update the visible size of the target canvas
            this._rescale(this._scale);
        }
    }

    absX(x) {
        return x / this._scale + this._viewportLoc.x;
    }

    absY(y) {
        return y / this._scale + this._viewportLoc.y;
    }

    resize(width, height) {
        this._prevDrawStyle = "";

        this._fb_width = width;
        this._fb_height = height;

        const canvas = this._backbuffer;
        if (canvas.width !== width || canvas.height !== height) {

            // We have to save the canvas data since changing the size will clear it
            let saveImg = null;
            if (canvas.width > 0 && canvas.height > 0) {
                saveImg = this._drawCtx.getImageData(0, 0, canvas.width, canvas.height);
            }

            if (canvas.width !== width) {
                canvas.width = width;
            }
            if (canvas.height !== height) {
                canvas.height = height;
            }

            if (saveImg) {
                this._drawCtx.putImageData(saveImg, 0, 0);
            }
        }

        // Readjust the viewport as it may be incorrectly sized
        // and positioned
        const vp = this._viewportLoc;
        this.viewportChangeSize(vp.w, vp.h);
        this.viewportChangePos(0, 0);
    }

    // Track what parts of the visible canvas that need updating
    _damage(x, y, w, h) {
        if (x < this._damageBounds.left) {
            this._damageBounds.left = x;
        }
        if (y < this._damageBounds.top) {
            this._damageBounds.top = y;
        }
        if ((x + w) > this._damageBounds.right) {
            this._damageBounds.right = x + w;
        }
        if ((y + h) > this._damageBounds.bottom) {
            this._damageBounds.bottom = y + h;
        }
    }

    // Update the visible canvas with the contents of the
    // rendering canvas
    flip(from_queue) {
        if (this._renderQ.length !== 0 && !from_queue) {
            this._renderQ_push({
                'type': 'flip'
            });
        } else {
            let x = this._damageBounds.left;
            let y = this._damageBounds.top;
            let w = this._damageBounds.right - x;
            let h = this._damageBounds.bottom - y;

            let vx = x - this._viewportLoc.x;
            let vy = y - this._viewportLoc.y;

            if (vx < 0) {
                w += vx;
                x -= vx;
                vx = 0;
            }
            if (vy < 0) {
                h += vy;
                y -= vy;
                vy = 0;
            }

            if ((vx + w) > this._viewportLoc.w) {
                w = this._viewportLoc.w - vx;
            }
            if ((vy + h) > this._viewportLoc.h) {
                h = this._viewportLoc.h - vy;
            }

            if ((w > 0) && (h > 0)) {
                // FIXME: We may need to disable image smoothing here
                //        as well (see copyImage()), but we haven't
                //        noticed any problem yet.
                this._targetCtx.drawImage(this._backbuffer,
                                          x, y, w, h,
                                          vx, vy, w, h);
            }

            this._damageBounds.left = this._damageBounds.top = 65535;
            this._damageBounds.right = this._damageBounds.bottom = 0;
        }
    }

    clear() {
        if (this._logo) {
            this.resize(this._logo.width, this._logo.height);
            this.imageRect(0, 0, this._logo.type, this._logo.data);
        } else {
            this.resize(240, 20);
            this._drawCtx.clearRect(0, 0, this._fb_width, this._fb_height);
        }
        this.flip();
    }

    pending() {
        return this._renderQ.length > 0;
    }

    flush() {
        if (this._renderQ.length === 0) {
            this.onflush();
        } else {
            this._flushing = true;
        }
    }

    fillRect(x, y, width, height, color, from_queue) {
        if (this._renderQ.length !== 0 && !from_queue) {
            this._renderQ_push({
                'type': 'fill',
                'x': x,
                'y': y,
                'width': width,
                'height': height,
                'color': color
            });
        } else {
            this._setFillColor(color);
            this._drawCtx.fillRect(x, y, width, height);
            this._damage(x, y, width, height);
        }
    }

    copyImage(old_x, old_y, new_x, new_y, w, h, from_queue) {
        if (this._renderQ.length !== 0 && !from_queue) {
            this._renderQ_push({
                'type': 'copy',
                'old_x': old_x,
                'old_y': old_y,
                'x': new_x,
                'y': new_y,
                'width': w,
                'height': h,
            });
        } else {
            // Due to this bug among others [1] we need to disable the image-smoothing to
            // avoid getting a blur effect when copying data.
            //
            // 1. https://bugzilla.mozilla.org/show_bug.cgi?id=1194719
            //
            // We need to set these every time since all properties are reset
            // when the the size is changed
            this._drawCtx.mozImageSmoothingEnabled = false;
            this._drawCtx.webkitImageSmoothingEnabled = false;
            this._drawCtx.msImageSmoothingEnabled = false;
            this._drawCtx.imageSmoothingEnabled = false;

            this._drawCtx.drawImage(this._backbuffer,
                                    old_x, old_y, w, h,
                                    new_x, new_y, w, h);
            this._damage(new_x, new_y, w, h);
        }
    }

    imageRect(x, y, mime, arr) {
        const img = new Image();
        img.src = "data: " + mime + ";base64," + Base64.encode(arr);
        this._renderQ_push({
            'type': 'img',
            'img': img,
            'x': x,
            'y': y
        });
    }

    // start updating a tile
    startTile(x, y, width, height, color) {
        this._tile_x = x;
        this._tile_y = y;
        if (width === 16 && height === 16) {
            this._tile = this._tile16x16;
        } else {
            this._tile = this._drawCtx.createImageData(width, height);
        }

        const red = color[2];
        const green = color[1];
        const blue = color[0];

        const data = this._tile.data;
        for (let i = 0; i < width * height * 4; i += 4) {
            data[i] = red;
            data[i + 1] = green;
            data[i + 2] = blue;
            data[i + 3] = 255;
        }
    }

    // update sub-rectangle of the current tile
    subTile(x, y, w, h, color) {
        const red = color[2];
        const green = color[1];
        const blue = color[0];
        const xend = x + w;
        const yend = y + h;

        const data = this._tile.data;
        const width = this._tile.width;
        for (let j = y; j < yend; j++) {
            for (let i = x; i < xend; i++) {
                const p = (i + (j * width)) * 4;
                data[p] = red;
                data[p + 1] = green;
                data[p + 2] = blue;
                data[p + 3] = 255;
            }
        }
    }

    // draw the current tile to the screen
    finishTile() {
        this._drawCtx.putImageData(this._tile, this._tile_x, this._tile_y);
        this._damage(this._tile_x, this._tile_y,
                     this._tile.width, this._tile.height);
    }

    blitImage(x, y, width, height, arr, offset, from_queue) {
        if (this._renderQ.length !== 0 && !from_queue) {
            // NB(directxman12): it's technically more performant here to use preallocated arrays,
            // but it's a lot of extra work for not a lot of payoff -- if we're using the render queue,
            // this probably isn't getting called *nearly* as much
            const new_arr = new Uint8Array(width * height * 4);
            new_arr.set(new Uint8Array(arr.buffer, 0, new_arr.length));
            this._renderQ_push({
                'type': 'blit',
                'data': new_arr,
                'x': x,
                'y': y,
                'width': width,
                'height': height,
            });
        } else {
            this._bgrxImageData(x, y, width, height, arr, offset);
        }
    }

    blitRgbImage(x, y , width, height, arr, offset, from_queue) {
        if (this._renderQ.length !== 0 && !from_queue) {
            // NB(directxman12): it's technically more performant here to use preallocated arrays,
            // but it's a lot of extra work for not a lot of payoff -- if we're using the render queue,
            // this probably isn't getting called *nearly* as much
            const new_arr = new Uint8Array(width * height * 3);
            new_arr.set(new Uint8Array(arr.buffer, 0, new_arr.length));
            this._renderQ_push({
                'type': 'blitRgb',
                'data': new_arr,
                'x': x,
                'y': y,
                'width': width,
                'height': height,
            });
        } else {
            this._rgbImageData(x, y, width, height, arr, offset);
        }
    }

    blitRgbxImage(x, y, width, height, arr, offset, from_queue) {
        if (this._renderQ.length !== 0 && !from_queue) {
            // NB(directxman12): it's technically more performant here to use preallocated arrays,
            // but it's a lot of extra work for not a lot of payoff -- if we're using the render queue,
            // this probably isn't getting called *nearly* as much
            const new_arr = new Uint8Array(width * height * 4);
            new_arr.set(new Uint8Array(arr.buffer, 0, new_arr.length));
            this._renderQ_push({
                'type': 'blitRgbx',
                'data': new_arr,
                'x': x,
                'y': y,
                'width': width,
                'height': height,
            });
        } else {
            this._rgbxImageData(x, y, width, height, arr, offset);
        }
    }

    drawImage(img, x, y) {
        this._drawCtx.drawImage(img, x, y);
        this._damage(x, y, img.width, img.height);
    }

    autoscale(containerWidth, containerHeight) {
        const vp = this._viewportLoc;
        const targetAspectRatio = containerWidth / containerHeight;
        const fbAspectRatio = vp.w / vp.h;

        let scaleRatio;
        if (fbAspectRatio >= targetAspectRatio) {
            scaleRatio = containerWidth / vp.w;
        } else {
            scaleRatio = containerHeight / vp.h;
        }

        this._rescale(scaleRatio);
    }

    // ===== PRIVATE METHODS =====

    _rescale(factor) {
        this._scale = factor;
        const vp = this._viewportLoc;

        // NB(directxman12): If you set the width directly, or set the
        //                   style width to a number, the canvas is cleared.
        //                   However, if you set the style width to a string
        //                   ('NNNpx'), the canvas is scaled without clearing.
        const width = factor * vp.w + 'px';
        const height = factor * vp.h + 'px';

        if ((this._target.style.width !== width) ||
            (this._target.style.height !== height)) {
            this._target.style.width = width;
            this._target.style.height = height;
        }
    }

    _setFillColor(color) {
        const newStyle = 'rgb(' + color[2] + ',' + color[1] + ',' + color[0] + ')';
        if (newStyle !== this._prevDrawStyle) {
            this._drawCtx.fillStyle = newStyle;
            this._prevDrawStyle = newStyle;
        }
    }

    _rgbImageData(x, y, width, height, arr, offset) {
        const img = this._drawCtx.createImageData(width, height);
        const data = img.data;
        for (let i = 0, j = offset; i < width * height * 4; i += 4, j += 3) {
            data[i]     = arr[j];
            data[i + 1] = arr[j + 1];
            data[i + 2] = arr[j + 2];
            data[i + 3] = 255;  // Alpha
        }
        this._drawCtx.putImageData(img, x, y);
        this._damage(x, y, img.width, img.height);
    }

    _bgrxImageData(x, y, width, height, arr, offset) {
        const img = this._drawCtx.createImageData(width, height);
        const data = img.data;
        for (let i = 0, j = offset; i < width * height * 4; i += 4, j += 4) {
            data[i]     = arr[j + 2];
            data[i + 1] = arr[j + 1];
            data[i + 2] = arr[j];
            data[i + 3] = 255;  // Alpha
        }
        this._drawCtx.putImageData(img, x, y);
        this._damage(x, y, img.width, img.height);
    }

    _rgbxImageData(x, y, width, height, arr, offset) {
        // NB(directxman12): arr must be an Type Array view
        let img;
        if (SUPPORTS_IMAGEDATA_CONSTRUCTOR) {
            img = new ImageData(new Uint8ClampedArray(arr.buffer, arr.byteOffset, width * height * 4), width, height);
        } else {
            img = this._drawCtx.createImageData(width, height);
            img.data.set(new Uint8ClampedArray(arr.buffer, arr.byteOffset, width * height * 4));
        }
        this._drawCtx.putImageData(img, x, y);
        this._damage(x, y, img.width, img.height);
    }

    _renderQ_push(action) {
        this._renderQ.push(action);
        if (this._renderQ.length === 1) {
            // If this can be rendered immediately it will be, otherwise
            // the scanner will wait for the relevant event
            this._scan_renderQ();
        }
    }

    _resume_renderQ() {
        // "this" is the object that is ready, not the
        // display object
        this.removeEventListener('load', this._noVNC_display._resume_renderQ);
        this._noVNC_display._scan_renderQ();
    }

    _scan_renderQ() {
        let ready = true;
        while (ready && this._renderQ.length > 0) {
            const a = this._renderQ[0];
            switch (a.type) {
                case 'flip':
                    this.flip(true);
                    break;
                case 'copy':
                    this.copyImage(a.old_x, a.old_y, a.x, a.y, a.width, a.height, true);
                    break;
                case 'fill':
                    this.fillRect(a.x, a.y, a.width, a.height, a.color, true);
                    break;
                case 'blit':
                    this.blitImage(a.x, a.y, a.width, a.height, a.data, 0, true);
                    break;
                case 'blitRgb':
                    this.blitRgbImage(a.x, a.y, a.width, a.height, a.data, 0, true);
                    break;
                case 'blitRgbx':
                    this.blitRgbxImage(a.x, a.y, a.width, a.height, a.data, 0, true);
                    break;
                case 'img':
                    if (a.img.complete) {
                        this.drawImage(a.img, a.x, a.y);
                    } else {
                        a.img._noVNC_display = this;
                        a.img.addEventListener('load', this._resume_renderQ);
                        // We need to wait for this image to 'load'
                        // to keep things in-order
                        ready = false;
                    }
                    break;
            }

            if (ready) {
                this._renderQ.shift();
            }
        }

        if (this._renderQ.length === 0 && this._flushing) {
            this._flushing = false;
            this.onflush();
        }
    }
}
