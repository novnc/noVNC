const expect = chai.expect;

import '../app/port-relay-worker.js';
import { isRelayToken } from '../core/secondary/token.js';

describe('Port relay worker', function () {
    let clock, seq = 0;

    const KEY = 'c'.repeat(32);
    const PER_PORT = 16;
    const token = () => (++seq).toString(16).padStart(32, '0');
    const connect = () => {
        const port = { postMessage: sinon.spy(), start: sinon.spy(), onmessage: null };
        self.onconnect({ ports: [port] });
        return port;
    };
    const send = (port, data, ports = []) => port.onmessage({ data, ports });
    const last = port => port.postMessage.lastCall && port.postMessage.lastCall.args[0];

    beforeEach(function () { clock = sinon.useFakeTimers(); });
    afterEach(function () { clock.tick(4000000); clock.restore(); });

    it('confirms a registration and refuses a duplicate', function () {
        const primary = connect(), t = token();
        send(primary, { type: 'register', token: t, ownerKey: KEY });
        expect(last(primary)).to.deep.equal({ type: 'registered', token: t });
        send(primary, { type: 'register', token: t, ownerKey: KEY });
        expect(last(primary)).to.deep.equal({ type: 'rejected', token: t, reason: 'duplicate' });
    });

    it('tells the primary when its per port limit is reached', function () {
        const primary = connect();
        for (let i = 0; i < PER_PORT; i++) {
            const t = token();
            send(primary, { type: 'register', token: t, ownerKey: KEY });
            expect(last(primary).type).to.equal('registered');
        }
        const t = token();
        send(primary, { type: 'register', token: t, ownerKey: KEY });
        expect(last(primary)).to.deep.equal({ type: 'rejected', token: t, reason: 'limit' });
    });

    it('accepts exactly the tokens the page side accepts', function () {
        const samples = [
            'a'.repeat(32), '0123456789abcdef0123456789abcdef', 'A'.repeat(32), 'a'.repeat(31), 'a'.repeat(33),
            'g'.repeat(32), '', 'a'.repeat(31) + ' ', 'a'.repeat(32) + '\n', 5, null,
        ];
        for (const value of samples) {
            const primary = connect();
            send(primary, { type: 'register', token: value, ownerKey: KEY });
            if (isRelayToken(value)) {
                expect(last(primary), String(value)).to.deep.equal({ type: 'registered', token: value });
                send(primary, { type: 'unregister', token: value });
            } else {
                expect(primary.postMessage.called, String(value)).to.be.false;
            }
            const keyed = connect(), t = token();
            send(keyed, { type: 'register', token: t, ownerKey: value });
            if (isRelayToken(value)) {
                expect(last(keyed).type).to.equal('registered');
            } else {
                expect(last(keyed)).to.deep.equal({ type: 'rejected', token: t, reason: 'invalid' });
            }
        }
    });

    it('ignores malformed messages', function () {
        const primary = connect();
        send(primary, { type: 'register', token: 'not-a-token', ownerKey: KEY });
        send(primary, null);
        expect(primary.postMessage).to.not.have.been.called;
    });

    it('tells a claimant when the token is unknown or its own', function () {
        const primary = connect(), popup = connect(), t = token();
        send(popup, { type: 'claim', token: t });
        expect(last(popup)).to.deep.equal({ type: 'rejected', token: t, reason: 'unknown' });
        send(primary, { type: 'register', token: t, ownerKey: KEY });
        send(primary, { type: 'claim', token: t });
        expect(last(primary)).to.deep.equal({ type: 'rejected', token: t, reason: 'unknown' });
    });

    it('hands the ports to the first claimant only', function () {
        const primary = connect(), first = connect(), second = connect(), t = token();
        send(primary, { type: 'register', token: t, ownerKey: KEY });
        send(first, { type: 'claim', token: t });
        expect(last(primary)).to.include({ type: 'claimed', token: t });
        send(second, { type: 'claim', token: t });
        expect(last(second)).to.deep.equal({ type: 'rejected', token: t, reason: 'busy' });

        const ports = [{}, {}, {}];
        send(second, { type: 'offer', token: t }, ports);
        expect(first.postMessage.called).to.be.false;
        send(primary, { type: 'offer', token: t }, ports);
        expect(first.postMessage).to.have.been.calledOnce;
        expect(first.postMessage.firstCall.args[0]).to.deep.equal({ type: 'kasm_ports' });
        expect(first.postMessage.firstCall.args[1]).to.have.lengthOf(3);
    });

    it('lets a reloaded window claim again but not the same port twice', function () {
        const primary = connect(), first = connect(), reloaded = connect(), t = token();
        send(primary, { type: 'register', token: t, ownerKey: KEY });
        send(first, { type: 'claim', token: t });
        send(primary, { type: 'offer', token: t }, [{}, {}, {}]);

        send(first, { type: 'claim', token: t });
        expect(last(first)).to.deep.equal({ type: 'rejected', token: t, reason: 'busy' });

        send(reloaded, { type: 'claim', token: t });
        expect(last(primary)).to.include({ type: 'claimed', token: t });
        send(primary, { type: 'offer', token: t }, [{}, {}, {}]);
        expect(reloaded.postMessage).to.have.been.calledOnce;
        expect(reloaded.postMessage.firstCall.args[0]).to.deep.equal({ type: 'kasm_ports' });
    });

    it('tells the primary when nobody claims in time', function () {
        const primary = connect(), popup = connect(), t = token();
        send(primary, { type: 'register', token: t, ownerKey: KEY });
        clock.tick(120001);
        expect(last(primary)).to.deep.equal({ type: 'expired', token: t });
        send(popup, { type: 'claim', token: t });
        expect(last(popup).reason).to.equal('unknown');
    });

    const linkedRoom = (primary) => {
        const t = token();
        send(primary, { type: 'register', token: t, ownerKey: KEY });
        send(connect(), { type: 'claim', token: t });
        send(primary, { type: 'offer', token: t }, [{}, {}, {}]);
        return t;
    };
    const expired = (port, t) => port.postMessage.getCalls().some(c => c.args[0].type === 'expired' && c.args[0].token === t);

    const keepAlive = (port, ms) => {
        for (let spent = 0; spent < ms; spent += 20000) {
            clock.tick(20000);
            send(port, { type: 'ping' });
        }
    };

    it('keeps a linked room past the unclaimed lifetime until it is unregistered', function () {
        const primary = connect(), popup = connect(), later = connect(), t = token();
        send(primary, { type: 'register', token: t, ownerKey: KEY });
        send(popup, { type: 'claim', token: t });
        send(primary, { type: 'offer', token: t }, [{}, {}, {}]);
        keepAlive(primary, 4000000);
        send(later, { type: 'claim', token: t });
        expect(last(primary)).to.include({ type: 'claimed', token: t });

        send(connect(), { type: 'unregister', token: t });
        send(primary, { type: 'unregister', token: t });
        const gone = connect();
        send(gone, { type: 'claim', token: t });
        expect(last(gone).reason).to.equal('unknown');
    });

    it('frees a room whose claimant vanished before the primary answered', function () {
        const primary = connect(), dead = connect(), reloaded = connect(), t = token();
        send(primary, { type: 'register', token: t, ownerKey: KEY });
        send(dead, { type: 'claim', token: t });
        send(reloaded, { type: 'claim', token: t });
        expect(last(reloaded).reason).to.equal('busy');

        clock.tick(10001);
        send(reloaded, { type: 'claim', token: t });
        expect(last(primary)).to.include({ type: 'claimed', token: t });
        send(primary, { type: 'offer', token: t }, [{}, {}, {}]);
        expect(reloaded.postMessage.lastCall.args[0]).to.deep.equal({ type: 'kasm_ports' });
        expect(dead.postMessage.called).to.be.false;
    });

    it('lets a claimant whose claim timed out ask again while nobody else has claimed', function () {
        const primary = connect(), slow = connect(), t = token();
        send(primary, { type: 'register', token: t, ownerKey: KEY });
        send(slow, { type: 'claim', token: t });
        const first = last(primary).claim;
        clock.tick(10001);
        send(slow, { type: 'claim', token: t });
        expect(last(primary)).to.include({ type: 'claimed', token: t });
        expect(last(primary).claim).to.be.above(first);
        send(primary, { type: 'offer', token: t, claim: last(primary).claim }, [{}, {}, {}]);
        expect(last(slow)).to.deep.equal({ type: 'kasm_ports' });
    });

    it('lets a claimant ask again after a replacement claimant timed out too', function () {
        const primary = connect(), a = connect(), b = connect(), t = token();
        send(primary, { type: 'register', token: t, ownerKey: KEY });
        send(a, { type: 'claim', token: t });
        clock.tick(10001);
        send(b, { type: 'claim', token: t });
        clock.tick(10001);
        send(a, { type: 'claim', token: t });
        expect(last(primary)).to.include({ type: 'claimed', token: t });
        send(primary, { type: 'offer', token: t, claim: last(primary).claim }, [{}, {}, {}]);
        expect(last(a)).to.deep.equal({ type: 'kasm_ports' });
    });

    it('does not let a claimant claim again once it was handed the ports or replaced', function () {
        const primary = connect(), first = connect(), second = connect(), t = token();
        send(primary, { type: 'register', token: t, ownerKey: KEY });
        send(first, { type: 'claim', token: t });
        clock.tick(10001);
        send(second, { type: 'claim', token: t });
        send(first, { type: 'claim', token: t });
        expect(last(first).reason).to.equal('busy');
        send(primary, { type: 'offer', token: t, claim: last(primary).claim }, [{}, {}, {}]);
        send(second, { type: 'claim', token: t });
        expect(last(second).reason).to.equal('busy');
    });

    it('still hands the ports to a claimant whose answer was late, if nobody else claimed', function () {
        const primary = connect(), slow = connect(), t = token();
        send(primary, { type: 'register', token: t, ownerKey: KEY });
        send(slow, { type: 'claim', token: t });
        clock.tick(15000);
        send(primary, { type: 'offer', token: t }, [{}, {}, {}]);
        expect(last(slow)).to.deep.equal({ type: 'kasm_ports' });
    });

    it('names each claim to the primary and drops an answer for an older one', function () {
        const primary = connect(), first = connect(), second = connect(), t = token();
        send(primary, { type: 'register', token: t, ownerKey: KEY });
        send(first, { type: 'claim', token: t });
        const firstClaim = last(primary).claim;
        clock.tick(10001);
        send(second, { type: 'claim', token: t });
        const secondClaim = last(primary).claim;
        expect(secondClaim).to.not.equal(firstClaim);

        send(primary, { type: 'offer', token: t, claim: firstClaim }, [{}, {}, {}]);
        expect(second.postMessage.called).to.be.false;
        send(primary, { type: 'offer', token: t, claim: secondClaim }, [{}, {}, {}]);
        expect(last(second)).to.deep.equal({ type: 'kasm_ports' });
        expect(first.postMessage.called).to.be.false;
    });

    it('tells the primary when an offer is stale or has the wrong number of ports', function () {
        const primary = connect(), popup = connect(), t = token();
        send(primary, { type: 'register', token: t, ownerKey: KEY });
        send(primary, { type: 'offer', token: t }, [{}, {}, {}]);
        expect(last(primary)).to.include({ type: 'rejected', token: t, reason: 'stale' });

        send(popup, { type: 'claim', token: t });
        const claim = last(primary).claim;
        send(primary, { type: 'offer', token: t, claim }, [{}, {}]);
        expect(last(primary)).to.include({ type: 'rejected', token: t, reason: 'stale' });
        send(primary, { type: 'offer', token: t, claim: claim + 1 }, [{}, {}, {}]);
        expect(last(primary)).to.include({ type: 'rejected', token: t, reason: 'stale' });
        expect(last(primary).claim).to.equal(claim + 1);

        expect(popup.postMessage.called).to.be.false;
    });

    it('does not answer an offer from a port that does not own the room', function () {
        const primary = connect(), other = connect(), t = token();
        send(primary, { type: 'register', token: t, ownerKey: KEY });
        send(other, { type: 'offer', token: t }, [{}, {}, {}]);
        expect(other.postMessage.called).to.be.false;
    });

    it('gives the ports to a newer claimant once the first one timed out', function () {
        const primary = connect(), slow = connect(), newer = connect(), t = token();
        send(primary, { type: 'register', token: t, ownerKey: KEY });
        send(slow, { type: 'claim', token: t });
        clock.tick(10001);
        send(newer, { type: 'claim', token: t });
        expect(last(primary)).to.include({ type: 'claimed', token: t });
        send(primary, { type: 'offer', token: t }, [{}, {}, {}]);
        expect(last(newer)).to.deep.equal({ type: 'kasm_ports' });
        expect(slow.postMessage.called).to.be.false;
    });

    it('keeps a linked room dormant when its primary goes quiet, and tells nobody', function () {
        const primary = connect(), popup = connect(), t = token();
        send(primary, { type: 'register', token: t, ownerKey: KEY });
        send(popup, { type: 'claim', token: t });
        send(primary, { type: 'offer', token: t }, [{}, {}, {}]);
        const before = primary.postMessage.callCount;
        clock.tick(100000);
        send(connect(), { type: 'claim', token: t });
        expect(last(primary)).to.include({ type: 'claimed', token: t });

        clock.tick(300000);
        expect(expired(primary, t)).to.be.false;
        expect(primary.postMessage.callCount).to.equal(before + 1);
    });

    it('wakes a dormant room when its primary is heard from again', function () {
        const primary = connect(), t = linkedRoom(primary);
        clock.tick(400000);
        send(primary, { type: 'ping' });
        clock.tick(3000000);
        send(primary, { type: 'ping' });
        expect(expired(primary, t)).to.be.false;
        const late = connect();
        send(late, { type: 'claim', token: t });
        expect(last(primary)).to.include({ type: 'claimed', token: t });
    });

    it('lets a reloaded primary resume a room that went dormant while the machine slept', function () {
        const old = connect(), reloaded = connect(), t = linkedRoom(old);
        clock.tick(1800000);
        send(reloaded, { type: 'resume', token: t, ownerKey: KEY });
        expect(last(reloaded)).to.deep.equal({ type: 'registered', token: t });
        const popup = connect();
        send(popup, { type: 'claim', token: t });
        expect(last(reloaded)).to.include({ type: 'claimed', token: t });
    });

    it('drops a dormant room after DORMANT_TTL_MS and tells its primary', function () {
        const primary = connect(), t = linkedRoom(primary);
        clock.tick(3500000);
        expect(expired(primary, t)).to.be.false;
        clock.tick(400000);
        expect(expired(primary, t)).to.be.true;
        const late = connect();
        send(late, { type: 'claim', token: t });
        expect(last(late).reason).to.equal('unknown');
    });

    it('does not keep a room dormant that nobody ever linked', function () {
        const primary = connect(), t = token();
        send(primary, { type: 'register', token: t, ownerKey: KEY });
        clock.tick(125000);
        expect(last(primary)).to.deep.equal({ type: 'expired', token: t });
    });

    it('frees the room slots of a vanished primary so new windows can register', function () {
        const gone = connect(), fresh = connect(), others = [connect(), connect(), connect()];
        const link = (primary) => {
            const t = token();
            send(primary, { type: 'register', token: t, ownerKey: KEY });
            send(connect(), { type: 'claim', token: t });
            send(primary, { type: 'offer', token: t }, [{}, {}, {}]);
        };
        for (const primary of [gone, ...others]) {
            for (let i = 0; i < PER_PORT; i++) { link(primary); }
        }
        const t = token();
        send(fresh, { type: 'register', token: t, ownerKey: KEY });
        expect(last(fresh).reason).to.equal('limit');

        for (let spent = 0; spent < 200000; spent += 20000) {
            clock.tick(20000);
            others.forEach(p => send(p, { type: 'ping' }));
        }
        send(fresh, { type: 'register', token: t, ownerKey: KEY });
        expect(last(fresh)).to.deep.equal({ type: 'registered', token: t });
        const more = connect();
        for (let i = 0; i < PER_PORT - 1; i++) { send(more, { type: 'register', token: token(), ownerKey: KEY }); }
        expect(last(more).type).to.equal('registered');
        const extra = connect();
        send(extra, { type: 'register', token: token(), ownerKey: KEY });
        expect(last(extra).reason).to.equal('limit');
    });


    it('keeps a rotated room past the unclaimed lifetime while its primary pings', function () {
        const primary = connect(), popup = connect(), t = token();
        const old = linkedRoom(primary);
        send(primary, { type: 'register', token: t, ownerKey: KEY, replaces: old });
        keepAlive(primary, 300000);
        expect(expired(primary, t)).to.be.false;
        send(popup, { type: 'claim', token: t });
        expect(last(primary)).to.include({ type: 'claimed', token: t });
    });

    it('lets a rotated room go dormant, then drops it, when its primary goes quiet', function () {
        const primary = connect(), t = token();
        const old = linkedRoom(primary);
        send(primary, { type: 'register', token: t, ownerKey: KEY, replaces: old });
        clock.tick(190000);
        expect(expired(primary, t)).to.be.false;
        clock.tick(3700000);
        expect(expired(primary, t)).to.be.true;
    });

    it('gives no unclaimed-free lifetime to a room that replaces nothing usable', function () {
        const primary = connect(), other = connect();
        const foreign = linkedRoom(other);
        const unlinked = token();
        send(primary, { type: 'register', token: unlinked, ownerKey: KEY });
        const cases = [undefined, 'x', token(), foreign, unlinked];
        const made = cases.map((r) => {
            const t = token();
            send(primary, { type: 'register', token: t, ownerKey: KEY, replaces: r });
            return t;
        });
        keepAlive(primary, 130000);
        keepAlive(other, 0);
        made.forEach(t => expect(expired(primary, t)).to.be.true);
    });

    it('gives the slots of dormant rooms to a new registration, oldest first', function () {
        const gone = connect(), others = [connect(), connect(), connect()], fresh = connect();
        const first = linkedRoom(gone);
        clock.tick(1000);
        const second = linkedRoom(gone);
        for (let i = 0; i < PER_PORT - 2; i++) { clock.tick(1000); linkedRoom(gone); }
        for (const p of others) { for (let i = 0; i < PER_PORT; i++) { linkedRoom(p); } }
        for (let spent = 0; spent < 200000; spent += 20000) {
            clock.tick(20000);
            others.forEach(p => send(p, { type: 'ping' }));
        }
        const t = token();
        send(fresh, { type: 'register', token: t, ownerKey: KEY });
        expect(last(fresh)).to.deep.equal({ type: 'registered', token: t });
        expect(expired(gone, first)).to.be.true;
        expect(expired(gone, second)).to.be.false;
    });

    it('does not drop anyone\'s dormant room for a registration its own port is refused', function () {
        const sleeper = connect(), busy = connect();
        const slept = linkedRoom(sleeper);
        clock.tick(200000);
        for (let i = 0; i < PER_PORT; i++) { linkedRoom(busy); }
        [PER_PORT, PER_PORT, PER_PORT - 1].forEach((n) => {
            const p = connect();
            for (let i = 0; i < n; i++) { linkedRoom(p); }
        });
        expect(expired(sleeper, slept)).to.be.false;
        const t = token();
        send(busy, { type: 'register', token: t, ownerKey: KEY });
        expect(last(busy)).to.deep.equal({ type: 'rejected', token: t, reason: 'limit' });
        expect(expired(sleeper, slept)).to.be.false;
    });

    it('does not take a slot from a room whose primary is running', function () {
        const full = [connect(), connect(), connect(), connect()], fresh = connect();
        for (const p of full) { for (let i = 0; i < PER_PORT; i++) { linkedRoom(p); } }
        for (let spent = 0; spent < 200000; spent += 20000) {
            clock.tick(20000);
            full.forEach(p => send(p, { type: 'ping' }));
        }
        const t = token();
        send(fresh, { type: 'register', token: t, ownerKey: KEY });
        expect(last(fresh)).to.deep.equal({ type: 'rejected', token: t, reason: 'limit' });
    });

    it('does not use other ports\' dormant rooms to get past a port\'s own limit', function () {
        const a = connect(), b = connect();
        const theirs = linkedRoom(b);
        clock.tick(200000);
        for (let i = 0; i < PER_PORT; i++) { linkedRoom(a); }
        const t = token();
        send(a, { type: 'register', token: t, ownerKey: KEY });
        expect(last(a)).to.deep.equal({ type: 'rejected', token: t, reason: 'limit' });
        expect(expired(b, theirs)).to.be.false;
    });

    it('refuses a registration without a valid owner key', function () {
        const primary = connect(), t = token();
        send(primary, { type: 'register', token: t });
        expect(last(primary)).to.deep.equal({ type: 'rejected', token: t, reason: 'invalid' });
        send(primary, { type: 'register', token: t, ownerKey: 'short' });
        expect(last(primary).reason).to.equal('invalid');
    });

    it('lets a reloaded primary resume its room with the owner key', function () {
        const old = connect(), reloaded = connect(), popup = connect(), t = token();
        send(old, { type: 'register', token: t, ownerKey: KEY });
        send(popup, { type: 'claim', token: t });
        send(old, { type: 'offer', token: t }, [{}, {}, {}]);
        send(old, { type: 'suspend' });

        send(reloaded, { type: 'resume', token: t, ownerKey: KEY });
        expect(last(reloaded)).to.deep.equal({ type: 'registered', token: t });
        const oldCalls = old.postMessage.callCount;

        const again = connect();
        send(again, { type: 'claim', token: t });
        expect(last(reloaded)).to.include({ type: 'claimed', token: t });
        expect(old.postMessage.callCount).to.equal(oldCalls);

        send(old, { type: 'offer', token: t }, [{}, {}, {}]);
        expect(again.postMessage.called).to.be.false;
    });

    it('does not let the token alone take a room over', function () {
        const primary = connect(), thief = connect(), popup = connect(), t = token();
        send(primary, { type: 'register', token: t, ownerKey: KEY });
        send(thief, { type: 'resume', token: t });
        expect(last(thief)).to.deep.equal({ type: 'rejected', token: t, reason: 'unknown' });
        send(thief, { type: 'resume', token: t, ownerKey: 'd'.repeat(32) });
        expect(last(thief).reason).to.equal('unknown');
        send(popup, { type: 'claim', token: t });
        expect(last(primary)).to.include({ type: 'claimed', token: t });
        expect(thief.postMessage.callCount).to.equal(2);
    });

    it('passes a claim that arrived while the old page was leaving on to the page that resumes', function () {
        const old = connect(), reloaded = connect(), popup = connect(), t = linkedRoom(old);
        send(old, { type: 'suspend' });
        send(popup, { type: 'claim', token: t });
        const claim = last(old).claim;
        send(reloaded, { type: 'resume', token: t, ownerKey: KEY });
        expect(reloaded.postMessage.getCalls().map(c => c.args[0])).to.deep.equal([
            { type: 'registered', token: t },
            { type: 'claimed', token: t, claim },
        ]);
    });

    it('starts the unclaimed lifetime again when a primary resumes a room nobody linked', function () {
        const old = connect(), reloaded = connect(), t = token();
        send(old, { type: 'register', token: t, ownerKey: KEY });
        clock.tick(100000);
        send(old, { type: 'suspend' });
        send(reloaded, { type: 'resume', token: t, ownerKey: KEY });
        clock.tick(30000);
        expect(expired(reloaded, t)).to.be.false;
        clock.tick(100000);
        expect(expired(reloaded, t)).to.be.true;
    });

    it('does not put a lifetime on a linked room that is resumed', function () {
        const old = connect(), reloaded = connect(), t = linkedRoom(old);
        send(old, { type: 'suspend' });
        send(reloaded, { type: 'resume', token: t, ownerKey: KEY });
        keepAlive(reloaded, 300000);
        expect(expired(reloaded, t)).to.be.false;
    });

    it('does not repeat an old claim after a resume when there is none pending', function () {
        const old = connect(), reloaded = connect(), t = linkedRoom(old);
        send(old, { type: 'suspend' });
        clock.tick(1000);
        send(reloaded, { type: 'resume', token: t, ownerKey: KEY });
        expect(reloaded.postMessage).to.have.been.calledOnce;
    });

    it('does not let a copy of the tab take a room from a primary that is still running', function () {
        const live = connect(), copy = connect(), t = linkedRoom(live);
        keepAlive(live, 60000);
        send(copy, { type: 'resume', token: t, ownerKey: KEY });
        expect(last(copy)).to.deep.equal({ type: 'rejected', token: t, reason: 'busy' });
        send(connect(), { type: 'claim', token: t });
        expect(last(live)).to.include({ type: 'claimed', token: t });
    });

    it('lets a resume through once the old primary has been silent too long', function () {
        const old = connect(), reloaded = connect(), t = linkedRoom(old);
        clock.tick(60000);
        send(reloaded, { type: 'resume', token: t, ownerKey: KEY });
        expect(last(reloaded).reason).to.equal('busy');
        clock.tick(11000);
        send(reloaded, { type: 'resume', token: t, ownerKey: KEY });
        expect(last(reloaded)).to.deep.equal({ type: 'registered', token: t });
    });

    it('takes a suspension back when the old page pings again', function () {
        const old = connect(), copy = connect(), t = linkedRoom(old);
        send(old, { type: 'suspend' });
        send(old, { type: 'ping' });
        send(copy, { type: 'resume', token: t, ownerKey: KEY });
        expect(last(copy).reason).to.equal('busy');
    });

    it('tells a resuming primary when the room is gone', function () {
        const primary = connect(), t = token();
        send(primary, { type: 'resume', token: t, ownerKey: KEY });
        expect(last(primary)).to.deep.equal({ type: 'rejected', token: t, reason: 'unknown' });
    });
});
