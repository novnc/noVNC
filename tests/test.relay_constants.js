const expect = chai.expect;

import * as c from '../core/secondary/constants.js';

describe('Relay timing constants', function () {
    it('pings the worker well inside the quiet period before a resume can be refused', function () {
        expect(c.RELAY_PING_MS * 2).to.be.below(c.RELAY_RESUME_QUIET_MS);
    });

    it('treats a primary as stale only after it has been quiet for a resume', function () {
        expect(c.RELAY_RESUME_QUIET_MS).to.be.below(c.RELAY_STALE_MS);
    });

    it('stops waiting for a claim before the worker forgets it', function () {
        expect(c.RELAY_CLAIM_WAIT_MS).to.be.below(c.RELAY_CLAIM_TTL_MS);
    });

    it('keeps a room alive for the whole re-open grace period', function () {
        expect(c.RELAY_REOPEN_GRACE_MS).to.be.below(c.RELAY_ROOM_TTL_MS);
    });
});
