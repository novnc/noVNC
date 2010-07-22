/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2010 Joel Martin
 * Licensed under LGPL-3 (see LICENSE.LGPL-3)
 *
 * See README.md for usage and integration instructions.
 */

"use strict";
/*jslint white: false, nomen: false, browser: true, bitwise: false */
/*global window, WebSocket, Util, Canvas, VNC_native_ws, Base64, DES */

// Globals defined here
var RFB;

/*
 * RFB namespace
 */

RFB = {

/* 
 * External interface variables and methods
 */
host           : '',
port           : 5900,
password       : '',

encrypt        : true,
true_color     : false,
b64encode      : true,  // false means UTF-8 on the wire
local_cursor   : true,
connectTimeout : 2000,  // time to wait for connection


// In preference order
encodings      : [
    ['COPYRECT',         0x01, 'display_copy_rect'],
    ['TIGHT_PNG',        -260, 'display_tight_png'],
    ['HEXTILE',          0x05, 'display_hextile'],
    ['RRE',              0x02, 'display_rre'],
    ['RAW',              0x00, 'display_raw'],
    ['DesktopSize',      -223, 'set_desktopsize'],
    ['Cursor',           -239, 'set_cursor'],

    // Psuedo-encoding settings
    ['JPEG_quality_lo',   -32, 'set_jpeg_quality'],
//    ['JPEG_quality_hi',   -23, 'set_jpeg_quality'],
    ['compress_lo',      -255, 'set_compress_level']
//    ['compress_hi',      -247, 'set_compress_level']
    ],


setUpdateState: function(externalUpdateState) {
    RFB.externalUpdateState = externalUpdateState;
},

setClipboardReceive: function(clipReceive) {
    RFB.clipboardCopyTo = clipReceive;
},

setCanvasID: function(canvasID) {
    RFB.canvasID = canvasID;
},

setEncrypt: function(encrypt) {
    if ((!encrypt) || (encrypt in {'0':1, 'no':1, 'false':1})) {
        RFB.encrypt = false;
    } else {
        RFB.encrypt = true;
    }
},

setBase64: function(b64) {
    if ((!b64) || (b64 in {'0':1, 'no':1, 'false':1})) {
        RFB.b64encode = false;
    } else {
        RFB.b64encode = true;
    }
    Util.Debug("Set b64encode to: " + RFB.b64encode);
},

setTrueColor: function(trueColor) {
    if ((!trueColor) || (trueColor in {'0':1, 'no':1, 'false':1})) {
        RFB.true_color = false;
    } else {
        RFB.true_color = true;
    }
},

setCursor: function(cursor) {
    if ((!cursor) || (cursor in {'0':1, 'no':1, 'false':1})) {
        RFB.local_cursor = false;
    } else {
        if (Canvas.isCursor()) {
            RFB.local_cursor = true;
        } else {
            Util.Warn("Browser does not support local cursor");
        }
    }
},

sendPassword: function(passwd) {
    RFB.password = passwd;
    RFB.state = "Authentication";
    setTimeout(RFB.init_msg, 1);
},

sendCtrlAltDel: function() {
    if (RFB.state !== "normal") { return false; }
    Util.Info("Sending Ctrl-Alt-Del");
    var arr = [];
    arr = arr.concat(RFB.keyEvent(0xFFE3, 1)); // Control
    arr = arr.concat(RFB.keyEvent(0xFFE9, 1)); // Alt
    arr = arr.concat(RFB.keyEvent(0xFFFF, 1)); // Delete
    arr = arr.concat(RFB.keyEvent(0xFFFF, 0)); // Delete
    arr = arr.concat(RFB.keyEvent(0xFFE9, 0)); // Alt
    arr = arr.concat(RFB.keyEvent(0xFFE3, 0)); // Control
    arr = arr.concat(RFB.fbUpdateRequest(1));
    RFB.send_array(arr);
},

load: function () {
    var i;
    //Util.Debug(">> load");

    /* Load web-socket-js if no builtin WebSocket support */
    if (VNC_native_ws) {
        Util.Info("Using native WebSockets");
        RFB.updateState('loaded', 'noVNC ready (using native WebSockets)');
    } else {
        Util.Warn("Using web-socket-js flash bridge");
        if ((! Util.Flash) ||
            (Util.Flash.version < 9)) {
            RFB.updateState('fatal', "WebSockets or Adobe Flash is required");
        } else if (document.location.href.substr(0, 7) === "file://") {
            RFB.updateState('fatal',
                    "'file://' URL is incompatible with Adobe Flash");
        } else {
            RFB.updateState('loaded', 'noVNC ready (using Flash WebSockets emulation)');
        }
    }

    // Initialize canvas/fxcanvas
    try {
        Canvas.init(RFB.canvasID);
    } catch (exc) {
        RFB.updateState('fatal', "No working Canvas");
    }

    // Populate encoding lookup tables
    RFB.encHandlers = {};
    RFB.encNames = {};
    for (i=0; i < RFB.encodings.length; i+=1) {
        RFB.encHandlers[RFB.encodings[i][1]] = RFB[RFB.encodings[i][2]];
        RFB.encNames[RFB.encodings[i][1]] = RFB.encodings[i][0];
    }
    //Util.Debug("<< load");
},

connect: function (host, port, password) {
    //Util.Debug(">> connect");

    RFB.host       = host;
    RFB.port       = port;
    RFB.password   = (password !== undefined)   ? password : "";

    if ((!RFB.host) || (!RFB.port)) {
        RFB.updateState('failed', "Must set host and port");
        return;
    }

    RFB.updateState('connect');
    //Util.Debug("<< connect");

},

disconnect: function () {
    //Util.Debug(">> disconnect");
    RFB.updateState('disconnected', 'Disconnected');
    //Util.Debug("<< disconnect");
},

clipboardPasteFrom: function (text) {
    if (RFB.state !== "normal") { return; }
    //Util.Debug(">> clipboardPasteFrom: " + text.substr(0,40) + "...");
    RFB.send_array(RFB.clientCutText(text));
    //Util.Debug("<< clipboardPasteFrom");
},


/*
 * Private variables and methods
 */

ws             : null,  // Web Socket object
sendID         : null,
scanID         : null,  // TIGHT_PNG render image scanner

// Receive and send queues
RQ             : [],  // Receive Queue
SQ             : "",  // Send Queue

encHandlers    : {},
encNames       : {},

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
    background     : null,
    imgs           : []  // TIGHT_PNG image queue
},

fb_Bpp         : 4,
fb_depth       : 3,

max_version    : 3.8,
version        : 0,
auth_scheme    : '',
state          : 'disconnected',
cuttext        : 'none', // ServerCutText wait state
ct_length      : 0,

shared         : 1,
check_rate     : 217,
scan_imgs_rate : 100,
req_rate       : 1413,
last_req       : 0,

canvasID       : 'VNC_canvas',
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

    history        : [],
    history_start  : 0,
    h_time         : 0,
    h_rects        : 0,
    h_fbus         : 0,
    h_bytes        : 0,
    h_pixels       : 0
},

/* Mouse state */
mouse_buttonmask : 0,
mouse_arr        : [],

/*
 * Server message handlers
 */

/* RFB/VNC initialisation */
init_msg: function () {
    //Util.Debug(">> init_msg [RFB.state '" + RFB.state + "']");

    var RQ = RFB.RQ, strlen, reason, reason_len, sversion, cversion,
        i, types, num_types, challenge, response, bpp, depth,
        big_endian, true_color, name_length;

    //Util.Debug("RQ (" + RQ.length + ") " + RQ);
    switch (RFB.state) {

    case 'ProtocolVersion' :
        if (RQ.length < 12) {
            RFB.updateState('failed',
                    "Disconnected: incomplete protocol version");
            return;
        }
        sversion = RQ.shiftStr(12).substr(4,7);
        Util.Info("Server ProtocolVersion: " + sversion);
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
                    Util.Debug("Delaying send");
                }
            }, 50);

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
            RFB.auth_scheme = 0;
            types = RQ.shiftBytes(num_types);
            for (i=0; i < types.length; i+=1) {
                if ((types[i] > RFB.auth_scheme) && (types[i] < 3)) {
                    RFB.auth_scheme = types[i];
                }
            }
            if (RFB.auth_scheme === 0) {
                RFB.updateState('failed',
                        "Disconnected: unsupported security types: " + types);
                return;
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
        //Util.Debug("Security auth scheme: " + RFB.auth_scheme);
        switch (RFB.auth_scheme) {
            case 0:  // connection failed
                if (RQ.length < 4) {
                    //Util.Debug("   waiting for auth reason bytes");
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
                if (RFB.password.length === 0) {
                    RFB.updateState('password', "Password Required");
                    return;
                }
                if (RQ.length < 16) {
                    //Util.Debug("   waiting for auth challenge bytes");
                    return;
                }
                challenge = RQ.shiftBytes(16);
                //Util.Debug("Password: " + RFB.password);
                //Util.Debug("Challenge: " + challenge +
                //           " (" + challenge.length + ")");
                response = RFB.DES(RFB.password, challenge);
                //Util.Debug("Response: " + response +
                //           " (" + response.length + ")");
                
                //Util.Debug("Sending DES encrypted auth response");
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

        Util.Info("Screen: " + RFB.fb_width + "x" + RFB.fb_height + 
                  ", bpp: " + bpp + ", depth: " + depth +
                  ", big_endian: " + big_endian +
                  ", true_color: " + true_color);

        /* Connection name/title */
        RQ.shiftStr(12);
        name_length   = RQ.shift32();
        RFB.fb_name = RQ.shiftStr(name_length);

        Canvas.resize(RFB.fb_width, RFB.fb_height, RFB.true_color);
        Canvas.start(RFB.keyPress, RFB.mouseButton, RFB.mouseMove);

        if (RFB.true_color) {
            RFB.fb_Bpp           = 4;
            RFB.fb_depth         = 3;
        } else {
            RFB.fb_Bpp           = 1;
            RFB.fb_depth         = 1;
        }

        response = RFB.pixelFormat();
        response = response.concat(RFB.clientEncodings());
        response = response.concat(RFB.fbUpdateRequest(0));
        RFB.timing.fbu_rt_start = (new Date()).getTime();
        RFB.send_array(response);
        
        /* Start pushing/polling */
        setTimeout(RFB.checkEvents, RFB.check_rate);
        setTimeout(RFB.scan_tight_imgs, RFB.scan_imgs_rate);
        RFB.timing.history_start = (new Date()).getTime();
        setTimeout(RFB.update_timings, 1000);

        if (RFB.encrypt) {
            RFB.updateState('normal', "Connected (encrypted) to: " + RFB.fb_name);
        } else {
            RFB.updateState('normal', "Connected (unencrypted) to: " + RFB.fb_name);
        }
        break;
    }
    //Util.Debug("<< init_msg");
},


/* Normal RFB/VNC server messages */
normal_msg: function () {
    //Util.Debug(">> normal_msg");

    var RQ = RFB.RQ, ret = true, msg_type,
        c, first_colour, num_colours, red, green, blue;

    //Util.Debug(">> msg RQ.slice(0,10): " + RQ.slice(0,20));
    //Util.Debug(">> msg RQ.slice(-10,-1): " + RQ.slice(RQ.length-10,RQ.length));
    if (RFB.FBU.rects > 0) {
        msg_type = 0;
    } else if (RFB.cuttext !== 'none') {
        msg_type = 3;
    } else {
        msg_type = RQ.shift8();
    }
    switch (msg_type) {
    case 0:  // FramebufferUpdate
        ret = RFB.framebufferUpdate();
        break;
    case 1:  // SetColourMapEntries
        Util.Debug("SetColourMapEntries");
        RQ.shift8();  // Padding
        first_colour = RQ.shift16(); // First colour
        num_colours = RQ.shift16();
        for (c=0; c < num_colours; c+=1) { 
            red = RQ.shift16();
            //Util.Debug("red before: " + red);
            red = parseInt(red / 256, 10);
            //Util.Debug("red after: " + red);
            green = parseInt(RQ.shift16() / 256, 10);
            blue = parseInt(RQ.shift16() / 256, 10);
            Canvas.colourMap[first_colour + c] = [red, green, blue];
        }
        Util.Info("Registered " + num_colours + " colourMap entries");
        //Util.Debug("colourMap: " + Canvas.colourMap);
        break;
    case 2:  // Bell
        Util.Warn("Bell (unsupported)");
        break;
    case 3:  // ServerCutText
        Util.Debug("ServerCutText");
        Util.Debug("RQ:" + RQ.slice(0,20));
        if (RFB.cuttext === 'none') {
            RFB.cuttext = 'header';
        }
        if (RFB.cuttext === 'header') {
            if (RQ.length < 7) {
                //Util.Debug("waiting for ServerCutText header");
                return false;
            }
            RQ.shiftBytes(3);  // Padding
            RFB.ct_length = RQ.shift32();
        }
        RFB.cuttext = 'bytes';
        if (RQ.length < RFB.ct_length) {
            //Util.Debug("waiting for ServerCutText bytes");
            return false;
        }
        RFB.clipboardCopyTo(RQ.shiftStr(RFB.ct_length));
        RFB.cuttext = 'none';
        break;
    default:
        RFB.updateState('failed',
                "Disconnected: illegal server message type " + msg_type);
        Util.Debug("RQ.slice(0,30):" + RQ.slice(0,30));
        break;
    }
    //Util.Debug("<< normal_msg");
    return ret;
},

framebufferUpdate: function() {
    var RQ = RFB.RQ, FBU = RFB.FBU, timing = RFB.timing,
        now, fbu_rt_diff, last_bytes, last_rects,
        ret = true;

    if (FBU.rects === 0) {
        //Util.Debug("New FBU: RQ.slice(0,20): " + RQ.slice(0,20));
        if (RQ.length < 3) {
            RQ.unshift(0);  // FBU msg_type
            Util.Debug("   waiting for FBU header bytes");
            return false;
        }
        RQ.shift8();
        FBU.rects = RQ.shift16();
        //Util.Debug("FramebufferUpdate, rects:" + FBU.rects);
        FBU.bytes = 0;
        timing.cur_fbu = 0;
        timing.h_fbus += 1;
        if (timing.fbu_rt_start > 0) {
            now = (new Date()).getTime();
            Util.Info("First FBU latency: " + (now - timing.fbu_rt_start));
        }
    }

    while ((FBU.rects > 0) && (RQ.length >= FBU.bytes)) {
        if (FBU.bytes === 0) {
            if (RQ.length < 12) {
                //Util.Debug("   waiting for rect header bytes");
                return false;
            }
            /* New FramebufferUpdate */
            FBU.x      = RQ.shift16();
            FBU.y      = RQ.shift16();
            FBU.width  = RQ.shift16();
            FBU.height = RQ.shift16();
            FBU.encoding = parseInt(RQ.shift32(), 10);
            timing.h_bytes += 12;

            if (RFB.encNames[FBU.encoding]) {
                // Debug:
                /*
                var msg =  "FramebufferUpdate rects:" + FBU.rects;
                msg += " x: " + FBU.x + " y: " + FBU.y
                msg += " width: " + FBU.width + " height: " + FBU.height;
                msg += " encoding:" + FBU.encoding;
                msg += "(" + RFB.encNames[FBU.encoding] + ")";
                msg += ", RQ.length: " + RQ.length;
                Util.Debug(msg);
                */
            } else {
                RFB.updateState('failed',
                        "Disconnected: unsupported encoding " +
                        FBU.encoding);
                return false;
            }
        }

        timing.last_fbu = (new Date()).getTime();
        last_bytes = RQ.length;
        last_rects = FBU.rects;

        ret = RFB.encHandlers[FBU.encoding]();

        now = (new Date()).getTime();
        timing.cur_fbu += (now - timing.last_fbu);
        timing.h_bytes += last_bytes-RQ.length;

        if (FBU.rects < last_rects) {
            // Some work was done
            timing.h_rects += last_rects-FBU.rects;
            timing.h_pixels += FBU.width*FBU.height;
        }

        if (FBU.rects === 0) {
            if (((FBU.width === RFB.fb_width) &&
                        (FBU.height === RFB.fb_height)) ||
                    (timing.fbu_rt_start > 0)) {
                timing.full_fbu_total += timing.cur_fbu;
                timing.full_fbu_cnt += 1;
                Util.Info("Timing of full FBU, cur: " +
                          timing.cur_fbu + ", total: " +
                          timing.full_fbu_total + ", cnt: " +
                          timing.full_fbu_cnt + ", avg: " +
                          (timing.full_fbu_total /
                              timing.full_fbu_cnt));
            }
            if (timing.fbu_rt_start > 0) {
                fbu_rt_diff = now - timing.fbu_rt_start;
                timing.fbu_rt_total += fbu_rt_diff;
                timing.fbu_rt_cnt += 1;
                Util.Info("full FBU round-trip, cur: " +
                          fbu_rt_diff + ", total: " +
                          timing.fbu_rt_total + ", cnt: " +
                          timing.fbu_rt_cnt + ", avg: " +
                          (timing.fbu_rt_total /
                              timing.fbu_rt_cnt));
                timing.fbu_rt_start = 0;
            }
        }

        if (RFB.state !== "normal") { return true; }
    }
    return ret;
},

/*
 * FramebufferUpdate encodings
 */

display_raw: function () {
    //Util.Debug(">> display_raw");

    var RQ = RFB.RQ, FBU = RFB.FBU, cur_y, cur_height; 

    if (FBU.lines === 0) {
        FBU.lines = FBU.height;
    }
    FBU.bytes = FBU.width * RFB.fb_Bpp; // At least a line
    if (RQ.length < FBU.bytes) {
        //Util.Debug("   waiting for " +
        //           (FBU.bytes - RQ.length) + " RAW bytes");
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
        FBU.rects -= 1;
        FBU.bytes = 0;
    }
},

display_copy_rect: function () {
    //Util.Debug(">> display_copy_rect");

    var RQ = RFB.RQ, FBU = RFB.FBU, old_x, old_y;

    if (RQ.length < 4) {
        //Util.Debug("   waiting for " +
        //           (FBU.bytes - RQ.length) + " COPYRECT bytes");
        return;
    }
    old_x = RQ.shift16();
    old_y = RQ.shift16();
    Canvas.copyImage(old_x, old_y, FBU.x, FBU.y, FBU.width, FBU.height);
    FBU.rects -= 1;
    FBU.bytes = 0;
},

display_rre: function () {
    //Util.Debug(">> display_rre (" + RFB.RQ.length + " bytes)");
    var RQ = RFB.RQ, FBU = RFB.FBU, color, x, y, width, height, chunk;
    if (FBU.subrects === 0) {
        if (RQ.length < 4 + RFB.fb_Bpp) {
            //Util.Debug("   waiting for " +
            //           (4 + RFB.fb_Bpp - RQ.length) + " RRE bytes");
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
        FBU.subrects -= 1;
    }
    //Util.Debug("   display_rre: rects: " + FBU.rects +
    //           ", FBU.subrects: " + FBU.subrects);

    if (FBU.subrects > 0) {
        chunk = Math.min(RFB.rre_chunk, FBU.subrects);
        FBU.bytes = (RFB.fb_Bpp + 8) * chunk;
    } else {
        FBU.rects -= 1;
        FBU.bytes = 0;
    }
    //Util.Debug("<< display_rre, FBU.bytes: " + FBU.bytes);
},

display_hextile: function() {
    //Util.Debug(">> display_hextile");
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
            //Util.Debug("   waiting for HEXTILE subencoding byte");
            return;
        }
        subencoding = RQ[0];  // Peek
        if (subencoding > 30) { // Raw
            RFB.updateState('failed',
                    "Disconnected: illegal hextile subencoding " + subencoding);
            //Util.Debug("RQ.slice(0,30):" + RQ.slice(0,30));
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
            //Util.Debug("   Raw subencoding");
            FBU.bytes += w * h * RFB.fb_Bpp;
        } else {
            if (subencoding & 0x02) { // Background
                FBU.bytes += RFB.fb_Bpp;
            }
            if (subencoding & 0x04) { // Foreground
                FBU.bytes += RFB.fb_Bpp;
            }
            if (subencoding & 0x08) { // AnySubrects
                FBU.bytes += 1;   // Since we aren't shifting it off
                if (RQ.length < FBU.bytes) {
                    /* Wait for subrects byte */
                    //Util.Debug("   waiting for hextile subrects header byte");
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

        //Util.Debug("   tile:" + cur_tile + "/" + (FBU.total_tiles - 1) +
        //      ", subencoding:" + subencoding +
        //      "(last: " + FBU.lastsubencoding + "), subrects:" +
        //      subrects + ", tile:" + tile_x + "," + tile_y +
        //      " [" + x + "," + y + "]@" + w + "x" + h +
        //      ", d.length:" + RQ.length + ", bytes:" + FBU.bytes +
        //      " last:" + RQ.slice(FBU.bytes-10, FBU.bytes) +
        //      " next:" + RQ.slice(FBU.bytes-1, FBU.bytes+10));
        if (RQ.length < FBU.bytes) {
            //Util.Debug("   waiting for " +
            //           (FBU.bytes - RQ.length) + " hextile bytes");
            return;
        }

        /* We know the encoding and have a whole tile */
        FBU.subencoding = RQ[0];
        idx = 1;
        if (FBU.subencoding === 0) {
            if (FBU.lastsubencoding & 0x01) {
                /* Weird: ignore blanks after RAW */
                Util.Debug("     Ignoring blank after RAW");
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
                idx += 1;
                for (s = 0; s < subrects; s += 1) {
                    if (FBU.subencoding & 0x10) { // SubrectsColoured
                        color = RQ.slice(idx, idx + RFB.fb_Bpp);
                        idx += RFB.fb_Bpp;
                    } else {
                        color = FBU.foreground;
                    }
                    xy = RQ[idx];
                    idx += 1;
                    sx = (xy >> 4);
                    sy = (xy & 0x0f);

                    wh = RQ[idx];
                    idx += 1;
                    sw = (wh >> 4)   + 1;
                    sh = (wh & 0x0f) + 1;

                    Canvas.setSubTile(tile, sx, sy, sw, sh, color);
                }
            }
            Canvas.putTile(tile);
        }
        RQ.shiftBytes(FBU.bytes);
        FBU.lastsubencoding = FBU.subencoding;
        FBU.bytes = 0;
        FBU.tiles -= 1;
    }

    if (FBU.tiles === 0) {
        FBU.rects -= 1;
    }

    //Util.Debug("<< display_hextile");
},


display_tight_png: function() {
    //Util.Debug(">> display_tight_png");
    var RQ = RFB.RQ, FBU = RFB.FBU, 
        ctl, cmode, clength, getCLength, color, img;
    //Util.Debug("   FBU.rects: " + FBU.rects);
    //Util.Debug("   RQ.length: " + RQ.length);
    //Util.Debug("   RQ.slice(0,20): " + RQ.slice(0,20));


    FBU.bytes = 1; // compression-control byte
    if (RQ.length < FBU.bytes) {
        Util.Debug("   waiting for TIGHT compression-control byte");
        return;
    }

    // Get 'compact length' header and data size
    getCLength = function (arr, offset) {
        var header = 1, data = 0;
        data += arr[offset + 0] & 0x7f;
        if (arr[offset + 0] & 0x80) {
            header += 1;
            data += (arr[offset + 1] & 0x7f) << 7;
            if (arr[offset + 1] & 0x80) {
                header += 1;
                data += arr[offset + 2] << 14;
            }
        }
        return [header, data];
    };

    ctl = RQ[0];
    switch (ctl >> 4) {
        case 0x08: cmode = "fill"; break;
        case 0x09: cmode = "jpeg"; break;
        case 0x0A: cmode = "png";  break;
        default:   throw("Illegal basic compression received, ctl: " + ctl);
    }
    switch (cmode) {
        // fill uses fb_depth because TPIXELs drop the padding byte
        case "fill": FBU.bytes += RFB.fb_depth; break; // TPIXEL
        case "jpeg": FBU.bytes += 3;            break; // max clength
        case "png":  FBU.bytes += 3;            break; // max clength
    }

    if (RQ.length < FBU.bytes) {
        Util.Debug("   waiting for TIGHT " + cmode + " bytes");
        return;
    }

    //Util.Debug("   RQ.slice(0,20): " + RFB.RQ.slice(0,20) + " (" + RFB.RQ.length + ")");
    //Util.Debug("   cmode: " + cmode);

    // Determine FBU.bytes
    switch (cmode) {
    case "fill":
        RQ.shift8(); // shift off ctl
        color = RQ.shiftBytes(RFB.fb_depth);
        Canvas.fillRect(FBU.x, FBU.y, FBU.width, FBU.height, color);
        break;
    case "jpeg":
    case "png":
        clength = getCLength(RQ, 1);
        FBU.bytes = 1 + clength[0] + clength[1]; // ctl + clength size + jpeg-data
        if (RQ.length < FBU.bytes) {
            Util.Debug("   waiting for TIGHT " + cmode + " bytes");
            return;
        }

        // We have everything, render it
        //Util.Debug("   png, RQ.length: " + RQ.length + ", clength[0]: " + clength[0] + ", clength[1]: " + clength[1]);
        RQ.shiftBytes(1 + clength[0]); // shift off ctl + compact length
        img = new Image();
        img.onload = RFB.scan_tight_imgs;
        FBU.imgs.push([img, FBU.x, FBU.y]);
        img.src = "data:image/" + cmode +
            RFB.extract_data_uri(RQ.shiftBytes(clength[1]));
        img = null;
        break;
    }
    FBU.bytes = 0;
    FBU.rects -= 1;
    //Util.Debug("   ending RQ.length: " + RQ.length);
    //Util.Debug("   ending RQ.slice(0,20): " + RQ.slice(0,20));
    //Util.Debug("<< display_tight_png");
},

extract_data_uri : function (arr) {
    //var i, stra = [];
    //for (i=0; i< arr.length; i += 1) {
    //    stra.push(String.fromCharCode(arr[i]));
    //}
    //return "," + escape(stra.join(''));
    return ";base64," + Base64.encode(arr);
},

scan_tight_imgs : function () {
    var img, imgs;
    if (RFB.state === 'normal') {
        imgs = RFB.FBU.imgs;
        while ((imgs.length > 0) && (imgs[0][0].complete)) {
            img = imgs.shift();
            Canvas.ctx.drawImage(img[0], img[1], img[2]);
        }
        setTimeout(RFB.scan_tight_imgs, RFB.scan_imgs_rate);
    }
},

set_desktopsize : function () {
    Util.Debug(">> set_desktopsize");
    RFB.fb_width = RFB.FBU.width;
    RFB.fb_height = RFB.FBU.height;
    Canvas.clear();
    Canvas.resize(RFB.fb_width, RFB.fb_height);
    RFB.timing.fbu_rt_start = (new Date()).getTime();
    // Send a new non-incremental request
    RFB.send_array(RFB.fbUpdateRequest(0));

    RFB.FBU.bytes = 0;
    RFB.FBU.rects -= 1;

    Util.Debug("<< set_desktopsize");
},

set_cursor: function () {
    var x, y, w, h, pixelslength, masklength;
    //Util.Debug(">> set_cursor");
    x = RFB.FBU.x;  // hotspot-x
    y = RFB.FBU.y;  // hotspot-y
    w = RFB.FBU.width;
    h = RFB.FBU.height;

    pixelslength = w * h * RFB.fb_Bpp;
    masklength = Math.floor((w + 7) / 8) * h;

    if (RFB.RQ.length < (pixelslength + masklength)) {
        //Util.Debug("waiting for cursor encoding bytes");
        RFB.FBU.bytes = pixelslength + masklength;
        return false;
    }

    //Util.Debug("   set_cursor, x: " + x + ", y: " + y + ", w: " + w + ", h: " + h);

    Canvas.changeCursor(RFB.RQ.shiftBytes(pixelslength),
                        RFB.RQ.shiftBytes(masklength),
                        x, y, w, h);

    RFB.FBU.bytes = 0;
    RFB.FBU.rects -= 1;

    //Util.Debug("<< set_cursor");
},

set_jpeg_quality : function () {
    Util.Debug(">> set_jpeg_quality");
},
set_compress_level: function () {
    Util.Debug(">> set_compress_level");
},

/*
 * Client message routines
 */

pixelFormat: function () {
    //Util.Debug(">> pixelFormat");
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
    //Util.Debug("<< pixelFormat");
    return arr;
},

fixColourMapEntries: function () {
},

clientEncodings: function () {
    //Util.Debug(">> clientEncodings");
    var arr, i, encList = [];

    for (i=0; i<RFB.encodings.length; i += 1) {
        if ((RFB.encodings[i][0] === "Cursor") &&
            (! RFB.local_cursor)) {
            Util.Debug("Skipping Cursor pseudo-encoding");
        } else {
            //Util.Debug("Adding encoding: " + RFB.encodings[i][0]);
            encList.push(RFB.encodings[i][1]);
        }
    }

    arr = [2];     // msg-type
    arr.push8(0);  // padding

    arr.push16(encList.length); // encoding count
    for (i=0; i < encList.length; i += 1) {
        arr.push32(encList[i]);
    }
    //Util.Debug("<< clientEncodings: " + arr);
    return arr;
},

fbUpdateRequest: function (incremental, x, y, xw, yw) {
    //Util.Debug(">> fbUpdateRequest");
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
    //Util.Debug("<< fbUpdateRequest");
    return arr;
},

keyEvent: function (keysym, down) {
    //Util.Debug(">> keyEvent, keysym: " + keysym + ", down: " + down);
    var arr;
    arr = [4];  // msg-type
    arr.push8(down);
    arr.push16(0);
    arr.push32(keysym);
    //Util.Debug("<< keyEvent");
    return arr;
},

pointerEvent: function (x, y) {
    //Util.Debug(">> pointerEvent, x,y: " + x + "," + y +
    //           " , mask: " + RFB.mouse_buttonMask);
    var arr;
    arr = [5];  // msg-type
    arr.push8(RFB.mouse_buttonMask);
    arr.push16(x);
    arr.push16(y);
    //Util.Debug("<< pointerEvent");
    return arr;
},

clientCutText: function (text) {
    //Util.Debug(">> clientCutText");
    var arr;
    arr = [6];     // msg-type
    arr.push8(0);  // padding
    arr.push8(0);  // padding
    arr.push8(0);  // padding
    arr.push32(text.length);
    arr.pushStr(text);
    //Util.Debug("<< clientCutText:" + arr);
    return arr;
},


/*
 * Utility routines
 */

encode_message: function(arr) {
    if (RFB.b64encode) {
        /* base64 encode */
        RFB.SQ = RFB.SQ + Base64.encode(arr);
    } else {
        /* UTF-8 encode. 0 -> 256 to avoid WebSockets framing */
        RFB.SQ = RFB.SQ + arr.map(function (num) {
                if (num === 0) {
                    return String.fromCharCode(256);
                } else {
                    return String.fromCharCode(num);
                }
            } ).join('');
    }
},

decode_message: function(data) {
    var i, length, RQ = RFB.RQ;
    //Util.Debug(">> decode_message: " + data);
    if (RFB.b64encode) {
        /* base64 decode */
        RFB.RQ = RFB.RQ.concat(Base64.decode(data, 0));
    } else {
        /* UTF-8 decode. 256 -> 0 to WebSockets framing */
        length = data.length;
        for (i=0; i < length; i += 1) {
            RQ.push(data.charCodeAt(i) % 256);
        }
    }
    //Util.Debug(">> decode_message, RQ: " + RFB.RQ);
},

recv_message: function(e) {
    //Util.Debug(">> recv_message");

    try {
        RFB.decode_message(e.data);
        if (RFB.RQ.length > 0) {
            RFB.handle_message();
        } else {
            Util.Debug("Ignoring empty message");
        }
    } catch (exc) {
        if (typeof exc.stack !== 'undefined') {
            Util.Warn("recv_message, caught exception: " + exc.stack);
        } else if (typeof exc.description !== 'undefined') {
            Util.Warn("recv_message, caught exception: " + exc.description);
        } else {
            Util.Warn("recv_message, caught exception:" + exc);
        }
        if (typeof exc.name !== 'undefined') {
            RFB.updateState('failed', exc.name + ": " + exc.message);
        } else {
            RFB.updateState('failed', exc);
        }
    }
    //Util.Debug("<< recv_message");
},

handle_message: function () {
    //Util.Debug("RQ.slice(0,20): " + RFB.RQ.slice(0,20) + " (" + RFB.RQ.length + ")");
    switch (RFB.state) {
    case 'disconnected':
        Util.Error("Got data while disconnected");
        break;
    case 'failed':
        Util.Warn("Giving up!");
        RFB.disconnect();
        break;
    case 'normal':
        RFB.normal_msg();
        /*
        while (RFB.RQ.length > 0) {
            if (RFB.normal_msg() && RFB.state === 'normal') {
                Util.Debug("More to process");
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
    //Util.Debug(">> send_string: " + str);
    RFB.send_array(str.split('').map(
        function (chr) { return chr.charCodeAt(0); } ) );
},

send_array: function (arr) {
    //Util.Debug(">> send_array: " + arr);
    RFB.encode_message(arr);
    if (RFB.ws.bufferedAmount === 0) {
        //Util.Debug("arr: " + arr);
        //Util.Debug("RFB.SQ: " + RFB.SQ);
        RFB.ws.send(RFB.SQ);
        RFB.SQ = "";
    } else {
        Util.Debug("Delaying send");
    }
},

DES: function (password, challenge) {
    var i, passwd, response;
    passwd = [];
    response = challenge.slice();
    for (i=0; i < password.length; i += 1) {
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
    setTimeout(RFB.checkEvents, RFB.check_rate);
},

keyPress: function (keysym, down) {
    var arr;
    arr = RFB.keyEvent(keysym, down);
    arr = arr.concat(RFB.fbUpdateRequest(1));
    RFB.send_array(arr);
},

mouseButton: function(x, y, down, bmask) {
    if (down) {
        RFB.mouse_buttonMask |= bmask;
    } else {
        RFB.mouse_buttonMask ^= bmask;
    }
    RFB.mouse_arr = RFB.mouse_arr.concat( RFB.pointerEvent(x, y) );
    RFB.flushClient();
},

mouseMove: function(x, y) {
    //Util.Debug('>> mouseMove ' + x + "," + y);
    RFB.mouse_arr = RFB.mouse_arr.concat( RFB.pointerEvent(x, y) );
},

clipboardCopyTo: function (text) {
    Util.Debug(">> clipboardCopyTo stub");
    // Stub
},

externalUpdateState: function(state, msg) {
    Util.Debug(">> externalUpdateState stub");
    // Stub
},

/*
 * Running states:
 *   disconnected - idle state
 *   normal       - connected
 *
 * Page states:
 *   loaded       - page load, equivalent to disconnected
 *   connect      - starting initialization
 *   password     - waiting for password
 *   failed       - abnormal transition to disconnected
 *   fatal        - failed to load page, or fatal error
 *
 * VNC initialization states:
 *   ProtocolVersion
 *   Security
 *   Authentication
 *   SecurityResult
 *   ServerInitialization
 */
updateState: function(state, statusMsg) {
    var func, cmsg, oldstate = RFB.state;
    if (state === oldstate) {
        /* Already here, ignore */
        Util.Debug("Already in state '" + state + "', ignoring.");
        return;
    }

    if (oldstate === 'fatal') {
        Util.Error("Fatal error, cannot continue");
    }

    if ((state === 'failed') || (state === 'fatal')) {
        func = Util.Error;
    } else {
        func = Util.Warn;
    }

    cmsg = typeof(statusMsg) !== 'undefined' ? (" Msg: " + statusMsg) : "";
    func("New state '" + state + "', was '" + oldstate + "'." + cmsg);

    if ((oldstate === 'failed') && (state === 'disconnected')) {
        // Do disconnect action, but stay in failed state.
        RFB.state = 'failed';
    } else {
        RFB.state = state;
    }

    switch (state) {
    case 'loaded':
    case 'disconnected':

        if (RFB.sendID) {
            clearInterval(RFB.sendID);
            RFB.sendID = null;
        }

        if (RFB.ws) {
            if (RFB.ws.readyState === WebSocket.OPEN) {
                RFB.ws.close();
            }
            RFB.ws.onmessage = function (e) { return; };
        }

        if (Canvas.ctx) {
            Canvas.stop();
            if (! /__debug__$/i.test(document.location.href)) {
                Canvas.clear();
            }
        }

        RFB.show_timings();

        break;


    case 'connect':
        RFB.init_vars();

        if ((RFB.ws) && (RFB.ws.readyState === WebSocket.OPEN)) {
            RFB.ws.close();
        }
        RFB.init_ws(); // onopen transitions to 'ProtocolVersion'

        break;


    case 'password':
        // Ignore password state by default
        break;


    case 'normal':
        if ((oldstate === 'disconnected') || (oldstate === 'failed')) {
            Util.Error("Invalid transition from 'disconnected' or 'failed' to 'normal'");
        }

        break;


    case 'failed':
        if (oldstate === 'disconnected') {
            Util.Error("Invalid transition from 'disconnected' to 'failed'");
        }
        if (oldstate === 'normal') {
            Util.Error("Error while connected.");
        }
        if (oldstate === 'init') {
            Util.Error("Error while initializing.");
        }

        if ((RFB.ws) && (RFB.ws.readyState === WebSocket.OPEN)) {
            RFB.ws.close();
        }
        // Make sure we transition to disconnected
        setTimeout(function() { RFB.updateState('disconnected'); }, 50);

        break;


    default:
        // Invalid state transition

    }

    if ((oldstate === 'failed') && (state === 'disconnected')) {
        // Leave the failed message
        RFB.externalUpdateState(state);
    } else {
        RFB.externalUpdateState(state, statusMsg);
    }
},

update_timings: function() {
    var now, timing = RFB.timing, offset;
    now = (new Date()).getTime();
    timing.history.push([now,
            timing.h_fbus,
            timing.h_rects,
            timing.h_bytes,
            timing.h_pixels]);
    timing.h_fbus = 0;
    timing.h_rects = 0;
    timing.h_bytes = 0;
    timing.h_pixels = 0;
    if ((RFB.state !== 'disconnected') && (RFB.state !== 'failed')) {
        // Try for every second
        offset = (now - timing.history_start) % 1000;
        if (offset < 500) {
            setTimeout(RFB.update_timings, 1000 - offset);
        } else {
            setTimeout(RFB.update_timings, 2000 - offset);
        }
    }
},

show_timings: function() {
    var i, timing = RFB.timing, history, msg,
        delta, tot_time = 0, tot_fbus = 0, tot_rects = 0,
        tot_bytes = 0, tot_pixels = 0;
    if (timing.history_start === 0) { return; }
    //Util.Debug(">> show_timings");
    RFB.update_timings();  // Final accumulate
    msg = "\nTimings\n";
    msg += "  time: fbus,rects,bytes,pixels\n";
    for (i=0; i < timing.history.length; i += 1) {
        history = timing.history[i];
        delta = ((history[0]-timing.history_start)/1000);
        tot_time = delta;
        tot_fbus += history[1];
        tot_rects += history[2];
        tot_bytes += history[3];
        tot_pixels += history[4];

        msg += "  " + delta.toFixed(3);
        msg += ": " + history.slice(1) + "\n";
    }
    msg += "\nTotals:\n";
    msg += "  time: fbus,rects,bytes,pixels\n";
    msg += "  " + tot_time.toFixed(3);
    msg += ": " + tot_fbus + "," + tot_rects;
    msg += "," + tot_bytes + "," + tot_pixels;
    Util.Info(msg);
    //Util.Debug("<< show_timings");
},

/*
 * Setup routines
 */

init_ws: function () {
    //Util.Debug(">> init_ws");

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
    if (vars.length > 0) {
        uri += "?" + vars.join("&");
    }
    Util.Info("connecting to " + uri);
    RFB.ws = new WebSocket(uri);

    RFB.ws.onmessage = RFB.recv_message;
    RFB.ws.onopen = function(e) {
        Util.Debug(">> WebSocket.onopen");
        if (RFB.state === "connect") {
            RFB.updateState('ProtocolVersion', "Starting VNC handshake");
        } else {
            RFB.updateState('failed', "Got unexpected WebSockets connection");
        }
        Util.Debug("<< WebSocket.onopen");
    };
    RFB.ws.onclose = function(e) {
        Util.Debug(">> WebSocket.onclose");
        if (RFB.state === 'normal') {
            RFB.updateState('failed', 'Server disconnected');
        } else if (RFB.state === 'ProtocolVersion') {
            RFB.updateState('failed', 'Failed to connect to server');
        } else  {
            RFB.updateState('disconnected', 'VNC disconnected');
        }
        Util.Debug("<< WebSocket.onclose");
    };
    RFB.ws.onerror = function(e) {
        Util.Debug(">> WebSocket.onerror");
        RFB.updateState('failed', "WebSocket error");
        Util.Debug("<< WebSocket.onerror");
    };

    setTimeout(function () {
            if (RFB.ws.readyState === WebSocket.CONNECTING) {
                RFB.updateState('failed', "Connect timeout");
            }
        }, RFB.connectTimeout);

    //Util.Debug("<< init_ws");
},

init_vars: function () {
    /* Reset state */
    RFB.cuttext          = 'none';
    RFB.ct_length        = 0;
    RFB.RQ               = [];
    RFB.SQ               = "";
    RFB.FBU.rects        = 0;
    RFB.FBU.subrects     = 0;  // RRE and HEXTILE
    RFB.FBU.lines        = 0;  // RAW
    RFB.FBU.tiles        = 0;  // HEXTILE
    RFB.FBU.imgs         = []; // TIGHT_PNG image queue
    RFB.mouse_buttonmask = 0;
    RFB.mouse_arr        = [];

    RFB.timing.history_start = 0;
    RFB.timing.history = [];
    RFB.timing.h_fbus = 0;
    RFB.timing.h_rects = 0;
    RFB.timing.h_bytes = 0;
    RFB.timing.h_pixels = 0;
}

}; /* End of RFB */
