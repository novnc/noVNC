/* jshint expr: true */

import WakeLockManager from '../app/wakelock.js';

class FakeWakeLockSentinal extends EventTarget {
    constructor() {
        super();
        this.released = false;
    }

    async release() {
        if (this.released) {
            return;
        }
        this.released = true;
        this.dispatchEvent(new Event("release"));
    }
}

function waitForStateTransition(wakelockManager, newState) {
    const {promise, resolve} = Promise.withResolvers();

    const eventListener = (event) => {
        if (event.newState !== newState) {
            return;
        }
        wakelockManager.removeEventListener("testOnlyStateChange", eventListener);
        resolve();
    };
    wakelockManager.addEventListener("testOnlyStateChange", eventListener);

    return promise;
}

describe('WakeLockManager', function () {
    "use strict";

    let wakelockRequest;
    beforeEach(function () {
        wakelockRequest = sinon.stub(navigator.wakeLock, 'request');
    });
    afterEach(function () {
        wakelockRequest.restore();
    });

    it('can acquire and release lock', async function () {
        let wakeLockSentinal = new FakeWakeLockSentinal();
        wakelockRequest.onFirstCall().resolves(wakeLockSentinal);

        let wlm = new WakeLockManager();
        expect(wakelockRequest).to.not.have.been.called;

        let done = waitForStateTransition(wlm, 'acquired');
        wlm.acquire();
        await done;
        expect(wakelockRequest).to.have.been.calledOnce;
        expect(wakeLockSentinal.released).to.be.false;

        done = waitForStateTransition(wlm, 'released');
        wlm.release();
        await done;
        expect(wakelockRequest).to.have.been.calledOnce;
        expect(wakeLockSentinal.released).to.be.true;
    });

    it('can release without holding wakelock', async function () {
        let wlm = new WakeLockManager();
        wlm.release();
        expect(wakelockRequest).to.not.have.been.called;
    });

    it('can release while waiting for wakelock', async function () {
        let wakeLockSentinal = new FakeWakeLockSentinal();
        let {promise, resolve} = Promise.withResolvers();

        wakelockRequest.onFirstCall().returns(promise);

        let wlm = new WakeLockManager();
        expect(wakelockRequest).to.not.have.been.called;

        let seenAcquiring = waitForStateTransition(wlm, 'acquiring');
        let seenReleasing = waitForStateTransition(wlm, 'releasing');
        let seenReleased = waitForStateTransition(wlm, 'released');

        wlm.acquire();
        await seenAcquiring;
        expect(wakelockRequest).to.have.been.calledOnce;

        // We can call acquire multiple times, while waiting for the promise
        // to resolve.
        wlm.acquire();
        // It should not request a second wakelock.
        expect(wakelockRequest).to.have.been.calledOnce;

        wlm.release();
        await seenReleasing;

        expect(wakeLockSentinal.released).to.be.false;

        // Now return the wake lock, we should immediately release it.
        resolve(wakeLockSentinal);
        await seenReleased;
        expect(wakeLockSentinal.released).to.be.true;
    });

    it('handles visibility loss', async function () {
        let documentHidden = sinon.stub(document, 'hidden');
        let documentVisibility = sinon.stub(document, 'visibilityState');
        afterEach(function () {
            documentHidden.restore();
            documentVisibility.restore();
        });
        documentHidden.value(false);
        documentVisibility.value('visible');

        let wakeLockSentinal1 = new FakeWakeLockSentinal();
        let wakeLockSentinal2 = new FakeWakeLockSentinal();
        wakelockRequest.onFirstCall().resolves(wakeLockSentinal1);
        wakelockRequest.onSecondCall().resolves(wakeLockSentinal2);

        let wlm = new WakeLockManager();
        let seenAcquired = waitForStateTransition(wlm, 'acquired');
        let seenAwaitingVisible = waitForStateTransition(wlm, 'awaiting_visible');

        wlm.acquire();
        await seenAcquired;
        expect(wakelockRequest).to.have.been.calledOnce;

        // Fake a visibility change.
        documentHidden.value(true);
        documentVisibility.value('hidden');
        wakeLockSentinal1.release();

        await seenAwaitingVisible;
        seenAcquired = waitForStateTransition(wlm, 'acquired');

        // Fake a visibility change back
        documentHidden.value(false);
        documentVisibility.value('visible');
        document.dispatchEvent(new Event('visibilitychange'));
        await seenAcquired;

        expect(wakelockRequest).to.have.been.calledTwice;
        expect(wakeLockSentinal2.released).to.be.false;
    });

    it('can start hidden', async function () {
        let documentHidden = sinon.stub(document, 'hidden');
        let documentVisibility = sinon.stub(document, 'visibilityState');
        afterEach(function () {
            documentHidden.restore();
            documentVisibility.restore();
        });
        documentHidden.value(true);
        documentVisibility.value('hidden');

        let wakeLockSentinal = new FakeWakeLockSentinal();
        wakelockRequest.onFirstCall().resolves(wakeLockSentinal);

        let wlm = new WakeLockManager();
        let seenAwaitingVisible = waitForStateTransition(wlm, 'awaiting_visible');
        let seenAcquired = waitForStateTransition(wlm, 'acquired');

        wlm.acquire();
        await seenAwaitingVisible;
        expect(wakelockRequest).to.not.have.been.called;

        // Fake a visibility change.
        documentHidden.value(false);
        documentVisibility.value('visible');
        document.dispatchEvent(new Event('visibilitychange'));
        await seenAcquired;

        expect(wakelockRequest).to.have.been.calledOnce;
        expect(wakeLockSentinal.released).to.be.false;
    });

    it('handles acquire errors', async function () {
        wakelockRequest.onFirstCall().rejects('WakeLockError');
        let wakeLockSentinal = new FakeWakeLockSentinal();
        wakelockRequest.onSecondCall().resolves(wakeLockSentinal);

        let wlm = new WakeLockManager();

        let seenError = waitForStateTransition(wlm, 'error');
        wlm.acquire();
        await seenError;
        expect(wakelockRequest).to.have.been.calledOnce;

        // Even though we saw an error previously, it will retry when
        // requested.
        let seenAcquired = waitForStateTransition(wlm, 'acquired');
        wlm.acquire();
        await seenAcquired;
        expect(wakelockRequest).to.have.been.calledTwice;
    });
});
