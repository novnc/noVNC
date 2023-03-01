/*
 * KasmVNC: HTML5 VNC client
 * Copyright (C) 2020 Kasm Technologies
 * Copyright (C) 2019 The noVNC Authors
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 */

import * as Log from './util/logging.js';
import Base64 from "./base64.js";
import { toSigned32bit } from './util/int.js';
import { isWindows } from './util/browser.js';

export default class Display {
    constructor(target) {
        Log.Debug(">> Display.constructor");

        /*
        For performance reasons we use a multi dimensional array
        1st Dimension of Array Represents Frames, each element is a Frame
        2nd Dimension is the contents of a frame and meta data, contains 4 elements
            0 - int, FrameID
            1 - int, Rect Count
            2 - Array of Rect objects
            3 - bool, is the frame complete
            4 - int, index of current rect (post-processing)
            5 - int, number of times requestAnimationFrame called _pushAsyncFrame and the frame had all rects, however, the frame was not marked complete
        */
        this._asyncFrameQueue = [];
        this._maxAsyncFrameQueue = 3;
        this._clearAsyncQueue();

        this._flushing = false;

        // the full frame buffer (logical canvas) size
        this._fbWidth = 0;
        this._fbHeight = 0;

        this._renderMs = 0;
        this._prevDrawStyle = "";
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

        Log.Debug("User Agent: " + navigator.userAgent);

        // performance metrics
        this._flipCnt = 0;
        this._lastFlip = Date.now();
        this._droppedFrames = 0;
        this._droppedRects = 0;
        this._forcedFrameCnt = 0;
        this._missingFlipRect = 0;
        this._lateFlipRect = 0;
        this._frameStatsInterval = setInterval(function() {
            let delta = Date.now() - this._lastFlip;
            if (delta > 0) {
                this._fps = (this._flipCnt / (delta / 1000)).toFixed(2);
            }
            Log.Info('Dropped Frames: ' + this._droppedFrames + ' Dropped Rects: ' + this._droppedRects + ' Forced Frames: ' + this._forcedFrameCnt + ' Missing Flips: ' + this._missingFlipRect + ' Late Flips: ' + this._lateFlipRect);
            this._flipCnt = 0;
            this._lastFlip = Date.now();
        }.bind(this), 5000);

        // ===== PROPERTIES =====

        this._scale = 1.0;
        this._clipViewport = false;
        this._antiAliasing = 0;
        this._fps = 0;

        // ===== EVENT HANDLERS =====

        this.onflush = () => {  }; // A flush request has finished

        // Use requestAnimationFrame to write to canvas, to match display refresh rate
        this._animationFrameID = window.requestAnimationFrame( () => { this._pushAsyncFrame(); });

        Log.Debug("<< Display.constructor");
    }

    // ===== PROPERTIES =====
    
    get antiAliasing() { return this._antiAliasing; }
    set antiAliasing(value) {
        this._antiAliasing = value;
        this._rescale(this._scale);
    }

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
        return this._fbWidth;
    }

    get height() {
        return this._fbHeight;
    }

    get renderMs() {
        return this._renderMs;
    }
    set renderMs(val) {
        this._renderMs = val;
    }

    get fps() { return this._fps; }

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
        if (vx2 + deltaX >= this._fbWidth) {
            deltaX -= vx2 + deltaX - this._fbWidth + 1;
        }

        if (vp.y + deltaY < 0) {
            deltaY = -vp.y;
        }
        if (vy2 + deltaY >= this._fbHeight) {
            deltaY -= (vy2 + deltaY - this._fbHeight + 1);
        }

        if (deltaX === 0 && deltaY === 0) {
            return;
        }
        Log.Debug("viewportChange deltaX: " + deltaX + ", deltaY: " + deltaY);
    }

    viewportChangeSize(width, height) {

        if (!this._clipViewport ||
            typeof(width) === "undefined" ||
            typeof(height) === "undefined") {

            Log.Debug("Setting viewport to full display region");
            width = this._fbWidth;
            height = this._fbHeight;
        }

        width = Math.floor(width);
        height = Math.floor(height);

        if (width > this._fbWidth) {
            width = this._fbWidth;
        }
        if (height > this._fbHeight) {
            height = this._fbHeight;
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

            // Update the visible size of the target canvas
            this._rescale(this._scale);
        }
    }

    absX(x) {
        if (this._scale === 0) {
            return 0;
        }
        return toSigned32bit(x / this._scale + this._viewportLoc.x);
    }

    absY(y) {
        if (this._scale === 0) {
            return 0;
        }
        return toSigned32bit(y / this._scale + this._viewportLoc.y);
    }

    resize(width, height) {
        this._prevDrawStyle = "";

        this._fbWidth = width;
        this._fbHeight = height;

        const canvas = this._target;
        if (canvas == undefined) { return; }
        if (canvas.width !== width || canvas.height !== height) {

            // We have to save the canvas data since changing the size will clear it
            let saveImg = null;
            if (canvas.width > 0 && canvas.height > 0) {
                saveImg = this._targetCtx.getImageData(0, 0, canvas.width, canvas.height);
            }

            if (canvas.width !== width) {
                canvas.width = width;
            }
            if (canvas.height !== height) {
                canvas.height = height;
            }

            if (saveImg) {
                this._targetCtx.putImageData(saveImg, 0, 0);
            }
        }

        // Readjust the viewport as it may be incorrectly sized
        // and positioned
        const vp = this._viewportLoc;
        this.viewportChangeSize(vp.w, vp.h);
        this.viewportChangePos(0, 0);
    }

    /*
    * Mark the specified frame with a rect count
    * @param {number} frame_id - The frame ID of the target frame
    * @param {number} rect_cnt - The number of rects in the target frame
    */
    flip(frame_id, rect_cnt) {
        this._asyncRenderQPush({
            'type': 'flip',
            'frame_id': frame_id,
            'rect_cnt': rect_cnt
        });
    }

    /*
    * Is the frame queue full
    * @returns {bool} is the queue full
    */
    pending() {
        //is the slot in the queue for the newest frame in use
        return this._asyncFrameQueue[this._maxAsyncFrameQueue - 1][0] > 0;
    }

    /*
    * Force the oldest frame in the queue to render, whether ready or not.
    * @param {bool} onflush_message - The caller wants an onflush event triggered once complete. This is
    *   useful for TCP, allowing the websocket to block until we are ready to process the next frame.
    *   UDP cannot block and thus no need to notify the caller when complete.
    */
    flush(onflush_message=true) {
        //force oldest frame to render
        this._asyncFrameComplete(0, true);

        if (onflush_message)
            this._flushing = true;
    }
    
    /*
    * Clears the buffer of anything that has not yet been displayed.
    * This must be called when switching between transit modes tcp/udp
    */
    clear() {
       this._clearAsyncQueue();
    }

    /*
    * Cleans up resources, should be called on a disconnect
    */
    dispose() {
        clearInterval(this._frameStatsInterval);
        cancelAnimationFrame(this._animationFrameID);
        this.clear();
    }

    fillRect(x, y, width, height, color, frame_id, fromQueue) {
        if (!fromQueue) {
            this._asyncRenderQPush({
                'type': 'fill',
                'x': x,
                'y': y,
                'width': width,
                'height': height,
                'color': color,
                'frame_id': frame_id
            });
        } else {
            this._setFillColor(color);
            this._targetCtx.fillRect(x, y, width, height);
        }
    }

    copyImage(oldX, oldY, newX, newY, w, h, frame_id, fromQueue) {
        if (!fromQueue) {
            this._asyncRenderQPush({
                'type': 'copy',
                'oldX': oldX,
                'oldY': oldY,
                'x': newX,
                'y': newY,
                'width': w,
                'height': h,
                'frame_id': frame_id
            });
        } else {
            // Due to this bug among others [1] we need to disable the image-smoothing to
            // avoid getting a blur effect when copying data.
            //
            // 1. https://bugzilla.mozilla.org/show_bug.cgi?id=1194719
            //
            // We need to set these every time since all properties are reset
            // when the the size is changed
            this._targetCtx.mozImageSmoothingEnabled = false;
            this._targetCtx.webkitImageSmoothingEnabled = false;
            this._targetCtx.msImageSmoothingEnabled = false;
            this._targetCtx.imageSmoothingEnabled = false;

            this._targetCtx.drawImage(this._target,
                                    oldX, oldY, w, h,
                                    newX, newY, w, h);
        }
    }

    imageRect(x, y, width, height, mime, arr, frame_id) {
        /* The internal logic cannot handle empty images, so bail early */
        if ((width === 0) || (height === 0)) {
            return;
        }
        const img = new Image();
        img.src = "data: " + mime + ";base64," + Base64.encode(arr);

        this._asyncRenderQPush({
            'type': 'img',
            'img': img,
            'x': x,
            'y': y,
            'width': width,
            'height': height,
            'frame_id': frame_id
        });
    }

    transparentRect(x, y, width, height, img, frame_id) {
        /* The internal logic cannot handle empty images, so bail early */
        if ((width === 0) || (height === 0)) {
            return;
        }

        var rect = {
            'type': 'transparent',
            'img': null,
            'x': x,
            'y': y,
            'width': width,
            'height': height,
            'frame_id': frame_id
        }

        let imageBmpPromise = createImageBitmap(img);
        imageBmpPromise.then( function(img) {
            rect.img = img;
            rect.img.complete = true;
        }.bind(rect) );

        this._asyncRenderQPush(rect);
    }

    blitImage(x, y, width, height, arr, offset, frame_id, fromQueue) {
        if (!fromQueue) {
            // NB(directxman12): it's technically more performant here to use preallocated arrays,
            // but it's a lot of extra work for not a lot of payoff -- if we're using the render queue,
            // this probably isn't getting called *nearly* as much
            const newArr = new Uint8Array(width * height * 4);
            newArr.set(new Uint8Array(arr.buffer, 0, newArr.length));
            this._asyncRenderQPush({
                'type': 'blit',
                'data': newArr,
                'x': x,
                'y': y,
                'width': width,
                'height': height,
                'frame_id': frame_id
            });
        } else {
            // NB(directxman12): arr must be an Type Array view
            let data = new Uint8ClampedArray(arr.buffer,
                                             arr.byteOffset + offset,
                                             width * height * 4);
            let img = new ImageData(data, width, height);
            this._targetCtx.putImageData(img, x, y);
        }
    }

    blitQoi(x, y, width, height, arr, offset, frame_id, fromQueue) {
        if (!fromQueue) {
            this._asyncRenderQPush({
                'type': 'blitQ',
                'data': arr,
                'x': x,
                'y': y,
                'width': width,
                'height': height,
                'frame_id': frame_id
            });
        } else {
            this._targetCtx.putImageData(arr, x, y);
        }
    }

    drawImage(img, x, y, w, h) {
        try {
            if (img.width != w || img.height != h) {
                this._targetCtx.drawImage(img, x, y, w, h);
            } else {
                this._targetCtx.drawImage(img, x, y);
            }
        } catch (error) {
            Log.Error('Invalid image recieved.'); //KASM-2090
        }
    }

    autoscale(containerWidth, containerHeight, scaleRatio=0) {

        if (containerWidth === 0 || containerHeight === 0) {
            scaleRatio = 0;

        } else if (scaleRatio === 0) {

            const vp = this._viewportLoc;
            const targetAspectRatio = containerWidth / containerHeight;
            const fbAspectRatio = vp.w / vp.h;

            if (fbAspectRatio >= targetAspectRatio) {
                scaleRatio = containerWidth / vp.w;
            } else {
                scaleRatio = containerHeight / vp.h;
            }
        }

        this._rescale(scaleRatio);
    }

    // ===== PRIVATE METHODS =====

    /*
    Process incoming rects into a frame buffer, assume rects are out of order due to either UDP or parallel processing of decoding
    */
    _asyncRenderQPush(rect) {
        let frameIx = -1;
        let oldestFrameID = Number.MAX_SAFE_INTEGER;
        let newestFrameID = 0;
        for (let i=0; i<this._asyncFrameQueue.length; i++) {
            if (rect.frame_id == this._asyncFrameQueue[i][0]) {
                this._asyncFrameQueue[i][2].push(rect);
                frameIx = i;
                break;
            } else if (this._asyncFrameQueue[i][0] == 0) {
                let rect_cnt = ((rect.type == "flip") ? rect.rect_cnt : 0);
                this._asyncFrameQueue[i][0] = rect.frame_id;
                this._asyncFrameQueue[i][2].push(rect);
                this._asyncFrameQueue[i][3] = (rect_cnt == 1);
                frameIx = i;
                break;
            }
            oldestFrameID = Math.min(oldestFrameID, this._asyncFrameQueue[i][0]);
            newestFrameID = Math.max(newestFrameID, this._asyncFrameQueue[i][0]);
        }

        if (frameIx >= 0) {
            if (rect.type == "flip") {
                //flip rect contains the rect count for the frame
                if (this._asyncFrameQueue[frameIx][1] !== 0) {
                    Log.Warn("Redundant flip rect, current rect_cnt: " + this._asyncFrameQueue[frameIx][1] + ", new rect_cnt: " + rect.rect_cnt );
                }
                this._asyncFrameQueue[frameIx][1] = rect.rect_cnt;
                if (rect.rect_cnt == 0) {
                    Log.Warn("Invalid rect count");
                }  
            }

            if (this._asyncFrameQueue[frameIx][1] == this._asyncFrameQueue[frameIx][2].length) {
                //frame is complete
                this._asyncFrameComplete(frameIx);
            }
        } else {
            if (rect.frame_id < oldestFrameID) {
                //rect is older than any frame in the queue, drop it
                this._droppedRects++;
                if (rect.type == "flip") { this._lateFlipRect++; }
                return;
            } else if (rect.frame_id > newestFrameID) {
                //frame is newer than any frame in the queue, drop old frames
                this._asyncFrameQueue.shift();
                let rect_cnt = ((rect.type == "flip") ? rect.rect_cnt : 0);
                this._asyncFrameQueue.push([ rect.frame_id, rect_cnt, [ rect ], (rect_cnt == 1), 0, 0 ]);
                this._droppedFrames++;
            }
        }
        
    }

    /*
    Clear the async frame buffer
    */
    _clearAsyncQueue() {
        this._droppedFrames += this._asyncFrameQueue.length;

        this._asyncFrameQueue = [];
        for (let i=0; i<this._maxAsyncFrameQueue; i++) {
            this._asyncFrameQueue.push([ 0, 0, [], false, 0, 0 ])
        }
    }

    /*
    Pre-processing required before displaying a finished frame
    If marked force, unloaded images will be skipped and the frame will be marked complete and ready for rendering
    */
    _asyncFrameComplete(frameIx, force=false) {
        let currentFrameRectIx = this._asyncFrameQueue[frameIx][4];

        if (force) {
            if (this._asyncFrameQueue[frameIx][1] == 0) {
                this._missingFlipRect++; //at minimum the flip rect is missing
            } else if (this._asyncFrameQueue[frameIx][1] !== this._asyncFrameQueue[frameIx][2].length) {
                this._droppedRects += (this._asyncFrameQueue[frameIx][1] - this._asyncFrameQueue[frameIx][2].length);
                if (this._asyncFrameQueue[frameIx][2].length > this._asyncFrameQueue[frameIx][1]) {
                    Log.Warn("Frame has more rects than the reported rect_cnt.");
                }
            }
            while (currentFrameRectIx < this._asyncFrameQueue[frameIx][2].length) {   
                if (this._asyncFrameQueue[frameIx][2][currentFrameRectIx].type == 'img' && !this._asyncFrameQueue[frameIx][2][currentFrameRectIx].img.complete) {
                    this._asyncFrameQueue[frameIx][2][currentFrameRectIx].type = 'skip';
                    this._droppedRects++;
                }
                currentFrameRectIx++;
            }
        } else {
            while (currentFrameRectIx < this._asyncFrameQueue[frameIx][2].length) {
                if (this._asyncFrameQueue[frameIx][2][currentFrameRectIx].type == 'img' && !this._asyncFrameQueue[frameIx][2][currentFrameRectIx].img.complete) {
                    this._asyncFrameQueue[frameIx][2][currentFrameRectIx].img.addEventListener('load', () => { this._asyncFrameComplete(frameIx); });
                    this._asyncFrameQueue[frameIx][4] = currentFrameRectIx;
                    return;
                } else if (this._asyncFrameQueue[frameIx][2][currentFrameRectIx].type == 'transparent' && !this._asyncFrameQueue[frameIx][2][currentFrameRectIx].img) {
                    return;
                }

                currentFrameRectIx++;
            }
        }
        this._asyncFrameQueue[frameIx][4] = currentFrameRectIx;
        this._asyncFrameQueue[frameIx][3] = true;
    }

    /*
    Push the oldest frame in the buffer to the canvas if it is marked ready
    */
    _pushAsyncFrame(force=false) {
        if (this._asyncFrameQueue[0][3] || force) {
            let frame = this._asyncFrameQueue.shift()[2];
            if (this._asyncFrameQueue.length < this._maxAsyncFrameQueue) {
                this._asyncFrameQueue.push([ 0, 0, [], false, 0, 0 ]);
            }

            let transparent_rects = [];
            
            //render the selected frame
            for (let i = 0; i < frame.length; i++) {
                
                const a = frame[i];
                switch (a.type) {
                    case 'copy':
                        this.copyImage(a.oldX, a.oldY, a.x, a.y, a.width, a.height, a.frame_id, true);
                        break;
                    case 'fill':
                        this.fillRect(a.x, a.y, a.width, a.height, a.color, a.frame_id, true);
                        break;
                    case 'blit':
                        this.blitImage(a.x, a.y, a.width, a.height, a.data, 0, a.frame_id, true);
                        break;
                    case 'blitQ':
                        this.blitQoi(a.x, a.y, a.width, a.height, a.data, 0, a.frame_id, true);
                        break;
                    case 'img':
                        this.drawImage(a.img, a.x, a.y, a.width, a.height);
                        break;
                    case 'transparent':
                        transparent_rects.push(a);
                        break;
                }
            }

            //rects with transparency get applied last
            for (let i = 0; i < transparent_rects.length; i++) {
                const a = transparent_rects[i];
                
                if (a.img) {
                    this.drawImage(a.img, a.x, a.y, a.width, a.height);
                }
            }

            this._flipCnt += 1;

            if (this._flushing) {
                this._flushing = false;
                this.onflush();
            }
        } else if (this._asyncFrameQueue[0][1] > 0 && this._asyncFrameQueue[0][1] == this._asyncFrameQueue[0][2].length) {
            //how many times has _pushAsyncFrame been called when the frame had all rects but has not been drawn
            this._asyncFrameQueue[0][5] += 1;
            //force the frame to be drawn if it has been here too long
            if (this._asyncFrameQueue[0][5] > 5) { 
                this._pushAsyncFrame(true);
            }
        }

        if (!force) {
            window.requestAnimationFrame( () => { this._pushAsyncFrame(); });
        }
    }

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

        Log.Info('Pixel Ratio: ' + window.devicePixelRatio + ', VNC Scale: ' + factor + 'VNC Res: ' + vp.w + 'x' + vp.h);

        var pixR = Math.abs(Math.ceil(window.devicePixelRatio));
        var isFirefox = navigator.userAgent.toLowerCase().indexOf('firefox') > -1;

        if (this.antiAliasing === 2 || (this.antiAliasing === 0 && factor === 1 && this._target.style.imageRendering !== 'pixelated' && pixR === window.devicePixelRatio && vp.w > 0)) {
            this._target.style.imageRendering = ((!isFirefox) ? 'pixelated' : 'crisp-edges' );
            Log.Debug('Smoothing disabled');
        } else if (this.antiAliasing === 1 || (this.antiAliasing === 0 && factor !== 1 && this._target.style.imageRendering !== 'auto')) {
            this._target.style.imageRendering = 'auto'; //auto is really smooth (blurry) using trilinear of linear
            Log.Debug('Smoothing enabled');
        }
    }

    _setFillColor(color) {
        const newStyle = 'rgb(' + color[0] + ',' + color[1] + ',' + color[2] + ')';
        if (newStyle !== this._prevDrawStyle) {
            this._targetCtx.fillStyle = newStyle;
            this._prevDrawStyle = newStyle;
        }
    }
}
