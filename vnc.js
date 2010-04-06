var ws = null;
var vnc_host = '';
var vnc_port = 5900;
var vnc_password = '';
var fbu = {
    rects    : 0,
    bytes    : 0,
    x        : 0,
    y        : 0,
    width    : 0, 
    height   : 0,
    encoding : 0,
    arr      : null};
var fb_width  = 0;
var fb_height = 0;
var fb_name = "";
var fb_Bpp = 4;


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
 * Server message handlers
 */

RFB = {

state  : 'ProtocolVersion',
shared : 1,
poll_rate : 3000,

/* RFB/VNC initialisation */
init_msg: function (data) {
    debug(">> init_msg");

    switch (RFB.state) {

    case 'ProtocolVersion' :
        debug("ProtocolVersion:")
        if (data.length != 12) {
            debug("Invalid protocol version from server");
            RFB.state = 'reset';
            return;
        }
        debug("Server ProtocolVersion: " + data.shiftStr(11))
        RFB.send_string("RFB 003.003\n");
        RFB.state = 'Authentication';
        break;

    case 'Authentication' :
        debug("Authentication")
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
                debug("vnc_password: " + vnc_password);
                debug("challenge: " + challenge + "(" + challenge.length + ")");
                //passwd = [194, 242, 234, 194, 242, 234]; // 'COWCOW' bit mirrored
                passwd = RFB.passwdTwiddle(vnc_password);
                debug("passwd: " + passwd + "(" + passwd.length + ")");
                response = des(passwd, challenge, 1)
                debug("reponse: " + response + "(" + response.length + ")");

                RFB.send_array(response);
                RFB.state = "SecurityResult";
                break;
        }
        break;

    case 'SecurityResult' :
        debug("SecurityResult")
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
        debug("ServerInitialisation")
        if (data.length < 24) {
            debug("Invalid server initialisation");
            RFB.state = 'reset';
            return;
        }

        /* Screen size */
        //debug("data: " + data);
        fb_width  = data.shift16();
        fb_height = data.shift16();

        debug("Screen size: " + fb_width + "x" + fb_height);

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
        fb_name = data.shiftStr(name_length);

        debug("Name: " + fb_name);
        $('status').innerHTML = "Connected to: " + fb_name;

        Canvas.init('vnc', fb_width, fb_height, RFB.keyDown, RFB.keyUp);

        RFB.setEncodings();
        RFB.setPixelFormat();

        RFB.fbUpdateRequest(0, 0, 0, fb_width, fb_height);

        RFB.state = 'normal';
        break;
    }
    debug("<< init_msg");
},

/* Normal RFB/VNC messages */
normal_msg: function (data) {
    //debug(">> normal_msg");
    if ((fbu.rects > 0) || (fbu.bytes > 0)) {
        var msg_type = 0;
    } else {
        var msg_type = data.shift8();
    }
    switch (msg_type) {
    case 0:  // FramebufferUpdate
        if (fbu.rects == 0) {
            data.shift8();
            fbu.rects = data.shift16();
            debug("FramebufferUpdate, " + fbu.rects + " rects");
            fbu.bytes = 0;
            fbu.arr = [];
        } else {
            //debug("FramebufferUpdate continuation");
        }

        while (data.length > 0) {
            //debug("data.length: " + data.length);
            if (fbu.bytes == 0) {
                fbu.x      = data.shift16();
                fbu.y      = data.shift16();
                fbu.width  = data.shift16();
                fbu.height = data.shift16();
                fbu.encoding = data.shift32();
                //debug('New  rect: ' + fbu.x + "," + fbu.y + " -> " + (fbu.x + fbu.width) + "," + (fbu.y + fbu.height));
                switch (fbu.encoding) {
                    case 0:  // Raw
                        fbu.bytes = fbu.width * fbu.height * fb_Bpp;
                        break;
                    case 1:  // Copy-Rect
                        fbu_bytes = 4;
                        break;
                }
            } else {
                if (data.length >= fbu.bytes) {
                    //debug('Done rect: ' + fbu.x + "," + fbu.y + " -> " + (fbu.x + fbu.width) + "," + (fbu.y + fbu.height));
                    fbu.arr = fbu.arr.concat(data.shiftBytes(fbu.bytes))
                    fbu.bytes = 0;
                    
                    switch (fbu.encoding) {
                        case 0:  // Raw
                            debug('Raw-Rect: ' + fbu.x + "," + fbu.y + " -> " + (fbu.x + fbu.width) + "," + (fbu.y + fbu.height));
                            Canvas.rfbImage(fbu.x, fbu.y, fbu.width, fbu.height, fbu.arr);
                            break;
                        case 1:  // Copy-Rect
                            debug('Copy-Rect: ' + fbu.x + "," + fbu.y + " -> " + (fbu.x + fbu.width) + "," + (fbu.y + fbu.height));
                            var new_x = fbu.arr.shift16();
                            var new_y = fbu.arr.shift16();
                            Canvas.ctx.drawImage(Canvas.c, fbu.x, fbu.y, fbu.width, fbu.height, new_x, new_y, fbu.width, fbu.height);
                            break;
                    }
                    fbu.arr = [];
                    fbu.rects --;
                } else {
                    //debug('Part rect: ' + fbu.x + "," + fbu.y + " -> " + (fbu.x + fbu.width) + "," + (fbu.y + fbu.height));
                    fbu.bytes = fbu.bytes - data.length;
                    fbu.arr = fbu.arr.concat(data.shiftBytes(data.length))
                }
            }

            //debug("Bytes remaining: " + fbu.bytes);
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

    arr.push8(fb_Bpp * 8); // bits-per-pixel
    arr.push8(24); // depth
    arr.push8(0);  // little-endian
    arr.push8(1);  // true-color

    arr.push16(255);  // red-max
    arr.push16(255);  // green-max
    arr.push16(255);  // blue-max
    arr.push8(16);    // red-shift
    arr.push8(8);     // green-shift
    arr.push8(0);     // blue-shift

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
    var arr = [2];  // msg-type
    arr.push8(0);  // padding
    arr.push16(2); // encoding count
    arr.push32(1); // copy-rect encoding
    arr.push32(0); // raw encoding
    RFB.send_array(arr);
    debug("<< setEncodings");
},

fbUpdateRequest: function (incremental, x, y, xw, yw) {
    debug(">> fbUpdateRequest");
    var arr = [3];  // msg-type
    arr.push8(incremental);
    arr.push16(x);
    arr.push16(y);
    arr.push16(xw);
    arr.push16(yw);
    RFB.send_array(arr);
    debug("<< fbUpdateRequest");
},

keyEvent: function (key, code, down) {
    debug(">> keyEvent: " + key + "(" + code + ") " + down);
    var arr = [4];  // msg-type
    arr.push8(down);
    arr.push16(0);
    arr.push32(code);
    RFB.send_array(arr);
    RFB.fbUpdateRequest(1, 0, 0, fb_width, fb_height);
    debug("<< keyEvent");
},

pointerEvent: function () {
},

clientCutText: function () {
},


/*
 * Utility routines
 */

send_string: function (str) {
    ws.send(Base64.encode(str));
},

send_array: function (arr) {
    debug("encoded array: " + Base64.encode_array(arr));
    ws.send(Base64.encode_array(arr));
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
        RFB.fbUpdateRequest(1, 0, 0, fb_width, fb_height);
        RFB.poller.delay(RFB.poll_rate);
    }
},

keyDown: function (e) {
    e.stop();
    RFB.keyEvent(e.key, e.code, 1);
},

keyUp: function (e) {
    e.stop();
    RFB.keyEvent(e.key, e.code, 0);
},


/*
 * Setup routines
 */

init_ws: function () {
    debug(">> init_ws");
    var uri = "ws://" + vnc_host + ":" + vnc_port;
    debug("connecting to " + uri);
    ws = new WebSocket(uri);
    ws.onmessage = function(e) {
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
    ws.onopen = function(e) {
        debug(">> onopen");
        RFB.state = "ProtocolVersion";
        debug("<< onopen");
    };
    ws.onclose = function(e) {
        debug(">> onclose");
        RFB.state = "closed";
        debug("<< onclose");
    }
    RFB.poller.delay(RFB.poll_rate);

    debug("<< init_ws");
},

connect: function () {
    debug(">> connect");
    vnc_host = $('host').value;
    vnc_port = $('port').value;
    vnc_password = $('password').value;
    if ((!host) || (!port)) {
        debug("must set host and port");
        return;
    }
    if (ws) {
        ws.close();
    }
    RFB.init_ws();
    $('connectButton').value = "Disconnect";
    $('connectButton').onclick = RFB.disconnect;
    debug("<< connect");

},

disconnect: function () {
    debug(">> disconnect");
    if (ws) {
        ws.close();
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
