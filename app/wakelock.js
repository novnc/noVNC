/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2025 The noVNC authors
 * Licensed under MPL 2.0 or any later version (see LICENSE.txt)
 *
 * Wrapper around the `navigator.wakeLock` api that handles reacquiring the
 * lock on visiblility changes.
 *
 * The `acquire` and `release` methods may be called any number of times. The
 * most recent call dictates the desired end-state (if `acquire` was most
 * recently called, then we will try to acquire and hold the wake lock).
 */

import * as Log from '../core/util/logging.js';

const _STATES = {
    /* No wake lock.
     *
     * Can transition to:
     *  - AWAITING_VISIBLE: `acquire` called when document is hidden.
     *  - ACQUIRING: `acquire` called.
     *  - ERROR: `acquired` called when the api is not available.
     */
    RELEASED: 'released',
    /* Wake lock requested, waiting for browser.
     *
     * Can transition to:
     *  - ACQUIRED: success
     *  - ACQUIRING_WANT_RELEASE: `release` called while waiting
     *  - ERROR
     */
    ACQUIRING: 'acquiring',
    /* Wake lock requested, release called, still waiting for browser.
     *
     * Can transition to:
     *  - ACQUIRING: `acquire` called (but promise has not resolved yet)
     *  - RELEASED: success
     */
    ACQUIRING_WANT_RELEASE: 'releasing',
    /* Wake lock held.
     *
     * Can transition to:
     *  - AWAITING_VISIBLE: wakelock lost due to visibility change
     *  - RELEASED: success
     */
    ACQUIRED: 'acquired',
    /* Caller wants wakelock, but we can not get it due to visibility.
     *
     * Can transition to:
     *  - ACQUIRING: document is now visible, attempting to get wakelock.
     *  - RELEASED: when release is called.
     */
    AWAITING_VISIBLE: 'awaiting_visible',
    /* An error has occurred.
     *
     * Can transition to:
     *  - RELEASED: will happen immediately.
     */
    ERROR: 'error',
};

export default class WakeLockManager {
    constructor() {
        this._state = _STATES.RELEASED;
        this._wakelock = null;

        this._eventHandlers = {
            wakelockAcquired: this._wakelockAcquired.bind(this),
            wakelockReleased: this._wakelockReleased.bind(this),
            documentVisibilityChange: this._documentVisibilityChange.bind(this),
        };
    }

    acquire() {
        switch (this._state) {
            case _STATES.ACQUIRING_WANT_RELEASE:
                // We are currently waiting to acquire the wakelock. While
                // waiting, `release()` was called. By transitioning back to
                // ACQUIRING, we will keep the lock after we receive it.
                this._transitionTo(_STATES.ACQUIRING);
                break;
            case _STATES.AWAITING_VISIBLE:
            case _STATES.ACQUIRING:
            case _STATES.ACQUIRED:
                break;
            case _STATES.ERROR:
            case _STATES.RELEASED:
                if (document.hidden) {
                    // We can not acquire the wakelock while the document is
                    // hidden (eg, not the active tab). Wait until it is
                    // visible, then acquire the wakelock.
                    this._awaitVisible();
                    break;
                }
                this._acquireWakelockNow();
                break;
        }
    }

    release() {
        switch (this._state) {
            case _STATES.ERROR:
            case _STATES.RELEASED:
            case _STATES.ACQUIRING_WANT_RELEASE:
                break;
            case _STATES.ACQUIRING:
                // We are have requested (but not yet received) the wakelock.
                // Give it up as soon as we acquire it.
                this._transitionTo(_STATES.ACQUIRING_WANT_RELEASE);
                break;
            case _STATES.ACQUIRED:
                // We remove the event listener first, as we don't want to be
                // notified about this release (it is expected).
                this._wakelock.removeEventListener("release", this._eventHandlers.wakelockReleased);
                this._wakelock.release();
                this._wakelock = null;
                this._transitionTo(_STATES.RELEASED);
                break;
            case _STATES.AWAITING_VISIBLE:
                // We don't currently have the lock, but are waiting for the
                // document to become visible. By removing the event listener,
                // we will not attempt to get the wakelock in the future.
                document.removeEventListener("visibilitychange", this._eventHandlers.documentVisibilityChange);
                this._transitionTo(_STATES.RELEASED);
                break;
        }
    }

    _transitionTo(newState) {
        let oldState = this._state;
        Log.Debug(`WakelockManager transitioning ${oldState} -> ${newState}`);
        this._state = newState;
    }

    _awaitVisible() {
        document.addEventListener("visibilitychange", this._eventHandlers.documentVisibilityChange);
        this._transitionTo(_STATES.AWAITING_VISIBLE);
    }

    _acquireWakelockNow() {
        if (!("wakeLock" in navigator)) {
            Log.Warn("Unable to request wakeLock, Browser does not have wakeLock api");
            this._transitionTo(_STATES.ERROR);
            this._transitionTo(_STATES.RELEASED);
            return;
        }
        navigator.wakeLock.request("screen")
            .then(this._eventHandlers.wakelockAcquired)
            .catch((err) => {
                Log.Warn("Error occurred while acquiring wakelock: " + err);
                this._transitionTo(_STATES.ERROR);
                this._transitionTo(_STATES.RELEASED);
            });
        this._transitionTo(_STATES.ACQUIRING);
    }


    _wakelockAcquired(wakelock) {
        if (this._state === _STATES.ACQUIRING_WANT_RELEASE) {
            // We were requested to release the wakelock while we were trying to
            // acquire it. Now that we have acquired it, immediately release it.
            wakelock.release();
            this._transitionTo(_STATES.RELEASED);
            return;
        }
        this._wakelock = wakelock;
        this._wakelock.addEventListener("release", this._eventHandlers.wakelockReleased);
        this._transitionTo(_STATES.ACQUIRED);
    }

    _wakelockReleased(event) {
        this._wakelock = null;
        if (document.visibilityState === "visible") {
            Log.Warn("Lost wakelock, but document is still visible. Not reacquiring");
            this._transitionTo(_STATES.RELEASED);
            return;
        }
        this._awaitVisible();
    }

    _documentVisibilityChange(event) {
        if (document.visibilityState !== "visible") {
            return;
        }
        document.removeEventListener("visibilitychange", this._eventHandlers.documentVisibilityChange);
        this._acquireWakelockNow();
    }
}
