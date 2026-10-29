/*
 * noVNC: HTML5 VNC client
 * Copyright (c) 2025 The noVNC authors
 * Licensed under MPL 2.0 or any later version (see LICENSE.txt)
 */

import * as Log from './util/logging.js';
import { browserAsyncClipboardSupport } from './util/browser.js';

export default class AsyncClipboard {
    constructor(target) {
        this._target = target || null;

        this._isAvailable = null;

        this._eventHandlers = {
            'focus': this._handleFocus.bind(this),
        };

        // ===== EVENT HANDLERS =====

        this.onpaste = () => {};
    }

    // ===== PRIVATE METHODS =====

    async _ensureAvailable() {
        if (this._isAvailable !== null) return this._isAvailable;
        try {
            const status = await browserAsyncClipboardSupport();
            this._isAvailable = (status === 'available');
        } catch {
            this._isAvailable = false;
        }
        return this._isAvailable;
    }

    async _handleFocus(event) {
        if (!(await this._ensureAvailable())) return;
        try {
            const text = await navigator.clipboard.readText();
            this.onpaste(text);
        } catch (error) {
            Log.Error("Clipboard read failed: ", error);
        }
    }

    // ===== PUBLIC METHODS =====

    writeClipboard(text) {
        // Can lazily check cached availability
        if (!this._isAvailable) return false;
        navigator.clipboard.writeText(text)
            .catch(error => Log.Error("Clipboard write failed: ", error));
        return true;
    }

    grab() {
        if (!this._target) return;
        this._ensureAvailable()
            .then((isAvailable) => {
                if (isAvailable) {
                    this._target.addEventListener('focus', this._eventHandlers.focus);
                }
            });
    }

    ungrab() {
        if (!this._target) return;
        this._target.removeEventListener('focus', this._eventHandlers.focus);
    }
}
