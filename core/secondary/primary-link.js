import * as Log from '../util/logging.js';
import {
    QUEUED_EVENTS, RELAY_CLAIM_WAIT_MS, RELAY_CLAIM_RETRY_MS, RELAY_CLAIM_RETRIES,
    RELINK_INTERVAL_MS, RELINK_MAX_ATTEMPTS
} from './constants.js';
import { isRelayToken } from './token.js';
import { createRelayWorker } from './worker.js';

export default class PrimaryLink {
    constructor(host) {
        this._host = host;
        this._port = null;
        this._queue = [];
        this._relinking = false;
        this._relinkTimer = null;
        this._relay = null;
        this._claimRetry = null;
        this._claimSentAt = 0;
        this._ending = false;
    }

    get ending() {
        return this._ending;
    }

    markEnding() {
        this._ending = true;
    }

    post(message) {
        if (this._port) {
            this._port.postMessage(message);
        } else if (this._host.supportsMultiMonitor() && !this._relinking && QUEUED_EVENTS.has(message.eventType)) {
            this._enqueue(message);
        }
    }

    handleWindowMessage(event) {
        if (event.data.type !== 'kasm_ports' || !window.opener || event.source !== window.opener) { return; }
        this.attach(event.ports);
    }

    request() {
        const windowId = new URLSearchParams(document.location.search).get('windowId');
        if (!windowId) {
            Log.Warn("Secondary display has no window ID, it cannot attach to a primary display.");
            return;
        }
        if (window.opener && !window.opener.closed) {
            window.opener.postMessage({ type: 'kasm_hello', windowId }, window.location.origin);
            return;
        }
        const token = document.location.hash.slice(1);
        if (typeof SharedWorker === "undefined" || !isRelayToken(token)) {
            Log.Warn("Secondary display has no opener and no relay token, it cannot attach to a primary display.");
            return;
        }
        if (this._relay && this._claimSentAt && Date.now() - this._claimSentAt < RELAY_CLAIM_WAIT_MS) {
            return;
        }
        try {
            this._closeRelay();
            this._relay = createRelayWorker();
            let retries = RELAY_CLAIM_RETRIES;
            this._relay.port.onmessage = (e) => {
                if (!e.data) { return; }
                this._claimSentAt = 0;
                if (e.data.type === 'kasm_ports') {
                    clearTimeout(this._claimRetry);
                    this.attach(e.ports);
                } else if (e.data.type === 'rejected') {
                    if ((e.data.reason === 'busy' || e.data.reason === 'unknown') && !this._port && retries-- > 0) {
                        this._claimRetry = setTimeout(() => this._relay.port.postMessage({ type: 'claim', token }), RELAY_CLAIM_RETRY_MS);
                        return;
                    }
                    if (this._relinking) {
                        Log.Debug("Primary display not ready for this window (" + e.data.reason + ").");
                        return;
                    }
                    Log.Warn("Primary display refused this window (" + e.data.reason + "), it cannot attach. Close it and open a new one.");
                }
            };
            this._relay.port.start();
            this._claimSentAt = Date.now();
            this._relay.port.postMessage({ type: 'claim', token });
        } catch (err) {
            Log.Warn("Could not reach the primary display: " + err);
        }
    }

    attach(ports) {
        if (this._port || ports.length !== 3 || this._ending) {
            for (const port of ports) {
                port.close();
            }
            return;
        }
        this._port = ports[0];
        this._port.onmessage = e => this._host.handleControlMessage(e);
        this._host.attachPorts(ports[1], ports[2]);
        for (const message of this._queue) {
            this._port.postMessage(message);
        }
        this._queue = [];
        if (this._relinking) {
            this._relinking = false;
            clearTimeout(this._relinkTimer);
            this._relinkTimer = null;
            this._host.reregister();
            this._host.dispatch(new CustomEvent("connect", { detail: {} }));
        }
    }

    startRelink() {
        if (this._relinking || this._ending) { return; }
        if (this._port) {
            this._port.close();
            this._port = null;
        }
        this._queue = [];
        this._relinking = true;
        let attempts = RELINK_MAX_ATTEMPTS;
        const tick = () => {
            if (!this._relinking) { return; }
            if (attempts-- <= 0) {
                this._relinking = false;
                this._ending = true;
                this._closeRelay();
                this._host.dispatch(new CustomEvent("secondaryrelinkfailed", {}));
                return;
            }
            this.request();
            this._relinkTimer = setTimeout(tick, RELINK_INTERVAL_MS);
        };
        this._relinkTimer = setTimeout(tick, 1000);
    }

    close() {
        clearTimeout(this._relinkTimer);
        this._relinking = false;
        if (this._port) {
            this._port.close();
            this._port = null;
        }
        this._closeRelay();
    }

    _enqueue(message) {
        if (message.eventType === 'unregister') {
            this._queue = [];
            return;
        }
        const pending = this._queue[0];
        const eventType = pending && pending.eventType === 'register' ? 'register' : message.eventType;
        this._queue = [{ ...message, eventType }];
    }

    _closeRelay() {
        clearTimeout(this._claimRetry);
        if (this._relay) {
            this._relay.port.onmessage = null;
            this._relay.port.close();
            this._relay = null;
        }
    }
}
