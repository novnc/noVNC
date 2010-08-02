/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2010 Joel Martin
 * Licensed under LGPL-3 (see LICENSE.LGPL-3)
 *
 * See README.md for usage and integration instructions.
 */

"use strict";
/*jslint browser: true, white: false, bitwise: false */
/*global window, Util, Base64 */

function Canvas(conf) {

conf               = conf || {}; // Configuration
var that           = {},         // Public API interface

    // Pre-declare functions used before definitions (jslint)jslint
    setFillColor, fillRect,

    // Private Canvas namespace variables
    c_forceCanvas = false,

    c_width        = 0,
    c_height       = 0,

    c_prevStyle    = "",

    c_keyPress     = null,
    c_mouseButton  = null,
    c_mouseMove    = null;


// Capability settings, default can be overridden
Util.conf_default(conf, that, 'prefer_js', null);
Util.conf_default(conf, that, 'cursor_uri', null);

// Configuration settings
Util.conf_default(conf, that, 'target', null);
Util.conf_default(conf, that, 'true_color', true);
Util.conf_default(conf, that, 'focused', true);
Util.conf_default(conf, that, 'colourMap', []);
Util.conf_default(conf, that, 'scale', 1);

// Override some specific getters/setters
that.set_prefer_js = function(val) {
    if (val && c_forceCanvas) {
        Util.Warn("Preferring Javascript to Canvas ops is not supported");
        return false;
    }
    conf.prefer_js = val;
    return true;
};

that.get_colourMap = function(idx) {
    if (typeof idx === 'undefined') {
        return conf.colourMap;
    } else {
        return conf.colourMap[idx];
    }
};

that.set_colourMap = function(val, idx) {
    if (typeof idx === 'undefined') {
        conf.colourMap = val;
    } else {
        conf.colourMap[idx] = val;
    }
};

// Add some other getters/setters
that.get_width = function() {
    return c_width;
};
that.get_height = function() {
    return c_height;
};



//
// Private functions
//

// Create the public API interface
function constructor() {
    Util.Debug(">> Canvas.init");

    var c, ctx, imgTest, tval, i, curDat, curSave,
        has_imageData = false;

    if (! conf.target) { throw("target must be set"); }

    if (typeof conf.target === 'string') {
        conf.target = window.$(conf.target);
    }

    c = conf.target;

    if (! c.getContext) { throw("no getContext method"); }

    if (! conf.ctx) { conf.ctx = c.getContext('2d'); }
    ctx = conf.ctx;

    that.clear();

    /*
     * Determine browser Canvas feature support
     * and select fastest rendering methods
     */
    tval = 0;
    try {
        imgTest = ctx.getImageData(0, 0, 1,1);
        imgTest.data[0] = 123;
        imgTest.data[3] = 255;
        ctx.putImageData(imgTest, 0, 0);
        tval = ctx.getImageData(0, 0, 1, 1).data[0];
        if (tval === 123) {
            has_imageData = true;
        }
    } catch (exc1) {}

    if (has_imageData) {
        Util.Info("Canvas supports imageData");
        c_forceCanvas = false;
        if (ctx.createImageData) {
            // If it's there, it's faster
            Util.Info("Using Canvas createImageData");
            that.imageData = that.imageDataCreate;
        } else if (ctx.getImageData) {
            Util.Info("Using Canvas getImageData");
            that.imageData = that.imageDataGet;
        }
        Util.Info("Prefering javascript operations");
        if (conf.prefer_js === null) {
            conf.prefer_js = true;
        }
        that.rgbxImage = that.rgbxImageData;
        that.cmapImage = that.cmapImageData;
    } else {
        Util.Warn("Canvas lacks imageData, using fillRect (slow)");
        c_forceCanvas = true;
        conf.prefer_js = false;
        that.rgbxImage = that.rgbxImageFill;
        that.cmapImage = that.cmapImageFill;
    }

    /*
     * Determine browser support for setting the cursor via data URI
     * scheme
     */
    curDat = [];
    for (i=0; i < 8 * 8 * 4; i += 1) {
        curDat.push(255);
    }
    try {
        curSave = c.style.cursor;
        that.changeCursor(curDat, curDat, 2, 2, 8, 8);
        if (c.style.cursor) {
            if (conf.cursor_uri === null) {
                conf.cursor_uri = true;
            }
            Util.Info("Data URI scheme cursor supported");
        } else {
            if (conf.cursor_uri === null) {
                conf.cursor_uri = false;
            }
            Util.Warn("Data URI scheme cursor not supported");
        }
        c.style.cursor = curSave;
    } catch (exc2) { 
        Util.Error("Data URI scheme cursor test exception: " + exc2);
        conf.cursor_uri = false;
    }

    conf.focused = true;

    Util.Debug("<< Canvas.init");
    return that ;
}

/* Translate DOM key event to keysym value */
function getKeysym(e) {
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
}

function onMouseButton(e, down) {
    var evt, pos, bmask;
    if (! conf.focused) {
        return true;
    }
    evt = (e ? e : window.event);
    pos = Util.getEventPosition(e, conf.target, conf.scale);
    bmask = 1 << evt.button;
    //Util.Debug('mouse ' + pos.x + "," + pos.y + " down: " + down + " bmask: " + bmask);
    if (c_mouseButton) {
        c_mouseButton(pos.x, pos.y, down, bmask);
    }
    Util.stopEvent(e);
    return false;
}

function onMouseDown(e) {
    onMouseButton(e, 1);
}

function onMouseUp(e) {
    onMouseButton(e, 0);
}

function onMouseWheel(e) {
    var evt, pos, bmask, wheelData;
    evt = (e ? e : window.event);
    pos = Util.getEventPosition(e, conf.target, conf.scale);
    wheelData = evt.detail ? evt.detail * -1 : evt.wheelDelta / 40;
    if (wheelData > 0) {
        bmask = 1 << 3;
    } else {
        bmask = 1 << 4;
    }
    //Util.Debug('mouse scroll by ' + wheelData + ':' + pos.x + "," + pos.y);
    if (c_mouseButton) {
        c_mouseButton(pos.x, pos.y, 1, bmask);
        c_mouseButton(pos.x, pos.y, 0, bmask);
    }
    Util.stopEvent(e);
    return false;
}

function onMouseMove(e) {
    var evt, pos;
    evt = (e ? e : window.event);
    pos = Util.getEventPosition(e, conf.target, conf.scale);
    //Util.Debug('mouse ' + evt.which + '/' + evt.button + ' up:' + pos.x + "," + pos.y);
    if (c_mouseMove) {
        c_mouseMove(pos.x, pos.y);
    }
}

function onKeyDown(e) {
    //Util.Debug("keydown: " + getKeysym(e));
    if (! conf.focused) {
        return true;
    }
    if (c_keyPress) {
        c_keyPress(getKeysym(e), 1);
    }
    Util.stopEvent(e);
    return false;
}

function onKeyUp(e) {
    //Util.Debug("keyup: " + getKeysym(e));
    if (! conf.focused) {
        return true;
    }
    if (c_keyPress) {
        c_keyPress(getKeysym(e), 0);
    }
    Util.stopEvent(e);
    return false;
}

function onMouseDisable(e) {
    var evt, pos;
    if (! conf.focused) {
        return true;
    }
    evt = (e ? e : window.event);
    pos = Util.getPosition(conf.target);
    /* Stop propagation if inside canvas area */
    if ((evt.clientX >= pos.x) &&
        (evt.clientY >= pos.y) &&
        (evt.clientX < (pos.x + c_width)) &&
        (evt.clientY < (pos.y + c_height))) {
        //Util.Debug("mouse event disabled");
        Util.stopEvent(e);
        return false;
    }
    //Util.Debug("mouse event not disabled");
    return true;
}

//
// Public API interface functions
//

that.getContext = function () {
    return conf.ctx;
};

that.start = function(keyPressFunc, mouseButtonFunc, mouseMoveFunc) {
    var c;
    Util.Debug(">> Canvas.start");

    c = conf.target;
    c_keyPress = keyPressFunc || null;
    c_mouseButton = mouseButtonFunc || null;
    c_mouseMove = mouseMoveFunc || null;

    Util.addEvent(document, 'keydown', onKeyDown);
    Util.addEvent(document, 'keyup', onKeyUp);
    Util.addEvent(c, 'mousedown', onMouseDown);
    Util.addEvent(c, 'mouseup', onMouseUp);
    Util.addEvent(c, 'mousemove', onMouseMove);
    Util.addEvent(c, (Util.Engine.gecko) ? 'DOMMouseScroll' : 'mousewheel',
            onMouseWheel);

    /* Work around right and middle click browser behaviors */
    Util.addEvent(document, 'click', onMouseDisable);
    Util.addEvent(document.body, 'contextmenu', onMouseDisable);

    Util.Debug("<< Canvas.start");
};

that.rescale = function(factor) {
    var c, tp, x, y, 
        properties = ['transform', 'WebkitTransform', 'MozTransform', null];
    c = conf.target;
    tp = properties.shift();
    while (tp) {
        if (typeof c.style[tp] !== 'undefined') {
            break;
        }
        tp = properties.shift();
    }

    if (tp === null) {
        Util.Debug("No scaling support");
        return;
    }

    if (conf.scale === factor) {
        //Util.Debug("Canvas already scaled to '" + factor + "'");
        return;
    }

    conf.scale = factor;
    x = c.width - c.width * factor;
    y = c.height - c.height * factor;
    c.style[tp] = "scale(" + conf.scale + ") translate(-" + x + "px, -" + y + "px)";
};

that.resize = function(width, height, true_color) {
    var c = conf.target;

    if (typeof true_color !== "undefined") {
        conf.true_color = true_color;
    }

    c.width = width;
    c.height = height;

    c_width  = c.offsetWidth;
    c_height = c.offsetHeight;

    that.rescale(conf.scale);
};

that.clear = function() {
    that.resize(640, 20);
    conf.ctx.clearRect(0, 0, c_width, c_height);
};

that.stop = function() {
    var c = conf.target;
    Util.removeEvent(document, 'keydown', onKeyDown);
    Util.removeEvent(document, 'keyup', onKeyUp);
    Util.removeEvent(c, 'mousedown', onMouseDown);
    Util.removeEvent(c, 'mouseup', onMouseUp);
    Util.removeEvent(c, 'mousemove', onMouseMove);
    Util.removeEvent(c, (Util.Engine.gecko) ? 'DOMMouseScroll' : 'mousewheel',
            onMouseWheel);

    /* Work around right and middle click browser behaviors */
    Util.removeEvent(document, 'click', onMouseDisable);
    Util.removeEvent(document.body, 'contextmenu', onMouseDisable);

    // Turn off cursor rendering
    if (conf.cursor_uri) {
        c.style.cursor = "default";
    }
};

setFillColor = function(color) {
    var rgb, newStyle;
    if (conf.true_color) {
        rgb = color;
    } else {
        rgb = conf.colourMap[color[0]];
    }
    if (newStyle !== c_prevStyle) {
        newStyle = "rgb(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ")";
        conf.ctx.fillStyle = newStyle;
        c_prevStyle = newStyle;
    }
};
that.setFillColor = setFillColor;

fillRect = function(x, y, width, height, color) {
    setFillColor(color);
    conf.ctx.fillRect(x, y, width, height);
};
that.fillRect = fillRect;

that.copyImage = function(old_x, old_y, new_x, new_y, width, height) {
    conf.ctx.drawImage(conf.target, old_x, old_y, width, height,
                                       new_x, new_y, width, height);
};

/*
 * Tile rendering functions optimized for rendering engines.
 *
 * - In Chrome/webkit, Javascript image data array manipulations are
 *   faster than direct Canvas fillStyle, fillRect rendering. In
 *   gecko, Javascript array handling is much slower.
 */
that.getTile = function(x, y, width, height, color) {
    var img, data, p, rgb, red, green, blue, j, i;
    img = {'x': x, 'y': y, 'width': width, 'height': height,
           'data': []};
    if (conf.prefer_js) {
        data = img.data;
        if (conf.true_color) {
            rgb = color;
        } else {
            rgb = conf.colourMap[color[0]];
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
        fillRect(x, y, width, height, color);
    }
    return img;
};

that.setSubTile = function(img, x, y, w, h, color) {
    var data, p, rgb, red, green, blue, width, j, i;
    if (conf.prefer_js) {
        data = img.data;
        width = img.width;
        if (conf.true_color) {
            rgb = color;
        } else {
            rgb = conf.colourMap[color[0]];
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
        fillRect(img.x + x, img.y + y, w, h, color);
    }
};

that.putTile = function(img) {
    if (conf.prefer_js) {
        that.rgbxImage(img.x, img.y, img.width, img.height, img.data, 0);
    } else {
        // No-op, under gecko already done by setSubTile
    }
};

that.imageDataGet = function(width, height) {
    return conf.ctx.getImageData(0, 0, width, height);
};
that.imageDataCreate = function(width, height) {
    return conf.ctx.createImageData(width, height);
};

that.rgbxImageData = function(x, y, width, height, arr, offset) {
    var img, i, j, data;
    img = that.imageData(width, height);
    data = img.data;
    for (i=0, j=offset; i < (width * height * 4); i=i+4, j=j+4) {
        data[i + 0] = arr[j + 0];
        data[i + 1] = arr[j + 1];
        data[i + 2] = arr[j + 2];
        data[i + 3] = 255; // Set Alpha
    }
    conf.ctx.putImageData(img, x, y);
};

// really slow fallback if we don't have imageData
that.rgbxImageFill = function(x, y, width, height, arr, offset) {
    var i, j, sx = 0, sy = 0;
    for (i=0, j=offset; i < (width * height); i+=1, j+=4) {
        fillRect(x+sx, y+sy, 1, 1, [arr[j+0], arr[j+1], arr[j+2]]);
        sx += 1;
        if ((sx % width) === 0) {
            sx = 0;
            sy += 1;
        }
    }
};

that.cmapImageData = function(x, y, width, height, arr, offset) {
    var img, i, j, data, rgb, cmap;
    img = that.imageData(width, height);
    data = img.data;
    cmap = conf.colourMap;
    for (i=0, j=offset; i < (width * height * 4); i+=4, j+=1) {
        rgb = cmap[arr[j]];
        data[i + 0] = rgb[0];
        data[i + 1] = rgb[1];
        data[i + 2] = rgb[2];
        data[i + 3] = 255; // Set Alpha
    }
    conf.ctx.putImageData(img, x, y);
};

that.cmapImageFill = function(x, y, width, height, arr, offset) {
    var i, j, sx = 0, sy = 0, cmap;
    cmap = conf.colourMap;
    for (i=0, j=offset; i < (width * height); i+=1, j+=1) {
        fillRect(x+sx, y+sy, 1, 1, [arr[j]]);
        sx += 1;
        if ((sx % width) === 0) {
            sx = 0;
            sy += 1;
        }
    }
};


that.blitImage = function(x, y, width, height, arr, offset) {
    if (conf.true_color) {
        that.rgbxImage(x, y, width, height, arr, offset);
    } else {
        that.cmapImage(x, y, width, height, arr, offset);
    }
};

that.blitStringImage = function(str, x, y) {
    var img = new Image();
    img.onload = function () { conf.ctx.drawImage(img, x, y); };
    img.src = str;
};

that.changeCursor = function(pixels, mask, hotx, hoty, w, h) {
    var cur = [], cmap, rgb, IHDRsz, ANDsz, XORsz, url, idx, alpha, x, y;
    //Util.Debug(">> changeCursor, x: " + hotx + ", y: " + hoty + ", w: " + w + ", h: " + h);
    
    if (conf.cursor_uri === false) {
        Util.Warn("changeCursor called but no cursor data URI support");
        return;
    }

    cmap = conf.colourMap;
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
    for (y = h-1; y >= 0; y -= 1) {
        for (x = 0; x < w; x += 1) {
            idx = y * Math.ceil(w / 8) + Math.floor(x/8);
            alpha = (mask[idx] << (x % 8)) & 0x80 ? 255 : 0;

            if (conf.true_color) {
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
    for (y = 0; y < h; y += 1) {
        for (x = 0; x < Math.ceil(w / 8); x += 1) {
            cur.push(0x00);
        }
    }

    url = "data:image/x-icon;base64," + Base64.encode(cur);
    conf.target.style.cursor = "url(" + url + ") " + hotx + " " + hoty + ", default";
    //Util.Debug("<< changeCursor, cur.length: " + cur.length);
};



return constructor();  // Return the public API interface

}  // End of Canvas()

