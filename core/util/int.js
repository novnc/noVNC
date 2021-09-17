/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2020 The noVNC Authors
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 */

export function toUnsigned32bit(toConvert) {
    return toConvert >>> 0;
}

export function toSigned32bit(toConvert) {
    return toConvert | 0;
}

/*
 * Fast hashing function with low entropy, not for security uses.
*/
export function hashUInt8Array(data) {
    let h;
    for (let i = 0; i < data.length; i++) {
        h = Math.imul(31, h) + data[i] | 0;
    }
    return h;
}