/*
 * noVNC: HTML5 VNC client
 * Copyright (c) 2025 Tobias Fahleson
 * Licensed under MPL 2.0 or any later version (see LICENSE.txt)
 */

import * as Log from './util/logging.js';

export default class Clipboard {
    constructor(target) {
        this._target = target;
        this._isGrabbed = false;
        this.onRead = () => {};
    }

    async _handleFocus(event) {
        try {
            const text = await navigator.clipboard.readText();
            this.onRead(text);
        } catch (error) {
            Log.Error("Clipboard read failed: ", error);
        }
    }

    async writeClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
        } catch (error) {
            Log.Error("Clipboard write failed: ", error);
        }
    }

    grab() {
        if (this._isGrabbed) return;
        this._target.addEventListener('focus', this._handleFocus.bind(this));
        this._isGrabbed = true;
    }

    ungrab() {
        if (!this._isGrabbed) return;
        this._target.removeEventListener('focus', this._handleFocus.bind(this));
        this._isGrabbed = false;
    }
}
