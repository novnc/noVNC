/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2019 The noVNC Authors
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 *
 */

export default class RawDecoder {
    constructor() {
        this._lines = 0;
    }

    decodeRect(x, y, width, height, sock, display, depth) {
        if ((width === 0) || (height === 0)) {
            return true;
        }

        if (this._lines === 0) {
            this._lines = height;
        }

        const pixelSize = depth == 8 ? 1 : 4;
        const bytesPerLine = width * pixelSize;

        if (sock.rQwait("RAW", bytesPerLine)) {
            return false;
        }

        const curY = y + (height - this._lines);
        const currHeight = Math.min(this._lines,
                                    Math.floor(sock.rQlen / bytesPerLine));
        const pixels = width * currHeight;

        let data = sock.rQ;
        let index = sock.rQi;

        // Convert data if needed
        if (depth == 8) {
            const newdata = new Uint8Array(pixels * 4);
            for (let i = 0; i < pixels; i++) {
                newdata[i * 4 + 0] = ((data[index + i] >> 0) & 0x3) * 255 / 3;
                newdata[i * 4 + 1] = ((data[index + i] >> 2) & 0x3) * 255 / 3;
                newdata[i * 4 + 2] = ((data[index + i] >> 4) & 0x3) * 255 / 3;
                newdata[i * 4 + 3] = 255;
            }
            data = newdata;
            index = 0;
        }

        // Max sure the image is fully opaque
        for (let i = 0; i < pixels; i++) {
            data[index + i * 4 + 3] = 255;
        }

        display.blitImage(x, curY, width, currHeight, data, index);
        sock.rQskipBytes(currHeight * bytesPerLine);
        this._lines -= currHeight;
        if (this._lines > 0) {
            return false;
        }

        return true;
    }
}
