/*
 * Websock: high-performance binary WebSockets
 * Copyright (C) 2011 Joel Martin
 * Licensed under LGPL-3 (see LICENSE.txt)
 *
 * Websock is similar to the standard WebSocket object but Websock
 * enables communication with raw TCP sockets (i.e. the binary stream)
 * via websockify. This is accomplished by base64 encoding the data
 * stream between Websock and websockify.
 *
 * Websock has built-in receive queue buffering; the message event
 * does not contain actual data but is simply a notification that
 * there is new data available. Several rQ* methods are available to
 * read binary data off of the receive queue.
 */


// Load Flash WebSocket emulator if needed

if (window.WebSocket) {
    Websock_native = true;
} else {
    /* no builtin WebSocket so load web_socket.js */
    Websock_native = false;
    (function () {
        function get_INCLUDE_URI() {
            return (typeof INCLUDE_URI !== "undefined") ?
                INCLUDE_URI : "include/";
        }

        var start = "<script src='" + get_INCLUDE_URI(),
            end = "'><\/script>", extra = "";

        WEB_SOCKET_SWF_LOCATION = get_INCLUDE_URI() +
                    "web-socket-js/WebSocketMain.swf";
        extra += start + "web-socket-js/swfobject.js" + end;
        extra += start + "web-socket-js/FABridge.js" + end;
        extra += start + "web-socket-js/web_socket.js" + end;
        document.write(extra);
    }());
}


function Websock() {

var api = {},         // Public API
    websocket = null, // WebSocket object
    rQ = [],          // Receive queue
    rQi = 0,          // Receive queue index
    rQmax = 10000,    // Max receive queue size before compacting
    sQ = [],          // Send queue

    eventHandlers = {
        'message' : function() {},
        'open'    : function() {},
        'close'   : function() {},
        'error'   : function() {}
    };


//
// Queue public functions
//

function get_sQ() {
    return sQ;
}

function get_rQ() {
    return rQ;
}
function get_rQi() {
    return rQi;
}
set_rQi = function(val) {
    rQi = val;
}

function rQlen() {
    return rQ.length - rQi;
}

function rQpeek8() {
    return (rQ[rQi]      );
}
function rQshift8() {
    return (rQ[rQi++]      );
}
function rQunshift8(num) {
    if (rQi === 0) {
        rQ.unshift(num);
    } else {
        rQi -= 1;
        rQ[rQi] = num;
    }

}
function rQshift16() {
    return (rQ[rQi++] <<  8) +
           (rQ[rQi++]      );
}
function rQshift32() {
    return (rQ[rQi++] << 24) +
           (rQ[rQi++] << 16) +
           (rQ[rQi++] <<  8) +
           (rQ[rQi++]      );
}
function rQshiftStr(len) {
    var arr = rQ.slice(rQi, rQi + len);
    rQi += len;
    return arr.map(function (num) {
            return String.fromCharCode(num); } ).join('');

}
function rQshiftBytes(len) {
    rQi += len;
    return rQ.slice(rQi-len, rQi);
}

function rQslice(start, end) {
    if (end) {
        return rQ.slice(rQi + start, rQi + end);
    } else {
        return rQ.slice(rQi + start);
    }
}

// Check to see if we must wait for 'num' bytes (default to FBU.bytes)
// to be available in the receive queue. Return true if we need to
// wait (and possibly print a debug message), otherwise false.
function rQwait(msg, num, goback) {
    var rQlen = rQ.length - rQi; // Skip rQlen() function call
    if (rQlen < num) {
        if (goback) {
            if (rQi < goback) {
                throw("rQwait cannot backup " + goback + " bytes");
            }
            rQi -= goback;
        }
        //Util.Debug("   waiting for " + (num-rQlen) +
        //           " " + msg + " byte(s)");
        return true;  // true means need more data
    }
    return false;
}

//
// Private utility routines
//

function encode_message() {
    /* base64 encode */
    return Base64.encode(sQ);
}

function decode_message(data) {
    //Util.Debug(">> decode_message: " + data);
    /* base64 decode */
    rQ = rQ.concat(Base64.decode(data, 0));
    //Util.Debug(">> decode_message, rQ: " + rQ);
}


//
// Public Send functions
//

function flush() {
    if (websocket.bufferedAmount !== 0) {
        Util.Debug("bufferedAmount: " + websocket.bufferedAmount);
    }
    if (websocket.bufferedAmount < 1000) {
        //Util.Debug("arr: " + arr);
        //Util.Debug("sQ: " + sQ);
        if (sQ) {
            websocket.send(encode_message(sQ));
            sQ = [];
        }
        return true;
    } else {
        Util.Info("Delaying send, bufferedAmount: " +
                websocket.bufferedAmount);
        return false;
    }
}

// overridable for testing
function send(arr) {
    //Util.Debug(">> send_array: " + arr);
    sQ = sQ.concat(arr);
    return flush();
};

function send_string(str) {
    //Util.Debug(">> send_string: " + str);
    api.send(str.split('').map(
        function (chr) { return chr.charCodeAt(0); } ) );
}

//
// Other public functions

function recv_message(e) {
    //Util.Debug(">> recv_message: " + e.data.length);

    try {
        decode_message(e.data);
        if (rQlen() > 0) {
            eventHandlers['message']();
            // Compact the receive queue
            if (rQ.length > rQmax) {
                //Util.Debug("Compacting receive queue");
                rQ = rQ.slice(rQi);
                rQi = 0;
            }
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
            eventHandlers['error'](exc.name + ": " + exc.message);
        } else {
            eventHandlers['error'](exc);
        }
    }
    //Util.Debug("<< recv_message");
};


// Set event handlers
function on(evt, handler) { 
    eventHandlers[evt] = handler;
}

function init() {
    rQ         = [];
    rQi        = 0;
    sQ         = [];
    websocket  = null;
}

function open(uri) {
    init();

    websocket = new WebSocket(uri);

    websocket.onmessage = recv_message;
    websocket.onopen = function(e) {
        Util.Debug(">> WebSock.onopen");
        eventHandlers['open']();
        Util.Debug("<< WebSock.onopen");
    }
    websocket.onclose = function(e) {
        Util.Debug(">> WebSock.onclose");
        eventHandlers['close']();
        Util.Debug("<< WebSock.onclose");
    }
    websocket.onerror = function(e) {
        Util.Debug("<< WebSock.onerror: " + e);
        eventHandlers['error'](e);
        Util.Debug("<< WebSock.onerror: ");
    }
}

function close() {
    if (websocket) {
        if ((websocket.readyState === WebSocket.OPEN) ||
            (websocket.readyState === WebSocket.CONNECTING)) {
            Util.Info("Closing WebSocket connection");
            websocket.close();
        }
        websocket.onmessage = function (e) { return; };
    }
}

function constructor() {
    // Direct access to send and receive queues
    api.get_sQ       = get_sQ;
    api.get_rQ       = get_rQ;
    api.get_rQi      = get_rQi;
    api.set_rQi      = set_rQi;

    // Routines to read from the receive queue
    api.rQlen        = rQlen;
    api.rQpeek8      = rQpeek8;
    api.rQshift8     = rQshift8;
    api.rQunshift8   = rQunshift8;
    api.rQshift16    = rQshift16;
    api.rQshift32    = rQshift32;
    api.rQshiftStr   = rQshiftStr;
    api.rQshiftBytes = rQshiftBytes;
    api.rQslice      = rQslice;
    api.rQwait       = rQwait;

    api.flush        = flush;
    api.send         = send;
    api.send_string  = send_string;

    api.recv_message = recv_message;
    api.on           = on;
    api.init         = init;
    api.open         = open;
    api.close        = close;

    return api;
}

return constructor();

}
