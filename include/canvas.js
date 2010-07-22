/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2010 Joel Martin
 * Licensed under LGPL-3 (see LICENSE.LGPL-3)
 *
 * See README.md for usage and integration instructions.
 */

"use strict";
/*jslint white: false, bitwise: false */
/*global window, $, Util */

var Canvas, Canvas_native;

(function () {
    var pre, start = "<script src='", end = "'><\/script>";
    if (document.createElement('canvas').getContext) {
        Canvas_native = true;
    } else {
        pre = (typeof VNC_uri_prefix !== "undefined") ?
                            VNC_uri_prefix : "include/";
        //document.write(start + pre + "excanvas.js" + end);
        Canvas_native = false;
    }
}());

// Everything namespaced inside Canvas
Canvas = {

prefer_js    : false, // make private
force_canvas : false, // make private
cursor_uri   : true,  // make private

true_color : false,
colourMap  : [],

c_wx : 0,
c_wy : 0,
ctx  : null,

prevStyle: "",

focused     : true,
keyPress    : null,
mouseButton : null,
mouseMove   : null,

onMouseButton: function(e, down) {
    var evt, pos, bmask;
    if (! Canvas.focused) {
        return true;
    }
    evt = (e ? e : window.event);
    pos = Util.getEventPosition(e, $(Canvas.id));
    bmask = 1 << evt.button;
    //Util.Debug('mouse ' + pos.x + "," + pos.y + " down: " + down + " bmask: " + bmask);
    if (Canvas.mouseButton) {
        Canvas.mouseButton(pos.x, pos.y, down, bmask);
    }
    Util.stopEvent(e);
    return false;
},

onMouseDown: function (e) {
    Canvas.onMouseButton(e, 1);
},

onMouseUp: function (e) {
    Canvas.onMouseButton(e, 0);
},

onMouseWheel: function (e) {
    var evt, pos, bmask, wheelData;
    evt = (e ? e : window.event);
    pos = Util.getEventPosition(e, $(Canvas.id));
    wheelData = evt.detail ? evt.detail * -1 : evt.wheelDelta / 40;
    if (wheelData > 0) {
        bmask = 1 << 3;
    } else {
        bmask = 1 << 4;
    }
    //Util.Debug('mouse scroll by ' + wheelData + ':' + pos.x + "," + pos.y);
    if (Canvas.mouseButton) {
        Canvas.mouseButton(pos.x, pos.y, 1, bmask);
        Canvas.mouseButton(pos.x, pos.y, 0, bmask);
    }
    Util.stopEvent(e);
    return false;
},


onMouseMove: function (e) {
    var evt, pos;
    evt = (e ? e : window.event);
    pos = Util.getEventPosition(e, $(Canvas.id));
    //Util.Debug('mouse ' + evt.which + '/' + evt.button + ' up:' + pos.x + "," + pos.y);
    if (Canvas.mouseMove) {
        Canvas.mouseMove(pos.x, pos.y);
    }
},

onKeyDown: function (e) {
    //Util.Debug("keydown: " + Canvas.getKeysym(e));
    if (! Canvas.focused) {
        return true;
    }
    if (Canvas.keyPress) {
        Canvas.keyPress(Canvas.getKeysym(e), 1);
    }
    Util.stopEvent(e);
    return false;
},

onKeyUp : function (e) {
    //Util.Debug("keyup: " + Canvas.getKeysym(e));
    if (! Canvas.focused) {
        return true;
    }
    if (Canvas.keyPress) {
        Canvas.keyPress(Canvas.getKeysym(e), 0);
    }
    Util.stopEvent(e);
    return false;
},

onMouseDisable: function (e) {
    var evt, pos;
    if (! Canvas.focused) {
        return true;
    }
    evt = (e ? e : window.event);
    pos = Util.getPosition($(Canvas.id));
    /* Stop propagation if inside canvas area */
    if ((evt.clientX >= pos.x) &&
        (evt.clientY >= pos.y) &&
        (evt.clientX < (pos.x + Canvas.c_wx)) &&
        (evt.clientY < (pos.y + Canvas.c_wy))) {
        //Util.Debug("mouse event disabled");
        Util.stopEvent(e);
        return false;
    }
    //Util.Debug("mouse event not disabled");
    return true;
},


init: function (id) {
    var c, imgTest, tval, i, curTest, curSave;
    Util.Debug(">> Canvas.init");

    Canvas.id = id;
    c = $(Canvas.id);

    if (Canvas_native) {
        Util.Info("Using native canvas");
        // Use default Canvas functions
    } else {
        Util.Warn("Using excanvas canvas emulation");
        //G_vmlCanvasManager.init(c);
        //G_vmlCanvasManager.initElement(c);
    }

    if (! c.getContext) { throw("No getContext method"); }
    Canvas.ctx = c.getContext('2d'); 

    Canvas.clear();

    /*
     * Determine browser Canvas feature support
     * and select fastest rendering methods
     */
    tval = 0;
    Canvas.has_imageData = false;
    try {
        imgTest = Canvas.ctx.getImageData(0, 0, 1,1);
        imgTest.data[0] = 123;
        imgTest.data[3] = 255;
        Canvas.ctx.putImageData(imgTest, 0, 0);
        tval = Canvas.ctx.getImageData(0, 0, 1, 1).data[0];
        if (tval === 123) {
            Canvas.has_imageData = true;
        }
    } catch (exc) {}

    if (Canvas.has_imageData) {
        Util.Info("Canvas supports imageData");
        Canvas.force_canvas = false;
        if (Canvas.ctx.createImageData) {
            // If it's there, it's faster
            Util.Info("Using Canvas createImageData");
            Canvas._imageData = Canvas._imageDataCreate;
        } else if (Canvas.ctx.getImageData) {
            Util.Info("Using Canvas getImageData");
            Canvas._imageData = Canvas._imageDataGet;
        }
        Util.Info("Prefering javascript operations");
        Canvas.prefer_js = true;
        Canvas._rgbxImage = Canvas._rgbxImageData;
        Canvas._cmapImage = Canvas._cmapImageData;
    } else {
        Util.Warn("Canvas lacks imageData, using fillRect (slow)");
        Canvas.force_canvas = true;
        Canvas.prefer_js = false;
        Canvas._rgbxImage = Canvas._rgbxImageFill;
        Canvas._cmapImage = Canvas._cmapImageFill;
    }

    /*
     * Determine browser support for setting the cursor via data URI
     * scheme
     */
    curDat = [];
    for (i=0; i < 8 * 8 * 4; i++) {
        curDat.push(255);
    }
    curSave = c.style.cursor;
    Canvas.changeCursor(curDat, curDat, 2, 2, 8, 8);
    if (c.style.cursor) {
        Util.Info("Data URI scheme cursor supported");
    } else {
        Canvas.cursor_uri = false;
        Util.Warn("Data URI scheme cursor not supported");
    }
    c.style.cursor = curSave;


    Canvas.colourMap = [];
    Canvas.prevStyle = "";
    Canvas.focused = true;

    Util.Debug("<< Canvas.init");
    return true;
},
    

start: function (keyPress, mouseButton, mouseMove) {
    var c;
    Util.Debug(">> Canvas.start");

    c = $(Canvas.id);
    Canvas.keyPress = keyPress || null;
    Canvas.mouseButton = mouseButton || null;
    Canvas.mouseMove = mouseMove || null;

    Util.addEvent(document, 'keydown', Canvas.onKeyDown);
    Util.addEvent(document, 'keyup', Canvas.onKeyUp);
    Util.addEvent(c, 'mousedown', Canvas.onMouseDown);
    Util.addEvent(c, 'mouseup', Canvas.onMouseUp);
    Util.addEvent(c, 'mousemove', Canvas.onMouseMove);
    Util.addEvent(c, (Util.Engine.gecko) ? 'DOMMouseScroll' : 'mousewheel',
            Canvas.onMouseWheel);

    /* Work around right and middle click browser behaviors */
    Util.addEvent(document, 'click', Canvas.onMouseDisable);
    Util.addEvent(document.body, 'contextmenu', Canvas.onMouseDisable);

    Util.Debug("<< Canvas.start");
},

clear: function () {
    Canvas.resize(640, 20);
    Canvas.ctx.clearRect(0, 0, Canvas.c_wx, Canvas.c_wy);
},

resize: function (width, height, true_color) {
    var c = $(Canvas.id);

    if (typeof true_color !== "undefined") {
        Canvas.true_color = true_color;
    }

    c.width = width;
    c.height = height;

    Canvas.c_wx = c.offsetWidth;
    Canvas.c_wy = c.offsetHeight;
},

stop: function () {
    var c = $(Canvas.id);
    Util.removeEvent(document, 'keydown', Canvas.onKeyDown);
    Util.removeEvent(document, 'keyup', Canvas.onKeyUp);
    Util.removeEvent(c, 'mousedown', Canvas.onMouseDown);
    Util.removeEvent(c, 'mouseup', Canvas.onMouseUp);
    Util.removeEvent(c, 'mousemove', Canvas.onMouseMove);
    Util.removeEvent(c, (Util.Engine.gecko) ? 'DOMMouseScroll' : 'mousewheel',
            Canvas.onMouseWheel);

    /* Work around right and middle click browser behaviors */
    Util.removeEvent(document, 'click', Canvas.onMouseDisable);
    Util.removeEvent(document.body, 'contextmenu', Canvas.onMouseDisable);

    // Turn off cursor rendering
    if (Canvas.cursor_uri) {
        c.style.cursor = "default";
    }
},

/*
 * Tile rendering functions optimized for rendering engines.
 *
 * - In Chrome/webkit, Javascript image data array manipulations are
 *   faster than direct Canvas fillStyle, fillRect rendering. In
 *   gecko, Javascript array handling is much slower.
 */
getTile: function(x, y, width, height, color) {
    var img, data, p, rgb, red, green, blue, j, i;
    img = {'x': x, 'y': y, 'width': width, 'height': height,
           'data': []};
    if (Canvas.prefer_js) {
        data = img.data;
        if (Canvas.true_color) {
            rgb = color;
        } else {
            rgb = Canvas.colourMap[color[0]];
        }
        red = rgb[0];
        green = rgb[1];
        blue = rgb[2];
        for (j = 0; j < height; j += 1) {
            for (i = 0; i < width; i += 1) {
                p = (i + (j * width) ) * 4;
                data[p + 0] = red;
                data[p + 1] = green;
                data[p + 2] = blue;
                //data[p + 3] = 255; // Set Alpha
            }   
        } 
    } else {
        Canvas.fillRect(x, y, width, height, color);
    }
    return img;
},

setSubTile: function(img, x, y, w, h, color) {
    var data, p, rgb, red, green, blue, width, j, i;
    if (Canvas.prefer_js) {
        data = img.data;
        width = img.width;
        if (Canvas.true_color) {
            rgb = color;
        } else {
            rgb = Canvas.colourMap[color[0]];
        }
        red = rgb[0];
        green = rgb[1];
        blue = rgb[2];
        for (j = 0; j < h; j += 1) {
            for (i = 0; i < w; i += 1) {
                p = (x + i + ((y + j) * width) ) * 4;
                data[p + 0] = red;
                data[p + 1] = green;
                data[p + 2] = blue;
                //img.data[p + 3] = 255; // Set Alpha
            }   
        } 
    } else {
        Canvas.fillRect(img.x + x, img.y + y, w, h, color);
    }
},

putTile: function(img) {
    if (Canvas.prefer_js) {
        Canvas._rgbxImage(img.x, img.y, img.width, img.height, img.data, 0);
    } else {
        // No-op, under gecko already done by setSubTile
    }
},

_imageDataGet: function(width, height) {
    return Canvas.ctx.getImageData(0, 0, width, height);
},
_imageDataCreate: function(width, height) {
    return Canvas.ctx.createImageData(width, height);
},
_imageDataRaw: function(width, height) {
    return {'data': [], 'width': width, 'height': height};
},

_rgbxImageData: function(x, y, width, height, arr, offset) {
    var img, i, j, data;
    img = Canvas._imageData(width, height);
    data = img.data;
    for (i=0, j=offset; i < (width * height * 4); i=i+4, j=j+4) {
        data[i + 0] = arr[j + 0];
        data[i + 1] = arr[j + 1];
        data[i + 2] = arr[j + 2];
        data[i + 3] = 255; // Set Alpha
    }
    Canvas.ctx.putImageData(img, x, y);
},

// really slow fallback if we don't have imageData
_rgbxImageFill: function(x, y, width, height, arr, offset) {
    var sx = 0, sy = 0;
    for (i=0, j=offset; i < (width * height); i+=1, j+=4) {
        Canvas.fillRect(x+sx, y+sy, 1, 1, [arr[j+0], arr[j+1], arr[j+2]]);
        sx += 1;
        if ((sx % width) === 0) {
            sx = 0;
            sy += 1;
        }
    }
},

_cmapImageData: function(x, y, width, height, arr, offset) {
    var img, i, j, data, rgb, cmap;
    img = Canvas._imageData(width, height);
    data = img.data;
    cmap = Canvas.colourMap;
    for (i=0, j=offset; i < (width * height * 4); i+=4, j+=1) {
        rgb = cmap[arr[j]];
        data[i + 0] = rgb[0];
        data[i + 1] = rgb[1];
        data[i + 2] = rgb[2];
        data[i + 3] = 255; // Set Alpha
    }
    Canvas.ctx.putImageData(img, x, y);
},

_cmapImageFill: function(x, y, width, height, arr, offset) {
    var sx = 0, sy = 0;
    cmap = Canvas.colourMap;
    for (i=0, j=offset; i < (width * height); i+=1, j+=1) {
        Canvas.fillRect(x+sx, y+sy, 1, 1, [arr[j]]);
        sx += 1;
        if ((sx % width) === 0) {
            sx = 0;
            sy += 1;
        }
    }
},


blitImage: function(x, y, width, height, arr, offset) {
    if (Canvas.true_color) {
        Canvas._rgbxImage(x, y, width, height, arr, offset);
    } else {
        Canvas._cmapImage(x, y, width, height, arr, offset);
    }
},

blitStringImage: function(str, x, y) {
    var img = new Image();
    img.onload = function () { Canvas.ctx.drawImage(img, x, y); };
    img.src = str;
},

setFillColor: function(color) {
    var rgb, newStyle;
    if (Canvas.true_color) {
        rgb = color;
    } else {
        rgb = Canvas.colourMap[color[0]];
    }
    if (newStyle !== Canvas.prevStyle) {
        newStyle = "rgb(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ")";
        Canvas.ctx.fillStyle = newStyle;
        Canvas.prevStyle = newStyle;
    }
},

fillRect: function(x, y, width, height, color) {
    Canvas.setFillColor(color);
    Canvas.ctx.fillRect(x, y, width, height);
},

copyImage: function(old_x, old_y, new_x, new_y, width, height) {
    Canvas.ctx.drawImage($(Canvas.id), old_x, old_y, width, height,
                                       new_x, new_y, width, height);
},

/* Translate DOM key event to keysym value */
getKeysym: function(e) {
    var evt, keysym;
    evt = (e ? e : window.event);

    /* Remap modifier and special keys */
    switch ( evt.keyCode ) {
        case 8         : keysym = 0xFF08; break; // BACKSPACE
        case 9         : keysym = 0xFF09; break; // TAB
        case 13        : keysym = 0xFF0D; break; // ENTER
        case 27        : keysym = 0xFF1B; break; // ESCAPE
        case 45        : keysym = 0xFF63; break; // INSERT
        case 46        : keysym = 0xFFFF; break; // DELETE
        case 36        : keysym = 0xFF50; break; // HOME
        case 35        : keysym = 0xFF57; break; // END
        case 33        : keysym = 0xFF55; break; // PAGE_UP
        case 34        : keysym = 0xFF56; break; // PAGE_DOWN
        case 37        : keysym = 0xFF51; break; // LEFT
        case 38        : keysym = 0xFF52; break; // UP
        case 39        : keysym = 0xFF53; break; // RIGHT
        case 40        : keysym = 0xFF54; break; // DOWN
        case 112       : keysym = 0xFFBE; break; // F1
        case 113       : keysym = 0xFFBF; break; // F2
        case 114       : keysym = 0xFFC0; break; // F3
        case 115       : keysym = 0xFFC1; break; // F4
        case 116       : keysym = 0xFFC2; break; // F5
        case 117       : keysym = 0xFFC3; break; // F6
        case 118       : keysym = 0xFFC4; break; // F7
        case 119       : keysym = 0xFFC5; break; // F8
        case 120       : keysym = 0xFFC6; break; // F9
        case 121       : keysym = 0xFFC7; break; // F10
        case 122       : keysym = 0xFFC8; break; // F11
        case 123       : keysym = 0xFFC9; break; // F12
        case 16        : keysym = 0xFFE1; break; // SHIFT
        case 17        : keysym = 0xFFE3; break; // CONTROL
        //case 18        : keysym = 0xFFE7; break; // Left Meta (Mac Option)
        case 18        : keysym = 0xFFE9; break; // Left ALT (Mac Command)
        default        : keysym = evt.keyCode; break;
    }

    /* Remap symbols */
    switch (keysym) {
        case 186       : keysym = 59; break; // ;  (IE)
        case 187       : keysym = 61; break; // =  (IE)
        case 188       : keysym = 44; break; // ,  (Mozilla, IE)
        case 109       :                     // -  (Mozilla)
            if (Util.Engine.gecko) {
                         keysym = 45; }
                                      break;
        case 189       : keysym = 45; break; // -  (IE)
        case 190       : keysym = 46; break; // .  (Mozilla, IE)
        case 191       : keysym = 47; break; // /  (Mozilla, IE)
        case 192       : keysym = 96; break; // `  (Mozilla, IE)
        case 219       : keysym = 91; break; // [  (Mozilla, IE)
        case 220       : keysym = 92; break; // \  (Mozilla, IE)
        case 221       : keysym = 93; break; // ]  (Mozilla, IE)
        case 222       : keysym = 39; break; // '  (Mozilla, IE)
    }
    
    /* Remap shifted and unshifted keys */
    if (!!evt.shiftKey) {
        switch (keysym) {
            case 48        : keysym = 41 ; break; // )  (shifted 0)
            case 49        : keysym = 33 ; break; // !  (shifted 1)
            case 50        : keysym = 64 ; break; // @  (shifted 2)
            case 51        : keysym = 35 ; break; // #  (shifted 3)
            case 52        : keysym = 36 ; break; // $  (shifted 4)
            case 53        : keysym = 37 ; break; // %  (shifted 5)
            case 54        : keysym = 94 ; break; // ^  (shifted 6)
            case 55        : keysym = 38 ; break; // &  (shifted 7)
            case 56        : keysym = 42 ; break; // *  (shifted 8)
            case 57        : keysym = 40 ; break; // (  (shifted 9)

            case 59        : keysym = 58 ; break; // :  (shifted `)
            case 61        : keysym = 43 ; break; // +  (shifted ;)
            case 44        : keysym = 60 ; break; // <  (shifted ,)
            case 45        : keysym = 95 ; break; // _  (shifted -)
            case 46        : keysym = 62 ; break; // >  (shifted .)
            case 47        : keysym = 63 ; break; // ?  (shifted /)
            case 96        : keysym = 126; break; // ~  (shifted `)
            case 91        : keysym = 123; break; // {  (shifted [)
            case 92        : keysym = 124; break; // |  (shifted \)
            case 93        : keysym = 125; break; // }  (shifted ])
            case 39        : keysym = 34 ; break; // "  (shifted ')
        }
    } else if ((keysym >= 65) && (keysym <=90)) {
        /* Remap unshifted A-Z */
        keysym += 32;
    } 

    return keysym;
},


isCursor: function() {
    return Canvas.cursor_uri;
},
changeCursor: function(pixels, mask, hotx, hoty, w, h) {
    var cur = [], cmap, IHDRsz, ANDsz, XORsz, url, idx, x, y;
    //Util.Debug(">> changeCursor, x: " + hotx + ", y: " + hoty + ", w: " + w + ", h: " + h);
    
    if (!Canvas.cursor_uri) {
        Util.Warn("changeCursor called but no cursor data URI support");
        return;
    }

    cmap = Canvas.colourMap;
    IHDRsz = 40;
    ANDsz = w * h * 4;
    XORsz = Math.ceil( (w * h) / 8.0 );

    // Main header
    cur.push16le(0);      // Reserved
    cur.push16le(2);      // .CUR type
    cur.push16le(1);      // Number of images, 1 for non-animated ico

    // Cursor #1 header
    cur.push(w);          // width
    cur.push(h);          // height
    cur.push(0);          // colors, 0 -> true-color
    cur.push(0);          // reserved
    cur.push16le(hotx);   // hotspot x coordinate
    cur.push16le(hoty);   // hotspot y coordinate
    cur.push32le(IHDRsz + XORsz + ANDsz); // cursor data byte size
    cur.push32le(22);     // offset of cursor data in the file

    // Cursor #1 InfoHeader
    cur.push32le(IHDRsz); // Infoheader size
    cur.push32le(w);      // Cursor width
    cur.push32le(h*2);    // XOR+AND height
    cur.push16le(1);      // number of planes
    cur.push16le(32);     // bits per pixel
    cur.push32le(0);      // Type of compression
    cur.push32le(XORsz + ANDsz); // Size of Image
    cur.push32le(0);
    cur.push32le(0);
    cur.push32le(0);
    cur.push32le(0);

    // XOR/color data
    for (y = h-1; y >= 0; y--) {
        for (x = 0; x < w; x++) {
            idx = y * Math.ceil(w / 8) + Math.floor(x/8);
            alpha = (mask[idx] << (x % 8)) & 0x80 ? 255 : 0;

            if (Canvas.true_color) {
                idx = ((w * y) + x) * 4;
                cur.push(pixels[idx + 2]); // blue
                cur.push(pixels[idx + 1]); // green
                cur.push(pixels[idx + 0]); // red
                cur.push(alpha); // red
            } else {
                idx = (w * y) + x;
                rgb = cmap[pixels[idx]];
                cur.push(rgb[2]);          // blue
                cur.push(rgb[1]);          // green
                cur.push(rgb[0]);          // red
                cur.push(alpha);           // alpha
            }
        }
    }

    // AND/bitmask data (ignored, just needs to be right size)
    for (y = 0; y < h; y++) {
        for (x = 0; x < Math.ceil(w / 8); x++) {
            cur.push(0x00);
        }
    }

    url = "data:image/x-icon;base64," + Base64.encode(cur);
    $(Canvas.id).style.cursor = "url(" + url + ") " + hotx + " " + hoty + ", default";
    //Util.Debug("<< changeCursor, cur.length: " + cur.length);
}

};

