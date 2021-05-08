/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2019 The noVNC Authors
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 *
 */

import TightDecoder from './tight.js';
import Websock from "../websock";
import Display from "../display";

export default class TightPNGDecoder extends TightDecoder {
    _pngRect(x:number, y:number, width:number, height:number, sock:Websock, display:Display, depth:number) {
        let data = this._readData(sock);
        if (data === null) {
            return false;
        }

        display.imageRect(x, y, width, height, "image/png", data);

        return true;
    }

    _basicRect(ctl:number, x:number, y:number, width:number, height:number, sock:Websock, display:Display, depth:number) {
        throw new Error("BasicCompression received in TightPNG rect");
    }
}
