/*
 * noVNC: HTML5 VNC client
 * Copyright (c) 2021 Juanjo Díaz
 * Licensed under MPL 2.0 or any later version (see LICENSE.txt)
 */

export default class Clipboard {
    constructor(target) {
        this._target = target;

        this._eventHandlers = {
            'copy': this._handleCopy.bind(this),
            'focus': this._handleFocus.bind(this)
        };

        // ===== EVENT HANDLERS =====

        this.onpaste = () => {};
    }

    // ===== PRIVATE METHODS =====

    async _handleCopy(e) {
        try {
            if (navigator.permissions && navigator.permissions.query) {
                const permission = await navigator.permissions.query({ name: "clipboard-write", allowWithoutGesture: false });
                if (permission.state === 'denied') return;
            }
        } catch (err) {
            // Some browsers might error due to lack of support, e.g. Firefox.
        }

        if (navigator.clipboard.writeText) {
            try {
                await navigator.clipboard.writeText(e.clipboardData.getData('text/plain'));
            } catch (e) {
                /* Do nothing */
            }
        }
    }

    async _handleFocus() {
        try {
            if (navigator.permissions && navigator.permissions.query) {
                const permission = await navigator.permissions.query({ name: "clipboard-read", allowWithoutGesture: false });
                if (permission.state === 'denied') return;
            }
        } catch (err) {
            // Some browsers might error due to lack of support, e.g. Firefox.
        }

        if (navigator.clipboard.readText) {
            try {
                const data = await navigator.clipboard.readText();
                this.onpaste(data);
            } catch (e) {
                /* Do nothing */
                return;
            }
        }
    }

    // ===== PUBLIC METHODS =====

    grab() {
        if (!Clipboard.isSupported) return;
        this._target.addEventListener('copy', this._eventHandlers.copy);
        this._target.addEventListener('focus', this._eventHandlers.focus);
    }

    ungrab() {
        if (!Clipboard.isSupported) return;
        this._target.removeEventListener('copy', this._eventHandlers.copy);
        this._target.removeEventListener('focus', this._eventHandlers.focus);
    }
}

Clipboard.isSupported = (navigator && navigator.clipboard) ? true : false;