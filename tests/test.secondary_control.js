const expect = chai.expect;

import RFB from '../core/rfb.js';
import SecondaryLinkManager from '../core/secondary/link-manager.js';
import PrimaryLink from '../core/secondary/primary-link.js';

// Covers the secondary display control path (private MessagePorts, no named channel).
// The RFB object is built by hand so no canvas or websocket is needed.

const P = RFB.prototype;

const GEOMETRY = {
    width: 924, height: 868, serverWidth: 924, serverHeight: 868, x: 1878, y: 0,
    containerWidth: 924, containerHeight: 868, pixelRatio: 1, scale: 1,
};

describe('Secondary display control messages', function () {
    let rfb, link, display, sandbox;

    beforeEach(function () {
        sandbox = sinon.createSandbox();
        sandbox.stub(RFB.messages, 'pointerEventClamped');
        sandbox.stub(RFB.messages, 'keyEvent');
        sandbox.stub(RFB.messages, 'sendBinaryClipboard');

        display = {
            screens: [{ screenID: 'primary' }, { screenID: 'sec-1' }],
            getServerRelativeCoordinates: () => [10, 20],
        };
        link = { windowId: 'w1', screenID: 'sec-1' };
        rfb = Object.create(P);
        Object.assign(rfb, {
            _isPrimaryDisplay: true, _viewOnly: false, _rfbConnectionState: 'connected',
            _display: display, _sock: {}, _mouseButtonMask: 0, _mousePos: {},
            _setLastActive: () => {},
        });
        rfb._links = new SecondaryLinkManager({
            isConnected: () => rfb._rfbConnectionState === 'connected',
            handleControlMessage: (event, target) => rfb._handleControlMessage(event, target),
            removeLinkedScreen: () => {},
        });
        rfb._links._links.set('w1', link);
    });

    afterEach(function () { sandbox.restore(); });

    // an explicit undefined must reach the handler, so no default parameter here
    const send = (data, ...rest) => rfb._handleControlMessage({ data }, rest.length ? rest[0] : link);

    it('ignores messages that did not arrive over a link', function () {
        send({ eventType: 'keyEvent', screenID: 'sec-1', args: [65, 1] }, undefined);
        expect(RFB.messages.keyEvent).to.not.have.been.called;
    });

    it('ignores input from a link that has not registered a screen', function () {
        send({ eventType: 'keyEvent', screenID: 'sec-1', args: [65, 1] }, { windowId: 'w2', screenID: null });
        expect(RFB.messages.keyEvent).to.not.have.been.called;
    });

    it('ignores messages claiming a different screenID than the link owns', function () {
        send({ eventType: 'keyEvent', screenID: 'primary', args: [65, 1] });
        send({ eventType: 'mousemove', screenID: 'other', screenIndex: 1, args: [1, 2, 0, false] });
        expect(RFB.messages.keyEvent).to.not.have.been.called;
        expect(RFB.messages.pointerEventClamped).to.not.have.been.called;
    });

    it('does not trust the sender supplied screenIndex', function () {
        send({ eventType: 'mousemove', screenID: 'sec-1', screenIndex: 0, args: [1, 2, 0, false] });
        expect(rfb._mouseLastScreenIndex).to.equal(1);
    });

    it('relays valid input from the owning link', function () {
        send({ eventType: 'keyEvent', screenID: 'sec-1', args: [65, 1] });
        send({ eventType: 'mousemove', screenID: 'sec-1', args: [1, 2, 0, false] });
        expect(RFB.messages.keyEvent).to.have.been.calledOnce;
        expect(RFB.messages.pointerEventClamped).to.have.been.calledOnce;
    });

    it('drops input in view only mode', function () {
        rfb._viewOnly = true;
        send({ eventType: 'keyEvent', screenID: 'sec-1', args: [65, 1] });
        send({ eventType: 'sendBinaryClipboard', screenID: 'sec-1', args: [['a'], ['text/plain']] });
        expect(RFB.messages.keyEvent).to.not.have.been.called;
        expect(RFB.messages.sendBinaryClipboard).to.not.have.been.called;
    });

    it('rejects malformed arguments', function () {
        send({ eventType: 'keyEvent', screenID: 'sec-1', args: ['x'] });
        send({ eventType: 'mousemove', screenID: 'sec-1', args: ['a', 'b'] });
        send({ eventType: 'sendBinaryClipboard', screenID: 'sec-1', args: [['a'], [1]] });
        expect(RFB.messages.keyEvent).to.not.have.been.called;
        expect(RFB.messages.pointerEventClamped).to.not.have.been.called;
        expect(RFB.messages.sendBinaryClipboard).to.not.have.been.called;
    });

    it('rejects a key event whose down flag or argument count is wrong', function () {
        send({ eventType: 'keyEvent', screenID: 'sec-1', args: [65, 'x'] });
        send({ eventType: 'keyEvent', screenID: 'sec-1', args: [65, 2] });
        send({ eventType: 'keyEvent', screenID: 'sec-1', args: [65] });
        send({ eventType: 'keyEvent', screenID: 'sec-1', args: [65, 1, {}] });
        expect(RFB.messages.keyEvent).to.not.have.been.called;
        send({ eventType: 'keyEvent', screenID: 'sec-1', args: [65, 0] });
        expect(RFB.messages.keyEvent).to.have.been.calledOnceWith(sinon.match.any, 65, 0);
    });

    it('sends a keep alive only while connected', function () {
        sandbox.stub(RFB.messages, 'keepAlive');
        send({ eventType: 'keepAlive', screenID: 'sec-1', args: [] });
        expect(RFB.messages.keepAlive).to.have.been.calledOnce;
        rfb._rfbConnectionState = 'disconnecting';
        send({ eventType: 'keepAlive', screenID: 'sec-1', args: [] });
        expect(RFB.messages.keepAlive).to.have.been.calledOnce;
    });

    it('relays a well formed click and scroll', function () {
        send({ eventType: 'mousedown', screenID: 'sec-1', args: [1, 2, 1] });
        send({ eventType: 'mouseup', screenID: 'sec-1', args: [1, 2, 1] });
        send({ eventType: 'scroll', screenID: 'sec-1', args: [1, 2, 0, 120] });
        expect(RFB.messages.pointerEventClamped).to.have.been.calledThrice;
    });

    it('relays the back and forward buttons', function () {
        send({ eventType: 'mousedown', screenID: 'sec-1', args: [1, 2, 128] });
        send({ eventType: 'mousedown', screenID: 'sec-1', args: [1, 2, 256] });
        send({ eventType: 'mouseup', screenID: 'sec-1', args: [1, 2, 0x3FF] });
        expect(RFB.messages.pointerEventClamped).to.have.been.calledThrice;
        const masks = RFB.messages.pointerEventClamped.getCalls().map(c => c.args[3]);
        expect(masks[1] & 256).to.equal(256);
        expect(rfb._mouseButtonMask).to.equal(0);
    });

    it('rejects a button mask that does not fit the wire format', function () {
        for (const mask of [undefined, -1, 0x400, 0x8000, 0xFFFFFFFF, 1.5, '1', NaN]) {
            send({ eventType: 'mousedown', screenID: 'sec-1', args: [1, 2, mask] });
            send({ eventType: 'mouseup', screenID: 'sec-1', args: [1, 2, mask] });
        }
        expect(RFB.messages.pointerEventClamped).to.not.have.been.called;
        expect(rfb._mouseButtonMask).to.equal(0);
    });

    it('rejects scroll deltas that are not numbers', function () {
        send({ eventType: 'scroll', screenID: 'sec-1', args: [1, 2] });
        send({ eventType: 'scroll', screenID: 'sec-1', args: [1, 2, 'a', 0] });
        send({ eventType: 'scroll', screenID: 'sec-1', args: [1, 2, 0, Infinity] });
        expect(RFB.messages.pointerEventClamped).to.not.have.been.called;
    });

    it('ignores a registration whose geometry is unusable', function () {
        const fresh = () => ({ windowId: 'w3', screenID: null });
        const bad = [
            { serverWidth: 1e9 }, { serverWidth: NaN }, { serverHeight: -1 }, { x: Infinity }, { y: -5 },
            { width: 'a' }, { pixelRatio: NaN }, { scale: NaN }, { scale: 1e6 }, { scale: -1 }, { containerWidth: undefined },
            { serverWidth: 32767, serverHeight: 32767 },
        ];
        rfb._display.addScreen = sinon.spy();
        for (const change of bad) {
            const l = fresh();
            rfb._links._links.set('w3', l);
            send({ eventType: 'register', screenID: 'sec-3', details: {}, ...GEOMETRY, ...change }, l);
            expect(l.screenID, JSON.stringify(change)).to.equal(null);
        }
        expect(rfb._display.addScreen).to.not.have.been.called;
    });

    it('accepts a registration from a window that has no layout yet', function () {
        const l = { windowId: 'w3', screenID: null };
        rfb._links._links.set('w3', l);
        rfb._display.screens = [{ screenID: 'primary' }];
        rfb._display.addScreen = sinon.spy((spec) => { rfb._display.screens.push({ screenID: spec.screenID }); });
        rfb._proxyRFBMessage = () => {};
        rfb._sendEncodings = () => {};
        rfb.dispatchEvent = () => {};
        rfb._links.rotateToken = () => {};
        send({ eventType: 'register', screenID: 'sec-3', details: {}, ...GEOMETRY,
               containerWidth: 0, containerHeight: 0, scale: 0 }, l);
        expect(l.screenID).to.equal('sec-3');
        expect(rfb._display.addScreen).to.have.been.calledOnce;
        expect(rfb._display.addScreen.firstCall.args[0]).to.include({
            screenID: 'sec-3', windowId: 'w3', serverWidth: 924, serverHeight: 868, x: 1878, y: 0,
        });
    });

    it('does not let a second link claim an already registered screenID', function () {
        const other = { windowId: 'w2', screenID: null };
        rfb._links._links.set('w2', other);
        send({ eventType: 'register', screenID: 'sec-1', ...GEOMETRY }, other);
        expect(other.screenID).to.equal(null);
    });

    describe('window messages', function () {
        it('ignores a handshake from another origin', function () {
            const opened = { closed: false, postMessage: sinon.spy() };
            rfb._links._windows.set('w1', opened);
            rfb._links._links.clear();
            rfb._handleWindowMessage({ origin: 'https://evil.example.com', source: opened,
                                       data: { type: 'kasm_hello', windowId: 'w1' } });
            expect(opened.postMessage).to.not.have.been.called;
            rfb._handleWindowMessage({ origin: window.location.origin, source: opened,
                                       data: { type: 'kasm_hello', windowId: 'w1' } });
            expect(opened.postMessage).to.have.been.calledOnce;
        });

        it('hands ports on the secondary side to the primary link', function () {
            const secondary = Object.create(P);
            secondary._isPrimaryDisplay = false;
            secondary._primaryLink = { handleWindowMessage: sinon.spy() };
            const event = { origin: window.location.origin, data: { type: 'kasm_ports' } };
            secondary._handleWindowMessage(event);
            expect(secondary._primaryLink.handleWindowMessage).to.have.been.calledOnceWith(event);
            secondary._handleWindowMessage({ origin: 'https://evil.example.com', data: { type: 'kasm_ports' } });
            expect(secondary._primaryLink.handleWindowMessage).to.have.been.calledOnce;
        });
    });

    describe('broadcast', function () {
        it('only reaches links that have registered a screen', function () {
            const registered = { windowId: 'w1', screenID: 'sec-1', port: { postMessage: sinon.spy() } };
            const pending = { windowId: 'w2', screenID: null, port: { postMessage: sinon.spy() } };
            rfb._links._links = new Map([['w1', registered], ['w2', pending]]);
            rfb._postControlMessage({ eventType: 'receivedClipboard', args: [] });
            expect(registered.port.postMessage).to.have.been.calledOnce;
            expect(pending.port.postMessage).to.not.have.been.called;
        });

        it('tells a link that never registered a screen when this display goes away', function () {
            const unregistered = { windowId: 'w1', screenID: null, port: { postMessage: sinon.spy() } };
            const registered = { windowId: 'w2', screenID: 'sec-2', port: { postMessage: sinon.spy() } };
            rfb._links._links = new Map([['w1', unregistered], ['w2', registered]]);
            for (const eventType of ['disconnect', 'terminate', 'secondarydisconnected']) {
                rfb._postControlMessage({ eventType });
            }
            expect(unregistered.port.postMessage).to.have.been.calledThrice;
            expect(registered.port.postMessage).to.have.been.calledThrice;
            rfb._postControlMessage({ eventType: 'receivedClipboard' });
            expect(unregistered.port.postMessage).to.have.been.calledThrice;
            expect(registered.port.postMessage).to.have.callCount(4);
        });
    });

    describe('with a relay', function () {
        let relay;
        const T1 = 'a'.repeat(32), K1 = 'b'.repeat(32), T2 = 'e'.repeat(32);
        const posted = type => relay.port.postMessage.getCalls().map(c => c.args[0]).filter(m => m.type === type);

        beforeEach(function () {
            relay = { port: { postMessage: sinon.spy(), close: sinon.spy() } };
            rfb._links._storeKey = () => 'kasm_relay_rooms:/test';
            Object.assign(rfb._links, { _relay: relay, _tokens: new Map(), _keys: new Map(), _grace: new Map(),
                                        _links: new Map(), _windows: new Map() });
            rfb._links._windows.set('w1', { closed: true, postMessage: sinon.spy() });
        });
        afterEach(function () { window.sessionStorage.removeItem('kasm_relay_rooms:/test'); });

        const linked = (token) => {
            const closer = { close: sinon.spy() };
            const l = { windowId: 'w1', screenID: 'sec-1', token, pendingToken: null,
                        port: Object.assign({ postMessage: sinon.spy() }, closer), channel: closer, encodedFramePort: closer };
            rfb._links._tokens.set(token, 'w1');
            rfb._links._keys.set(token, K1);
            return l;
        };

        const accepting = () => {
            const screens = [{ screenID: 'primary' }];
            rfb._display = Object.assign(rfb._display || {}, {
                screens, addScreen: (spec) => { screens.push({ screenID: spec.screenID }); return false; },
                getServerRelativeCoordinates: () => [0, 0],
            });
            rfb._proxyRFBMessage = () => {};
            rfb._sendEncodings = () => {};
            rfb.dispatchEvent = () => {};
        };

        const refusing = () => {
            rfb._display = Object.assign(rfb._display || {}, {
                screens: [{ screenID: 'primary' }], addScreen: () => false,
                getServerRelativeCoordinates: () => [0, 0],
            });
        };

        it('starts the grace period when a linked window unregisters', function () {
            const l = linked(T1);
            rfb._links._links.set('w1', l);
            display.removeScreen = () => false;
            send({ eventType: 'unregister', screenID: 'sec-1' }, l);
            expect(rfb._links._grace.has('w1')).to.be.true;
            expect(rfb._links._links.has('w1')).to.be.false;
        });

        it('removes the screen before it drops the link, so queued rects still have a port to go to', function () {
            const l = linked(T1);
            rfb._links._links.set('w1', l);
            let linkedWhenRemoved;
            display.removeScreen = () => {
                linkedWhenRemoved = rfb._links._links.get('w1') === l;
                return false;
            };
            send({ eventType: 'unregister', screenID: 'sec-1' }, l);
            expect(linkedWhenRemoved).to.be.true;
            expect(rfb._links._links.has('w1')).to.be.false;
        });

        it('rotates when a popup registers its screen, but not for a popup linked through its opener', function () {
            const viaRelay = linked(T1);
            rfb._links._links.set('w1', viaRelay);
            display.addScreen = () => 1;
            display.screens = [{ screenID: 'primary' }, { screenID: 'sec-1' }, { screenID: 'sec-2' }];
            rfb._proxyRFBMessage = () => {};
            rfb._sendEncodings = () => {};
            rfb.dispatchEvent = () => {};
            viaRelay.screenID = null;
            send({ eventType: 'register', screenID: 'sec-1', details: {}, ...GEOMETRY }, viaRelay);
            expect(posted('register')).to.have.lengthOf(1);

            relay.port.postMessage.resetHistory();
            const viaOpener = { windowId: 'w2', screenID: null, token: null, port: { postMessage: sinon.spy() } };
            rfb._links._links.set('w2', viaOpener);
            send({ eventType: 'register', screenID: 'sec-2', details: {}, ...GEOMETRY }, viaOpener);
            expect(posted('register')).to.have.lengthOf(0);
        });

        it('acknowledges a rotation over the control path', function () {
            const l = linked(T1);
            l.pendingToken = T2;
            rfb._links._links.set('w1', l);
            send({ eventType: 'relayRotated', screenID: 'sec-1', token: T2 }, l);
            expect(l.token).to.equal(T2);
        });

        it('answers a liveness reply by keeping the link', function () {
            const l = linked(T1);
            l.probe = setTimeout(() => {}, 1000);
            rfb._links._links.set('w1', l);
            send({ eventType: 'relayAlive' }, l);
            expect(l.probe).to.equal(null);
        });

        it('tells the popups to disconnect before the state change drops their links', function () {
            const order = [];
            rfb._links.setLeaving(false);
            rfb._proxyRFBMessage = m => order.push('proxy:' + m);
            rfb._updateConnectionState = st => order.push('state:' + st);
            rfb._sock = { off() {} };
            rfb.disconnect();
            expect(order).to.deep.equal(['proxy:disconnect', 'state:disconnecting']);

            order.length = 0;
            rfb.terminate();
            expect(order).to.deep.equal(['proxy:terminate', 'state:disconnecting']);
            expect(rfb._links._deliberate).to.be.true;
        });

        it('does not tell the popups to disconnect while the page is only reloading', function () {
            const sent = [];
            rfb._links.setLeaving(true);
            rfb._proxyRFBMessage = m => sent.push(m);
            rfb._updateConnectionState = () => {};
            rfb._sock = { off() {} };
            rfb.disconnect();
            rfb._links.setLeaving(false);
            expect(sent).to.deep.equal([]);
            expect(rfb._links._deliberate).to.be.false;
        });

        it('does not let a popup register the primary\'s own screen id', function () {
            const l = linked(T1);
            l.screenID = null;
            display.screens = [{ screenID: 'primary-screen' }];
            display.addScreen = sinon.spy();
            send({ eventType: 'register', screenID: 'primary-screen', details: {}, ...GEOMETRY }, l);
            expect(display.addScreen).to.not.have.been.called;
            expect(l.screenID).to.be.null;
        });

        it('keeps a relay link whose window registered a screen in time', function () {
            const clock = sinon.useFakeTimers();
            try {
                rfb._links._tokens.set(T1, 'w1');
                rfb._links._keys.set(T1, K1);
                accepting();
                rfb._links.rotateToken = () => {};
                rfb._links._windows.set('w1', { closed: false, postMessage: sinon.spy() });
                rfb._links._link('w1', rfb._links._windows.get('w1'), T1, 1);
                const l = rfb._links._links.get('w1');
                send({ eventType: 'register', screenID: 'sec-9', details: {}, ...GEOMETRY }, l);
                clock.tick(60000);
                expect(rfb._links._links.get('w1')).to.equal(l);
            } finally {
                clock.restore();
            }
        });

        it('still drops a relay link whose first registration was refused', function () {
            const clock = sinon.useFakeTimers();
            try {
                rfb._links._tokens.set(T1, 'w1');
                rfb._links._keys.set(T1, K1);
                refusing();
                rfb._links._link('w1', rfb._links._windows.get('w1'), T1, 1);
                const l = rfb._links._links.get('w1');
                send({ eventType: 'register', screenID: 'sec-9', details: {}, ...GEOMETRY }, l);
                expect(l.screenID).to.equal(null);
                clock.tick(30001);
                expect(rfb._links._links.get('w1')).to.equal(undefined);
            } finally {
                clock.restore();
            }
        });

        it('still drops a relay link whose reattach was refused', function () {
            const clock = sinon.useFakeTimers();
            try {
                rfb._links._tokens.set(T1, 'w1');
                rfb._links._keys.set(T1, K1);
                refusing();
                rfb._links._link('w1', rfb._links._windows.get('w1'), T1, 1);
                const l = rfb._links._links.get('w1');
                send({ eventType: 'reattach', screenID: 'sec-9', ...GEOMETRY }, l);
                expect(l.screenID).to.equal(null);
                clock.tick(30001);
                expect(rfb._links._links.get('w1')).to.equal(undefined);
            } finally {
                clock.restore();
            }
        });

        it('lets go of a link that goes away before it registered a screen', function () {
            const l = linked(T1);
            l.screenID = null;
            rfb._links._links.set('w1', l);
            send({ eventType: 'unregister', screenID: 'whatever' }, l);
            expect(rfb._links._links.get('w1')).to.equal(undefined);
            expect(rfb._links._grace.has('w1')).to.be.true;
        });
    });

    describe('popup side', function () {
        let secondary, primaryLink, port;

        beforeEach(function () {
            secondary = Object.create(P);
            port = { close: sinon.spy(), postMessage: sinon.spy() };
            primaryLink = new PrimaryLink({
                supportsMultiMonitor: () => true,
                handleControlMessage: () => {},
                attachPorts: () => {},
                reregister: () => {},
                dispatch: event => secondary.dispatchEvent(event),
            });
            primaryLink._port = port;
            primaryLink.request = sinon.spy();
            Object.assign(secondary, {
                _isPrimaryDisplay: false, _supportsMultiMonitor: true, _primaryLink: primaryLink,
                dispatchEvent: sinon.spy(), _display: { screenID: 'sec-1' },
            });
        });

        const events = () => secondary.dispatchEvent.getCalls().map(c => c.args[0].type);

        it('does not look for a primary again once the window is ending', function () {
            primaryLink.markEnding();
            secondary._handleControlMessage({ data: { eventType: 'secondarydisconnected' } });
            expect(events()).to.not.include('secondarydisconnected');
            expect(primaryLink._relinking).to.be.false;
            primaryLink._ending = false;
            secondary._handleControlMessage({ data: { eventType: 'secondarydisconnected' } });
            expect(events()).to.include('secondarydisconnected');
        });

        it('starts looking when the primary says it is disconnecting', function () {
            const clock = sinon.useFakeTimers();
            try {
                secondary._handleControlMessage({ data: { eventType: 'secondarydisconnected' } });
                expect(events()).to.include('secondarydisconnected');
                expect(primaryLink._relinking).to.be.true;
            } finally {
                primaryLink.close();
                clock.restore();
            }
        });

        it('stops looking and reports it when the primary disconnects on purpose', function () {
            secondary.disconnect = sinon.spy();
            secondary._handleControlMessage({ data: { eventType: 'disconnect' } });
            expect(secondary.disconnect).to.have.been.calledOnce;
            const ended = secondary.dispatchEvent.getCalls().map(c => c.args[0]).find(e => e.type === 'secondaryrelinkfailed');
            expect(ended).to.exist;
            expect(ended.detail.reason).to.equal('disconnected');
        });

        it('only runs the secondary teardown once', function () {
            secondary._secondaryDisconnected = false;
            secondary._updateConnectionState = sinon.spy();
            secondary._unregisterSecondaryDisplay = sinon.spy();
            secondary.disconnect();
            secondary.disconnect();
            expect(secondary._updateConnectionState).to.have.been.calledOnce;
            expect(secondary._unregisterSecondaryDisplay).to.have.been.calledOnce;
            expect(primaryLink.ending).to.be.true;
        });

        it('answers the primary\'s liveness probe', function () {
            secondary._handleControlMessage({ data: { eventType: 'relayProbe' } });
            expect(port.postMessage).to.have.been.calledWithMatch({ eventType: 'relayAlive', screenID: 'sec-1' });
        });

        it('swaps the token in its URL when the primary rotates it', function () {
            const before = window.location.href;
            const next = 'f'.repeat(32);
            try {
                secondary._handleControlMessage({ data: { eventType: 'relayRotate', token: next } });
                expect(window.location.hash).to.equal('#' + next);
                expect(port.postMessage).to.have.been.calledWithMatch(
                    { eventType: 'relayRotated', screenID: 'sec-1', token: next });
                port.postMessage.resetHistory();
                secondary._handleControlMessage({ data: { eventType: 'relayRotate', token: 'nope' } });
                expect(window.location.hash).to.equal('#' + next);
                expect(port.postMessage).to.not.have.been.called;
            } finally {
                window.history.replaceState(window.history.state, '', before);
            }
        });
    });
});
