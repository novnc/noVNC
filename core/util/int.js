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
* Converts a signed 32bit integer to a signed 16bit int
* Uses second most significant bit to represent it is relative
*/
export function toSignedRelative16bit(toConvert) {
    // TODO: move these so they are not computed with every func call
    var negmask16 = 1 << 15;
    var negmask32 = 1 << 31;
    var relmask16 = 1 << 14;

    var converted16 = toConvert | 0;

    // number is negative
    if ((toConvert & negmask32) != 0) {
        // clear the 32bit negative bit
        // not neccessary because the last 16bits will get dropped anyway
        converted16 *= -1;
        
        // set the 16bit negative bit
        converted16 |= negmask16;
        // set the relative bit
        converted16 |= relmask16;
    } else {
        // set the relative bit
        converted16 |= relmask16;
    }

    return converted16;
}

/* Fast hashing function with low entropy  */
export function hashUInt8Array(data) {
    if (typeof data === "string") {
        data = [...data].map(character => character.charCodeAt(0));
    }

    let h = 0;

    for (let i = 0; i < data.length; i++) {
        h = Math.imul(31, h) + data[i] | 0;
    }

    return h;
}
