const expect = chai.expect;

import PrimaryLink from '../core/secondary/primary-link.js';

describe('Primary link (popup side)', function () {
    let clock, link, host, events;

    beforeEach(function () {
        clock = sinon.useFakeTimers();
        events = [];
        host = {
            supportsMultiMonitor: () => true,
            handleControlMessage: sinon.spy(),
            attachPorts: sinon.spy(),
            reregister: sinon.spy(),
            dispatch: sinon.spy(event => events.push(event)),
        };
        link = new PrimaryLink(host);
        link._port = { close: sinon.spy(), postMessage: sinon.spy() };
        link._queue = ['stale'];
        link.request = sinon.spy();
    });
    afterEach(function () { clock.restore(); });

    const types = () => events.map(e => e.type);

    it('sends over the link once it is attached', function () {
        link.post({ eventType: 'keyEvent', args: [65, 1] });
        expect(link._port.postMessage).to.have.been.calledOnceWith({ eventType: 'keyEvent', args: [65, 1] });
    });

    it('closes the dead link, drops queued input and looks for the new primary', function () {
        const dead = link._port;
        link.startRelink();
        expect(dead.close).to.have.been.calledOnce;
        expect(link._port).to.equal(null);
        expect(link._queue).to.deep.equal([]);
        clock.tick(1000);
        expect(link.request).to.have.been.calledOnce;
        clock.tick(5000);
        expect(link.request).to.have.been.calledTwice;
    });

    it('does not queue input while it is unlinked', function () {
        link._port = null;
        link.startRelink();
        link.post({ eventType: 'keyEvent', args: [65, 1] });
        expect(link._queue).to.deep.equal([]);
    });

    it('registers its screen with the new primary once linked', function () {
        link.startRelink();
        link.attach([{}, {}, {}]);
        expect(host.attachPorts).to.have.been.calledOnce;
        expect(host.reregister).to.have.been.calledOnce;
        expect(types()).to.include('connect');
        expect(link._relinking).to.be.false;
        clock.tick(60000);
        expect(link.request.callCount).to.equal(0);
    });

    it('sends what was queued before the ports arrived', function () {
        link._port = null;
        link._queue = [{ eventType: 'register', width: 1 }];
        const port = { postMessage: sinon.spy() };
        link.attach([port, {}, {}]);
        expect(port.postMessage).to.have.been.calledOnceWith({ eventType: 'register', width: 1 });
        expect(link._queue).to.deep.equal([]);
    });

    describe('requesting a primary display', function () {
        let original, originalWorker, originalUrl;
        const request = () => PrimaryLink.prototype.request.call(link);
        const setOpener = value => Object.defineProperty(window, 'opener', { value, configurable: true });

        beforeEach(function () {
            original = Object.getOwnPropertyDescriptor(window, 'opener');
            originalWorker = window.SharedWorker;
            window.SharedWorker = undefined;
            originalUrl = window.location.href;
            window.history.replaceState(null, '', '?windowId=win-1#' + 'a'.repeat(32));
        });

        afterEach(function () {
            if (original) {
                Object.defineProperty(window, 'opener', original);
            } else {
                delete window.opener;
            }
            window.SharedWorker = originalWorker;
            window.history.replaceState(null, '', originalUrl);
        });

        it('asks a live opener directly', function () {
            const opener = { closed: false, postMessage: sinon.spy() };
            setOpener(opener);
            request();
            expect(opener.postMessage).to.have.been.calledOnce;
        });

        it('does not post to a closed opener', function () {
            const opener = { closed: true, postMessage: sinon.spy() };
            setOpener(opener);
            request();
            expect(opener.postMessage).to.not.have.been.called;
        });
    });

    it('refuses ports that are not exactly three', function () {
        link._port = null;
        const ports = [{ close: sinon.spy() }, { close: sinon.spy() }];
        link.attach(ports);
        expect(link._port).to.equal(null);
        expect(host.attachPorts).to.not.have.been.called;
        expect(ports[0].close).to.have.been.calledOnce;
        expect(ports[1].close).to.have.been.calledOnce;
    });

    it('closes ports it refuses because it is already attached', function () {
        const ports = [{ close: sinon.spy() }, { close: sinon.spy() }, { close: sinon.spy() }];
        link.attach(ports);
        for (const port of ports) {
            expect(port.close).to.have.been.calledOnce;
        }
    });

    it('gives up after about three minutes', function () {
        link.startRelink();
        clock.tick(200000);
        expect(types()).to.deep.equal(['secondaryrelinkfailed']);
        const calls = link.request.callCount;
        clock.tick(60000);
        expect(link.request.callCount).to.equal(calls);
    });

    it('does not start looking again once it is ending', function () {
        link.markEnding();
        link.startRelink();
        expect(link._relinking).to.be.false;
        clock.tick(10000);
        expect(link.request.callCount).to.equal(0);
    });

    it('does not start a second search while one is running', function () {
        link.startRelink();
        link.startRelink();
        clock.tick(1000);
        expect(link.request).to.have.been.calledOnce;
    });

    it('queues only registration messages while unlinked, never input', function () {
        link._port = null;
        link._queue = [];
        link.post({ eventType: 'register' });
        link.post({ eventType: 'mousemove', args: [1, 2, 0, false] });
        link.post({ eventType: 'keyEvent', args: [65, 1] });
        link.post({ eventType: 'sendBinaryClipboard', args: [] });
        link.post({ eventType: 'reattach' });
        expect(link._queue.map(m => m.eventType)).to.deep.equal(['register']);
    });

    it('queues nothing when the browser has no multi monitor support', function () {
        host.supportsMultiMonitor = () => false;
        link._port = null;
        link._queue = [];
        link.post({ eventType: 'register' });
        expect(link._queue).to.deep.equal([]);
    });

    it('keeps only the latest registration while unlinked and drops it on unregister', function () {
        link._port = null;
        link._queue = [];
        link.post({ eventType: 'register', width: 100 });
        link.post({ eventType: 'reattach', width: 200 });
        link.post({ eventType: 'reattach', width: 300 });
        expect(link._queue).to.have.lengthOf(1);
        expect(link._queue[0].eventType).to.equal('register');
        expect(link._queue[0].width).to.equal(300);
        link.post({ eventType: 'unregister' });
        expect(link._queue).to.deep.equal([]);
    });

    it('ignores ports that arrive after it gave up looking for the primary', function () {
        link._relay = { port: { close: sinon.spy(), onmessage: () => {} } };
        link.startRelink();
        clock.tick(40 * 5000 + 2000);
        expect(types()).to.include('secondaryrelinkfailed');
        expect(link.ending).to.be.true;
        const late = [{ close: sinon.spy() }, { close: sinon.spy() }, { close: sinon.spy() }];
        link.attach(late);
        expect(link._port).to.equal(null);
        expect(late[0].close).to.have.been.calledOnce;
    });

    it('only takes ports from the window that opened it', function () {
        link._port = null;
        link.handleWindowMessage({ data: { type: 'kasm_ports' }, source: {}, ports: [{}, {}, {}] });
        expect(link._port).to.equal(null);
        link.handleWindowMessage({ data: { type: 'something_else' }, source: window.opener, ports: [{}, {}, {}] });
        expect(link._port).to.equal(null);
    });

    it('stops everything when it is closed', function () {
        const relay = { port: { close: sinon.spy(), onmessage: () => {} } };
        link._relay = relay;
        const port = link._port;
        link.startRelink();
        link.close();
        clock.tick(60000);
        expect(link.request.callCount).to.equal(0);
        expect(link._relinking).to.be.false;
        expect(relay.port.close).to.have.been.calledOnce;
        expect(link._relay).to.equal(null);
        expect(port.close).to.have.been.calledOnce;
    });

    it('closes an attached link when it is closed', function () {
        const port = link._port;
        link.close();
        expect(port.close).to.have.been.calledOnce;
        expect(link._port).to.equal(null);
    });
});
