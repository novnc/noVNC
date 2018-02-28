/*
 * noVNC: HTML5 VNC client
 * Copyright 2018 Pierre Ossman for noVNC
 * Licensed under MPL 2.0 or any later version (see LICENSE.txt)
 */

function Cursor(container) {
    this._target = null;
}

Cursor.prototype = {
    attach: function (target) {
        if (this._target) {
            this.detach();
        }

        this._target = target;

        this.clear();
    },

    detach: function () {
        this._target = null;
    },

    change: function (pixels, mask, hotx, hoty, w, h) {
        if ((w === 0) || (h === 0)) {
            this.clear();
            return;
        }

        let cur = []
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                let idx = y * Math.ceil(w / 8) + Math.floor(x / 8);
                let alpha = (mask[idx] << (x % 8)) & 0x80 ? 255 : 0;
                idx = ((w * y) + x) * 4;
                cur.push(pixels[idx + 2]); // red
                cur.push(pixels[idx + 1]); // green
                cur.push(pixels[idx]);     // blue
                cur.push(alpha);           // alpha
            }
        }

        let canvas = document.createElement('canvas');
        let ctx = canvas.getContext('2d');

        canvas.width = w;
        canvas.height = h;

        let img;
        try {
            // IE doesn't support this
            img = new ImageData(new Uint8ClampedArray(cur), w, h);
        } catch (ex) {
            img = ctx.createImageData(w, h);
            img.data.set(new Uint8ClampedArray(cur));
        }
        ctx.clearRect(0, 0, w, h);
        ctx.putImageData(img, 0, 0);

        let url = this._canvas.toDataURL();
        this._target.style.cursor = 'url(' + url + ')' + hotx + ' ' + hoty + ', default';
    },

    clear: function () {
        this._target.style.cursor = 'none';
    },
};

export default Cursor;
