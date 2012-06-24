/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2012 Joel Martin
 * Licensed under LGPL-3 (see LICENSE.LGPL-3)
 */

"use strict";
/*jslint browser: true, white: false */
/*global Util, VNC_frame_data, finish */

var rfb, mode, test_state, frame_idx, frame_length,
    iteration, iterations, istart_time,

    // Pre-declarations for jslint
    send_array, next_iteration, queue_next_packet, do_packet;

// Override send_array
send_array = function (arr) {
    // Stub out send_array
};

next_iteration = function () {
    if (iteration === 0) {
        frame_length = VNC_frame_data.length;
        test_state = 'running';
    } else {
        rfb.disconnect();
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

do_packet = function () {
    //Util.Debug("Processing frame: " + frame_idx);
    var frame = VNC_frame_data[frame_idx];
    rfb.recv_message({'data' : frame.slice(frame.indexOf('{', 1) + 1)});
    frame_idx += 1;

    queue_next_packet();
};

