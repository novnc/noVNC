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
        this._serverName = null;
    }

    decodeRect(x, y, width, height, sock, display, depth, bgrMode = false) {
        // Check if we're connecting to a Virtualization server
        if (!this._serverName && sock._rfb && sock._rfb._fbName) {
            this._serverName = sock._rfb._fbName;
            Log.Info("RawDecoder: Connected to server: " + this._serverName);
        }

        // Special handling for known BGR servers that don't honor pixel format
        const forceSwap = this._serverName === 'Virtualization';

        // Always log if we're using BGR mode or forcing a swap
        if (this._lines === 0) {
            Log.Info("RawDecoder: Processing rectangle with " +
                     (bgrMode ? "BGR" : "RGB") + " mode" + 
                     (forceSwap ? " (FORCING BGR swap for Virtualization server)" : "") +
                     ", depth: " + depth);
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

            // For debugging - show a sample of the data for the first rect
            if (this._lines === height && curY === y) {
                let sample = "";
                for (let i = 0; i < Math.min(16, width); i++) {
                    if (pixelSize === 4) {
                        sample += "[" + data[i*4] + "," + data[i*4+1] + "," + 
                                  data[i*4+2] + "," + data[i*4+3] + "] ";
                    } else {
                        sample += data[i] + " ";
                    }
                }
                Log.Info("RawDecoder: First " + Math.min(16, width) + 
                         " pixels (before processing): " + sample);
            }

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
            } else if (bgrMode || forceSwap) {
                // In bgrMode or when forced we need to switch the red and blue bytes
                // so that the data is in RGB order
                Log.Info("RawDecoder: Applying BGR swap for line " + curY + 
                        (forceSwap ? " (FORCED)" : ""));
                for (let i = 0; i < width; i++) {
                    let j = i * 4;
                    let red = data[j];
                    data[j] = data[j + 2];
                    data[j + 2] = red;
                }
            } else {
                // Make sure the image is fully opaque
                for (let i = 0; i < width; i++) {
                    data[i * 4 + 3] = 255;
                }
            }

            // For debugging - show processed data for the first rect
            if (this._lines === height && curY === y) {
                let sample = "";
                for (let i = 0; i < Math.min(16, width); i++) {
                    sample += "[" + data[i*4] + "," + data[i*4+1] + "," + 
                              data[i*4+2] + "," + data[i*4+3] + "] ";
                }
                Log.Info("RawDecoder: First " + Math.min(16, width) + 
                         " pixels (after processing): " + sample);
            }

            display.blitImage(x, curY, width, 1, data, 0);
            this._lines--;
        }

        return true;
    }
}
