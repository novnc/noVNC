/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2021 The noVNC Authors
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 *
 */
import Inflator from "../inflator.js";

export default class ZRLEDecoder {
    constructor() {
        this._data = false;
        this._compressedLength = null;
        this._uncompressed = null;
        this._tileBuffer = new Uint8ClampedArray(64 * 64 * 4);
        this._zlib = new Inflator();
        this._clearDataBuffer();
    }

    _clearDataBuffer() {
        this._dataBuffer = null;
        this._dataBufferPtr = 0;
        this._dataBufferSize = 1 + (1024 * 10);
    }

    _fillDataBuffer() {
        let fillSize = this._dataBufferSize;
        while (true) {
            try {
                this._dataBuffer = this._zlib.inflate(fillSize, true);
                this._dataBufferPtr = 0;
                this._dataBufferSize = this._dataBuffer.length;
                break;
            } catch (e) {
                if (fillSize == 1) { // Something's wrong if we can't fill even 1 byte
                    throw (e);
                }
                fillSize = Math.ceil(fillSize / 2);
            }
        }
    }

    _inflateFromStream(bytes) {
        if (this._dataBuffer == null) {
            this._dataBuffer = new Uint8Array(this._dataBufferSize);
            this._fillDataBuffer();
        }
        let ret = new Uint8Array(bytes), pos = 0;
        while (bytes > 0) {
            let sliceLen = bytes > (this._dataBufferSize - this._dataBufferPtr) ? this._dataBufferSize - this._dataBufferPtr : bytes;
            ret.set(this._dataBuffer.slice(this._dataBufferPtr, this._dataBufferPtr + sliceLen), pos);
            pos += sliceLen;
            this._dataBufferPtr += sliceLen;
            bytes -= sliceLen;
            if (bytes > 0 && this._dataBufferPtr == this._dataBufferSize) {
                this._fillDataBuffer();
                this._dataBufferPtr = 0;
            }
        }
        return ret;
    }

    _rleRun() {
        let r = 0, runLength = 1;
        do {
            r = this._inflateFromStream(1)[0];
            runLength += r;
        } while (r == 255);
        return runLength;
    }

    _blitTile(blitpos, blitlen, color) {
        let bp = blitpos * 4;
        let ep = bp + (blitlen * 4);
        let p = bp;
        for (; p < ep;) {
            this._tileBuffer[p] = color[0];
            this._tileBuffer[p + 1] = color[1];
            this._tileBuffer[p + 2] = color[2];
            this._tileBuffer[p + 3] = 255;
            p += 4;
        }
    }

    _colorFromPalette(palette, index, bpp) {
        let idx = bpp * index;
        return [palette[idx], palette[idx + 1], palette[idx + 2]];
    }

    _testBit(cb, bit) {
        return (cb & (1 << bit)) === 0 ? 0 : 1;
    }

    decodeRect(x, y, width, height, sock, display, depth) {
        if (this._compressedLength === null) {
            this._clearDataBuffer();

            // Wait for compressed data length
            if (sock.rQwait("ZRLE", 4)) {
                return false;
            }
            this._compressedLength = sock.rQshift32();
            if (this._compressedLength < this._dataBufferSize) {
                // Try to choose a better data buffer size in powers of 2
                this._dataBufferSize = 1 + Math.pow(2, Math.floor(Math.log(this._compressedLength) / Math.log(2)));
            }
        }
        if (this._compressedLength !== null && this._data === false) {
            // Wait for compressed data
            if (sock.rQwait("ZRLE", this._compressedLength)) {
                return false;
            }
            this._data = true;
            let data = sock.rQshiftBytes(this._compressedLength);
            this._zlib.setInput(data);
        }
        if (this._data === true) {
            let bytesPerPixel = (depth / 8) > 3 ? 3 : Math.round(depth / 8);
            let totalTilesX = Math.ceil(width / 64);
            let totalTilesY = Math.ceil(height / 64);
            let rx = 0, ry = 0;
            for (let ty = 1; ty <= totalTilesY; ty++) {
                rx = 0;
                for (let tx = 1; tx <= totalTilesX; tx++) {
                    let tileWidth = (tx == totalTilesX) ? width - ((totalTilesX - 1) * 64) : 64;
                    let tileHeight = (ty == totalTilesY) ? height - ((totalTilesY - 1) * 64) : 64;
                    let tileTotalPixels = tileWidth * tileHeight;
                    let px = x + rx, py = y + ry;

                    let subencoding = this._inflateFromStream(1)[0];
                    if (subencoding == 0) { // Raw pixel data
                        let bytes = tileWidth * tileHeight * bytesPerPixel;
                        let data = this._inflateFromStream(bytes);
                        for (let src = 0, dst = 0; src < bytes; src += 3, dst += 4) {
                            this._tileBuffer[dst] = data[src];
                            this._tileBuffer[dst + 1] = data[src + 1];
                            this._tileBuffer[dst + 2] = data[src + 2];
                            this._tileBuffer[dst + 3] = 255;
                        }
                        display.blitImage(px, py, tileWidth, tileHeight, this._tileBuffer, 0, false);
                    }
                    if (subencoding == 1) { // Solid tile (single color)
                        let pixel = this._inflateFromStream(bytesPerPixel);
                        display.fillRect(px, py, tileWidth, tileHeight, [pixel[0], pixel[1], pixel[2]], false);
                    }
                    if (subencoding >= 2 && subencoding <= 16) { // Packed palette
                        let bytes = subencoding * bytesPerPixel;
                        let paletteData = this._inflateFromStream(bytes);
                        let packedPixelBytes, bitsPerPixel, pixelsPerByte;
                        switch (subencoding) {
                            case 2:
                                packedPixelBytes = Math.floor((tileWidth + 7) / 8) * tileHeight;
                                bitsPerPixel = 1;
                                pixelsPerByte = 8;
                                break;
                            case 3:
                            case 4:
                                packedPixelBytes = Math.floor((tileWidth + 3) / 4) * tileHeight;
                                bitsPerPixel = 2;
                                pixelsPerByte = 4;
                                break;
                            default:
                                packedPixelBytes = Math.floor((tileWidth + 1) / 2) * tileHeight;
                                bitsPerPixel = 4;
                                pixelsPerByte = 2;
                                break;
                        }
                        let strideWidth = (Math.ceil(tileWidth / 8) * 8) / pixelsPerByte;
                        let pixelData = this._inflateFromStream(packedPixelBytes), pixel = 0, tilePos = 0, cb = pixelData[0];
                        for (let tileY = 0; tileY < tileHeight; tileY++) {
                            cb = pixelData[strideWidth * tileY];
                            for (let tileX = 0, bitIdx = 0, byteIdx = strideWidth * tileY; tileX < tileWidth; tileX++) {
                                switch (bitsPerPixel) {
                                    case 1:
                                        pixel = this._testBit(cb, 8 - bitIdx);
                                        bitIdx++;
                                        break;
                                    case 2:
                                        pixel = (this._testBit(cb, 6 - bitIdx))
                                            + (this._testBit(cb, 7 - bitIdx) << 1);
                                        bitIdx += 2;
                                        break;
                                    case 4:
                                        pixel = this._testBit(cb, 4 - bitIdx)
                                            + (this._testBit(cb, 5 - bitIdx) << 1)
                                            + (this._testBit(cb, 6 - bitIdx) << 2)
                                            + (this._testBit(cb, 7 - bitIdx) << 3);
                                        bitIdx += 4;
                                        break;
                                }
                                if (bitIdx == 8) {
                                    byteIdx += 1;
                                    cb = pixelData[byteIdx];
                                    bitIdx = 0;
                                }
                                this._blitTile(tilePos, 1, [paletteData[pixel * 3], paletteData[pixel * 3 + 1], paletteData[pixel * 3 + 2]]);
                                tilePos++;
                            }
                        }
                        display.blitImage(px, py, tileWidth, tileHeight, this._tileBuffer, 0, false);
                    }
                    if (subencoding == 128) { // Plain RLE
                        let tilePos = 0;
                        while (tilePos < tileTotalPixels) {
                            let pixel = this._inflateFromStream(bytesPerPixel);
                            let runLength = this._rleRun();
                            this._blitTile(tilePos, runLength, pixel);
                            tilePos += runLength;
                        }
                        display.blitImage(px, py, tileWidth, tileHeight, this._tileBuffer, 0, false);
                    }
                    if (subencoding >= 130) { // Palette RLE
                        let paletteBytes = (subencoding - 128) * bytesPerPixel;
                        let palette = this._inflateFromStream(paletteBytes);
                        let tilePos = 0;
                        while (tilePos < tileTotalPixels) {
                            let paletteIndex = this._inflateFromStream(1)[0];
                            let runLength = 1;
                            if (paletteIndex > 127) {
                                let color = this._colorFromPalette(palette, paletteIndex - 128, bytesPerPixel);
                                runLength = this._rleRun();
                                this._blitTile(tilePos, runLength, color);
                            } else {
                                let color = this._colorFromPalette(palette, paletteIndex, bytesPerPixel);
                                this._blitTile(tilePos, runLength, color);
                            }
                            tilePos += runLength;
                        }
                        display.blitImage(px, py, tileWidth, tileHeight, this._tileBuffer, 0, false);
                    }
                    rx += 64; // next tile
                }
                ry += 64; // next row
            }
            this._zlib.setInput(null);
            this._compressedLength = null;
            this._data = false;
        }
        return true;
    }
}
