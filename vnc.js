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
 * Pending frame buffer update data
 */
var FBU = {
    rects    : 0,
    subrects : 0,
    bytes    : 0,
    x        : 0,
    y        : 0,
    width    : 0, 
    height   : 0,
    encoding : 0,
    arr      : null};


/*
 * RFB namespace
 */

RFB = {

ws        : null,  // Web Socket object

version   : "RFB 003.003\n",
state     : 'ProtocolVersion',
shared    : 1,
poll_rate : 3000,

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
init_msg: function (data) {
    debug(">> init_msg: " + RFB.state);

    switch (RFB.state) {

    case 'ProtocolVersion' :
        if (data.length != 12) {
            debug("Invalid protocol version from server");
            RFB.state = 'reset';
            return;
        }
        debug("Server  ProtocolVersion: " + data.shiftStr(11));
        debug("Sending ProtocolVersion: " + RFB.version.substr(0,11));
        RFB.send_string(RFB.version);
        RFB.state = 'Authentication';
        break;

    case 'Authentication' :
        if (data.length < 4) {
            debug("Invalid auth frame");
            RFB.state = 'reset';
            return;
        }
        var scheme = data.shift32();
        debug("Auth scheme: " + scheme);
        switch (scheme) {
            case 0:  // connection failed
                var strlen = data.shift32();
                var reason = data.shiftStr(strlen);
                debug("auth failed: " + reason);
                RFB.state = "failed";
                return;
            case 1:  // no authentication
                RFB.send_array([RFB.shared]); // ClientInitialisation
                RFB.state = "ServerInitialisation";
                break;
            case 2:  // VNC authentication
                var challenge = data.shiftBytes(16);
                debug("Password: " + RFB.password);
                debug("Challenge: " + challenge + "(" + challenge.length + ")");
                passwd = RFB.passwdTwiddle(RFB.password);
                //debug("passwd: " + passwd + "(" + passwd.length + ")");
                response = des(passwd, challenge, 1);
                //debug("reponse: " + response + "(" + response.length + ")");

                RFB.send_array(response);
                RFB.state = "SecurityResult";
                break;
        }
        break;

    case 'SecurityResult' :
        if (data.length != 4) {
            debug("Invalid server auth response");
            RFB.state = 'reset';
            return;
        }
        var resp = data.shift32();
        switch (resp) {
            case 0:  // OK
                debug("Authentication OK");
                break;
            case 1:  // failed
                debug("Authentication failed");
                RFB.state = "reset";
                return;
            case 2:  // too-many
                debug("Too many authentication attempts");
                RFB.state = "failed";
                return;
        }
        RFB.send_array([RFB.shared]); // ClientInitialisation
        RFB.state = "ServerInitialisation";
        break;

    case 'ServerInitialisation' :
        if (data.length < 24) {
            debug("Invalid server initialisation");
            RFB.state = 'reset';
            return;
        }

        /* Screen size */
        //debug("data: " + data);
        RFB.fb_width  = data.shift16();
        RFB.fb_height = data.shift16();

        debug("Screen size: " + RFB.fb_width + "x" + RFB.fb_height);

        /* PIXEL_FORMAT */
        var bpp            = data.shift8();
        var depth          = data.shift8();
        var big_endian     = data.shift8();
        var true_color     = data.shift8();

        debug("bpp: " + bpp);
        debug("depth: " + depth);
        debug("big_endian: " + big_endian);
        debug("true_color: " + true_color);

        /* Connection name/title */
        data.shiftStr(12);
        var name_length   = data.shift32();
        RFB.fb_name = data.shiftStr(name_length);

        debug("Name: " + RFB.fb_name);
        $('status').innerHTML = "Connected to: " + RFB.fb_name;

        Canvas.init('vnc', RFB.fb_width, RFB.fb_height, RFB.keyDown, RFB.keyUp);

        RFB.setEncodings();
        RFB.setPixelFormat();

        RFB.fbUpdateRequest(0, 0, 0, RFB.fb_width, RFB.fb_height);

        RFB.state = 'normal';
        break;
    }
    debug("<< init_msg (" + RFB.state + ")");
},

/* Framebuffer update display functions */
display_raw: function () {
    debug(">> display_raw");
    Canvas.rfbImage(FBU.x, FBU.y, FBU.width, FBU.height, FBU.arr);
    FBU.rects --;
    FBU.arr = [];
},

display_copy_rect: function () {
    debug(">> display_copy_rect");
    var old_x = FBU.arr.shift16();
    var old_y = FBU.arr.shift16();
    Canvas.copyImage(old_x, old_y, FBU.x, FBU.y, FBU.width, FBU.height);
    FBU.rects --;
    FBU.arr = [];
},

display_rre: function () {
    //debug(">> display_rre (" + FBU.arr.length + " bytes)");
    if (FBU.subrects == 0) {
        FBU.subrects = FBU.arr.shift32();
        debug(">> display_rre " + "(" + FBU.subrects + " subrects)");
        var color = FBU.arr.shiftBytes(RFB.fb_Bpp); // Background
        Canvas.rfbRect(FBU.x, FBU.y, FBU.width, FBU.height, color);
    }
    while (FBU.arr.length > 0) {
        FBU.subrects --;
        var color = FBU.arr.shiftBytes(RFB.fb_Bpp);
        var x = FBU.arr.shift16();
        var y = FBU.arr.shift16();
        var width = FBU.arr.shift16();
        var height = FBU.arr.shift16();
        Canvas.rfbRect(FBU.x + x, FBU.y + y, width, height, color);
    }
    //debug("rects: " + FBU.rects + ", FBU.subrects: " + FBU.subrects);

    if (FBU.subrects > 0) {
        var chunk = Math.min(RFB.rre_chunk, FBU.subrects);
        FBU.bytes = (RFB.fb_Bpp + 8) * chunk;
    } else {
        FBU.rects --;
        FBU.arr = [];
    }
    //debug("<< display_rre, FBU.bytes: " + FBU.bytes);
},


/* Normal RFB/VNC messages */
normal_msg: function (data) {
    //debug(">> normal_msg");
    if ((FBU.rects > 0) || (FBU.bytes > 0)) {
        var msg_type = 0;
    } else {
        var msg_type = data.shift8();
    }
    switch (msg_type) {
    case 0:  // FramebufferUpdate
        if (FBU.rects == 0) {
            data.shift8();
            FBU.rects = data.shift16();
            debug("FramebufferUpdate, " + FBU.rects + " rects");
            FBU.bytes = 0;
            FBU.arr = [];
        } else {
            //debug("FramebufferUpdate continuation");
        }

        while (data.length > 0) {
            //debug("data.length: " + data.length + ", FBU.bytes: " + FBU.bytes);
            if (FBU.bytes == 0) {
                FBU.x      = data.shift16();
                FBU.y      = data.shift16();
                FBU.width  = data.shift16();
                FBU.height = data.shift16();
                FBU.encoding = parseInt(data.shift32(), 10);
                debug("encoding: " + FBU.encoding);
                switch (FBU.encoding) {
                    case 0:  // Raw
                        FBU.bytes = FBU.width * FBU.height * RFB.fb_Bpp;
                        break;
                    case 1:  // Copy-Rect
                        FBU.bytes = 4;
                        break;
                    case 2:  // RRE
                        FBU.bytes = 4 + RFB.fb_Bpp;
                        break;
                }
            } else {
                if (data.length >= FBU.bytes) {
                    //debug('Done rect:');
                    FBU.arr = FBU.arr.concat(data.shiftBytes(FBU.bytes))
                    FBU.bytes = 0;
                    
                    switch (FBU.encoding) {
                        case 0: RFB.display_raw();       break; // Raw
                        case 1: RFB.display_copy_rect(); break; // Copy-Rect
                        case 2: RFB.display_rre();       break; // RRE
                    }

                    FBU.arr = [];
                } else {
                    FBU.bytes = FBU.bytes - data.length;
                    FBU.arr = FBU.arr.concat(data.shiftBytes(data.length))
                }
            }

            //debug("Bytes remaining: " + FBU.bytes);
        }
        //debug("Finished frame buffer update");
        break;
    case 1:  // SetColourMapEntries
        debug("SetColourMapEntries");
        break;
    case 2:  // Bell
        debug("Bell");
        break;
    case 3:  // ServerCutText
        debug("ServerCutText");
        break;
    default:
        debug("Unknown server message type: " + msg_type);
        break;
    }
    //debug("<< normal_msg");
},

/*
 * Client message routines
 */

setPixelFormat: function () {
    debug(">> setPixelFormat");
    var arr = [0];  // msg-type
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
    arr.push8(0);    // red-shift
    arr.push8(8);     // green-shift
    arr.push8(16);     // blue-shift

    arr.push8(0);  // padding
    arr.push8(0);  // padding
    arr.push8(0);  // padding
    RFB.send_array(arr);
    debug("<< setPixelFormat");
},

fixColourMapEntries: function () {
},

setEncodings: function () {
    debug(">> setEncodings");
    var arr = [2]; // msg-type
    arr.push8(0);  // padding
    arr.push16(3); // encoding count
    arr.push32(2); // RRE encoding
    arr.push32(1); // copy-rect encoding
    arr.push32(0); // raw encoding
    RFB.send_array(arr);
    debug("<< setEncodings");
},

fbUpdateRequest: function (incremental, x, y, xw, yw) {
    //debug(">> fbUpdateRequest");
    var arr = [3];  // msg-type
    arr.push8(incremental);
    arr.push16(x);
    arr.push16(y);
    arr.push16(xw);
    arr.push16(yw);
    RFB.send_array(arr);
    //debug("<< fbUpdateRequest");
},

keyEvent: function (keysym, down) {
    debug(">> keyEvent, keysym: " + keysym + ", down: " + down);
    var arr = [4];  // msg-type
    arr.push8(down);
    arr.push16(0);
    arr.push32(keysym);
    //debug("keyEvent array: " + arr);
    RFB.send_array(arr);
    RFB.fbUpdateRequest(1, 0, 0, RFB.fb_width, RFB.fb_height);
    //debug("<< keyEvent");
},

pointerEvent: function () {
},

clientCutText: function () {
},


/*
 * Utility routines
 */

send_string: function (str) {
    //debug(">> send_string: " + str);
    var arr = str.split('').map(function (chr) {
            return chr.charCodeAt(0) } );
    RFB.send_array(arr);
},

send_array: function (arr) {
    //debug(">> send_array: " + Base64.encode_array(arr));
    RFB.ws.send(Base64.encode_array(arr));
},

/* Mirror bits of each character and return as array */
passwdTwiddle: function (passwd) {
    var arr = [];
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

poller: function () {
    if (RFB.state == 'normal') {
        RFB.fbUpdateRequest(1, 0, 0, RFB.fb_width, RFB.fb_height);
        RFB.poller.delay(RFB.poll_rate);
    }
},

keyDown: function (e) {
    //debug(">> keyDown: " + e.key + "(" + e.code + ")");
    e.stop();
    RFB.keyEvent(Canvas.getKeysym(e), 1);
},

keyUp: function (e) {
    //debug(">> keyUp: " + e.key + "(" + e.code + ")");
    e.stop();
    RFB.keyEvent(Canvas.getKeysym(e), 0);
},


/*
 * Setup routines
 */

init_ws: function () {
    debug(">> init_ws");
    var uri = "ws://" + RFB.host + ":" + RFB.port;
    debug("connecting to " + uri);
    RFB.ws = new WebSocket(uri);
    RFB.ws.onmessage = function(e) {
        //debug(">> onmessage");
        var data = Base64.decode_array(e.data);
        //debug("decoded array: " + data);
        if (RFB.state != 'normal') {
            RFB.init_msg(data);
        } else {
            RFB.normal_msg(data);
        }
        if (RFB.state == 'reset') {
            /* close and reset connection */
            RFB.disconnect();
            RFB.init_ws();
        } else if (RFB.state == 'failed') {
            debug("Giving up!");
            RFB.disconnect();
        }
        //debug("<< onmessage");
    };
    RFB.ws.onopen = function(e) {
        debug(">> onopen");
        RFB.state = "ProtocolVersion";
        debug("<< onopen");
    };
    RFB.ws.onclose = function(e) {
        debug(">> onclose");
        RFB.state = "closed";
        debug("<< onclose");
    }
    RFB.poller.delay(RFB.poll_rate);

    debug("<< init_ws");
},

connect: function () {
    debug(">> connect");
    RFB.host = $('host').value;
    RFB.port = $('port').value;
    RFB.password = $('password').value;
    if ((!host) || (!port)) {
        debug("must set host and port");
        return;
    }
    if (RFB.ws) {
        RFB.ws.close();
    }
    RFB.init_ws();
    $('connectButton').value = "Disconnect";
    $('connectButton').onclick = RFB.disconnect;
    debug("<< connect");

},

disconnect: function () {
    debug(">> disconnect");
    if (RFB.ws) {
        RFB.ws.close();
    }
    if (Canvas.ctx) {
        Canvas.clear();
    }
    $('connectButton').value = "Connect";
    $('connectButton').onclick = RFB.connect;
    $('status').innerHTML = "Disconnected";
    debug("<< disconnect");
}

}; /* End of RFB */
