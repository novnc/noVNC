/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2020 The noVNC Authors
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 */

export default class AudioBuffer {
    constructor(codec) {
        this._codec = codec;
        // instantiate a media source and audio buffer/queue
        this._mediaSource = new MediaSource();
        this._audioBuffer = null;
        this._audioQ = [];

        // create a hidden audio element
        this._audio = document.createElement('audio');
        this._audio.src = window.URL.createObjectURL(this._mediaSource);

        // when data is queued, start playing
        this._mediaSource.addEventListener('sourceopen', this._onSourceOpen, false);
    }

    _onSourceOpen(e) {
        this._audio.play();
        this._audioBuffer = this._mediaSource.addSourceBuffer(this._codec);
        this._audioBuffer.addEventListener('update', this._onUpdateBuffer);
    }

    _onUpdateBuffer() {
        if (this._audioQ.length > 0 && !this._audioBuffer.updating) {
            this._audioBuffer.appendBuffer(this._audioQ.shift());
        }
    }

    queueAudio(data) {
        if (this._audioBuffer !== null) {
            if (this._audioBuffer.updating || this._audioQ.length > 0) {
                this._audioQ.push(data);
            } else {
                this._audioBuffer.appendBuffer(data);
            }
        }
    }

    close() {}  // intentionally left empty as no cleanup seems necessary
}