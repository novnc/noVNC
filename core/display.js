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
import { uuidv4 } from './util/strings.js';

export default class Display {
    constructor(target, isPrimaryDisplay) {
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
        this._syncFrameQueue = [];
        this._transparentOverlayImg = null;
        this._transparentOverlayRect = null;
        this._lastTransparentRectId = "";

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
            Log.Debug('Dropped Frames: ' + this._droppedFrames + ' Dropped Rects: ' + this._droppedRects + ' Forced Frames: ' + this._forcedFrameCnt + ' Missing Flips: ' + this._missingFlipRect + ' Late Flips: ' + this._lateFlipRect);
            this._flipCnt = 0;
            this._lastFlip = Date.now();
        }.bind(this), 5000);

        // ===== PROPERTIES =====

        this._maxScreens = 4;
        this._scale = 1.0;
        this._clipViewport = false;
        this._antiAliasing = 0;
        this._fps = 0;
        this._isPrimaryDisplay = isPrimaryDisplay;
        this._screenID = uuidv4();
        this._screens = [{ 
            screenID: this._screenID,
            screenIndex: 0,
            width: this._target.width, //client
            height: this._target.height, //client
            serverWidth: 0, //calculated
            serverHeight: 0, //calculated
            serverReportedWidth: 0,
            serverReportedHeight: 0,
            x: 0,
            y: 0,
            scale: 1,
            relativePosition: 0, //left, right, up, down relative to primary display
            relativePositionX: 0, //offset relative to primary monitor, always 0 for primary
            relativePositionY: 0, //offset relative to primary monitor, always 0 for primary
            pixelRatio: window.devicePixelRatio,
            containerHeight: this._target.parentNode.offsetHeight,
            containerWidth: this._target.parentNode.offsetWidth,
            channel: null,
            x2: 0,
            y2: 0
        }];

        //optional offscreen canvas
        this._enableCanvasBuffer = false;
        this._backbuffer = document.createElement('canvas');
        this._drawCtx = this._backbuffer.getContext('2d');
        this._damageBounds = { left: 0, top: 0, right: this._backbuffer.width, bottom: this._backbuffer.height };

        // ===== EVENT HANDLERS =====

        this.onflush = () => {  }; // A flush request has finished

        if (!this._isPrimaryDisplay) {
            this._screens[0].channel = new BroadcastChannel(`screen_${this._screenID}_channel`);
            this._screens[0].channel.addEventListener('message', this._handleSecondaryDisplayMessage.bind(this));
        }

        Log.Debug("<< Display.constructor");
    }

    // ===== PROPERTIES =====

    get enableCanvasBuffer() { return this._enableCanvasBuffer; }
    set enableCanvasBuffer(value) {
        if (value === this._enableCanvasBuffer) { return; }

        this._enableCanvasBuffer = value;

        
        if (value && this._target)
        {
            //copy current visible canvas to backbuffer
            let saveImg = this._targetCtx.getImageData(0, 0, this._target.width, this._target.height);
            this._drawCtx.putImageData(saveImg, 0, 0);

            if (this._transparentOverlayImg) {
                this.drawImage(this._transparentOverlayImg, this._transparentOverlayRect.x, this._transparentOverlayRect.y, this._transparentOverlayRect.width, this._transparentOverlayRect.height, true);
            }
        } else if (!value && this._target) {
            //copy backbuffer to canvas to clear any overlays
            let saveImg = this._targetCtx.getImageData(0, 0, this._target.width, this._target.height);
            this._drawCtx.putImageData(saveImg, 0, 0);
        }
    }

    get screens() { return this._screens; }
    get screenID() { return this._screenID; }
    get screenIndex() {
        // A secondary screen should not have a screen index of 0, but it will be 0 until registration is complete
        // returning a -1 lets the caller know the screen has not been registered yet
        if (!this._isPrimaryDisplay && this._screens[0].screenIndex == 0) {
            return -1;
        }
        return this._screens[0].screenIndex; 
    }
    
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
        const vp = this._screens[0];
        this.viewportChangeSize(vp.width, vp.height);
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

    /*
    Returns the screen index and relative coordinates given globally scoped coordinates
    */
    getClientRelativeCoordinates(x, y) {
        for (let i = 0; i < this._screens.length; i++) {
            if ( 
                (x >= this._screens[i].x && x <= this._screens[i].x + this._screens[i].serverWidth) &&
                (y >= this._screens[i].y && y <= this._screens[i].y + this._screens[i].serverHeight)
                )
                {
                    return {
                        "screenIndex": i,
                        "x": x - this._screens[i].x,
                        "y": y - this._screens[i].y
                    }
                }
        }
    }

    /* 
    Returns coordinates that are server relative when multiple monitors are in use
    */
    getServerRelativeCoordinates(screenIndex, x, y) {
        if (screenIndex >= 0 && screenIndex < this._screens.length) {
            x = toSigned32bit(x / this._screens[screenIndex].scale + this._screens[screenIndex].x);
            y = toSigned32bit(y / this._screens[screenIndex].scale + this._screens[screenIndex].y);
        }

        return [x, y];
    }

    getScreenSize(resolutionQuality, max_width, max_height, hiDpi, disableLimit, disableScaling) {
        let data = {
            screens: null,
            serverWidth: 0,
            serverHeight: 0
        }

        let i = 0;

        //recalculate primary display container size
        this._screens[i].containerHeight = this._target.parentNode.offsetHeight;
        this._screens[i].containerWidth = this._target.parentNode.offsetWidth;
        this._screens[i].pixelRatio = window.devicePixelRatio;
        this._screens[i].width = this._target.parentNode.offsetWidth;
        this._screens[i].height = this._target.parentNode.offsetHeight;

        //calculate server-side and client-side resolution of each screen
        let width = max_width || this._screens[i].containerWidth;
        let height = max_height || this._screens[i].containerHeight;
        let scale = 1;

        //max the resolution of a single screen to 1280
        if (
            (this._screens[i].serverReportedWidth > 0 && this._screens[i].serverReportedHeight > 0) &&
            (
                disableScaling ||
                (this._screens[i].serverReportedWidth !== this._screens[i].serverWidth || this._screens[i].serverReportedHeight !== this._screens[i].serverHeight)
            ) && 
            (!max_width && !max_height)
        ) {
            height = this._screens[i].serverReportedHeight;
            width = this._screens[i].serverReportedWidth;
        }
        else if (width > 1280 && !disableLimit && resolutionQuality == 1) {
            height = Math.floor(1280 * (height/width)); //keeping the aspect ratio of original resolution, shrink y to match x
            width = 1280;
        }
        //hard coded 720p
        else if (resolutionQuality == 0 && !disableLimit) {
            width = 1280;
            height = 720;
        }
        //force full resolution on a high DPI monitor where the OS is scaling
        else if (hiDpi) {
            width = Math.floor(width * this._screens[i].pixelRatio);
            height = Math.floor(height * this._screens[i].pixelRatio);
            scale = 1 / this._screens[i].pixelRatio;
        }
        //physically small device with high DPI
        else if (this._antiAliasing === 0 && this._screens[i].pixelRatio > 1 && width < 1000 & width > 0) {
            Log.Info('Device Pixel ratio: ' + this._screens[i].pixelRatio + ' Reported Resolution: ' + width + 'x' + height); 
            let targetDevicePixelRatio = 1.5;
            if (this._screens[i].pixelRatio > 2) { targetDevicePixelRatio = 2; }
            let scaledWidth = (width * this._screens[i].pixelRatio) * (1 / targetDevicePixelRatio);
            let scaleRatio = scaledWidth / width;
            width = width * scaleRatio;
            height = height * scaleRatio;
            scale = 1 / scaleRatio;
            Log.Info('Small device with hDPI screen detected, auto scaling at ' + scaleRatio + ' to ' + width + 'x' + height);
        }
        
        let clientServerRatioH = this._screens[i].containerHeight / height;
        let clientServerRatioW = this._screens[i].containerWidth / width;
        
        this._screens[i].height = Math.floor(height * clientServerRatioH);
        this._screens[i].width = Math.floor(width * clientServerRatioW);
        this._screens[i].serverWidth = width;
        this._screens[i].serverHeight = height;
        this._screens[i].scale = Math.min(clientServerRatioH, clientServerRatioW);


        for (i = 0; i < this._screens.length; i++) {
            this._screens[i].x2 = this._screens[i].x + this._screens[i].serverWidth;
            this._screens[i].y2 = this._screens[i].y + this._screens[i].serverHeight;
            data.serverWidth = Math.max(data.serverWidth, this._screens[i].x + this._screens[i].serverWidth);
            data.serverHeight = Math.max(data.serverHeight, this._screens[i].y + this._screens[i].serverHeight);
        }

        data.screens = this._screens;

        return data;
    }

    applyServerResolution(width, height, screenIndex) {
        for (let z = 0; z < this._screens.length; z++) {
            if (screenIndex === this._screens[z].screenIndex) {
                this._screens[z].serverReportedWidth = width;
                this._screens[z].serverReportedHeight = height;
            }
        }
    }

    applyScreenPlan(screenPlan) {
        //check all screens for any changes, but only apply changes to primary screen, secondary screens will individually be updated and report back with their new settings
        let changes = false;
        for (let i = 0; i < screenPlan.screens.length; i++) {
            for (let z = 0; z < this._screens.length; z++) {
                if (screenPlan.screens[i].screenID === this._screens[z].screenID) {
                    if (this._screens[z].x !== screenPlan.screens[i].x || this._screens[z].y !== screenPlan.screens[i].y) {
                        if (z == 0) {
                            this._screens[z].x = screenPlan.screens[i].x;
                            this._screens[z].y = screenPlan.screens[i].y;
                        }
                        changes = true;
                    }
                    if (this._screens[z].x2 !== this._screens[z].x + this._screens[z].serverWidth || this._screens[z].y2 !== this._screens[z].y + this._screens[z].serverHeight) {
                        if (z == 0) {
                            this._screens[z].x2 = this._screens[z].x + this._screens[z].serverWidth
                            this._screens[z].y2 = this._screens[z].y + this._screens[z].serverHeight

                        }
                        changes = true;
                    }
                }
            }
        }
        return changes;
    }

    addScreen(screenID, width, height, pixelRatio, containerHeight, containerWidth, scale, serverWidth, serverHeight, x, y) {
        if (!this._isPrimaryDisplay) {
            throw new Error("Cannot add a screen to a secondary display.");
        }
        else if (containerHeight === 0 || containerWidth === 0 || pixelRatio === 0) {
            Log.Warn("Invalid screen configuration."); 
        }
        let screenIdx = -1;

        //Does the screen already exist?
        for (let i = 0; i < this._screens.length; i++) {
            if (this._screens[i].screenID === screenID) {
                screenIdx = i;
            }
        }

        if (screenIdx > 0) {
            //existing screen, update
            const existing_screen = this._screens[screenIdx];
            if (existing_screen.serverHeight !== serverHeight || existing_screen.serverWidth !== serverWidth || existing_screen.width !== width || existing_screen.height !== height 
                || existing_screen.containerHeight !== containerHeight || existing_screen.containerWidth !== containerWidth || existing_screen.scale !== scale || existing_screen.pixelRatio !== pixelRatio || 
                existing_screen.x !== x || existing_screen.y !== y) {
                existing_screen.width = width;
                existing_screen.height = height;
                existing_screen.containerHeight = containerHeight;
                existing_screen.containerWidth = containerWidth;
                existing_screen.pixelRatio = pixelRatio;
                existing_screen.scale = scale;
                existing_screen.serverWidth = serverWidth;
                existing_screen.serverHeight = serverHeight;
                existing_screen.x = x;
                existing_screen.y = y;
                existing_screen.x2 = existing_screen.x + existing_screen.serverWidth;
                existing_screen.y2 = existing_screen.y + existing_screen.serverHeight;
                return true;
            }
        } else {
            //New Screen, add to far right until user repositions it
            for (let i = 0; i < this._screens.length; i++) {
                x = Math.max(x, this._screens[i].x + this._screens[i].serverWidth);
            }

            var new_screen = {
                screenID: screenID,
                screenIndex: this.screens.length,
                width: width, //client
                height: height, //client
                serverWidth: serverWidth,
                serverHeight: serverHeight,
                serverReportedWidth: 0,
                serverReportedHeight: 0,
                x: x,
                y: 0,
                pixelRatio: pixelRatio,
                containerHeight: containerHeight,
                containerWidth: containerWidth,
                channel: null,
                scale: scale,
                x2: x + serverWidth,
                y2: serverHeight
            }

            new_screen.channel = new BroadcastChannel(`screen_${screenID}_channel`);
            //new_screen.channel.message = this._handleSecondaryDisplayMessage().bind(this);

            this._screens.push(new_screen);
            new_screen.channel.postMessage({ eventType: "registered", screenIndex: new_screen.screenIndex });

            return new_screen.screenIndex;
        }

        return false;
    }

    removeScreen(screenID) {
        let removed = false;
        if (this._isPrimaryDisplay) {
            for (let i=1; i<this._screens.length; i++) {
                if (this._screens[i].screenID == screenID) {
                    //flush all rects on target screen
                    this._flushRectsScreen(i);
                    this._screens[i].channel.close();
                    this._screens.splice(i, 1);
                    removed = true;
                    break;
                }
            }
            //recalculate indexes and update secondary displays
            for (let i=1; i<this._screens.length; i++) {
                this.screens[i].screenIndex = i;
                if (i > 0) {
                    this._screens[i].channel.postMessage({ eventType: "registered", screenIndex: i });
                }
            }
            return removed;
        } else {
            throw new Error("Secondary screens only allowed on primary display.")
        }
    }

    viewportChangePos(deltaX, deltaY) {
        const vp = this._screens[0];
        deltaX = Math.floor(deltaX);
        deltaY = Math.floor(deltaY);

        if (!this._clipViewport) {
            deltaX = -vp.width;  // clamped later of out of bounds
            deltaY = -vp.height;
        }

        const vx2 = vp.x + vp.width - 1;
        const vy2 = vp.y + vp.height - 1;

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

        if ((!this._clipViewport && this._screens.length === 1 ) ||
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

        const vp = this._screens[0];
        const canvas = this._target;
        if (canvas.width !== width || canvas.height !== height) {
            let saveImg = null;
            if (canvas.width > 0 && canvas.height > 0) {
                saveImg = this._targetCtx.getImageData(0, 0, canvas.width, canvas.height);
            }

            vp.serverWidth = width;
            vp.serverHeight = height;

            canvas.width = width;
            canvas.height = height;

            if (saveImg) {
                this._targetCtx.putImageData(saveImg, 0, 0);
            }

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
        return toSigned32bit(x / this._scale + this._screens[0].x);
    }

    absY(y) {
        if (this._scale === 0) {
            return 0;
        }
        return toSigned32bit(y / this._scale + this._screens[0].y);
    }

    resize(width, height) {
        this._prevDrawStyle = "";

        this._fbWidth = width;
        this._fbHeight = height;

        let canvas = this._backbuffer;
        if (canvas == undefined) { return; }
        
        if (this._screens.length > 0) {
            width = this._screens[0].serverWidth;
            height = this._screens[0].serverHeight;
        }

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
        const vp = this._screens[0];
        this.viewportChangeSize(vp.serverWidth, vp.serverHeight);
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
            'rect_cnt': rect_cnt,
            'screenLocations': [ { screenIndex: 0, x: 0, y: 0 } ]
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
            this.onflush();
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
        this.clear();
    }

    fillRect(x, y, width, height, color, frame_id, fromQueue) {
        if (!fromQueue) {
            let rect = {
                type: 'fill',
                x: x,
                y: y,
                width: width,
                height: height,
                color: color,
                frame_id: frame_id
            }
            this._processRectScreens(rect);
            this._asyncRenderQPush(rect);
        } else {
            this._setFillColor(color);
            if (this._enableCanvasBuffer) {
                this._drawCtx.fillRect(x, y, width, height);
            } else {
                this._targetCtx.fillRect(x, y, width, height);
            }
        }
    }

    copyImage(oldX, oldY, newX, newY, w, h, frame_id, fromQueue) {
        if (!fromQueue) {
            let rect = {
                'type': 'copy',
                'oldX': oldX,
                'oldY': oldY,
                'x': newX,
                'y': newY,
                'width': w,
                'height': h,
                'frame_id': frame_id
            }
            this._processRectScreens(rect);
            this._asyncRenderQPush(rect);
        } else {
            let targetCtx = ((this._enableCanvasBuffer) ? this._drawCtx : this._targetCtx);
            let sourceCvs = ((this._enableCanvasBuffer) ? this._backbuffer : this._target);

            // Due to this bug among others [1] we need to disable the image-smoothing to
            // avoid getting a blur effect when copying data.
            //
            // 1. https://bugzilla.mozilla.org/show_bug.cgi?id=1194719
            //
            // We need to set these every time since all properties are reset
            // when the the size is changed
            targetCtx.mozImageSmoothingEnabled = false;
            targetCtx.webkitImageSmoothingEnabled = false;
            targetCtx.msImageSmoothingEnabled = false;
            targetCtx.imageSmoothingEnabled = false;

            targetCtx.drawImage(sourceCvs,
                                    oldX, oldY, w, h,
                                    newX, newY, w, h);
        }
    }

    imageRect(x, y, width, height, mime, arr, frame_id) {
        /* The internal logic cannot handle empty images, so bail early */
        if ((width === 0) || (height === 0)) {
            return;
        }
        
        let rect = {
            'type': 'img',
            'img': null,
            'x': x,
            'y': y,
            'width': width,
            'height': height,
            'frame_id': frame_id
        }
        this._processRectScreens(rect);

        if (rect.inPrimary) {
            const img = new Image();
            img.src = "data: " + mime + ";base64," + Base64.encode(arr);
            rect.img = img;
        } else {
            rect.type = "_img";
        }
        if (rect.inSecondary) {
            rect.mime = mime;
            rect.src = "data: " + mime + ";base64," + Base64.encode(arr);
        }

        this._asyncRenderQPush(rect);
    }

    transparentRect(x, y, width, height, img, frame_id, hashId) {
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
            'frame_id': frame_id,
            'arr': img,
            'hash_id': hashId
        }
        this._processRectScreens(rect);

        if (rect.inPrimary) {
            let imageBmpPromise = createImageBitmap(img);
            imageBmpPromise.then( function(bitmap) {
                this._transparentOverlayImg = bitmap;
                this.enableCanvasBuffer = true;
            }.bind(this) );
        }

        this._transparentOverlayRect = rect;
        this._asyncRenderQPush(rect);
    }

    dummyRect(x, y, width, height, frame_id) {
        let rect = {
            'type': 'dummy',
            'img': null,
            'x': x,
            'y': y,
            'width': width,
            'height': height,
            'frame_id': frame_id
        }
        this._processRectScreens(rect);
        this._asyncRenderQPush(rect);
    }

    blitImage(x, y, width, height, arr, offset, frame_id, fromQueue) {
        if (!fromQueue) {
            // NB(directxman12): it's technically more performant here to use preallocated arrays,
            // but it's a lot of extra work for not a lot of payoff -- if we're using the render queue,
            // this probably isn't getting called *nearly* as much
            const newArr = new Uint8Array(width * height * 4);
            newArr.set(new Uint8Array(arr.buffer, 0, newArr.length));
            let rect = {
                'type': 'blit',
                'data': newArr,
                'x': x,
                'y': y,
                'width': width,
                'height': height,
                'frame_id': frame_id
            }
            this._processRectScreens(rect);
            this._asyncRenderQPush(rect);
        } else {
            // NB(directxman12): arr must be an Type Array view
            let data = new Uint8ClampedArray(arr.buffer,
                                             arr.byteOffset + offset,
                                             width * height * 4);
            let img = new ImageData(data, width, height);
            if (this._enableCanvasBuffer) {
                this._drawCtx.putImageData(img, x, y);
            } else {
                this._targetCtx.putImageData(img, x, y);
                
            }
            
        }
    }

    blitQoi(x, y, width, height, arr, offset, frame_id, fromQueue) {
        if (!fromQueue) {
            let rect = {
                'type': 'blitQ',
                'data': arr,
                'x': x,
                'y': y,
                'width': width,
                'height': height,
                'frame_id': frame_id
            }
            this._processRectScreens(rect);
            this._asyncRenderQPush(rect);
        } else {
            if (this._enableCanvasBuffer) {
                this._drawCtx.putImageData(arr, x, y);
            } else {
                this._targetCtx.putImageData(arr, x, y);
            }
        }
    }

    drawImage(img, x, y, w, h, overlay=false) {
        try {
            let targetCtx = ((this._enableCanvasBuffer && !overlay) ? this._drawCtx : this._targetCtx);
            if (img.width != w || img.height != h) {
                targetCtx.drawImage(img, x, y, w, h);
            } else {
                targetCtx.drawImage(img, x, y);
            }
        } catch (error) {
            Log.Error('Invalid image recieved.'); //KASM-2090
        }
    }

    autoscale(containerWidth, containerHeight, scaleRatio=0) {
        if (containerWidth === 0 || containerHeight === 0) {
            scaleRatio = 0;

        } else if (scaleRatio === 0) {

            const vp = this._screens[0];
            const targetAspectRatio = containerWidth / containerHeight;
            const fbAspectRatio = vp.width / vp.height;

            if (fbAspectRatio >= targetAspectRatio) {
                scaleRatio = containerWidth / vp.serverWidth;
            } else {
                scaleRatio = containerHeight / vp.serverHeight;
            }
        }

        this._rescale(scaleRatio);
    }

    // ===== PRIVATE METHODS =====

    _writeCtxBuffer() {
    	//TODO: KASM-5450 Damage tracking with transparent rect overlay support
        if (this._backbuffer.width > 0) {
            this._targetCtx.drawImage(this._backbuffer, 0, 0);
        }
    }

    _handleSecondaryDisplayMessage(event) {
        if (!this._isPrimaryDisplay && event.data) {
            switch (event.data.eventType) {
                case 'rect':
                    let rect = event.data.rect;
                    //overwrite screen locations when received on the secondary display
                    rect.screenLocations = [ rect.screenLocations[event.data.screenLocationIndex] ]
                    rect.screenLocations[0].screenIndex = 0;
                    switch (rect.type) {
                        case 'img':
                        case '_img':
                            rect.img = new Image();
                            rect.img.src = rect.src;
                            rect.type = 'img';
                            break;
                        case 'transparent':
                            let imageBmpPromise = createImageBitmap(rect.arr);
                            imageBmpPromise.then( function(img) {
                                this._transparentOverlayImg = img;
                                if (!this.enableCanvasBuffer) {
                                    this._enableCanvasBuffer = true;
                                }
                            }.bind(this) );
                            this._transparentOverlayRect = rect;
                            break;
                    }
                    this._syncFrameQueue.push(rect);

                    //if the secondary display is not in focus, the browser may not call requestAnimationFrame, thus we need to limit our buffer
                    if (this._syncFrameQueue.length > 5000) {
                        this._syncFrameQueue.shift();
                        this._droppedRects++;
                    }
                    break;
                case 'frameComplete':
                        window.requestAnimationFrame( () => { this._pushSyncRects(); });
                        break;
                case 'registered':
                        if (!this._isPrimaryDisplay) {
                            this._screens[0].screenIndex = event.data.screenIndex;
                            Log.Info(`Screen with index (${event.data.screenIndex}) successfully registered with the primary display.`);
                            if (this._screens.length > 0) {
                                this.resize(this._screens[0].serverWidth, this._screens[0].serverHeight);
                            }
                        }
                    break;
            }
        }
    }

    _pushSyncRects() {
        let drawRectCnt = 0;
        whileLoop:
        while (this._syncFrameQueue.length > 0) {
            const a = this._syncFrameQueue[0];
            const pos = a.screenLocations[0];
            switch (a.type) {
                case 'copy':
                    this.copyImage(pos.oldX, pos.oldY, pos.x, pos.y, a.width, a.height, a.frame_id, true);
                    break;
                case 'fill':
                    this.fillRect(pos.x, pos.y, a.width, a.height, a.color, a.frame_id, true);
                    break;
                case 'blit':
                    this.blitImage(pos.x, pos.y, a.width, a.height, a.data, 0, a.frame_id, true);
                    break;
                case 'blitQ':
                    this.blitQoi(pos.x, pos.y, a.width, a.height, a.data, 0, a.frame_id, true);
                    break;
                case 'img':
                    if (a.img.complete) {
                        this.drawImage(a.img, pos.x, pos.y, a.width, a.height);
                    } else {
                        if (this._syncFrameQueue.length > 5000) {
                            this._syncFrameQueue.shift();
                            this._droppedRects++;
                        } else {
                            break whileLoop;
                        }
                    }
                    break;
                default:
                    this._syncFrameQueue.shift();
                    continue;
            }
            drawRectCnt++;
            this._syncFrameQueue.shift();
        }

        if (this._enableCanvasBuffer && drawRectCnt > 0) {
            this._writeCtxBuffer();
            if (this._transparentOverlayImg) {
                this.drawImage(this._transparentOverlayImg, this._transparentOverlayRect.x, this._transparentOverlayRect.y, this._transparentOverlayRect.width, this._transparentOverlayRect.height, true);
            }
        }

        if (this._syncFrameQueue.length > 0) {
            window.requestAnimationFrame( () => { this._pushSyncRects(); });
        }
    }

    _flushRectsScreen(screenIndex) {
        for (let i=0; i<this._asyncFrameQueue.length; i++) {
            const frame = this._asyncFrameQueue[i];
            for (let x=0; x < frame[2].length; x++) {
                const rect = frame[2][x];
                for (let y=0; y < rect.screenLocations.length; y++) {
                    if (rect.screenLocations[y].screenIndex === screenIndex) {
                        rect.screenLocations.splice(y, 1);
                        break;
                    }
                }
            }
        }
    }

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

        if (!this._firstRect) { //TODO: Remove this
            this._firstRect = true;
            Log.Info("First rect received.");
        }

        if (frameIx >= 0) {
            if (rect.type == "flip") {
                //flip rect contains the rect count for the frame
                if (this._asyncFrameQueue[frameIx][1] !== 0) {
                    Log.Warn("Redundant flip rect, current rect_cnt: " + this._asyncFrameQueue[frameIx][1] + ", new rect_cnt: " + rect.rect_cnt );
                }
                this._asyncFrameQueue[frameIx][1] += rect.rect_cnt;
                if (rect.rect_cnt == 0) {
                    Log.Warn("Invalid rect count");
                }  
            }

            if (this._asyncFrameQueue[frameIx][1] > 0 && this._asyncFrameQueue[frameIx][2].length >= this._asyncFrameQueue[frameIx][1]) {
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
                //frame is newer than any frame in the queue, drop old frame
                if (this._asyncFrameQueue[0][3] == true) {
                    Log.Warn("Forced frame to canvas");
                    this._pushAsyncFrame(true);
                    this._droppedFrames += (rect.frame_id - (newestFrameID + 1));
                    this._forcedFrameCnt++;
                } else {
                    Log.Warn("Old frame dropped");
                    this._asyncFrameQueue.shift();
                    this._droppedFrames += (rect.frame_id - newestFrameID);
                }
                
                let rect_cnt = ((rect.type == "flip") ? rect.rect_cnt : 0);
                this._asyncFrameQueue.push([ rect.frame_id, rect_cnt, [ rect ], (rect_cnt == 1), 0, 0 ]);
                
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
        if (frameIx >= this._asyncFrameQueue.length) {
            return;
        }

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
                if (this._asyncFrameQueue[frameIx][2][currentFrameRectIx].type == 'img') {
                    if (this._asyncFrameQueue[frameIx][2][currentFrameRectIx].img && !this._asyncFrameQueue[frameIx][2][currentFrameRectIx].img.complete) {
                        this._asyncFrameQueue[frameIx][2][currentFrameRectIx].type = 'skip';
                        this._droppedRects++;
                    }
                }

                currentFrameRectIx++;
            }
        } else {
            while (currentFrameRectIx < this._asyncFrameQueue[frameIx][2].length) {
                if (this._asyncFrameQueue[frameIx][2][currentFrameRectIx].type == 'img' && !this._asyncFrameQueue[frameIx][2][currentFrameRectIx].img.complete) {
                    this._asyncFrameQueue[frameIx][2][currentFrameRectIx].img.addEventListener('load', () => { this._asyncFrameComplete(frameIx); });
                    this._asyncFrameQueue[frameIx][4] = currentFrameRectIx;
                    return;
                }

                currentFrameRectIx++;
            }
        }
        this._asyncFrameQueue[frameIx][4] = currentFrameRectIx;
        this._asyncFrameQueue[frameIx][3] = true;

        if (force && frameIx == 0) {
            this._pushAsyncFrame(true);
        } else {
            window.requestAnimationFrame( () => { this._pushAsyncFrame(); });
        }
    }

    /*
    Push the oldest frame in the buffer to the canvas if it is marked ready
    */
    _pushAsyncFrame(force=false) {
        if (this._asyncFrameQueue[0][3] || force) {
            let frame = this._asyncFrameQueue[0][2];
            let frameId = this._asyncFrameQueue.shift()[0];
            if (this._asyncFrameQueue.length < this._maxAsyncFrameQueue) {
                this._asyncFrameQueue.push([ 0, 0, [], false, 0, 0 ]);
            }

            let secondaryScreenRects = 0;
            let primaryScreenRects = 0;
            
            //render the selected frame
            for (let i = 0; i < frame.length; i++) {
                
                const a = frame[i];

                for (let sI = 0; sI < a.screenLocations.length; sI++) {
                    let screenLocation = a.screenLocations[sI];
                    if (screenLocation.screenIndex == 0) {
                        switch (a.type) {
                            case 'copy':
                                this.copyImage(screenLocation.oldX, screenLocation.oldY, screenLocation.x, screenLocation.y, a.width, a.height, a.frame_id, true);
                                break;
                            case 'fill':
                                this.fillRect(screenLocation.x, screenLocation.y, a.width, a.height, a.color, a.frame_id, true);
                                break;
                            case 'blit':
                                this.blitImage(screenLocation.x, screenLocation.y, a.width, a.height, a.data, 0, a.frame_id, true);
                                break;
                            case 'blitQ':
                                this.blitQoi(screenLocation.x, screenLocation.y, a.width, a.height, a.data, 0, a.frame_id, true);
                                break;
                            case 'img':
                                this.drawImage(a.img, screenLocation.x, screenLocation.y, a.width, a.height);
                                break;
                            default:
                                continue;
                        }
                        primaryScreenRects++;
                    } else {
                        switch (a.type) {
                            case 'dummy':
                            case 'transparent':
                            case 'flip':
                                break;
                            default:
                                secondaryScreenRects++;
                                a.img = null;
                                if (this._screens[screenLocation.screenIndex].channel) {
                                    this._screens[screenLocation.screenIndex].channel.postMessage({ eventType: 'rect', rect: a, screenLocationIndex: sI });
                                }
                        }
                    }
                }
            }

            if (this._enableCanvasBuffer) {

                if (primaryScreenRects > 0) {
                    this._writeCtxBuffer();
                }
                
                if (this._transparentOverlayImg) { 
                    if (primaryScreenRects > 0) {
                        this.drawImage(this._transparentOverlayImg, this._transparentOverlayRect.x, this._transparentOverlayRect.y, this._transparentOverlayRect.width, this._transparentOverlayRect.height, true);
                    }
                    if (secondaryScreenRects > 0 && this._lastTransparentRectId !== this._transparentOverlayRect.hash_id) {
                        for (let sI = 1; sI < this._transparentOverlayRect.screenLocations.length; sI++) {
                            if (this._screens[this._transparentOverlayRect.screenLocations[sI].screenIndex].channel) {
                                this._screens[this._transparentOverlayRect.screenLocations[sI].screenIndex].channel.postMessage({ eventType: 'rect', rect: this._transparentOverlayRect, screenLocationIndex: sI });
                            }
                        }
                    }
                    this._lastTransparentRectId = this._transparentOverlayRect.hash_id;
                }
            }

            if (secondaryScreenRects > 0) {
                for (let i = 1; i < this.screens.length; i++) {
                    if (this._screens[i].channel) {
                        this._screens[i].channel.postMessage({ eventType: 'frameComplete', frameId: frameId, rectCnt: secondaryScreenRects });
                    }
                }
            }

            this._flipCnt += 1;

            if (this._flushing) {
                this._flushing = false;
                this.onflush();
            }

            // if there is more data in queue, then keep checking
            if (this._asyncFrameQueue[0][2].length > 0) {
                window.requestAnimationFrame( () => { this._pushAsyncFrame(); });
            }
        } else if (this._asyncFrameQueue[0][1] > 0 && this._asyncFrameQueue[0][1] == this._asyncFrameQueue[0][2].length) {
            //how many times has _pushAsyncFrame been called when the frame had all rects but has not been drawn
            this._asyncFrameQueue[0][5] += 1;
            //force the frame to be drawn if it has been here too long
            if (this._asyncFrameQueue[0][5] > 5) { 
                this._pushAsyncFrame(true);
            }
        }
    }

    _processRectScreens(rect) {

        //find which screen this rect belongs to and adjust its x and y to be relative to the destination
        let indexes = [];
        rect.inPrimary = false;
        rect.inSecondary = false;
        for (let i=0; i < this._screens.length; i++) {
            let screen = this._screens[i];

            if (
                !((rect.x > screen.x2 || screen.x > (rect.x + rect.width)) && (rect.y > screen.y2 || screen.y > (rect.y + rect.height)))
            ) {
                let screenPosition = { 
                    x: 0 - (screen.x - rect.x), //rect.x - screen.x,
                    y: 0 - (screen.y - rect.y), //rect.y - screen.y,
                    screenIndex: i
                }
                if (rect.type === 'copy') {
                    screenPosition.oldX = 0 - (screen.x - rect.oldX); //rect.oldX - screen.x;
                    screenPosition.oldY = 0 - (screen.y - rect.oldY); //rect.oldY - screen.y;
                }
                indexes.push(screenPosition);
                if (i == 0) {
                    rect.inPrimary = true;
                } else {
                    rect.inSecondary = true;
                }
            }
        }

        rect.screenLocations = indexes;
    }

    _rescale(factor) {
        this._scale = factor;
        const vp = this._screens[0];

        // NB(directxman12): If you set the width directly, or set the
        //                   style width to a number, the canvas is cleared.
        //                   However, if you set the style width to a string
        //                   ('NNNpx'), the canvas is scaled without clearing.
        const width = factor * vp.serverWidth + 'px';
        const height = factor * vp.serverHeight + 'px';

        if ((this._target.style.width !== width) ||
            (this._target.style.height !== height)) {
            this._target.style.width = width;
            this._target.style.height = height;
        }

        Log.Info('Pixel Ratio: ' + window.devicePixelRatio + ', VNC Scale: ' + factor + 'VNC Res: ' + vp.serverWidth + 'x' + vp.serverHeight);

        var pixR = Math.abs(Math.ceil(window.devicePixelRatio));
        var isFirefox = navigator.userAgent.toLowerCase().indexOf('firefox') > -1;

        if (this.antiAliasing === 2 || (this.antiAliasing === 0 && factor === 1 && this._target.style.imageRendering !== 'pixelated' && pixR === window.devicePixelRatio && vp.width > 0)) {
            this._target.style.imageRendering = ((!isFirefox) ? 'pixelated' : 'crisp-edges' );
            Log.Debug('Smoothing disabled');
        } else if (this.antiAliasing === 1 || (this.antiAliasing === 0 && factor !== 1 && this._target.style.imageRendering !== 'auto')) {
            this._target.style.imageRendering = 'auto'; //auto is really smooth (blurry) using trilinear of linear
            Log.Debug('Smoothing enabled');
        }
    }

    _setFillColor(color) {
        const newStyle = 'rgb(' + color[0] + ',' + color[1] + ',' + color[2] + ')';
        let targetCtx = ((this._enableCanvasBuffer) ? this._drawCtx : this._targetCtx);
        if (newStyle !== this._prevDrawStyle) {
            targetCtx.fillStyle = newStyle;
            this._prevDrawStyle = newStyle;
        }
    }
}
