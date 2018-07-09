/* global VNC_frame_data, VNC_frame_encoding */

import * as WebUtil from '../app/webutil.js';
import RecordingPlayer from './playback.js';

let frames = null;
let encoding = null;

function message(str) {
    const cell = document.getElementById('messages');
    cell.textContent += str + "\n";
    cell.scrollTop = cell.scrollHeight;
}

function loadFile() {
    const fname = WebUtil.getQueryVar('data', null);

    if (!fname) {
        return Promise.reject("Must specify data=FOO in query string.");
    }

    message("Loading " + fname);

    return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.onload = resolve;
        script.onerror = reject;
        document.body.appendChild(script);
        script.src = "../recordings/" + fname;
    });
}

function enableUI() {
    const iterations = WebUtil.getQueryVar('iterations', 3);
    document.getElementById('iterations').value = iterations;

    const mode = WebUtil.getQueryVar('mode', 3);
    if (mode === 'realtime') {
        document.getElementById('mode2').checked = true;
    } else {
        document.getElementById('mode1').checked = true;
    }

    message("VNC_frame_data.length: " + VNC_frame_data.length);

    const startButton = document.getElementById('startButton');
    startButton.disabled = false;
    startButton.addEventListener('click', start);

    frames = VNC_frame_data;
    // Only present in older recordings
    if (window.VNC_frame_encoding)
        encoding = VNC_frame_encoding;
}

class IterationPlayer {
    constructor(iterations, frames, encoding) {
        this._iterations = iterations;

        this._iteration = undefined;
        this._player = undefined;

        this._start_time = undefined;

        this._frames = frames;
        this._encoding = encoding;

        this._state = 'running';

        this.onfinish = () => {};
        this.oniterationfinish = () => {};
        this.rfbdisconnected = () => {};
    }

    start(mode) {
        this._iteration = 0;
        this._start_time = (new Date()).getTime();

        this._realtime = mode.startsWith('realtime');
        this._trafficMgmt = !mode.endsWith('-no-mgmt');

        this._nextIteration();
    }

    _nextIteration() {
        const player = new RecordingPlayer(this._frames, this._encoding, this._disconnected.bind(this));
        player.onfinish = this._iterationFinish.bind(this);

        if (this._state !== 'running') { return; }

        this._iteration++;
        if (this._iteration > this._iterations) {
            this._finish();
            return;
        }

        player.run(this._realtime, this._trafficMgmt);
    }

    _finish() {
        const endTime = (new Date()).getTime();
        const totalDuration = endTime - this._start_time;

        const evt = new Event('finish');
        evt.duration = totalDuration;
        evt.iterations = this._iterations;
        this.onfinish(evt);
    }

    _iterationFinish(duration) {
        const evt = new Event('iterationfinish');
        evt.duration = duration;
        evt.number = this._iteration;
        this.oniterationfinish(evt);

        this._nextIteration();
    }

    _disconnected(clean, frame) {
        if (!clean) {
            this._state = 'failed';
        }

        const evt = new Event('rfbdisconnected');
        evt.clean = clean;
        evt.frame = frame;
        evt.iteration = this._iteration;

        this.onrfbdisconnected(evt);
    }
}

function start() {
    document.getElementById('startButton').value = "Running";
    document.getElementById('startButton').disabled = true;

    const iterations = document.getElementById('iterations').value;

    let mode;

    if (document.getElementById('mode1').checked) {
        message(`Starting performance playback (fullspeed) [${iterations} iteration(s)]`);
        mode = 'perftest';
    } else {
        message(`Starting realtime playback [${iterations} iteration(s)]`);
        mode = 'realtime';
    }

    const player = new IterationPlayer(iterations, frames, encoding);
    player.oniterationfinish = (evt) => {
        message(`Iteration ${evt.number} took ${evt.duration}ms`);
    };
    player.onrfbdisconnected = (evt) => {
        if (!evt.clean) {
            message(`noVNC sent disconnected during iteration ${evt.iteration} frame ${evt.frame}`);
        }
    };
    player.onfinish = (evt) => {
        const iterTime = parseInt(evt.duration / evt.iterations, 10);
        message(`${evt.iterations} iterations took ${evt.duration}ms (average ${iterTime}ms / iteration)`);

        document.getElementById('startButton').disabled = false;
        document.getElementById('startButton').value = "Start";
    };
    player.start(mode);
}

loadFile().then(enableUI).catch(e => message("Error loading recording: " + e));
