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
 * Mouse state
 */
Mouse = {
    buttonmask : 0,
    arr        : []
};


/*
 * RFB namespace
 */

RFB = {

ws        : null,  // Web Socket object
d         : [],    // Received data accumulator

version   : "RFB 003.003\n",
state     : 'ProtocolVersion',
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


/*
 * Server message handlers
 */

/* RFB/VNC initialisation */
init_msg: function () {
    console.log(">> init_msg: " + RFB.state);

    switch (RFB.state) {

    case 'ProtocolVersion' :
        if (RFB.d.length != 12) {
            console.log("Invalid protocol version from server");
            RFB.state = 'reset';
            return;
        }
        var server_version = RFB.d.shiftStr(12);
        console.log("Server  ProtocolVersion: " + server_version.substr(0,11));
        console.log("Sending ProtocolVersion: " + RFB.version.substr(0,11));
        RFB.send_string(RFB.version);
        RFB.state = 'Authentication';
        break;

    case 'Authentication' :
        if (RFB.d.length < 4) {
            console.log("Invalid auth frame");
            RFB.state = 'reset';
            return;
        }
        var scheme = RFB.d.shift32();
        console.log("Auth scheme: " + scheme);
        switch (scheme) {
            case 0:  // connection failed
                var strlen = RFB.d.shift32();
                var reason = RFB.d.shiftStr(strlen);
                console.log("auth failed: " + reason);
                RFB.state = "failed";
                return;
            case 1:  // no authentication
                RFB.send_array([RFB.shared]); // ClientInitialisation
                RFB.state = "ServerInitialisation";
                break;
            case 2:  // VNC authentication
                var challenge = RFB.d.shiftBytes(16);
                console.log("Password: " + RFB.password);
                console.log("Challenge: " + challenge + "(" + challenge.length + ")");
                passwd = RFB.passwdTwiddle(RFB.password);
                //console.log("passwd: " + passwd + "(" + passwd.length + ")");
                response = des(passwd, challenge, 1);
                //console.log("reponse: " + response + "(" + response.length + ")");

                RFB.send_array(response);
                RFB.state = "SecurityResult";
                break;
            default:
                console.log("Unsupported auth scheme");
                RFB.state = "failed";
                return;
        }
        break;

    case 'SecurityResult' :
        if (RFB.d.length != 4) {
            console.log("Invalid server auth response");
            RFB.state = 'reset';
            return;
        }
        var resp = RFB.d.shift32();
        switch (resp) {
            case 0:  // OK
                console.log("Authentication OK");
                break;
            case 1:  // failed
                console.log("Authentication failed");
                RFB.state = "reset";
                return;
            case 2:  // too-many
                console.log("Too many authentication attempts");
                RFB.state = "failed";
                return;
        }
        RFB.send_array([RFB.shared]); // ClientInitialisation
        RFB.state = "ServerInitialisation";
        break;

    case 'ServerInitialisation' :
        if (RFB.d.length < 24) {
            console.log("Invalid server initialisation");
            RFB.state = 'reset';
            return;
        }

        /* Screen size */
        //console.log("RFB.d: " + RFB.d);
        RFB.fb_width  = RFB.d.shift16();
        RFB.fb_height = RFB.d.shift16();

        console.log("Screen size: " + RFB.fb_width + "x" + RFB.fb_height);

        /* PIXEL_FORMAT */
        var bpp            = RFB.d.shift8();
        var depth          = RFB.d.shift8();
        var big_endian     = RFB.d.shift8();
        var true_color     = RFB.d.shift8();

        console.log("bpp: " + bpp);
        console.log("depth: " + depth);
        console.log("big_endian: " + big_endian);
        console.log("true_color: " + true_color);

        /* Connection name/title */
        RFB.d.shiftStr(12);
        var name_length   = RFB.d.shift32();
        RFB.fb_name = RFB.d.shiftStr(name_length);

        console.log("Name: " + RFB.fb_name);
        $('status').innerHTML = "Connected to: " + RFB.fb_name;

        Canvas.init('vnc', RFB.fb_width, RFB.fb_height,
                RFB.keyDown, RFB.keyUp,
                RFB.mouseDown, RFB.mouseUp, RFB.mouseMove);

        var init = [];
        init = init.concat(RFB.pixelFormat());
        init = init.concat(RFB.encodings());
        init = init.concat(RFB.fbUpdateRequest(0));
        RFB.send_array(init);
        
        /* Start pushing/polling */
        RFB.checkEvents.delay(RFB.check_rate);

        RFB.state = 'normal';
        break;
    }
    console.log("<< init_msg (" + RFB.state + ")");
},


/* Normal RFB/VNC server messages */
normal_msg: function () {
    //console.log(">> normal_msg");
    if (FBU.rects > 0) {
        var msg_type = 0;
    } else {
        var msg_type = RFB.d.shift8();
    }
    switch (msg_type) {
    case 0:  // FramebufferUpdate
        if (FBU.rects == 0) {
            if (RFB.d.length < 3) {
                console.log("   waiting for FBU header bytes");
                return;
            }
            RFB.d.shift8();
            FBU.rects = RFB.d.shift16();
            //console.log("FramebufferUpdate, rects:" + FBU.rects);
            FBU.bytes = 0;
        }

        while ((FBU.rects > 0) && (RFB.d.length >= FBU.bytes)) {
            if (FBU.bytes == 0) {
                if (RFB.d.length < 12) {
                    console.log("   waiting for rect header bytes");
                    return;
                }
                /* New FramebufferUpdate */
                FBU.x      = RFB.d.shift16();
                FBU.y      = RFB.d.shift16();
                FBU.width  = RFB.d.shift16();
                FBU.height = RFB.d.shift16();
                FBU.encoding = parseInt(RFB.d.shift32(), 10);

                // Debug:
                /*
                var msg = "FramebufferUpdate rects:" + FBU.rects + " encoding:" + FBU.encoding
                switch (FBU.encoding) {
                    case 0: msg += "(RAW)"; break;
                    case 1: msg += "(COPY-RECT)"; break;
                    case 2: msg += "(RRE)"; break;
                    case 5: msg += "(HEXTILE " + FBU.tiles + " tiles)"; break;
                    default:
                        console.log("Unsupported encoding " + FBU.encoding);
                        RFB.state = "failed";
                        return;
                }
                msg += ", RFB.d.length: " + RFB.d.length
                console.log(msg);
                */
            }

            //console.log("> RFB.d.length: " + RFB.d.length + ", arr[0..30]: " + RFB.d.slice(0,30));
            switch (FBU.encoding) {
                case 0: RFB.display_raw();       break; // Raw
                case 1: RFB.display_copy_rect(); break; // Copy-Rect
                case 2: RFB.display_rre();       break; // RRE
                case 5: RFB.display_hextile();   break; // hextile
            }
            //console.log("< RFB.d.length: " + RFB.d.length + ", FBU.bytes: " + FBU.bytes);
            if (RFB.state != "normal") return;
        }

        //console.log("Finished frame buffer update");
        break;
    case 1:  // SetColourMapEntries
        console.log("SetColourMapEntries (unsupported)");
        RFB.d.shift8();  // Padding
        RFB.d.shift16(); // First colour
        var num_colours = RFB.d.shift16();
        RFB.d.shiftBytes(num_colours * 6);
        break;
    case 2:  // Bell
        console.log("Bell (unsupported)");
        break;
    case 3:  // ServerCutText
        console.log("ServerCutText");
        RFB.d.shiftBytes(3);  // Padding
        var length = RFB.d.shift32();
        RFB.d.shiftBytes(length);
        break;
    default:
        console.log("Unknown server message type: " + msg_type);
        RFB.state = "failed";
        break;
    }
    //console.log("<< normal_msg");
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
    if (RFB.d.length < FBU.bytes) {
        //console.log("   waiting for " + (FBU.bytes - RFB.d.length) + " RAW bytes");
        return;
    }
    var cur_y = FBU.y + (FBU.height - FBU.lines);
    var cur_height = Math.min(FBU.lines, Math.floor(RFB.d.length/(FBU.width * RFB.fb_Bpp)));
    //console.log("cur_y:" + cur_y + ", cur_height:" + cur_height);
    Canvas.rgbxImage(FBU.x, cur_y, FBU.width, cur_height, RFB.d);
    RFB.d.shiftBytes(FBU.width * cur_height * RFB.fb_Bpp);
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
    FBU.bytes = 4;
    if (RFB.d.length < FBU.bytes) {
        //console.log("   waiting for " + (FBU.bytes - RFB.d.length) + " COPY-RECT bytes");
        return;
    }
    var old_x = RFB.d.shift16();
    var old_y = RFB.d.shift16();
    Canvas.copyImage(old_x, old_y, FBU.x, FBU.y, FBU.width, FBU.height);
    FBU.rects --;
    FBU.bytes = 0;
},

display_rre: function () {
    //console.log(">> display_rre (" + RFB.d.length + " bytes)");
    if (FBU.subrects == 0) {
        FBU.bytes = 4 + RFB.fb_Bpp;
        if (RFB.d.length < FBU.bytes) {
            //console.log("   waiting for " + (FBU.bytes - RFB.d.length) + " RRE bytes");
            return;
        }
        FBU.subrects = RFB.d.shift32();
        //console.log(">> display_rre " + "(" + FBU.subrects + " subrects)");
        var color = RFB.d.shiftBytes(RFB.fb_Bpp); // Background
        Canvas.fillRect(FBU.x, FBU.y, FBU.width, FBU.height, color);
    }
    while ((FBU.subrects > 0) && (RFB.d.length >= (RFB.fb_Bpp + 8))) {
        var color = RFB.d.shiftBytes(RFB.fb_Bpp);
        var x = RFB.d.shift16();
        var y = RFB.d.shift16();
        var width = RFB.d.shift16();
        var height = RFB.d.shift16();
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
    //console.log(">> display_hextile, tiles: " + FBU.tiles + ", arr.length: " + RFB.d.length + ", bytes: " + FBU.bytes);
    var subencoding, subrects, cur_tile, tile_x, x, w, tile_y, y, h;

    if (FBU.tiles == 0) {
        FBU.tiles_x = Math.ceil(FBU.width/16);
        FBU.tiles_y = Math.ceil(FBU.height/16);
        FBU.total_tiles = FBU.tiles_x * FBU.tiles_y;
        FBU.tiles = FBU.total_tiles;
    }

    /* FBU.bytes comes in as 1, RFB.d.length at least 1 */
    while (FBU.tiles > 0) {
        FBU.bytes = 1;
        if (RFB.d.length < FBU.bytes) {
            console.log("   waiting for HEXTILE subencoding byte");
            return;
        }
        subencoding = RFB.d[0];  // Peek
        if (subencoding > 30) { // Raw
            console.log("Illegal subencoding " + subencoding);
            RFB.state = "failed";
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
                if (RFB.d.length < FBU.bytes) {
                    /* Wait for subrects byte */
                    console.log("   waiting for hextile subrects header byte");
                    return;
                }
                subrects = RFB.d[FBU.bytes-1]; // Peek
                if (subencoding & 0x10) { // SubrectsColoured
                    FBU.bytes += subrects * (RFB.fb_Bpp + 2);
                } else {
                    FBU.bytes += subrects * 2;
                }
            }
        }

        //console.log("   tile:" + cur_tile + "/" + (FBU.total_tiles - 1) + ", subencoding:" + subencoding + "(last: " + FBU.lastsubencoding + "), subrects:" + subrects + ", tile:" + tile_x + "," + tile_y + " [" + x + "," + y + "]@" + w + "x" + h + ", arr.length:" + RFB.d.length + ", bytes:" + FBU.bytes);
        //console.log("   arr[0..30]: " + RFB.d.slice(0,30));
        if (RFB.d.length < FBU.bytes) {
            //console.log("   waiting for " + (FBU.bytes - RFB.d.length) + " hextile bytes");
            return;
        }

        /* We know the encoding and have a whole tile */
        FBU.subencoding = RFB.d.shift8();
        FBU.bytes--;
        if (FBU.subencoding == 0) {
            if (FBU.lastsubencoding & 0x01) {
                /* Weird: ignore blanks after RAW */
                console.log("     Ignoring blank after RAW");
                continue;
            }
            Canvas.fillRect(x, y, w, h, FBU.background);
        } else if (FBU.subencoding & 0x01) { // Raw
            Canvas.rgbxImage(x, y, w, h, RFB.d);
        } else {
            var idx = 0;
            if (FBU.subencoding & 0x02) { // Background
                FBU.background = RFB.d.slice(idx, idx + RFB.fb_Bpp);
                idx += RFB.fb_Bpp;
                //console.log("   background: " + FBU.background);
            }
            if (FBU.subencoding & 0x04) { // Foreground
                FBU.foreground = RFB.d.slice(idx, idx + RFB.fb_Bpp);
                idx += RFB.fb_Bpp;
                //console.log("   foreground: " + FBU.foreground);
            }
            Canvas.fillRect(x, y, w, h, FBU.background);
            if (FBU.subencoding & 0x08) { // AnySubrects
                subrects = RFB.d[idx];
                idx++;
                var color, xy, sx, sy, wh, sw, sh;
                for (var i = 0; i < subrects; i ++) {
                    if (FBU.subencoding & 0x10) { // SubrectsColoured
                        color = RFB.d.slice(idx, idx + RFB.fb_Bpp);
                        idx += RFB.fb_Bpp;
                    } else {
                        color = FBU.foreground;
                    }
                    xy = RFB.d[idx];
                    idx++;
                    sx = x + (xy >> 4);
                    sy = y + (xy & 0x0f);

                    wh = RFB.d[idx];
                    idx++;
                    sw = (wh >> 4)   + 1;
                    sh = (wh & 0x0f) + 1;

                    Canvas.fillRect(sx, sy, sw, sh, color);
                }
            }
        }
        RFB.d.shiftBytes(FBU.bytes);
        FBU.lastsubencoding = FBU.subencoding;
        FBU.bytes = 0;
        FBU.tiles --;
    }

    if (FBU.tiles == 0) {
        FBU.rects --;
    }

    //console.log("<< display_hextile, rects:" + FBU.rects, " d:" + RFB.d.slice(0,40));
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
    //console.log("keyEvent array: " + arr);
    //console.log("<< keyEvent");
    return arr;
},

pointerEvent: function (x, y) {
    //console.log(">> pointerEvent, x,y: " + x + "," + y + " , mask: " + Mouse.buttonMask);
    var arr;
    arr = [5];  // msg-type
    arr.push8(Mouse.buttonMask);
    arr.push16(x);
    arr.push16(y);
    //console.log("<< pointerEvent");
    return arr;
},

clientCutText: function () {
},


/*
 * Utility routines
 */

send_string: function (str) {
    //console.log(">> send_string: " + str);
    RFB.send_array(str.split('').map(
        function (chr) { return chr.charCodeAt(0) } ) );
},

send_array: function (arr) {
    //console.log(">> send_array: " + arr);
    //console.log(">> send_array: " + Base64.encode_array(arr));
    RFB.ws.send(Base64.encode_array(arr));
},

/* Mirror bits of each character and return as array */
passwdTwiddle: function (passwd) {
    var arr;
    arr = [];
    for (var i=0; i< passwd.length; i++) {
        var c = passwd.charCodeAt(i);
        arr.push( ((c & 0x80) >> 7) +
                  ((c & 0x40) >> 5) +
                  ((c & 0x20) >> 3) +
                  ((c & 0x10) >> 1) +
                  ((c & 0x08) << 1) +
                  ((c & 0x04) << 3) +
                  ((c & 0x02) << 5) +
                  ((c & 0x01) << 7)   );
    }
    return arr;
},

flushClient: function () {
    var arr = [];
    if (Mouse.arr.length > 0) {
        RFB.send_array(Mouse.arr.concat(RFB.fbUpdateRequest(1)));
        Mouse.arr = [];
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
        RFB.checkEvents.delay(RFB.check_rate);
    }
},

keyDown: function (e) {
    //console.log(">> keyDown: " + Canvas.getKeysym(e));
    e.stop();
    var arr = RFB.keyEvent(Canvas.getKeysym(e), 1);
    arr = arr.concat(RFB.fbUpdateRequest(1));
    RFB.send_array(arr);
},

keyUp: function (e) {
    //console.log(">> keyUp: " + Canvas.getKeysym(e));
    e.stop();
    var arr = RFB.keyEvent(Canvas.getKeysym(e), 0);
    arr = arr.concat(RFB.fbUpdateRequest(1));
    RFB.send_array(arr);
},

mouseDown: function(e) {
    var evt = e.event || window.event;
    var x, y;
    x = (evt.clientX - Canvas.c_x);
    y = (evt.clientY - Canvas.c_y);
    //console.log('>> mouseDown ' + evt.which + '/' + evt.button + " " + x + "," + y);
    Mouse.buttonMask |= 1 << evt.button;
    Mouse.arr = Mouse.arr.concat( RFB.pointerEvent(x, y) );

    RFB.flushClient();
},

mouseUp: function(e) {
    var evt = e.event || window.event;
    var x, y;
    x = (evt.clientX - Canvas.c_x);
    y = (evt.clientY - Canvas.c_y);
    //console.log('>> mouseUp ' + evt.which + '/' + evt.button + " " + x + "," + y);
    Mouse.buttonMask ^= 1 << evt.button;
    Mouse.arr = Mouse.arr.concat( RFB.pointerEvent(x, y) );

    RFB.flushClient();
},

mouseMove: function(e) {
    var evt = e.event || window.event;
    var x, y;
    x = (evt.clientX - Canvas.c_x);
    y = (evt.clientY - Canvas.c_y);
    //console.log('>> mouseMove ' + x + "," + y);
    Mouse.arr = Mouse.arr.concat( RFB.pointerEvent(x, y) );
},



/*
 * Setup routines
 */

init_ws: function () {
    console.log(">> init_ws");
    var uri = "ws://" + RFB.host + ":" + RFB.port;
    console.log("connecting to " + uri);
    RFB.ws = new WebSocket(uri);
    RFB.ws.onmessage = function(e) {
        //console.log(">> onmessage");
        RFB.d = RFB.d.concat(Base64.decode_array(e.data));
        if (RFB.state != 'normal') {
            RFB.init_msg();
        } else {
            RFB.normal_msg();
        }
        if (RFB.state == 'reset') {
            /* close and reset connection */
            RFB.disconnect();
            RFB.init_ws();
        } else if (RFB.state == 'failed') {
            console.log("Giving up!");
            RFB.disconnect();
        }
        //console.log("<< onmessage");
    };
    RFB.ws.onopen = function(e) {
        console.log(">> onopen");
        RFB.state = "ProtocolVersion";
        console.log("<< onopen");
    };
    RFB.ws.onclose = function(e) {
        console.log(">> onclose");
        RFB.state = "closed";
        console.log("<< onclose");
    }

    console.log("<< init_ws");
},

connect: function () {
    console.log(">> connect");
    RFB.host = $('host').value;
    RFB.port = $('port').value;
    RFB.password = $('password').value;
    if ((!host) || (!port)) {
        console.log("must set host and port");
        return;
    }
    if (RFB.ws) {
        RFB.ws.close();
    }
    RFB.init_ws();
    $('connectButton').value = "Disconnect";
    $('connectButton').onclick = RFB.disconnect;
    console.log("<< connect");

},

disconnect: function () {
    console.log(">> disconnect");
    if (RFB.ws) {
        RFB.ws.close();
    }
    if (Canvas.ctx) {
        Canvas.stop();
        if (! /__debug__$/i.test(document.location.href)) {
            Canvas.clear();
        }
    }
    $('connectButton').value = "Connect";
    $('connectButton').onclick = RFB.connect;
    $('status').innerHTML = "Disconnected";
    console.log("<< disconnect");
}

}; /* End of RFB */
