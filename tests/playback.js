/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2012 Joel Martin
 * Licensed under MPL 2.0 (see LICENSE.txt)
 */

"use strict";
/*jslint browser: true, white: false */
/*global Util, VNC_frame_data, finish */

var rfb, mode, test_state, frame_idx, frame_length,
    iteration, iterations, istart_time, encoding,

    // Pre-declarations for jslint
    send_array, next_iteration, end_iteration, queue_next_packet,
    do_packet, enable_test_mode;

// Override send_array
send_array = function (arr) {
    // Stub out send_array
};

// Immediate polyfill
if (window.setImmediate === undefined) {
    var _immediateIdCounter = 1;
    var _immediateFuncs = {};

    window.setImmediate = function (func) {
        var index = Util._immediateIdCounter++;
        _immediateFuncs[index] = func;
        window.postMessage("noVNC immediate trigger:" + index, "*");
        return index;
    };

    window.clearImmediate = function (id) {
        _immediateFuncs[id];
    };

    var _onMessage = function (event) {
        if ((typeof event.data !== "string") ||
            (event.data.indexOf("noVNC immediate trigger:") !== 0)) {
            return;
        }

        var index = event.data.slice("noVNC immediate trigger:".length);

        var callback = _immediateFuncs[index];
        if (callback === undefined) {
            return;
        }

        delete _immediateFuncs[index];

        callback();
    };
    window.addEventListener("message", _onMessage);
}

enable_test_mode = function () {
    rfb._sock.send = send_array;
    rfb._sock.close = function () {};
    rfb._sock.flush = function () {};
    rfb._checkEvents = function () {};
    rfb.connect = function (host, port, password, path) {
        this._rfb_host = host;
        this._rfb_port = port;
        this._rfb_password = (password !== undefined) ? password : "";
        this._rfb_path = (path !== undefined) ? path : "";
        this._sock.init('binary', 'ws');
        this._rfb_connection_state = 'connecting';
        this._rfb_init_state = 'ProtocolVersion';
    };
};

next_iteration = function () {
    rfb = new RFB({'target': document.getElementById('VNC_canvas'),
                   'view_only': true,
                   'onDisconnected': disconnected,
                   'onNotification': notification});
    enable_test_mode();

    // Missing in older recordings
    if (typeof VNC_frame_encoding === 'undefined') {
        var frame = VNC_frame_data[0];
        var start = frame.indexOf('{', 1) + 1;
        if (frame.slice(start).startsWith('UkZC')) {
            encoding = 'base64';
        } else {
            encoding = 'binary';
        }
    } else {
        encoding = VNC_frame_encoding;
    }

    if (iteration === 0) {
        frame_length = VNC_frame_data.length;
        test_state = 'running';
    }

    if (test_state !== 'running') { return; }

    iteration += 1;
    if (iteration > iterations) {
        finish();
        return;
    }

    frame_idx = 0;
    istart_time = (new Date()).getTime();
    rfb.connect('test', 0, "bogus");

    queue_next_packet();

};

end_iteration = function () {
    if (rfb._display.pending()) {
        rfb._display.set_onFlush(function () {
            if (rfb._flushing) {
                rfb._onFlush();
            }
            end_iteration();
        });
        rfb._display.flush();
    } else {
        next_iteration();
    }
};

queue_next_packet = function () {
    var frame, foffset, toffset, delay;
    if (test_state !== 'running') { return; }

    frame = VNC_frame_data[frame_idx];
    while ((frame_idx < frame_length) && (frame.charAt(0) === "}")) {
        //Util.Debug("Send frame " + frame_idx);
        frame_idx += 1;
        frame = VNC_frame_data[frame_idx];
    }

    if (frame === 'EOF') {
        Util.Debug("Finished, found EOF");
        end_iteration();
        return;
    }
    if (frame_idx >= frame_length) {
        Util.Debug("Finished, no more frames");
        end_iteration();
        return;
    }

    if (mode === 'realtime') {
        foffset = frame.slice(1, frame.indexOf('{', 1));
        toffset = (new Date()).getTime() - istart_time;
        delay = foffset - toffset;
        if (delay < 1) {
            delay = 1;
        }

        setTimeout(do_packet, delay);
    } else {
        window.setImmediate(do_packet);
    }
};

var bytes_processed = 0;

do_packet = function () {
    // Avoid having an excessive queue buildup
    if (rfb._flushing && (mode !== 'realtime')) {
        rfb._display.set_onFlush(function () {
            rfb._display.set_onFlush(rfb._onFlush.bind(rfb));
            rfb._onFlush();
            do_packet();
        });
        return;
    }

    //Util.Debug("Processing frame: " + frame_idx);
    var frame = VNC_frame_data[frame_idx],
        start = frame.indexOf('{', 1) + 1;
    var u8;
    if (encoding === 'base64') {
        u8 = Base64.decode(frame.slice(start));
        start = 0;
    } else {
        u8 = new Uint8Array(frame.length - start);
        for (var i = 0; i < frame.length - start; i++) {
            u8[i] = frame.charCodeAt(start + i);
        }
    }
    bytes_processed += u8.length;
    rfb._sock._recv_message({'data' : u8});
    frame_idx += 1;

    queue_next_packet();
};

