/*
 * KasmVNC: HTML5 VNC client
 * Copyright (C) 2020 Kasm Technologies
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 *
 */

import * as Log from '../util/logging.js';
import Inflator from "../inflator.js";

export default class UDPDecoder {
    constructor() {
        this._filter = null;
        this._palette = new Uint8Array(1024);  // 256 * 4 (max palette size * max bytes-per-pixel)
        this._directDraw = false; //Draw directly to the canvas without ordering

        this._zlibs = [];
        for (let i = 0; i < 4; i++) {
            this._zlibs[i] = new Inflator();
        }
    }

    decodeRect(x, y, width, height, data, display, depth, frame_id) {
        let ctl = data[12];
        ctl = ctl >> 4;

        let ret;

        if (ctl === 0x08) {
            ret = this._fillRect(x, y, width, height, data, display, depth, frame_id);
        } else if (ctl === 0x09) {
            ret = this._jpegRect(x, y, width, height, data, display, depth, frame_id);
        } else if (ctl === 0x0A) {
            ret = this._pngRect(x, y, width, height, data, display, depth, frame_id);
        } else if ((ctl & 0x08) == 0) {
            ret = this._basicRect(ctl, x, y, width, height, data, display, depth, frame_id);
        } else if (ctl === 0x0B) {
            ret = this._webpRect(x, y, width, height, data, display, depth, frame_id);
        } else {
            throw new Error("Illegal udp compression received (ctl: " +
                ctl + ")");
        }

        return ret;
    }

    _fillRect(x, y, width, height, data, display, depth, frame_id) {

        display.fillRect(x, y, width, height,
            [data[13], data[14], data[15]], frame_id, this._directDraw);

        return true;
    }

    _jpegRect(x, y, width, height, data, display, depth, frame_id) {
        let img = this._readData(data);
        if (img === null) {
            return false;
        }

        display.imageRect(x, y, width, height, "image/jpeg", img, frame_id, this._directDraw);

        return true;
    }

    _webpRect(x, y, width, height, data, display, depth, frame_id) {
        let img = this._readData(data);
        if (img === null) {
            return false;
        }

        display.imageRect(x, y, width, height, "image/webp", img, frame_id, this._directDraw);

        return true;
    }

    _pngRect(x, y, width, height, data, display, depth, frame_id) {
        //throw new Error("PNG received in UDP rect");
        Log.Error("PNG received in UDP rect");
    }

    _basicRect(ctl, x, y, width, height, data, display, depth, frame_id) {
        let zlibs_flags = data[12];
        // Reset streams if the server requests it
        for (let i = 0; i < 4; i++) {
            if ((zlibs_flags >> i) & 1) {
                this._zlibs[i].reset();
                //Log.Debug("Reset zlib stream " + i);
            }
        }

        let filter = data[13];
        let data_index = 14;
        let streamId = ctl & 0x3;
        if (!(ctl & 0x4)) {
            // Implicit CopyFilter
            filter = 0;
            data_index = 13;
        }

        let ret;

        switch (filter) {
            case 0: // CopyFilter
                ret = this._copyFilter(streamId, x, y, width, height,
                    data, display, depth, frame_id, data_index);
                break;
            case 1: // PaletteFilter
                ret = this._paletteFilter(streamId, x, y, width, height,
                    data, display, depth, frame_id);
                break;
            case 2: // GradientFilter
                ret = this._gradientFilter(streamId, x, y, width, height,
                    data, display, depth, frame_id);
                break;
            default:
                throw new Error("Illegal tight filter received (ctl: " +
                    this._filter + ")");
        }

        return ret;
    }

    _copyFilter(streamId, x, y, width, height, data, display, depth, frame_id, data_index=14) {
        const uncompressedSize = width * height * 3;

        if (uncompressedSize === 0) {
            return true;
        }

        if (uncompressedSize < 12) {
            data = data.slice(data_index, data_index + uncompressedSize);
        } else {
            data = this._readData(data, data_index);
            if (data === null) {
                return false;
            }

            this._zlibs[streamId].setInput(data);
            data = this._zlibs[streamId].inflate(uncompressedSize);
            this._zlibs[streamId].setInput(null);
        }

        let rgbx = new Uint8Array(width * height * 4);
        for (let i = 0, j = 0; i < width * height * 4; i += 4, j += 3) {
            rgbx[i] = data[j];
            rgbx[i + 1] = data[j + 1];
            rgbx[i + 2] = data[j + 2];
            rgbx[i + 3] = 255;  // Alpha
        }

        display.blitImage(x, y, width, height, rgbx, 0, frame_id, this._directDraw);

        return true;
    }

    _paletteFilter(streamId, x, y, width, height, data, display, depth, frame_id) {
        const numColors = data[14] + 1;
        const paletteSize = numColors * 3;
        let palette = data.slice(15, 15 + paletteSize);

        const bpp = (numColors <= 2) ? 1 : 8;
        const rowSize = Math.floor((width * bpp + 7) / 8);
        const uncompressedSize = rowSize * height;
        let data_i = 15 + paletteSize;

        if (uncompressedSize === 0) {
            return true;
        }

        if (uncompressedSize < 12) {
            data = data.slice(data_i, data_i + uncompressedSize);
        } else {
            data = this._readData(data, data_i);
            if (data === null) {
                return false;
            }

            this._zlibs[streamId].setInput(data);
            data = this._zlibs[streamId].inflate(uncompressedSize);
            this._zlibs[streamId].setInput(null);
        }

        // Convert indexed (palette based) image data to RGB
        if (numColors == 2) {
            this._monoRect(x, y, width, height, data, palette, display, frame_id);
        } else {
            this._paletteRect(x, y, width, height, data, palette, display, frame_id);
        }

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
                    dest[dp] = palette[sp];
                    dest[dp + 1] = palette[sp + 1];
                    dest[dp + 2] = palette[sp + 2];
                    dest[dp + 3] = 255;
                }
            }

            for (let b = 7; b >= 8 - width % 8; b--) {
                dp = (y * width + x * 8 + 7 - b) * 4;
                sp = (data[y * w + x] >> b & 1) * 3;
                dest[dp] = palette[sp];
                dest[dp + 1] = palette[sp + 1];
                dest[dp + 2] = palette[sp + 2];
                dest[dp + 3] = 255;
            }
        }

        display.blitImage(x, y, width, height, dest, 0, frame_id, this._directDraw);
    }

    _paletteRect(x, y, width, height, data, palette, display, frame_id) {
        // Convert indexed (palette based) image data to RGB
        const dest = this._getScratchBuffer(width * height * 4);
        const total = width * height * 4;
        for (let i = 0, j = 0; i < total; i += 4, j++) {
            const sp = data[j] * 3;
            dest[i] = palette[sp];
            dest[i + 1] = palette[sp + 1];
            dest[i + 2] = palette[sp + 2];
            dest[i + 3] = 255;
        }

        display.blitImage(x, y, width, height, dest, 0, frame_id, this._directDraw);
    }

    _gradientFilter(streamId, x, y, width, height, data, display, depth, frame_id) {
        throw new Error("Gradient filter not implemented");
    }

    _readData(data, len_index = 13) {
        if (data.length < len_index + 2) {
            Log.Error("UDP Decoder, readData, invalid data len")
            return null;
        }


        let i = len_index;
        let byte = data[i++];
        let len = byte & 0x7f;
        // lenth field is variably sized 1 to 3 bytes long
        if (byte & 0x80) {
            byte = data[i++]
            len |= (byte & 0x7f) << 7;
            if (byte & 0x80) {
                byte = data[i++];
                len |= byte << 14;
            }
        }

        //TODO: get rid of me
        if (data.length !== len + i) {
            console.log('Rect of size ' + len + ' with data size ' + data.length + ' index of ' + i);
        }
        

        return data.slice(i);
    }

    _getScratchBuffer(size) {
        if (!this._scratchBuffer || (this._scratchBuffer.length < size)) {
            this._scratchBuffer = new Uint8Array(size);
        }
        return this._scratchBuffer;
    }
}
