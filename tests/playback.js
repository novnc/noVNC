var rfb, mode, test_state, frame_idx, frame_length,
    iteration, iterations, istart_time;

// Override send_array
send_array = function (arr) {
    // Stub out send_array
}

function next_iteration () {
    var time, iter_time, end_time;

    if (iteration === 0) {
        frame_length = VNC_frame_data.length;
        test_state = 'running';
    } else {
        rfb.disconnect();
    }
    
    if (test_state !== 'running') { return; }

    iteration++;
    if (iteration > iterations) {
        finish();
        return;
    }

    frame_idx = 0;
    istart_time = (new Date()).getTime();
    rfb.connect('test', 0, "bogus");

    queue_next_packet();

}

function queue_next_packet () {
    var frame, now, foffset, toffset, delay;
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
}

function do_packet () {
    //Util.Debug("Processing frame: " + frame_idx);
    frame = VNC_frame_data[frame_idx];
    rfb.recv_message({'data' : frame.slice(frame.indexOf('{', 1)+1)});
    frame_idx += 1;

    queue_next_packet();
}

