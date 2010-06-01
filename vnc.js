/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2010 Joel Martin
 * Licensed under LGPL-3 (see LICENSE.LGPL-3)
 *
 * See README.md for usage and integration instructions.
 */
"use strict";

/*global window, WebSocket, $, Browser, Canvas, Base64, DES */

// Globals defined here
var VNC_native_ws, RFB;


/*
 * Load supporting scripts
 */
(function () {
    var extra, start, end;
    extra = "";
    start = "<script src='";
    end = "'><\/script>";

    // Uncomment to activate firebug lite
    //extra += start + "http://getfirebug.com/releases/lite/1.2/" + 
    //         firebug-lite-compressed.js" + end;

    extra += start + "include/mootools.js" + end;
    extra += start + "include/base64.js" + end;
    extra += start + "include/des.js" + end;
    extra += start + "include/util.js" + end;
    extra += start + "include/canvas.js" + end;

    /* If no builtin websockets then load web_socket.js */
    if (window.WebSocket) {
        VNC_native_ws = true;
    } else {
        VNC_native_ws = false;
        extra += start + "include/web-socket-js/swfobject.js" + end;
        extra += start + "include/web-socket-js/FABridge.js" + end;
        extra += start + "include/web-socket-js/web_socket.js" + end;
    }
    document.write(extra);
}());

/*
 * RFB namespace
 */

RFB = {

ws             : null,  // Web Socket object
sendID         : null,
use_seq        : false,
b64encode      : true,

// Receive and send queues
RQ             : [],  // Receive Queue
RQ_reorder     : [],  // Receive Queue re-order list
RQ_seq_num     : 0,   // Expected sequence number
SQ             : "",  // Send Queue

// Frame buffer update state
FBU            : {
    rects          : 0,
    subrects       : 0,  // RRE and HEXTILE
    lines          : 0,  // RAW
    tiles          : 0,  // HEXTILE
    bytes          : 0,
    x              : 0,
    y              : 0,
    width          : 0, 
    height         : 0,
    encoding       : 0,
    subencoding    : -1,
    background     : null
},

true_color     : false,
fb_Bpp         : 4,
fb_depth       : 3,

// DOM objects
statusLine     : null,
connectBtn     : null,
clipboard      : null,

max_version    : 3.8,
version        : 0,
auth_scheme    : '',
state          : 'disconnected',
cuttext        : 'none', // ServerCutText wait state
ct_length      : 0,
clipboardFocus : false,

shared         : 1,
check_rate     : 217,
req_rate       : 1413,
last_req       : 0,

host           : '',
port           : 5900,
password       : '',

fb_width       : 0,
fb_height      : 0,
fb_name        : "",
rre_chunk      : 100,

timing         : {
    last_fbu       : 0,
    fbu_total      : 0,
    fbu_total_cnt  : 0,
    full_fbu_total : 0,
    full_fbu_cnt   : 0,

    fbu_rt_start   : 0,
    fbu_rt_total   : 0,
    fbu_rt_cnt     : 0,
},

/* Mouse state */
mouse_buttonmask : 0,
mouse_arr        : [],


/*
 * Server message handlers
 */

/* RFB/VNC initialisation */
init_msg: function () {
    console.log(">> init_msg [RFB.state '" + RFB.state + "']");

    var RQ = RFB.RQ, strlen, reason, reason_len,
        sversion, cversion, types, num_types, challenge, response,
        bpp, depth, big_endian, true_color, name_length;

    //console.log("RQ (" + RQ.length + ") " + RQ);
    switch (RFB.state) {

    case 'ProtocolVersion' :
        if (RQ.length < 12) {
            RFB.updateState('failed',
                    "Disconnected: incomplete protocol version");
            return;
        }
        sversion = RQ.shiftStr(12).substr(4,7);
        console.log("Server ProtocolVersion: " + sversion);
        switch (sversion) {
            case "003.003": RFB.version = 3.3; break;
            case "003.007": RFB.version = 3.7; break;
            case "003.008": RFB.version = 3.8; break;
            default:
                RFB.updateState('failed',
                        "Invalid server version " + sversion);
                return;
        }
        if (RFB.version > RFB.max_version) { 
            RFB.version = RFB.max_version;
        }

        cversion = "00" + parseInt(RFB.version,10) +
                   ".00" + ((RFB.version * 10) % 10);
        RFB.send_string("RFB " + cversion + "\n");
        RFB.updateState('Security', "Sent ProtocolVersion: " + sversion);
        break;

    case 'Security' :
        if (RFB.version >= 3.7) {
            num_types = RQ.shift8();
            if (num_types === 0) {
                strlen = RQ.shift32();
                reason = RQ.shiftStr(strlen);
                RFB.updateState('failed',
                        "Disconnected: security failure: " + reason);
                return;
            }
            types = RQ.shiftBytes(num_types);
            
            if ((types[0] !== 1) && (types[0] !== 2)) {
                RFB.updateState('failed',
                        "Disconnected: invalid security types list: " + types);
                return;
            }

            if (RFB.password.length === 0) {
                RFB.auth_scheme = 1;
            } else {
                RFB.auth_scheme = types[0];
            }
            RFB.send_array([RFB.auth_scheme]);
        } else {
            if (RQ.length < 4) {
                RFB.updateState('failed', "Invalid security frame");
                return;
            }
            RFB.auth_scheme = RQ.shift32();
        }
        RFB.updateState('Authentication',
                "Authenticating using scheme: " + RFB.auth_scheme);
        // Fall through

    case 'Authentication' :
        console.log("Security auth scheme: " + RFB.auth_scheme);
        switch (RFB.auth_scheme) {
            case 0:  // connection failed
                if (RQ.length < 4) {
                    console.log("   waiting for auth reason bytes");
                    return;
                }
                strlen = RQ.shift32();
                reason = RQ.shiftStr(strlen);
                RFB.updateState('failed',
                        "Disconnected: auth failure: " + reason);
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
                challenge = RQ.shiftBytes(16);
                //console.log("Password: " + RFB.password);
                //console.log("Challenge: " + challenge +
                //            " (" + challenge.length + ")");
                response = RFB.DES(RFB.password, challenge);
                //console.log("Response: " + response +
                //            " (" + response.length + ")");
                
                console.log("Sending DES encrypted auth response");
                RFB.send_array(response);
                RFB.updateState('SecurityResult');
                break;
            default:
                RFB.updateState('failed',
                        "Disconnected: unsupported auth scheme: " +
                        RFB.auth_scheme);
                return;
        }
        break;

    case 'SecurityResult' :
        if (RQ.length < 4) {
            RFB.updateState('failed', "Invalid VNC auth response");
            return;
        }
        switch (RQ.shift32()) {
            case 0:  // OK
                RFB.updateState('ServerInitialisation', "Authentication OK");
                break;
            case 1:  // failed
                if (RFB.version >= 3.8) {
                    reason_len = RQ.shift32();
                    reason = RQ.shiftStr(reason_len);
                    RFB.updateState('failed', reason);
                } else {
                    RFB.updateState('failed', "Authentication failed");
                }
                return;
            case 2:  // too-many
                RFB.updateState('failed',
                        "Disconnected: too many auth attempts");
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

        /* PIXEL_FORMAT */
        bpp            = RQ.shift8();
        depth          = RQ.shift8();
        big_endian     = RQ.shift8();
        true_color     = RQ.shift8();

        console.log("Screen: " + RFB.fb_width + "x" + RFB.fb_height + 
                    ", bpp: " + bpp + ", depth: " + depth +
                    ", big_endian: " + big_endian +
                    ", true_color: " + true_color);

        /* Connection name/title */
        RQ.shiftStr(12);
        name_length   = RQ.shift32();
        RFB.fb_name = RQ.shiftStr(name_length);

        Canvas.init('VNC_canvas', RFB.fb_width, RFB.fb_height, RFB.true_color,
                RFB.keyDown, RFB.keyUp, RFB.mouseDown, RFB.mouseUp,
                RFB.mouseMove, RFB.mouseWheel);

        if (RFB.true_color) {
            RFB.fb_Bpp           = 4;
            RFB.fb_depth         = 3;
        } else {
            RFB.fb_Bpp           = 1;
            RFB.fb_depth         = 1;
        }

        response = RFB.pixelFormat();
        response = response.concat(RFB.encodings());
        response = response.concat(RFB.fbUpdateRequest(0));
        RFB.timing.fbu_rt_start = (new Date()).getTime();
        RFB.send_array(response);
        
        /* Start pushing/polling */
        RFB.checkEvents.delay(RFB.check_rate);

        RFB.updateState('normal', "Connected to: " + RFB.fb_name);
        break;
    }
    //console.log("<< init_msg");
},


/* Normal RFB/VNC server messages */
normal_msg: function () {
    //console.log(">> normal_msg");

    var RQ = RFB.RQ, FBU = RFB.FBU, now, fbu_rt_diff,
        ret = true, msg_type, msg,
        c, first_colour, num_colours, red, green, blue;

    if (FBU.rects > 0) {
        msg_type = 0;
    } else if (RFB.cuttext !== 'none') {
        msg_type = 3;
    } else {
        msg_type = RQ.shift8();
    }
    switch (msg_type) {
    case 0:  // FramebufferUpdate
        if (FBU.rects === 0) {
            if (RQ.length < 3) {
                RQ.unshift(msg_type);
                console.log("   waiting for FBU header bytes");
                return false;
            }
            RQ.shift8();
            FBU.rects = RQ.shift16();
            //console.log("FramebufferUpdate, rects:" + FBU.rects);
            RFB.timing.cur_fbu = 0;
            FBU.bytes = 0;
        }

        while ((FBU.rects > 0) && (RQ.length >= FBU.bytes)) {
            if (FBU.bytes === 0) {
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
                msg = "FramebufferUpdate rects:" + FBU.rects +
                          " encoding:" + FBU.encoding
                switch (FBU.encoding) {
                    case 0: msg += "(RAW)"; break;
                    case 1: msg += "(COPY-RECT)"; break;
                    case 2: msg += "(RRE)"; break;
                    case 5: msg += "(HEXTILE " + FBU.tiles + " tiles)"; break;
                    default:
                        RFB.updateState('failed',
                                "Disconnected: unsupported encoding " +
                                FBU.encoding);
                        return false;
                }
                msg += ", RQ.length: " + RQ.length
                console.log(msg);
                */
            }

            RFB.timing.last_fbu = (new Date()).getTime();
            switch (FBU.encoding) {
                case 0: ret = RFB.display_raw();       break; // Raw
                case 1: ret = RFB.display_copy_rect(); break; // Copy-Rect
                case 2: ret = RFB.display_rre();       break; // RRE
                case 5: ret = RFB.display_hextile();   break; // hextile
            }
            now = (new Date()).getTime();
            RFB.timing.cur_fbu += (now - RFB.timing.last_fbu);
            if (FBU.rects === 0) {
                if ((FBU.width === RFB.fb_width) &&
                        (FBU.height === RFB.fb_height)) {
                    RFB.timing.full_fbu_total += RFB.timing.cur_fbu;
                    RFB.timing.full_fbu_cnt += 1;
                    console.log("Timing of full FBU, cur: " +
                                RFB.timing.cur_fbu + ", total: " +
                                RFB.timing.full_fbu_total + ", cnt: " +
                                RFB.timing.full_fbu_cnt + ", avg: " +
                                (RFB.timing.full_fbu_total /
                                 RFB.timing.full_fbu_cnt));
                    if (RFB.timing.fbu_rt_start > 0) {
                        fbu_rt_diff = now - RFB.timing.fbu_rt_start;
                        RFB.timing.fbu_rt_total += fbu_rt_diff;
                        RFB.timing.fbu_rt_cnt += 1;
                        console.log("full FBU round-trip, cur: " +
                                fbu_rt_diff + ", total: " +
                                RFB.timing.fbu_rt_total + ", cnt: " +
                                RFB.timing.fbu_rt_cnt + ", avg: " +
                                (RFB.timing.fbu_rt_total /
                                 RFB.timing.fbu_rt_cnt));
                        RFB.timing.fbu_rt_start = 0;
                    }
                }
            }
            if (RFB.state !== "normal") { return true; }
        }

        break;
    case 1:  // SetColourMapEntries
        console.log("SetColourMapEntries");
        RQ.shift8();  // Padding
        first_colour = RQ.shift16(); // First colour
        num_colours = RQ.shift16();
        for (c=0; c < num_colours; c++) { 
            red = RQ.shift16();
            //console.log("red before: " + red);
            red = parseInt(red / 256, 10);
            //console.log("red after: " + red);
            green = parseInt(RQ.shift16() / 256, 10);
            blue = parseInt(RQ.shift16() / 256, 10);
            Canvas.colourMap[first_colour + c] = [red, green, blue];
        }
        console.log("Registered " + num_colours + " colourMap entries");
        //console.log("colourMap: " + Canvas.colourMap);
        break;
    case 2:  // Bell
        console.log("Bell (unsupported)");
        break;
    case 3:  // ServerCutText
        console.log("ServerCutText");
        console.log("RQ:" + RQ.slice(0,20));
        if (RFB.cuttext === 'none') {
            RFB.cuttext = 'header';
        }
        if (RFB.cuttext === 'header') {
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
        RFB.updateState('failed',
                "Disconnected: illegal server message type " + msg_type);
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

    var RQ = RFB.RQ, FBU = RFB.FBU, cur_y, cur_height; 

    if (FBU.lines === 0) {
        FBU.lines = FBU.height;
    }
    FBU.bytes = FBU.width * RFB.fb_Bpp; // At least a line
    if (RQ.length < FBU.bytes) {
        //console.log("   waiting for " +
        //            (FBU.bytes - RQ.length) + " RAW bytes");
        return;
    }
    cur_y = FBU.y + (FBU.height - FBU.lines);
    cur_height = Math.min(FBU.lines,
                          Math.floor(RQ.length/(FBU.width * RFB.fb_Bpp)));
    Canvas.blitImage(FBU.x, cur_y, FBU.width, cur_height, RQ, 0);
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

    var RQ = RFB.RQ, FBU = RFB.FBU, old_x, old_y;

    if (RQ.length < 4) {
        //console.log("   waiting for " +
        //            (FBU.bytes - RQ.length) + " COPY-RECT bytes");
        return;
    }
    old_x = RQ.shift16();
    old_y = RQ.shift16();
    Canvas.copyImage(old_x, old_y, FBU.x, FBU.y, FBU.width, FBU.height);
    FBU.rects --;
    FBU.bytes = 0;
},

display_rre: function () {
    //console.log(">> display_rre (" + RFB.RQ.length + " bytes)");
    var RQ = RFB.RQ, FBU = RFB.FBU, color, x, y, width, height, chunk;
    if (FBU.subrects === 0) {
        if (RQ.length < 4 + RFB.fb_Bpp) {
            //console.log("   waiting for " +
            //            (4 + RFB.fb_Bpp - RQ.length) + " RRE bytes");
            return;
        }
        FBU.subrects = RQ.shift32();
        color = RQ.shiftBytes(RFB.fb_Bpp); // Background
        Canvas.fillRect(FBU.x, FBU.y, FBU.width, FBU.height, color);
    }
    while ((FBU.subrects > 0) && (RQ.length >= (RFB.fb_Bpp + 8))) {
        color = RQ.shiftBytes(RFB.fb_Bpp);
        x = RQ.shift16();
        y = RQ.shift16();
        width = RQ.shift16();
        height = RQ.shift16();
        Canvas.fillRect(FBU.x + x, FBU.y + y, width, height, color);
        FBU.subrects --;
    }
    //console.log("   display_rre: rects: " + FBU.rects +
    //            ", FBU.subrects: " + FBU.subrects);

    if (FBU.subrects > 0) {
        chunk = Math.min(RFB.rre_chunk, FBU.subrects);
        FBU.bytes = (RFB.fb_Bpp + 8) * chunk;
    } else {
        FBU.rects --;
        FBU.bytes = 0;
    }
    //console.log("<< display_rre, FBU.bytes: " + FBU.bytes);
},

display_hextile: function() {
    //console.log(">> display_hextile");
    var RQ = RFB.RQ, FBU = RFB.FBU,
        subencoding, subrects, idx, tile, color, cur_tile,
        tile_x, x, w, tile_y, y, h, xy, s, sx, sy, wh, sw, sh;

    if (FBU.tiles === 0) {
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
            RFB.updateState('failed',
                    "Disconnected: illegal hextile subencoding " + subencoding);
            console.log("RQ.slice(0,30):" + RQ.slice(0,30));
            return;
        }
        subrects = 0;
        cur_tile = FBU.total_tiles - FBU.tiles;
        tile_x = cur_tile % FBU.tiles_x;
        tile_y = Math.floor(cur_tile / FBU.tiles_x);
        x = FBU.x + tile_x * 16;
        y = FBU.y + tile_y * 16;
        w = Math.min(16, (FBU.x + FBU.width) - x);
        h = Math.min(16, (FBU.y + FBU.height) - y);

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

        //console.log("   tile:" + cur_tile + "/" + (FBU.total_tiles - 1) +
        //            ", subencoding:" + subencoding +
        //            "(last: " + FBU.lastsubencoding + "), subrects:" +
        //            subrects + ", tile:" + tile_x + "," + tile_y +
        //            " [" + x + "," + y + "]@" + w + "x" + h +
        //            ", d.length:" + RQ.length + ", bytes:" + FBU.bytes +
        //            " last:" + RQ.slice(FBU.bytes-10, FBU.bytes) +
        //            " next:" + RQ.slice(FBU.bytes-1, FBU.bytes+10));
        if (RQ.length < FBU.bytes) {
            //console.log("   waiting for " +
            //            (FBU.bytes - RQ.length) + " hextile bytes");
            return;
        }

        /* We know the encoding and have a whole tile */
        FBU.subencoding = RQ[0];
        idx = 1;
        if (FBU.subencoding === 0) {
            if (FBU.lastsubencoding & 0x01) {
                /* Weird: ignore blanks after RAW */
                console.log("     Ignoring blank after RAW");
            } else {
                Canvas.fillRect(x, y, w, h, FBU.background);
            }
        } else if (FBU.subencoding & 0x01) { // Raw
            Canvas.blitImage(x, y, w, h, RQ, idx);
        } else {
            if (FBU.subencoding & 0x02) { // Background
                FBU.background = RQ.slice(idx, idx + RFB.fb_Bpp);
                idx += RFB.fb_Bpp;
            }
            if (FBU.subencoding & 0x04) { // Foreground
                FBU.foreground = RQ.slice(idx, idx + RFB.fb_Bpp);
                idx += RFB.fb_Bpp;
            }

            tile = Canvas.getTile(x, y, w, h, FBU.background);
            if (FBU.subencoding & 0x08) { // AnySubrects
                subrects = RQ[idx];
                idx++;
                for (s = 0; s < subrects; s ++) {
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

    if (FBU.tiles === 0) {
        FBU.rects --;
    }

    //console.log("<< display_hextile");
},



/*
 * Client message routines
 */

pixelFormat: function () {
    //console.log(">> setPixelFormat");
    var arr;
    arr = [0];     // msg-type
    arr.push8(0);  // padding
    arr.push8(0);  // padding
    arr.push8(0);  // padding

    arr.push8(RFB.fb_Bpp * 8); // bits-per-pixel
    arr.push8(RFB.fb_depth * 8); // depth
    arr.push8(0);  // little-endian
    arr.push8(RFB.true_color);  // true-color

    arr.push16(255);  // red-max
    arr.push16(255);  // green-max
    arr.push16(255);  // blue-max
    arr.push8(0);     // red-shift
    arr.push8(8);     // green-shift
    arr.push8(16);    // blue-shift

    arr.push8(0);     // padding
    arr.push8(0);     // padding
    arr.push8(0);     // padding
    //console.log("<< setPixelFormat");
    return arr;
},

fixColourMapEntries: function () {
},

encodings: function () {
    //console.log(">> setEncodings");
    var arr;
    arr = [2];     // msg-type
    arr.push8(0);  // padding

    //arr.push16(3); // encoding count
    arr.push16(4); // encoding count
    arr.push32(5); // hextile encoding

    arr.push32(2); // RRE encoding
    arr.push32(1); // copy-rect encoding
    arr.push32(0); // raw encoding
    //console.log("<< setEncodings");
    return arr;
},

fbUpdateRequest: function (incremental, x, y, xw, yw) {
    //console.log(">> fbUpdateRequest");
    if (!x) { x = 0; }
    if (!y) { y = 0; }
    if (!xw) { xw = RFB.fb_width; }
    if (!yw) { yw = RFB.fb_height; }
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
    //console.log(">> pointerEvent, x,y: " + x + "," + y +
    //            " , mask: " + RFB.mouse_buttonMask);
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

encode_message: function(arr) {
    if (RFB.b64encode) {
        RFB.SQ = RFB.SQ + Base64.encode(arr);
    } else {
        RFB.SQ = RFB.SQ + arr.map(function (num) {
                return String.fromCharCode(num); } ).join('');
    }
},

decode_message: function(data, offset) {
    //console.log(">> decode_message: " + data);
    if (RFB.b64encode) {
        RFB.RQ = RFB.RQ.concat(Base64.decode(data, offset));
    } else {
        RFB.RQ = RFB.RQ.concat(data.split('').slice(offset).
                map(function (chr) {
                    return (chr.charCodeAt(0) % 256); }));
    }
    //console.log(">> decode_message, RQ: " + RFB.RQ);
},

recv_message: function(e) {
    //console.log(">> recv_message");

    try {
        if (RFB.use_seq) {
            RFB.recv_message_reorder(e);
        } else {
            RFB.decode_message(e.data, 0);

            RFB.handle_message();
        }
    } catch (exc) {
        console.log("recv_message, caught exception: " + exc);
        if (typeof exc.name !== 'undefined') {
            RFB.updateState('failed', exc.name + ": " + exc.message);
        } else {
            RFB.updateState('failed', exc);
        }
    }
    //console.log("<< recv_message");
},

recv_message_reorder: function(e) {
    //console.log(">> recv_message_reorder");

    var RQ_reorder = RFB.RQ_reorder, offset, seq_num, i;

    offset = e.data.indexOf(":") + 1;
    seq_num = parseInt(e.data.substr(0, offset-1), 10);
    if (RFB.RQ_seq_num === seq_num) {
        RFB.decode_message(e.data, offset);
        RFB.RQ_seq_num++;
    } else {
        console.warn("sequence number mismatch: expected " +
                     RFB.RQ_seq_num + ", got " + seq_num);
        if (RFB.RQ_reorder.length > 20) {
            RFB.updateState('failed', "Re-order queue too long");
        } else {
            RFB.RQ_reorder = RFB.RQ_reorder.concat(e.data.substr(0));
            i = 0;
            while (i < RFB.RQ_reorder.length) {
                offset = RFB.RQ_reorder[i].indexOf(":") + 1;
                seq_num = parseInt(RFB.RQ_reorder[i].substr(0, offset-1), 10);
                //console.log("Searching reorder list item " +
                //            i + ", seq_num " + seq_num);
                if (seq_num === RFB.RQ_seq_num) {
                    /* Remove it from reorder queue, decode it and
                        * add it to the receive queue */
                    console.log("Found re-ordered packet seq_num " + seq_num);
                    RFB.decode_message(RFB.RQ_reorder.splice(i, 1)[0], offset);
                    RFB.RQ_seq_num++;
                    i = 0;  // Start search again for next one
                } else {
                    i++;
                }
            }
            
        }
    }

    if (RFB.RQ.length > 0) {
        RFB.handle_message();
    }
    //console.log("<< recv_message_reorder");
},

handle_message: function () {
    switch (RFB.state) {
    case 'disconnected':
        console.error("Got data while disconnected");
        break;
    case 'failed':
        console.log("Giving up!");
        RFB.disconnect();
        break;
    case 'normal':
        RFB.normal_msg();
        /*
        while (RFB.RQ.length > 0) {
            if (RFB.normal_msg() && RFB.state === 'normal') {
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
        function (chr) { return chr.charCodeAt(0); } ) );
},

send_array: function (arr) {
    //console.log(">> send_array: " + arr);
    RFB.encode_message(arr);
    if (RFB.ws.bufferedAmount === 0) {
        RFB.ws.send(RFB.SQ);
        RFB.SQ = "";
    } else {
        console.log("Delaying send");
    }
},

DES: function (password, challenge) {
    var i, passwd, response;
    passwd = [];
    response = challenge.slice();
    for (i=0; i < password.length; i++) {
        passwd.push(password.charCodeAt(i));
    }

    DES.setKeys(passwd);
    DES.encrypt(response, 0, response, 0);
    DES.encrypt(response, 8, response, 8);
    return response;
},

flushClient: function () {
    if (RFB.mouse_arr.length > 0) {
        //RFB.send_array(RFB.mouse_arr.concat(RFB.fbUpdateRequest(1)));
        RFB.send_array(RFB.mouse_arr);
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
    var now;
    if (RFB.state === 'normal') {
        if (! RFB.flushClient()) {
            now = new Date().getTime();
            if (now > RFB.last_req + RFB.req_rate) {
                RFB.last_req = now;
                RFB.send_array(RFB.fbUpdateRequest(1));
            }
        }
    }
    RFB.checkEvents.delay(RFB.check_rate);
},

keyX: function (e, down) {
    var arr;
    if (RFB.clipboardFocus) {
        return true;
    }
    e.stop();
    arr = RFB.keyEvent(Canvas.getKeysym(e), down);
    arr = arr.concat(RFB.fbUpdateRequest(1));
    RFB.send_array(arr);
},

keyDown: function (e) {
    //console.log(">> keyDown: " + Canvas.getKeysym(e));
    RFB.keyX(e, 1);
},

keyUp: function (e) {
    //console.log(">> keyUp: " + Canvas.getKeysym(e));
    RFB.keyX(e, 0);
},

mouseDown: function(e) {
    var evt, x, y;
    evt = e.event || window.event;
    x = (evt.clientX - Canvas.c_x);
    y = (evt.clientY - Canvas.c_y);
    //console.log(">> mouseDown " + evt.which + "/" + evt.button +
    //            " " + x + "," + y);
    RFB.mouse_buttonMask |= 1 << evt.button;
    RFB.mouse_arr = RFB.mouse_arr.concat( RFB.pointerEvent(x, y) );

    RFB.flushClient();
},

mouseUp: function(e) {
    var evt, x, y;
    evt = e.event || window.event;
    x = (evt.clientX - Canvas.c_x);
    y = (evt.clientY - Canvas.c_y);
    //console.log(">> mouseUp " + evt.which + "/" + evt.button +
    //            " " + x + "," + y);
    RFB.mouse_buttonMask ^= 1 << evt.button;
    RFB.mouse_arr = RFB.mouse_arr.concat( RFB.pointerEvent(x, y) );

    RFB.flushClient();
},

mouseMove: function(e) {
    var evt, x, y;
    evt = e.event || window.event;
    x = (evt.clientX - Canvas.c_x);
    y = (evt.clientY - Canvas.c_y);
    //console.log('>> mouseMove ' + x + "," + y);
    RFB.mouse_arr = RFB.mouse_arr.concat( RFB.pointerEvent(x, y) );
},

mouseWheel: function (e) {
    var evt, wheelData, bmask;
    evt = e.event || window.event;
    //e = e ? e : window.event;
    x = (evt.clientX - Canvas.c_x);
    y = (evt.clientY - Canvas.c_y);
    wheelData = evt.detail ? evt.detail * -1 : evt.wheelDelta / 40;
    //console.log('>> mouseWheel ' + wheelData +
    //            " " + x + "," + y);

    if (wheelData > 0) {
        bmask = 1 << 3;
    } else {
        bmask = 1 << 4;
    }
    RFB.mouse_buttonMask |= bmask;
    RFB.mouse_arr = RFB.mouse_arr.concat( RFB.pointerEvent(x, y) );
    RFB.mouse_buttonMask ^= bmask;
    RFB.mouse_arr = RFB.mouse_arr.concat( RFB.pointerEvent(x, y) );
    RFB.flushClient();
},


clipboardCopyTo: function (text) {
    console.log(">> clipboardCopyTo: " + text.substr(0,40) + "...");
    RFB.clipboard.value = text;
    console.log("<< clipboardCopyTo");
},

clipboardPasteFrom: function () {
    var text;
    if (RFB.state !== "normal") { return; }
    text = RFB.clipboard.value;
    console.log(">> clipboardPasteFrom: " + text.substr(0,40) + "...");
    RFB.send_array(RFB.clientCutText(text));
    console.log("<< clipboardPasteFrom");
},

clipboardClear: function () {
    RFB.clipboard.value = '';
    RFB.clipboardPasteFrom();
},

updateState: function(state, statusMsg) {
    var s, c, func, klass, cmsg;
    s = RFB.statusLine;
    c = RFB.connectBtn;
    func = function(msg) { console.log(msg); };
    switch (state) {
        case 'failed':
            func = function(msg) { console.error(msg); };
            c.disabled = true;
            klass = "error";
            break;
        case 'normal':
            c.value = "Disconnect";
            c.onclick = RFB.disconnect;
            c.disabled = false;
            klass = "normal";
            break;
        case 'disconnected':
            c.value = "Connect";
            c.onclick = function () { RFB.connect(); };

            c.disabled = false;
            klass = "normal";
            break;
        default:
            func = function(msg) { console.warn(msg); };
            c.disabled = true;
            klass = "warn";
            break;
    }

    if ((RFB.state === 'failed') &&
        ((state === 'disconnected') || (state === 'closed'))) {
        // Leave the failed message
        return;
    }

    RFB.state = state;
    s.setAttribute("class", "VNC_status_" + klass);
    cmsg = typeof(statusMsg) !== 'undefined' ? (" Msg: " + statusMsg) : "";
    func("New state '" + state + "'." + cmsg);
    if (typeof(statusMsg) !== 'undefined') {
        s.innerHTML = statusMsg;
    }
},

/*
 * Setup routines
 */

init_ws: function () {
    console.log(">> init_ws");

    var uri = "", vars = [];
    if (RFB.encrypt) {
        uri = "wss://";
    } else {
        uri = "ws://";
    }
    uri += RFB.host + ":" + RFB.port + "/";
    if (RFB.b64encode) {
        vars.push("b64encode");
    }
    if (RFB.use_seq) {
        vars.push("seq_num");
    }
    if (vars.length > 0) {
        uri += "?" + vars.join("&");
    }
    console.log("connecting to " + uri);
    RFB.ws = new WebSocket(uri);

    RFB.ws.onmessage = RFB.recv_message;
    RFB.ws.onopen = function(e) {
        console.log(">> WebSocket.onopen");
        RFB.updateState('ProtocolVersion', "Starting VNC handshake");
        RFB.sendID = setInterval(function() {
                /*
                 * Send updates either at a rate of one update every 50ms,
                 * or whatever slower rate the network can handle
                 */
                if (RFB.ws.bufferedAmount === 0) {
                    if (RFB.SQ) {
                        RFB.ws.send(RFB.SQ);
                        RFB.SQ = "";
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
        RFB.updateState('disconnected', 'VNC disconnected');
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
    RFB.cuttext          = 'none';
    RFB.ct_length        = 0;
    RFB.RQ               = [];
    RFB.RQ_reorder       = [];
    RFB.RQ_seq_num       = 0;
    RFB.SQ               = "";
    RFB.FBU.rects        = 0;
    RFB.FBU.subrects     = 0;  // RRE and HEXTILE
    RFB.FBU.lines        = 0;  // RAW
    RFB.FBU.tiles        = 0;  // HEXTILE
    RFB.mouse_buttonmask = 0;
    RFB.mouse_arr        = [];
},


connect: function (host, port, password, encrypt, true_color) {
    console.log(">> connect");

    RFB.host = (host !== undefined)         ? host :
                                              $('VNC_host').value;
    RFB.port = (port !== undefined)         ? port :
                                              $('VNC_port').value;
    RFB.password = (password !== undefined) ? password :
                                              $('VNC_password').value;
    RFB.encrypt = (encrypt !== undefined)   ? encrypt :
                                              $('VNC_encrypt').checked;
    RFB.true_color = (true_color !== undefined)   ? true_color:
                                              $('VNC_true_color').checked;
    if ((!RFB.host) || (!RFB.port)) {
        alert("Must set host and port");
        return;
    }

    RFB.init_vars();

    if ((RFB.ws) && (RFB.ws.readyState === WebSocket.OPEN)) {
        RFB.ws.close();
    }
    RFB.init_ws();

    RFB.updateState('ProtocolVersion');
    console.log("<< connect");

},

disconnect: function () {
    console.log(">> disconnect");
    if ((RFB.ws) && (RFB.ws.readyState === WebSocket.OPEN)) {
        RFB.updateState('closed');
        RFB.ws.onmessage = function (e) { return; };
        RFB.ws.close();
    }
    if (Canvas.ctx) {
        Canvas.stop();
        if (! /__debug__$/i.test(document.location.href)) {
            Canvas.clear();
        }
    }

    RFB.updateState('disconnected', 'Disconnected');
    console.log("<< disconnect");
},

/* 
 * Load the controls
 */
load: function (target) {
    //console.log(">> load");
    var html, url;

    if (!target) { target = 'vnc'; }

    /* Populate the 'vnc' div */
    html = "";
    if ($('VNC_controls') === null) {
        html += '<div id="VNC_controls">';
        html += '  <ul>';
        html += '    <li>Host: <input id="VNC_host"></li>';
        html += '    <li>Port: <input id="VNC_port"></li>';
        html += '    <li>Password: <input id="VNC_password"';
        html += '        type="password"></li>';
        html += '    <li>Encrypt: <input id="VNC_encrypt"';
        html += '        type="checkbox"></li>';
        html += '    <li>True Color: <input id="VNC_true_color"';
        html += '        type="checkbox" checked></li>';
        html += '    <li><input id="VNC_connect_button" type="button"';
        html += '        value="Loading" disabled></li>';
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
        html += '  <input id="VNC_clipboard_clear_button"';
        html += '      type="button" value="Clear">';
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
        } else if (location.href.substr(0, 7) === "file://") {
            RFB.updateState('failed',
                    "'file://' URL is incompatible with Adobe Flash");
        } else {
            WebSocket.__swfLocation = "include/web-socket-js/WebSocketMain.swf";
            WebSocket.__initialize();
            RFB.use_seq = true;
            RFB.updateState('disconnected', 'Disconnected');
        }
    }

    /* Populate the controls if defaults are provided in the URL */
    if (RFB.state === 'disconnected') {
        url = document.location.href;
        $('VNC_host').value = (url.match(/host=([A-Za-z0-9.\-]*)/) ||
                ['',''])[1];
        $('VNC_port').value = (url.match(/port=([0-9]*)/) ||
                ['',''])[1];
        $('VNC_password').value = (url.match(/password=([^&#]*)/) ||
                ['',''])[1];
        $('VNC_encrypt').checked = (url.match(/encrypt=([A-Za-z0-9]*)/) ||
                ['',''])[1];
    }

    //console.log("<< load");
}

}; /* End of RFB */
