/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2012 Joel Martin
 * Copyright (C) 2018 Samuel Mannehed for Cendio AB
 * Copyright (C) 2018 Pierre Ossman for Cendio AB
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
        if (this._lines === 0) {
            this._lines = height;
        }

        const pixelSize = depth == 8 ? 1 : 4;
        const bytesPerLine = width * pixelSize;

        if (sock.rQwait("RAW", bytesPerLine)) {
            return false;
        }

        const cur_y = y + (height - this._lines);
        const curr_height = Math.min(this._lines,
                                     Math.floor(sock.rQlen / bytesPerLine));
        let data = sock.rQ;
        let index = sock.rQi;

        // Convert data if needed
        if (depth == 8) {
            const pixels = width * curr_height;
            const newdata = new Uint8Array(pixels * 4);
            for (let i = 0; i < pixels; i++) {
                newdata[i * 4 + 0] = ((data[index + i] >> 0) & 0x3) * 255 / 3;
                newdata[i * 4 + 1] = ((data[index + i] >> 2) & 0x3) * 255 / 3;
                newdata[i * 4 + 2] = ((data[index + i] >> 4) & 0x3) * 255 / 3;
                newdata[i * 4 + 4] = 0;
            }
            data = newdata;
            index = 0;
        }

        display.blitImage(x, cur_y, width, curr_height, data, index);
        sock.rQskipBytes(curr_height * bytesPerLine);
        this._lines -= curr_height;
        if (this._lines > 0) {
            return false;
        }

        return true;
    }
}
