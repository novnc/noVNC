/*
 * noVNC: HTML5 VNC client
 *
 * Licensed under AGPL-3 (see LICENSE.AGPL-3)
 *
 * See README.md for usage and integration instructions.
 */
"use strict";

/*global window, $, Browser */

// Everything namespaced inside Canvas
var Canvas = {

prefer_js : false,

c_x : 0,
c_y : 0,
c_wx : 0,
c_wy : 0,
ctx  : null,

prevStyle: "",

mouseDown: function (e) {
    var evt = e.event || window.event;
    e.stop();
    console.log('mouse ' + evt.which + '/' + evt.button + ' down:' +
            (evt.clientX - Canvas.c_x) + "," + (evt.clientY - Canvas.c_y));
},

mouseUp: function (e) {
    var evt = e.event || window.event;
    e.stop();
    console.log('mouse ' + evt.which + '/' + evt.button + ' up:' +
            (evt.clientX - Canvas.c_x) + "," + (evt.clientY - Canvas.c_y));
},

mouseMove: function (e) {
    var evt = e.event || window.event;
    console.log('mouse ' + evt.which + '/' + evt.button + ' up:' +
            (evt.clientX - Canvas.c_x) + "," + (evt.clientY - Canvas.c_y));
},


keyDown: function (e) {
    e.stop();
    console.log("keydown: " + e.key + "(" + e.code + ")");
},

keyUp : function (e) {
    e.stop();
    console.log("keyup: " + e.key + "(" + e.code + ")");
},

ctxDisable: function (e) {
    var evt = e.event || window.event;
    /* Stop propagation if inside canvas area */
    if ((evt.clientX >= Canvas.c_x) &&
        (evt.clientY >= Canvas.c_y) &&
        (evt.clientX < (Canvas.c_x + Canvas.c_wx)) &&
        (evt.clientY < (Canvas.c_y + Canvas.c_wy))) {
        e.stop();
        return false;
    }
},


init: function (id, width, height, keyDown, keyUp,
                mouseDown, mouseUp, mouseMove) {
    console.log(">> Canvas.init");

    Canvas.id = id;

    if (! keyDown) { keyDown = Canvas.keyDown; }
    if (! keyUp) { keyUp = Canvas.keyUp; }
    if (! mouseDown) { mouseDown = Canvas.mouseDown; }
    if (! mouseUp) { mouseUp = Canvas.mouseUp; }
    if (! mouseMove) { mouseMove = Canvas.mouseMove; }

    var c = $(Canvas.id);
    document.addEvent('keydown', keyDown);
    document.addEvent('keyup', keyUp);
    c.addEvent('mousedown', mouseDown);
    c.addEvent('mouseup', mouseUp);
    c.addEvent('mousemove', mouseMove);

    /* Work around right and middle click browser behaviors */
    document.addEvent('click', Canvas.ctxDisable);
    document.body.addEvent('contextmenu', Canvas.ctxDisable);

    c.width = width;
    c.height = height;
    Canvas.c_x = c.getPosition().x;
    Canvas.c_y = c.getPosition().y;
    Canvas.c_wx = c.getSize().x;
    Canvas.c_wy = c.getSize().y;

    if (! c.getContext) { return; }
    Canvas.ctx = c.getContext('2d'); 
    
    Canvas.prevStyle = "";

    if (Browser.Engine.webkit) {
        Canvas.prefer_js = true;
    }

    console.log("<< Canvas.init");
},

clear: function () {
    Canvas.ctx.clearRect(0, 0, Canvas.c_wx, Canvas.c_wy);
    var c = $(Canvas.id);
    c.width = 640;
    c.height = 20;
},

stop: function () {
    var c = $(Canvas.id);
    document.removeEvents('keydown');
    document.removeEvents('keyup');
    c.removeEvents('mousedown');
    c.removeEvents('mouseup');
    c.removeEvents('mousemove');

    /* Work around right and middle click browser behaviors */
    document.removeEvents('click');
    document.body.removeEvents('contextmenu');
},

/*
 * Tile rendering functions optimized for rendering engines.
 *
 * - In Chrome/webkit, Javascript image data array manipulations are
 *   faster than direct Canvas fillStyle, fillRect rendering. In
 *   gecko, Javascript array handling is much slower.
 */
getTile: function(x, y, width, height, color) {
    var img, data, p, red, green, blue, j, i;
    img = {'x': x, 'y': y, 'width': width, 'height': height,
           'data': []};
    if (Canvas.prefer_js) {
        data = img.data;
        red = color[0];
        green = color[1];
        blue = color[2];
        for (j = 0; j < height; j++) {
            for (i = 0; i < width; i++) {
                p = (i + (j * width) ) * 4;
                img.data[p + 0] = red;
                img.data[p + 1] = green;
                img.data[p + 2] = blue;
                //img.data[p + 3] = 255; // Set Alpha
            }   
        } 
    } else {
        Canvas.fillRect(x, y, width, height, color);
    }
    return img;
},

setTile: function(img, x, y, w, h, color) {
    var data, p, red, green, blue, width, j, i;
    if (Canvas.prefer_js) {
        data = img.data;
        width = img.width;
        red = color[0];
        green = color[1];
        blue = color[2];
        for (j = 0; j < h; j++) {
            for (i = 0; i < w; i++) {
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
        Canvas.rgbxImage(img.x, img.y, img.width, img.height, img.data);
        //Canvas.ctx.putImageData(img, img.x, img.y);
    } else {
        // No-op, under gecko already done by setTile
    }
},


rgbxImage: function(x, y, width, height, arr) {
    var img, i, data;
    /* Old firefox and Opera don't support createImageData */
    img = Canvas.ctx.getImageData(0, 0, width, height);
    //console.log("rfbxImage: img: " + img + " x: " + x + " y: " + y + " width: " + width + " height: " + height);
    //img.data = arr.slice();
    data = img.data;
    for (i=0; i < (width * height); i++) {
        data[i*4 + 0] = arr[i*4 + 0];
        data[i*4 + 1] = arr[i*4 + 1];
        data[i*4 + 2] = arr[i*4 + 2];
        data[i*4 + 3] = 255; // Set Alpha
    }
    Canvas.ctx.putImageData(img, x, y);

},

fillRect: function(x, y, width, height, color) {
    var newStyle = "rgb(" + color[0] + "," + color[1] + "," + color[2] + ")";
    if (newStyle !== Canvas.prevStyle) {
        Canvas.ctx.fillStyle = newStyle;
        Canvas.prevStyle = newStyle;
    }
    Canvas.ctx.fillRect(x, y, width, height);
},

copyImage: function(old_x, old_y, new_x, new_y, width, height) {
    Canvas.ctx.drawImage($(Canvas.id), old_x, old_y, width, height,
                                       new_x, new_y, width, height);
},

/* Translate DOM key event to keysym value */
getKeysym: function(e) {
    var evt, keysym;
    evt = e.event || window.event;

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
        case 18        : keysym = 0xFFE7; break; // ALT
        default        : keysym = evt.keyCode; break;
    }

    /* Remap symbols */
    switch (keysym) {
        case 186       : keysym = 59; break; // ;  (IE)
        case 187       : keysym = 61; break; // =  (IE)
        case 188       : keysym = 44; break; // ,  (Mozilla, IE)
        case 109       :                     // -  (Mozilla)
            if (Browser.Engine.gecko) {
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


};

