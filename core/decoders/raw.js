/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2019 The noVNC authors
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 *
 */

import * as Log from '../util/logging.js';

export default class RawDecoder {
    constructor() {
        this._lines = 0;
    }

    decodeRect(x, y, width, height, sock, display, depth, bgrMode = false) {
        // Always log BGR mode to confirm it's being used
        if (this._lines === 0) {
            Log.Info("RawDecoder: Processing rectangle with " +
                     (bgrMode ? "BGR" : "RGB") + " mode, depth: " + depth);
        }

        if ((width === 0) || (height === 0)) {
            return true;
        }

        if (this._lines === 0) {
            this._lines = height;
        }

        const pixelSize = depth == 8 ? 1 : 4;
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
            } else if (bgrMode) {
                // Log when we're performing BGR swap
                if (curY === y) {
                    Log.Info("RawDecoder: Applying BGR swap for line " + curY);
                    
                    // Log sample data before swap
                    let beforeSample = "";
                    for (let i = 0; i < Math.min(4, width); i++) {
                        beforeSample += "[" + data[i*4] + "," + data[i*4+1] + "," + 
                                   data[i*4+2] + "] ";
                    }
                    Log.Info("Before swap sample: " + beforeSample);
                }
                
                // In bgrMode we need to switch the red and blue bytes
                for (let i = 0; i < width; i++) {
                    let j = i * 4;
                    let red = data[j];
                    data[j] = data[j + 2];
                    data[j + 2] = red;
                }
                
                // Log sample data after swap for the first line
                if (curY === y) {
                    let afterSample = "";
                    for (let i = 0; i < Math.min(4, width); i++) {
                        afterSample += "[" + data[i*4] + "," + data[i*4+1] + "," + 
                                  data[i*4+2] + "] ";
                    }
                    Log.Info("After swap sample: " + afterSample);
                }
            } else {
                // Make sure the image is fully opaque
                for (let i = 0; i < width; i++) {
                    data[i * 4 + 3] = 255;
                }
            }

            display.blitImage(x, curY, width, 1, data, 0);
            this._lines--;
        }

        return true;
    }
}
