/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2019 The noVNC authors
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 *
 */

export default class RawDecoder {
    constructor() {
        this._lines = 0;
    }

    decodeRect(x, y, width, height, sock, display, depth, pixelFormat) {
        if ((width === 0) || (height === 0)) {
            return true;
        }

        if (this._lines === 0) {
            this._lines = height;
        }

        const pixelSize = depth == 8 ? 1 : (depth == 16 ? 2 : 4); // Modifications
        const bytesPerLine = width * pixelSize;

        while (this._lines > 0) {
            if (sock.rQwait("RAW", bytesPerLine)) {
                return false;
            }

            const curY = y + (height - this._lines);

            let data = sock.rQshiftBytes(bytesPerLine, false);

            // Convert data if needed
            if (depth == 8) {
                const newdata = new Uint8Array(width * 4);
                for (let i = 0; i < width; i++) {
                    newdata[i * 4 + 0] = ((data[i] >> 0) & 0x3) * 255 / 3;
                    newdata[i * 4 + 1] = ((data[i] >> 2) & 0x3) * 255 / 3;
                    newdata[i * 4 + 2] = ((data[i] >> 4) & 0x3) * 255 / 3;
                    newdata[i * 4 + 3] = 255;
                }
                data = newdata;
            } else if (depth == 16) { // Modifications: decode 16bpp raw
                const fmt = pixelFormat || {};
                const redMax = fmt.redMax !== undefined ? fmt.redMax : 31;
                const greenMax = fmt.greenMax !== undefined ? fmt.greenMax : 63;
                const blueMax = fmt.blueMax !== undefined ? fmt.blueMax : 31;
                const redShift = fmt.redShift !== undefined ? fmt.redShift : 11;
                const greenShift = fmt.greenShift !== undefined ? fmt.greenShift : 5;
                const blueShift = fmt.blueShift !== undefined ? fmt.blueShift : 0;
                const bigEndian = !!fmt.bigEndian;

                const newdata = new Uint8Array(width * 4);
                for (let i = 0; i < width; i++) {
                    const idx = i * 2;
                    let pixel;
                    if (bigEndian) {
                        pixel = (data[idx] << 8) | data[idx + 1];
                    } else {
                        pixel = data[idx] | (data[idx + 1] << 8);
                    }

                    const r = (pixel >> redShift) & redMax;
                    const g = (pixel >> greenShift) & greenMax;
                    const b = (pixel >> blueShift) & blueMax;

                    newdata[i * 4 + 0] = redMax ? (r * 255 / redMax) : 0;
                    newdata[i * 4 + 1] = greenMax ? (g * 255 / greenMax) : 0;
                    newdata[i * 4 + 2] = blueMax ? (b * 255 / blueMax) : 0;
                    newdata[i * 4 + 3] = 255;
                }
                data = newdata;
            }

            // Max sure the image is fully opaque
            for (let i = 0; i < width; i++) {
                data[i * 4 + 3] = 255;
            }

            display.blitImage(x, curY, width, 1, data, 0);
            this._lines--;
        }

        return true;
    }
}
