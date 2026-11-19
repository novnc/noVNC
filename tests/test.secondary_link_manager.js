const expect = chai.expect;

import SecondaryLinkManager from '../core/secondary/link-manager.js';

describe('Secondary link manager', function () {
    let m, state;

    beforeEach(function () {
        state = { connected: true };
        m = new SecondaryLinkManager({
            isConnected: () => state.connected,
            handleControlMessage: () => {},
            removeLinkedScreen: () => {},
        });
    });

    describe('window bookkeeping', function () {
        const win = closed => ({ closed, postMessage: sinon.spy() });

        beforeEach(function () {
            m._tokens = new Map();
            m._keys = new Map();
            m._links = new Map();
            m._windows = new Map();
        });

        it('forgets closed windows that were opened directly', function () {
            m._windows.set('gone', win(true));
            m._windows.set('open', win(false));
            m.registerWindow('new', win(false));
            expect([...m._windows.keys()]).to.have.members(['open', 'new']);
        });

        it('keeps a closed looking window that holds a relay token or a live link', function () {
            m._tokens.set('t'.repeat(32), 'tokenised');
            m._links.set('linked', {});
            m._windows.set('tokenised', win(true));
            m._windows.set('linked', win(true));
            m.prune();
            expect(m._windows.size).to.equal(2);
        });

        it('forgets the window when its relay token is refused or expires', function () {
            m._tokens.set('t'.repeat(32), 'w1');
            m._windows.set('w1', win(true));
            m._forgetToken('t'.repeat(32));
            expect(m._windows.has('w1')).to.be.false;
        });

        it('keeps the window when it is still linked', function () {
            m._tokens.set('t'.repeat(32), 'w1');
            m._links.set('w1', {});
            m._windows.set('w1', win(true));
            m._forgetToken('t'.repeat(32));
            expect(m._windows.has('w1')).to.be.true;
        });
    });

    describe('window handshake', function () {
        const hello = source => m.handleHello({ source, data: { type: 'kasm_hello', windowId: 'w1' } });

        it('only links the window the primary opened', function () {
            const opened = { closed: false, postMessage: sinon.spy() };
            m._links = new Map();
            m._tokens = new Map();
            m._keys = new Map();
            m._grace = new Map();
            m._windows = new Map([['w1', opened]]);

            hello({ closed: false, postMessage: sinon.spy() });
            expect(opened.postMessage).to.not.have.been.called;

            hello(opened);
            expect(opened.postMessage).to.have.been.calledOnce;
            expect(opened.postMessage.firstCall.args[2]).to.have.lengthOf(3);
            expect(m._links.has('w1')).to.be.true;
        });

        it('drops an opener link whose window never registered a screen', function () {
            const clock = sinon.useFakeTimers();
            try {
                const opened = { closed: false, postMessage: sinon.spy() };
                Object.assign(m, {
                    _links: new Map(), _tokens: new Map(), _keys: new Map(),
                    _grace: new Map(), _windows: new Map([['w1', opened]]),
                });
                hello(opened);
                expect(m._links.has('w1')).to.be.true;
                clock.tick(30001);
                expect(m._links.has('w1')).to.be.false;
            } finally {
                clock.restore();
            }
        });

        it('links a window whose handshake arrived before the connection was up', function () {
            const opened = { closed: false, postMessage: sinon.spy() };
            Object.assign(m, {
                _links: new Map(), _tokens: new Map(), _keys: new Map(),
                _grace: new Map(), _windows: new Map([['w1', opened]]),
            });
            state.connected = false;
            hello(opened);
            expect(opened.postMessage).to.not.have.been.called;
            state.connected = true;
            m.onConnected();
            expect(opened.postMessage).to.have.been.calledOnce;
            expect(m._links.has('w1')).to.be.true;
            m.onConnected();
            expect(opened.postMessage).to.have.been.calledOnce;
        });
    });

    describe('relay', function () {
        let relay, clock;
        const TOKEN = 'a'.repeat(32);
        const KEY = 'b'.repeat(32);

        beforeEach(function () {
            clock = sinon.useFakeTimers();
            relay = { port: { postMessage: sinon.spy() } };
            Object.assign(m, {
                _relay: relay,
                _tokens: new Map([[TOKEN, 'w1']]),
                _keys: new Map([[TOKEN, KEY]]),
                _grace: new Map(),
                _links: new Map(),
                _windows: new Map([['w1', { closed: true, postMessage: sinon.spy() }]]),
            });
        });
        afterEach(function () { clock.restore(); });

        const relayMsg = data => m.handleRelayMessage({ data });
        const offers = () => relay.port.postMessage.getCalls().filter(c => c.args[0].type === 'offer');

        describe('a claim that arrives before this page is connected', function () {
            afterEach(function () { m._pendingClaims = null; });

            it('is held until the connection is up, then answered', function () {
                state.connected = false;
                relayMsg({ type: 'claimed', token: TOKEN, claim: 3 });
                expect(offers()).to.have.lengthOf(0);
                expect(m._links.size).to.equal(0);

                state.connected = true;
                m.onConnected();
                expect(offers()).to.have.lengthOf(1);
                expect(offers()[0].args[0].claim).to.equal(3);
                m.onConnected();
                expect(offers()).to.have.lengthOf(1);
            });

            it('keeps only the newest claim for a token', function () {
                state.connected = false;
                relayMsg({ type: 'claimed', token: TOKEN, claim: 1 });
                relayMsg({ type: 'claimed', token: TOKEN, claim: 2 });
                state.connected = true;
                m.onConnected();
                expect(offers()).to.have.lengthOf(1);
                expect(offers()[0].args[0].claim).to.equal(2);
            });

            it('is dropped when the relay is closed', function () {
                state.connected = false;
                relayMsg({ type: 'claimed', token: TOKEN, claim: 1 });
                relay.port.close = sinon.spy();
                m._closeRelay();
                expect(m._pendingClaims).to.be.null;
            });

            it('also makes a window handshake wait', function () {
                const opened = { closed: false, postMessage: sinon.spy() };
                m._windows = new Map([['w1', opened]]);
                state.connected = false;
                m.handleHello({ source: opened, data: { type: 'kasm_hello', windowId: 'w1' } });
                expect(opened.postMessage).to.not.have.been.called;
                expect(m._links.size).to.equal(0);
            });
        });

        it('keeps the token after a hand-over so a reloaded window can link again', function () {
            relayMsg({ type: 'claimed', token: TOKEN });
            relayMsg({ type: 'claimed', token: TOKEN });
            clock.tick(2001);
            expect(offers()).to.have.lengthOf(2);
            expect(m._tokens.has(TOKEN)).to.be.true;
        });

        describe('a second claim for a window that is already linked', function () {
            let first, spy;

            beforeEach(function () {
                relayMsg({ type: 'claimed', token: TOKEN });
                first = m._links.get('w1');
                spy = sinon.spy(first.port, 'postMessage');
            });

            it('asks the existing link whether it is still there before replacing it', function () {
                relayMsg({ type: 'claimed', token: TOKEN });
                expect(spy).to.have.been.calledOnceWith({ eventType: 'relayProbe', screenID: null });
                expect(offers()).to.have.lengthOf(1);
            });

            it('keeps the link and hands nothing over when the popup answers', function () {
                relayMsg({ type: 'claimed', token: TOKEN });
                m.answerProbe(first);
                clock.tick(5000);
                expect(offers()).to.have.lengthOf(1);
                expect(m._links.get('w1')).to.equal(first);
            });

            it('replaces the link when the popup does not answer', function () {
                relayMsg({ type: 'claimed', token: TOKEN });
                clock.tick(1999);
                expect(offers()).to.have.lengthOf(1);
                clock.tick(2);
                expect(offers()).to.have.lengthOf(2);
                expect(m._links.get('w1')).to.not.equal(first);
            });

            it('probes only once while it waits', function () {
                relayMsg({ type: 'claimed', token: TOKEN });
                relayMsg({ type: 'claimed', token: TOKEN });
                relayMsg({ type: 'claimed', token: TOKEN });
                expect(spy).to.have.been.calledOnce;
            });

            it('can still be probed again after a refusal', function () {
                relayMsg({ type: 'claimed', token: TOKEN });
                m.answerProbe(first);
                relayMsg({ type: 'claimed', token: TOKEN });
                expect(spy).to.have.been.calledTwice;
            });

            it('ignores a relayAlive when no probe is pending', function () {
                m.answerProbe(first);
                expect(m._links.get('w1')).to.equal(first);
            });
        });

        it('ignores a claim for a token or window it does not know', function () {
            relayMsg({ type: 'claimed', token: 'b'.repeat(32) });
            m._windows.clear();
            relayMsg({ type: 'claimed', token: TOKEN });
            expect(offers()).to.have.lengthOf(0);
        });

        it('forgets a token the worker refused or expired', function () {
            relayMsg({ type: 'rejected', token: TOKEN, reason: 'limit' });
            expect(m._tokens.has(TOKEN)).to.be.false;

            m._tokens.set(TOKEN, 'w1');
            relayMsg({ type: 'expired', token: TOKEN });
            expect(m._tokens.has(TOKEN)).to.be.false;
        });

        it('frees a closed window\'s token after the grace period', function () {
            m.scheduleRelease('w1');
            clock.tick(29000);
            expect(m._tokens.has(TOKEN)).to.be.true;
            clock.tick(2000);
            expect(m._tokens.has(TOKEN)).to.be.false;
            expect(m._windows.has('w1')).to.be.false;
            expect(relay.port.postMessage).to.have.been.calledWith({ type: 'unregister', token: TOKEN });
        });

        it('keeps the token when the window links again within the grace period', function () {
            m.scheduleRelease('w1');
            clock.tick(10000);
            relayMsg({ type: 'claimed', token: TOKEN });
            clock.tick(25000);
            expect(m._tokens.has(TOKEN)).to.be.true;
            expect(m._windows.has('w1')).to.be.true;
        });


        it('does nothing for a window that was not linked through the relay', function () {
            m._tokens.clear();
            m.scheduleRelease('w1');
            expect(m._grace.size).to.equal(0);
        });
    });

    describe('token rotation and resume', function () {
        let relay;
        const T1 = 'a'.repeat(32), K1 = 'b'.repeat(32), T2 = 'e'.repeat(32);
        const posted = type => relay.port.postMessage.getCalls().map(c => c.args[0]).filter(m => m.type === type);

        beforeEach(function () {
            relay = { port: { postMessage: sinon.spy() } };
            m._storeKey = () => 'kasm_relay_rooms:/test';
            Object.assign(m, {
                _relay: relay, _tokens: new Map(), _keys: new Map(), _grace: new Map(),
                _links: new Map(), _windows: new Map(),
            });
        });
        afterEach(function () { window.sessionStorage.removeItem('kasm_relay_rooms:/test'); });

        const linked = (token) => {
            const l = { windowId: 'w1', screenID: 'sec-1', token, pendingToken: null, port: { postMessage: sinon.spy() } };
            m._tokens.set(token, 'w1');
            m._keys.set(token, K1);
            return l;
        };

        it('hands a linked popup a fresh token and keeps the old one until it acknowledges', function () {
            const l = linked(T1);
            m._links.set('w1', l);
            m.rotateToken(l);
            const reg = posted('register');
            expect(reg).to.have.lengthOf(1);
            expect(reg[0].token).to.match(/^[0-9a-f]{32}$/).and.not.equal(T1);
            expect(reg[0].ownerKey).to.match(/^[0-9a-f]{32}$/);
            expect(reg[0].replaces).to.equal(T1);
            expect(l.port.postMessage).to.not.have.been.called;
            m.handleRelayMessage({ data: { type: 'registered', token: reg[0].token } });
            expect(l.port.postMessage).to.have.been.calledOnce;
            expect(l.port.postMessage).to.have.been.calledWithMatch({ eventType: 'relayRotate', token: reg[0].token });
            expect(posted('unregister')).to.have.lengthOf(0);
            expect(m._tokens.has(T1)).to.be.true;

            m.finishRotation(l, reg[0].token);
            expect(posted('unregister')).to.deep.equal([{ type: 'unregister', token: T1 }]);
            expect(m._tokens.has(T1)).to.be.false;
            expect(m._tokens.get(reg[0].token)).to.equal('w1');
            expect(l.token).to.equal(reg[0].token);
        });

        it('leaves the popup on its token when the worker refuses the new one', function () {
            const l = linked(T1);
            m._links.set('w1', l);
            m.rotateToken(l);
            const next = posted('register')[0].token;
            m.handleRelayMessage({ data: { type: 'rejected', token: next, reason: 'limit' } });
            expect(l.pendingToken).to.be.null;
            expect(l.port.postMessage).to.not.have.been.called;
            expect(m._tokens.has(next)).to.be.false;
            expect(m._tokens.has(T1)).to.be.true;
            m.finishRotation(l, next);
            expect(posted('unregister')).to.have.lengthOf(0);
        });

        it('releases a replacement token when the link is dropped before the popup acknowledged', function () {
            const l = linked(T1);
            const closer = { close: sinon.spy() };
            Object.assign(l, { port: Object.assign({ postMessage: sinon.spy() }, closer), channel: closer, encodedFramePort: closer });
            m._links.set('w1', l);
            m.rotateToken(l);
            const next = posted('register')[0].token;
            m.drop(l);
            expect(posted('unregister')).to.deep.equal([{ type: 'unregister', token: next }]);
            expect(m._tokens.has(next)).to.be.false;
            expect(m._keys.has(next)).to.be.false;
            expect(m._tokens.has(T1)).to.be.true;
        });

        it('ignores an acknowledgement for a token it did not hand out', function () {
            const l = linked(T1);
            m.rotateToken(l);
            m.finishRotation(l, T2);
            expect(posted('unregister')).to.have.lengthOf(0);
            expect(l.token).to.equal(T1);
        });



        it('tries a resume again when the worker says the old page still looks alive', function () {
            const clock = sinon.useFakeTimers();
            try {
                m._tokens.set(T1, 'w1');
                m._keys.set(T1, K1);
                for (let i = 0; i < 6; i++) {
                    m.handleRelayMessage({ data: { type: 'rejected', token: T1, reason: 'busy' } });
                    clock.tick(15001);
                    expect(posted('resume')).to.have.lengthOf(i + 1);
                    expect(posted('resume')[i]).to.deep.equal({ type: 'resume', token: T1, ownerKey: K1 });
                    expect(m._tokens.has(T1)).to.be.true;
                }
                m.handleRelayMessage({ data: { type: 'rejected', token: T1, reason: 'busy' } });
                clock.tick(60000);
                expect(posted('resume')).to.have.lengthOf(6);
                expect(m._tokens.has(T1)).to.be.false;
            } finally {
                clock.restore();
            }
        });



        it('keeps the popup attached when only the replacement token is refused', function () {
            const l = linked(T1);
            m._links.set('w1', l);
            m._windows.set('w1', { closed: true });
            m.rotateToken(l);
            const next = posted('register')[0].token;
            m.handleRelayMessage({ data: { type: 'rejected', token: next, reason: 'limit' } });
            expect(l.pendingToken).to.be.null;
            expect(m._tokens.has(T1)).to.be.true;
            expect(m._windows.has('w1')).to.be.true;
        });

        it('unregisters every room on a deliberate disconnect and forgets the stored keys', function () {
            m._registerToken('w1');
            m._registerToken('w2');
            const tokens = [...m._tokens.keys()];
            relay.port.close = sinon.spy();
            relay.port.postMessage.resetHistory();
            m._leaving = false;
            m._deliberate = true;
            m._closeRelay();
            m._deliberate = false;
            expect(posted('unregister').map(m => m.token)).to.have.members(tokens);
            expect(posted('suspend')).to.have.lengthOf(0);
            expect(window.sessionStorage.getItem('kasm_relay_rooms:/test')).to.be.null;
            expect(m._relay).to.be.null;
        });

        it('keeps the rooms when the connection dropped and a new RFB in this page will resume them', function () {
            m._registerToken('w1');
            relay.port.close = sinon.spy();
            relay.port.postMessage.resetHistory();
            m._leaving = false;
            m._deliberate = false;
            m._closeRelay();
            expect(posted('suspend')).to.have.lengthOf(1);
            expect(posted('unregister')).to.have.lengthOf(0);
            expect(JSON.parse(window.sessionStorage.getItem('kasm_relay_rooms:/test'))).to.have.lengthOf(1);
        });

        it('keeps the rooms and the stored keys when the page is only reloading', function () {
            m._registerToken('w1');
            relay.port.close = sinon.spy();
            relay.port.postMessage.resetHistory();
            m._leaving = true;
            m._closeRelay();
            expect(posted('suspend')).to.have.lengthOf(1);
            expect(posted('unregister')).to.have.lengthOf(0);
            expect(JSON.parse(window.sessionStorage.getItem('kasm_relay_rooms:/test'))).to.have.lengthOf(1);
            m._leaving = false;
        });

        it('releases an unfinished rotation before it starts another', function () {
            const l = linked(T1);
            m._links.set('w1', l);
            m.rotateToken(l);
            const first = l.pendingToken;
            m.rotateToken(l);
            expect(l.pendingToken).to.not.equal(first);
            expect(m._tokens.has(first)).to.be.false;
            expect(m._keys.has(first)).to.be.false;
            expect(posted('unregister')).to.deep.equal([{ type: 'unregister', token: first }]);
        });


        it('names the claim it answers when it hands the ports over', function () {
            m._tokens.set(T1, 'w1');
            m._windows.set('w1', { closed: true, postMessage: sinon.spy() });
            m._links = new Map();
            m.handleRelayMessage({ data: { type: 'claimed', token: T1, claim: 7 } });
            expect(posted('offer')).to.have.lengthOf(1);
            expect(posted('offer')[0].claim).to.equal(7);
        });


        it('gives restored rooms long enough for every resume retry before it frees them', function () {
            const clock = sinon.useFakeTimers();
            try {
                window.sessionStorage.setItem('kasm_relay_rooms:/test', JSON.stringify([{ token: T1, windowId: 'w1', ownerKey: K1 }]));
                m.restore();
                clock.tick(200000);
                expect(m._tokens.has(T1)).to.be.true;
                clock.tick(11000);
                expect(m._tokens.has(T1)).to.be.false;
            } finally {
                clock.restore();
            }
        });

        it('starts counting resume retries afresh after a resume succeeded', function () {
            const clock = sinon.useFakeTimers();
            try {
                m._tokens.set(T1, 'w1');
                m._keys.set(T1, K1);
                for (let i = 0; i < 4; i++) {
                    m.handleRelayMessage({ data: { type: 'rejected', token: T1, reason: 'busy' } });
                    clock.tick(15001);
                }
                m.handleRelayMessage({ data: { type: 'registered', token: T1 } });
                for (let i = 0; i < 4; i++) {
                    m.handleRelayMessage({ data: { type: 'rejected', token: T1, reason: 'busy' } });
                    clock.tick(15001);
                }
                expect(m._tokens.has(T1)).to.be.true;
            } finally {
                clock.restore();
            }
        });

        it('drops a relay link whose window never registered a screen', function () {
            const clock = sinon.useFakeTimers();
            try {
                m._tokens.set(T1, 'w1');
                m._keys.set(T1, K1);
                m._windows.set('w1', { closed: true, postMessage: sinon.spy() });
                m._link('w1', m._windows.get('w1'), T1, 1);
                expect(m._links.has('w1')).to.be.true;
                const told = sinon.spy(m._links.get('w1').port, 'postMessage');
                clock.tick(30001);
                expect(told).to.have.been.calledOnceWith({ eventType: 'secondarydisconnected' });
                expect(m._links.has('w1')).to.be.false;
                expect(m._grace.has('w1')).to.be.true;
                clock.tick(30001);
                expect(posted('unregister').map(m => m.token)).to.include(T1);
            } finally {
                clock.restore();
            }
        });




        it('drops a link the worker says it could not hand over, but keeps the token', function () {
            m._tokens.set(T1, 'w1');
            m._keys.set(T1, K1);
            m._windows.set('w1', { closed: false, postMessage: sinon.spy() });
            m._link('w1', m._windows.get('w1'), T1, 1);
            expect(m._links.has('w1')).to.be.true;
            m.handleRelayMessage({ data: { type: 'rejected', token: T1, reason: 'stale', claim: 7 } });
            expect(m._links.has('w1')).to.be.true;
            m.handleRelayMessage({ data: { type: 'rejected', token: T1, reason: 'stale', claim: 1 } });
            expect(m._links.has('w1')).to.be.false;
            expect(m._tokens.has(T1)).to.be.true;
        });

        it('stops waiting for a registration once the link is dropped', function () {
            const clock = sinon.useFakeTimers();
            try {
                relay.port.close = sinon.spy();
                m._tokens.set(T1, 'w1');
                m._keys.set(T1, K1);
                m._windows.set('w1', { closed: false, postMessage: sinon.spy() });
                m._link('w1', m._windows.get('w1'), T1, 1);
                const link = m._links.get('w1');
                const told = sinon.spy(link.port, 'postMessage');
                m.drop(link);
                clock.tick(60000);
                expect(told).to.not.have.been.called;
                expect(m._grace.has('w1')).to.be.false;
            } finally {
                clock.restore();
            }
        });

        it('stops resume retries when the relay is closed', function () {
            const clock = sinon.useFakeTimers();
            try {
                relay.port.close = sinon.spy();
                m._tokens.set(T1, 'w1');
                m._keys.set(T1, K1);
                m.handleRelayMessage({ data: { type: 'rejected', token: T1, reason: 'busy' } });
                m._closeRelay();
                clock.tick(60000);
                expect(posted('resume')).to.have.lengthOf(0);
                expect(m._resumeTries).to.equal(null);
            } finally {
                clock.restore();
            }
        });


        it('keeps the rooms in sessionStorage and takes them back after a reload', function () {
            m._registerToken('w1');
            const [token] = m._tokens.keys();
            const key = m._keys.get(token);
            const saved = JSON.parse(window.sessionStorage.getItem('kasm_relay_rooms:/test'));
            expect(saved).to.deep.equal([{ token, windowId: 'w1', ownerKey: key }]);

            Object.assign(m, { _tokens: new Map(), _keys: new Map(), _windows: new Map() });
            relay.port.postMessage.resetHistory();
            m.restore();
            expect(posted('resume')).to.deep.equal([{ type: 'resume', token, ownerKey: key }]);
            expect(m._tokens.get(token)).to.equal('w1');
            expect(m._windows.has('w1')).to.be.true;
            expect(m._grace.has('w1')).to.be.true;
        });

        it('ignores damaged or foreign records when restoring', function () {
            window.sessionStorage.setItem('kasm_relay_rooms:/test', JSON.stringify([
                { token: 'x', windowId: 'w1', ownerKey: K1 },
                { token: T1, windowId: 'w1', ownerKey: 'short' },
                { token: T1, windowId: 5, ownerKey: K1 },
                null,
            ]));
            m.restore();
            expect(m._tokens.size).to.equal(0);
            expect(posted('resume')).to.have.lengthOf(0);
            window.sessionStorage.setItem('kasm_relay_rooms:/test', 'not json');
            m.restore();
            expect(m._tokens.size).to.equal(0);
        });

        it('registers a restored room again when the worker restarted and lost it', function () {
            m._tokens.set(T1, 'w1');
            m._keys.set(T1, K1);
            m._windows.set('w1', { closed: true });
            m._resuming = new Set([T1]);
            m.handleRelayMessage({ data: { type: 'rejected', token: T1, reason: 'unknown' } });
            expect(posted('register')).to.deep.equal([{ type: 'register', token: T1, ownerKey: K1 }]);
            expect(m._tokens.has(T1)).to.be.true;
            m.handleRelayMessage({ data: { type: 'registered', token: T1 } });
            m.handleRelayMessage({ data: { type: 'rejected', token: T1, reason: 'unknown' } });
            expect(posted('register')).to.have.lengthOf(1);
            expect(m._tokens.has(T1)).to.be.false;
        });

        it('gives up on a restored room that another page already owns', function () {
            m._tokens.set(T1, 'w1');
            m._keys.set(T1, K1);
            m._windows.set('w1', { closed: true });
            m._resuming = new Set([T1]);
            m.handleRelayMessage({ data: { type: 'rejected', token: T1, reason: 'unknown' } });
            m.handleRelayMessage({ data: { type: 'rejected', token: T1, reason: 'duplicate' } });
            expect(m._tokens.has(T1)).to.be.false;
        });

        it('asks to resume rooms it restored and remembers which answers are pending', function () {
            const key = m._storeKey();
            window.sessionStorage.setItem(key, JSON.stringify([{ token: T1, ownerKey: K1, windowId: 'w1' }]));
            m._tokens = new Map();
            m._keys = new Map();
            m._windows = new Map();
            m._ensureRelay = () => true;
            m.restore();
            expect(posted('resume')).to.deep.equal([{ type: 'resume', token: T1, ownerKey: K1 }]);
            expect(m._resuming.has(T1)).to.be.true;
        });

        it('forgets a room the worker no longer has', function () {
            m._tokens.set(T1, 'w1');
            m._keys.set(T1, K1);
            m._windows.set('w1', { closed: true });
            m.handleRelayMessage({ data: { type: 'rejected', token: T1, reason: 'unknown' } });
            expect(m._tokens.has(T1)).to.be.false;
            expect(window.sessionStorage.getItem('kasm_relay_rooms:/test')).to.equal(null);
        });
    });

    describe('popup that outlived a reload of the primary', function () {
        const ID = '4adea3d4-8024-49c0-9183-da24d43224ee';
        const hello = source => m.handleHello({ source, data: { type: 'kasm_hello', windowId: ID } });

        beforeEach(function () {
            Object.assign(m, { _links: new Map(), _windows: new Map(), _tokens: new Map(),
                               _keys: new Map(), _grace: new Map() });
        });

        it('links a window whose opener is this page', function () {
            const popup = { closed: false, opener: window, location: { pathname: '/vnc/screen.html' }, postMessage: sinon.spy() };
            hello(popup);
            expect(popup.postMessage).to.have.been.calledOnce;
            expect(m._links.has(ID)).to.be.true;
        });

        it('prefers the popup\'s own opener over a placeholder restored from storage', function () {
            m._windows.set(ID, { closed: true, restored: true, postMessage() {} });
            const popup = { closed: false, opener: window, location: { pathname: '/vnc/screen.html' }, postMessage: sinon.spy() };
            hello(popup);
            expect(popup.postMessage).to.have.been.calledOnce;
            expect(m._links.has(ID)).to.be.true;
        });

        it('still refuses an impostor when a restored placeholder exists', function () {
            m._windows.set(ID, { closed: true, restored: true, postMessage() {} });
            const impostor = { closed: false, opener: {}, postMessage: sinon.spy() };
            hello(impostor);
            expect(impostor.postMessage).to.not.have.been.called;
            expect(m._links.size).to.equal(0);
        });

        it('refuses a window opened by somebody else or with no opener', function () {
            const other = { closed: false, opener: {}, postMessage: sinon.spy() };
            const none = { closed: false, opener: null, postMessage: sinon.spy() };
            hello(other);
            hello(none);
            hello(window);
            expect(other.postMessage).to.not.have.been.called;
            expect(none.postMessage).to.not.have.been.called;
            expect(m._links.size).to.equal(0);
        });

        it('still takes a restored window when it is already at the window limit', function () {
            for (let i = 0; i < 8; i++) {
                const id = '4adea3d4-8024-49c0-9183-da24d43224e' + i;
                m._windows.set(id, { closed: true, restored: true, postMessage() {} });
            }
            m._windows.set(ID, { closed: true, restored: true, postMessage() {} });
            expect(m._windows.size).to.equal(9);
            const popup = { closed: false, opener: window, location: { pathname: '/vnc/screen.html' }, postMessage: sinon.spy() };
            hello(popup);
            expect(popup.postMessage).to.have.been.calledOnce;
        });

        it('refuses a new window once the limit is reached', function () {
            for (let i = 0; i < 8; i++) {
                const id = '4adea3d4-8024-49c0-9183-da24d43224e' + i;
                m._windows.set(id, { closed: false, postMessage() {} });
            }
            const popup = { closed: false, opener: window, location: { pathname: '/vnc/screen.html' }, postMessage: sinon.spy() };
            hello(popup);
            expect(popup.postMessage).to.not.have.been.called;
        });

        it('refuses a window id that is not an id', function () {
            const popup = { closed: false, opener: window, location: { pathname: '/vnc/screen.html' }, postMessage: sinon.spy() };
            m.handleHello({ source: popup, data: { type: 'kasm_hello', windowId: '../../x' } });
            expect(popup.postMessage).to.not.have.been.called;
        });
    });
});
