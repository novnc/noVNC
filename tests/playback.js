/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2012 Joel Martin
 * Licensed under MPL 2.0 (see LICENSE.txt)
 */

"use strict";
/*jslint browser: true, white: false */
/*global Util, VNC_frame_data, finish */

var rfb, mode, test_state, frame_idx, frame_length,
    iteration, iterations, istart_time,

    // Pre-declarations for jslint
    send_array, next_iteration, queue_next_packet, do_packet, enable_test_mode;

// Override send_array
send_array = function (arr) {
    // Stub out send_array
};

enable_test_mode = function () {
    rfb._sock._mode = VNC_frame_encoding;
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
        this._updateState('ProtocolVersion', "Starting VNC handshake");
    };
};

next_iteration = function () {
    rfb = new RFB({'target': document.getElementById('VNC_canvas'),
                   'onUpdateState': updateState});
    enable_test_mode();

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
        next_iteration();
        return;
    }
    if (frame_idx >= frame_length) {
        Util.Debug("Finished, no more frames");
        next_iteration();
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
        setTimeout(do_packet, 1);
    }
};

var bytes_processed = 0;

do_packet = function () {
    //Util.Debug("Processing frame: " + frame_idx);
    var frame = VNC_frame_data[frame_idx],
        start = frame.indexOf('{', 1) + 1;
    bytes_processed += frame.length - start;
    if (VNC_frame_encoding === 'binary') {
        var u8 = new Uint8Array(frame.length - start);
        for (var i = 0; i < frame.length - start; i++) {
            u8[i] = frame.charCodeAt(start + i);
        }
        rfb._sock._recv_message({'data' : u8});
    } else {
        rfb._sock._recv_message({'data' : frame.slice(start)});
    }
    frame_idx += 1;

    queue_next_packet();
};

