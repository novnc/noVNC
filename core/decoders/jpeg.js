/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2019 The noVNC Authors
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 *
 */

export default class JPEGDecoder {
    constructor() {
        // RealVNC will reuse the quantization tables
        // and Huffman tables, so we need to cache them.
        this._quantTables = [];
        this._huffmanTables = [];
        this._cachedQuantTables = [];
        this._cachedHuffmanTables = [];

        this._jpegLength = 0;
        this._segments = [];
    }

    decodeRect(x, y, width, height, sock, display, depth) {
        // A rect of JPEG encodings is simply a JPEG file
        if (!this._parseJPEG(sock.rQslice(0))) {
            return false;
        }
        const data = sock.rQshiftBytes(this._jpegLength);
        if (this._quantTables.length != 0 && this._huffmanTables.length != 0) {
            // If there are quantization tables and Huffman tables in the JPEG
            // image, we can directly render it.
            display.imageRect(x, y, width, height, "image/jpeg", data);
            return true;
        } else {
            // Otherwise we need to insert cached tables.
            const sofIndex = this._segments.findIndex(
                x => x[1] == 0xC0 || x[1] == 0xC2
            );
            if (sofIndex == -1) {
                throw new Error("Illegal JPEG image without SOF");
            }
            let segments = this._segments.slice(0, sofIndex);
            segments = segments.concat(this._quantTables.length ?
                this._quantTables :
                this._cachedQuantTables);
            segments.push(this._segments[sofIndex]);
            segments = segments.concat(this._huffmanTables.length ?
                this._huffmanTables :
                this._cachedHuffmanTables,
                                       this._segments.slice(sofIndex + 1));
            let length = 0;
            for (let i = 0; i < segments.length; i++) {
                length += segments[i].length;
            }
            const data = new Uint8Array(length);
            length = 0;
            for (let i = 0; i < segments.length; i++) {
                data.set(segments[i], length);
                length += segments[i].length;
            }
            display.imageRect(x, y, width, height, "image/jpeg", data);
            return true;
        }
    }

    _parseJPEG(buffer) {
        if (this._quantTables.length != 0) {
            this._cachedQuantTables = this._quantTables;
        }
        if (this._huffmanTables.length != 0) {
            this._cachedHuffmanTables = this._huffmanTables;
        }
        this._quantTables = [];
        this._huffmanTables = [];
        this._segments = [];
        let i = 0;
        let bufferLength = buffer.length;
        while (true) {
            let j = i;
            if (j + 2 > bufferLength) {
                return false;
            }
            if (buffer[j] != 0xFF) {
                throw new Error("Illegal JPEG marker received (byte: " +
                                   buffer[j] + ")");
            }
            const type = buffer[j+1];
            j += 2;
            if (type == 0xD9) {
                this._jpegLength = j;
                this._segments.push(buffer.slice(i, j));
                return true;
            } else if (type == 0xDA) {
                // start of scan
                let hasFoundEndOfScan = false;
                for (let k = j + 3; k + 1 < bufferLength; k++) {
                    if (buffer[k] == 0xFF && buffer[k+1] != 0x00 &&
                        !(buffer[k+1] >= 0xD0 && buffer[k+1] <= 0xD7)) {
                        j = k;
                        hasFoundEndOfScan = true;
                        break;
                    }
                }
                if (!hasFoundEndOfScan) {
                    return false;
                }
                this._segments.push(buffer.slice(i, j));
                i = j;
                continue;
            } else if (type >= 0xD0 && type < 0xD9 || type == 0x01) {
                // No length after marker
                this._segments.push(buffer.slice(i, j));
                i = j;
                continue;
            }
            if (j + 2 > bufferLength) {
                return false;
            }
            const length = (buffer[j] << 8) + buffer[j+1] - 2;
            if (length < 0) {
                throw new Error("Illegal JPEG length received (length: " +
                                   length + ")");
            }
            j += 2;
            if (j + length > bufferLength) {
                return false;
            }
            j += length;
            const segment = buffer.slice(i, j);
            if (type == 0xC4) {
                // Huffman tables
                this._huffmanTables.push(segment);
            } else if (type == 0xDB) {
                // Quantization tables
                this._quantTables.push(segment);
            }
            this._segments.push(segment);
            i = j;
        }
    }
}
