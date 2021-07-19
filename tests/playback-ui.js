/* global VNC_frame_data, VNC_frame_encoding */

import * as WebUtil from '../app/webutil.js';
import RecordingPlayer from './playback.js';
import Base64 from '../core/base64.js';

let frames = null;

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

    message("Loading " + fname + "...");

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

    /* eslint-disable-next-line camelcase */
    message("Loaded " + VNC_frame_data.length + " frames");

    const startButton = document.getElementById('startButton');
    startButton.disabled = false;
    startButton.addEventListener('click', start);

    message("Converting...");

    /* eslint-disable-next-line camelcase */
    frames = VNC_frame_data;

    let encoding;

    /* eslint-disable camelcase */
    if (window.VNC_frame_encoding) {
        // Only present in older recordings
        encoding = VNC_frame_encoding;
    /* eslint-enable camelcase */
    } else {
        let frame = frames[0];
        let start = frame.indexOf('{', 1) + 1;
        if (frame.slice(start, start+4) === 'UkZC') {
            encoding = 'base64';
        } else {
            encoding = 'binary';
        }
    }

    for (let i = 0;i < frames.length;i++) {
        let frame = frames[i];

        if (frame === "EOF") {
            frames.splice(i);
            break;
        }

        let dataIdx = frame.indexOf('{', 1) + 1;

        let time = parseInt(frame.slice(1, dataIdx - 1));

        let u8;
        if (encoding === 'base64') {
            u8 = Base64.decode(frame.slice(dataIdx));
        } else {
            u8 = new Uint8Array(frame.length - dataIdx);
            for (let j = 0; j < frame.length - dataIdx; j++) {
                u8[j] = frame.charCodeAt(dataIdx + j);
            }
        }

        frames[i] = { fromClient: frame[0] === '}',
                      timestamp: time,
                      data: u8 };
    }

    message("Ready");
}

class IterationPlayer {
    constructor(iterations, frames) {
        this._iterations = iterations;

        this._iteration = undefined;
        this._player = undefined;

        this._startTime = undefined;

        this._frames = frames;

        this._state = 'running';

        this.onfinish = () => {};
        this.oniterationfinish = () => {};
        this.rfbdisconnected = () => {};
    }

    start(realtime) {
        this._iteration = 0;
        this._startTime = (new Date()).getTime();

        this._realtime = realtime;

        this._nextIteration();
    }

    _nextIteration() {
        const player = new RecordingPlayer(this._frames, this._disconnected.bind(this));
        player.onfinish = this._iterationFinish.bind(this);

        if (this._state !== 'running') { return; }

        this._iteration++;
        if (this._iteration > this._iterations) {
            this._finish();
            return;
        }

        player.run(this._realtime, false);
    }

    _finish() {
        const endTime = (new Date()).getTime();
        const totalDuration = endTime - this._startTime;

        const evt = new CustomEvent('finish',
                                    { detail:
                                      { duration: totalDuration,
                                        iterations: this._iterations } } );
        this.onfinish(evt);
    }

    _iterationFinish(duration) {
        const evt = new CustomEvent('iterationfinish',
                                    { detail:
                                      { duration: duration,
                                        number: this._iteration } } );
        this.oniterationfinish(evt);

        this._nextIteration();
    }

    _disconnected(clean, frame) {
        if (!clean) {
            this._state = 'failed';
        }

        const evt = new CustomEvent('rfbdisconnected',
                                    { detail:
                                      { clean: clean,
                                        frame: frame,
                                        iteration: this._iteration } } );
        this.onrfbdisconnected(evt);
    }
}

function start() {
    document.getElementById('startButton').value = "Running";
    document.getElementById('startButton').disabled = true;

    const iterations = document.getElementById('iterations').value;

    let realtime;

    if (document.getElementById('mode1').checked) {
        message(`Starting performance playback (fullspeed) [${iterations} iteration(s)]`);
        realtime = false;
    } else {
        message(`Starting realtime playback [${iterations} iteration(s)]`);
        realtime = true;
    }

    const player = new IterationPlayer(iterations, frames);
    player.oniterationfinish = (evt) => {
        message(`Iteration ${evt.detail.number} took ${evt.detail.duration}ms`);
    };
    player.onrfbdisconnected = (evt) => {
        if (!evt.detail.clean) {
            message(`noVNC sent disconnected during iteration ${evt.detail.iteration} frame ${evt.detail.frame}`);
        }
    };
    player.onfinish = (evt) => {
        const iterTime = parseInt(evt.detail.duration / evt.detail.iterations, 10);
        message(`${evt.detail.iterations} iterations took ${evt.detail.duration}ms (average ${iterTime}ms / iteration)`);

        document.getElementById('startButton').disabled = false;
        document.getElementById('startButton').value = "Start";
    };
    player.start(realtime);
}

loadFile().then(enableUI).catch(e => message("Error loading recording: " + e));
