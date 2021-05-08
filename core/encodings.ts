/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2019 The noVNC Authors
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 */

export interface Encodings {
    encodingRaw: number,
    encodingCopyRect: number,
    encodingRRE: number,
    encodingHextile: number,
    encodingTight: number,
    encodingTightPNG: number,
    encodingX264: number,
    pseudoEncodingQualityLevel9: number,
    pseudoEncodingQualityLevel0: number,
    pseudoEncodingDesktopSize: number,
    pseudoEncodingLastRect: number,
    pseudoEncodingCursor: number,
    pseudoEncodingQEMUExtendedKeyEvent: number,
    pseudoEncodingDesktopName: number,
    pseudoEncodingExtendedDesktopSize: number,
    pseudoEncodingXvp: number,
    pseudoEncodingFence: number,
    pseudoEncodingContinuousUpdates: number,
    pseudoEncodingCompressLevel9: number,
    pseudoEncodingCompressLevel0: number,
    pseudoEncodingVMwareCursor: number,
    pseudoEncodingExtendedClipboard : number,
}

export const encodings = {
    encodingRaw: 0,
    encodingCopyRect: 1,
    encodingRRE: 2,
    encodingHextile: 5,
    encodingTight: 7,
    encodingTightPNG: -260,
    encodingX264: 0x48323634,

    pseudoEncodingQualityLevel9: -23,
    pseudoEncodingQualityLevel0: -32,
    pseudoEncodingDesktopSize: -223,
    pseudoEncodingLastRect: -224,
    pseudoEncodingCursor: -239,
    pseudoEncodingQEMUExtendedKeyEvent: -258,
    pseudoEncodingDesktopName: -307,
    pseudoEncodingExtendedDesktopSize: -308,
    pseudoEncodingXvp: -309,
    pseudoEncodingFence: -312,
    pseudoEncodingContinuousUpdates: -313,
    pseudoEncodingCompressLevel9: -247,
    pseudoEncodingCompressLevel0: -256,
    pseudoEncodingVMwareCursor: 0x574d5664,
    pseudoEncodingExtendedClipboard: 0xc0a1e5ce
} as Encodings;

export function encodingName(num:number) {
    switch (num) {
        case encodings.encodingRaw:      return "Raw";
        case encodings.encodingCopyRect: return "CopyRect";
        case encodings.encodingRRE:      return "RRE";
        case encodings.encodingHextile:  return "Hextile";
        case encodings.encodingTight:    return "Tight";
        case encodings.encodingTightPNG: return "TightPNG";
        case encodings.encodingX264:     return "h264";
        default:                         return "[unknown encoding " + num + "]";
    }
}
