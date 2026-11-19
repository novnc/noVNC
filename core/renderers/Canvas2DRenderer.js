import * as Log from "../util/logging";
import { perfLogger } from '../util/performance-logger.js';
import {clampDimension} from "../util/fb-limits.js";

export class Canvas2DRenderer {
    constructor(canvas, backbuffer) {
        this._target = canvas;

        if (!this._target) {
            throw new Error("Target must be set");
        }

        if (typeof this._target === 'string') {
            throw new Error('target must be a DOM element');
        }

        if (!this._target.getContext) {
            throw new Error("no getContext method");
        }

        this._targetCtx = this._target.getContext('2d', {
            alpha: false
        });
        this._visibleCtx = this._targetCtx; // persistent ref to visible canvas, never reassigned

        //optional offscreen canvas
        this._enableCanvasBuffer = false;
        this._backbuffer = backbuffer;
        this._drawCtx = this._backbuffer.getContext('2d');

        this._prevDrawStyle = "";
        this._antiAliasing = 0;

        this._transparentOverlayImg = null;
        this._transparentOverlayRect = null;
    }

    get width() {
        return this._target.width;
    }

    get height() {
        return this._target.height;
    }

    get enableCanvasBuffer() {
        return this._enableCanvasBuffer;
    }

    set enableCanvasBuffer(value) {
        if (value === this._enableCanvasBuffer) {
            return;
        }

        this._enableCanvasBuffer = value;
        this._targetCtx = value ? this._drawCtx : this._visibleCtx;

        if (value && this._target) {
            //copy current visible canvas to backbuffer
            let saveImg = this._visibleCtx.getImageData(0, 0, this._target.width, this._target.height);
            this._drawCtx.putImageData(saveImg, 0, 0);

            if (this._transparentOverlayImg) {
                this.drawImage(this._transparentOverlayImg, this._transparentOverlayRect.x, this._transparentOverlayRect.y, this._transparentOverlayRect.width, this._transparentOverlayRect.height, true);
            }
        } else if (!value && this._target) {
            //copy backbuffer to canvas to clear any overlays
            let saveImg = this._drawCtx.getImageData(0, 0, this._target.width, this._target.height);
            this._visibleCtx.putImageData(saveImg, 0, 0);
        }
    }

    get antiAliasing() {
        return this._antiAliasing;
    }

    set antiAliasing(value) {
        this._antiAliasing = value;
    }

    get transparentOverlayImg() {
        return this._transparentOverlayImg;
    }

    set transparentOverlayImg(value) {
        this._transparentOverlayImg = value;
        this.enableCanvasBuffer = true;
    }

    get transparentOverlayRect() {
        return this._transparentOverlayRect;
    }

    set transparentOverlayRect(value) {
        this._transparentOverlayRect = value;
    }

    drawTransparentOverlayImg() {
        if (this._transparentOverlayImg) {
            this.drawImage(this._transparentOverlayImg, this._transparentOverlayRect.x, this._transparentOverlayRect.y, this._transparentOverlayRect.width, this._transparentOverlayRect.height, true);
        }
    }

    viewportChangeSize(width, height) {
        width = clampDimension(width);
        height = clampDimension(height);

        const canvas = this._target;
        if (canvas.width === width && canvas.height === height) {
            return false;
        }

        let saveImg = null;
        if (canvas.width > 0 && canvas.height > 0) {
            saveImg = this._visibleCtx.getImageData(0, 0, canvas.width, canvas.height);
        }

        canvas.width = width;
        canvas.height = height;

        if (saveImg) {
            this._visibleCtx.putImageData(saveImg, 0, 0);
        }

        return true;
    }

    rescale(factor, width, height, serverWidth, serverHeight, viewPortWidth) {
        const style = this._target.style;
        if ((style.width !== width) ||
            (style.height !== height)) {
            style.width = width;
            style.height = height;
        }

        Log.Info('Pixel Ratio: ' + window.devicePixelRatio + ', VNC Scale: ' + factor + 'VNC Res: ' + serverWidth + 'x' + serverHeight + 'y');

        const pixR = Math.abs(Math.ceil(window.devicePixelRatio));
        const isFirefox = navigator.userAgent.toLowerCase().indexOf('firefox') > -1;

        if (this.antiAliasing === 2 || (this.antiAliasing === 0 && factor === 1 && style.imageRendering !== 'pixelated' && pixR === window.devicePixelRatio && viewPortWidth > 0)) {
            style.imageRendering = ((!isFirefox) ? 'pixelated' : 'crisp-edges');
            Log.Debug('Smoothing disabled');
        } else if (this.antiAliasing === 1 || (this.antiAliasing === 0 && factor !== 1 && style.imageRendering !== 'auto')) {
            style.imageRendering = 'auto'; //auto is really smooth (blurry) using trilinear of linear
            Log.Debug('Smoothing enabled');
        }
    }

    resize(width, height, screens) {
        this._prevDrawStyle = "";

        let canvas = this._backbuffer;
        if (canvas === undefined) {
            return;
        }

        if (screens.length > 0) {
            width = screens[0].serverWidth;
            height = screens[0].serverHeight;
        }

        width = clampDimension(width);
        height = clampDimension(height);

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
    }

    blitImage(x, y, width, height, arr, offset) {
        let data;
        if (!ArrayBuffer.isView(arr)) {
            data = new Uint8ClampedArray(arr,
                                         arr.length + offset,
                                         width * height * 4);
        } else {
            data = new Uint8ClampedArray(arr.buffer,
                                         arr.byteOffset + offset,
                                         width * height * 4);
        }
        // NB(directxman12): arr must be an Type Array view
        let img = new ImageData(data, width, height);
        this._targetCtx.putImageData(img, x, y);
    }

    blitQoi(arr, x, y) {
        this._targetCtx.putImageData(arr, x, y);
    }

    clearRect(x, y, width, height) {
        this._targetCtx.clearRect(x, y, width, height);
    }

    copyImage(oldX, oldY, newX, newY, w, h) {
        const targetCtx = this._targetCtx;
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

    drawImage(img, x, y, w, h, overlay = false) {
        const ctx = (overlay && this._enableCanvasBuffer) ? this._visibleCtx : this._targetCtx;
        if (img.width !== w || img.height !== h) {
            ctx.drawImage(img, x, y, w, h);
        } else {
            ctx.drawImage(img, x, y);
        }
    }

    drawVideoFrame(videoFrame, x, y, width, height) {
        const renderStart = perfLogger.start('canvasRender');
        this._targetCtx.drawImage(videoFrame, x, y, width, height, 0, 0, width, height);
        perfLogger.end('canvasRender', renderStart);
        videoFrame.close();
    }

    fillRect(x, y, width, height, color) {
        this._setFillColor(color);
        this._targetCtx.fillRect(x, y, width, height);
    }

    putImage(img, x, y) {
        this._targetCtx.putImageData(img, x, y);
    }

    _writeCtxBuffer() {
        //TODO: KASM-5450 Damage tracking with transparent rect overlay support
        if (this._backbuffer.width > 0) {
            this._visibleCtx.drawImage(this._backbuffer, 0, 0);
        }
    }

    _setFillColor(color) {
        const newStyle = 'rgb(' + color[0] + ',' + color[1] + ',' + color[2] + ')';
        if (newStyle !== this._prevDrawStyle) {
            this._targetCtx.fillStyle = newStyle;
            this._prevDrawStyle = newStyle;
        }
    }

    dispose() {
        if (this._visibleCtx && this._target) {
            this._visibleCtx.clearRect(0, 0, this._target.width, this._target.height);
        }
    }
}