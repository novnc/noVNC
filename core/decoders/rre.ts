/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2019 The noVNC Authors
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 *
 */

import Websock from "../websock";
import Display from "../display";

export default class RREDecoder {
    _subrects : number;

    constructor() {
        this._subrects = 0;
    }

    decodeRect(x:number, y:number, width:number, height:number, sock:Websock, display:Display, depth:number) {
        if (this._subrects === 0) {
            if (sock.rQwait("RRE", 4 + 4)) {
                return false;
            }

            this._subrects = sock.rQshift32();

            let color = sock.rQshiftBytes(4);  // Background
            display.fillRect(x, y, width, height, color);
        }

        while (this._subrects > 0) {
            if (sock.rQwait("RRE", 4 + 8)) {
                return false;
            }

            let color = sock.rQshiftBytes(4);
            let sx = sock.rQshift16();
            let sy = sock.rQshift16();
            let swidth = sock.rQshift16();
            let sheight = sock.rQshift16();
            display.fillRect(x + sx, y + sy, swidth, sheight, color);

            this._subrects--;
        }

        return true;
    }
}
