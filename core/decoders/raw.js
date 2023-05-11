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

        let data = sock.rQshiftBytes(currHeight * bytesPerLine);

        // Convert data if needed
        if (depth == 8) {
            const newdata = new Uint8Array(pixels * 4);
            for (let i = 0; i < pixels; i++) {
                newdata[i * 4 + 0] = ((data[i] >> 0) & 0x3) * 255 / 3;
                newdata[i * 4 + 1] = ((data[i] >> 2) & 0x3) * 255 / 3;
                newdata[i * 4 + 2] = ((data[i] >> 4) & 0x3) * 255 / 3;
                newdata[i * 4 + 3] = 255;
            }
            data = newdata;
        }

        // Max sure the image is fully opaque
        for (let i = 0; i < pixels; i++) {
            data[i * 4 + 3] = 255;
        }

        display.blitImage(x, curY, width, currHeight, data, 0);
        this._lines -= currHeight;
        if (this._lines > 0) {
            return false;
        }

        return true;
    }
}
