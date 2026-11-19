import * as Log from '../util/logging.js';
import {
    MAX_SECONDARY_WINDOWS, RELAY_REOPEN_GRACE_MS, RELAY_RESUME_RETRY_MS,
    RELAY_RESUME_RETRIES, RELAY_PROBE_MS, RELAY_PING_MS, RELAY_LINK_WAIT_MS,
    RELINK_INTERVAL_MS, RELINK_MAX_ATTEMPTS, RELAY_STORE_KEY
} from './constants.js';
import { isRelayToken, newRelaySecret } from './token.js';
import { createRelayWorker } from './worker.js';

export default class SecondaryLinkManager {
    constructor(host) {
        this._host = host;
        this._windows = new Map();
        this._links = new Map();
        this._relay = null;
        this._relayPing = null;
        this._tokens = new Map();
        this._keys = new Map();
        this._grace = new Map();
        this._pendingClaims = null;
        this._pendingHellos = null;
        this._resuming = null;
        this._resumeTimers = null;
        this._resumeTries = null;
        this._leaving = false;
        this._deliberate = false;
    }

    get leaving() {
        return this._leaving;
    }

    setLeaving(leaving) {
        this._leaving = leaving;
    }

    markDeliberate() {
        this._deliberate = true;
    }

    broadcast(message, lifecycle) {
        for (const link of this._links.values()) {
            if (lifecycle || link.screenID !== null) {
                link.port.postMessage(message);
            }
        }
    }

    screenTaken(link, screenID) {
        for (const other of this._links.values()) {
            if (other !== link && other.screenID === screenID) { return true; }
        }
        return false;
    }

    registerWindow(windowId, win) {
        if (windowId && win) {
            this.prune();
            this._windows.set(windowId, win);
        }
    }

    prune() {
        const tokenised = new Set(this._tokens.values());
        for (const [windowId, win] of [...this._windows]) {
            if (win.closed && !tokenised.has(windowId) && !this._links.has(windowId)) {
                this._windows.delete(windowId);
            }
        }
    }

    reserveToken(windowId) {
        if (!windowId || typeof SharedWorker === "undefined" ||
            !window.crypto || !crypto.getRandomValues || !this._ensureRelay()) {
            return null;
        }
        return this._registerToken(windowId);
    }

    releaseToken(windowId) {
        for (const [token, id] of [...this._tokens]) {
            if (id !== windowId) { continue; }
            this._tokens.delete(token);
            this._keys.delete(token);
            if (this._relay) {
                this._relay.port.postMessage({ type: 'unregister', token });
            }
        }
        this._saveRooms();
    }

    restore() {
        if (typeof SharedWorker === "undefined") { return; }
        let rooms;
        try {
            rooms = JSON.parse(window.sessionStorage.getItem(this._storeKey()) || '[]');
        } catch (err) {
            return;
        }
        if (!Array.isArray(rooms) || rooms.length === 0 || !this._ensureRelay()) { return; }
        for (const room of rooms.slice(0, MAX_SECONDARY_WINDOWS)) {
            if (!room || !isRelayToken(room.token) || !isRelayToken(room.ownerKey) ||
                typeof room.windowId !== 'string' || room.windowId.length > 64) {
                continue;
            }
            this._tokens.set(room.token, room.windowId);
            this._keys.set(room.token, room.ownerKey);
            if (!this._windows.has(room.windowId)) {
                this._windows.set(room.windowId, { closed: true, restored: true, postMessage() {} });
            }
            this._resuming = this._resuming || new Set();
            this._resuming.add(room.token);
            this._relay.port.postMessage({ type: 'resume', token: room.token, ownerKey: room.ownerKey });
        }
        const grace = Math.max(RELAY_RESUME_RETRIES * RELAY_RESUME_RETRY_MS,
                               RELINK_MAX_ATTEMPTS * RELINK_INTERVAL_MS) + RELAY_REOPEN_GRACE_MS;
        for (const windowId of new Set(this._tokens.values())) {
            this.scheduleRelease(windowId, grace);
        }
    }

    suspend() {
        if (this._relay) { this._relay.port.postMessage({ type: 'suspend' }); }
    }

    onConnected() {
        this._flushPending();
    }

    handleHello(event) {
        if (event.data.type !== 'kasm_hello') { return; }
        const windowId = event.data.windowId;
        let win = this._windows.get(windowId);
        if ((!win || win.restored) && this._openedByThisWindow(event.source, windowId)) {
            win = event.source;
            this._windows.set(windowId, win);
        }
        if (!win || win.closed || event.source !== win) {
            Log.Warn("Ignoring secondary display handshake from an unknown window.");
            return;
        }
        if (!this._host.isConnected()) {
            this._pendingHellos = this._pendingHellos || new Map();
            this._pendingHellos.set(windowId, win);
            return;
        }
        this._linkOrProbe(windowId, win);
    }

    answerProbe(link) {
        if (link.probe) {
            clearTimeout(link.probe);
            link.probe = null;
            Log.Warn("Refused a second claim for the live secondary display " + link.windowId + ".");
        }
    }

    confirmRegistered(link) {
        clearTimeout(link.registerTimer);
        link.registerTimer = null;
    }

    rotateToken(link) {
        if (!link.token || !this._relay || !this._tokens.has(link.token)) { return; }
        this._abandonPendingToken(link);
        const next = newRelaySecret();
        const ownerKey = newRelaySecret();
        this._tokens.set(next, link.windowId);
        this._keys.set(next, ownerKey);
        this._relay.port.postMessage({ type: 'register', token: next, ownerKey, replaces: link.token });
        link.pendingToken = next;
        this._saveRooms();
    }

    finishRotation(link, token) {
        if (!link.pendingToken || token !== link.pendingToken) { return; }
        const old = link.token;
        link.token = token;
        link.pendingToken = null;
        this._tokens.delete(old);
        this._keys.delete(old);
        if (this._relay) {
            this._relay.port.postMessage({ type: 'unregister', token: old });
        }
        this._saveRooms();
    }

    scheduleRelease(windowId, graceMs = RELAY_REOPEN_GRACE_MS) {
        if (!this._relay || ![...this._tokens.values()].includes(windowId)) { return; }
        clearTimeout(this._grace.get(windowId));
        this._grace.set(windowId, setTimeout(() => {
            this._grace.delete(windowId);
            this.releaseToken(windowId);
            this._windows.delete(windowId);
        }, graceMs));
    }

    drop(link) {
        clearTimeout(link.probe);
        link.probe = null;
        this.confirmRegistered(link);
        this._abandonPendingToken(link);
        link.port.close();
        link.channel.close();
        link.encodedFramePort.close();
        if (this._links.get(link.windowId) === link) {
            this._links.delete(link.windowId);
        }
    }

    close() {
        for (const link of [...this._links.values()]) {
            this.drop(link);
        }
        for (const timer of this._grace.values()) {
            clearTimeout(timer);
        }
        this._grace.clear();
        this._windows.clear();
        clearInterval(this._relayPing);
        this._relayPing = null;
        this._closeRelay();
    }

    handleRelayMessage(event) {
        const data = event.data;
        if (!data || typeof data.token !== 'string') { return; }
        const windowId = this._tokens.get(data.token);
        if (!windowId) { return; }

        switch (data.type) {
            case 'registered': {
                if (this._resumeTries) { this._resumeTries.delete(data.token); }
                if (this._resuming) { this._resuming.delete(data.token); }
                const link = this._links.get(windowId);
                if (link && link.pendingToken === data.token) {
                    link.port.postMessage({ eventType: 'relayRotate', screenID: link.screenID, token: data.token });
                }
                break;
            }
            case 'claimed':
                this._onClaimed(windowId, data);
                break;
            case 'rejected': {
                if (data.reason === 'busy') {
                    this._retryResume(data.token);
                    break;
                }
                if (data.reason === 'unknown' && this._resuming && this._resuming.delete(data.token) &&
                    this._relay && this._keys.has(data.token)) {
                    Log.Info("Secondary display relay lost the room for window " + windowId + ", registering it again.");
                    this._relay.port.postMessage({ type: 'register', token: data.token, ownerKey: this._keys.get(data.token) });
                    break;
                }
                if (data.reason === 'stale') {
                    const stale = this._links.get(windowId);
                    if (stale && stale.token === data.token && stale.claim === data.claim && stale.screenID === null) {
                        this.drop(stale);
                    }
                    break;
                }
                const link = this._links.get(windowId);
                if (link && link.pendingToken === data.token) {
                    Log.Info("Secondary display relay could not rotate the token for window " + windowId + " (" + data.reason + ").");
                    this._forgetToken(data.token);
                    break;
                }
                if (data.reason === 'unknown') {
                    Log.Info("Secondary display relay no longer has a room for window " + windowId + ".");
                } else {
                    Log.Warn("Secondary display relay refused a window (" + data.reason + "), it cannot attach.");
                }
                this._forgetToken(data.token);
                break;
            }
            case 'expired':
                Log.Warn("Secondary display relay token expired for window " + windowId + ".");
                this._forgetToken(data.token);
                break;
        }
    }

    _ensureRelay() {
        if (this._relay) { return true; }
        try {
            this._relay = createRelayWorker();
            this._relay.port.onmessage = e => this.handleRelayMessage(e);
            this._relay.port.start();
            this._relayPing = setInterval(() => this._relay.port.postMessage({ type: 'ping' }), RELAY_PING_MS);
            return true;
        } catch (err) {
            Log.Warn("Could not start the secondary display relay: " + err);
            this._relay = null;
            return false;
        }
    }

    _registerToken(windowId) {
        const token = newRelaySecret();
        const ownerKey = newRelaySecret();
        this._tokens.set(token, windowId);
        this._keys.set(token, ownerKey);
        this._relay.port.postMessage({ type: 'register', token, ownerKey });
        this._saveRooms();
        return token;
    }

    _storeKey() {
        return RELAY_STORE_KEY + window.location.pathname;
    }

    _saveRooms() {
        try {
            const rooms = [];
            for (const [token, windowId] of this._tokens) {
                const ownerKey = this._keys.get(token);
                if (ownerKey) { rooms.push({ token, windowId, ownerKey }); }
            }
            if (rooms.length) {
                window.sessionStorage.setItem(this._storeKey(), JSON.stringify(rooms));
            } else {
                window.sessionStorage.removeItem(this._storeKey());
            }
        } catch (err) {
            Log.Debug("Could not save the secondary display rooms: " + err);
        }
    }

    _abandonPendingToken(link) {
        const pending = link.pendingToken;
        if (!pending) { return; }
        link.pendingToken = null;
        this._tokens.delete(pending);
        this._keys.delete(pending);
        if (this._relay) {
            this._relay.port.postMessage({ type: 'unregister', token: pending });
        }
        this._saveRooms();
    }

    _flushPending() {
        if (this._pendingHellos && this._pendingHellos.size > 0) {
            const hellos = [...this._pendingHellos];
            this._pendingHellos.clear();
            for (const [windowId, win] of hellos) {
                if (!win.closed && this._windows.get(windowId) === win) {
                    this._linkOrProbe(windowId, win);
                }
            }
        }
        if (this._pendingClaims && this._pendingClaims.size > 0) {
            const claims = [...this._pendingClaims.values()];
            this._pendingClaims.clear();
            for (const data of claims) {
                const windowId = this._tokens.get(data.token);
                if (windowId) { this._onClaimed(windowId, data); }
            }
        }
    }

    _onClaimed(windowId, data) {
        if (!this._windows.has(windowId)) { return; }
        if (!this._host.isConnected()) {
            this._pendingClaims = this._pendingClaims || new Map();
            this._pendingClaims.set(data.token, data);
            return;
        }
        this._linkOrProbe(windowId, this._windows.get(windowId), data.token, data.claim);
    }

    _retryResume(token) {
        this._resumeTries = this._resumeTries || new Map();
        const tries = (this._resumeTries.get(token) || 0) + 1;
        this._resumeTries.set(token, tries);
        if (tries > RELAY_RESUME_RETRIES) {
            this._resumeTries.delete(token);
            this._forgetToken(token);
            return;
        }
        this._resumeTimers = this._resumeTimers || new Set();
        const timer = setTimeout(() => {
            this._resumeTimers.delete(timer);
            const ownerKey = this._keys.get(token);
            if (this._relay && ownerKey) {
                this._resuming = this._resuming || new Set();
                this._resuming.add(token);
                this._relay.port.postMessage({ type: 'resume', token, ownerKey });
            }
        }, RELAY_RESUME_RETRY_MS);
        this._resumeTimers.add(timer);
    }

    _forgetToken(token) {
        const windowId = this._tokens.get(token);
        const link = this._links.get(windowId);
        if (link && link.pendingToken === token) {
            link.pendingToken = null;
        }
        this._tokens.delete(token);
        this._keys.delete(token);
        this._saveRooms();
        if (windowId && ![...this._tokens.values()].includes(windowId) &&
            !this._links.has(windowId)) {
            this._windows.delete(windowId);
        }
    }

    _openedByThisWindow(source, windowId) {
        if (typeof windowId !== 'string' || !/^[0-9a-f-]{8,64}$/i.test(windowId) ||
            (this._windows.size >= MAX_SECONDARY_WINDOWS && !this._windows.has(windowId))) {
            return false;
        }
        try {
            return !!source && source !== window && source.opener === window &&
                /\/screen\.html$/.test(source.location.pathname);
        } catch (err) {
            return false;
        }
    }

    _linkOrProbe(windowId, win, token, claim) {
        const old = this._links.get(windowId);
        if (!old) {
            this._link(windowId, win, token, claim);
            return;
        }
        if (old.probe) { return; }
        old.probe = setTimeout(() => {
            old.probe = null;
            if (this._links.get(windowId) === old) {
                this._link(windowId, win, token, claim);
            }
        }, RELAY_PROBE_MS);
        old.port.postMessage({ eventType: 'relayProbe', screenID: old.screenID });
    }

    _link(windowId, win, token, claim) {
        clearTimeout(this._grace.get(windowId));
        this._grace.delete(windowId);
        const old = this._links.get(windowId);
        if (old) {
            this._host.removeLinkedScreen(old);
            this.drop(old);
        }
        const control = new MessageChannel();
        const rects = new MessageChannel();
        const frames = new MessageChannel();
        const link = {
            windowId: windowId,
            screenID: null,
            token: token || null,
            claim: claim,
            pendingToken: null,
            port: control.port1,
            channel: rects.port1,
            encodedFramePort: frames.port1,
        };
        link.port.onmessage = e => this._host.handleControlMessage(e, link);
        this._links.set(windowId, link);
        link.registerTimer = setTimeout(() => {
            link.registerTimer = null;
            if (this._links.get(windowId) === link && link.screenID === null) {
                link.port.postMessage({ eventType: 'secondarydisconnected' });
                this.drop(link);
                this.scheduleRelease(windowId);
            }
        }, RELAY_LINK_WAIT_MS);
        if (token) {
            this._relay.port.postMessage({ type: 'offer', token, claim },
                                         [control.port2, rects.port2, frames.port2]);
        } else {
            this.releaseToken(windowId);
            win.postMessage({ type: 'kasm_ports' }, window.location.origin,
                            [control.port2, rects.port2, frames.port2]);
        }
    }

    _closeRelay() {
        this._pendingClaims = null;
        this._pendingHellos = null;
        this._resuming = null;
        if (this._resumeTimers) {
            for (const timer of this._resumeTimers) { clearTimeout(timer); }
            this._resumeTimers.clear();
        }
        this._resumeTries = null;
        if (this._relay) {
            if (this._leaving || !this._deliberate) {
                this._tokens.clear();
                this._keys.clear();
                this._relay.port.postMessage({ type: 'suspend' });
            } else {
                for (const token of this._tokens.keys()) {
                    this._relay.port.postMessage({ type: 'unregister', token });
                }
                this._tokens.clear();
                this._keys.clear();
                this._saveRooms();
            }
            this._relay.port.close();
            this._relay = null;
        }
    }
}
