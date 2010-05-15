/*
 * noVNC: HTML5 VNC client
 *
 * Licensed under AGPL-3 (see LICENSE.AGPL-3)
 *
 * See README.md for usage and integration instructions.
 *
 * This script defines the following globals:
 *     VNC_scripts, VNC_native_ws, FBU, RFB,
 *     RQ, RQ_reorder, RQ_seq_num, SQ
 */


/*
 * Load supporting scripts
 */

VNC_scripts = "";

// Uncomment to activate firebug lite
//VNC_scripts += "<script src='http://getfirebug.com/releases/lite/1.2/firebug-lite-compressed.js'><\/script>";

VNC_scripts += "<script src='include/mootools.js'><\/script>";
VNC_scripts += "<script src='include/base64.js'><\/script>";
VNC_scripts += "<script src='include/des.js'><\/script>";
VNC_scripts += "<script src='include/util.js'><\/script>";
VNC_scripts += "<script src='canvas.js'><\/script>";

/* If no builtin websockets then load web_socket.js */
if (window.WebSocket) {
    VNC_native_ws = true;
} else {
    VNC_native_ws = false;
    VNC_scripts += "<script src='include/web-socket-js/swfobject.js'><\/script>";
    VNC_scripts += "<script src='include/web-socket-js/FABridge.js'><\/script>";
    VNC_scripts += "<script src='include/web-socket-js/web_socket.js'><\/script>";
}
document.write(VNC_scripts);

/*
 * Make arrays quack
 */

Array.prototype.shift8 = function () {
    return this.shift();
}
Array.prototype.push8 = function (num) {
    this.push(num & 0xFF);
}

Array.prototype.shift16 = function () {
    return (this.shift() << 8) +
           (this.shift()     );
}
Array.prototype.push16 = function (num) {
    this.push((num >> 8) & 0xFF,
              (num     ) & 0xFF  );
}


Array.prototype.shift32 = function () {
    return (this.shift() << 24) +
           (this.shift() << 16) +
           (this.shift() <<  8) +
           (this.shift()      );
}
Array.prototype.get32 = function (off) {
    return (this[off    ] << 24) +
           (this[off + 1] << 16) +
           (this[off + 2] <<  8) +
           (this[off + 3]      );
}
Array.prototype.push32 = function (num) {
    this.push((num >> 24) & 0xFF,
              (num >> 16) & 0xFF,
              (num >>  8) & 0xFF,
              (num      ) & 0xFF  );
}

Array.prototype.shiftStr = function (len) {
    var arr = this.splice(0, len);
    return arr.map(function (num) {
            return String.fromCharCode(num); } ).join('');
}
Array.prototype.pushStr = function (str) {
    var n = str.length;
    for (var i=0; i < n; i++) {
        this.push(str.charCodeAt(i));
    }
}

Array.prototype.shiftBytes = function (len) {
    return this.splice(0, len);
}

/*
 * Frame buffer update state
 */
FBU = {
    rects    : 0,
    subrects : 0,  // RRE and HEXTILE
    lines    : 0,  // RAW
    tiles    : 0,  // HEXTILE
    bytes    : 0,
    x        : 0,
    y        : 0,
    width    : 0, 
    height   : 0,
    encoding : 0,
    subencoding : -1,
    background: null};

/*
 * RFB namespace
 */

RQ         = [];  // Receive Queue
RQ_reorder = [];  // Receive Queue re-order list
RQ_seq_num = 0;   // Expected sequence number
SQ         = "";  // Send Queue

RFB = {

ws        : null,  // Web Socket object
sendID    : null,
use_seq   : false,

// DOM objects
statusLine : null,
connectBtn : null,
clipboard  : null,

max_version : 3.8,
version   : 0,
auth_scheme : '',
state     : 'disconnected',
cuttext   : 'none', // ServerCutText wait state
ct_length : 0,
clipboardFocus : false,

shared    : 1,
check_rate : 217,
req_rate  : 1413,
last_req  : 0,

host      : '',
port      : 5900,
password  : '',

fb_width  : 0,
fb_height : 0,
fb_name   : "",
fb_Bpp    : 4,
rre_chunk : 100,

/* Mouse state */
mouse_buttonmask : 0,
mouse_arr        : [],


/*
 * Server message handlers
 */

/* RFB/VNC initialisation */
init_msg: function () {
    console.log(">> init_msg");

    console.log("RQ (" + RQ.length + ") " + RQ);

    switch (RFB.state) {

    case 'ProtocolVersion' :
        if (RQ.length < 12) {
            RFB.updateState('failed', "Disconnected: invalid RFB protocol version received");
            return;
        }
        var server_version = RQ.shiftStr(12).substr(0,11);
        console.log("Server ProtocolVersion: " + server_version);
        if ((server_version == "RFB 003.003") || (RFB.max_version == 3.3)) {
            RFB.version = 3.3;
            var verstr = "RFB 003.003";
            RFB.send_string(verstr + "\n");
            RFB.updateState('Security', "Sent ProtocolVersion: " + verstr);
        } else if (server_version == "RFB 003.008") {
            RFB.version = 3.8;
            var verstr = "RFB 003.008";
            RFB.send_string(verstr + "\n");
            RFB.updateState('Security', "Sent ProtocolVersion: " + verstr);
        } else {
            RFB.updateState('failed', "Invalid server version " + server_version);
            return;
        }
        break;

    case 'Security' :
        if (RFB.version == 3.8) {
            var num_types = RQ.shift8();
            if (num_types == 0) {
                var strlen = RQ.shift32();
                var reason = RQ.shiftStr(strlen);
                RFB.updateState('failed', "Disconnected: security failure: " + reason);
                return;
            }
            var types = RQ.shiftBytes(num_types);
            
            if ((types[0] != 1) && (types[0] != 2)) {
                RFB.updateState('failed', "Disconnected: invalid security types list: " + types);
                return;
            }

            if (RFB.password.length == 0) {
                RFB.auth_scheme = 1;
            } else {
                RFB.auth_scheme = types[0];
            }
            RFB.send_array([RFB.auth_scheme]);
        } else if (RFB.version == 3.3) {
            if (RQ.length < 4) {
                RFB.updateState('failed', "Invalid security frame");
                return;
            }
            RFB.auth_scheme = RQ.shift32();
        }
        RFB.updateState('Authentication', "Authenticating using scheme: " + RFB.auth_scheme);
        // Fall through

    case 'Authentication' :
        console.log("Security auth scheme: " + RFB.auth_scheme);
        switch (RFB.auth_scheme) {
            case 0:  // connection failed
                if (RQ.length < 4) {
                    console.log("   waiting for auth reason bytes");
                    return;
                }
                var strlen = RQ.shift32();
                var reason = RQ.shiftStr(strlen);
                RFB.updateState('failed', "Disconnected: auth failure: " + reason);
                return;
            case 1:  // no authentication
                // RFB.send_array([RFB.shared]); // ClientInitialisation
                RFB.updateState('SecurityResult');
                break;
            case 2:  // VNC authentication
                if (RQ.length < 16) {
                    console.log("   waiting for auth challenge bytes");
                    return;
                }
                var challenge = RQ.shiftBytes(16);
                console.log("Password: " + RFB.password);
                console.log("Challenge: " + challenge + " (" + challenge.length + ")");
                var response = RFB.DES(RFB.password, challenge);
                console.log("Response: " + response + " (" + response.length + ")");

                RFB.send_array(response);
                RFB.updateState('SecurityResult');
                break;
            default:
                RFB.updateState('failed', "Disconnected: unsupported auth scheme: " + RFB.auth_scheme);
                return;
        }
        break;

    case 'SecurityResult' :
        if (RQ.length < 4) {
            RFB.updateState('failed', "Invalid VNC auth response");
            return;
        }
        var resp = RQ.shift32();
        switch (resp) {
            case 0:  // OK
                RFB.updateState('ServerInitialisation', "Authentication OK");
                break;
            case 1:  // failed
                if (RFB.version == 3.8) {
                    var reason_len = RQ.shift32();
                    var reason = RQ.shiftStr(reason_len);
                    RFB.updateState('failed', reason);
                } else if (RFB.version == 3.3) {
                    RFB.updateState('failed', "Authentication failed");
                }
                return;
            case 2:  // too-many
                RFB.updateState('failed', "Disconnected: too many auth attempts");
                return;
        }
        RFB.send_array([RFB.shared]); // ClientInitialisation
        break;

    case 'ServerInitialisation' :
        if (RQ.length < 24) {
            RFB.updateState('failed', "Invalid server initialisation");
            return;
        }

        /* Screen size */
        RFB.fb_width  = RQ.shift16();
        RFB.fb_height = RQ.shift16();

        console.log("Screen size: " + RFB.fb_width + "x" + RFB.fb_height);

        /* PIXEL_FORMAT */
        var bpp            = RQ.shift8();
        var depth          = RQ.shift8();
        var big_endian     = RQ.shift8();
        var true_color     = RQ.shift8();

        console.log("bpp: " + bpp);
        console.log("depth: " + depth);
        console.log("big_endian: " + big_endian);
        console.log("true_color: " + true_color);

        /* Connection name/title */
        RQ.shiftStr(12);
        var name_length   = RQ.shift32();
        RFB.fb_name = RQ.shiftStr(name_length);

        Canvas.init('VNC_canvas', RFB.fb_width, RFB.fb_height,
                RFB.keyDown, RFB.keyUp,
                RFB.mouseDown, RFB.mouseUp, RFB.mouseMove);

        var init = [];
        init = init.concat(RFB.pixelFormat());
        init = init.concat(RFB.encodings());
        init = init.concat(RFB.fbUpdateRequest(0));
        RFB.send_array(init);
        
        /* Start pushing/polling */
        RFB.checkEvents.delay(RFB.check_rate);

        RFB.updateState('normal', "Connected to: " + RFB.fb_name);
        break;
    }
    console.log("<< init_msg");
},


/* Normal RFB/VNC server messages */
normal_msg: function () {
    //console.log(">> normal_msg");
    var ret = true;
    if (FBU.rects > 0) {
        var msg_type = 0;
    } else if (RFB.cuttext != 'none') {
        var msg_type = 3;
    } else {
        var msg_type = RQ.shift8();
    }
    switch (msg_type) {
    case 0:  // FramebufferUpdate
        if (FBU.rects == 0) {
            if (RQ.length < 3) {
                RQ.unshift(msg_type);
                console.log("   waiting for FBU header bytes");
                return false;
            }
            RQ.shift8();
            FBU.rects = RQ.shift16();
            //console.log("FramebufferUpdate, rects:" + FBU.rects);
            FBU.bytes = 0;
        }

        while ((FBU.rects > 0) && (RQ.length >= FBU.bytes)) {
            if (FBU.bytes == 0) {
                if (RQ.length < 12) {
                    console.log("   waiting for rect header bytes");
                    return false;
                }
                /* New FramebufferUpdate */
                FBU.x      = RQ.shift16();
                FBU.y      = RQ.shift16();
                FBU.width  = RQ.shift16();
                FBU.height = RQ.shift16();
                FBU.encoding = parseInt(RQ.shift32(), 10);

                // Debug:
                /*
                var msg = "FramebufferUpdate rects:" + FBU.rects + " encoding:" + FBU.encoding
                switch (FBU.encoding) {
                    case 0: msg += "(RAW)"; break;
                    case 1: msg += "(COPY-RECT)"; break;
                    case 2: msg += "(RRE)"; break;
                    case 5: msg += "(HEXTILE " + FBU.tiles + " tiles)"; break;
                    default:
                        RFB.updateState('failed', "Disconnected: unsupported encoding " + FBU.encoding);
                        return false;
                }
                msg += ", RQ.length: " + RQ.length
                console.log(msg);
                */
            }

            switch (FBU.encoding) {
                case 0: ret = RFB.display_raw();       break; // Raw
                case 1: ret = RFB.display_copy_rect(); break; // Copy-Rect
                case 2: ret = RFB.display_rre();       break; // RRE
                case 5: ret = RFB.display_hextile();   break; // hextile
            }
            if (RFB.state != "normal") return true;
        }

        break;
    case 1:  // SetColourMapEntries
        console.log("SetColourMapEntries (unsupported)");
        RQ.shift8();  // Padding
        RQ.shift16(); // First colour
        var num_colours = RQ.shift16();
        RQ.shiftBytes(num_colours * 6);
        break;
    case 2:  // Bell
        console.log("Bell (unsupported)");
        break;
    case 3:  // ServerCutText
        console.log("ServerCutText");
        console.log("RQ:" + RQ.slice(0,20));
        if (RFB.cuttext == 'none') {
            RFB.cuttext = 'header';
        }
        if (RFB.cuttext == 'header') {
            if (RQ.length < 7) {
                console.log("waiting for ServerCutText header");
                return false;
            }
            RQ.shiftBytes(3);  // Padding
            RFB.ct_length = RQ.shift32();
        }
        RFB.cuttext = 'bytes';
        if (RQ.length < RFB.ct_length) {
            console.log("waiting for ServerCutText bytes");
            return false;
        }
        RFB.clipboardCopyTo(RQ.shiftStr(RFB.ct_length));
        RFB.cuttext = 'none';
        break;
    default:
        RFB.updateState('failed', "Disconnected: illegal server message type " + msg_type);
        console.log("RQ.slice(0,30):" + RQ.slice(0,30));
        break;
    }
    //console.log("<< normal_msg");
    return ret;
},


/*
 * FramebufferUpdate encodings
 */

display_raw: function () {
    //console.log(">> display_raw");
    if (FBU.lines == 0) {
        FBU.lines = FBU.height;
    }
    FBU.bytes = FBU.width * RFB.fb_Bpp; // At least a line
    if (RQ.length < FBU.bytes) {
        //console.log("   waiting for " + (FBU.bytes - RQ.length) + " RAW bytes");
        return;
    }
    var cur_y = FBU.y + (FBU.height - FBU.lines);
    var cur_height = Math.min(FBU.lines, Math.floor(RQ.length/(FBU.width * RFB.fb_Bpp)));
    Canvas.rgbxImage(FBU.x, cur_y, FBU.width, cur_height, RQ);
    RQ.shiftBytes(FBU.width * cur_height * RFB.fb_Bpp);
    FBU.lines -= cur_height;

    if (FBU.lines > 0) {
        FBU.bytes = FBU.width * RFB.fb_Bpp; // At least another line
    } else {
        FBU.rects --;
        FBU.bytes = 0;
    }
},

display_copy_rect: function () {
    //console.log(">> display_copy_rect");
    if (RQ.length < 4) {
        //console.log("   waiting for " + (FBU.bytes - RQ.length) + " COPY-RECT bytes");
        return;
    }
    var old_x = RQ.shift16();
    var old_y = RQ.shift16();
    Canvas.copyImage(old_x, old_y, FBU.x, FBU.y, FBU.width, FBU.height);
    FBU.rects --;
    FBU.bytes = 0;
},

display_rre: function () {
    //console.log(">> display_rre (" + RQ.length + " bytes)");
    if (FBU.subrects == 0) {
        ;
        if (RQ.length < 4 + RFB.fb_Bpp) {
            //console.log("   waiting for " + (4 + RFB.fb_Bpp - RQ.length) + " RRE bytes");
            return;
        }
        FBU.subrects = RQ.shift32();
        var color = RQ.shiftBytes(RFB.fb_Bpp); // Background
        Canvas.fillRect(FBU.x, FBU.y, FBU.width, FBU.height, color);
    }
    while ((FBU.subrects > 0) && (RQ.length >= (RFB.fb_Bpp + 8))) {
        var color = RQ.shiftBytes(RFB.fb_Bpp);
        var x = RQ.shift16();
        var y = RQ.shift16();
        var width = RQ.shift16();
        var height = RQ.shift16();
        Canvas.fillRect(FBU.x + x, FBU.y + y, width, height, color);
        FBU.subrects --;
    }
    //console.log("   display_rre: rects: " + FBU.rects + ", FBU.subrects: " + FBU.subrects);

    if (FBU.subrects > 0) {
        var chunk = Math.min(RFB.rre_chunk, FBU.subrects);
        FBU.bytes = (RFB.fb_Bpp + 8) * chunk;
    } else {
        FBU.rects --;
        FBU.bytes = 0;
    }
    //console.log("<< display_rre, FBU.bytes: " + FBU.bytes);
},

display_hextile: function() {
    //console.log(">> display_hextile");
    var subencoding, subrects, cur_tile, tile_x, x, w, tile_y, y, h;

    if (FBU.tiles == 0) {
        FBU.tiles_x = Math.ceil(FBU.width/16);
        FBU.tiles_y = Math.ceil(FBU.height/16);
        FBU.total_tiles = FBU.tiles_x * FBU.tiles_y;
        FBU.tiles = FBU.total_tiles;
    }

    /* FBU.bytes comes in as 1, RQ.length at least 1 */
    while (FBU.tiles > 0) {
        FBU.bytes = 1;
        if (RQ.length < FBU.bytes) {
            console.log("   waiting for HEXTILE subencoding byte");
            return;
        }
        subencoding = RQ[0];  // Peek
        if (subencoding > 30) { // Raw
            RFB.updateState('failed', "Disconnected: illegal hextile subencoding " + subencoding);
            console.log("RQ.slice(0,30):" + RQ.slice(0,30));
            return;
        }
        subrects = 0;
        cur_tile = FBU.total_tiles - FBU.tiles;
        tile_x = cur_tile % FBU.tiles_x;
        tile_y = Math.floor(cur_tile / FBU.tiles_x);
        x = FBU.x + tile_x * 16;
        y = FBU.y + tile_y * 16;
        w = Math.min(16, (FBU.x + FBU.width) - x)
        h = Math.min(16, (FBU.y + FBU.height) - y)

        /* Figure out how much we are expecting */
        if (subencoding & 0x01) { // Raw
            //console.log("   Raw subencoding");
            FBU.bytes += w * h * RFB.fb_Bpp;
        } else {
            if (subencoding & 0x02) { // Background
                FBU.bytes += RFB.fb_Bpp;
            }
            if (subencoding & 0x04) { // Foreground
                FBU.bytes += RFB.fb_Bpp;
            }
            if (subencoding & 0x08) { // AnySubrects
                FBU.bytes++;   // Since we aren't shifting it off
                if (RQ.length < FBU.bytes) {
                    /* Wait for subrects byte */
                    console.log("   waiting for hextile subrects header byte");
                    return;
                }
                subrects = RQ[FBU.bytes-1]; // Peek
                if (subencoding & 0x10) { // SubrectsColoured
                    FBU.bytes += subrects * (RFB.fb_Bpp + 2);
                } else {
                    FBU.bytes += subrects * 2;
                }
            }
        }

        //console.log("   tile:" + cur_tile + "/" + (FBU.total_tiles - 1) + ", subencoding:" + subencoding + "(last: " + FBU.lastsubencoding + "), subrects:" + subrects + ", tile:" + tile_x + "," + tile_y + " [" + x + "," + y + "]@" + w + "x" + h + ", d.length:" + RQ.length + ", bytes:" + FBU.bytes + " last:" + RQ.slice(FBU.bytes-10, FBU.bytes) + " next:" + RQ.slice(FBU.bytes-1, FBU.bytes+10));
        if (RQ.length < FBU.bytes) {
            //console.log("   waiting for " + (FBU.bytes - RQ.length) + " hextile bytes");
            return;
        }

        /* We know the encoding and have a whole tile */
        FBU.subencoding = RQ.shift8();
        FBU.bytes--;
        if (FBU.subencoding == 0) {
            if (FBU.lastsubencoding & 0x01) {
                /* Weird: ignore blanks after RAW */
                console.log("     Ignoring blank after RAW");
                continue;
            }
            Canvas.fillRect(x, y, w, h, FBU.background);
        } else if (FBU.subencoding & 0x01) { // Raw
            Canvas.rgbxImage(x, y, w, h, RQ);
        } else {
            var idx = 0;
            if (FBU.subencoding & 0x02) { // Background
                FBU.background = RQ.slice(idx, idx + RFB.fb_Bpp);
                idx += RFB.fb_Bpp;
            }
            if (FBU.subencoding & 0x04) { // Foreground
                FBU.foreground = RQ.slice(idx, idx + RFB.fb_Bpp);
                idx += RFB.fb_Bpp;
            }

            var tile = Canvas.getTile(x, y, w, h, FBU.background);
            if (FBU.subencoding & 0x08) { // AnySubrects
                subrects = RQ[idx];
                idx++;
                var xy, sx, sy, wh, sw, sh;
                for (var s = 0; s < subrects; s ++) {
                    if (FBU.subencoding & 0x10) { // SubrectsColoured
                        color = RQ.slice(idx, idx + RFB.fb_Bpp);
                        idx += RFB.fb_Bpp;
                    } else {
                        color = FBU.foreground;
                    }
                    xy = RQ[idx];
                    idx++;
                    sx = (xy >> 4);
                    sy = (xy & 0x0f);

                    wh = RQ[idx];
                    idx++;
                    sw = (wh >> 4)   + 1;
                    sh = (wh & 0x0f) + 1;

                    Canvas.setTile(tile, sx, sy, sw, sh, color);
                }
            }
            Canvas.putTile(tile);
        }
        RQ.shiftBytes(FBU.bytes);
        FBU.lastsubencoding = FBU.subencoding;
        FBU.bytes = 0;
        FBU.tiles --;
    }

    if (FBU.tiles == 0) {
        FBU.rects --;
    }

    //console.log("<< display_hextile");
},



/*
 * Client message routines
 */

pixelFormat: function () {
    console.log(">> setPixelFormat");
    var arr;
    arr = [0];     // msg-type
    arr.push8(0);  // padding
    arr.push8(0);  // padding
    arr.push8(0);  // padding

    arr.push8(RFB.fb_Bpp * 8); // bits-per-pixel
    arr.push8(24); // depth
    arr.push8(0);  // little-endian
    arr.push8(1);  // true-color

    arr.push16(255);  // red-max
    arr.push16(255);  // green-max
    arr.push16(255);  // blue-max
    arr.push8(0);     // red-shift
    arr.push8(8);     // green-shift
    arr.push8(16);    // blue-shift

    arr.push8(0);     // padding
    arr.push8(0);     // padding
    arr.push8(0);     // padding
    console.log("<< setPixelFormat");
    return arr;
},

fixColourMapEntries: function () {
},

encodings: function () {
    console.log(">> setEncodings");
    var arr;
    arr = [2];     // msg-type
    arr.push8(0);  // padding

    //arr.push16(3); // encoding count
    arr.push16(4); // encoding count
    arr.push32(5); // hextile encoding

    arr.push32(2); // RRE encoding
    arr.push32(1); // copy-rect encoding
    arr.push32(0); // raw encoding
    console.log("<< setEncodings");
    return arr;
},

fbUpdateRequest: function (incremental, x, y, xw, yw) {
    //console.log(">> fbUpdateRequest");
    if (!x) x = 0;
    if (!y) y = 0;
    if (!xw) xw = RFB.fb_width;
    if (!yw) yw = RFB.fb_height;
    var arr;
    arr = [3];  // msg-type
    arr.push8(incremental);
    arr.push16(x);
    arr.push16(y);
    arr.push16(xw);
    arr.push16(yw);
    //console.log("<< fbUpdateRequest");
    return arr;
},

keyEvent: function (keysym, down) {
    //console.log(">> keyEvent, keysym: " + keysym + ", down: " + down);
    var arr;
    arr = [4];  // msg-type
    arr.push8(down);
    arr.push16(0);
    arr.push32(keysym);
    //console.log("<< keyEvent");
    return arr;
},

pointerEvent: function (x, y) {
    //console.log(">> pointerEvent, x,y: " + x + "," + y + " , mask: " + RFB.mouse_buttonMask);
    var arr;
    arr = [5];  // msg-type
    arr.push8(RFB.mouse_buttonMask);
    arr.push16(x);
    arr.push16(y);
    //console.log("<< pointerEvent");
    return arr;
},

clientCutText: function (text) {
    console.log(">> clientCutText");
    var arr;
    arr = [6];     // msg-type
    arr.push8(0);  // padding
    arr.push8(0);  // padding
    arr.push8(0);  // padding
    arr.push32(text.length);
    arr.pushStr(text);
    console.log("<< clientCutText:" + arr);
    return arr;
},


/*
 * Utility routines
 */

recv_message: function(e) {
    //console.log(">> recv_message");
    RQ = RQ.concat(Base64.decode(e.data, 0));

    RFB.handle_message();
    //console.log("<< recv_message");
},

recv_message_reorder: function(e) {
    //console.log(">> recv_message_reorder");

    var offset = e.data.indexOf(":") + 1;
    var seq_num = parseInt(e.data.substr(0, offset-1));
    if (RQ_seq_num == seq_num) {
        RQ = RQ.concat(Base64.decode(e.data, offset));
        RQ_seq_num++;
    } else {
        console.warn("sequence number mismatch RQ_seq_num:" + RQ_seq_num + ", seq_num:" + seq_num);
        if (RQ_reorder.length > 20) {
            RFB.updateState('failed', "Re-order queue too long");
        } else {
            RQ_reorder = RQ_reorder.concat(e.data.substr(0));
            var i = 0;
            while (i < RQ_reorder.length) {
                var offset = RQ_reorder[i].indexOf(":") + 1;
                var seq_num = parseInt(RQ_reorder[i].substr(0, offset-1));
                console.log("Searching reorder list item " + i + ", seq_num " + seq_num);
                if (seq_num == RQ_seq_num) {
                    /* Remove it from reorder queue, decode it and
                        * add it to the receive queue */
                    console.log("Found re-ordered packet seq_num " + seq_num);
                    RQ = RQ.concat(Base64.decode(RQ_reorder.splice(i, 1)[0], offset));
                    RQ_seq_num++;
                    i = 0;  // Start search again for next one
                } else {
                    i++;
                }
            }
            
        }
    }

    RFB.handle_message();
    //console.log("<< recv_message_reorder");
},

handle_message: function () {
    switch (RFB.state) {
    case 'disconnected':
        console.error("Got data while disconnected");
        break;
    case 'reset':
        /* close and reset connection */
        RFB.disconnect();
        RFB.init_ws();
        break;
    case 'failed':
        console.log("Giving up!");
        RFB.disconnect();
        break;
    case 'normal':
        RFB.normal_msg();
        /*
        while (RQ.length > 0) {
            if (RFB.normal_msg() && RFB.state == 'normal') {
                console.log("More to process");
            } else {
                break;
            }
        }
        */
        break;
    default:
        RFB.init_msg();
        break;
    }
},

send_string: function (str) {
    //console.log(">> send_string: " + str);
    RFB.send_array(str.split('').map(
        function (chr) { return chr.charCodeAt(0) } ) );
},

send_array: function (arr) {
    //console.log(">> send_array: " + arr);
    //console.log(">> send_array: " + Base64.encode(arr));
    SQ = SQ + Base64.encode(arr);
    if (RFB.ws.bufferedAmount == 0) {
        RFB.ws.send(SQ);
        SQ = ""
    } else {
        console.log("Delaying send");
    }
},

DES: function (password, challenge) {
    var passwd = [];
    var response = challenge.slice();
    for (var i=0; i < password.length; i++) {
        passwd.push(password.charCodeAt(i));
    }

    DES.setKeys(passwd);
    DES.encrypt(response, 0, response, 0);
    DES.encrypt(response, 8, response, 8);
    return response;
},

flushClient: function () {
    var arr = [];
    if (RFB.mouse_arr.length > 0) {
        //RFB.send_array(RFB.mouse_arr.concat(RFB.fbUpdateRequest(1)));
        RFB.send_array(RFB.mouse_arr)
        setTimeout(function() {
                RFB.send_array(RFB.fbUpdateRequest(1));
            }, 50);

        RFB.mouse_arr = [];
        return true;
    } else {
        return false;
    }
},

checkEvents: function () {
    if (RFB.state == 'normal') {
        if (! RFB.flushClient()) {
            var now = new Date().getTime();
            if (now > RFB.last_req + RFB.req_rate) {
                RFB.last_req = now;
                RFB.send_array(RFB.fbUpdateRequest(1));
            }
        }
    }
    RFB.checkEvents.delay(RFB.check_rate);
},

_keyX: function (e, down) {
    if (RFB.clipboardFocus) {
        return true;
    }
    e.stop();
    var arr = RFB.keyEvent(Canvas.getKeysym(e), down);
    arr = arr.concat(RFB.fbUpdateRequest(1));
    RFB.send_array(arr);
},

keyDown: function (e) {
    //console.log(">> keyDown: " + Canvas.getKeysym(e));
    RFB._keyX(e, 1);
},

keyUp: function (e) {
    //console.log(">> keyUp: " + Canvas.getKeysym(e));
    RFB._keyX(e, 0);
},

mouseDown: function(e) {
    var evt = e.event || window.event;
    var x, y;
    x = (evt.clientX - Canvas.c_x);
    y = (evt.clientY - Canvas.c_y);
    //console.log('>> mouseDown ' + evt.which + '/' + evt.button + " " + x + "," + y);
    RFB.mouse_buttonMask |= 1 << evt.button;
    RFB.mouse_arr = RFB.mouse_arr.concat( RFB.pointerEvent(x, y) );

    RFB.flushClient();
},

mouseUp: function(e) {
    var evt = e.event || window.event;
    var x, y;
    x = (evt.clientX - Canvas.c_x);
    y = (evt.clientY - Canvas.c_y);
    //console.log('>> mouseUp ' + evt.which + '/' + evt.button + " " + x + "," + y);
    RFB.mouse_buttonMask ^= 1 << evt.button;
    RFB.mouse_arr = RFB.mouse_arr.concat( RFB.pointerEvent(x, y) );

    RFB.flushClient();
},

mouseMove: function(e) {
    var evt = e.event || window.event;
    var x, y;
    x = (evt.clientX - Canvas.c_x);
    y = (evt.clientY - Canvas.c_y);
    //console.log('>> mouseMove ' + x + "," + y);
    RFB.mouse_arr = RFB.mouse_arr.concat( RFB.pointerEvent(x, y) );
},

clipboardCopyTo: function (text) {
    console.log(">> clipboardCopyTo: " + text.substr(0,40) + "...");
    RFB.clipboard.value = text;
    console.log("<< clipboardCopyTo");
},

clipboardPasteFrom: function () {
    if (RFB.state != "normal") return;
    var text = RFB.clipboard.value;
    console.log(">> clipboardPasteFrom: " + text.substr(0,40) + "...");
    RFB.send_array(RFB.clientCutText(text));
    console.log("<< clipboardPasteFrom");
},

clipboardClear: function () {
    RFB.clipboard.value = '';
    RFB.clipboardPasteFrom();
},

updateState: function(state, statusMsg) {
    var s = RFB.statusLine;
    var c = RFB.connectBtn;
    var func = function(msg) { console.log(msg) };
    switch (state) {
        case 'failed':
            func = function(msg) { console.error(msg) };
            c.disabled = true;
            s.style.fontColor = "#880000";
            break;
        case 'normal':
            c.value = "Disconnect";
            c.onclick = RFB.disconnect;
            c.disabled = false;
            s.style.fontColor = "#000000";
            break;
        case 'disconnected':
            c.value = "Connect";
            c.onclick = function () { RFB.connect(); },

            c.disabled = false;
            s.style.fontColor = "#000000";
            break;
        default:
            func = function(msg) { console.warn(msg) };
            c.disabled = true;
            s.style.fontColor = "#444400";
            break;
    }

    RFB.state = state;
    var cmsg = typeof(statusMsg) != 'undefined' ? (" Msg: " + statusMsg) : "";
    func("New state '" + state + "'." + cmsg);
    if (typeof(statusMsg) != 'undefined') {
        s.innerHTML = statusMsg;
    }
},

/*
 * Setup routines
 */

init_ws: function () {

    console.log(">> init_ws");
    var uri = "";
    if (RFB.encrypt) {
        uri = "wss://";
    } else {
        uri = "ws://";
    }
    uri += RFB.host + ":" + RFB.port + "/?b64encode";
    if (RFB.use_seq) {
        uri += "&seq_num";
    }
    console.log("connecting to " + uri);
    RFB.ws = new WebSocket(uri);

    if (RFB.use_seq) {
        RFB.ws.onmessage = RFB.recv_message_reorder;
    } else {
        RFB.ws.onmessage = RFB.recv_message;
    }
    RFB.ws.onopen = function(e) {
        console.log(">> WebSocket.onopen");
        RFB.updateState('ProtocolVersion', "Starting VNC handshake");
        RFB.sendID = setInterval(function() {
                /*
                 * Send updates either at a rate of one update every 50ms,
                 * or whatever slower rate the network can handle
                 */
                if (RFB.ws.bufferedAmount == 0) {
                    if (SQ) {
                        RFB.ws.send(SQ);
                        SQ = "";
                    }
                } else {
                    console.log("Delaying send");
                }
            }, 50);
        console.log("<< WebSocket.onopen");
    };
    RFB.ws.onclose = function(e) {
        console.log(">> WebSocket.onclose");
        clearInterval(RFB.sendID);
        if (RFB.state != 'disconnected') {
            if (RFB.state == 'failed') {
                RFB.updateState('disconnected');
            } else {
                RFB.updateState('disconnected', 'VNC disconnected');
            }
        }
        console.log("<< WebSocket.onclose");
    };
    RFB.ws.onerror = function(e) {
        console.error(">> WebSocket.onerror");
        console.error("   " + e);
        console.error("<< WebSocket.onerror");
    };

    console.log("<< init_ws");
},

init_vars: function () {
    /* Reset state */
    RFB.cuttext  = 'none';
    RFB.ct_length = 0;
    RQ           = [];
    RQ_seq_num   = 0;
    SQ           = "";
    FBU.rects    = 0;
    FBU.subrects = 0;  // RRE and HEXTILE
    FBU.lines    = 0,  // RAW
    FBU.tiles    = 0,  // HEXTILE
    RFB.mouse_buttonmask = 0;
    RFB.mouse_arr    = [];
},


connect: function (host, port, password, encrypt) {
    console.log(">> connect");
    RFB.host = (host !== undefined) ? host : $('VNC_host').value;
    console.log("RFB.host: " + RFB.host);
    RFB.port = (port !== undefined) ? port : $('VNC_port').value;
    RFB.password = (password !== undefined) ? password : $('VNC_password').value;
    RFB.encrypt = (encrypt !== undefined) ? encrypt : $('VNC_encrypt').checked;
    if ((!RFB.host) || (!RFB.port)) {
        alert("Must set host and port");
        return;
    }

    RFB.init_vars();

    if ((RFB.ws) && (RFB.ws.readyState == WebSocket.OPEN)) {
        RFB.ws.close();
    }
    RFB.init_ws();

    RFB.updateState('ProtocolVersion');
    console.log("<< connect");

},

disconnect: function () {
    console.log(">> disconnect");
    if ((RFB.ws) && (RFB.ws.readyState == WebSocket.OPEN)) {
        RFB.updateState('closed');
        RFB.ws.close();
    }
    if (Canvas.ctx) {
        Canvas.stop();
        if (! /__debug__$/i.test(document.location.href)) {
            Canvas.clear();
        }
    }

    if (RFB.state == 'failed') {
        RFB.updateState('disconnected');
    } else {
        RFB.updateState('disconnected', 'Disconnected');
    }
    console.log("<< disconnect");
},

/* 
 * Load the controls
 */
load: function (target) {
    console.log(">> RFB.load");

    if (!target) { target = 'vnc' };

    /* Populate the 'vnc' div */
    var html = "";
    if ($('VNC_controls') === null) {
        html += '<div id="VNC_controls">';
        html += '  <ul>';
        html += '    <li>Host: <input id="VNC_host"></li>';
        html += '    <li>Port: <input id="VNC_port"></li>';
        html += '    <li>Password: <input id="VNC_password" type="password"></li>';
        html += '    <li>Encrypt: <input id="VNC_encrypt" type="checkbox"></li>';
        html += '    <li><input id="VNC_connect_button" type="button"';
        html += '           value="Loading" disabled></li>';
        html += '  </ul>';
        html += '</div>';
    }
    if ($('VNC_screen') === null) {
        html += '<div id="VNC_screen">';
        html += '</div>';
    }
    if ($('VNC_clipboard') === null) {
        html += '<br><br>';
        html += '<div id="VNC_clipboard">';
        html += '  VNC Clipboard:';
        html += '  <input id="VNC_clipboard_clear_button" type="button" value="Clear">';
        html += '  <br>';
        html += '  <textarea id="VNC_clipboard_text" cols=80 rows=5>';
        html += '      </textarea>';
        html += '</div>';
    }
    $(target).innerHTML = html;

    html = "";
    if ($('VNC_status') === null) {
        html += '<div id="VNC_status">Loading</div>';
    }
    if ($('VNC_canvas') === null) {
        html += '<canvas id="VNC_canvas" width="640px" height="20px">';
        html += '    Canvas not supported.';
        html += '</canvas>';
    }
    $('VNC_screen').innerHTML += html;

    /* DOM object references */
    RFB.statusLine = $('VNC_status');
    RFB.connectBtn = $('VNC_connect_button');
    RFB.clipboard  = $('VNC_clipboard_text');

    /* Add handlers */
    $('VNC_clipboard_clear_button').onclick = RFB.clipboardClear;
    RFB.clipboard.onchange = RFB.clipboardPasteFrom;
    RFB.clipboard.onfocus = function () { RFB.clipboardFocus = true; };
    RFB.clipboard.onblur = function () { RFB.clipboardFocus = false; };

    /* Load web-socket-js if no builtin WebSocket support */
    if (VNC_native_ws) {
        console.log("Using native WebSockets");
        RFB.updateState('disconnected', 'Disconnected');
    } else {
        console.log("Using web-socket-js flash bridge");
        if ((! Browser.Plugins.Flash) ||
            (Browser.Plugins.Flash.version < 9)) {
            RFB.updateState('failed', "WebSockets or Adobe Flash is required");
        } else if (location.href.substr(0, 7) == "file://") {
            RFB.updateState('failed', "'file://' URL is incompatible with Adobe Flash");
        } else {
            WebSocket.__swfLocation = "include/web-socket-js/WebSocketMain.swf";
            RFB.use_seq = true;
            RFB.updateState('disconnected', 'Disconnected');
        }
    }

    /* Populate the controls if defaults are provided in the URL */
    if (RFB.state == 'disconnected') {
        var url = document.location.href;
        $('VNC_host').value = (url.match(/host=([^&#]*)/) || ['',''])[1];
        $('VNC_port').value = (url.match(/port=([^&#]*)/) || ['',''])[1];
        $('VNC_password').value = (url.match(/password=([^&#]*)/) || ['',''])[1];
        $('VNC_encrypt').checked = (url.match(/encrypt=([^&#]*)/) || ['',''])[1];
    }

    console.log("<< RFB.load");
}

}; /* End of RFB */
