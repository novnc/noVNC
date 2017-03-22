/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2012 Joel Martin
 * Copyright (C) 2015 Samuel Mannehed for Cendio AB
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 */

/*jslint browser: true, white: false */
/*global Util, Base64, changeCursor */

import { Engine, browserSupportsCursorURIs as cursorURIsSupported } from './util/browsers.js';
import { set_defaults, make_properties } from './util/properties.js';
import * as Log from './util/logging.js';
import Base64 from "./base64.js";

export default function Display(defaults) {
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

    set_defaults(this, defaults, {
        'true_color': true,
        'colourMap': [],
        'scale': 1.0,
        'viewport': false,
        'render_mode': '',
        "onFlush": function () {},
    });

    Log.Debug(">> Display.constructor");

    // The visible canvas
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
    if (Engine.gecko) { Log.Debug("Browser: gecko " + Engine.gecko); }
    if (Engine.webkit) { Log.Debug("Browser: webkit " + Engine.webkit); }
    if (Engine.trident) { Log.Debug("Browser: trident " + Engine.trident); }
    if (Engine.presto) { Log.Debug("Browser: presto " + Engine.presto); }

    this.clear();

    // Check canvas features
    if ('createImageData' in this._drawCtx) {
        this._render_mode = 'canvas rendering';
    } else {
        throw new Error("Canvas does not support createImageData");
    }

    if (this._prefer_js === null) {
        Log.Info("Prefering javascript operations");
        this._prefer_js = true;
    }

    // Determine browser support for setting the cursor via data URI scheme
    if (this._cursor_uri || this._cursor_uri === null ||
            this._cursor_uri === undefined) {
        this._cursor_uri = cursorURIsSupported();
    }

    Log.Debug("<< Display.constructor");
};

var SUPPORTS_IMAGEDATA_CONSTRUCTOR = false;
try {
    new ImageData(new Uint8ClampedArray(4), 1, 1);
    SUPPORTS_IMAGEDATA_CONSTRUCTOR = true;
} catch (ex) {
    // ignore failure
}

Display.prototype = {
    // Public methods
    viewportChangePos: function (deltaX, deltaY) {
        var vp = this._viewportLoc;
        deltaX = Math.floor(deltaX);
        deltaY = Math.floor(deltaY);

        if (!this._viewport) {
            deltaX = -vp.w;  // clamped later of out of bounds
            deltaY = -vp.h;
        }

        var vx2 = vp.x + vp.w - 1;
        var vy2 = vp.y + vp.h - 1;

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
    },

    viewportChangeSize: function(width, height) {

        if (!this._viewport ||
            typeof(width) === "undefined" ||
            typeof(height) === "undefined") {

            Log.Debug("Setting viewport to full display region");
            width = this._fb_width;
            height = this._fb_height;
        }

        if (width > this._fb_width) {
            width = this._fb_width;
        }
        if (height > this._fb_height) {
            height = this._fb_height;
        }

        var vp = this._viewportLoc;
        if (vp.w !== width || vp.h !== height) {
            vp.w = width;
            vp.h = height;

            var canvas = this._target;
            canvas.width = width;
            canvas.height = height;

            // The position might need to be updated if we've grown
            this.viewportChangePos(0, 0);

            this._damage(vp.x, vp.y, vp.w, vp.h);
            this.flip();

            // Update the visible size of the target canvas
            this._rescale(this._scale);
        }
    },

    absX: function (x) {
        return x / this._scale + this._viewportLoc.x;
    },

    absY: function (y) {
        return y / this._scale + this._viewportLoc.y;
    },

    resize: function (width, height) {
        this._prevDrawStyle = "";

        this._fb_width = width;
        this._fb_height = height;

        var canvas = this._backbuffer;
        if (canvas.width !== width || canvas.height !== height) {

            // We have to save the canvas data since changing the size will clear it
            var saveImg = null;
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
        var vp = this._viewportLoc;
        this.viewportChangeSize(vp.w, vp.h);
        this.viewportChangePos(0, 0);
    },

    // Track what parts of the visible canvas that need updating
    _damage: function(x, y, w, h) {
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
    },

    // Update the visible canvas with the contents of the
    // rendering canvas
    flip: function(from_queue) {
        if (this._renderQ.length !== 0 && !from_queue) {
            this._renderQ_push({
                'type': 'flip'
            });
        } else {
            var x, y, vx, vy, w, h;

            x = this._damageBounds.left;
            y = this._damageBounds.top;
            w = this._damageBounds.right - x;
            h = this._damageBounds.bottom - y;

            vx = x - this._viewportLoc.x;
            vy = y - this._viewportLoc.y;

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
    },

    clear: function () {
        if (this._logo) {
            this.resize(this._logo.width, this._logo.height);
            this.imageRect(0, 0, this._logo.type, this._logo.data);
        } else {
            this.resize(240, 20);
            this._drawCtx.clearRect(0, 0, this._fb_width, this._fb_height);
        }
        this.flip();
    },

    pending: function() {
        return this._renderQ.length > 0;
    },

    flush: function() {
        if (this._renderQ.length === 0) {
            this._onFlush();
        } else {
            this._flushing = true;
        }
    },

    fillRect: function (x, y, width, height, color, from_queue) {
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
    },

    copyImage: function (old_x, old_y, new_x, new_y, w, h, from_queue) {
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
    },

    imageRect: function(x, y, mime, arr) {
        var img = new Image();
        img.src = "data: " + mime + ";base64," + Base64.encode(arr);
        this._renderQ_push({
            'type': 'img',
            'img': img,
            'x': x,
            'y': y
        });
    },

    // start updating a tile
    startTile: function (x, y, width, height, color) {
        this._tile_x = x;
        this._tile_y = y;
        if (width === 16 && height === 16) {
            this._tile = this._tile16x16;
        } else {
            this._tile = this._drawCtx.createImageData(width, height);
        }

        if (this._prefer_js) {
            var bgr;
            if (this._true_color) {
                bgr = color;
            } else {
                bgr = this._colourMap[color[0]];
            }
            var red = bgr[2];
            var green = bgr[1];
            var blue = bgr[0];

            var data = this._tile.data;
            for (var i = 0; i < width * height * 4; i += 4) {
                data[i] = red;
                data[i + 1] = green;
                data[i + 2] = blue;
                data[i + 3] = 255;
            }
        } else {
            this.fillRect(x, y, width, height, color, true);
        }
    },

    // update sub-rectangle of the current tile
    subTile: function (x, y, w, h, color) {
        if (this._prefer_js) {
            var bgr;
            if (this._true_color) {
                bgr = color;
            } else {
                bgr = this._colourMap[color[0]];
            }
            var red = bgr[2];
            var green = bgr[1];
            var blue = bgr[0];
            var xend = x + w;
            var yend = y + h;

            var data = this._tile.data;
            var width = this._tile.width;
            for (var j = y; j < yend; j++) {
                for (var i = x; i < xend; i++) {
                    var p = (i + (j * width)) * 4;
                    data[p] = red;
                    data[p + 1] = green;
                    data[p + 2] = blue;
                    data[p + 3] = 255;
                }
            }
        } else {
            this.fillRect(this._tile_x + x, this._tile_y + y, w, h, color, true);
        }
    },

    // draw the current tile to the screen
    finishTile: function () {
        if (this._prefer_js) {
            this._drawCtx.putImageData(this._tile, this._tile_x, this._tile_y);
            this._damage(this._tile_x, this._tile_y,
                         this._tile.width, this._tile.height);
        }
        // else: No-op -- already done by setSubTile
    },

    blitImage: function (x, y, width, height, arr, offset, from_queue) {
        if (this._renderQ.length !== 0 && !from_queue) {
            // NB(directxman12): it's technically more performant here to use preallocated arrays,
            // but it's a lot of extra work for not a lot of payoff -- if we're using the render queue,
            // this probably isn't getting called *nearly* as much
            var new_arr = new Uint8Array(width * height * 4);
            new_arr.set(new Uint8Array(arr.buffer, 0, new_arr.length));
            this._renderQ_push({
                'type': 'blit',
                'data': new_arr,
                'x': x,
                'y': y,
                'width': width,
                'height': height,
            });
        } else if (this._true_color) {
            this._bgrxImageData(x, y, width, height, arr, offset);
        } else {
            this._cmapImageData(x, y, width, height, arr, offset);
        }
    },

    blitRgbImage: function (x, y , width, height, arr, offset, from_queue) {
        if (this._renderQ.length !== 0 && !from_queue) {
            // NB(directxman12): it's technically more performant here to use preallocated arrays,
            // but it's a lot of extra work for not a lot of payoff -- if we're using the render queue,
            // this probably isn't getting called *nearly* as much
            var new_arr = new Uint8Array(width * height * 3);
            new_arr.set(new Uint8Array(arr.buffer, 0, new_arr.length));
            this._renderQ_push({
                'type': 'blitRgb',
                'data': new_arr,
                'x': x,
                'y': y,
                'width': width,
                'height': height,
            });
        } else if (this._true_color) {
            this._rgbImageData(x, y, width, height, arr, offset);
        } else {
            // probably wrong?
            this._cmapImageData(x, y, width, height, arr, offset);
        }
    },

    blitRgbxImage: function (x, y, width, height, arr, offset, from_queue) {
        if (this._renderQ.length !== 0 && !from_queue) {
            // NB(directxman12): it's technically more performant here to use preallocated arrays,
            // but it's a lot of extra work for not a lot of payoff -- if we're using the render queue,
            // this probably isn't getting called *nearly* as much
            var new_arr = new Uint8Array(width * height * 4);
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
    },

    drawImage: function (img, x, y) {
        this._drawCtx.drawImage(img, x, y);
        this._damage(x, y, img.width, img.height);
    },

    changeCursor: function (pixels, mask, hotx, hoty, w, h) {
        if (this._cursor_uri === false) {
            Log.Warn("changeCursor called but no cursor data URI support");
            return;
        }

        if (this._true_color) {
            Display.changeCursor(this._target, pixels, mask, hotx, hoty, w, h);
        } else {
            Display.changeCursor(this._target, pixels, mask, hotx, hoty, w, h, this._colourMap);
        }
    },

    defaultCursor: function () {
        this._target.style.cursor = "default";
    },

    disableLocalCursor: function () {
        this._target.style.cursor = "none";
    },

    clippingDisplay: function () {
        var vp = this._viewportLoc;
        return this._fb_width > vp.w || this._fb_height > vp.h;
    },

    // Overridden getters/setters
    set_scale: function (scale) {
        this._rescale(scale);
    },

    set_viewport: function (viewport) {
        this._viewport = viewport;
        // May need to readjust the viewport dimensions
        var vp = this._viewportLoc;
        this.viewportChangeSize(vp.w, vp.h);
        this.viewportChangePos(0, 0);
    },

    get_width: function () {
        return this._fb_width;
    },
    get_height: function () {
        return this._fb_height;
    },

    autoscale: function (containerWidth, containerHeight, downscaleOnly) {
        var vp = this._viewportLoc;
        var targetAspectRatio = containerWidth / containerHeight;
        var fbAspectRatio = vp.w / vp.h;

        var scaleRatio;
        if (fbAspectRatio >= targetAspectRatio) {
            scaleRatio = containerWidth / vp.w;
        } else {
            scaleRatio = containerHeight / vp.h;
        }

        if (scaleRatio > 1.0 && downscaleOnly) {
            scaleRatio = 1.0;
        }

        this._rescale(scaleRatio);
    },

    // Private Methods
    _rescale: function (factor) {
        this._scale = factor;
        var vp = this._viewportLoc;

        // NB(directxman12): If you set the width directly, or set the
        //                   style width to a number, the canvas is cleared.
        //                   However, if you set the style width to a string
        //                   ('NNNpx'), the canvas is scaled without clearing.
        var width = Math.round(factor * vp.w) + 'px';
        var height = Math.round(factor * vp.h) + 'px';

        if ((this._target.style.width !== width) ||
            (this._target.style.height !== height)) {
            this._target.style.width = width;
            this._target.style.height = height;
        }
    },

    _setFillColor: function (color) {
        var bgr;
        if (this._true_color) {
            bgr = color;
        } else {
            bgr = this._colourMap[color];
        }

        var newStyle = 'rgb(' + bgr[2] + ',' + bgr[1] + ',' + bgr[0] + ')';
        if (newStyle !== this._prevDrawStyle) {
            this._drawCtx.fillStyle = newStyle;
            this._prevDrawStyle = newStyle;
        }
    },

    _rgbImageData: function (x, y, width, height, arr, offset) {
        var img = this._drawCtx.createImageData(width, height);
        var data = img.data;
        for (var i = 0, j = offset; i < width * height * 4; i += 4, j += 3) {
            data[i]     = arr[j];
            data[i + 1] = arr[j + 1];
            data[i + 2] = arr[j + 2];
            data[i + 3] = 255;  // Alpha
        }
        this._drawCtx.putImageData(img, x, y);
        this._damage(x, y, img.width, img.height);
    },

    _bgrxImageData: function (x, y, width, height, arr, offset) {
        var img = this._drawCtx.createImageData(width, height);
        var data = img.data;
        for (var i = 0, j = offset; i < width * height * 4; i += 4, j += 4) {
            data[i]     = arr[j + 2];
            data[i + 1] = arr[j + 1];
            data[i + 2] = arr[j];
            data[i + 3] = 255;  // Alpha
        }
        this._drawCtx.putImageData(img, x, y);
        this._damage(x, y, img.width, img.height);
    },

    _rgbxImageData: function (x, y, width, height, arr, offset) {
        // NB(directxman12): arr must be an Type Array view
        var img;
        if (SUPPORTS_IMAGEDATA_CONSTRUCTOR) {
            img = new ImageData(new Uint8ClampedArray(arr.buffer, arr.byteOffset, width * height * 4), width, height);
        } else {
            img = this._drawCtx.createImageData(width, height);
            img.data.set(new Uint8ClampedArray(arr.buffer, arr.byteOffset, width * height * 4));
        }
        this._drawCtx.putImageData(img, x, y);
        this._damage(x, y, img.width, img.height);
    },

    _cmapImageData: function (x, y, width, height, arr, offset) {
        var img = this._drawCtx.createImageData(width, height);
        var data = img.data;
        var cmap = this._colourMap;
        for (var i = 0, j = offset; i < width * height * 4; i += 4, j++) {
            var bgr = cmap[arr[j]];
            data[i]     = bgr[2];
            data[i + 1] = bgr[1];
            data[i + 2] = bgr[0];
            data[i + 3] = 255;  // Alpha
        }
        this._drawCtx.putImageData(img, x, y);
        this._damage(x, y, img.width, img.height);
    },

    _renderQ_push: function (action) {
        this._renderQ.push(action);
        if (this._renderQ.length === 1) {
            // If this can be rendered immediately it will be, otherwise
            // the scanner will wait for the relevant event
            this._scan_renderQ();
        }
    },

    _resume_renderQ: function() {
        // "this" is the object that is ready, not the
        // display object
        this.removeEventListener('load', this._noVNC_display._resume_renderQ);
        this._noVNC_display._scan_renderQ();
    },

    _scan_renderQ: function () {
        var ready = true;
        while (ready && this._renderQ.length > 0) {
            var a = this._renderQ[0];
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
            this._onFlush();
        }
    },
};

make_properties(Display, [
    ['target', 'wo', 'dom'],       // Canvas element for rendering
    ['context', 'ro', 'raw'],      // Canvas 2D context for rendering (read-only)
    ['logo', 'rw', 'raw'],         // Logo to display when cleared: {"width": w, "height": h, "type": mime-type, "data": data}
    ['true_color', 'rw', 'bool'],  // Use true-color pixel data
    ['colourMap', 'rw', 'arr'],    // Colour map array (when not true-color)
    ['scale', 'rw', 'float'],      // Display area scale factor 0.0 - 1.0
    ['viewport', 'rw', 'bool'],    // Use viewport clipping
    ['width', 'ro', 'int'],        // Display area width
    ['height', 'ro', 'int'],       // Display area height

    ['render_mode', 'ro', 'str'],  // Canvas rendering mode (read-only)

    ['prefer_js', 'rw', 'str'],    // Prefer Javascript over canvas methods
    ['cursor_uri', 'rw', 'raw'],   // Can we render cursor using data URI

    ['onFlush', 'rw', 'func'],     // onFlush(): A flush request has finished
]);

// Class Methods
Display.changeCursor = function (target, pixels, mask, hotx, hoty, w0, h0, cmap) {
    var w = w0;
    var h = h0;
    if (h < w) {
        h = w;  // increase h to make it square
    } else {
        w = h;  // increase w to make it square
    }

    var cur = [];

    // Push multi-byte little-endian values
    cur.push16le = function (num) {
        this.push(num & 0xFF, (num >> 8) & 0xFF);
    };
    cur.push32le = function (num) {
        this.push(num & 0xFF,
                  (num >> 8) & 0xFF,
                  (num >> 16) & 0xFF,
                  (num >> 24) & 0xFF);
    };

    var IHDRsz = 40;
    var RGBsz = w * h * 4;
    var XORsz = Math.ceil((w * h) / 8.0);
    var ANDsz = Math.ceil((w * h) / 8.0);

    cur.push16le(0);        // 0: Reserved
    cur.push16le(2);        // 2: .CUR type
    cur.push16le(1);        // 4: Number of images, 1 for non-animated ico

    // Cursor #1 header (ICONDIRENTRY)
    cur.push(w);            // 6: width
    cur.push(h);            // 7: height
    cur.push(0);            // 8: colors, 0 -> true-color
    cur.push(0);            // 9: reserved
    cur.push16le(hotx);     // 10: hotspot x coordinate
    cur.push16le(hoty);     // 12: hotspot y coordinate
    cur.push32le(IHDRsz + RGBsz + XORsz + ANDsz);
                            // 14: cursor data byte size
    cur.push32le(22);       // 18: offset of cursor data in the file

    // Cursor #1 InfoHeader (ICONIMAGE/BITMAPINFO)
    cur.push32le(IHDRsz);   // 22: InfoHeader size
    cur.push32le(w);        // 26: Cursor width
    cur.push32le(h * 2);    // 30: XOR+AND height
    cur.push16le(1);        // 34: number of planes
    cur.push16le(32);       // 36: bits per pixel
    cur.push32le(0);        // 38: Type of compression

    cur.push32le(XORsz + ANDsz);
                            // 42: Size of Image
    cur.push32le(0);        // 46: reserved
    cur.push32le(0);        // 50: reserved
    cur.push32le(0);        // 54: reserved
    cur.push32le(0);        // 58: reserved

    // 62: color data (RGBQUAD icColors[])
    var y, x;
    for (y = h - 1; y >= 0; y--) {
        for (x = 0; x < w; x++) {
            if (x >= w0 || y >= h0) {
                cur.push(0);  // blue
                cur.push(0);  // green
                cur.push(0);  // red
                cur.push(0);  // alpha
            } else {
                var idx = y * Math.ceil(w0 / 8) + Math.floor(x / 8);
                var alpha = (mask[idx] << (x % 8)) & 0x80 ? 255 : 0;
                if (cmap) {
                    idx = (w0 * y) + x;
                    var rgb = cmap[pixels[idx]];
                    cur.push(rgb[2]);  // blue
                    cur.push(rgb[1]);  // green
                    cur.push(rgb[0]);  // red
                    cur.push(alpha);   // alpha
                } else {
                    idx = ((w0 * y) + x) * 4;
                    cur.push(pixels[idx]);     // blue
                    cur.push(pixels[idx + 1]); // green
                    cur.push(pixels[idx + 2]); // red
                    cur.push(alpha);           // alpha
                }
            }
        }
    }

    // XOR/bitmask data (BYTE icXOR[])
    // (ignored, just needs to be the right size)
    for (y = 0; y < h; y++) {
        for (x = 0; x < Math.ceil(w / 8); x++) {
            cur.push(0);
        }
    }

    // AND/bitmask data (BYTE icAND[])
    // (ignored, just needs to be the right size)
    for (y = 0; y < h; y++) {
        for (x = 0; x < Math.ceil(w / 8); x++) {
            cur.push(0);
        }
    }

    var url = 'data:image/x-icon;base64,' + Base64.encode(cur);
    target.style.cursor = 'url(' + url + ')' + hotx + ' ' + hoty + ', default';
};
