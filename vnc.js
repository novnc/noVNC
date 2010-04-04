var ws = null;
var vnc_host = '';
var vnc_port = 5900;
var rfb_state = 'ProtocolVersion';
var rfb_continue = -1;
var rfb_shared = 1;
var fb_width  = 0;
var fb_height = 0;
var fb_name = "";


Array.prototype.card8 = function (pos) {
    return this[pos];
}
Array.prototype.pushCard8 = function (num) {
    this.push(num & 0xFF);
}

Array.prototype.card16 = function (pos) {
    return (this[pos]   << 8) +
           (this[pos+1]     );
}
Array.prototype.pushCard16 = function (num) {
    this.push((num >> 8) & 0xFF,
              (num     ) & 0xFF  );
}


Array.prototype.card32 = function (pos) {
    return (this[pos]   << 24) +
           (this[pos+1] << 16) +
           (this[pos+2] <<  8) +
           (this[pos+3]      );
}
Array.prototype.pushCard32 = function (num) {
    this.push((num >> 24) & 0xFF,
              (num >> 16) & 0xFF,
              (num >>  8) & 0xFF,
              (num      ) & 0xFF  );
}

Array.prototype.substr = function (start, len) {
    return this.slice(start, start+len).map(
            function (num) { return String.fromCharCode(num); } ).join('');
}

/*
 * Server message handlers
 */

/* RFB/VNC initialisation */
function rfb_init_msg(data) {
    debug(">> rfb_init_msg");

    switch (rfb_state) {

    case 'ProtocolVersion' :
        debug("ProtocolVersion: " + data)
        if (data.length != 12) {
            debug("Invalid protocol version from server");
            rfb_state = 'reset';
            return;
        }
        send_string("RFB 003.003\n");
        rfb_state = 'Authentication';
        break;

    case 'Authentication' :
        debug("Authentication")
        if (data.length != 4) {
            debug("Invalid auth scheme");
            rfb_state = 'reset';
            return;
        }
        var scheme = data.card32(0);
        debug("Auth scheme: " + scheme);
        switch (scheme) {
            case 0:  // connection failed
                var strlen = data.card32(4);
                var reason = data.substr(8, strlen);
                debug("auth failed: " + reason);
                rfb_state = "reset";
                return;
            case 1:  // no authentication
                send_array([rfb_shared]); // ClientInitialisation
                rfb_state = "ServerInitialisation";
                break;
            case 2:  // VNC authentication
                var challenge = data.substr(4, 16);
                // TODO:
                //var crypt = des(challenge, password);
                //send_string(crypt);
                rfb_state = "Authentication-VNC";
                break;
        }
        break;

    case 'Authentication-VNC' :
        debug("Authentication-VNC")
        if (data.length != 4) {
            debug("Invalid server auth response");
            rfb_state = 'reset';
            return;
        }
        var resp = data.card32(0);
        switch (resp) {
            case 0:  // OK
                debug("Authentication OK");
                break;
            case 1:  // failed
                debug("Authentication failed");
                rfb_state = "reset";
                return;
            case 2:  // too-many
                debug("Too many authentication attempts");
                rfb_state = "reset";
                return;
        }
        send_array([rfb_shared]); // ClientInitialisation
        rfb_state = "ServerInitialisation";
        break;

    case 'ServerInitialisation' :
        debug("ServerInitialisation")
        if (data.length < 24) {
            debug("Invalid server initialisation");
            rfb_state = 'reset';
            return;
        }

        /* Screen size */
        debug("data: " + data);
        fb_width  = data.card16(0);
        fb_height = data.card16(2);

        debug("Screen size: " + fb_width + "x" + fb_height);

        /* PIXEL_FORMAT */
        var bits_per_pixel = data.card8(4);
        var depth          = data.card8(5);
        var big_endian     = data.card8(6);
        var true_color     = data.card8(7);

        debug("bits per pixel: " + bits_per_pixel);
        debug("depth: " + depth);
        debug("big_endian: " + big_endian);
        debug("true_color: " + true_color);

        /* Connection name/title */
        var name_length   = data.card32(20);
        fb_name = data.substr(24, name_length);

        debug("Name: " + fb_name);

        setEncodings();

        fbUpdateRequest(0, 0, 0, 10, 10);

        rfb_state = 'normal';
        break;
    }
    debug("<< rfb_init_msg");
}

/* Normal RFB/VNC messages */
function rfb_msg(data) {
    debug(">> rfb_msg");
    if (rfb_continue >= 0) {
        var msg_type = rfb_continue;
    } else {
        var msg_type = data.card8(0);
    }
    switch (msg_type) {
    case 0:  // FramebufferUpdate
        debug("FramebufferUpdate");
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
    debug("<< rfb_msg");
}

/*
 * Client message routines
 */

function send_string(str) {
    ws.send(Base64.encode(str));
}

function send_array(arr) {
    debug("encoded array: " + Base64.encode_array(arr));
    ws.send(Base64.encode_array(arr));
}

function setPixelFormat() {
}

function fixColourMapEntries() {
}

function setEncodings() {
    debug(">> setEncodings");
    var arr = [2];  // msg-type
    arr.pushCard8(0);  // padding
    arr.pushCard16(1); // encoding count
    arr.pushCard32(0); // raw encoding
    send_array(arr);
    debug("<< setEncodings");
}

function fbUpdateRequest(incremental, x, y, xw, yw) {
    debug(">> fbUpdateRequest");
    var arr = [3];  // msg-type
    arr.pushCard8(incremental);
    arr.pushCard16(x);
    arr.pushCard16(y);
    arr.pushCard16(xw);
    arr.pushCard16(yw);
    send_array(arr);
    debug("<< fbUpdateRequest");
}

function keyEvent() {
}

function pointerEvent() {
}

function clientCutText() {
}


/*
 * Setup routines
 */

function _init_ws() {
    debug(">> _init_ws");
    var uri = "ws://" + vnc_host + ":" + vnc_port;
    debug("connecting to " + uri);
    ws = new WebSocket(uri);
    ws.onmessage = function(e) {
        debug(">> onmessage");
        var data = Base64.decode_array(e.data);
        //debug("decoded array: " + data);
        if (rfb_state != 'normal') {
            rfb_init_msg(data);
        } else {
            rfb_msg(data);
        }
        if (rfb_state == 'reset') {
            /* close and reset connection */
            ws.close();
            _init_ws();
        }
        debug("<< onmessage");
    };
    ws.onopen = function(e) {
        debug(">> onopen");
        rfb_state = "ProtocolVersion";
        debug("<< onopen");
    };
    ws.onclose = function(e) {
        debug(">> onclose");
        rfb_state = "closed";
        debug("<< onclose");
    }
    debug("<< _init_ws");
}

function init_ws(host, port) {
    debug(">> init_ws");
    vnc_host = host;
    vnc_port = port;
    if (ws) {
        ws.close();
    }
    _init_ws();
    debug("<< init_ws");

}

/*
function draw() {
    var canvas = document.getElementById('vnc');  

    if (! canvas.getContext) return;

    var ctx = canvas.getContext('2d'); 

    ctx.fillStyle = "rgb(50,50,50)";  
    ctx.fillRect(0, 0, 800, 600);

    var img = new Image();
    img.src = "head_ani2.gif"

    ctx.drawImage(img, 10, 10);

    ctx.drawImage(canvas, 20, 20, 30, 30, 70, 70, 30, 30);
}


function draw2() {
    var canvas = document.getElementById('tutorial');  

    if (! canvas.getContext) return;

    var ctx = canvas.getContext('2d'); 

  roundedRect(ctx,12,12,150,150,15);  
  roundedRect(ctx,19,19,150,150,9);  
  roundedRect(ctx,53,53,49,33,10);  
  roundedRect(ctx,53,119,49,16,6);  
  roundedRect(ctx,135,53,49,33,10);  
  roundedRect(ctx,135,119,25,49,10);  
  
  ctx.beginPath();  
  ctx.arc(37,37,13,Math.PI/7,-Math.PI/7,true);  
  ctx.lineTo(31,37);  
  ctx.fill();  
  for(var i=0;i<8;i++){  
    ctx.fillRect(51+i*16,35,4,4);  
  }  
  for(i=0;i<6;i++){  
    ctx.fillRect(115,51+i*16,4,4);  
  }  
  for(i=0;i<8;i++){  
    ctx.fillRect(51+i*16,99,4,4);  
  }  
  ctx.beginPath();  
  ctx.moveTo(83,116);  
  ctx.lineTo(83,102);  
  ctx.bezierCurveTo(83,94,89,88,97,88);  
  ctx.bezierCurveTo(105,88,111,94,111,102);  
  ctx.lineTo(111,116);  
  ctx.lineTo(106.333,111.333);  
  ctx.lineTo(101.666,116);  
  ctx.lineTo(97,111.333);  
  ctx.lineTo(92.333,116);  
  ctx.lineTo(87.666,111.333);  
  ctx.lineTo(83,116);  
  ctx.fill();  
  ctx.fillStyle = "white";  
  ctx.beginPath();  
  ctx.moveTo(91,96);  
  ctx.bezierCurveTo(88,96,87,99,87,101);  
  ctx.bezierCurveTo(87,103,88,106,91,106);  
  ctx.bezierCurveTo(94,106,95,103,95,101);  
  ctx.bezierCurveTo(95,99,94,96,91,96);  
  ctx.moveTo(103,96);  
  ctx.bezierCurveTo(100,96,99,99,99,101);  
  ctx.bezierCurveTo(99,103,100,106,103,106);  
  ctx.bezierCurveTo(106,106,107,103,107,101);  
  ctx.bezierCurveTo(107,99,106,96,103,96);  
  ctx.fill();  
  ctx.fillStyle = "black";  
  ctx.beginPath();  
  ctx.arc(101,102,2,0,Math.PI*2,true);  
  ctx.fill();  
  ctx.beginPath();  
  ctx.arc(89,102,2,0,Math.PI*2,true);  
  ctx.fill();  
}  
function roundedRect(ctx,x,y,width,height,radius){  
  ctx.beginPath();  
  ctx.moveTo(x,y+radius);  
  ctx.lineTo(x,y+height-radius);  
  ctx.quadraticCurveTo(x,y+height,x+radius,y+height);  
  ctx.lineTo(x+width-radius,y+height);  
  ctx.quadraticCurveTo(x+width,y+height,x+width,y+height-radius);  
  ctx.lineTo(x+width,y+radius);  
  ctx.quadraticCurveTo(x+width,y,x+width-radius,y);  
  ctx.lineTo(x+radius,y);  
  ctx.quadraticCurveTo(x,y,x,y+radius);  
  ctx.stroke();  
}  
*/
debug("here10");
