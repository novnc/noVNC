/*
 * KasmVNC: HTML5 VNC client
 * Copyright (C) 2020 Kasm Technologies
 * Copyright (C) 2019 The noVNC Authors
 * (c) 2012 Michael Tinglof, Joe Balaz, Les Piech (Mercuri.ca)
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 *
 */

import * as Log from '../util/logging.js';
import Inflator from "../inflator.js";
import { hashUInt8Array } from '../util/int.js';

export default class TightDecoder {
    constructor(display) {
        this._ctl = null;
        this._filter = null;
        this._numColors = 0;
        this._palette = new Uint8Array(1024);  // 256 * 4 (max palette size * max bytes-per-pixel)
        this._len = 0;
        this._enableQOI = false;
        this._displayGlobal = display;
        this._lastTransparentRectHash = '';
        this._lastTransparentRectInfo = '';

        this._zlibs = [];
        for (let i = 0; i < 4; i++) {
            this._zlibs[i] = new Inflator();
        }
        this._itzlib = new Inflator();
    }

    // ===== PROPERTIES =====
    
    get enableQOI() { return this._enableQOI; }
    set enableQOI(enabled) {
        if(this._enableQOI === enabled) {
            return;
        }

        if (enabled) {
            this._enableQOI = this._enableQOIWorkers();
        } else {
            this._enableQOI = false;
            this._disableQOIWorkers();
        }
    }

    // ===== Public Methods =====

    decodeRect(x, y, width, height, sock, display, depth, frame_id) {
        if (this._ctl === null) {
            if (sock.rQwait("TIGHT compression-control", 1)) {
                return false;
            }

            this._ctl = sock.rQshift8();

            // Reset streams if the server requests it
            for (let i = 0; i < 4; i++) {
                if ((this._ctl >> i) & 1) {
                    this._zlibs[i].reset();
                    Log.Info("Reset zlib stream " + i);
                }
            }

            // Figure out filter
            this._ctl = this._ctl >> 4;
        }
        
        let ret;

        if (this._ctl === 0x08) {
            ret = this._fillRect(x, y, width, height,
                                 sock, display, depth, frame_id);
        } else if (this._ctl === 0x09) {
            ret = this._jpegRect(x, y, width, height,
                                 sock, display, depth, frame_id);
        } else if (this._ctl === 0x0A) {
            ret = this._pngRect(x, y, width, height,
                                sock, display, depth, frame_id);
        } else if ((this._ctl & 0x08) == 0) {
            ret = this._basicRect(this._ctl, x, y, width, height,
                                  sock, display, depth, frame_id);
        } else if (this._ctl === 0x0B) {
            ret = this._webpRect(x, y, width, height,
                                sock, display, depth, frame_id);
        } else if (this._ctl === 0x0C) {
            ret = this._qoiRect(x, y, width, height,
                                sock, display, depth, frame_id);
        } else if (this._ctl === 0x0D) {
            ret = this._itRect(x, y, width, height,
                                sock, display, depth, frame_id);
        } else {
            throw new Error("Illegal tight compression received (ctl: " +
                                   this._ctl + ")");
        }

        if (ret) {
            this._ctl = null;
        }

        return ret;
    }

    // ===== Private Methods =====

    _fillRect(x, y, width, height, sock, display, depth, frame_id) {
        if (sock.rQwait("TIGHT", 3)) {
            return false;
        }

        const rQi = sock.rQi;
        const rQ = sock.rQ;

        display.fillRect(x, y, width, height,
                         [rQ[rQi], rQ[rQi + 1], rQ[rQi + 2]], frame_id, false);
        sock.rQskipBytes(3);

        return true;
    }

    _jpegRect(x, y, width, height, sock, display, depth, frame_id) {
        let data = this._readData(sock);
        if (data === null) {
            return false;
        }

        display.imageRect(x, y, width, height, "image/jpeg", data, frame_id);

        return true;
    }

    _webpRect(x, y, width, height, sock, display, depth, frame_id) {
        let data = this._readData(sock);
        if (data === null) {
            return false;
        }

        display.imageRect(x, y, width, height, "image/webp", data, frame_id);

        return true;
    }

    _processRectQ() {
        while (this._availableWorkers.length > 0 && this._qoiRects.length > 0) {
            let i = this._availableWorkers.pop();
            let worker = this._workers[i];
            let rect = this._qoiRects.shift();
            var image = new ArrayBuffer(rect.data.length);
            new Uint8Array(image).set(new Uint8Array(rect.data));
            worker.postMessage({
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
                depth: rect.depth,
                frame_id: rect.frame_id,
                image: image
            }, [image]);
        }
    }

    _qoiRect(x, y, width, height, sock, display, depth, frame_id) {
        let data = this._readData(sock);
        if (data === null) {
            return false;
        }

        if (this._enableQOI) {
            let dataClone = new Uint8Array(data);
            let item = {x: x,y: y,width: width,height: height,data: dataClone,depth: depth, frame_id: frame_id};
            if (this._qoiRects.length < 1000) {
                this._qoiRects.push(item);
                this._processRectQ();
            } else {
                Log.Warn("QOI queue exceeded limit.");
                this._qoiRects.splice(0, 500);
            }
            
        }

        return true;
    }

    _itRect(x, y, width, height, sock, display, depth, frame_id) {
        let data = this._readData(sock);
        if (data === null) {
            return false;
        }
        
        //filter out consecutive redundant data
        let h = hashUInt8Array(data);
        let info = `${x}.${y}.${width}.${height}`
        if (!(h === this._lastTransparentRectHash && info === this._lastTransparentRectInfo)) {
            const r = data[0];
            const g = data[1];
            const b = data[2];
            const a = data[3];

            const uncompressedSize = Math.floor(width * height / 2 + 1);

            this._itzlib.reset();
            this._itzlib.setInput(data.slice(4));
            data = this._itzlib.inflate(uncompressedSize);
            this._itzlib.setInput(null);

            // unpack
            let rgba = new Uint8Array(width * height * 4 + 4);
            for (let i = 0, d = 0; i < uncompressedSize; i++, d += 8) {
                let p = data[i];

                rgba[d + 0] = r;
                rgba[d + 1] = g;
                rgba[d + 2] = b;
                rgba[d + 3] = a * ((p & 15) << 4) / 255;

                rgba[d + 4] = r;
                rgba[d + 5] = g;
                rgba[d + 6] = b;
                rgba[d + 7] = a * (p & 240) / 255;
            }

            let img = new ImageData(new Uint8ClampedArray(rgba.buffer, 0, width * height * 4), width, height);
            display.transparentRect(x, y, width, height, img, frame_id, h);
            this._lastTransparentRectHash = h;
            this._lastTransparentRectInfo = info;
        } else {
            display.dummyRect(x, y, width, height, frame_id);
        }

        return true;
    }

    _pngRect(x, y, width, height, sock, display, depth, frame_id) {
        throw new Error("PNG received in standard Tight rect");
    }

    _basicRect(ctl, x, y, width, height, sock, display, depth, frame_id) {
        if (this._filter === null) {
            if (ctl & 0x4) {
                if (sock.rQwait("TIGHT", 1)) {
                    return false;
                }

                this._filter = sock.rQshift8();
            } else {
                // Implicit CopyFilter
                this._filter = 0;
            }
        }

        let streamId = ctl & 0x3;

        let ret;

        switch (this._filter) {
            case 0: // CopyFilter
                ret = this._copyFilter(streamId, x, y, width, height,
                                       sock, display, depth, frame_id);
                break;
            case 1: // PaletteFilter
                ret = this._paletteFilter(streamId, x, y, width, height,
                                          sock, display, depth, frame_id);
                break;
            case 2: // GradientFilter
                ret = this._gradientFilter(streamId, x, y, width, height,
                                           sock, display, depth, frame_id);
                break;
            default:
                throw new Error("Illegal tight filter received (ctl: " +
                                       this._filter + ")");
        }

        if (ret) {
            this._filter = null;
        }

        return ret;
    }

    _copyFilter(streamId, x, y, width, height, sock, display, depth, frame_id) {
        const uncompressedSize = width * height * 3;
        let data;

        if (uncompressedSize === 0) {
            return true;
        }

        if (uncompressedSize < 12) {
            if (sock.rQwait("TIGHT", uncompressedSize)) {
                return false;
            }

            data = sock.rQshiftBytes(uncompressedSize);
        } else {
            data = this._readData(sock);
            if (data === null) {
                return false;
            }

            this._zlibs[streamId].setInput(data);
            data = this._zlibs[streamId].inflate(uncompressedSize);
            this._zlibs[streamId].setInput(null);
        }

        let rgbx = new Uint8Array(width * height * 4);
        for (let i = 0, j = 0; i < width * height * 4; i += 4, j += 3) {
            rgbx[i]     = data[j];
            rgbx[i + 1] = data[j + 1];
            rgbx[i + 2] = data[j + 2];
            rgbx[i + 3] = 255;  // Alpha
        }

        display.blitImage(x, y, width, height, rgbx, 0, frame_id, false);

        return true;
    }

    _paletteFilter(streamId, x, y, width, height, sock, display, depth, frame_id) {
        if (this._numColors === 0) {
            if (sock.rQwait("TIGHT palette", 1)) {
                return false;
            }

            const numColors = sock.rQpeek8() + 1;
            const paletteSize = numColors * 3;

            if (sock.rQwait("TIGHT palette", 1 + paletteSize)) {
                return false;
            }

            this._numColors = numColors;
            sock.rQskipBytes(1);

            sock.rQshiftTo(this._palette, paletteSize);
        }

        const bpp = (this._numColors <= 2) ? 1 : 8;
        const rowSize = Math.floor((width * bpp + 7) / 8);
        const uncompressedSize = rowSize * height;

        let data;

        if (uncompressedSize === 0) {
            return true;
        }

        if (uncompressedSize < 12) {
            if (sock.rQwait("TIGHT", uncompressedSize)) {
                return false;
            }

            data = sock.rQshiftBytes(uncompressedSize);
        } else {
            data = this._readData(sock);
            if (data === null) {
                return false;
            }

            this._zlibs[streamId].setInput(data);
            data = this._zlibs[streamId].inflate(uncompressedSize);
            this._zlibs[streamId].setInput(null);
        }

        // Convert indexed (palette based) image data to RGB
        if (this._numColors == 2) {
            this._monoRect(x, y, width, height, data, this._palette, display, frame_id);
        } else {
            this._paletteRect(x, y, width, height, data, this._palette, display, frame_id);
        }

        this._numColors = 0;

        return true;
    }

    _monoRect(x, y, width, height, data, palette, display, frame_id) {
        // Convert indexed (palette based) image data to RGB
        // TODO: reduce number of calculations inside loop
        const dest = this._getScratchBuffer(width * height * 4);
        const w = Math.floor((width + 7) / 8);
        const w1 = Math.floor(width / 8);

        for (let y = 0; y < height; y++) {
            let dp, sp, x;
            for (x = 0; x < w1; x++) {
                for (let b = 7; b >= 0; b--) {
                    dp = (y * width + x * 8 + 7 - b) * 4;
                    sp = (data[y * w + x] >> b & 1) * 3;
                    dest[dp]     = palette[sp];
                    dest[dp + 1] = palette[sp + 1];
                    dest[dp + 2] = palette[sp + 2];
                    dest[dp + 3] = 255;
                }
            }

            for (let b = 7; b >= 8 - width % 8; b--) {
                dp = (y * width + x * 8 + 7 - b) * 4;
                sp = (data[y * w + x] >> b & 1) * 3;
                dest[dp]     = palette[sp];
                dest[dp + 1] = palette[sp + 1];
                dest[dp + 2] = palette[sp + 2];
                dest[dp + 3] = 255;
            }
        }

        display.blitImage(x, y, width, height, dest, 0, frame_id, false);
    }

    _paletteRect(x, y, width, height, data, palette, display, frame_id) {
        // Convert indexed (palette based) image data to RGB
        const dest = this._getScratchBuffer(width * height * 4);
        const total = width * height * 4;
        for (let i = 0, j = 0; i < total; i += 4, j++) {
            const sp = data[j] * 3;
            dest[i]     = palette[sp];
            dest[i + 1] = palette[sp + 1];
            dest[i + 2] = palette[sp + 2];
            dest[i + 3] = 255;
        }

        display.blitImage(x, y, width, height, dest, 0, frame_id, false);
    }

    _gradientFilter(streamId, x, y, width, height, sock, display, depth, frame_id) {
        throw new Error("Gradient filter not implemented");
    }

    _readData(sock) {
        if (this._len === 0) {
            if (sock.rQwait("TIGHT", 3)) {
                return null;
            }

            let byte;

            byte = sock.rQshift8();
            this._len = byte & 0x7f;
            if (byte & 0x80) {
                byte = sock.rQshift8();
                this._len |= (byte & 0x7f) << 7;
                if (byte & 0x80) {
                    byte = sock.rQshift8();
                    this._len |= byte << 14;
                }
            }
        }

        if (sock.rQwait("TIGHT", this._len)) {
            return null;
        }

        let data = sock.rQshiftBytes(this._len);
        this._len = 0;

        return data;
    }

    _getScratchBuffer(size) {
        if (!this._scratchBuffer || (this._scratchBuffer.length < size)) {
            this._scratchBuffer = new Uint8Array(size);
        }
        return this._scratchBuffer;
    }

    async _disableQOIWorkers() {
        if (this._workers) {
            this._enableQOI = false;
            this._availableWorkers = null;
            this._qoiRects = null;
            this._rectQlooping = null;
            for await (let i of Array.from(Array(this._threads).keys())) {
                this._workers[i].terminate();
                delete this._workers[i];
            }
            this._workers = null;
        }
    }

    _enableQOIWorkers() {
        let fullPath = window.location.pathname;
        let path = fullPath.substring(0, fullPath.lastIndexOf('/')+1);
        if ((window.navigator.hardwareConcurrency) && (window.navigator.hardwareConcurrency >= 4)) {
            this._threads = 16;
        } else {
            this._threads = 8;
        }
        this._workers = [];
        this._availableWorkers = [];
        this._qoiRects = [];
        this._rectQlooping = false;
        for (let i = 0; i < this._threads; i++) {
            this._workers.push(new Worker("core/decoders/qoi/decoder.js"));
            this._workers[i].onmessage = (evt) => {
                this._availableWorkers.push(i);
                switch(evt.data.result) {
                    case 0:
                        evt.data.freemem = null;
                        let data = new Uint8ClampedArray(evt.data.data);
                        let img = new ImageData(data, evt.data.img.width, evt.data.img.height, {colorSpace: evt.data.img.colorSpace});
                        
                        this._displayGlobal.blitQoi(
                            evt.data.x,
                            evt.data.y,
                            evt.data.width,
                            evt.data.height,
                            img,
                            0,
                            evt.data.frame_id,
                            false
                        );
                        this._processRectQ();
                        // Send data back for garbage collection
                        this._workers[i].postMessage({freemem: evt.data.data});
                        break;
                    case 1:
                        Log.Info("QOI Worker is now available.");
                        break;
                    case 2:
                        Log.Info("Error on worker: " + evt.error);
                        break;
                }
            };
        }
        for (let i = 0; i < this._threads; i++) {
            this._workers[i].postMessage({path:path});
        }

        return true;
    }
}
