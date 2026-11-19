import { isRelayToken } from '../core/secondary/token.js';
import {
    RELAY_ROOM_TTL_MS as ROOM_TTL_MS,
    RELAY_CLAIM_TTL_MS as CLAIM_TTL_MS,
    RELAY_STALE_MS as STALE_MS,
    RELAY_RESUME_QUIET_MS as RESUME_QUIET_MS,
} from '../core/secondary/constants.js';

const DORMANT_TTL_MS = 3600000;
const SWEEP_MS = 30000;
const MAX_ROOMS = 64;
const MAX_ROOMS_PER_PORT = 16;

const rooms = new Map();
const lastSeen = new WeakMap();
let sweeper = null;

function dropRoom(token) {
    const room = rooms.get(token);
    if (room) {
        clearTimeout(room.timer);
        clearTimeout(room.claimTimer);
        rooms.delete(token);
    }
    if (rooms.size === 0 && sweeper !== null) {
        clearInterval(sweeper);
        sweeper = null;
    }
}

function expireRoom(token) {
    const room = rooms.get(token);
    if (!room) { return; }
    dropRoom(token);
    room.primary.postMessage({ type: 'expired', token });
}

function startTimer(token, room, ms) {
    clearTimeout(room.timer);
    room.timer = setTimeout(() => expireRoom(token), ms);
}

function sweep() {
    const now = Date.now();
    for (const [token, room] of [...rooms]) {
        if (room.dormant) {
            if (now - room.dormantSince > DORMANT_TTL_MS) {
                expireRoom(token);
            }
        } else if (now - (lastSeen.get(room.primary) || 0) > STALE_MS) {
            if (room.linked) {
                room.dormant = true;
                room.dormantSince = now;
            } else {
                expireRoom(token);
            }
        }
    }
}

function evictDormant() {
    while (rooms.size >= MAX_ROOMS) {
        let oldest = null;
        for (const [token, room] of rooms) {
            if (room.dormant && (oldest === null || room.dormantSince < oldest.room.dormantSince)) {
                oldest = { token, room };
            }
        }
        if (oldest === null) { return; }
        expireRoom(oldest.token);
    }
}

function noSlotFor(port) {
    if (roomsOwnedBy(port) >= MAX_ROOMS_PER_PORT) { return true; }
    evictDormant();
    return rooms.size >= MAX_ROOMS;
}

function roomsOwnedBy(port) {
    let n = 0;
    for (const room of rooms.values()) {
        if (room.primary === port) { n++; }
    }
    return n;
}

self.onconnect = function onConnect(e) {
    const port = e.ports[0];

    port.onmessage = function onMessage(ev) {
        const data = ev.data;
        if (!data || typeof data !== 'object') {
            return;
        }
        lastSeen.set(port, Date.now());
        for (const owned of rooms.values()) {
            if (owned.primary === port) { owned.dormant = false; }
        }
        if (data.type === 'ping' || data.type === 'suspend') {
            for (const room of rooms.values()) {
                if (room.primary === port) { room.suspended = data.type === 'suspend'; }
            }
            return;
        }
        if (!isRelayToken(data.token)) {
            return;
        }
        const token = data.token;
        const room = rooms.get(token);

        switch (data.type) {
            case 'register':
                if (!isRelayToken(data.ownerKey)) {
                    port.postMessage({ type: 'rejected', token, reason: 'invalid' });
                } else if (room) {
                    port.postMessage({ type: 'rejected', token, reason: 'duplicate' });
                } else if (noSlotFor(port)) {
                    port.postMessage({ type: 'rejected', token, reason: 'limit' });
                } else {
                    const replaced = typeof data.replaces === 'string' ? rooms.get(data.replaces) : null;
                    const linked = !!(replaced && replaced.primary === port && replaced.linked);
                    const fresh = { primary: port, ownerKey: data.ownerKey, claimer: null, claimed: new WeakSet(),
                                    linked, dormant: false, dormantSince: 0, suspended: false, claimerExpired: false, claimSeq: 0,
                                    timer: null, claimTimer: null };
                    rooms.set(token, fresh);
                    if (!linked) {
                        startTimer(token, fresh, ROOM_TTL_MS);
                    }
                    if (sweeper === null) {
                        sweeper = setInterval(sweep, SWEEP_MS);
                    }
                    port.postMessage({ type: 'registered', token });
                }
                break;
            case 'resume':
                if (room && typeof data.ownerKey === 'string' && data.ownerKey === room.ownerKey) {
                    const quiet = Date.now() - (lastSeen.get(room.primary) || 0) > RESUME_QUIET_MS;
                    if (room.suspended || quiet || room.primary === port) {
                        room.primary = port;
                        room.suspended = false;
                        room.dormant = false;
                        if (!room.linked) {
                            startTimer(token, room, ROOM_TTL_MS);
                        }
                        port.postMessage({ type: 'registered', token });
                        if (room.claimer && !room.claimerExpired) {
                            port.postMessage({ type: 'claimed', token, claim: room.claimSeq });
                        }
                    } else {
                        port.postMessage({ type: 'rejected', token, reason: 'busy' });
                    }
                } else {
                    port.postMessage({ type: 'rejected', token, reason: 'unknown' });
                }
                break;
            case 'claim':
                if (!room || room.primary === port) {
                    port.postMessage({ type: 'rejected', token, reason: 'unknown' });
                } else if ((room.claimer && !room.claimerExpired) || (!room.claimer && room.claimed.has(port))) {
                    port.postMessage({ type: 'rejected', token, reason: 'busy' });
                } else {
                    room.claimer = port;
                    room.claimSeq++;
                    room.claimerExpired = false;
                    room.claimed.add(port);
                    clearTimeout(room.claimTimer);
                    room.claimTimer = setTimeout(() => {
                        if (room.claimer === port) { room.claimerExpired = true; }
                    }, CLAIM_TTL_MS);
                    room.primary.postMessage({ type: 'claimed', token, claim: room.claimSeq });
                }
                break;
            case 'offer':
                if (room && room.primary === port && (!room.claimer ||
                    ev.ports.length !== 3 || (data.claim !== undefined && data.claim !== room.claimSeq))) {
                    port.postMessage({ type: 'rejected', token, reason: 'stale', claim: Number.isInteger(data.claim) ? data.claim : undefined });
                } else if (room && room.primary === port) {
                    room.claimer.postMessage({ type: 'kasm_ports' }, [...ev.ports]);
                    room.claimer = null;
                    clearTimeout(room.claimTimer);
                    room.linked = true;
                    clearTimeout(room.timer);
                    room.timer = null;
                }
                break;
            case 'unregister':
                if (room && room.primary === port) {
                    dropRoom(token);
                }
                break;
        }
    };
    port.start();
};
