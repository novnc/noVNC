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
import UI from '../app/ui.js';
import { encodings } from "./encodings.js";
import {Canvas2DRenderer} from "./renderers/Canvas2DRenderer";
import {WebGLRenderer} from "./renderers/WebGLRenderer";
import { perfLogger } from './util/performance-logger.js';
import { MAX_FB_PIXELS, FB_LIMIT_TEXT, clampDimension, isValidFbSize } from './util/fb-limits.js';

export default class Display {
    constructor(target, rfb, isPrimaryDisplay, videoRenderingMode = 'canvas2d') {
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
        this._lastTransparentRectId = "";

        this._flushing = false;

        // the full frame buffer (logical canvas) size
        this._fbWidth = 0;
        this._fbHeight = 0;

        this._renderMs = 0;
        this._backbuffer = document.createElement('canvas');
        this._target = target;

        const canvas2DRenderer = new Canvas2DRenderer(target, this._backbuffer);

        // Initialize renderer based on video rendering mode setting
        if (videoRenderingMode === 'webgl') {
            const webglCanvas = document.createElement('canvas');
            const gl = webglCanvas.getContext('webgl2', {
                alpha: false,
                antialias: false,
                depth: false,
                stencil: false,
                powerPreference: 'high-performance',
                desynchronized: true,
                preserveDrawingBuffer: false
            }) || webglCanvas.getContext('webgl', {
                alpha: false,
                antialias: false,
                depth: false,
                stencil: false,
                powerPreference: 'high-performance',
                desynchronized: true,
                preserveDrawingBuffer: false
            });

            if (gl) {
                // Initialize WebGL canvas with zero size - will be resized on first frame
                webglCanvas.width = 0;
                webglCanvas.height = 0;

                // Setup WebGL canvas to overlay the 2D canvas
                webglCanvas.style.position = 'absolute';
                webglCanvas.style.left = '0';
                webglCanvas.style.top = '0';
                webglCanvas.style.pointerEvents = 'none';
                webglCanvas.style.zIndex = '1';
                webglCanvas.style.width = '0px';
                webglCanvas.style.height = '0px';

                // Add WebGL canvas to DOM as a sibling of the target canvas
                if (target.parentNode) {
                    target.parentNode.appendChild(webglCanvas);
                }

                this._renderer = new WebGLRenderer(canvas2DRenderer, gl, webglCanvas);
                Log.Info("WebGL renderer initialized.");
            } else {
                this._renderer = canvas2DRenderer;
                Log.Info("WebGL unavailable, falling back to Canvas2DRenderer.");
            }
        } else {
            this._renderer = canvas2DRenderer;
            Log.Info("Canvas2D renderer initialized.");
        }

        Log.Debug("User Agent: " + navigator.userAgent);

        // performance metrics
        this._flipCnt = 0;
        this._lastFlip = Date.now();
        this._droppedFrames = 0; // total count
        this._droppedFramesRate = 0; //frames dropped per second
        this._droppedFramesCnt = 0; //dropper frames temp counter
        this._droppedRects = 0;
        this._forcedFrameCnt = 0;
        this._missingFlipRect = 0;
        this._lateFlipRect = 0;
        this._frameStatsInterval = setInterval(function() {
            let delta = Date.now() - this._lastFlip;
            if (delta > 0) {
                this._fps = (this._flipCnt / (delta / 1000)).toFixed(2);
                if (this._droppedFrames > this._droppedFramesCnt) {
                    let droppedFrames = this._droppedFrames - this._droppedFramesCnt;
                    this._droppedFramesRate = (droppedFrames / (delta / 1000)).toFixed(2);
                } else {
                    this._droppedFramesRate = 0;
                }
                this._droppedFramesCnt = this._droppedFrames;
            }
            Log.Debug('Dropped Frames: ' + this._droppedFrames + ' Dropped Rects: ' + this._droppedRects + ' Forced Frames: ' + this._forcedFrameCnt + ' Missing Flips: ' + this._missingFlipRect + ' Late Flips: ' + this._lateFlipRect);

            this._flipCnt = 0;
            this._lastFlip = Date.now();
        }.bind(this), 5000);

        // ===== PROPERTIES =====

        this._maxScreens = 4;
        this._scale = 1.0;
        this._clipViewport = false;
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
        this._threading = true;
        this._displayPort = null;          // MessagePort from primary for rect data (secondary only)
        this._encodedFramePort = null;     // MessagePort from primary for encoded frames (secondary only)
        this._localDecoder = null;         // VideoDecoder on secondary
        this._localDecoderCodec = null;
        this._localDecoderW = 0;
        this._localDecoderH = 0;
        this._localDecoderStreamMode = null;
        this._localDecoderMeta = new Map(); // timestamp → {x, y, width, height, frameId}
        this._localDecoderTs = 0;
        this._rfb = rfb;

        this._damageBounds = { left: 0, top: 0, right: this._backbuffer.width, bottom: this._backbuffer.height };

        // ===== EVENT HANDLERS =====

        this.onflush = () => {  }; // A flush request has finished
        this.onFrameRendered = () => {};  // A frame has been painted to canvas

        Log.Debug("<< Display.constructor");
    }

    // ===== PROPERTIES =====

    get enableCanvasBuffer() { return this._renderer.enableCanvasBuffer; }
    set enableCanvasBuffer(value) {
        this._renderer.enableCanvasBuffer = value;
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

    get antiAliasing() { return this._renderer.antiAliasing; }
    set antiAliasing(value) {
        this._renderer.antiAliasing = value;
        this._rescale(this._scale);
    }

    get scale() { return this._scale; }
    set scale(scale) {
        this._rescale(scale);
    }

    get threading() { return this._threading; }
    set threading(bool) {
        this._threading = bool;
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
    get droppedFps() { return this._droppedFramesRate; }

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
            const screen = this._screens[screenIndex];
            const scale = screen.scale > 0 ? screen.scale : 1;
            x = toSigned32bit(x / scale + screen.x);
            y = toSigned32bit(y / scale + screen.y);
        }

        return [x, y];
    }

    getScreenSize(resolutionQuality, max_width, max_height, hiDpi, disableLimit, disableScaling, streamMode, ignoreServerReported = false) {
        let data = {
            screens: null,
            serverWidth: 0,
            serverHeight: 0
        }

        let i = 0;


        //getting parent node size with sub-pixel precision
        let parentNodeSize = this._target.parentNode.getBoundingClientRect();
        //recalculate primary display container size
        this._screens[i].containerHeight = Math.floor(parentNodeSize.height / 2) * 2;
        this._screens[i].containerWidth = Math.floor(parentNodeSize.width / 2) * 2;
        this._screens[i].pixelRatio = window.devicePixelRatio;
        this._screens[i].width = this._screens[i].containerWidth;
        this._screens[i].height = this._screens[i].containerHeight;

        //calculate server-side and client-side resolution of each screen
        let width = max_width || this._screens[i].containerWidth;
        let height = max_height || this._screens[i].containerHeight;
        let scale = 1;

        //max the resolution of a single screen to 1280
        if (
            !ignoreServerReported &&
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
        else if (width > 1280 && !disableLimit && resolutionQuality == 1 && streamMode == encodings.pseudoEncodingStreamingModeJpegWebp) {
            height = Math.floor(1280 * (height/width)); //keeping the aspect ratio of original resolution, shrink y to match x
            width = 1280;
        }
        //hard coded 720p
        else if (resolutionQuality == 0 && !disableLimit && streamMode == encodings.pseudoEncodingStreamingModeJpegWebp) {
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
        else if (this._renderer?.antiAliasing === 0 && this._screens[i].pixelRatio > 1 && width < 1000 & width > 0) {
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

    snapshotScreens() {
        return this._screens.map(screen => ({
            screenID: screen.screenID,
            width: screen.width,
            height: screen.height,
            serverWidth: screen.serverWidth,
            serverHeight: screen.serverHeight,
            scale: screen.scale,
            x2: screen.x2,
            y2: screen.y2
        }));
    }

    restoreScreens(snapshot) {
        for (let i = 0; i < snapshot.length; i++) {
            const screen = this._screens.find(s => s.screenID === snapshot[i].screenID);
            if (screen) {
                Object.assign(screen, snapshot[i]);
            }
        }
    }

    applyServerResolution(width, height, screenIndex) {
        const clear = width === 0 && height === 0;
        if (!clear && !isValidFbSize(width, height)) {
            Log.Warn("Ignoring server resolution " + width + "x" + height + " for screen " + screenIndex + " " + FB_LIMIT_TEXT);
            return false;
        }

        for (let z = 0; z < this._screens.length; z++) {
            if (screenIndex === this._screens[z].screenIndex) {
                this._screens[z].serverReportedWidth = width;
                this._screens[z].serverReportedHeight = height;
            }
        }
        return true;
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

    // Secondary only: the private ports handed over by the primary window. Nothing else
    // can post to these, unlike a named BroadcastChannel.
    attachPrimaryPorts(displayPort, encodedFramePort) {
        if (this._isPrimaryDisplay) {
            throw new Error("Only secondary displays attach to a primary display.");
        }
        this._displayPort?.close();
        this._encodedFramePort?.close();
        this._displayPort = displayPort;
        this._displayPort.onmessage = this._handleSecondaryDisplayMessage.bind(this);
        this._encodedFramePort = encodedFramePort;
        this._encodedFramePort.onmessage = this._handleEncodedFrame.bind(this);
        Log.Info("[SECONDARY] display and encodedFrame ports established");
    }

    addScreen(spec) {
        if (!spec || typeof spec !== 'object') {
            throw new TypeError("addScreen expects a screen description object.");
        }
        const { screenID, width, height, pixelRatio, containerHeight, containerWidth, scale,
                serverWidth, serverHeight, y, windowId, channel = null, encodedFramePort = null } = spec;
        let x = spec.x;
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
            if (channel && existing_screen.channel !== channel) {
                existing_screen.channel = channel;
                channel.postMessage({eventType: "registered", screenIndex: existing_screen.screenIndex});
            }
            if (encodedFramePort) { existing_screen.encodedFramePort = encodedFramePort; }
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

            const new_screen = {
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
                channel: channel,
                encodedFramePort: encodedFramePort,
                scale: scale,
                x2: x + serverWidth,
                y2: serverHeight
            };

            this._screens.push(new_screen);
            if (new_screen.channel) {
                UI.registeredWindows.set(screenID, windowId);
                new_screen.channel.postMessage({eventType: "registered", screenIndex: new_screen.screenIndex});
            } else
                Log.Debug(`Channel not found for screenId ${screenID}`);

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
                    this._screens[i].channel?.close();
                    this._screens[i].encodedFramePort?.close();
                    const windowId = UI.registeredWindows.get(screenID);
                    if (windowId) {
                        UI.registeredWindows.delete(screenID);
                        UI.displayWindows.delete(windowId);
                    }
                    this._screens.splice(i, 1);
                    removed = true;
                    break;
                }
            }
            //recalculate indexes and update secondary displays
            for (let i=1; i<this._screens.length; i++) {
                this.screens[i].screenIndex = i;
                if (i > 0) {
                    this._screens[i].channel?.postMessage({ eventType: "registered", screenIndex: i });
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

        if (this._renderer?.viewportChangeSize(width, height)) {
            const vp = this._screens[0];
            vp.serverWidth = width;
            vp.serverHeight = height;
            vp.x2 = vp.x + width;
            vp.y2 = vp.y + height;

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

    clientX(x) {
        return (x - this._screens[0].x) * this._scale;
    }

    clientY(y) {
        return (y - this._screens[0].y) * this._scale;
    }

    resize(width, height) {
        width = clampDimension(width);
        height = clampDimension(height);

        if (width * height > MAX_FB_PIXELS) {
            Log.Warn("Ignoring resize to " + width + "x" + height + " (max " + MAX_FB_PIXELS + " pixels)");
            return false;
        }

        this._fbWidth = width;
        this._fbHeight = height;

        this._renderer?.resize(width, height, this._screens);

        // Readjust the viewport as it may be incorrectly sized
        // and positioned
        const vp = this._screens[0];
        this.viewportChangeSize(vp.serverWidth, vp.serverHeight);
        this.viewportChangePos(0, 0);
        return true;
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
        if (this._frameStatsInterval) {
            clearInterval(this._frameStatsInterval);
            this._frameStatsInterval = null;
        }
        this.clear();

        for (const name of ['_displayPort', '_encodedFramePort']) {
            if (this[name]) {
                this[name].onmessage = null;
                this[name].close();
                this[name] = null;
            }
        }

        if (this._renderer) {
            this._renderer.dispose();
            this._renderer = null;
        }
    }

    fillRect(x, y, width, height, color, frame_id, fromQueue) {
        if (!fromQueue) {
            let rect = {
                type: 'fill',
                x: x,
                y: y,
                width: width,
                height: height,
                // color can be a view into the receive queue, which is reused before
                // the frame is drawn, so keep a copy
                color: [ color[0], color[1], color[2] ],
                frame_id: frame_id
            }
            this._processRectScreens(rect);
            this._asyncRenderQPush(rect);
        } else {
            this._renderer?.fillRect(x, y, width, height, color);
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
            this._renderer?.copyImage(oldX, oldY, newX, newY, w, h);
        }
    }

    _handleVidChunk(data, chunk) {
        let rect = data[0];
        let that = data[1];
        let imageDecoder = data[2];
        imageDecoder.close();
        rect.img = chunk.image;
        that._asyncRenderQPush(rect);
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
                'frame_id': frame_id,
                'mime': mime
        };

        this._processRectScreens(rect);

        // Use threaded image decoder
        if (!rect.inSecondary) {
            if ((typeof ImageDecoder !== 'undefined') && (this._threading)) {
                let imageDecoder = new ImageDecoder({data: arr, type: mime});
                rect.type = 'vid'
                imageDecoder.decode().then(this._handleVidChunk.bind(null, [rect, this, imageDecoder]));
            } else {
                const blob = new Blob([arr], {type: mime});

                createImageBitmap(blob).then((bitmapImg) => {
                    rect.type = 'bitmap';
                    rect.img = bitmapImg;
                    this._asyncRenderQPush(rect);
                });
            }
        } else {
            let src = "data: " + mime + ";base64," + Base64.encode(arr);

            if (rect.inPrimary) {
                const img = new Image();
                rect.img = img;
                rect.type = 'img';
                img.src = src;
            } else {
                rect.type = "_img";
            }

            if (rect.inSecondary) {
                rect.src = src;
            }

            this._asyncRenderQPush(rect);
        }
    }

    // Push a placeholder rect for a secondary video frame that was already forwarded
    // via encodedFramePort. The rect has a null frame so _pushAsyncFrame skips rendering,
    // but it still counts toward the frame's expected rect count so the primary doesn't stall.
    enqueueVideoFrameRect(screenId, frameId, x, y, width, height) {
        const rect = {
            type: 'video_frame',
            screenId,
            frame: null,
            x, y, width, height,
            frame_id: frameId,
        };
        if (screenId < this._screens.length) {
            this._processRectScreens(rect);
            this._asyncRenderQPush(rect);
        }
    }

    videoFrameRect(screenId, frame, frame_id, x, y, width, height) {
        const startTime = perfLogger.start('videoFrameRender');

        if (frame.displayWidth === 0 || frame.displayHeight === 0 || frame.codedWidth === 0 || frame.codedHeight === 0) {
            frame.close();
            perfLogger.end('videoFrameRender', startTime);
            return false;
        }

        const rect = {
            type: 'video_frame',
            screenId,
            frame,
            x,
            y,
            width,
            height,
            frame_id
        };
        // TODO: REMoVE
        // this.drawVideoFrame(frame, x, y, width, height);

        if (rect.screenId < this._screens.length) {
            const routeStart = perfLogger.start('screenRouting');
            this._processRectScreens(rect);
            perfLogger.end('screenRouting', routeStart);

            const queueStart = perfLogger.start('asyncQueuePush');
            this._asyncRenderQPush(rect);
            perfLogger.end('asyncQueuePush', queueStart);
        } else {
            frame.close();
            Log.Debug(`ScreenId ${screenId} not found in display list`);
        }

        perfLogger.end('videoFrameRender', startTime);
    }

    transparentRect(x, y, width, height, img, frame_id, hashId) {
        /* The internal logic cannot handle empty images, so bail early */
        if ((width === 0) || (height === 0)) {
            return;
        }

        const rect = {
            'type': 'transparent',
            'img': null,
            'x': x,
            'y': y,
            'width': width,
            'height': height,
            'frame_id': frame_id,
            'arr': img,
            'hash_id': hashId
        };
        this._processRectScreens(rect);

        if (rect.inPrimary) {
            let imageBmpPromise = createImageBitmap(img);
            imageBmpPromise.then( function(bitmap) {
                this._renderer.transparentOverlayImg = bitmap;
            }.bind(this) );
        }

        this._renderer.transparentOverlayRect = rect;
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
            let buf;
            let start = offset || 0;
            if (!ArrayBuffer.isView(arr)) {
                buf = arr;
            } else {
                buf = arr.buffer;
                start += arr.byteOffset;
            }
            // NB(directxman12): it's technically more performant here to use preallocated arrays,
            // but it's a lot of extra work for not a lot of payoff -- if we're using the render queue,
            // this probably isn't getting called *nearly* as much
            const newArr = new Uint8Array(width * height * 4);
            newArr.set(new Uint8Array(buf, start, newArr.length));
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
            this._renderer?.blitImage(x, y, width, height, arr, offset);
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
            this._renderer?.blitQoi(arr, x, y);
        }
    }

    drawImage(img, x, y, w, h) {
        try {
            this._renderer?.drawImage(img, x, y, w, h);
        } catch (error) {
            Log.Error('Invalid image received.'); //KASM-2090
        }
    }

    drawVideoFrame(videoFrame, x, y, width, height) {
        try {
            this._renderer?.drawVideoFrame(videoFrame, x, y, width, height);
        } catch (error) {
            Log.Error('Invalid video frame received. ', error);
        }
    }

    putImage(img, x, y) {
        try {
            this._renderer?.putImage(img, x, y);
            img = null;
        } catch (error) {
            Log.Error('Invalid image received.');
            img = null;
        }
    }

    clearRect(x, y, width, height, offset, frame_id, fromQueue) {
        if (!fromQueue) {
            let rect = {
                'type': 'clear',
                'x': x,
                'y': y,
                'width': width,
                'height': height,
                'frame_id': frame_id
            }
            this._processRectScreens(rect);
            this._asyncRenderQPush(rect);
        } else {
            this._renderer?.clearRect(x, y, width, height);
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
    _handleSecondaryDisplayMessage(event) {
        if (this._isPrimaryDisplay || !event.data)
            return;

        switch (event.data.eventType) {
            case 'rect':
                let rect = event.data.rect;
                //overwrite screen locations when received on the secondary display
                rect.screenLocations = [rect.screenLocations[event.data.screenLocationIndex]]
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
                        imageBmpPromise.then(function (img) {
                            this._renderer.transparentOverlayImg = img;
                        }.bind(this));
                        this._renderer.transparentOverlayRect = rect;
                        break;
                }
                this._syncFrameQueue.push(rect);

                //if the secondary display is not in focus, the browser may not call requestAnimationFrame, thus we need to limit our buffer
                if (this._syncFrameQueue.length > 5000) {
                    this._releaseRect(this._syncFrameQueue.shift());
                    this._droppedRects++;
                }
                break;
            case 'frameComplete':
                window.requestAnimationFrame(() => {
                    this._pushSyncRects();
                });
                break;
            case 'registered':
                if (!this._isPrimaryDisplay) {
                    const screenIndex = event.data.screenIndex;
                    this._screens[0].screenIndex = screenIndex;
                    Log.Info(`Screen with index (${screenIndex}) successfully registered with the primary display.`);
                    if (this._screens.length > 0) {
                        this.resize(this._screens[0].serverWidth, this._screens[0].serverHeight);
                    }
                }
                break;

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
                case 'vid':
                    this.drawImage(a.img, pos.x, pos.y, a.width, a.height);
                    a.img.close();
                    break;
                case 'bitmap':
                    this.drawImage(a.img, pos.x, pos.y, a.width, a.height);
                    a.img.close();
                    break;
                case 'video_frame':
                    this.drawVideoFrame(a.frame, pos.x, pos.y, a.width, a.height);
                    break;
                default:
                    this._syncFrameQueue.shift();
                    continue;
            }
            drawRectCnt++;
            this._syncFrameQueue.shift();
        }

        if (this._renderer?.enableCanvasBuffer && drawRectCnt > 0) {
            this._renderer?._writeCtxBuffer();
            this._renderer?.drawTransparentOverlayImg()
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
                this._releaseRect(rect);
                if (rect.type === 'flip') {
                    this._lateFlipRect++;
                }

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

                    // Close VideoFrames in the frame being dropped
                    const droppedFrame = this._asyncFrameQueue[0];
                    for (const droppedRect of droppedFrame[2]) {
                        this._releaseRect(droppedRect);
                    }

                    this._asyncFrameQueue.shift();
                    this._droppedFrames += (rect.frame_id - newestFrameID);
                }

                let rect_cnt = ((rect.type == "flip") ? rect.rect_cnt : 0);
                this._asyncFrameQueue.push([ rect.frame_id, rect_cnt, [ rect ], (rect_cnt == 1), 0, 0 ]);

            } else {
                // Falls between queued frames (its own frame was dropped); nothing will draw or close it
                this._droppedRects++;
                this._releaseRect(rect);
            }
        }
    }

    _releaseRect(rect) {
        switch (rect.type) {
            case 'video_frame':
                rect.frame?.close();
                break;
            case 'vid':
            case 'bitmap':
                rect.img?.close?.();
                break;
        }
    }

    /*
    Clear the async frame buffer
    */
    _clearAsyncQueue() {
        // Close all VideoFrames in the queue before dropping
        for (const frame of this._asyncFrameQueue) {
            for (const rect of frame[2]) {
                this._releaseRect(rect);
            }
        }

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
        // Record frame-to-frame interval
        perfLogger.recordFrameInterval();

        if (this._asyncFrameQueue[0][3] || force) {
            const frameStart = perfLogger.start('frameProcessing');

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

                const locations = a.screenLocations;
                let lastLocation = -1;
                for (let li = 0; li < locations.length; li++) {
                    const idx = locations[li].screenIndex;
                    if (idx === 0 || this._screens[idx]) { lastLocation = li; }
                }
                if (lastLocation === -1) {
                    this._releaseRect(a);
                }
                let releaseFrame = false;
                let tightData = null;
                let order = null;
                if (locations.length > 1 && a.type === 'video_frame') {
                    order = locations.map((_, i) => i);
                    order.sort((x, y) => (locations[x].screenIndex === 0) - (locations[y].screenIndex === 0));
                }
                for (let oi = 0; oi < locations.length; oi++) {
                    const sI = order ? order[oi] : oi;
                    let screenLocation = a.screenLocations[sI];
                    if (screenLocation.screenIndex === 0) {
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
                            case 'clear':
                                this.clearRect(screenLocation.x, screenLocation.y, a.width, a.height, 0, a.frame_id, true);
                                break;
                            case 'vid':
                                this.drawImage(a.img, screenLocation.x, screenLocation.y, a.width, a.height);
                                break;
                            case 'bitmap':
                                this.drawImage(a.img, screenLocation.x, screenLocation.y, a.width, a.height);
                                break;
                            case 'video_frame':
                                this.drawVideoFrame(a.frame, screenLocation.x, screenLocation.y, a.width, a.height);
                                break;
                            default:
                                continue;
                        }
                        primaryScreenRects++;
                    } else {
                        if (!this._screens[screenLocation.screenIndex]) {
                            continue;
                        }

                        switch (a.type) {
                            case 'dummy':
                            case 'transparent':
                            case 'flip':
                                break;
                            case 'vid':
                                secondaryScreenRects++;
                                if (this._screens[screenLocation.screenIndex]?.channel) {
                                    this._screens[screenLocation.screenIndex].channel.postMessage({
                                        eventType: 'rect',
                                        rect: {
                                           'type': 'vid',
                                           'img': a.img,
                                           'x': a.x,
                                           'y': a.y,
                                           'width': a.width,
                                           'height': a.height,
                                           'frame_id': a.frame_id,
                                           'screenLocations': a.screenLocations
                                        },
                                        screenLocationIndex: sI
                                    }, sI === lastLocation ? [a.img] : []);
                                }
                                break;
                            case 'bitmap':
                                secondaryScreenRects++;
                                if (this._screens[screenLocation.screenIndex].channel) {
                                    this._screens[screenLocation.screenIndex].channel.postMessage({
                                        eventType: 'rect',
                                        rect: {
                                           'type': 'bitmap',
                                           'img': a.img,
                                           'x': a.x,
                                           'y': a.y,
                                           'width': a.width,
                                           'height': a.height,
                                           'frame_id': a.frame_id,
                                           'screenLocations': a.screenLocations
                                        },
                                        screenLocationIndex: sI
                                    }, sI === lastLocation ? [a.img] : []);
                                }
                                break;
                            case 'blit':
                                secondaryScreenRects++;
                                const whole = a.data.byteOffset === 0 && a.data.byteLength === a.data.buffer.byteLength;
                                if (!whole && tightData === null) { tightData = a.data.slice().buffer; }
                                let buf = whole ? a.data.buffer : tightData;
                                if (this._screens[screenLocation.screenIndex].channel) {
                                    this._screens[screenLocation.screenIndex].channel.postMessage({
                                        eventType: 'rect',
                                        rect: {
                                           'type': 'blit',
                                           'img': null,
                                           'data': buf,
                                           'x': a.x,
                                           'y': a.y,
                                           'width': a.width,
                                           'height': a.height,
                                           'frame_id': a.frame_id,
                                           'screenLocations': a.screenLocations
                                        },
                                        screenLocationIndex: sI
                                    }, sI === lastLocation ? [buf] : []);
                                }
                                break;
                            case 'video_frame':
                                secondaryScreenRects++;
                                if (this._screens[screenLocation.screenIndex]?.encodedFramePort) {
                                    releaseFrame = true;
                                } else if (a.frame && a.frame.format !== null) {
                                    if (this._screens[screenLocation.screenIndex]?.channel) {
                                        Log.Debug(`[PRIMARY] Converting VideoFrame to ImageBitmap`);
                                        const bitmapStart = perfLogger.start('imageBitmapCreate');
                                        const videoFrame = a.frame;
                                        const targetChannel = this._screens[screenLocation.screenIndex].channel;
                                        createImageBitmap(videoFrame).then((bitmap) => {
                                            perfLogger.end('imageBitmapCreate', bitmapStart);

                                            if (this._screens[screenLocation.screenIndex]?.channel !== targetChannel) {
                                                bitmap.close();
                                                return;
                                            }

                                            const broadcastStart = perfLogger.start('broadcastChannelSend');
                                            try {
                                                targetChannel.postMessage({
                                                    eventType: 'rect',
                                                    rect: {
                                                        type: 'bitmap',
                                                        img: bitmap,
                                                        x: a.x,
                                                        y: a.y,
                                                        width: a.width,
                                                        height: a.height,
                                                        frame_id: a.frame_id,
                                                        screenLocations: a.screenLocations
                                                    },
                                                    screenLocationIndex: sI
                                                }, [bitmap]); // Transfer ImageBitmap
                                            } catch (err) {
                                                bitmap.close();
                                                throw err;
                                            }
                                            perfLogger.end('broadcastChannelSend', broadcastStart);

                                            Log.Debug(`[PRIMARY] ImageBitmap posted to secondary screen ${screenLocation.screenIndex}`);
                                        }).catch((error) => {
                                            perfLogger.end('imageBitmapCreate', bitmapStart);
                                            Log.Error(`[PRIMARY] Failed to create ImageBitmap from VideoFrame: ${error.message}`);
                                        }).finally(() => {
                                            videoFrame.close();
                                        });
                                    } else {
                                        releaseFrame = true;
                                    }
                                } else {
                                    Log.Warn(`[PRIMARY] VideoFrame has null format, skipping`);
                                }
                                break;
                            case 'img':
                            case '_img':
                                secondaryScreenRects++;
                                if (this._screens[screenLocation.screenIndex].channel) {
                                    this._screens[screenLocation.screenIndex].channel.postMessage({
                                        eventType: 'rect',
                                        rect: {
                                           'type': 'img',
                                           'img': null,
                                           'x': a.x,
                                           'y': a.y,
                                           'width': a.width,
                                           'height': a.height,
                                           'frame_id': a.frame_id,
                                           'screenLocations': a.screenLocations,
                                           'src' : a.src
                                        },
                                        screenLocationIndex: sI
                                    });
                                }
                                break;
                            default:
                                secondaryScreenRects++;
                                if (a instanceof HTMLImageElement || a?.img instanceof HTMLImageElement) {
                                    Log.Warn("Wrong rect type: " + a.type);
                                } else {
                                    if (this._screens[screenLocation.screenIndex].channel) {
                                        try {
                                            this._screens[screenLocation.screenIndex].channel.postMessage({
                                                eventType: 'rect',
                                                rect: a,
                                                screenLocationIndex: sI
                                            });

                                        } catch (e) {
                                            Log.Error(`Failed to post rect: ${e.message}, rect type: ${a.type}`);
                                        }
                                    }
                                }
                        }
                    }
                }

                if (releaseFrame && a.frame) {
                    a.frame.close();
                }
                if (a.type === 'vid' || a.type === 'bitmap') {
                    a.img?.close?.();
                }
            }

            if (this._renderer?.enableCanvasBuffer) {
                if (primaryScreenRects > 0) {
                    this._renderer?._writeCtxBuffer();
                }

                if (this._renderer?.transparentOverlayImg) {
                    if (primaryScreenRects > 0) {
                        this._renderer?.drawTransparentOverlayImg();
                    }
                    const transparentOverlayRect = this._renderer?.transparentOverlayRect;
                    if (secondaryScreenRects > 0 && this._lastTransparentRectId !== transparentOverlayRect.hash_id) {
                        for (let sI = 1; sI < transparentOverlayRect.screenLocations.length; sI++) {
                            if (this._screens[transparentOverlayRect.screenLocations[sI].screenIndex].channel) {
                                this._screens[transparentOverlayRect.screenLocations[sI].screenIndex].channel.postMessage({ eventType: 'rect', rect: transparentOverlayRect, screenLocationIndex: sI });
                            }
                        }
                    }
                    this._lastTransparentRectId = transparentOverlayRect.hash_id;
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

            perfLogger.end('frameProcessing', frameStart);

            this.onFrameRendered();

            // if there is more data in queue, then keep checking
            if (this._asyncFrameQueue[0][2].length > 0) {
                window.requestAnimationFrame( () => { this._pushAsyncFrame(); });
            }
        } else if (this._asyncFrameQueue[0][1] > 0 && this._asyncFrameQueue[0][1] === this._asyncFrameQueue[0][2].length) {
            //how many times has _pushAsyncFrame been called when the frame had all rects but has not been drawn
            this._asyncFrameQueue[0][5] += 1;
            //force the frame to be drawn if it has been here too long
            if (this._asyncFrameQueue[0][5] > 5) {
                this._pushAsyncFrame(true);
            }
        }
    }

    _configureLocalDecoder(codec, width, height, streamMode) {
        this._localDecoder.configure({
            codec,
            displayAspectWidth: width,
            displayAspectHeight: height,
            optimizeForLatency: true,
            // Chrome WebCodecs bug with NVENC h264
            hardwareAcceleration: streamMode === encodings.pseudoEncodingStreamingModeAVCNVENC
                ? 'prefer-software' : 'no-preference',
        });
    }

    _handleEncodedFrame(e) {
        const { codec, keyFrame, streamMode, data, x, y, width, height, frameId } = e.data;

        // Reconfigure decoder on first use or when codec/dimensions/streaming mode change
        if (!this._localDecoder || this._localDecoderCodec !== codec ||
            this._localDecoderW !== width || this._localDecoderH !== height ||
            (keyFrame && this._localDecoderStreamMode !== streamMode)) {
            if (!keyFrame)
                return;

            if (this._localDecoder) {
                this._localDecoder.close();
                this._localDecoderMeta.clear();
            }
            this._localDecoder = new VideoDecoder({
                output: (frame) => {
                    const meta = this._localDecoderMeta.get(frame.timestamp);
                    this._localDecoderMeta.delete(frame.timestamp);
                    if (meta) {
                        // drawVideoFrame delegates to the renderer which closes the frame internally.
                        this.drawVideoFrame(frame, meta.x, meta.y, meta.width, meta.height);
                        // Flush back-buffer to visible canvas if double-buffering is active.
                        if (this._renderer?.enableCanvasBuffer) {
                            this._renderer._writeCtxBuffer();
                            this._renderer.drawTransparentOverlayImg();
                        }
                    } else {
                        frame.close();
                    }
                },
                error: (err) => {
                    Log.Error('Secondary VideoDecoder error:', err);
                    this._localDecoder = null;
                }
            });
            this._localDecoderCodec = codec;
            this._localDecoderW = width;
            this._localDecoderH = height;
            this._localDecoderStreamMode = streamMode;
            this._configureLocalDecoder(codec, width, height, streamMode);
        }

        const ts = ++this._localDecoderTs;
        this._localDecoderMeta.set(ts, { x, y, width, height, frameId });
        this._localDecoder.decode(new EncodedVideoChunk({
            type: keyFrame ? 'key' : 'delta',
            data,
            timestamp: ts,
        }));
    }

    _processRectScreens(rect) {
        //find which screen this rect belongs to and adjust its x and y to be relative to the destination
        let indexes = [];
        if (rect.type === 'video_frame') {
            const screen = this._screens[rect.screenId];
            let screenPosition = {
                x: 0 - (screen.x - rect.x), //rect.x - screen.x,
                y: 0 - (screen.y - rect.y), //rect.y - screen.y,
                screenIndex: rect.screenId
            }

            indexes.push(screenPosition);
        } else {
            rect.inPrimary = false;
            rect.inSecondary = false;
            for (let i = 0; i < this._screens.length; i++) {
                let screen = this._screens[i];
                const empty = screen.x2 <= screen.x || screen.y2 <= screen.y;
                if (empty && i > 0) {
                    continue;
                }
                const right = empty ? Infinity : screen.x2;
                const bottom = empty ? Infinity : screen.y2;

                if (!(rect.x >= right || screen.x >= (rect.x + rect.width) ||
                      rect.y >= bottom || screen.y >= (rect.y + rect.height))) {
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
                    if (i === 0) {
                        rect.inPrimary = true;
                    } else {
                        rect.inSecondary = true;
                    }
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

        this._renderer?.rescale(factor, width, height, vp.serverWidth, vp.serverHeight, vp.width);

        requestAnimationFrame( () => { this._pushAsyncFrame(); });
    }
}
