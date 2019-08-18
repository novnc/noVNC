/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2012 Joel Martin
 * Copyright (C) 2018 Samuel Mannehed for Cendio AB
 * Copyright (C) 2018 Pierre Ossman for Cendio AB
 * Copyright (C) 2018 Maxim Furtuna for Skysilk inc.
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 *
 */

import Inflate from "../inflator.js";

const ZRLE_TILE_WIDTH = 64;
const ZRLE_TILE_HEIGHT = 64;


export default class ZRLEDecoder {
    constructor() {
        this._length = 0;
        this._offset = 0;
        this._inflator = new Inflate();

        this._tileBuffer = new Uint8Array(ZRLE_TILE_WIDTH * ZRLE_TILE_HEIGHT * 3);
    }

    decodeRect(x, y, width, height, sock, display, depth) {
        if (this._length === 0) {
            if (sock.rQwait("ZLib data length", 4)) {
                return false;
            }

            this._length = sock.rQshift32();
        }
        if (sock.rQwait("Zlib data", this._length)) {
            return false;
        }
        const data = sock.rQshiftBytes(this._length);

        const tiles_x = Math.ceil(width / ZRLE_TILE_WIDTH);
        const tiles_y = Math.ceil(height / ZRLE_TILE_HEIGHT);
        const total_tiles = tiles_x * tiles_y;

        //this._inflator.reset();
        this._uncompressed = this._inflator.inflate(data, true, width * height * 3 + total_tiles);

        for (let ty = y; ty < y + height; ty += ZRLE_TILE_HEIGHT) {
            let th = Math.min(ZRLE_TILE_HEIGHT, y + height - ty);

            for (let tx = x; tx < x + width; tx += ZRLE_TILE_WIDTH) {
                let tw = Math.min(ZRLE_TILE_WIDTH, x + width - tx);

                const tileSize = tw * th;

                const subencoding = this._uncompressed[this._offset++];
                if (subencoding === 0) {
                    // raw data
                    const data = this._readPixels(tileSize);
                    display.blitBgrImage(tx, ty, tw, th, data, 0, false);

                } else if (subencoding === 1) {
                    // solid
                    const background = this._readPixels(1);
                    display.fillRect(tx, ty, tw, th, [background[2], background[1], background[0]]);

                } else if (subencoding >= 2 && subencoding <= 16) {
                    // palette types
                    const data = this._decodePaletteTile(subencoding, tileSize);
                    display.blitBgrImage(tx, ty, tw, th, data, 0, false);

                } else if (subencoding === 128) {
                    // run-length encoding
                    const data = this._decodeRLETile(tileSize);
                    display.blitBgrImage(tx, ty, tw, th, data, 0, false);

                } else if (subencoding >= 130 && subencoding <= 255) {
                    const data = this._decodeRLEPaletteTile(subencoding - 128, tileSize);
                    display.blitBgrImage(tx, ty, tw, th, data, 0, false);
                } else {
                    throw new Error('Unknown subencoding: ' + subencoding);
                }
            }
        }
        this._uncompressed = null;
        this._length = 0;
        this._offset = 0;
        return true;
    }

    _getBitsPerPixelInPalette(paletteSize) {
        if (paletteSize <= 2) {
            return 1;
        } else if (paletteSize <= 4) {
            return 2;
        } else if (paletteSize <= 16) {
            return 4;
        }
    }

    _readPixels(pixels) {
        const size = pixels * 3;
        const data = new Uint8Array(this._uncompressed.buffer, this._offset, size);
        this._offset += size;
        return data;
    }

    _decodePaletteTile(paletteSize, tileSize) {
        const data = this._tileBuffer;

        // palette
        const palette = this._readPixels(paletteSize);

        const bitsPerPixel = this._getBitsPerPixelInPalette(paletteSize);
        const mask = (1 << bitsPerPixel) - 1;
        const encodedLength = Math.ceil(tileSize * bitsPerPixel / 8);

        let offset = 0;

        for (let j = 0; j < encodedLength; j++) {
            let encoded = this._uncompressed[this._offset];
            for (let i = 0; i < 8; i += bitsPerPixel) {
                const indexInPalette = encoded & mask;
                encoded = encoded >> bitsPerPixel;

                data[offset] = palette[indexInPalette * 3];
                data[offset + 1] = palette[indexInPalette * 3 + 1];
                data[offset + 2] = palette[indexInPalette * 3 + 2];

                offset += 3;
            }
            this._offset++;
        }

        return data;
    }

    _decodeRLETile(tileSize) {
        const data = this._tileBuffer;
        let i = 0;
        while (i < tileSize) {
            const pixel = this._readPixels(1);
            const length = this._readRLELength();
            for (let j = 0; j < length; j++) {
                data[i * 3] = pixel[0];
                data[i * 3 + 1] = pixel[1];
                data[i * 3 + 2] = pixel[2];
                i++;
            }
        }
        return data;
    }

    _decodeRLEPaletteTile(paletteSize, tileSize) {
        const data = this._tileBuffer;

        // palette
        const palette = this._readPixels(paletteSize);

        let offset = 0;
        while (offset < tileSize) {
            let indexInPalette = this._uncompressed[this._offset++];
            let length = 1;
            if (indexInPalette >= 128) {
                indexInPalette -= 128;
                length = this._readRLELength();
            }
            if (indexInPalette > paletteSize) {
                throw new Error('Too big index in palette: ' + indexInPalette + ', palette size: ' + paletteSize);
            }
            if (offset + length > tileSize) {
                throw new Error('Too big rle length in palette mode: ' + length + ', allowed length is: ' + (tileSize - offset));
            }
            for (let j = 0; j < length; j++) {
                data[offset * 3] = palette[indexInPalette * 3];
                data[offset * 3 + 1] = palette[indexInPalette * 3 + 1];
                data[offset * 3 + 2] = palette[indexInPalette * 3 + 2];
                offset++;
            }
            //offset += length;
        }
        return data;
    }

    _readRLELength() {
        let length = 0;
        let current = 0;
        do {
            current = this._uncompressed[this._offset++];
            length += current;
        } while (current === 255);
        return length + 1;
    }
}
