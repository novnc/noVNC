import RFB from '../core/rfb.js';
import Websock from '../core/websock.js';
import ZStream from "../vendor/pako/lib/zlib/zstream.js";
import { deflateInit, deflate, Z_DEFAULT_COMPRESSION } from "../vendor/pako/lib/zlib/deflate.js";
import { encodings } from '../core/encodings.js';
import { toUnsigned32bit } from '../core/util/int.js';
import { encodeUTF8 } from '../core/util/strings.js';
import KeyTable from '../core/input/keysym.js';
import legacyCrypto from '../core/crypto/crypto.js';

import FakeWebSocket from './fake.websocket.js';

function push8(arr, num) {
    "use strict";
    arr.push(num & 0xFF);
}

function push16(arr, num) {
    "use strict";
    arr.push((num >> 8) & 0xFF,
             num & 0xFF);
}

function push32(arr, num) {
    "use strict";
    arr.push((num >> 24) & 0xFF,
             (num >> 16) & 0xFF,
             (num >>  8) & 0xFF,
             num & 0xFF);
}

function pushString(arr, string) {
    let utf8 = unescape(encodeURIComponent(string));
    for (let i = 0; i < utf8.length; i++) {
        arr.push(utf8.charCodeAt(i));
    }
}

function deflateWithSize(data) {
    // Adds the size of the string in front before deflating

    let unCompData = [];
    unCompData.push((data.length >> 24) & 0xFF,
                    (data.length >> 16) & 0xFF,
                    (data.length >>  8) & 0xFF,
                    (data.length & 0xFF));

    for (let i = 0; i < data.length; i++) {
        unCompData.push(data.charCodeAt(i));
    }

    let strm = new ZStream();
    let chunkSize = 1024 * 10 * 10;
    strm.output = new Uint8Array(chunkSize);
    deflateInit(strm, Z_DEFAULT_COMPRESSION);

    /* eslint-disable camelcase */
    strm.input = unCompData;
    strm.avail_in = strm.input.length;
    strm.next_in = 0;
    strm.next_out = 0;
    strm.avail_out = chunkSize;
    /* eslint-enable camelcase */

    deflate(strm, 3);

    return new Uint8Array(strm.output.buffer, 0, strm.next_out);
}

describe('Remote Frame Buffer protocol client', function () {
    let clock;
    let raf;
    let fakeResizeObserver = null;
    const realObserver = window.ResizeObserver;

    // Since we are using fake timers we don't actually want
    // to wait for the browser to observe the size change,
    // that's why we use a fake ResizeObserver
    class FakeResizeObserver {
        constructor(handler) {
            this.fire = handler;
            fakeResizeObserver = this;
        }
        disconnect() {}
        observe(target, options) {}
        unobserve(target) {}
    }

    before(FakeWebSocket.replace);
    after(FakeWebSocket.restore);

    before(function () {
        this.clock = clock = sinon.useFakeTimers(Date.now());
        // sinon doesn't support this yet
        raf = window.requestAnimationFrame;
        window.requestAnimationFrame = setTimeout;
        // We must do this in a 'before' since it needs to be set before
        // the RFB constructor, which runs in beforeEach further down
        window.ResizeObserver = FakeResizeObserver;
        // Use a single set of buffers instead of reallocating to
        // speed up tests
        const sock = new Websock();
        const _sQ = new Uint8Array(sock._sQbufferSize);
        const rQ = new Uint8Array(sock._rQbufferSize);

        Websock.prototype._oldAllocateBuffers = Websock.prototype._allocateBuffers;
        Websock.prototype._allocateBuffers = function () {
            this._sQ = _sQ;
            this._rQ = rQ;
        };

        // Avoiding printing the entire Websock buffer on errors
        Websock.prototype.inspect = function () { return "[object Websock]"; };
    });

    after(function () {
        Websock.prototype._allocateBuffers = Websock.prototype._oldAllocateBuffers;
        delete Websock.prototype.inspect;
        this.clock.restore();
        window.requestAnimationFrame = raf;
        window.ResizeObserver = realObserver;
    });

    let container;
    let rfbs;

    beforeEach(function () {
        // Create a container element for all RFB objects to attach to
        container = document.createElement('div');
        container.style.width = "100%";
        container.style.height = "100%";
        document.body.appendChild(container);

        // And track all created RFB objects
        rfbs = [];
    });
    afterEach(function () {
        // Make sure every created RFB object is properly cleaned up
        // or they might affect subsequent tests
        rfbs.forEach(function (rfb) {
            rfb.disconnect();
            expect(rfb._disconnect).to.have.been.called;
        });
        rfbs = [];

        document.body.removeChild(container);
        container = null;
    });

    function makeRFB(url, options) {
        url = url || 'wss://host:8675';
        const rfb = new RFB(container, url, options);
        clock.tick();
        rfb._sock._websocket._open();
        rfb._rfbConnectionState = 'connected';
        sinon.spy(rfb, "_disconnect");
        rfbs.push(rfb);
        return rfb;
    }

    function elementToClient(x, y, client) {
        let res = { x: 0, y: 0 };

        let bounds = client._canvas.getBoundingClientRect();

        /*
         * If the canvas is on a fractional position we will calculate
         * a fractional mouse position. But that gets truncated when we
         * send the event, AND the same thing happens in RFB when it
         * generates the PointerEvent message. To compensate for that
         * fact we round the value upwards here.
         */
        res.x = Math.ceil(bounds.left + x);
        res.y = Math.ceil(bounds.top + y);

        return res;
    }

    function sendMouseMoveEvent(x, y, buttons, client) {
        let pos = elementToClient(x, y, client);
        let ev;

        ev = new MouseEvent('mousemove',
                            { 'screenX': pos.x + window.screenX,
                              'screenY': pos.y + window.screenY,
                              'clientX': pos.x,
                              'clientY': pos.y,
                              'buttons': buttons });
        client._canvas.dispatchEvent(ev);
    }

    function sendMouseButtonEvent(x, y, down, buttons, client) {
        let pos = elementToClient(x, y, client);
        let ev;

        ev = new MouseEvent(down ? 'mousedown' : 'mouseup',
                            { 'screenX': pos.x + window.screenX,
                              'screenY': pos.y + window.screenY,
                              'clientX': pos.x,
                              'clientY': pos.y,
                              'buttons': buttons});
        client._canvas.dispatchEvent(ev);
    }

    function gestureStart(gestureType, x, y, client,
                          magnitudeX = 0, magnitudeY = 0) {
        let pos = elementToClient(x, y, client);
        let detail = { type: gestureType, clientX: pos.x, clientY: pos.y };

        detail.magnitudeX = magnitudeX;
        detail.magnitudeY = magnitudeY;

        let ev = new CustomEvent('gesturestart', { detail: detail });
        client._canvas.dispatchEvent(ev);
    }

    function gestureMove(gestureType, x, y, client,
                         magnitudeX = 0, magnitudeY = 0) {
        let pos = elementToClient(x, y, client);
        let detail = { type: gestureType, clientX: pos.x, clientY: pos.y };

        detail.magnitudeX = magnitudeX;
        detail.magnitudeY = magnitudeY;

        let ev = new CustomEvent('gesturemove', { detail: detail }, client);
        client._canvas.dispatchEvent(ev);
    }

    function gestureEnd(gestureType, x, y, client) {
        let pos = elementToClient(x, y, client);
        let detail = { type: gestureType, clientX: pos.x, clientY: pos.y };
        let ev = new CustomEvent('gestureend', { detail: detail });
        client._canvas.dispatchEvent(ev);
    }

    function sendFbuMsg(rectInfo, rectData, client, rectCnt) {
        let data = [];

        if (!rectCnt || rectCnt > -1) {
            // header
            data.push(0);  // msg type
            data.push(0);  // padding
            push16(data, rectCnt || rectData.length);
        }

        for (let i = 0; i < rectData.length; i++) {
            if (rectInfo[i]) {
                push16(data, rectInfo[i].x);
                push16(data, rectInfo[i].y);
                push16(data, rectInfo[i].width);
                push16(data, rectInfo[i].height);
                push32(data, rectInfo[i].encoding);
            }
            data = data.concat(rectData[i]);
        }

        client._sock._websocket._receiveData(new Uint8Array(data));
    }

    function sendExtendedDesktopSize(client, reason, result, width, height, screenId, screenFlags) {
        let rectInfo = { x: reason, y: result, width: width, height: height, encoding: -308 };
        let rectData = [
            0x01,        // number of screens = 1
            0x00, 0x00,
            0x00,        // padding
            (screenId >> 24) & 0xff,
            (screenId >> 16) & 0xff,
            (screenId >> 8) & 0xff,
            screenId & 0xff,
            0x00, 0x00,  // screen x
            0x00, 0x00,  // screen y
            (width >> 8) & 0xff,
            width & 0xff,
            (height >> 8) & 0xff,
            height & 0xff,
            (screenFlags >> 24) & 0xff,
            (screenFlags >> 16) & 0xff,
            (screenFlags >> 8) & 0xff,
            screenFlags & 0xff];
        sendFbuMsg([rectInfo], [rectData], client);
    }

    describe('Connecting/Disconnecting', function () {
        describe('#RFB (constructor)', function () {
            let open, attach;
            beforeEach(function () {
                open = sinon.spy(Websock.prototype, 'open');
                attach = sinon.spy(Websock.prototype, 'attach');
            });
            afterEach(function () {
                open.restore();
                attach.restore();
            });

            it('should actually connect to the websocket', function () {
                new RFB(document.createElement('div'), 'ws://HOST:8675/PATH');
                expect(open).to.have.been.calledOnceWithExactly('ws://HOST:8675/PATH', []);
            });

            it('should pass on connection problems', function () {
                open.restore();
                open = sinon.stub(Websock.prototype, 'open');
                open.throws(new Error('Failure'));
                expect(() => new RFB(document.createElement('div'), 'ws://HOST:8675/PATH')).to.throw('Failure');
            });

            it('should handle WebSocket/RTCDataChannel objects', function () {
                let sock = new FakeWebSocket('ws://HOST:8675/PATH', []);
                new RFB(document.createElement('div'), sock);
                expect(open).to.not.have.been.called;
                expect(attach).to.have.been.calledOnceWithExactly(sock);
            });

            it('should handle already open WebSocket/RTCDataChannel objects', function () {
                let sock = new FakeWebSocket('ws://HOST:8675/PATH', []);
                sock._open();
                const client = new RFB(document.createElement('div'), sock);
                let callback = sinon.spy();
                client.addEventListener('disconnect', callback);
                expect(open).to.not.have.been.called;
                expect(attach).to.have.been.calledOnceWithExactly(sock);
                // Check if it is ready for some data
                sock._receiveData(new Uint8Array(['R', 'F', 'B', '0', '0', '3', '0', '0', '8']));
                expect(callback).to.not.have.been.called;
            });

            it('should refuse closed WebSocket/RTCDataChannel objects', function () {
                let sock = new FakeWebSocket('ws://HOST:8675/PATH', []);
                sock.readyState = WebSocket.CLOSED;
                expect(() => new RFB(document.createElement('div'), sock)).to.throw();
            });

            it('should pass on attach problems', function () {
                attach.restore();
                attach = sinon.stub(Websock.prototype, 'attach');
                attach.throws(new Error('Failure'));
                let sock = new FakeWebSocket('ws://HOST:8675/PATH', []);
                expect(() => new RFB(document.createElement('div'), sock)).to.throw('Failure');
            });
        });

        describe('#disconnect', function () {
            let client;
            let close;

            beforeEach(function () {
                client = makeRFB();
                close = sinon.stub(Websock.prototype, "close");
            });
            afterEach(function () {
                close.restore();
            });

            it('should start closing WebSocket', function () {
                let callback = sinon.spy();
                client.addEventListener('disconnect', callback);
                client.disconnect();
                expect(close).to.have.been.calledOnceWithExactly();
                expect(callback).to.not.have.been.called;
            });

            it('should send disconnect event', function () {
                let callback = sinon.spy();
                client.addEventListener('disconnect', callback);
                client.disconnect();
                close.thisValues[0]._eventHandlers.close(new CloseEvent("close", { 'code': 1000, 'reason': "", 'wasClean': true }));
                expect(callback).to.have.been.calledOnce;
                expect(callback.args[0][0].detail.clean).to.be.true;
            });

            it('should force disconnect if disconnecting takes too long', function () {
                let callback = sinon.spy();
                client.addEventListener('disconnect', callback);
                client.disconnect();
                this.clock.tick(3 * 1000);
                expect(callback).to.have.been.calledOnce;
                expect(callback.args[0][0].detail.clean).to.be.true;
            });

            it('should not fail if disconnect completes before timeout', function () {
                let callback = sinon.spy();
                client.addEventListener('disconnect', callback);
                client.disconnect();
                client._updateConnectionState('disconnecting');
                this.clock.tick(3 * 1000 / 2);
                close.thisValues[0]._eventHandlers.close(new CloseEvent("close", { 'code': 1000, 'reason': "", 'wasClean': true }));
                this.clock.tick(3 * 1000 / 2 + 1);
                expect(callback).to.have.been.calledOnce;
                expect(callback.args[0][0].detail.clean).to.be.true;
            });

            it('should unregister error event handler', function () {
                sinon.spy(client._sock, 'off');
                client.disconnect();
                expect(client._sock.off).to.have.been.calledWith('error');
            });

            it('should unregister message event handler', function () {
                sinon.spy(client._sock, 'off');
                client.disconnect();
                expect(client._sock.off).to.have.been.calledWith('message');
            });

            it('should unregister open event handler', function () {
                sinon.spy(client._sock, 'off');
                client.disconnect();
                expect(client._sock.off).to.have.been.calledWith('open');
            });
        });
    });

    describe('Public API basic behavior', function () {
        let client;
        beforeEach(function () {
            client = makeRFB();
        });

        describe('#sendCtrlAlDel', function () {
            it('should sent ctrl[down]-alt[down]-del[down] then del[up]-alt[up]-ctrl[up]', function () {
                let esock = new Websock();
                let ews = new FakeWebSocket();
                ews._open();
                esock.attach(ews);
                RFB.messages.keyEvent(esock, 0xFFE3, 1);
                RFB.messages.keyEvent(esock, 0xFFE9, 1);
                RFB.messages.keyEvent(esock, 0xFFFF, 1);
                RFB.messages.keyEvent(esock, 0xFFFF, 0);
                RFB.messages.keyEvent(esock, 0xFFE9, 0);
                RFB.messages.keyEvent(esock, 0xFFE3, 0);
                let expected = ews._getSentData();

                client.sendCtrlAltDel();

                expect(client._sock).to.have.sent(expected);
            });

            it('should not send the keys if we are not in a normal state', function () {
                client._rfbConnectionState = "connecting";
                client.sendCtrlAltDel();
                expect(client._sock).to.have.sent(new Uint8Array([]));
            });

            it('should not send the keys if we are set as view_only', function () {
                client._viewOnly = true;
                client.sendCtrlAltDel();
                expect(client._sock).to.have.sent(new Uint8Array([]));
            });
        });

        describe('#sendKey', function () {
            it('should send a single key with the given code and state (down = true)', function () {
                let esock = new Websock();
                let ews = new FakeWebSocket();
                ews._open();
                esock.attach(ews);
                RFB.messages.keyEvent(esock, 123, 1);
                let expected = ews._getSentData();

                client.sendKey(123, 'Key123', true);

                expect(client._sock).to.have.sent(expected);
            });

            it('should send both a down and up event if the state is not specified', function () {
                let esock = new Websock();
                let ews = new FakeWebSocket();
                ews._open();
                esock.attach(ews);
                RFB.messages.keyEvent(esock, 123, 1);
                RFB.messages.keyEvent(esock, 123, 0);
                let expected = ews._getSentData();

                client.sendKey(123, 'Key123');

                expect(client._sock).to.have.sent(expected);
            });

            it('should not send the key if we are not in a normal state', function () {
                client._rfbConnectionState = "connecting";
                client.sendKey(123, 'Key123');
                expect(client._sock).to.have.sent(new Uint8Array([]));
            });

            it('should not send the key if we are set as view_only', function () {
                client._viewOnly = true;
                client.sendKey(123, 'Key123');
                expect(client._sock).to.have.sent(new Uint8Array([]));
            });

            it('should send QEMU extended events if supported', function () {
                client._qemuExtKeyEventSupported = true;
                let esock = new Websock();
                let ews = new FakeWebSocket();
                ews._open();
                esock.attach(ews);
                RFB.messages.QEMUExtendedKeyEvent(esock, 0x20, true, 0x0039);
                let expected = ews._getSentData();

                client.sendKey(0x20, 'Space', true);

                expect(client._sock).to.have.sent(expected);
            });

            it('should not send QEMU extended events if unknown key code', function () {
                client._qemuExtKeyEventSupported = true;
                let esock = new Websock();
                let ews = new FakeWebSocket();
                ews._open();
                esock.attach(ews);
                RFB.messages.keyEvent(esock, 123, 1);
                let expected = ews._getSentData();

                client.sendKey(123, 'FooBar', true);

                expect(client._sock).to.have.sent(expected);
            });
        });

        describe('#focus', function () {
            it('should move focus to canvas object', function () {
                sinon.spy(client._canvas, "focus");
                client.focus();
                expect(client._canvas.focus).to.have.been.calledOnce;
            });

            it('should include focus options', function () {
                sinon.spy(client._canvas, "focus");
                client.focus({ foobar: 12, gazonk: true });
                expect(client._canvas.focus).to.have.been.calledOnce;
                expect(client._canvas.focus).to.have.been.calledWith({ foobar: 12, gazonk: true});
            });
        });

        describe('#blur', function () {
            it('should remove focus from canvas object', function () {
                sinon.spy(client._canvas, "blur");
                client.blur();
                expect(client._canvas.blur).to.have.been.calledOnce;
            });
        });

        describe('#clipboardPasteFrom', function () {
            describe('Clipboard update handling', function () {
                beforeEach(function () {
                    sinon.spy(RFB.messages, 'clientCutText');
                    sinon.spy(RFB.messages, 'extendedClipboardNotify');
                });

                afterEach(function () {
                    RFB.messages.clientCutText.restore();
                    RFB.messages.extendedClipboardNotify.restore();
                });

                it('should send the given text in an clipboard update', function () {
                    client.clipboardPasteFrom('abc');

                    expect(RFB.messages.clientCutText).to.have.been.calledOnce;
                    expect(RFB.messages.clientCutText).to.have.been.calledWith(client._sock,
                                                                               new Uint8Array([97, 98, 99]));
                });

                it('should mask unsupported characters', function () {
                    client.clipboardPasteFrom('abc€');

                    expect(RFB.messages.clientCutText).to.have.been.calledOnce;
                    expect(RFB.messages.clientCutText).to.have.been.calledWith(client._sock,
                                                                               new Uint8Array([97, 98, 99, 63]));
                });

                it('should mask characters, not UTF-16 code points', function () {
                    client.clipboardPasteFrom('😂');

                    expect(RFB.messages.clientCutText).to.have.been.calledOnce;
                    expect(RFB.messages.clientCutText).to.have.been.calledWith(client._sock,
                                                                               new Uint8Array([63]));
                });

                it('should send an notify if extended clipboard is supported by server', function () {
                    // Send our capabilities
                    let data = [3, 0, 0, 0];
                    const flags = [0x1F, 0x00, 0x00, 0x01];
                    let fileSizes = [0x00, 0x00, 0x00, 0x1E];

                    push32(data, toUnsigned32bit(-8));
                    data = data.concat(flags);
                    data = data.concat(fileSizes);
                    client._sock._websocket._receiveData(new Uint8Array(data));

                    client.clipboardPasteFrom('extended test');
                    expect(RFB.messages.extendedClipboardNotify).to.have.been.calledOnce;
                });
            });

            it('should flush multiple times for large clipboards', function () {
                sinon.spy(client._sock, 'flush');
                let longText = "";
                for (let i = 0; i < client._sock._sQbufferSize + 100; i++) {
                    longText += 'a';
                }
                client.clipboardPasteFrom(longText);
                expect(client._sock.flush).to.have.been.calledTwice;
            });

            it('should not send the text if we are not in a normal state', function () {
                sinon.spy(client._sock, 'flush');
                client._rfbConnectionState = "connecting";
                client.clipboardPasteFrom('abc');
                expect(client._sock.flush).to.not.have.been.called;
            });
        });

        describe("XVP operations", function () {
            beforeEach(function () {
                client._rfbXvpVer = 1;
            });

            it('should send the shutdown signal on #machineShutdown', function () {
                client.machineShutdown();
                expect(client._sock).to.have.sent(new Uint8Array([0xFA, 0x00, 0x01, 0x02]));
            });

            it('should send the reboot signal on #machineReboot', function () {
                client.machineReboot();
                expect(client._sock).to.have.sent(new Uint8Array([0xFA, 0x00, 0x01, 0x03]));
            });

            it('should send the reset signal on #machineReset', function () {
                client.machineReset();
                expect(client._sock).to.have.sent(new Uint8Array([0xFA, 0x00, 0x01, 0x04]));
            });

            it('should not send XVP operations with higher versions than we support', function () {
                sinon.spy(client._sock, 'flush');
                client._xvpOp(2, 7);
                expect(client._sock.flush).to.not.have.been.called;
            });
        });
    });

    describe('Clipping', function () {
        let client;

        beforeEach(function () {
            client = makeRFB();
            container.style.width = '70px';
            container.style.height = '80px';
            client.clipViewport = true;
        });

        it('should update display clip state when changing the property', function () {
            const spy = sinon.spy(client._display, "clipViewport", ["set"]);

            client.clipViewport = false;
            expect(spy.set).to.have.been.calledOnce;
            expect(spy.set).to.have.been.calledWith(false);
            spy.set.resetHistory();

            client.clipViewport = true;
            expect(spy.set).to.have.been.calledOnce;
            expect(spy.set).to.have.been.calledWith(true);
        });

        it('should update the viewport when the container size changes', function () {
            sinon.spy(client._display, "viewportChangeSize");

            container.style.width = '40px';
            container.style.height = '50px';
            fakeResizeObserver.fire();
            clock.tick(1000);

            expect(client._display.viewportChangeSize).to.have.been.calledOnce;
            expect(client._display.viewportChangeSize).to.have.been.calledWith(40, 50);
        });

        it('should update the viewport when the remote session resizes', function () {
            sinon.spy(client._display, "viewportChangeSize");

            // Simple ExtendedDesktopSize FBU message
            sendExtendedDesktopSize(client, 0, 0, 4, 4, 0x7890abcd, 0x12345678);
            // The resize will cause scrollbars on the container, this causes a
            // resize observation in the browsers
            fakeResizeObserver.fire();

            // FIXME: Display implicitly calls viewportChangeSize() when
            //        resizing the framebuffer, hence calledTwice.
            expect(client._display.viewportChangeSize).to.have.been.calledTwice;
            expect(client._display.viewportChangeSize).to.have.been.calledWith(70, 80);
        });

        it('should not update the viewport if not clipping', function () {
            client.clipViewport = false;
            sinon.spy(client._display, "viewportChangeSize");

            container.style.width = '40px';
            container.style.height = '50px';
            fakeResizeObserver.fire();
            clock.tick(1000);

            expect(client._display.viewportChangeSize).to.not.have.been.called;
        });

        it('should not update the viewport if scaling', function () {
            client.scaleViewport = true;
            sinon.spy(client._display, "viewportChangeSize");

            container.style.width = '40px';
            container.style.height = '50px';
            fakeResizeObserver.fire();
            clock.tick(1000);

            expect(client._display.viewportChangeSize).to.not.have.been.called;
        });

        describe('Clipping and remote resize', function () {
            beforeEach(function () {
                // Given a remote (100, 100) larger than the container (70x80),
                client._resize(100, 100);
                client._supportsSetDesktopSize = true;
                client.resizeSession = true;
                sinon.spy(RFB.messages, "setDesktopSize");
            });
            afterEach(function () {
                RFB.messages.setDesktopSize.restore();
            });
            it('should not change remote size when changing clipping', function () {
                // When changing clipping the scrollbars of the container
                // will appear and disappear and thus trigger resize observations
                client.clipViewport = false;
                fakeResizeObserver.fire();
                clock.tick(1000);
                client.clipViewport = true;
                fakeResizeObserver.fire();
                clock.tick(1000);

                // Then no resize requests should be sent
                expect(RFB.messages.setDesktopSize).to.not.have.been.called;
            });
        });

        describe('Dragging', function () {
            beforeEach(function () {
                client = makeRFB();
                client.dragViewport = true;
                client._display.resize(100, 100);

                sinon.spy(RFB.messages, "pointerEvent");
            });

            afterEach(function () {
                RFB.messages.pointerEvent.restore();
            });

            it('should not send button messages when initiating viewport dragging', function () {
                sendMouseButtonEvent(13, 9, true, 0x1, client);
                expect(RFB.messages.pointerEvent).to.not.have.been.called;
            });

            it('should send button messages when release without movement', function () {
                // Just up and down
                sendMouseButtonEvent(13, 9, true, 0x1, client);
                sendMouseButtonEvent(13, 9, false, 0x0, client);

                expect(RFB.messages.pointerEvent).to.have.been.calledTwice;
                expect(RFB.messages.pointerEvent.firstCall).to.have.been.calledWith(client._sock,
                                                                                    13, 9, 0x1);
                expect(RFB.messages.pointerEvent.secondCall).to.have.been.calledWith(client._sock,
                                                                                     13, 9, 0x0);
            });

            it('should send button messages when tapping', function () {
                // Just up and down
                gestureStart('onetap', 13, 9, client);
                gestureEnd('onetap', 13, 9, client);

                expect(RFB.messages.pointerEvent).to.have.been.calledThrice;
                expect(RFB.messages.pointerEvent.firstCall).to.have.been.calledWith(client._sock,
                                                                                    13, 9, 0x0);
                expect(RFB.messages.pointerEvent.secondCall).to.have.been.calledWith(client._sock,
                                                                                     13, 9, 0x1);
                expect(RFB.messages.pointerEvent.thirdCall).to.have.been.calledWith(client._sock,
                                                                                    13, 9, 0x0);
            });

            it('should send button messages when release with small movement', function () {
                // Small movement
                sendMouseButtonEvent(13, 9, true, 0x1, client);
                sendMouseMoveEvent(15, 14, 0x1, client);
                sendMouseButtonEvent(15, 14, false, 0x0, client);

                expect(RFB.messages.pointerEvent).to.have.been.calledTwice;
                expect(RFB.messages.pointerEvent.firstCall).to.have.been.calledWith(client._sock,
                                                                                    15, 14, 0x1);
                expect(RFB.messages.pointerEvent.secondCall).to.have.been.calledWith(client._sock,
                                                                                     15, 14, 0x0);
            });

            it('should not send button messages when in view only', function () {
                client._viewOnly = true;

                sendMouseButtonEvent(13, 9, true, 0x1, client);
                sendMouseButtonEvent(13, 9, false, 0x0, client);

                expect(RFB.messages.pointerEvent).to.not.have.been.called;
            });

            it('should send button message directly when drag is disabled', function () {
                client.dragViewport = false;
                sendMouseButtonEvent(13, 9, true, 0x1, client);
                expect(RFB.messages.pointerEvent).to.have.been.calledOnce;
                expect(RFB.messages.pointerEvent.firstCall).to.have.been.calledWith(client._sock,
                                                                                    13, 9, 0x1);
            });

            it('should be initiate viewport dragging on sufficient movement', function () {
                sinon.spy(client._display, "viewportChangePos");

                // Too small movement
                sendMouseButtonEvent(13, 9, true, 0x1, client);
                sendMouseMoveEvent(18, 9, 0x1, client);


                expect(RFB.messages.pointerEvent).to.not.have.been.called;
                expect(client._display.viewportChangePos).to.not.have.been.called;

                // Sufficient movement

                sendMouseMoveEvent(43, 9, 0x1, client);

                expect(RFB.messages.pointerEvent).to.not.have.been.called;
                expect(client._display.viewportChangePos).to.have.been.calledOnce;
                expect(client._display.viewportChangePos).to.have.been.calledWith(-30, 0);

                client._display.viewportChangePos.resetHistory();

                // Now a small movement should move right away

                sendMouseMoveEvent(43, 14, 0x1, client);

                expect(RFB.messages.pointerEvent).to.not.have.been.called;
                expect(client._display.viewportChangePos).to.have.been.calledOnce;
                expect(client._display.viewportChangePos).to.have.been.calledWith(0, -5);
            });

            it('should initiate viewport dragging on sufficient drag gesture movement', function () {
                sinon.spy(client._display, "viewportChangePos");

                // Sufficient movement
                gestureStart('drag', 13, 9, client);
                gestureMove('drag', 43, 9, client);

                expect(RFB.messages.pointerEvent).to.not.have.been.called;
                expect(client._display.viewportChangePos).to.have.been.calledOnce;
                expect(client._display.viewportChangePos).to.have.been.calledWith(-30, 0);

                client._display.viewportChangePos.resetHistory();
                RFB.messages.pointerEvent.resetHistory();

                // Now a small movement should move right away

                gestureMove('drag', 43, 14, client);
                gestureEnd('drag', 43, 14, client);

                expect(RFB.messages.pointerEvent).to.not.have.been.called;

                expect(client._display.viewportChangePos).to.have.been.calledOnce;
                expect(client._display.viewportChangePos).to.have.been.calledWith(0, -5);
            });

            it('should initiate viewport dragging on sufficient longpress gesture movement', function () {
                sinon.spy(client._display, "viewportChangePos");

                // A small movement below the threshold should not move.
                gestureStart('longpress', 13, 9, client);
                gestureMove('longpress', 14, 9, client);

                expect(RFB.messages.pointerEvent).to.not.have.been.called;
                expect(client._display.viewportChangePos).to.not.have.been.called;

                client._display.viewportChangePos.resetHistory();
                RFB.messages.pointerEvent.resetHistory();

                gestureMove('longpress', 43, 9, client);
                gestureEnd('longpress', 43, 9, client);

                expect(RFB.messages.pointerEvent).to.not.have.been.called;
                expect(client._display.viewportChangePos).to.have.been.calledOnce;
                expect(client._display.viewportChangePos).to.have.been.calledWith(-30, 0);
            });

            it('should send button messages on small longpress gesture movement', function () {
                sinon.spy(client._display, "viewportChangePos");

                // A small movement below the threshold should not move.
                gestureStart('longpress', 13, 9, client);
                gestureMove('longpress', 14, 10, client);

                expect(RFB.messages.pointerEvent).to.not.have.been.called;
                expect(client._display.viewportChangePos).to.not.have.been.called;

                client._display.viewportChangePos.resetHistory();
                RFB.messages.pointerEvent.resetHistory();

                gestureEnd('longpress', 14, 9, client);

                expect(RFB.messages.pointerEvent).to.have.been.calledThrice;
                expect(RFB.messages.pointerEvent.firstCall).to.have.been.calledWith(client._sock,
                                                                                    14, 9, 0x0);
                expect(RFB.messages.pointerEvent.secondCall).to.have.been.calledWith(client._sock,
                                                                                     14, 9, 0x4);
                expect(RFB.messages.pointerEvent.thirdCall).to.have.been.calledWith(client._sock,
                                                                                    14, 9, 0x0);

                expect(client._display.viewportChangePos).to.not.have.been.called;
            });

            it('should not send button messages when dragging ends', function () {
                // First the movement

                sendMouseButtonEvent(13, 9, true, 0x1, client);
                sendMouseMoveEvent(43, 9, 0x1, client);
                sendMouseButtonEvent(43, 9, false, 0x0, client);

                expect(RFB.messages.pointerEvent).to.not.have.been.called;
            });

            it('should terminate viewport dragging on a button up event', function () {
                // First the dragging movement

                sendMouseButtonEvent(13, 9, true, 0x1, client);
                sendMouseMoveEvent(43, 9, 0x1, client);
                sendMouseButtonEvent(43, 9, false, 0x0, client);

                // Another movement now should not move the viewport

                sinon.spy(client._display, "viewportChangePos");

                sendMouseMoveEvent(43, 59, 0x0, client);

                expect(client._display.viewportChangePos).to.not.have.been.called;
            });

            it('should flush move events when initiating viewport drag', function () {
                sendMouseMoveEvent(13, 9, 0x0, client);
                sendMouseMoveEvent(14, 9, 0x0, client);
                sendMouseButtonEvent(14, 9, true, 0x1, client);

                expect(RFB.messages.pointerEvent).to.have.been.calledTwice;
                expect(RFB.messages.pointerEvent.firstCall).to.have.been.calledWith(client._sock,
                                                                                    13, 9, 0x0);
                expect(RFB.messages.pointerEvent.secondCall).to.have.been.calledWith(client._sock,
                                                                                     14, 9, 0x0);

                RFB.messages.pointerEvent.resetHistory();

                clock.tick(100);

                expect(RFB.messages.pointerEvent).to.not.have.been.called;;
            });
        });
    });

    describe('Scaling', function () {
        let client;
        beforeEach(function () {
            client = makeRFB();
            container.style.width = '70px';
            container.style.height = '80px';
            client.scaleViewport = true;

            sendExtendedDesktopSize(client, 0, 0, 4, 4, 0x7890abcd, 0x12345678);
        });

        it('should update display scale factor when changing the property', function () {
            const spy = sinon.spy(client._display, "scale", ["set"]);
            sinon.spy(client._display, "autoscale");

            client.scaleViewport = false;
            expect(spy.set).to.have.been.calledOnce;
            expect(spy.set).to.have.been.calledWith(1.0);
            expect(client._display.autoscale).to.not.have.been.called;

            client.scaleViewport = true;
            expect(client._display.autoscale).to.have.been.calledOnce;
            expect(client._display.autoscale).to.have.been.calledWith(70, 80);
        });

        it('should update the clipping setting when changing the property', function () {
            client.clipViewport = true;

            const spy = sinon.spy(client._display, "clipViewport", ["set"]);

            client.scaleViewport = false;
            expect(spy.set).to.have.been.calledOnce;
            expect(spy.set).to.have.been.calledWith(true);

            spy.set.resetHistory();

            client.scaleViewport = true;
            expect(spy.set).to.have.been.calledOnce;
            expect(spy.set).to.have.been.calledWith(false);
        });

        it('should update the scaling when the container size changes', function () {
            sinon.spy(client._display, "autoscale");

            container.style.width = '40px';
            container.style.height = '50px';
            fakeResizeObserver.fire();
            clock.tick(1000);

            expect(client._display.autoscale).to.have.been.calledOnce;
            expect(client._display.autoscale).to.have.been.calledWith(40, 50);
        });

        it('should update the scaling resized back to initial size', function () {
            sinon.spy(client._display, "autoscale");

            container.style.width = '40px';
            container.style.height = '50px';
            fakeResizeObserver.fire();
            clock.tick(1000);

            expect(client._display.autoscale).to.have.been.calledOnce;
            expect(client._display.autoscale).to.have.been.calledWith(40, 50);
            client._display.autoscale.resetHistory();

            container.style.width = '70px';
            container.style.height = '80px';
            fakeResizeObserver.fire();
            clock.tick(1000);

            expect(client._display.autoscale).to.have.been.calledOnce;
            expect(client._display.autoscale).to.have.been.calledWith(70, 80);
            client._display.autoscale.resetHistory();
        });

        it('should update the scaling when the remote session resizes', function () {
            sinon.spy(client._display, "autoscale");

            sendExtendedDesktopSize(client, 0, 0, 4, 4, 0x7890abcd, 0x12345678);
            // The resize will cause scrollbars on the container, this causes a
            // resize observation in the browsers
            fakeResizeObserver.fire();

            expect(client._display.autoscale).to.have.been.calledOnce;
            expect(client._display.autoscale).to.have.been.calledWith(70, 80);
        });

        it('should not update the display scale factor if not scaling', function () {
            client.scaleViewport = false;

            sinon.spy(client._display, "autoscale");

            container.style.width = '40px';
            container.style.height = '50px';
            fakeResizeObserver.fire();
            clock.tick(1000);

            expect(client._display.autoscale).to.not.have.been.called;
        });
    });

    describe('Remote resize', function () {
        let client;
        beforeEach(function () {
            client = makeRFB();
            client.resizeSession = true;
            container.style.width = '70px';
            container.style.height = '80px';

            sinon.spy(RFB.messages, "setDesktopSize");

            sendExtendedDesktopSize(client, 0, 0, 4, 4, 0x7890abcd, 0x12345678);

            if (RFB.messages.setDesktopSize.calledOnce) {
                let width = RFB.messages.setDesktopSize.args[0][1];
                let height = RFB.messages.setDesktopSize.args[0][2];
                sendExtendedDesktopSize(client, 1, 0, width, height, 0x7890abcd, 0x12345678);
                RFB.messages.setDesktopSize.resetHistory();
                clock.tick(10000);
            }
        });

        afterEach(function () {
            RFB.messages.setDesktopSize.restore();
        });

        it('should only request a resize when turned on', function () {
            client.resizeSession = false;
            expect(RFB.messages.setDesktopSize).to.not.have.been.called;

            container.style.width = '40px';
            container.style.height = '50px';
            fakeResizeObserver.fire();
            expect(RFB.messages.setDesktopSize).to.not.have.been.called;

            client.resizeSession = true;
            expect(RFB.messages.setDesktopSize).to.have.been.calledOnce;
        });

        it('should request a resize when initially connecting', function () {
            // Create a new object that hasn't yet seen a
            // ExtendedDesktopSize rect
            client = makeRFB();
            client.resizeSession = true;
            container.style.width = '70px';
            container.style.height = '80px';

            // First message should trigger a resize

            sendExtendedDesktopSize(client, 0, 0, 4, 4, 0x7890abcd, 0x12345678);

            // It should match the current size of the container,
            // not the reported size from the server
            expect(RFB.messages.setDesktopSize).to.have.been.calledOnce;
            expect(RFB.messages.setDesktopSize).to.have.been.calledWith(
                sinon.match.object, 70, 80, 0x7890abcd, 0x12345678);

            sendExtendedDesktopSize(client, 1, 0, 70, 80, 0x7890abcd, 0x12345678);
            RFB.messages.setDesktopSize.resetHistory();

            // Second message should not trigger a resize

            sendExtendedDesktopSize(client, 0, 0, 4, 4, 0x7890abcd, 0x12345678);

            expect(RFB.messages.setDesktopSize).to.not.have.been.called;
        });

        it('should request a resize when the container resizes', function () {
            container.style.width = '40px';
            container.style.height = '50px';
            fakeResizeObserver.fire();

            expect(RFB.messages.setDesktopSize).to.have.been.calledOnce;
            expect(RFB.messages.setDesktopSize).to.have.been.calledWith(
                sinon.match.object, 40, 50, 0x7890abcd, 0x12345678);
        });

        it('should not request the same size twice', function () {
            container.style.width = '40px';
            container.style.height = '50px';
            fakeResizeObserver.fire();

            expect(RFB.messages.setDesktopSize).to.have.been.calledOnce;
            expect(RFB.messages.setDesktopSize).to.have.been.calledWith(
                sinon.match.object, 40, 50, 0x7890abcd, 0x12345678);

            // Server responds with the requested size 40x50
            sendExtendedDesktopSize(client, 1, 0, 40, 50, 0x7890abcd, 0x12345678);

            RFB.messages.setDesktopSize.resetHistory();

            // size is still 40x50
            clock.tick(1000);
            fakeResizeObserver.fire();

            expect(RFB.messages.setDesktopSize).to.not.have.been.called;
        });

        it('should request a resize when resized back to initial size', function () {
            container.style.width = '40px';
            container.style.height = '50px';
            fakeResizeObserver.fire();

            expect(RFB.messages.setDesktopSize).to.have.been.calledOnce;
            expect(RFB.messages.setDesktopSize).to.have.been.calledWith(
                sinon.match.object, 40, 50, 0x7890abcd, 0x12345678);

            sendExtendedDesktopSize(client, 1, 0, 40, 50, 0x7890abcd, 0x12345678);
            RFB.messages.setDesktopSize.resetHistory();

            clock.tick(1000);
            container.style.width = '70px';
            container.style.height = '80px';
            fakeResizeObserver.fire();

            expect(RFB.messages.setDesktopSize).to.have.been.calledOnce;
            expect(RFB.messages.setDesktopSize).to.have.been.calledWith(
                sinon.match.object, 70, 80, 0x7890abcd, 0x12345678);
        });

        it('should rate limit resizes', function () {
            container.style.width = '20px';
            container.style.height = '30px';
            fakeResizeObserver.fire();

            expect(RFB.messages.setDesktopSize).to.have.been.calledOnce;
            expect(RFB.messages.setDesktopSize).to.have.been.calledWith(
                sinon.match.object, 20, 30, 0x7890abcd, 0x12345678);

            sendExtendedDesktopSize(client, 1, 0, 20, 30, 0x7890abcd, 0x12345678);
            RFB.messages.setDesktopSize.resetHistory();

            clock.tick(20);

            container.style.width = '30px';
            container.style.height = '40px';
            fakeResizeObserver.fire();

            expect(RFB.messages.setDesktopSize).to.not.have.been.called;

            clock.tick(20);

            container.style.width = '40px';
            container.style.height = '50px';
            fakeResizeObserver.fire();

            expect(RFB.messages.setDesktopSize).to.not.have.been.called;

            clock.tick(80);

            expect(RFB.messages.setDesktopSize).to.have.been.calledOnce;
            expect(RFB.messages.setDesktopSize).to.have.been.calledWith(
                sinon.match.object, 40, 50, 0x7890abcd, 0x12345678);
        });

        it('should not have overlapping resize requests', function () {
            container.style.width = '40px';
            container.style.height = '50px';
            fakeResizeObserver.fire();

            expect(RFB.messages.setDesktopSize).to.have.been.calledOnce;

            RFB.messages.setDesktopSize.resetHistory();

            clock.tick(1000);
            container.style.width = '20px';
            container.style.height = '30px';
            fakeResizeObserver.fire();

            expect(RFB.messages.setDesktopSize).to.not.have.been.called;
        });

        it('should finalize any pending resizes', function () {
            container.style.width = '40px';
            container.style.height = '50px';
            fakeResizeObserver.fire();

            expect(RFB.messages.setDesktopSize).to.have.been.calledOnce;

            RFB.messages.setDesktopSize.resetHistory();

            clock.tick(1000);
            container.style.width = '20px';
            container.style.height = '30px';
            fakeResizeObserver.fire();

            expect(RFB.messages.setDesktopSize).to.not.have.been.called;

            // Server responds with the requested size 40x50
            sendExtendedDesktopSize(client, 1, 0, 40, 50, 0x7890abcd, 0x12345678);

            expect(RFB.messages.setDesktopSize).to.have.been.calledOnce;
            expect(RFB.messages.setDesktopSize).to.have.been.calledWith(
                sinon.match.object, 20, 30, 0x7890abcd, 0x12345678);
        });

        it('should not finalize any pending resize if not needed', function () {
            container.style.width = '40px';
            container.style.height = '50px';
            fakeResizeObserver.fire();

            expect(RFB.messages.setDesktopSize).to.have.been.calledOnce;

            RFB.messages.setDesktopSize.resetHistory();

            // Server responds with the requested size 40x50
            sendExtendedDesktopSize(client, 1, 0, 40, 50, 0x7890abcd, 0x12345678);

            expect(RFB.messages.setDesktopSize).to.not.have.been.called;
        });

        it('should not finalize any pending resizes on errors', function () {
            container.style.width = '40px';
            container.style.height = '50px';
            fakeResizeObserver.fire();

            expect(RFB.messages.setDesktopSize).to.have.been.calledOnce;

            RFB.messages.setDesktopSize.resetHistory();

            clock.tick(1000);
            container.style.width = '20px';
            container.style.height = '30px';
            fakeResizeObserver.fire();

            expect(RFB.messages.setDesktopSize).to.not.have.been.called;

            // Server failed the requested size 40x50
            sendExtendedDesktopSize(client, 1, 1, 40, 50, 0x7890abcd, 0x12345678);

            expect(RFB.messages.setDesktopSize).to.not.have.been.called;
        });

        it('should not resize when resize is disabled', function () {
            client._resizeSession = false;

            container.style.width = '40px';
            container.style.height = '50px';
            fakeResizeObserver.fire();

            expect(RFB.messages.setDesktopSize).to.not.have.been.called;
        });

        it('should not resize when resize is not supported', function () {
            client._supportsSetDesktopSize = false;

            container.style.width = '40px';
            container.style.height = '50px';
            fakeResizeObserver.fire();

            expect(RFB.messages.setDesktopSize).to.not.have.been.called;
        });

        it('should not resize when in view only mode', function () {
            client._viewOnly = true;

            container.style.width = '40px';
            container.style.height = '50px';
            fakeResizeObserver.fire();

            expect(RFB.messages.setDesktopSize).to.not.have.been.called;
        });

        it('should not try to override a server resize', function () {
            // Note that this will cause the browser to display scrollbars
            // since the framebuffer is 100x100 and the container is 70x80.
            // The usable space (clientWidth/clientHeight) will be even smaller
            // due to the scrollbars taking up space.
            sendExtendedDesktopSize(client, 0, 0, 100, 100, 0xabababab, 0x11223344);
            // The scrollbars cause the ResizeObserver to fire
            fakeResizeObserver.fire();

            expect(RFB.messages.setDesktopSize).to.not.have.been.called;

            // An actual size change must not be ignored afterwards
            container.style.width = '120px';
            container.style.height = '130px';
            fakeResizeObserver.fire();

            expect(RFB.messages.setDesktopSize).to.have.been.calledOnce;
            expect(RFB.messages.setDesktopSize).to.have.been.calledWith(
                sinon.match.object, 120, 130, 0xabababab, 0x11223344);
        });
    });

    describe('Misc internals', function () {
        describe('#_fail', function () {
            let client;
            beforeEach(function () {
                client = makeRFB();
            });

            it('should close the WebSocket connection', function () {
                sinon.spy(client._sock, 'close');
                client._fail();
                expect(client._sock.close).to.have.been.calledOnce;
            });

            it('should transition to disconnected', function () {
                sinon.spy(client, '_updateConnectionState');
                client._fail();
                this.clock.tick(2000);
                expect(client._updateConnectionState).to.have.been.called;
                expect(client._rfbConnectionState).to.equal('disconnected');
            });

            it('should set clean_disconnect variable', function () {
                client._rfbCleanDisconnect = true;
                client._rfbConnectionState = 'connected';
                client._fail();
                expect(client._rfbCleanDisconnect).to.be.false;
            });

            it('should result in disconnect event with clean set to false', function () {
                client._rfbConnectionState = 'connected';
                const spy = sinon.spy();
                client.addEventListener("disconnect", spy);
                client._fail();
                this.clock.tick(2000);
                expect(spy).to.have.been.calledOnce;
                expect(spy.args[0][0].detail.clean).to.be.false;
            });

        });
    });

    describe('Protocol initialization states', function () {
        let client;
        beforeEach(function () {
            client = makeRFB();
            client._rfbConnectionState = 'connecting';
        });

        function sendVer(ver, client) {
            const arr = new Uint8Array(12);
            for (let i = 0; i < ver.length; i++) {
                arr[i+4] = ver.charCodeAt(i);
            }
            arr[0] = 'R'; arr[1] = 'F'; arr[2] = 'B'; arr[3] = ' ';
            arr[11] = '\n';
            client._sock._websocket._receiveData(arr);
        }

        function sendSecurity(type, cl) {
            cl._sock._websocket._receiveData(new Uint8Array([1, type]));
        }

        describe('ProtocolVersion', function () {
            describe('version parsing', function () {
                it('should interpret version 003.003 as version 3.3', function () {
                    sendVer('003.003', client);
                    expect(client._rfbVersion).to.equal(3.3);
                });

                it('should interpret version 003.006 as version 3.3', function () {
                    sendVer('003.006', client);
                    expect(client._rfbVersion).to.equal(3.3);
                });

                it('should interpret version 003.889 as version 3.8', function () {
                    sendVer('003.889', client);
                    expect(client._rfbVersion).to.equal(3.8);
                });

                it('should interpret version 003.007 as version 3.7', function () {
                    sendVer('003.007', client);
                    expect(client._rfbVersion).to.equal(3.7);
                });

                it('should interpret version 003.008 as version 3.8', function () {
                    sendVer('003.008', client);
                    expect(client._rfbVersion).to.equal(3.8);
                });

                it('should interpret version 004.000 as version 3.8', function () {
                    sendVer('004.000', client);
                    expect(client._rfbVersion).to.equal(3.8);
                });

                it('should interpret version 004.001 as version 3.8', function () {
                    sendVer('004.001', client);
                    expect(client._rfbVersion).to.equal(3.8);
                });

                it('should interpret version 005.000 as version 3.8', function () {
                    sendVer('005.000', client);
                    expect(client._rfbVersion).to.equal(3.8);
                });

                it('should fail on an invalid version', function () {
                    let callback = sinon.spy();
                    client.addEventListener("disconnect", callback);

                    sendVer('002.000', client);

                    expect(callback).to.have.been.calledOnce;
                    expect(callback.args[0][0].detail.clean).to.be.false;
                });
            });

            it('should send back the interpreted version', function () {
                sendVer('004.000', client);

                const expectedStr = 'RFB 003.008\n';
                const expected = [];
                for (let i = 0; i < expectedStr.length; i++) {
                    expected[i] = expectedStr.charCodeAt(i);
                }

                expect(client._sock).to.have.sent(new Uint8Array(expected));
            });

            it('should transition to the Security state on successful negotiation', function () {
                sendVer('003.008', client);
                expect(client._rfbInitState).to.equal('Security');
            });

            describe('Repeater', function () {
                beforeEach(function () {
                    client = makeRFB('wss://host:8675', { repeaterID: "12345" });
                    client._rfbConnectionState = 'connecting';
                });

                it('should interpret version 000.000 as a repeater', function () {
                    sendVer('000.000', client);
                    expect(client._rfbVersion).to.equal(0);

                    const sentData = client._sock._websocket._getSentData();
                    expect(new Uint8Array(sentData.buffer, 0, 9)).to.array.equal(new Uint8Array([73, 68, 58, 49, 50, 51, 52, 53, 0]));
                    expect(sentData).to.have.length(250);
                });

                it('should handle two step repeater negotiation', function () {
                    sendVer('000.000', client);
                    sendVer('003.008', client);
                    expect(client._rfbVersion).to.equal(3.8);
                });
            });
        });

        describe('Security', function () {
            beforeEach(function () {
                sendVer('003.008\n', client);
                client._sock._websocket._getSentData();
            });

            it('should respect server preference order', function () {
                const authSchemes = [ 6, 79, 30, 188, 16, 6, 1 ];
                client._sock._websocket._receiveData(new Uint8Array(authSchemes));
                expect(client._sock).to.have.sent(new Uint8Array([30]));
            });

            it('should fail if there are no supported schemes', function () {
                let callback = sinon.spy();
                client.addEventListener("disconnect", callback);

                const authSchemes = [1, 32];
                client._sock._websocket._receiveData(new Uint8Array(authSchemes));

                expect(callback).to.have.been.calledOnce;
                expect(callback.args[0][0].detail.clean).to.be.false;
            });

            it('should fail with the appropriate message if no types are sent', function () {
                const failureData = [0, 0, 0, 0, 6, 119, 104, 111, 111, 112, 115];
                let callback = sinon.spy();
                client.addEventListener("securityfailure", callback);

                client._sock._websocket._receiveData(new Uint8Array(failureData));

                expect(callback).to.have.been.calledOnce;
                expect(callback.args[0][0].detail.status).to.equal(1);
                expect(callback.args[0][0].detail.reason).to.equal("whoops");
            });

            it('should transition to the Authentication state and continue on successful negotiation', function () {
                const authSchemes = [1, 2];
                sinon.spy(client, "_negotiateAuthentication");
                client._sock._websocket._receiveData(new Uint8Array(authSchemes));
                expect(client._rfbInitState).to.equal('Authentication');
                expect(client._negotiateAuthentication).to.have.been.calledOnce;
            });
        });

        describe('Legacy authentication', function () {
            it('should fail on auth scheme 0 (pre 3.7) with the given message', function () {
                const errMsg = "Whoopsies";
                const data = [0, 0, 0, 0];
                const errLen = errMsg.length;
                push32(data, errLen);
                for (let i = 0; i < errLen; i++) {
                    data.push(errMsg.charCodeAt(i));
                }

                sendVer('003.006\n', client);
                client._sock._websocket._getSentData();
                let callback = sinon.spy();
                client.addEventListener("securityfailure", callback);

                client._sock._websocket._receiveData(new Uint8Array(data));

                expect(callback).to.have.been.calledOnce;
                expect(callback.args[0][0].detail.status).to.equal(1);
                expect(callback.args[0][0].detail.reason).to.equal("Whoopsies");
            });

            it('should transition straight to ServerInitialisation on "no auth" for versions < 3.7', function () {
                sendVer('003.006\n', client);
                client._sock._websocket._getSentData();

                client._sock._websocket._receiveData(new Uint8Array([0, 0, 0, 1]));
                expect(client._rfbInitState).to.equal('ServerInitialisation');
            });

            it('should transition straight to ServerInitialisation on "no auth" for versions < 3.8', function () {
                sendVer('003.007\n', client);
                client._sock._websocket._getSentData();

                sendSecurity(1, client);
                expect(client._rfbInitState).to.equal('ServerInitialisation');
            });
        });

        describe('Authentication', function () {
            beforeEach(function () {
                sendVer('003.008\n', client);
                client._sock._websocket._getSentData();
            });

            it('should transition straight to SecurityResult on "no auth" (1)', function () {
                sendSecurity(1, client);
                expect(client._rfbInitState).to.equal('SecurityResult');
            });

            it('should fail on an unknown auth scheme', function () {
                let callback = sinon.spy();
                client.addEventListener("disconnect", callback);

                sendSecurity(57, client);

                expect(callback).to.have.been.calledOnce;
                expect(callback.args[0][0].detail.clean).to.be.false;
            });

            describe('VNC authentication (type 2) handler', function () {
                it('should fire the credentialsrequired event if missing a password', function () {
                    const spy = sinon.spy();
                    client.addEventListener("credentialsrequired", spy);
                    sendSecurity(2, client);

                    const challenge = [];
                    for (let i = 0; i < 16; i++) { challenge[i] = i; }
                    client._sock._websocket._receiveData(new Uint8Array(challenge));

                    expect(spy).to.have.been.calledOnce;
                    expect(spy.args[0][0].detail.types).to.have.members(["password"]);
                });

                it('should encrypt the password with DES and then send it back', function () {
                    client.addEventListener("credentialsrequired", () => {
                        client.sendCredentials({ password: 'passwd' });
                    });
                    sendSecurity(2, client);
                    client._sock._websocket._getSentData(); // skip the choice of auth reply

                    const challenge = [];
                    for (let i = 0; i < 16; i++) { challenge[i] = i; }
                    client._sock._websocket._receiveData(new Uint8Array(challenge));
                    clock.tick();

                    const desPass = RFB.genDES('passwd', challenge);
                    expect(client._sock).to.have.sent(new Uint8Array(desPass));
                });

                it('should transition to SecurityResult immediately after sending the password', function () {
                    client.addEventListener("credentialsrequired", () => {
                        client.sendCredentials({ password: 'passwd' });
                    });
                    sendSecurity(2, client);

                    const challenge = [];
                    for (let i = 0; i < 16; i++) { challenge[i] = i; }
                    client._sock._websocket._receiveData(new Uint8Array(challenge));
                    clock.tick();

                    expect(client._rfbInitState).to.equal('SecurityResult');
                });
            });

            describe('RSA-AES authentication (type 6) handler', function () {
                function fakeGetRandomValues(arr) {
                    if (arr.length === 16) {
                        arr.set(new Uint8Array([
                            0x1c, 0x08, 0xfe, 0x21, 0x78, 0xef, 0x4e, 0xf9,
                            0x3f, 0x05, 0xec, 0xea, 0xd4, 0x6b, 0xa5, 0xd5,
                        ]));
                    } else {
                        arr.set(new Uint8Array([
                            0xee, 0xe2, 0xf1, 0x5a, 0x3c, 0xa7, 0xbe, 0x95,
                            0x6f, 0x2a, 0x75, 0xfd, 0x62, 0x01, 0xcb, 0xbf,
                            0x43, 0x74, 0xca, 0x47, 0x4d, 0xfb, 0x0f, 0xcf,
                            0x3a, 0x6d, 0x55, 0x6b, 0x59, 0x3a, 0xf6, 0x87,
                            0xcb, 0x03, 0xb7, 0x28, 0x35, 0x7b, 0x15, 0x8e,
                            0xb6, 0xc8, 0x8f, 0x2d, 0x5e, 0x7b, 0x1c, 0x9a,
                            0x32, 0x55, 0xe7, 0x64, 0x36, 0x25, 0x7b, 0xa3,
                            0xe9, 0x4f, 0x6f, 0x97, 0xdc, 0xa4, 0xd4, 0x62,
                            0x6d, 0x7f, 0xab, 0x02, 0x6b, 0x13, 0x56, 0x69,
                            0xfb, 0xd0, 0xd4, 0x13, 0x76, 0xcd, 0x0d, 0xd0,
                            0x1f, 0xd1, 0x0c, 0x63, 0x3a, 0x34, 0x20, 0x6c,
                            0xbb, 0x60, 0x45, 0x82, 0x23, 0xfd, 0x7c, 0x77,
                            0x6d, 0xcc, 0x5e, 0xaa, 0xc3, 0x0c, 0x43, 0xb7,
                            0x8d, 0xc0, 0x27, 0x6e, 0xeb, 0x1d, 0x6c, 0x5f,
                            0xd8, 0x1c, 0x3c, 0x1c, 0x60, 0x2e, 0x82, 0x15,
                            0xfd, 0x2e, 0x5f, 0x3a, 0x15, 0x53, 0x14, 0x70,
                            0x4f, 0xe1, 0x65, 0x68, 0x35, 0x6d, 0xc7, 0x64,
                            0xdb, 0xdd, 0x09, 0x31, 0x4f, 0x7b, 0x6d, 0x6c,
                            0x77, 0x59, 0x5e, 0x1e, 0xfa, 0x4b, 0x06, 0x14,
                            0xbe, 0xdc, 0x9c, 0x3d, 0x7b, 0xed, 0xf3, 0x2b,
                            0x19, 0x26, 0x11, 0x8e, 0x3f, 0xab, 0x73, 0x9a,
                            0x0a, 0x3a, 0xaa, 0x85, 0x06, 0xd5, 0xca, 0x3f,
                            0xc3, 0xe2, 0x33, 0x7f, 0x97, 0x74, 0x98, 0x8f,
                            0x2f, 0xa5, 0xfc, 0x7e, 0xb1, 0x77, 0x71, 0x58,
                            0xf0, 0xbc, 0x04, 0x59, 0xbb, 0xb4, 0xc6, 0xcc,
                            0x0f, 0x06, 0xcd, 0xa2, 0xd5, 0x01, 0x2f, 0xb2,
                            0x22, 0x0b, 0xfc, 0x1e, 0x59, 0x9f, 0xd3, 0x4f,
                            0x30, 0x95, 0xc6, 0x80, 0x0f, 0x69, 0xf3, 0x4a,
                            0xd4, 0x36, 0xb6, 0x5a, 0x0b, 0x16, 0x0d, 0x81,
                            0x31, 0xb0, 0x69, 0xd4, 0x4e,
                        ]));
                    }
                }

                async function fakeGeneratekey() {
                    let key = { "alg": "RSA-OAEP-256",
                                "d": "B7QR2yI8sXjo8vQhJpX9odqqR6wIuPr" +
                                     "TM1B1JJEKVeSrr7OYcc1FRJ52Vap9LI" +
                                     "AU-ezigs9QDvWMxknB8motLnG69Wck3" +
                                     "7nt9_z4s8lFQp0nROA-oaR92HW34KNL" +
                                     "1b2fEVWGI0N86h730MvTJC5O2cmKeMe" +
                                     "zIG-oNqbbfFyP8AW-WLdDlgZm11-Fjz" +
                                     "hbVpb0Bc7nRSgBPSV-EY6Sl-LuglxDx" +
                                     "4LaTdQW7QE_WXoRUt-GYGfTseuFQQK5" +
                                     "WeoyX3yBtQydpauW6rrgyWdtP4hDFIo" +
                                     "ZsX6w1i-UMWMMwlIB5FdnUSi26igVGA" +
                                     "DGpV_vGMP36bv-EHp0bY-Qp0gpIfLfgQ",
                                "dp": "Z1v5UceFfV2bhmbG19eGYb30jFxqoR" +
                                      "Bq36PKNY7IunMs1keYy0FpLbyGhtgM" +
                                      "Z1Ymmc8wEzGYsCPEP-ykcun_rlyu7Y" +
                                      "xmcnyC9YQqTqLyqvO-7rUqDvk9TMfd" +
                                      "qWFP6heADRhKZmEbmcau6_m2MwwK9k" +
                                      "OkMKWvpqp8_TpJMnAH7zE",
                                "dq": "OBacRE15aY3NtCR4cvP5os3sT70JbD" +
                                      "dDLHT3IHZM6rE35CYNpLDia2chm_wn" +
                                      "McYvKFW9zC2ajRZ15i9c_VXQzS7ZlT" +
                                      "aQYBFyMt7kVhxMEMFsPv1crD6t3uEI" +
                                      "j0LNuNYyy0jkon_LPZKQFK654CiL-L" +
                                      "2YaNXOH4HbHP02dWeVQIE",
                                "e": "AQAB",
                                "ext": true,
                                "key_ops": ["decrypt"],
                                "kty": "RSA",
                                "n": "m1c92ZFk9ZI6l_O4YFiNxbv0Ng94SB3" +
                                     "yThy1P_mcqrGDQkRiGVdcTxAk38T9Pg" +
                                     "LztmspF-6U5TAHO-gSmmW88AC9m6f1M" +
                                     "spps6r7zl-M_OG-TwvGzf3BDz8zEg1F" +
                                     "PbZV7whO1M4TCAZ0PqwG7qCc6nK1WiA" +
                                     "haKrSpzuPdL1igfNBsX7qu5wgw4ZTTG" +
                                     "SLbVC_LfULQ5FADgFTRXUSaxm1F8C_L" +
                                     "wy6a2e4nTcXilmtN2IHUjHegzm-Tq2H" +
                                     "izmR3ARdWJpESYIW5-AXoiqj29tDrqC" +
                                     "mu2WPkB2psVp83IzZfaQNQzjNfvA8Gp" +
                                     "imkcDCkP5VMRrtKCcG4ZAFnO-A3NBX_Q",
                                "p": "2Q_lNL7vCOBzAppYzCZo3WSh0hX-MOZ" +
                                     "yPUznks5U2TjmfdNZoL6_FJRiGyyLvw" +
                                     "SiZFdEAAvpAyESFfFigngAqMLSf448n" +
                                     "Pg15VUGj533CotsEM0WpoEr1JCgqdUb" +
                                     "gDAfJQIBcwOmegBqd7lWm7uzEnRCvou" +
                                     "B70ybkJfpdprhkVE",
                                "q": "tzTt-F3g2u_3Ctj26Ho9iN_wC_W0lXG" +
                                     "zslLt5nLmss8JqdLoDDrijjU-gjeRh7" +
                                     "lgiuHdUc3dorfFKbaMNOjoW3QKqt9oZ" +
                                     "1JM0HKeRw0X2PnWW_0WK6DK5ASWDTXb" +
                                     "Mq2sUZqJvYEyL74H2Zrt0RPAux7XQLE" +
                                     "VgND6ROdXnMJ70O0",
                                "qi": "qfl4cXQkz4BNqa2De0-PfdU-8d1w3o" +
                                      "nnaGqx1Ds2fHzD_SJ4cNghn2TksoT9" +
                                      "Qo64b3pUjH9igi2pyEjomk6D12N6FG" +
                                      "0e10u7vFKv3W5YqUOgTpYdbcWHdZ2q" +
                                      "ZWJU0XQZIrF8jLGTOO4GYP6_9sJ5R7" +
                                      "Wk_0MdqQy8qvixWD4zLcY",
                    };
                    key = await window.crypto.subtle.importKey("jwk", key, {
                        name: "RSA-OAEP",
                        hash: {name: "SHA-256"}
                    }, true, ["decrypt"]);
                    return {privateKey: key};
                }

                before(() => {
                    sinon.stub(window.crypto, "getRandomValues").callsFake(fakeGetRandomValues);
                    sinon.stub(window.crypto.subtle, "generateKey").callsFake(fakeGeneratekey);
                });
                after(() => {
                    window.crypto.getRandomValues.restore();
                    window.crypto.subtle.generateKey.restore();
                });

                beforeEach(function () {
                    sendSecurity(6, client);
                    expect(client._sock).to.have.sent(new Uint8Array([6]));
                });

                const serverPublicKey = [
                    0x00, 0x00, 0x08, 0x00, 0xac, 0x1a, 0xbc, 0x42,
                    0x8a, 0x2a, 0x69, 0x65, 0x54, 0xf8, 0x9a, 0xe6,
                    0x43, 0xaa, 0xf7, 0x27, 0xf6, 0x2a, 0xf8, 0x8f,
                    0x36, 0xd4, 0xae, 0x54, 0x0f, 0x16, 0x28, 0x08,
                    0xc2, 0x5b, 0xca, 0x23, 0xdc, 0x27, 0x88, 0x1a,
                    0x12, 0x82, 0xa8, 0x54, 0xea, 0x00, 0x99, 0x8d,
                    0x02, 0x1d, 0x77, 0x4a, 0xeb, 0xd0, 0x93, 0x40,
                    0x79, 0x86, 0xcb, 0x37, 0xd4, 0xb2, 0xc7, 0xcd,
                    0x93, 0xe1, 0x00, 0x4d, 0x86, 0xff, 0x97, 0x33,
                    0x0c, 0xad, 0x51, 0x47, 0x45, 0x85, 0x56, 0x07,
                    0x65, 0x21, 0x7c, 0x57, 0x6d, 0x68, 0x7d, 0xd7,
                    0x00, 0x43, 0x0c, 0x9d, 0x3b, 0xa1, 0x5a, 0x11,
                    0xed, 0x51, 0x77, 0xf9, 0xd1, 0x5b, 0x33, 0xd7,
                    0x1a, 0xeb, 0x65, 0x57, 0xc0, 0x01, 0x51, 0xff,
                    0x9b, 0x82, 0xb3, 0xeb, 0x82, 0xc2, 0x1f, 0xca,
                    0x47, 0xc0, 0x6a, 0x09, 0xe0, 0xf7, 0xda, 0x39,
                    0x85, 0x12, 0xe7, 0x45, 0x8d, 0xb4, 0x1a, 0xda,
                    0xcb, 0x86, 0x58, 0x52, 0x37, 0x66, 0x9d, 0x8a,
                    0xce, 0xf2, 0x18, 0x78, 0x7d, 0x7f, 0xf0, 0x07,
                    0x94, 0x8e, 0x6b, 0x17, 0xd9, 0x00, 0x2a, 0x3a,
                    0xb9, 0xd4, 0x77, 0xde, 0x70, 0x85, 0xc4, 0x3a,
                    0x62, 0x10, 0x02, 0xee, 0xba, 0xd8, 0xc0, 0x62,
                    0xd0, 0x8e, 0xc1, 0x98, 0x19, 0x8e, 0x39, 0x0f,
                    0x3e, 0x1d, 0x61, 0xb1, 0x93, 0x13, 0x59, 0x39,
                    0xcb, 0x96, 0xf2, 0x17, 0xc9, 0xe1, 0x41, 0xd3,
                    0x20, 0xdd, 0x62, 0x5e, 0x7d, 0x53, 0xd6, 0xb7,
                    0x1d, 0xfe, 0x02, 0x18, 0x1f, 0xe0, 0xef, 0x3d,
                    0x94, 0xe3, 0x0a, 0x9c, 0x59, 0x54, 0xd8, 0x98,
                    0x16, 0x9c, 0x31, 0xda, 0x41, 0x0f, 0x2e, 0x71,
                    0x68, 0xe0, 0xa2, 0x62, 0x3e, 0xe5, 0x25, 0x31,
                    0xcf, 0xfc, 0x67, 0x63, 0xc3, 0xb0, 0xda, 0x3f,
                    0x7b, 0x59, 0xbe, 0x7e, 0x9e, 0xa8, 0xd0, 0x01,
                    0x4f, 0x43, 0x7f, 0x8d, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x01, 0x00, 0x01,
                ];

                const serverRandom = [
                    0x01, 0x00, 0x5b, 0x58, 0x2a, 0x96, 0x2d, 0xbb,
                    0x88, 0xec, 0xc3, 0x54, 0x00, 0xf3, 0xbb, 0xbe,
                    0x17, 0xa3, 0x84, 0xd3, 0xef, 0xd8, 0x4a, 0x31,
                    0x09, 0x20, 0xdd, 0xbc, 0x16, 0x9d, 0xc9, 0x5b,
                    0x99, 0x62, 0x86, 0xfe, 0x0b, 0x28, 0x4b, 0xfe,
                    0x5b, 0x56, 0x2d, 0xcb, 0x6e, 0x6f, 0xec, 0xf0,
                    0x53, 0x0c, 0x33, 0x84, 0x93, 0xc9, 0xbf, 0x79,
                    0xde, 0xb3, 0xb9, 0x29, 0x60, 0x78, 0xde, 0xe6,
                    0x1d, 0xa7, 0x89, 0x48, 0x3f, 0xd1, 0x58, 0x66,
                    0x27, 0x9c, 0xd4, 0x6e, 0x72, 0x9c, 0x6e, 0x4a,
                    0xc0, 0x69, 0x79, 0x6f, 0x79, 0x0f, 0x13, 0xc4,
                    0x20, 0xcf, 0xa6, 0xbb, 0xce, 0x18, 0x6d, 0xd5,
                    0x9e, 0xd9, 0x67, 0xbe, 0x61, 0x43, 0x67, 0x11,
                    0x76, 0x2f, 0xfd, 0x78, 0x75, 0x2b, 0x89, 0x35,
                    0xdd, 0x0f, 0x13, 0x7f, 0xee, 0x78, 0xad, 0x32,
                    0x56, 0x21, 0x81, 0x08, 0x1f, 0xcf, 0x4c, 0x29,
                    0xa3, 0xeb, 0x89, 0x2d, 0xbe, 0xba, 0x8d, 0xe4,
                    0x69, 0x28, 0xba, 0x53, 0x82, 0xce, 0x5c, 0xf6,
                    0x5e, 0x5e, 0xa5, 0xb3, 0x88, 0xd8, 0x3d, 0xab,
                    0xf4, 0x24, 0x9e, 0x3f, 0x04, 0xaf, 0xdc, 0x48,
                    0x90, 0x53, 0x37, 0xe6, 0x82, 0x1d, 0xe0, 0x15,
                    0x91, 0xa1, 0xc6, 0xa9, 0x54, 0xe5, 0x2a, 0xb5,
                    0x64, 0x2d, 0x93, 0xc0, 0xc0, 0xe1, 0x0f, 0x6a,
                    0x4b, 0xdb, 0x77, 0xf8, 0x4a, 0x0f, 0x83, 0x36,
                    0xdd, 0x5e, 0x1e, 0xdd, 0x39, 0x65, 0xa2, 0x11,
                    0xc2, 0xcf, 0x56, 0x1e, 0xa1, 0x29, 0xae, 0x11,
                    0x9f, 0x3a, 0x82, 0xc7, 0xbd, 0x89, 0x6e, 0x59,
                    0xb8, 0x59, 0x17, 0xcb, 0x65, 0xa0, 0x4b, 0x4d,
                    0xbe, 0x33, 0x32, 0x85, 0x9c, 0xca, 0x5e, 0x95,
                    0xc2, 0x5a, 0xd0, 0xc9, 0x8b, 0xf1, 0xf5, 0x14,
                    0xcf, 0x76, 0x80, 0xc2, 0x24, 0x0a, 0x39, 0x7e,
                    0x60, 0x64, 0xce, 0xd9, 0xb8, 0xad, 0x24, 0xa8,
                    0xdf, 0xcb,
                ];

                const serverHash = [
                    0x00, 0x14, 0x39, 0x30, 0x66, 0xb5, 0x66, 0x8a,
                    0xcd, 0xb9, 0xda, 0xe0, 0xde, 0xcb, 0xf6, 0x47,
                    0x5f, 0x54, 0x66, 0xe0, 0xbc, 0x49, 0x37, 0x01,
                    0xf2, 0x9e, 0xef, 0xcc, 0xcd, 0x4d, 0x6c, 0x0e,
                    0xc6, 0xab, 0x28, 0xd4, 0x7b, 0x13,
                ];

                const subType = [
                    0x00, 0x01, 0x30, 0x2a, 0xc3, 0x0b, 0xc2, 0x1c,
                    0xeb, 0x02, 0x44, 0x92, 0x5d, 0xfd, 0xf9, 0xa7,
                    0x94, 0xd0, 0x19,
                ];

                const clientPublicKey = [
                    0x00, 0x00, 0x08, 0x00, 0x9b, 0x57, 0x3d, 0xd9,
                    0x91, 0x64, 0xf5, 0x92, 0x3a, 0x97, 0xf3, 0xb8,
                    0x60, 0x58, 0x8d, 0xc5, 0xbb, 0xf4, 0x36, 0x0f,
                    0x78, 0x48, 0x1d, 0xf2, 0x4e, 0x1c, 0xb5, 0x3f,
                    0xf9, 0x9c, 0xaa, 0xb1, 0x83, 0x42, 0x44, 0x62,
                    0x19, 0x57, 0x5c, 0x4f, 0x10, 0x24, 0xdf, 0xc4,
                    0xfd, 0x3e, 0x02, 0xf3, 0xb6, 0x6b, 0x29, 0x17,
                    0xee, 0x94, 0xe5, 0x30, 0x07, 0x3b, 0xe8, 0x12,
                    0x9a, 0x65, 0xbc, 0xf0, 0x00, 0xbd, 0x9b, 0xa7,
                    0xf5, 0x32, 0xca, 0x69, 0xb3, 0xaa, 0xfb, 0xce,
                    0x5f, 0x8c, 0xfc, 0xe1, 0xbe, 0x4f, 0x0b, 0xc6,
                    0xcd, 0xfd, 0xc1, 0x0f, 0x3f, 0x33, 0x12, 0x0d,
                    0x45, 0x3d, 0xb6, 0x55, 0xef, 0x08, 0x4e, 0xd4,
                    0xce, 0x13, 0x08, 0x06, 0x74, 0x3e, 0xac, 0x06,
                    0xee, 0xa0, 0x9c, 0xea, 0x72, 0xb5, 0x5a, 0x20,
                    0x21, 0x68, 0xaa, 0xd2, 0xa7, 0x3b, 0x8f, 0x74,
                    0xbd, 0x62, 0x81, 0xf3, 0x41, 0xb1, 0x7e, 0xea,
                    0xbb, 0x9c, 0x20, 0xc3, 0x86, 0x53, 0x4c, 0x64,
                    0x8b, 0x6d, 0x50, 0xbf, 0x2d, 0xf5, 0x0b, 0x43,
                    0x91, 0x40, 0x0e, 0x01, 0x53, 0x45, 0x75, 0x12,
                    0x6b, 0x19, 0xb5, 0x17, 0xc0, 0xbf, 0x2f, 0x0c,
                    0xba, 0x6b, 0x67, 0xb8, 0x9d, 0x37, 0x17, 0x8a,
                    0x59, 0xad, 0x37, 0x62, 0x07, 0x52, 0x31, 0xde,
                    0x83, 0x39, 0xbe, 0x4e, 0xad, 0x87, 0x8b, 0x39,
                    0x91, 0xdc, 0x04, 0x5d, 0x58, 0x9a, 0x44, 0x49,
                    0x82, 0x16, 0xe7, 0xe0, 0x17, 0xa2, 0x2a, 0xa3,
                    0xdb, 0xdb, 0x43, 0xae, 0xa0, 0xa6, 0xbb, 0x65,
                    0x8f, 0x90, 0x1d, 0xa9, 0xb1, 0x5a, 0x7c, 0xdc,
                    0x8c, 0xd9, 0x7d, 0xa4, 0x0d, 0x43, 0x38, 0xcd,
                    0x7e, 0xf0, 0x3c, 0x1a, 0x98, 0xa6, 0x91, 0xc0,
                    0xc2, 0x90, 0xfe, 0x55, 0x31, 0x1a, 0xed, 0x28,
                    0x27, 0x06, 0xe1, 0x90, 0x05, 0x9c, 0xef, 0x80,
                    0xdc, 0xd0, 0x57, 0xfd, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                    0x00, 0x01, 0x00, 0x01,
                ];

                const clientRandom = [
                    0x01, 0x00, 0x84, 0x7f, 0x26, 0x54, 0x74, 0xf6,
                    0x47, 0xaf, 0x33, 0x64, 0x0d, 0xa6, 0xe5, 0x30,
                    0xba, 0xe6, 0xe4, 0x8e, 0x50, 0x40, 0x71, 0x1c,
                    0x0e, 0x06, 0x63, 0xf5, 0x07, 0x2a, 0x26, 0x68,
                    0xd6, 0xcf, 0xa6, 0x80, 0x84, 0x5e, 0x64, 0xd4,
                    0x5e, 0x62, 0x31, 0xfe, 0x44, 0x51, 0x0b, 0x7c,
                    0x4d, 0x55, 0xc5, 0x4a, 0x7e, 0x0d, 0x4d, 0x9b,
                    0x84, 0xb4, 0x32, 0x2b, 0x4d, 0x8a, 0x34, 0x8d,
                    0xc8, 0xcf, 0x19, 0x3b, 0x64, 0x82, 0x27, 0x9e,
                    0xa7, 0x70, 0x2a, 0xc1, 0xb8, 0xf3, 0x6a, 0x3a,
                    0xf2, 0x75, 0x6e, 0x1d, 0xeb, 0xb6, 0x70, 0x7a,
                    0x15, 0x18, 0x38, 0x00, 0xb4, 0x4f, 0x55, 0xb5,
                    0xd8, 0x03, 0x4e, 0xb8, 0x53, 0xff, 0x80, 0x62,
                    0xf1, 0x9d, 0x27, 0xe8, 0x2a, 0x3d, 0x98, 0x19,
                    0x32, 0x09, 0x7e, 0x9a, 0xb0, 0xc7, 0x46, 0x23,
                    0x10, 0x85, 0x35, 0x00, 0x96, 0xce, 0xb3, 0x2c,
                    0x84, 0x8d, 0xf4, 0x9e, 0xa8, 0x42, 0x67, 0xed,
                    0x09, 0xa6, 0x09, 0x97, 0xb3, 0x64, 0x26, 0xfb,
                    0x71, 0x11, 0x9b, 0x3f, 0xbb, 0x57, 0xb8, 0x5b,
                    0x2e, 0xc5, 0x2d, 0x8c, 0x5c, 0xf7, 0xef, 0x27,
                    0x25, 0x88, 0x42, 0x45, 0x43, 0xa4, 0xe7, 0xde,
                    0xea, 0xf9, 0x15, 0x7b, 0x5d, 0x66, 0x24, 0xce,
                    0xf7, 0xc8, 0x2f, 0xc5, 0xc0, 0x3d, 0xcd, 0xf2,
                    0x62, 0xfc, 0x1a, 0x5e, 0xec, 0xff, 0xf1, 0x1b,
                    0xc8, 0xdb, 0xc1, 0x0f, 0x54, 0x66, 0x9e, 0xfd,
                    0x99, 0x9b, 0x23, 0x70, 0x62, 0x37, 0x80, 0xad,
                    0x91, 0x6b, 0x84, 0x85, 0x6a, 0x4c, 0x80, 0x9e,
                    0x60, 0x8a, 0x93, 0xa3, 0xc8, 0x8e, 0xc4, 0x4b,
                    0x4d, 0xb4, 0x8e, 0x3e, 0xaf, 0xce, 0xcd, 0x83,
                    0xe5, 0x21, 0x90, 0x95, 0x20, 0x3c, 0x82, 0xb4,
                    0x7c, 0xab, 0x63, 0x9c, 0xae, 0xc3, 0xc9, 0x71,
                    0x1a, 0xec, 0x34, 0x18, 0x47, 0xec, 0x5c, 0x4d,
                    0xed, 0x84,
                ];

                const clientHash = [
                    0x00, 0x14, 0x9c, 0x91, 0x9e, 0x76, 0xcf, 0x1e,
                    0x66, 0x87, 0x5e, 0x29, 0xf1, 0x13, 0x80, 0xea,
                    0x7d, 0xec, 0xae, 0xf9, 0x60, 0x01, 0xd3, 0x6f,
                    0xb7, 0x9e, 0xb2, 0xcd, 0x2d, 0xc8, 0xf8, 0x84,
                    0xb2, 0x9f, 0xc3, 0x7e, 0xb4, 0xbe,
                ];

                const credentialsData = [
                    0x00, 0x08, 0x9d, 0xc8, 0x3a, 0xb8, 0x80, 0x4f,
                    0xe3, 0x52, 0xdb, 0x62, 0x9e, 0x97, 0x64, 0x82,
                    0xa8, 0xa1, 0x6b, 0x7e, 0x4d, 0x68, 0x8c, 0x29,
                    0x91, 0x38,
                ];

                it('should fire the serververification event', async function () {
                    let verification = new Promise((resolve, reject) => {
                        client.addEventListener("serververification", (e) => {
                            resolve(e.detail.publickey);
                        });
                    });

                    client._sock._websocket._receiveData(new Uint8Array(serverPublicKey));
                    client._sock._websocket._receiveData(new Uint8Array(serverRandom));

                    expect(await verification).to.deep.equal(new Uint8Array(serverPublicKey));
                });

                it('should handle approveServer and fire the credentialsrequired event', async function () {
                    let verification = new Promise((resolve, reject) => {
                        client.addEventListener("serververification", (e) => {
                            resolve(e.detail.publickey);
                        });
                    });
                    let credentials = new Promise((resolve, reject) => {
                        client.addEventListener("credentialsrequired", (e) => {
                            resolve(e.detail.types);
                        });
                    });

                    client._sock._websocket._receiveData(new Uint8Array(serverPublicKey));
                    client._sock._websocket._receiveData(new Uint8Array(serverRandom));

                    await verification;
                    client.approveServer();

                    client._sock._websocket._receiveData(new Uint8Array(serverHash));
                    client._sock._websocket._receiveData(new Uint8Array(subType));

                    expect(await credentials).to.have.members(["password"]);
                });

                it('should send credentials to server', async function () {
                    let verification = new Promise((resolve, reject) => {
                        client.addEventListener("serververification", (e) => {
                            resolve(e.detail.publickey);
                        });
                    });
                    let credentials = new Promise((resolve, reject) => {
                        client.addEventListener("credentialsrequired", (e) => {
                            resolve(e.detail.types);
                        });
                    });

                    client._sock._websocket._receiveData(new Uint8Array(serverPublicKey));
                    client._sock._websocket._receiveData(new Uint8Array(serverRandom));

                    await verification;
                    client.approveServer();

                    client._sock._websocket._receiveData(new Uint8Array(serverHash));
                    client._sock._websocket._receiveData(new Uint8Array(subType));

                    await credentials;

                    let expected = [];
                    expected = expected.concat(clientPublicKey);
                    expected = expected.concat(clientRandom);
                    expected = expected.concat(clientHash);
                    expect(client._sock).to.have.sent(new Uint8Array(expected));

                    client.sendCredentials({ "password": "123456" });
                    clock.tick();

                    // FIXME: We don't have a good way to know when
                    //        the async stuff is done, so we hook in
                    //        to this internal function that is
                    //        called at the end
                    await new Promise((resolve, reject) => {
                        sinon.stub(client._sock._websocket, "send")
                            .callsFake((data) => {
                                FakeWebSocket.prototype.send.call(client._sock._websocket, data);
                                resolve();
                            });
                    });

                    expect(client._sock).to.have.sent(new Uint8Array(credentialsData));
                });
            });

            describe('ARD authentication (type 30) handler', function () {
                let byteArray = new Uint8Array(Array.from(new Uint8Array(128).keys()));
                function fakeGetRandomValues(arr) {
                    if (arr.length == 128) {
                        arr.set(byteArray);
                    }
                    return arr;
                }
                before(() => {
                    sinon.stub(window.crypto, "getRandomValues").callsFake(fakeGetRandomValues);
                });
                after(() => {
                    window.crypto.getRandomValues.restore();
                });
                it('should fire the credentialsrequired event if all credentials are missing', function () {
                    const spy = sinon.spy();
                    client.addEventListener("credentialsrequired", spy);
                    sendSecurity(30, client);

                    expect(spy).to.have.been.calledOnce;
                    expect(spy.args[0][0].detail.types).to.have.members(["username", "password"]);
                });

                it('should fire the credentialsrequired event if some credentials are missing', function () {
                    const spy = sinon.spy();
                    client.addEventListener("credentialsrequired", spy);
                    client.sendCredentials({ password: 'password'});
                    sendSecurity(30, client);

                    expect(spy).to.have.been.calledOnce;
                    expect(spy.args[0][0].detail.types).to.have.members(["username", "password"]);
                });

                it('should return properly encrypted credentials and public key', async function () {
                    client.addEventListener("credentialsrequired", () => {
                        client.sendCredentials({ username: 'user',
                                                 password: 'password' });
                    });
                    sendSecurity(30, client);

                    expect(client._sock).to.have.sent([30]);

                    const generator = new Uint8Array([127, 255]);
                    const prime = new Uint8Array(byteArray);
                    const serverKey = legacyCrypto.generateKey(
                        { name: "DH", g: generator, p: prime }, false, ["deriveBits"]);
                    const clientKey = legacyCrypto.generateKey(
                        { name: "DH", g: generator, p: prime }, false, ["deriveBits"]);
                    const serverPublicKey = legacyCrypto.exportKey("raw", serverKey.publicKey);
                    const clientPublicKey = legacyCrypto.exportKey("raw", clientKey.publicKey);

                    let data = [];

                    data = data.concat(Array.from(generator));
                    push16(data, prime.length);
                    data = data.concat(Array.from(prime));
                    data = data.concat(Array.from(serverPublicKey));

                    client._sock._websocket._receiveData(new Uint8Array(data));

                    // FIXME: We don't have a good way to know when the
                    //        async stuff is done, so we hook in to this
                    //        internal function that is called at the
                    //        end
                    await new Promise((resolve, reject) => {
                        sinon.stub(client, "_resumeAuthentication")
                            .callsFake(() => {
                                RFB.prototype._resumeAuthentication.call(client);
                                resolve();
                            });
                    });
                    clock.tick();

                    expect(client._rfbInitState).to.equal('SecurityResult');

                    let expectEncrypted = new Uint8Array([
                        199, 39, 204, 95, 190, 70, 127, 66, 5, 106, 153, 228, 123, 236, 150, 206,
                        62, 107, 11, 4, 21, 242, 92, 184, 9, 81, 35, 125, 56, 167, 1, 215,
                        182, 145, 183, 75, 245, 197, 47, 19, 122, 94, 64, 76, 77, 163, 222, 143,
                        186, 174, 84, 39, 244, 179, 227, 114, 83, 231, 42, 106, 205, 43, 159, 110,
                        209, 240, 157, 246, 237, 206, 134, 153, 195, 112, 92, 60, 28, 234, 91, 66,
                        131, 38, 187, 195, 110, 167, 212, 241, 32, 250, 212, 213, 202, 89, 180, 21,
                        71, 217, 209, 81, 42, 61, 118, 248, 65, 123, 98, 78, 139, 111, 202, 137,
                        50, 185, 37, 173, 58, 99, 187, 53, 42, 125, 13, 165, 232, 163, 151, 42, 0]);

                    let output = new Uint8Array(256);
                    output.set(expectEncrypted, 0);
                    output.set(clientPublicKey, 128);

                    expect(client._sock).to.have.sent(output);
                });
            });

            describe('MSLogonII authentication (type 113) handler', function () {
                function fakeGetRandomValues(arr) {
                    if (arr.length == 8) {
                        arr.set(new Uint8Array([0, 0, 0, 0, 5, 6, 7, 8]));
                    } else if (arr.length == 256) {
                        arr.set(new Uint8Array(256));
                    } else if (arr.length == 64) {
                        arr.set(new Uint8Array(64));
                    }
                    return arr;
                }
                const expected = new Uint8Array([
                    0x00, 0x00, 0x00, 0x00, 0x0a, 0xbc, 0x7c, 0xfd,
                    0x58, 0x34, 0xd2, 0x24, 0x44, 0x60, 0xf0, 0xd1,
                    0xa3, 0x73, 0x32, 0x02, 0x07, 0xce, 0xc1, 0x3f,
                    0x10, 0x53, 0xf1, 0xdd, 0x99, 0xad, 0x44, 0x18,
                    0xa1, 0xc4, 0xac, 0xc1, 0x1c, 0x13, 0x11, 0x85,
                    0x3a, 0x6f, 0xcb, 0xc6, 0xb1, 0x6c, 0x68, 0x47,
                    0x85, 0x01, 0xbb, 0xfa, 0x23, 0x8c, 0x59, 0x47,
                    0x67, 0x47, 0x56, 0x6e, 0x6f, 0x9f, 0x07, 0x76,
                    0x2e, 0x90, 0x1e, 0xdc, 0x80, 0xc4, 0x4b, 0x72,
                    0xd2, 0xd5, 0xcd, 0x4b, 0x14, 0xff, 0x05, 0x8b,
                    0x8d, 0xf1, 0x9b, 0xe0, 0xff, 0xa5, 0x3b, 0x56,
                    0xb9, 0x6f, 0x84, 0x3e, 0x15, 0x84, 0x31, 0x4e,
                    0x10, 0x0b, 0x56, 0xf4, 0x10, 0x05, 0x02, 0xc7,
                    0x05, 0x0b, 0xc9, 0x66, 0x75, 0x32, 0xd3, 0x74,
                    0xfc, 0x8c, 0xcf, 0xbd, 0x2d, 0x53, 0xd7, 0xa7,
                    0xca, 0x82, 0x12, 0xce, 0xbb, 0x33, 0x09, 0x3f,
                    0xff, 0x76, 0x7c, 0xdf, 0x2c, 0x2f, 0x4d, 0x95,
                    0x86, 0xe4, 0x10, 0x07, 0x75, 0x1a, 0x6d, 0xdb,
                    0x05, 0x91, 0x70, 0x34, 0x5c, 0x12, 0xbc, 0x4e,
                    0x5e, 0xd0, 0x21, 0x39, 0x25, 0x2b, 0x62, 0x19,
                    0x29, 0xa5, 0xe6, 0x93, 0x7b, 0xf8, 0x3f, 0xcf,
                    0xd7, 0x3f, 0x0c, 0xd2, 0x68, 0x2d, 0x1e, 0x01,
                    0x1a, 0x31, 0xc1, 0x59, 0x04, 0x06, 0xf6, 0x3b,
                    0xec, 0x38, 0xef, 0x1b, 0x5b, 0x39, 0x88, 0xd3,
                    0xe0, 0x5b, 0xb9, 0xef, 0xc3, 0x82, 0xfa, 0xdf,
                    0x04, 0xf7, 0x65, 0x56, 0x82, 0x77, 0xfd, 0x63,
                    0x10, 0xd7, 0xab, 0x0b, 0x5e, 0xd9, 0x07, 0x81,
                    0x9d, 0xce, 0x26, 0xfb, 0x5d, 0xa8, 0x59, 0x2a,
                    0xd9, 0xb8, 0xac, 0xcd, 0x6e, 0x61, 0x07, 0x39,
                    0x9f, 0x8d, 0xdf, 0x53, 0x44, 0xab, 0x28, 0x01,
                    0x86, 0x4d, 0x07, 0x8a, 0x5b, 0xdd, 0xc1, 0x18,
                    0x29, 0xaa, 0xa2, 0xbe, 0xe2, 0x9c, 0x9e, 0xb0,
                    0xb3, 0x2b, 0x2c, 0x93, 0x3e, 0x82, 0x07, 0xa6,
                    0xef, 0x21, 0x2c, 0xa7, 0xf0, 0x65, 0xba, 0xda,
                    0x13, 0xe4, 0x41, 0x87, 0x36, 0x1c, 0xa5, 0x81,
                    0xae, 0xf3, 0x3e, 0xda, 0x03, 0x09, 0x63, 0x4b,
                    0xb5, 0x29, 0x49, 0xfa, 0xbb, 0xa6, 0x31, 0x3c,
                    0xc8, 0x15, 0xfb, 0xfc, 0xd6, 0xff, 0x04, 0x92,
                    0x56, 0xbc, 0x66, 0xf1, 0x78, 0xfb, 0x14, 0x79,
                    0x48, 0xd2, 0xcf, 0x87, 0x60, 0x23, 0xcf, 0xdb,
                    0x1b, 0xad, 0x42, 0x32, 0x4e, 0x6d, 0x1f, 0x49,
                ]);
                before(() => {
                    sinon.stub(window.crypto, "getRandomValues").callsFake(fakeGetRandomValues);
                });
                after(() => {
                    window.crypto.getRandomValues.restore();
                });
                it('should send public value and encrypted credentials', function () {
                    client.addEventListener("credentialsrequired", () => {
                        client.sendCredentials({ username: 'username',
                                                 password: 'password123456' });
                    });
                    sendSecurity(113, client);

                    expect(client._sock).to.have.sent([113]);

                    const g = new Uint8Array([0, 0, 0, 0, 0, 1, 0, 1]);
                    const p = new Uint8Array([0, 0, 0, 0, 0x25, 0x18, 0x26, 0x17]);
                    const A = new Uint8Array([0, 0, 0, 0, 0x0e, 0x12, 0xd0, 0xf5]);

                    client._sock._websocket._receiveData(g);
                    client._sock._websocket._receiveData(p);
                    client._sock._websocket._receiveData(A);
                    clock.tick();

                    expect(client._sock).to.have.sent(expected);
                    expect(client._rfbInitState).to.equal('SecurityResult');
                });
            });

            describe('XVP authentication (type 22) handler', function () {
                it('should fall through to standard VNC authentication upon completion', function () {
                    client.addEventListener("credentialsrequired", () => {
                        client.sendCredentials({ username: 'user',
                                                 target: 'target',
                                                 password: 'password' });
                    });
                    sinon.spy(client, "_negotiateStdVNCAuth");
                    sendSecurity(22, client);
                    clock.tick();
                    expect(client._negotiateStdVNCAuth).to.have.been.calledOnce;
                });

                it('should fire the credentialsrequired event if all credentials are missing', function () {
                    const spy = sinon.spy();
                    client.addEventListener("credentialsrequired", spy);
                    sendSecurity(22, client);

                    expect(spy).to.have.been.calledOnce;
                    expect(spy.args[0][0].detail.types).to.have.members(["username", "password", "target"]);
                });

                it('should fire the credentialsrequired event if some credentials are missing', function () {
                    const spy = sinon.spy();
                    client.addEventListener("credentialsrequired", spy);
                    client.sendCredentials({ username: 'user',
                                             target: 'target' });
                    sendSecurity(22, client);

                    expect(spy).to.have.been.calledOnce;
                    expect(spy.args[0][0].detail.types).to.have.members(["username", "password", "target"]);
                });

                it('should send user and target separately', function () {
                    client.addEventListener("credentialsrequired", () => {
                        client.sendCredentials({ username: 'user',
                                                 target: 'target',
                                                 password: 'password' });
                    });
                    sendSecurity(22, client);
                    clock.tick();

                    const expected = [22, 4, 6]; // auth selection, len user, len target
                    for (let i = 0; i < 10; i++) { expected[i+3] = 'usertarget'.charCodeAt(i); }

                    expect(client._sock).to.have.sent(new Uint8Array(expected));
                });
            });

            describe('TightVNC authentication (type 16) handler', function () {
                beforeEach(function () {
                    sendSecurity(16, client);
                    client._sock._websocket._getSentData();  // skip the security reply
                });

                function sendNumStrPairs(pairs, client) {
                    const data = [];
                    push32(data, pairs.length);

                    for (let i = 0; i < pairs.length; i++) {
                        push32(data, pairs[i][0]);
                        for (let j = 0; j < 4; j++) {
                            data.push(pairs[i][1].charCodeAt(j));
                        }
                        for (let j = 0; j < 8; j++) {
                            data.push(pairs[i][2].charCodeAt(j));
                        }
                    }

                    client._sock._websocket._receiveData(new Uint8Array(data));
                }

                it('should skip tunnel negotiation if no tunnels are requested', function () {
                    client._sock._websocket._receiveData(new Uint8Array([0, 0, 0, 0]));
                    expect(client._rfbTightVNC).to.be.true;
                });

                it('should fail if no supported tunnels are listed', function () {
                    let callback = sinon.spy();
                    client.addEventListener("disconnect", callback);

                    sendNumStrPairs([[123, 'OTHR', 'SOMETHNG']], client);

                    expect(callback).to.have.been.calledOnce;
                    expect(callback.args[0][0].detail.clean).to.be.false;
                });

                it('should choose the notunnel tunnel type', function () {
                    sendNumStrPairs([[0, 'TGHT', 'NOTUNNEL'], [123, 'OTHR', 'SOMETHNG']], client);
                    expect(client._sock).to.have.sent(new Uint8Array([0, 0, 0, 0]));
                });

                it('should choose the notunnel tunnel type for Siemens devices', function () {
                    sendNumStrPairs([[1, 'SICR', 'SCHANNEL'], [2, 'SICR', 'SCHANLPW']], client);
                    expect(client._sock).to.have.sent(new Uint8Array([0, 0, 0, 0]));
                });

                it('should continue to sub-auth negotiation after tunnel negotiation', function () {
                    sendNumStrPairs([[0, 'TGHT', 'NOTUNNEL']], client);
                    client._sock._websocket._getSentData();  // skip the tunnel choice here
                    sendNumStrPairs([[1, 'STDV', 'NOAUTH__']], client);
                    expect(client._sock).to.have.sent(new Uint8Array([0, 0, 0, 1]));
                    expect(client._rfbInitState).to.equal('SecurityResult');
                });

                it('should accept the "no auth" auth type and transition to SecurityResult', function () {
                    sendNumStrPairs([[0, 'TGHT', 'NOTUNNEL']], client);
                    client._sock._websocket._getSentData();  // skip the tunnel choice here
                    sendNumStrPairs([[1, 'STDV', 'NOAUTH__']], client);
                    expect(client._sock).to.have.sent(new Uint8Array([0, 0, 0, 1]));
                    expect(client._rfbInitState).to.equal('SecurityResult');
                });

                it('should accept VNC authentication and transition to that', function () {
                    sendNumStrPairs([[0, 'TGHT', 'NOTUNNEL']], client);
                    client._sock._websocket._getSentData();  // skip the tunnel choice here
                    sinon.spy(client, "_negotiateStdVNCAuth");
                    sendNumStrPairs([[2, 'STDV', 'VNCAUTH__']], client);
                    expect(client._sock).to.have.sent(new Uint8Array([0, 0, 0, 2]));
                    expect(client._negotiateStdVNCAuth).to.have.been.calledOnce;
                    expect(client._rfbAuthScheme).to.equal(2);
                });

                it('should fail if there are no supported auth types', function () {
                    let callback = sinon.spy();
                    client.addEventListener("disconnect", callback);

                    sendNumStrPairs([[0, 'TGHT', 'NOTUNNEL']], client);
                    client._sock._websocket._getSentData();  // skip the tunnel choice here
                    sendNumStrPairs([[23, 'stdv', 'badval__']], client);

                    expect(callback).to.have.been.calledOnce;
                    expect(callback.args[0][0].detail.clean).to.be.false;
                });
            });

            describe('VeNCrypt authentication (type 19) handler', function () {
                beforeEach(function () {
                    sendSecurity(19, client);
                    expect(client._sock).to.have.sent(new Uint8Array([19]));
                });

                it('should fail with non-0.2 versions', function () {
                    let callback = sinon.spy();
                    client.addEventListener("disconnect", callback);

                    client._sock._websocket._receiveData(new Uint8Array([0, 1]));

                    expect(callback).to.have.been.calledOnce;
                    expect(callback.args[0][0].detail.clean).to.be.false;
                });

                it('should fail if there are no supported subtypes', function () {
                    // VeNCrypt version
                    client._sock._websocket._receiveData(new Uint8Array([0, 2]));
                    expect(client._sock).to.have.sent(new Uint8Array([0, 2]));
                    // Server ACK.
                    client._sock._websocket._receiveData(new Uint8Array([0]));
                    // Subtype list
                    let callback = sinon.spy();
                    client.addEventListener("disconnect", callback);
                    client._sock._websocket._receiveData(new Uint8Array([2, 0, 0, 0, 9, 0, 0, 1, 4]));
                    expect(callback).to.have.been.calledOnce;
                    expect(callback.args[0][0].detail.clean).to.be.false;
                });

                it('should support standard types', function () {
                    // VeNCrypt version
                    client._sock._websocket._receiveData(new Uint8Array([0, 2]));
                    expect(client._sock).to.have.sent(new Uint8Array([0, 2]));
                    // Server ACK.
                    client._sock._websocket._receiveData(new Uint8Array([0]));
                    // Subtype list
                    client._sock._websocket._receiveData(new Uint8Array([2, 0, 0, 0, 2, 0, 0, 1, 4]));

                    let expectedResponse = [];
                    push32(expectedResponse, 2); // Chosen subtype.

                    expect(client._sock).to.have.sent(new Uint8Array(expectedResponse));
                });

                it('should respect server preference order', function () {
                    // VeNCrypt version
                    client._sock._websocket._receiveData(new Uint8Array([0, 2]));
                    expect(client._sock).to.have.sent(new Uint8Array([0, 2]));
                    // Server ACK.
                    client._sock._websocket._receiveData(new Uint8Array([0]));
                    // Subtype list
                    let subtypes = [ 6 ];
                    push32(subtypes, 79);
                    push32(subtypes, 30);
                    push32(subtypes, 188);
                    push32(subtypes, 256);
                    push32(subtypes, 6);
                    push32(subtypes, 1);
                    client._sock._websocket._receiveData(new Uint8Array(subtypes));

                    let expectedResponse = [];
                    push32(expectedResponse, 30); // Chosen subtype.

                    expect(client._sock).to.have.sent(new Uint8Array(expectedResponse));
                });

                it('should ignore redundant VeNCrypt subtype', function () {
                    // VeNCrypt version
                    client._sock._websocket._receiveData(new Uint8Array([0, 2]));
                    expect(client._sock).to.have.sent(new Uint8Array([0, 2]));
                    // Server ACK.
                    client._sock._websocket._receiveData(new Uint8Array([0]));
                    // Subtype list
                    client._sock._websocket._receiveData(new Uint8Array([2, 0, 0, 0, 19, 0, 0, 0, 2]));

                    let expectedResponse = [];
                    push32(expectedResponse, 2); // Chosen subtype.

                    expect(client._sock).to.have.sent(new Uint8Array(expectedResponse));
                });
            });

            describe('Plain authentication (type 256) handler', function () {
                beforeEach(function () {
                    sendSecurity(19, client);
                    expect(client._sock).to.have.sent(new Uint8Array([19]));
                    // VeNCrypt version
                    client._sock._websocket._receiveData(new Uint8Array([0, 2]));
                    expect(client._sock).to.have.sent(new Uint8Array([0, 2]));
                    // Server ACK.
                    client._sock._websocket._receiveData(new Uint8Array([0]));
                });

                it('should support Plain authentication', function () {
                    client.addEventListener("credentialsrequired", () => {
                        client.sendCredentials({ username: 'username', password: 'password' });
                    });
                    client._sock._websocket._receiveData(new Uint8Array([1, 0, 0, 1, 0]));
                    expect(client._sock).to.have.sent(new Uint8Array([0, 0, 1, 0]));

                    clock.tick();

                    const expectedResponse = [];
                    push32(expectedResponse, 8);
                    push32(expectedResponse, 8);
                    pushString(expectedResponse, 'username');
                    pushString(expectedResponse, 'password');
                    expect(client._sock).to.have.sent(new Uint8Array(expectedResponse));
                });

                it('should support Plain authentication with an empty password', function () {
                    client.addEventListener("credentialsrequired", () => {
                        client.sendCredentials({ username: 'username', password: '' });
                    });
                    client._sock._websocket._receiveData(new Uint8Array([1, 0, 0, 1, 0]));
                    expect(client._sock).to.have.sent(new Uint8Array([0, 0, 1, 0]));

                    clock.tick();

                    const expectedResponse = [];
                    push32(expectedResponse, 8);
                    push32(expectedResponse, 0);
                    pushString(expectedResponse, 'username');
                    pushString(expectedResponse, '');
                    expect(client._sock).to.have.sent(new Uint8Array(expectedResponse));
                });

                it('should support Plain authentication with a very long username and password', function () {
                    client.addEventListener("credentialsrequired", () => {
                        client.sendCredentials({ username: 'a'.repeat(300), password: 'b'.repeat(300) });
                    });
                    client._sock._websocket._receiveData(new Uint8Array([1, 0, 0, 1, 0]));
                    expect(client._sock).to.have.sent(new Uint8Array([0, 0, 1, 0]));

                    clock.tick();

                    const expectedResponse = [];
                    push32(expectedResponse, 300);
                    push32(expectedResponse, 300);
                    pushString(expectedResponse, 'a'.repeat(300));
                    pushString(expectedResponse, 'b'.repeat(300));
                    expect(client._sock).to.have.sent(new Uint8Array(expectedResponse));
                });
            });
        });

        describe('Legacy SecurityResult', function () {
            it('should not include reason in securityfailure event for versions < 3.7', function () {
                client.addEventListener("credentialsrequired", () => {
                    client.sendCredentials({ password: 'passwd' });
                });
                const spy = sinon.spy();
                client.addEventListener("securityfailure", spy);
                sendVer('003.006\n', client);
                client._sock._websocket._receiveData(new Uint8Array([0, 0, 0, 2]));
                const challenge = [];
                for (let i = 0; i < 16; i++) { challenge[i] = i; }
                client._sock._websocket._receiveData(new Uint8Array(challenge));

                client._sock._websocket._receiveData(new Uint8Array([0, 0, 0, 2]));
                expect(spy).to.have.been.calledOnce;
                expect(spy.args[0][0].detail.status).to.equal(2);
                expect('reason' in spy.args[0][0].detail).to.be.false;
            });

            it('should not include reason in securityfailure event for versions < 3.8', function () {
                client.addEventListener("credentialsrequired", () => {
                    client.sendCredentials({ password: 'passwd' });
                });
                const spy = sinon.spy();
                client.addEventListener("securityfailure", spy);
                sendVer('003.007\n', client);
                sendSecurity(2, client);
                const challenge = [];
                for (let i = 0; i < 16; i++) { challenge[i] = i; }
                client._sock._websocket._receiveData(new Uint8Array(challenge));

                client._sock._websocket._receiveData(new Uint8Array([0, 0, 0, 2]));
                expect(spy).to.have.been.calledOnce;
                expect(spy.args[0][0].detail.status).to.equal(2);
                expect('reason' in spy.args[0][0].detail).to.be.false;
            });
        });

        describe('SecurityResult', function () {
            beforeEach(function () {
                sendVer('003.008\n', client);
                client._sock._websocket._getSentData();
                sendSecurity(1, client);
                client._sock._websocket._getSentData();
            });

            it('should fall through to ServerInitialisation on a response code of 0', function () {
                client._sock._websocket._receiveData(new Uint8Array([0, 0, 0, 0]));
                expect(client._rfbInitState).to.equal('ServerInitialisation');
            });

            it('should include reason when provided in securityfailure event', function () {
                const spy = sinon.spy();
                client.addEventListener("securityfailure", spy);
                const failureData = [0, 0, 0, 1, 0, 0, 0, 12, 115, 117, 99, 104,
                                     32, 102, 97, 105, 108, 117, 114, 101];
                client._sock._websocket._receiveData(new Uint8Array(failureData));
                expect(spy).to.have.been.calledOnce;
                expect(spy.args[0][0].detail.status).to.equal(1);
                expect(spy.args[0][0].detail.reason).to.equal('such failure');
            });

            it('should not include reason when length is zero in securityfailure event', function () {
                const spy = sinon.spy();
                client.addEventListener("securityfailure", spy);
                const failureData = [0, 0, 0, 1, 0, 0, 0, 0];
                client._sock._websocket._receiveData(new Uint8Array(failureData));
                expect(spy).to.have.been.calledOnce;
                expect(spy.args[0][0].detail.status).to.equal(1);
                expect('reason' in spy.args[0][0].detail).to.be.false;
            });
        });

        describe('ClientInitialisation', function () {
            it('should transition to the ServerInitialisation state', function () {
                const client = makeRFB();
                client._rfbConnectionState = 'connecting';
                client._rfbInitState = 'SecurityResult';
                client._sock._websocket._receiveData(new Uint8Array([0, 0, 0, 0]));
                expect(client._rfbInitState).to.equal('ServerInitialisation');
            });

            it('should send 1 if we are in shared mode', function () {
                const client = makeRFB('wss://host:8675', { shared: true });
                client._rfbConnectionState = 'connecting';
                client._rfbInitState = 'SecurityResult';
                client._sock._websocket._receiveData(new Uint8Array([0, 0, 0, 0]));
                expect(client._sock).to.have.sent(new Uint8Array([1]));
            });

            it('should send 0 if we are not in shared mode', function () {
                const client = makeRFB('wss://host:8675', { shared: false });
                client._rfbConnectionState = 'connecting';
                client._rfbInitState = 'SecurityResult';
                client._sock._websocket._receiveData(new Uint8Array([0, 0, 0, 0]));
                expect(client._sock).to.have.sent(new Uint8Array([0]));
            });
        });

        describe('ServerInitialisation', function () {
            beforeEach(function () {
                client._rfbInitState = 'ServerInitialisation';
            });

            function sendServerInit(opts, client) {
                const fullOpts = { width: 10, height: 12, bpp: 24, depth: 24, bigEndian: 0,
                                   trueColor: 1, redMax: 255, greenMax: 255, blueMax: 255,
                                   redShift: 16, greenShift: 8, blueShift: 0, name: 'a name' };
                for (let opt in opts) {
                    fullOpts[opt] = opts[opt];
                }
                const data = [];

                push16(data, fullOpts.width);
                push16(data, fullOpts.height);

                data.push(fullOpts.bpp);
                data.push(fullOpts.depth);
                data.push(fullOpts.bigEndian);
                data.push(fullOpts.trueColor);

                push16(data, fullOpts.redMax);
                push16(data, fullOpts.greenMax);
                push16(data, fullOpts.blueMax);
                push8(data, fullOpts.redShift);
                push8(data, fullOpts.greenShift);
                push8(data, fullOpts.blueShift);

                // padding
                push8(data, 0);
                push8(data, 0);
                push8(data, 0);

                client._sock._websocket._receiveData(new Uint8Array(data));

                const nameData = [];
                let nameLen = [];
                pushString(nameData, fullOpts.name);
                push32(nameLen, nameData.length);

                client._sock._websocket._receiveData(new Uint8Array(nameLen));
                client._sock._websocket._receiveData(new Uint8Array(nameData));
            }

            it('should set the framebuffer width and height', function () {
                sendServerInit({ width: 32, height: 84 }, client);
                expect(client._fbWidth).to.equal(32);
                expect(client._fbHeight).to.equal(84);
            });

            // NB(sross): we just warn, not fail, for endian-ness and shifts, so we don't test them

            it('should set the framebuffer name and call the callback', function () {
                const spy = sinon.spy();
                client.addEventListener("desktopname", spy);
                sendServerInit({ name: 'som€ nam€' }, client);

                expect(client._fbName).to.equal('som€ nam€');
                expect(spy).to.have.been.calledOnce;
                expect(spy.args[0][0].detail.name).to.equal('som€ nam€');
            });

            it('should handle the extended init message of the tight encoding', function () {
                // NB(sross): we don't actually do anything with it, so just test that we can
                //            read it w/o throwing an error
                client._rfbTightVNC = true;
                sendServerInit({}, client);

                const tightData = [];
                push16(tightData, 1);
                push16(tightData, 2);
                push16(tightData, 3);
                push16(tightData, 0);
                for (let i = 0; i < 16 + 32 + 48; i++) {
                    tightData.push(i);
                }
                client._sock._websocket._receiveData(new Uint8Array(tightData));

                expect(client._rfbConnectionState).to.equal('connected');
            });

            it('should resize the display', function () {
                sinon.spy(client._display, 'resize');
                sendServerInit({ width: 27, height: 32 }, client);

                expect(client._display.resize).to.have.been.calledOnce;
                expect(client._display.resize).to.have.been.calledWith(27, 32);
            });

            it('should grab the keyboard', function () {
                sinon.spy(client._keyboard, 'grab');
                sendServerInit({}, client);
                expect(client._keyboard.grab).to.have.been.calledOnce;
            });

            describe('Initial update request', function () {
                beforeEach(function () {
                    sinon.spy(RFB.messages, "pixelFormat");
                    sinon.spy(RFB.messages, "clientEncodings");
                    sinon.spy(RFB.messages, "fbUpdateRequest");
                });

                afterEach(function () {
                    RFB.messages.pixelFormat.restore();
                    RFB.messages.clientEncodings.restore();
                    RFB.messages.fbUpdateRequest.restore();
                });

                // TODO(directxman12): test the various options in this configuration matrix
                it('should reply with the pixel format, client encodings, and initial update request', function () {
                    sendServerInit({ width: 27, height: 32 }, client);

                    expect(RFB.messages.pixelFormat).to.have.been.calledOnce;
                    expect(RFB.messages.pixelFormat).to.have.been.calledWith(client._sock, 24, true);
                    expect(RFB.messages.pixelFormat).to.have.been.calledBefore(RFB.messages.clientEncodings);
                    expect(RFB.messages.clientEncodings).to.have.been.calledOnce;
                    expect(RFB.messages.clientEncodings.getCall(0).args[1]).to.include(encodings.encodingTight);
                    RFB.messages.clientEncodings.getCall(0).args[1].forEach((enc) => {
                        expect(enc).to.be.a('number');
                        expect(Number.isInteger(enc)).to.be.true;
                    });
                    expect(RFB.messages.clientEncodings).to.have.been.calledBefore(RFB.messages.fbUpdateRequest);
                    expect(RFB.messages.fbUpdateRequest).to.have.been.calledOnce;
                    expect(RFB.messages.fbUpdateRequest).to.have.been.calledWith(client._sock, false, 0, 0, 27, 32);
                });

                it('should reply with restricted settings for Intel AMT servers', function () {
                    sendServerInit({ width: 27, height: 32, name: "Intel(r) AMT KVM"}, client);

                    expect(RFB.messages.pixelFormat).to.have.been.calledOnce;
                    expect(RFB.messages.pixelFormat).to.have.been.calledWith(client._sock, 8, true);
                    expect(RFB.messages.pixelFormat).to.have.been.calledBefore(RFB.messages.clientEncodings);
                    expect(RFB.messages.clientEncodings).to.have.been.calledOnce;
                    expect(RFB.messages.clientEncodings.getCall(0).args[1]).to.not.include(encodings.encodingTight);
                    expect(RFB.messages.clientEncodings.getCall(0).args[1]).to.not.include(encodings.encodingHextile);
                    expect(RFB.messages.clientEncodings).to.have.been.calledBefore(RFB.messages.fbUpdateRequest);
                    expect(RFB.messages.fbUpdateRequest).to.have.been.calledOnce;
                    expect(RFB.messages.fbUpdateRequest).to.have.been.calledWith(client._sock, false, 0, 0, 27, 32);
                });
            });

            it('should send the "connect" event', function () {
                let spy = sinon.spy();
                client.addEventListener('connect', spy);
                sendServerInit({}, client);
                expect(spy).to.have.been.calledOnce;
            });
        });
    });

    describe('Protocol message processing after completing initialization', function () {
        let client;

        beforeEach(function () {
            client = makeRFB();
            client._fbName = 'some device';
            client._fbWidth = 640;
            client._fbHeight = 20;
        });

        describe('Framebuffer update handling', function () {
            it('should send an update request if there is sufficient data', function () {
                let esock = new Websock();
                let ews = new FakeWebSocket();
                ews._open();
                esock.attach(ews);
                RFB.messages.fbUpdateRequest(esock, true, 0, 0, 640, 20);
                let expected = ews._getSentData();

                client._framebufferUpdate = () => true;
                client._sock._websocket._receiveData(new Uint8Array([0]));

                expect(client._sock).to.have.sent(expected);
            });

            it('should not send an update request if we need more data', function () {
                client._sock._websocket._receiveData(new Uint8Array([0]));
                expect(client._sock).to.have.sent(new Uint8Array([]));
            });

            it('should resume receiving an update if we previously did not have enough data', function () {
                let esock = new Websock();
                let ews = new FakeWebSocket();
                ews._open();
                esock.attach(ews);
                RFB.messages.fbUpdateRequest(esock, true, 0, 0, 640, 20);
                let expected = ews._getSentData();

                // just enough to set FBU.rects
                client._sock._websocket._receiveData(new Uint8Array([0, 0, 0, 3]));
                expect(client._sock._websocket._getSentData()).to.have.length(0);

                client._framebufferUpdate = function () { this._sock.rQskipBytes(1); return true; };  // we magically have enough data
                // 247 should *not* be used as the message type here
                client._sock._websocket._receiveData(new Uint8Array([247]));
                expect(client._sock).to.have.sent(expected);
            });

            it('should not send a request in continuous updates mode', function () {
                client._enabledContinuousUpdates = true;
                client._framebufferUpdate = () => true;
                client._sock._websocket._receiveData(new Uint8Array([0]));

                expect(client._sock).to.have.sent(new Uint8Array([]));
            });

            it('should fail on an unsupported encoding', function () {
                let callback = sinon.spy();
                client.addEventListener("disconnect", callback);

                const rectInfo = { x: 8, y: 11, width: 27, height: 32, encoding: 234 };
                sendFbuMsg([rectInfo], [[]], client);

                expect(callback).to.have.been.calledOnce;
                expect(callback.args[0][0].detail.clean).to.be.false;
            });

            describe('Message encoding handlers', function () {
                beforeEach(function () {
                    // a really small frame
                    client._fbWidth = 4;
                    client._fbHeight = 4;
                    client._fbDepth = 24;
                    client._display.resize(4, 4);
                });

                it('should handle the DesktopSize pseduo-encoding', function () {
                    sinon.spy(client._display, 'resize');
                    sendFbuMsg([{ x: 0, y: 0, width: 20, height: 50, encoding: -223 }], [[]], client);

                    expect(client._fbWidth).to.equal(20);
                    expect(client._fbHeight).to.equal(50);

                    expect(client._display.resize).to.have.been.calledOnce;
                    expect(client._display.resize).to.have.been.calledWith(20, 50);
                });

                describe('the ExtendedDesktopSize pseudo-encoding handler', function () {
                    beforeEach(function () {
                        // a really small frame
                        client._fbWidth = 4;
                        client._fbHeight = 4;
                        client._display.resize(4, 4);
                        sinon.spy(client._display, 'resize');
                    });

                    function makeScreenData(nrOfScreens) {
                        const data = [];
                        push8(data, nrOfScreens);   // number-of-screens
                        push8(data, 0);               // padding
                        push16(data, 0);              // padding
                        for (let i=0; i<nrOfScreens; i += 1) {
                            push32(data, 0);  // id
                            push16(data, 0);  // x-position
                            push16(data, 0);  // y-position
                            push16(data, 20); // width
                            push16(data, 50); // height
                            push32(data, 0);  // flags
                        }
                        return data;
                    }

                    it('should handle a resize requested by this client', function () {
                        const reasonForChange = 1; // requested by this client
                        const statusCode      = 0; // No error

                        sendFbuMsg([{ x: reasonForChange, y: statusCode,
                                      width: 20, height: 50, encoding: -308 }],
                                   makeScreenData(1), client);

                        expect(client._fbWidth).to.equal(20);
                        expect(client._fbHeight).to.equal(50);

                        expect(client._display.resize).to.have.been.calledOnce;
                        expect(client._display.resize).to.have.been.calledWith(20, 50);
                    });

                    it('should handle a resize requested by another client', function () {
                        const reasonForChange = 2; // requested by another client
                        const statusCode      = 0; // No error

                        sendFbuMsg([{ x: reasonForChange, y: statusCode,
                                      width: 20, height: 50, encoding: -308 }],
                                   makeScreenData(1), client);

                        expect(client._fbWidth).to.equal(20);
                        expect(client._fbHeight).to.equal(50);

                        expect(client._display.resize).to.have.been.calledOnce;
                        expect(client._display.resize).to.have.been.calledWith(20, 50);
                    });

                    it('should be able to recieve requests which contain data for multiple screens', function () {
                        const reasonForChange = 2; // requested by another client
                        const statusCode      = 0; // No error

                        sendFbuMsg([{ x: reasonForChange, y: statusCode,
                                      width: 60, height: 50, encoding: -308 }],
                                   makeScreenData(3), client);

                        expect(client._fbWidth).to.equal(60);
                        expect(client._fbHeight).to.equal(50);

                        expect(client._display.resize).to.have.been.calledOnce;
                        expect(client._display.resize).to.have.been.calledWith(60, 50);
                    });

                    it('should not handle a failed request', function () {
                        const reasonForChange = 1; // requested by this client
                        const statusCode      = 1; // Resize is administratively prohibited

                        sendFbuMsg([{ x: reasonForChange, y: statusCode,
                                      width: 20, height: 50, encoding: -308 }],
                                   makeScreenData(1), client);

                        expect(client._fbWidth).to.equal(4);
                        expect(client._fbHeight).to.equal(4);

                        expect(client._display.resize).to.not.have.been.called;
                    });
                });

                describe('the Cursor pseudo-encoding handler', function () {
                    beforeEach(function () {
                        sinon.spy(client._cursor, 'change');
                    });

                    it('should handle a standard cursor', function () {
                        const info = { x: 5, y: 7,
                                       width: 4, height: 4,
                                       encoding: -239};
                        let rect = [];
                        let expected = [];

                        for (let i = 0;i < info.width*info.height;i++) {
                            push32(rect, 0x11223300);
                        }
                        push32(rect, 0xa0a0a0a0);

                        for (let i = 0;i < info.width*info.height/2;i++) {
                            push32(expected, 0x332211ff);
                            push32(expected, 0x33221100);
                        }
                        expected = new Uint8Array(expected);

                        sendFbuMsg([info], [rect], client);

                        expect(client._cursor.change).to.have.been.calledOnce;
                        expect(client._cursor.change).to.have.been.calledWith(expected, 5, 7, 4, 4);
                    });

                    it('should handle an empty cursor', function () {
                        const info = { x: 0, y: 0,
                                       width: 0, height: 0,
                                       encoding: -239};
                        const rect = [];

                        sendFbuMsg([info], [rect], client);

                        expect(client._cursor.change).to.have.been.calledOnce;
                        expect(client._cursor.change).to.have.been.calledWith(new Uint8Array, 0, 0, 0, 0);
                    });

                    it('should handle a transparent cursor', function () {
                        const info = { x: 5, y: 7,
                                       width: 4, height: 4,
                                       encoding: -239};
                        let rect = [];
                        let expected = [];

                        for (let i = 0;i < info.width*info.height;i++) {
                            push32(rect, 0x11223300);
                        }
                        push32(rect, 0x00000000);

                        for (let i = 0;i < info.width*info.height;i++) {
                            push32(expected, 0x33221100);
                        }
                        expected = new Uint8Array(expected);

                        sendFbuMsg([info], [rect], client);

                        expect(client._cursor.change).to.have.been.calledOnce;
                        expect(client._cursor.change).to.have.been.calledWith(expected, 5, 7, 4, 4);
                    });

                    describe('dot for empty cursor', function () {
                        beforeEach(function () {
                            client.showDotCursor = true;
                            // Was called when we enabled dot cursor
                            client._cursor.change.resetHistory();
                        });

                        it('should show a standard cursor', function () {
                            const info = { x: 5, y: 7,
                                           width: 4, height: 4,
                                           encoding: -239};
                            let rect = [];
                            let expected = [];

                            for (let i = 0;i < info.width*info.height;i++) {
                                push32(rect, 0x11223300);
                            }
                            push32(rect, 0xa0a0a0a0);

                            for (let i = 0;i < info.width*info.height/2;i++) {
                                push32(expected, 0x332211ff);
                                push32(expected, 0x33221100);
                            }
                            expected = new Uint8Array(expected);

                            sendFbuMsg([info], [rect], client);

                            expect(client._cursor.change).to.have.been.calledOnce;
                            expect(client._cursor.change).to.have.been.calledWith(expected, 5, 7, 4, 4);
                        });

                        it('should handle an empty cursor', function () {
                            const info = { x: 0, y: 0,
                                           width: 0, height: 0,
                                           encoding: -239};
                            const rect = [];
                            const dot = RFB.cursors.dot;

                            sendFbuMsg([info], [rect], client);

                            expect(client._cursor.change).to.have.been.calledOnce;
                            expect(client._cursor.change).to.have.been.calledWith(dot.rgbaPixels,
                                                                                  dot.hotx,
                                                                                  dot.hoty,
                                                                                  dot.w,
                                                                                  dot.h);
                        });

                        it('should handle a transparent cursor', function () {
                            const info = { x: 5, y: 7,
                                           width: 4, height: 4,
                                           encoding: -239};
                            let rect = [];
                            const dot = RFB.cursors.dot;

                            for (let i = 0;i < info.width*info.height;i++) {
                                push32(rect, 0x11223300);
                            }
                            push32(rect, 0x00000000);

                            sendFbuMsg([info], [rect], client);

                            expect(client._cursor.change).to.have.been.calledOnce;
                            expect(client._cursor.change).to.have.been.calledWith(dot.rgbaPixels,
                                                                                  dot.hotx,
                                                                                  dot.hoty,
                                                                                  dot.w,
                                                                                  dot.h);
                        });
                    });
                });

                describe('the VMware cursor pseudo-encoding handler', function () {
                    beforeEach(function () {
                        sinon.spy(client._cursor, 'change');
                    });
                    afterEach(function () {
                        client._cursor.change.resetHistory();
                    });

                    it('should handle the VMware cursor pseudo-encoding', function () {
                        let data = [0x00, 0x00, 0xff, 0,
                                    0x00, 0xff, 0x00, 0,
                                    0x00, 0xff, 0x00, 0,
                                    0x00, 0x00, 0xff, 0];
                        let rect = [];
                        push8(rect, 0);
                        push8(rect, 0);

                        //AND-mask
                        for (let i = 0; i < data.length; i++) {
                            push8(rect, data[i]);
                        }
                        //XOR-mask
                        for (let i = 0; i < data.length; i++) {
                            push8(rect, data[i]);
                        }

                        sendFbuMsg([{ x: 0, y: 0, width: 2, height: 2,
                                      encoding: 0x574d5664}],
                                   [rect], client);
                        expect(client._FBU.rects).to.equal(0);
                    });

                    it('should handle insufficient cursor pixel data', function () {

                        // Specified 14x23 pixels for the cursor,
                        // but only send 2x2 pixels worth of data
                        let w = 14;
                        let h = 23;
                        let data = [0x00, 0x00, 0xff, 0,
                                    0x00, 0xff, 0x00, 0];
                        let rect = [];

                        push8(rect, 0);
                        push8(rect, 0);

                        //AND-mask
                        for (let i = 0; i < data.length; i++) {
                            push8(rect, data[i]);
                        }
                        //XOR-mask
                        for (let i = 0; i < data.length; i++) {
                            push8(rect, data[i]);
                        }

                        sendFbuMsg([{ x: 0, y: 0, width: w, height: h,
                                      encoding: 0x574d5664}],
                                   [rect], client);

                        // expect one FBU to remain unhandled
                        expect(client._FBU.rects).to.equal(1);
                    });

                    it('should update the cursor when type is classic', function () {
                        let andMask =
                            [0xff, 0xff, 0xff, 0xff,  //Transparent
                             0xff, 0xff, 0xff, 0xff,  //Transparent
                             0x00, 0x00, 0x00, 0x00,  //Opaque
                             0xff, 0xff, 0xff, 0xff]; //Inverted

                        let xorMask =
                            [0x00, 0x00, 0x00, 0x00,  //Transparent
                             0x00, 0x00, 0x00, 0x00,  //Transparent
                             0x11, 0x22, 0x33, 0x44,  //Opaque
                             0xff, 0xff, 0xff, 0x44]; //Inverted

                        let rect = [];
                        push8(rect, 0); //cursor_type
                        push8(rect, 0); //padding
                        let hotx = 0;
                        let hoty = 0;
                        let w = 2;
                        let h = 2;

                        //AND-mask
                        for (let i = 0; i < andMask.length; i++) {
                            push8(rect, andMask[i]);
                        }
                        //XOR-mask
                        for (let i = 0; i < xorMask.length; i++) {
                            push8(rect, xorMask[i]);
                        }

                        let expectedRgba = [0x00, 0x00, 0x00, 0x00,
                                            0x00, 0x00, 0x00, 0x00,
                                            0x33, 0x22, 0x11, 0xff,
                                            0x00, 0x00, 0x00, 0xff];

                        sendFbuMsg([{ x: hotx, y: hoty,
                                      width: w, height: h,
                                      encoding: 0x574d5664}],
                                   [rect], client);

                        expect(client._cursor.change)
                            .to.have.been.calledOnce;
                        expect(client._cursor.change)
                            .to.have.been.calledWith(expectedRgba,
                                                     hotx, hoty,
                                                     w, h);
                    });

                    it('should update the cursor when type is alpha', function () {
                        let data = [0xee, 0x55, 0xff, 0x00, // rgba
                                    0x00, 0xff, 0x00, 0xff,
                                    0x00, 0xff, 0x00, 0x22,
                                    0x00, 0xff, 0x00, 0x22,
                                    0x00, 0xff, 0x00, 0x22,
                                    0x00, 0x00, 0xff, 0xee];
                        let rect = [];
                        push8(rect, 1); //cursor_type
                        push8(rect, 0); //padding
                        let hotx = 0;
                        let hoty = 0;
                        let w = 3;
                        let h = 2;

                        for (let i = 0; i < data.length; i++) {
                            push8(rect, data[i]);
                        }

                        let expectedRgba = [0xee, 0x55, 0xff, 0x00,
                                            0x00, 0xff, 0x00, 0xff,
                                            0x00, 0xff, 0x00, 0x22,
                                            0x00, 0xff, 0x00, 0x22,
                                            0x00, 0xff, 0x00, 0x22,
                                            0x00, 0x00, 0xff, 0xee];

                        sendFbuMsg([{ x: hotx, y: hoty,
                                      width: w, height: h,
                                      encoding: 0x574d5664}],
                                   [rect], client);

                        expect(client._cursor.change)
                            .to.have.been.calledOnce;
                        expect(client._cursor.change)
                            .to.have.been.calledWith(expectedRgba,
                                                     hotx, hoty,
                                                     w, h);
                    });

                    it('should not update cursor when incorrect cursor type given', function () {
                        let rect = [];
                        push8(rect, 3); // invalid cursor type
                        push8(rect, 0); // padding

                        client._cursor.change.resetHistory();
                        sendFbuMsg([{ x: 0, y: 0, width: 2, height: 2,
                                      encoding: 0x574d5664}],
                                   [rect], client);

                        expect(client._cursor.change)
                            .to.not.have.been.called;
                    });
                });

                it('should handle the last_rect pseudo-encoding', function () {
                    sendFbuMsg([{ x: 0, y: 0, width: 0, height: 0, encoding: -224}], [[]], client, 100);
                    // Send a bell message and make sure it is parsed
                    let spy = sinon.spy();
                    client.addEventListener("bell", spy);
                    client._sock._websocket._receiveData(new Uint8Array([0x02]));
                    expect(spy).to.have.been.calledOnce;
                });

                it('should handle the DesktopName pseudo-encoding', function () {
                    let data = [];
                    push32(data, 13);
                    pushString(data, "som€ nam€");

                    const spy = sinon.spy();
                    client.addEventListener("desktopname", spy);

                    sendFbuMsg([{ x: 0, y: 0, width: 0, height: 0, encoding: -307 }], [data], client);

                    expect(client._fbName).to.equal('som€ nam€');
                    expect(spy).to.have.been.calledOnce;
                    expect(spy.args[0][0].detail.name).to.equal('som€ nam€');
                });

            });

            describe('Caps Lock and Num Lock remote fixup', function () {
                function sendLedStateUpdate(state) {
                    let data = [];
                    push8(data, state);
                    sendFbuMsg([{ x: 0, y: 0, width: 0, height: 0, encoding: -261 }], [data], client);
                }

                let client;
                beforeEach(function () {
                    client = makeRFB();
                    sinon.stub(client, 'sendKey');
                });

                it('should toggle caps lock if remote caps lock is on and local is off', function () {
                    sendLedStateUpdate(0b100);
                    client._handleKeyEvent(0x61, 'KeyA', true, null, false);

                    expect(client.sendKey).to.have.been.calledThrice;
                    expect(client.sendKey.firstCall).to.have.been.calledWith(0xFFE5, "CapsLock", true);
                    expect(client.sendKey.secondCall).to.have.been.calledWith(0xFFE5, "CapsLock", false);
                    expect(client.sendKey.thirdCall).to.have.been.calledWith(0x61, "KeyA", true);
                });

                it('should toggle caps lock if remote caps lock is off and local is on', function () {
                    sendLedStateUpdate(0b011);
                    client._handleKeyEvent(0x41, 'KeyA', true, null, true);

                    expect(client.sendKey).to.have.been.calledThrice;
                    expect(client.sendKey.firstCall).to.have.been.calledWith(0xFFE5, "CapsLock", true);
                    expect(client.sendKey.secondCall).to.have.been.calledWith(0xFFE5, "CapsLock", false);
                    expect(client.sendKey.thirdCall).to.have.been.calledWith(0x41, "KeyA", true);
                });

                it('should not toggle caps lock if remote caps lock is on and local is on', function () {
                    sendLedStateUpdate(0b100);
                    client._handleKeyEvent(0x41, 'KeyA', true, null, true);

                    expect(client.sendKey).to.have.been.calledOnce;
                    expect(client.sendKey.firstCall).to.have.been.calledWith(0x41, "KeyA", true);
                });

                it('should not toggle caps lock if remote caps lock is off and local is off', function () {
                    sendLedStateUpdate(0b011);
                    client._handleKeyEvent(0x61, 'KeyA', true, null, false);

                    expect(client.sendKey).to.have.been.calledOnce;
                    expect(client.sendKey.firstCall).to.have.been.calledWith(0x61, "KeyA", true);
                });

                it('should not toggle caps lock if the key is caps lock', function () {
                    sendLedStateUpdate(0b011);
                    client._handleKeyEvent(0xFFE5, 'CapsLock', true, null, true);

                    expect(client.sendKey).to.have.been.calledOnce;
                    expect(client.sendKey.firstCall).to.have.been.calledWith(0xFFE5, "CapsLock", true);
                });

                it('should toggle caps lock only once', function () {
                    sendLedStateUpdate(0b100);
                    client._handleKeyEvent(0x61, 'KeyA', true, null, false);
                    client._handleKeyEvent(0x61, 'KeyA', true, null, false);

                    expect(client.sendKey).to.have.callCount(4);
                    expect(client.sendKey.firstCall).to.have.been.calledWith(0xFFE5, "CapsLock", true);
                    expect(client.sendKey.secondCall).to.have.been.calledWith(0xFFE5, "CapsLock", false);
                    expect(client.sendKey.thirdCall).to.have.been.calledWith(0x61, "KeyA", true);
                    expect(client.sendKey.lastCall).to.have.been.calledWith(0x61, "KeyA", true);
                });

                it('should retain remote caps lock state on capslock key up', function () {
                    sendLedStateUpdate(0b100);
                    client._handleKeyEvent(0xFFE5, 'CapsLock', false, null, true);

                    expect(client.sendKey).to.have.been.calledOnce;
                    expect(client.sendKey.firstCall).to.have.been.calledWith(0xFFE5, "CapsLock", false);
                    expect(client._remoteCapsLock).to.equal(true);
                });

                it('should toggle num lock if remote num lock is on and local is off', function () {
                    sendLedStateUpdate(0b010);
                    client._handleKeyEvent(0xFF9C, 'NumPad1', true, false, null);

                    expect(client.sendKey).to.have.been.calledThrice;
                    expect(client.sendKey.firstCall).to.have.been.calledWith(0xFF7F, "NumLock", true);
                    expect(client.sendKey.secondCall).to.have.been.calledWith(0xFF7F, "NumLock", false);
                    expect(client.sendKey.thirdCall).to.have.been.calledWith(0xFF9C, "NumPad1", true);
                });

                it('should toggle num lock if remote num lock is off and local is on', function () {
                    sendLedStateUpdate(0b101);
                    client._handleKeyEvent(0xFFB1, 'NumPad1', true, true, null);

                    expect(client.sendKey).to.have.been.calledThrice;
                    expect(client.sendKey.firstCall).to.have.been.calledWith(0xFF7F, "NumLock", true);
                    expect(client.sendKey.secondCall).to.have.been.calledWith(0xFF7F, "NumLock", false);
                    expect(client.sendKey.thirdCall).to.have.been.calledWith(0xFFB1, "NumPad1", true);
                });

                it('should not toggle num lock if remote num lock is on and local is on', function () {
                    sendLedStateUpdate(0b010);
                    client._handleKeyEvent(0xFFB1, 'NumPad1', true,  true, null);

                    expect(client.sendKey).to.have.been.calledOnce;
                    expect(client.sendKey.firstCall).to.have.been.calledWith(0xFFB1, "NumPad1", true);
                });

                it('should not toggle num lock if remote num lock is off and local is off', function () {
                    sendLedStateUpdate(0b101);
                    client._handleKeyEvent(0xFF9C, 'NumPad1', true, false, null);

                    expect(client.sendKey).to.have.been.calledOnce;
                    expect(client.sendKey.firstCall).to.have.been.calledWith(0xFF9C, "NumPad1", true);
                });

                it('should not toggle num lock if the key is num lock', function () {
                    sendLedStateUpdate(0b101);
                    client._handleKeyEvent(0xFF7F, 'NumLock', true, true, null);

                    expect(client.sendKey).to.have.been.calledOnce;
                    expect(client.sendKey.firstCall).to.have.been.calledWith(0xFF7F, "NumLock", true);
                });

                it('should not toggle num lock if local state is unknown', function () {
                    sendLedStateUpdate(0b010);
                    client._handleKeyEvent(0xFFB1, 'NumPad1', true, null, null);

                    expect(client.sendKey).to.have.been.calledOnce;
                    expect(client.sendKey.firstCall).to.have.been.calledWith(0xFFB1, "NumPad1", true);
                });

                it('should toggle num lock only once', function () {
                    sendLedStateUpdate(0b010);
                    client._handleKeyEvent(0xFF9C, 'NumPad1', true, false, null);
                    client._handleKeyEvent(0xFF9C, 'NumPad1', true, false, null);

                    expect(client.sendKey).to.have.callCount(4);
                    expect(client.sendKey.firstCall).to.have.been.calledWith(0xFF7F, "NumLock", true);
                    expect(client.sendKey.secondCall).to.have.been.calledWith(0xFF7F, "NumLock", false);
                    expect(client.sendKey.thirdCall).to.have.been.calledWith(0xFF9C, "NumPad1", true);
                    expect(client.sendKey.lastCall).to.have.been.calledWith(0xFF9C, "NumPad1", true);
                });
            });
        });

        describe('XVP message handling', function () {
            it('should set the XVP version and fire the callback with the version on XVP_INIT', function () {
                const spy = sinon.spy();
                client.addEventListener("capabilities", spy);
                client._sock._websocket._receiveData(new Uint8Array([250, 0, 10, 1]));
                expect(client._rfbXvpVer).to.equal(10);
                expect(spy).to.have.been.calledOnce;
                expect(spy.args[0][0].detail.capabilities.power).to.be.true;
                expect(client.capabilities.power).to.be.true;
            });

            it('should fail on unknown XVP message types', function () {
                let callback = sinon.spy();
                client.addEventListener("disconnect", callback);

                client._sock._websocket._receiveData(new Uint8Array([250, 0, 10, 237]));

                expect(callback).to.have.been.calledOnce;
                expect(callback.args[0][0].detail.clean).to.be.false;
            });
        });

        describe('Normal clipboard handling receive', function () {
            it('should fire the clipboard callback with the retrieved text on ServerCutText', function () {
                const expectedStr = 'cheese!';
                const data = [3, 0, 0, 0];
                push32(data, expectedStr.length);
                for (let i = 0; i < expectedStr.length; i++) { data.push(expectedStr.charCodeAt(i)); }
                const spy = sinon.spy();
                client.addEventListener("clipboard", spy);

                client._sock._websocket._receiveData(new Uint8Array(data));
                expect(spy).to.have.been.calledOnce;
                expect(spy.args[0][0].detail.text).to.equal(expectedStr);
            });
        });

        describe('Extended clipboard handling', function () {

            describe('Extended clipboard initialization', function () {
                beforeEach(function () {
                    sinon.spy(RFB.messages, 'extendedClipboardCaps');
                });

                afterEach(function () {
                    RFB.messages.extendedClipboardCaps.restore();
                });

                it('should update capabilities when receiving a Caps message', function () {
                    let data = [3, 0, 0, 0];
                    const flags = [0x1F, 0x00, 0x00, 0x03];
                    let fileSizes = [0x00, 0x00, 0x00, 0x1E,
                                     0x00, 0x00, 0x00, 0x3C];

                    push32(data, toUnsigned32bit(-12));
                    data = data.concat(flags);
                    data = data.concat(fileSizes);
                    client._sock._websocket._receiveData(new Uint8Array(data));

                    // Check that we give an response caps when we receive one
                    expect(RFB.messages.extendedClipboardCaps).to.have.been.calledOnce;

                    // FIXME: Can we avoid checking internal variables?
                    expect(client._clipboardServerCapabilitiesFormats[0]).to.not.equal(true);
                    expect(client._clipboardServerCapabilitiesFormats[1]).to.equal(true);
                    expect(client._clipboardServerCapabilitiesFormats[2]).to.equal(true);
                    expect(client._clipboardServerCapabilitiesActions[(1 << 24)]).to.equal(true);
                });


            });

            describe('Extended clipboard handling receive', function () {

                beforeEach(function () {
                    // Send our capabilities
                    let data = [3, 0, 0, 0];
                    const flags = [0x1F, 0x00, 0x00, 0x01];
                    let fileSizes = [0x00, 0x00, 0x00, 0x1E];

                    push32(data, toUnsigned32bit(-8));
                    data = data.concat(flags);
                    data = data.concat(fileSizes);
                    client._sock._websocket._receiveData(new Uint8Array(data));
                });

                describe('Handle Provide', function () {
                    it('should update clipboard with correct Unicode data from a Provide message', function () {
                        let expectedData = "Aå漢字!";
                        let data = [3, 0, 0, 0];
                        const flags = [0x10, 0x00, 0x00, 0x01];

                        let text = encodeUTF8("Aå漢字!");
                        let deflatedText = deflateWithSize(text);

                        // How much data we are sending.
                        push32(data, toUnsigned32bit(-(4 + deflatedText.length)));

                        data = data.concat(flags);
                        data = data.concat(Array.from(deflatedText));

                        const spy = sinon.spy();
                        client.addEventListener("clipboard", spy);

                        client._sock._websocket._receiveData(new Uint8Array(data));
                        expect(spy).to.have.been.calledOnce;
                        expect(spy.args[0][0].detail.text).to.equal(expectedData);
                        client.removeEventListener("clipboard", spy);
                    });

                    it('should update clipboard with correct escape characters from a Provide message ', function () {
                        let expectedData = "Oh\nmy\n!";
                        let data = [3, 0, 0, 0];
                        const flags = [0x10, 0x00, 0x00, 0x01];

                        let text = encodeUTF8("Oh\r\nmy\r\n!\0");

                        let deflatedText = deflateWithSize(text);

                        // How much data we are sending.
                        push32(data, toUnsigned32bit(-(4 + deflatedText.length)));

                        data = data.concat(flags);
                        data = data.concat(Array.from(deflatedText));

                        const spy = sinon.spy();
                        client.addEventListener("clipboard", spy);

                        client._sock._websocket._receiveData(new Uint8Array(data));
                        expect(spy).to.have.been.calledOnce;
                        expect(spy.args[0][0].detail.text).to.equal(expectedData);
                        client.removeEventListener("clipboard", spy);
                    });

                    it('should be able to handle large Provide messages', function () {
                        let expectedData = "hello".repeat(100000);
                        let data = [3, 0, 0, 0];
                        const flags = [0x10, 0x00, 0x00, 0x01];

                        let text = encodeUTF8(expectedData + "\0");

                        let deflatedText = deflateWithSize(text);

                        // How much data we are sending.
                        push32(data, toUnsigned32bit(-(4 + deflatedText.length)));

                        data = data.concat(flags);
                        data = data.concat(Array.from(deflatedText));

                        const spy = sinon.spy();
                        client.addEventListener("clipboard", spy);

                        client._sock._websocket._receiveData(new Uint8Array(data));
                        expect(spy).to.have.been.calledOnce;
                        expect(spy.args[0][0].detail.text).to.equal(expectedData);
                        client.removeEventListener("clipboard", spy);
                    });

                });

                describe('Handle Notify', function () {
                    beforeEach(function () {
                        sinon.spy(RFB.messages, 'extendedClipboardRequest');
                    });

                    afterEach(function () {
                        RFB.messages.extendedClipboardRequest.restore();
                    });

                    it('should make a request with supported formats when receiving a notify message', function () {
                        let data = [3, 0, 0, 0];
                        const flags = [0x08, 0x00, 0x00, 0x07];
                        push32(data, toUnsigned32bit(-4));
                        data = data.concat(flags);
                        let expectedData = [0x01];

                        client._sock._websocket._receiveData(new Uint8Array(data));

                        expect(RFB.messages.extendedClipboardRequest).to.have.been.calledOnce;
                        expect(RFB.messages.extendedClipboardRequest).to.have.been.calledWith(client._sock, expectedData);
                    });
                });

                describe('Handle Peek', function () {
                    beforeEach(function () {
                        sinon.spy(RFB.messages, 'extendedClipboardNotify');
                    });

                    afterEach(function () {
                        RFB.messages.extendedClipboardNotify.restore();
                    });

                    it('should send an empty Notify when receiving a Peek and no excisting clipboard data', function () {
                        let data = [3, 0, 0, 0];
                        const flags = [0x04, 0x00, 0x00, 0x00];
                        push32(data, toUnsigned32bit(-4));
                        data = data.concat(flags);
                        let expectedData = [];

                        client._sock._websocket._receiveData(new Uint8Array(data));

                        expect(RFB.messages.extendedClipboardNotify).to.have.been.calledOnce;
                        expect(RFB.messages.extendedClipboardNotify).to.have.been.calledWith(client._sock, expectedData);
                    });

                    it('should send a Notify message with supported formats when receiving a Peek', function () {
                        let data = [3, 0, 0, 0];
                        const flags = [0x04, 0x00, 0x00, 0x00];
                        push32(data, toUnsigned32bit(-4));
                        data = data.concat(flags);
                        let expectedData = [0x01];

                        // Needed to have clipboard data to read.
                        // This will trigger a call to Notify, reset history
                        client.clipboardPasteFrom("HejHej");
                        RFB.messages.extendedClipboardNotify.resetHistory();

                        client._sock._websocket._receiveData(new Uint8Array(data));

                        expect(RFB.messages.extendedClipboardNotify).to.have.been.calledOnce;
                        expect(RFB.messages.extendedClipboardNotify).to.have.been.calledWith(client._sock, expectedData);
                    });
                });

                describe('Handle Request', function () {
                    beforeEach(function () {
                        sinon.spy(RFB.messages, 'extendedClipboardProvide');
                    });

                    afterEach(function () {
                        RFB.messages.extendedClipboardProvide.restore();
                    });

                    it('should send a Provide message with supported formats when receiving a Request', function () {
                        let data = [3, 0, 0, 0];
                        const flags = [0x02, 0x00, 0x00, 0x01];
                        push32(data, toUnsigned32bit(-4));
                        data = data.concat(flags);
                        let expectedData = [0x01];

                        client.clipboardPasteFrom("HejHej");
                        expect(RFB.messages.extendedClipboardProvide).to.not.have.been.called;

                        client._sock._websocket._receiveData(new Uint8Array(data));

                        expect(RFB.messages.extendedClipboardProvide).to.have.been.calledOnce;
                        expect(RFB.messages.extendedClipboardProvide).to.have.been.calledWith(client._sock, expectedData, ["HejHej"]);
                    });
                });
            });

        });

        it('should fire the bell callback on Bell', function () {
            const spy = sinon.spy();
            client.addEventListener("bell", spy);
            client._sock._websocket._receiveData(new Uint8Array([2]));
            expect(spy).to.have.been.calledOnce;
        });

        it('should respond correctly to ServerFence', function () {
            const payload = "foo\x00ab9";

            let esock = new Websock();
            let ews = new FakeWebSocket();
            ews._open();
            esock.attach(ews);

            // ClientFence and ServerFence are identical in structure
            RFB.messages.clientFence(esock, (1<<0) | (1<<1), payload);
            let expected = ews._getSentData();
            RFB.messages.clientFence(esock, 0xffffffff, payload);
            let incoming = ews._getSentData();

            client._sock._websocket._receiveData(incoming);

            expect(client._sock).to.have.sent(expected);

            RFB.messages.clientFence(esock, (1<<0), payload);
            expected = ews._getSentData();
            RFB.messages.clientFence(esock, (1<<0) | (1<<31), payload);
            incoming = ews._getSentData();

            client._sock._websocket._receiveData(incoming);

            expect(client._sock).to.have.sent(expected);
        });

        it('should enable continuous updates on first EndOfContinousUpdates', function () {
            let esock = new Websock();
            let ews = new FakeWebSocket();
            ews._open();
            esock.attach(ews);
            RFB.messages.enableContinuousUpdates(esock, true, 0, 0, 640, 20);
            let expected = ews._getSentData();

            expect(client._enabledContinuousUpdates).to.be.false;

            client._sock._websocket._receiveData(new Uint8Array([150]));

            expect(client._enabledContinuousUpdates).to.be.true;
            expect(client._sock).to.have.sent(expected);
        });

        it('should disable continuous updates on subsequent EndOfContinousUpdates', function () {
            client._enabledContinuousUpdates = true;
            client._supportsContinuousUpdates = true;

            client._sock._websocket._receiveData(new Uint8Array([150]));

            expect(client._enabledContinuousUpdates).to.be.false;
        });

        it('should update continuous updates on resize', function () {
            let esock = new Websock();
            let ews = new FakeWebSocket();
            ews._open();
            esock.attach(ews);
            RFB.messages.enableContinuousUpdates(esock, true, 0, 0, 90, 700);
            let expected = ews._getSentData();

            client._resize(450, 160);

            expect(client._sock).to.have.sent(new Uint8Array([]));

            client._enabledContinuousUpdates = true;

            client._resize(90, 700);

            expect(client._sock).to.have.sent(expected);
        });

        it('should fail on an unknown message type', function () {
            let callback = sinon.spy();
            client.addEventListener("disconnect", callback);

            client._sock._websocket._receiveData(new Uint8Array([87]));

            expect(callback).to.have.been.calledOnce;
            expect(callback.args[0][0].detail.clean).to.be.false;
        });
    });

    describe('Asynchronous events', function () {
        let client;
        let pointerEvent;
        let extendedPointerEvent;
        let keyEvent;
        let qemuKeyEvent;

        beforeEach(function () {
            client = makeRFB();
            client._display.resize(100, 100);

            // We need to disable this as focusing the canvas will
            // cause the browser to scoll to it, messing up our
            // client coordinate calculations
            client.focusOnClick = false;

            pointerEvent = sinon.spy(RFB.messages, 'pointerEvent');
            extendedPointerEvent = sinon.spy(RFB.messages, 'extendedPointerEvent');
            keyEvent = sinon.spy(RFB.messages, 'keyEvent');
            qemuKeyEvent = sinon.spy(RFB.messages, 'QEMUExtendedKeyEvent');
        });

        afterEach(function () {
            pointerEvent.restore();
            extendedPointerEvent.restore();
            keyEvent.restore();
            qemuKeyEvent.restore();
        });

        describe('Mouse events', function () {

            it('should not send button messages in view-only mode', function () {
                client._viewOnly = true;
                sendMouseButtonEvent(10, 10, true, 0x1, client);

                clock.tick(50);
                expect(pointerEvent).to.not.have.been.called;
            });

            it('should not send movement messages in view-only mode', function () {
                client._viewOnly = true;
                sendMouseMoveEvent(10, 10, 0x0, client);

                clock.tick(50);
                expect(pointerEvent).to.not.have.been.called;
            });

            it('should handle left mouse button', function () {
                sendMouseButtonEvent(10, 10, true, 0x1, client);

                expect(pointerEvent).to.have.been.calledOnceWith(client._sock,
                                                                 10, 10, 0x1);
                pointerEvent.resetHistory();

                sendMouseButtonEvent(10, 10, false, 0x0, client);

                expect(pointerEvent).to.have.been.calledOnceWith(client._sock,
                                                                 10, 10, 0x0);
            });

            it('should handle middle mouse button', function () {
                sendMouseButtonEvent(10, 10, true, 0x4, client);

                expect(pointerEvent).to.have.been.calledOnceWith(client._sock,
                                                                 10, 10, 0x2);
                pointerEvent.resetHistory();

                sendMouseButtonEvent(10, 10, false, 0x0, client);

                expect(pointerEvent).to.have.been.calledOnceWith(client._sock,
                                                                 10, 10, 0x0);
            });

            it('should handle right mouse button', function () {
                sendMouseButtonEvent(10, 10, true, 0x2, client);

                expect(pointerEvent).to.have.been.calledOnceWith(client._sock,
                                                                 10, 10, 0x4);
                pointerEvent.resetHistory();

                sendMouseButtonEvent(10, 10, false, 0x0, client);

                expect(pointerEvent).to.have.been.calledOnceWith(client._sock,
                                                                 10, 10, 0x0);
            });

            it('should handle multiple mouse buttons', function () {
                sendMouseButtonEvent(10, 10, true, 0x1, client);
                sendMouseButtonEvent(10, 10, true, 0x3, client);

                expect(pointerEvent).to.have.been.calledTwice;
                expect(pointerEvent.firstCall).to.have.been.calledWith(client._sock,
                                                                       10, 10, 0x1);
                expect(pointerEvent.secondCall).to.have.been.calledWith(client._sock,
                                                                        10, 10, 0x5);

                pointerEvent.resetHistory();


                sendMouseButtonEvent(10, 10, false, 0x2, client);
                sendMouseButtonEvent(10, 10, false, 0x0, client);

                expect(pointerEvent).to.have.been.calledTwice;
                expect(pointerEvent.firstCall).to.have.been.calledWith(client._sock,
                                                                       10, 10, 0x4);
                expect(pointerEvent.secondCall).to.have.been.calledWith(client._sock,
                                                                        10, 10, 0x0);
            });

            it('should handle mouse movement', function () {
                sendMouseMoveEvent(50, 70, 0x0, client);
                expect(pointerEvent).to.have.been.calledOnceWith(client._sock,
                                                                 50, 70, 0x0);
            });

            it('should handle click and drag', function () {
                sendMouseButtonEvent(10, 10, true, 0x1, client);
                sendMouseMoveEvent(50, 70, 0x1, client);

                expect(pointerEvent).to.have.been.calledTwice;
                expect(pointerEvent.firstCall).to.have.been.calledWith(client._sock,
                                                                       10, 10, 0x1);
                expect(pointerEvent.secondCall).to.have.been.calledWith(client._sock,
                                                                        50, 70, 0x1);

                pointerEvent.resetHistory();

                sendMouseButtonEvent(50, 70, false, 0x0, client);

                expect(pointerEvent).to.have.been.calledOnceWith(client._sock,
                                                                 50, 70, 0x0);
            });

            it('should send extended pointer event when server supports extended pointer events', function () {
                // Enable extended pointer events
                sendFbuMsg([{ x: 0, y: 0, width: 0, height: 0, encoding: -316 }], [[]], client);

                sendMouseButtonEvent(50, 70, true, 0x10, client);

                expect(extendedPointerEvent).to.have.been.calledOnceWith(client._sock,
                                                                         50, 70, 0x100);
            });

            it('should send normal pointer event when server does not support extended pointer events', function () {
                sendMouseButtonEvent(50, 70, true, 0x10, client);

                expect(pointerEvent).to.have.been.calledOnceWith(client._sock,
                                                                 50, 70, 0x100);
            });

            describe('Event aggregation', function () {
                it('should send a single pointer event on mouse movement', function () {
                    sendMouseMoveEvent(50, 70, 0x0, client);
                    clock.tick(100);
                    expect(pointerEvent).to.have.been.calledOnceWith(client._sock,
                                                                     50, 70, 0x0);
                });

                it('should delay one move if two events are too close', function () {
                    sendMouseMoveEvent(18, 30, 0x0, client);
                    sendMouseMoveEvent(20, 50, 0x0, client);

                    expect(pointerEvent).to.have.been.calledOnceWith(client._sock,
                                                                     18, 30, 0x0);
                    pointerEvent.resetHistory();

                    clock.tick(100);

                    expect(pointerEvent).to.have.been.calledOnceWith(client._sock,
                                                                     20, 50, 0x0);
                });

                it('should only send first and last move of many close events', function () {
                    sendMouseMoveEvent(18, 30, 0x0, client);
                    sendMouseMoveEvent(20, 50, 0x0, client);
                    sendMouseMoveEvent(21, 55, 0x0, client);

                    expect(pointerEvent).to.have.been.calledOnceWith(client._sock,
                                                                     18, 30, 0x0);
                    pointerEvent.resetHistory();

                    clock.tick(100);

                    expect(pointerEvent).to.have.been.calledOnceWith(client._sock,
                                                                     21, 55, 0x0);
                });

                // We selected the 17ms since that is ~60 FPS
                it('should send move events every 17 ms', function () {
                    sendMouseMoveEvent(1, 10, 0x0, client);  // instant send
                    clock.tick(10);

                    expect(pointerEvent).to.have.been.calledOnceWith(client._sock,
                                                                     1, 10, 0x0);
                    pointerEvent.resetHistory();

                    sendMouseMoveEvent(2, 20, 0x0, client);  // delayed
                    clock.tick(10);        // timeout send

                    expect(pointerEvent).to.have.been.calledOnceWith(client._sock,
                                                                     2, 20, 0x0);
                    pointerEvent.resetHistory();

                    sendMouseMoveEvent(3, 30, 0x0, client);  // delayed
                    clock.tick(10);
                    sendMouseMoveEvent(4, 40, 0x0, client);  // delayed
                    clock.tick(10);        // timeout send

                    expect(pointerEvent).to.have.been.calledOnceWith(client._sock,
                                                                     4, 40, 0x0);
                    pointerEvent.resetHistory();

                    sendMouseMoveEvent(5, 50, 0x0, client);  // delayed

                    expect(pointerEvent).to.not.have.been.called;
                });

                it('should send waiting move events before a button press', function () {
                    sendMouseMoveEvent(13, 9, 0x0, client);

                    expect(pointerEvent).to.have.been.calledOnceWith(client._sock,
                                                                     13, 9, 0x0);
                    pointerEvent.resetHistory();

                    sendMouseMoveEvent(20, 70, 0x0, client);

                    expect(pointerEvent).to.not.have.been.called;

                    sendMouseButtonEvent(20, 70, true, 0x1, client);

                    expect(pointerEvent).to.have.been.calledTwice;
                    expect(pointerEvent.firstCall).to.have.been.calledWith(client._sock,
                                                                           20, 70, 0x0);
                    expect(pointerEvent.secondCall).to.have.been.calledWith(client._sock,
                                                                            20, 70, 0x1);
                });

                it('should send move events with enough time apart normally', function () {
                    sendMouseMoveEvent(58, 60, 0x0, client);

                    expect(pointerEvent).to.have.been.calledOnceWith(client._sock,
                                                                     58, 60, 0x0);
                    pointerEvent.resetHistory();

                    clock.tick(20);

                    sendMouseMoveEvent(25, 60, 0x0, client);

                    expect(pointerEvent).to.have.been.calledOnceWith(client._sock,
                                                                     25, 60, 0x0);
                    pointerEvent.resetHistory();
                });

                it('should not send waiting move events if disconnected', function () {
                    sendMouseMoveEvent(88, 99, 0x0, client);

                    expect(pointerEvent).to.have.been.calledOnceWith(client._sock,
                                                                     88, 99, 0x0);
                    pointerEvent.resetHistory();

                    sendMouseMoveEvent(66, 77, 0x0, client);
                    client.disconnect();
                    clock.tick(20);

                    expect(pointerEvent).to.not.have.been.called;
                });
            });

            it.skip('should block click events', function () {
                /* FIXME */
            });

            it.skip('should block contextmenu events', function () {
                /* FIXME */
            });
        });

        describe('Wheel events', function () {
            function sendWheelEvent(x, y, dx, dy, mode=0, buttons=0) {
                let pos = elementToClient(x, y, client);
                let ev;

                ev = new WheelEvent('wheel',
                                    { 'screenX': pos.x + window.screenX,
                                      'screenY': pos.y + window.screenY,
                                      'clientX': pos.x,
                                      'clientY': pos.y,
                                      'deltaX': dx,
                                      'deltaY': dy,
                                      'deltaMode': mode,
                                      'buttons': buttons });
                client._canvas.dispatchEvent(ev);
            }

            it('should handle wheel up event', function () {
                sendWheelEvent(10, 10, 0, -50);

                expect(pointerEvent).to.have.been.calledTwice;
                expect(pointerEvent.firstCall).to.have.been.calledWith(client._sock,
                                                                       10, 10, 1<<3);
                expect(pointerEvent.secondCall).to.have.been.calledWith(client._sock,
                                                                        10, 10, 0);
            });

            it('should handle wheel down event', function () {
                sendWheelEvent(10, 10, 0, 50);

                expect(pointerEvent).to.have.been.calledTwice;
                expect(pointerEvent.firstCall).to.have.been.calledWith(client._sock,
                                                                       10, 10, 1<<4);
                expect(pointerEvent.secondCall).to.have.been.calledWith(client._sock,
                                                                        10, 10, 0);
            });

            it('should handle wheel left event', function () {
                sendWheelEvent(10, 10, -50, 0);

                expect(pointerEvent).to.have.been.calledTwice;
                expect(pointerEvent.firstCall).to.have.been.calledWith(client._sock,
                                                                       10, 10, 1<<5);
                expect(pointerEvent.secondCall).to.have.been.calledWith(client._sock,
                                                                        10, 10, 0);
            });

            it('should handle wheel right event', function () {
                sendWheelEvent(10, 10, 50, 0);

                expect(pointerEvent).to.have.been.calledTwice;
                expect(pointerEvent.firstCall).to.have.been.calledWith(client._sock,
                                                                       10, 10, 1<<6);
                expect(pointerEvent.secondCall).to.have.been.calledWith(client._sock,
                                                                        10, 10, 0);
            });

            it('should ignore wheel when in view only', function () {
                client._viewOnly = true;

                sendWheelEvent(10, 10, 50, 0);

                expect(pointerEvent).to.not.have.been.called;
            });

            it('should accumulate wheel events if small enough', function () {
                sendWheelEvent(10, 10, 0, 20);
                sendWheelEvent(10, 10, 0, 20);

                expect(pointerEvent).to.not.have.been.called;

                sendWheelEvent(10, 10, 0, 20);

                expect(pointerEvent).to.have.been.calledTwice;
                expect(pointerEvent.firstCall).to.have.been.calledWith(client._sock,
                                                                       10, 10, 1<<4);
                expect(pointerEvent.secondCall).to.have.been.calledWith(client._sock,
                                                                        10, 10, 0);
            });

            it('should not accumulate large wheel events', function () {
                sendWheelEvent(10, 10, 0, 400);

                expect(pointerEvent).to.have.been.calledTwice;
                expect(pointerEvent.firstCall).to.have.been.calledWith(client._sock,
                                                                       10, 10, 1<<4);
                expect(pointerEvent.secondCall).to.have.been.calledWith(client._sock,
                                                                        10, 10, 0);
            });

            it('should handle line based wheel event', function () {
                sendWheelEvent(10, 10, 0, 3, 1);

                expect(pointerEvent).to.have.been.calledTwice;
                expect(pointerEvent.firstCall).to.have.been.calledWith(client._sock,
                                                                       10, 10, 1<<4);
                expect(pointerEvent.secondCall).to.have.been.calledWith(client._sock,
                                                                        10, 10, 0);
            });

            it('should handle page based wheel event', function () {
                sendWheelEvent(10, 10, 0, 3, 2);

                expect(pointerEvent).to.have.been.calledTwice;
                expect(pointerEvent.firstCall).to.have.been.calledWith(client._sock,
                                                                       10, 10, 1<<4);
                expect(pointerEvent.secondCall).to.have.been.calledWith(client._sock,
                                                                        10, 10, 0);
            });

            it('should handle wheel event with buttons pressed', function () {
                sendMouseButtonEvent(10, 10, true, 0x1, client);
                sendWheelEvent(10, 10, 0, 50, 0, 0x1);

                expect(pointerEvent).to.have.been.called.calledThrice;

                expect(pointerEvent.firstCall).to.have.been.calledWith(client._sock,
                                                                       10, 10, 0x1);
                expect(pointerEvent.secondCall).to.have.been.calledWith(client._sock,
                                                                        10, 10, 0x11);
                expect(pointerEvent.thirdCall).to.have.been.calledWith(client._sock,
                                                                       10, 10, 0x1);
            });

        });

        describe('Keyboard events', function () {
            it('should send a key message on a key press', function () {
                let esock = new Websock();
                let ews = new FakeWebSocket();
                ews._open();
                esock.attach(ews);
                RFB.messages.keyEvent(esock, 0x41, 1);
                let expected = ews._getSentData();

                client._handleKeyEvent(0x41, 'KeyA', true);

                expect(client._sock).to.have.sent(expected);
            });

            it('should not send messages in view-only mode', function () {
                client._viewOnly = true;
                sinon.spy(client._sock, 'flush');
                client._handleKeyEvent('a', 'KeyA', true);
                expect(client._sock.flush).to.not.have.been.called;
            });
        });

        describe('Gesture event handlers', function () {
            describe('Gesture onetap', function () {
                it('should handle onetap events', function () {
                    let bmask = 0x1;

                    gestureStart('onetap', 20, 40, client);
                    gestureEnd('onetap', 20, 40, client);

                    expect(pointerEvent).to.have.been.calledThrice;
                    expect(pointerEvent.firstCall).to.have.been.calledWith(client._sock,
                                                                           20, 40, 0x0);
                    expect(pointerEvent.secondCall).to.have.been.calledWith(client._sock,
                                                                            20, 40, bmask);
                    expect(pointerEvent.thirdCall).to.have.been.calledWith(client._sock,
                                                                           20, 40, 0x0);
                });

                it('should keep same position for multiple onetap events', function () {
                    let bmask = 0x1;

                    gestureStart('onetap', 20, 40, client);
                    gestureEnd('onetap', 20, 40, client);

                    expect(pointerEvent).to.have.been.calledThrice;
                    expect(pointerEvent.firstCall).to.have.been.calledWith(client._sock,
                                                                           20, 40, 0x0);
                    expect(pointerEvent.secondCall).to.have.been.calledWith(client._sock,
                                                                            20, 40, bmask);
                    expect(pointerEvent.thirdCall).to.have.been.calledWith(client._sock,
                                                                           20, 40, 0x0);

                    pointerEvent.resetHistory();

                    gestureStart('onetap', 20, 50, client);
                    gestureEnd('onetap', 20, 50, client);

                    expect(pointerEvent).to.have.been.calledThrice;
                    expect(pointerEvent.firstCall).to.have.been.calledWith(client._sock,
                                                                           20, 40, 0x0);
                    expect(pointerEvent.secondCall).to.have.been.calledWith(client._sock,
                                                                            20, 40, bmask);
                    expect(pointerEvent.thirdCall).to.have.been.calledWith(client._sock,
                                                                           20, 40, 0x0);

                    pointerEvent.resetHistory();

                    gestureStart('onetap', 30, 50, client);
                    gestureEnd('onetap', 30, 50, client);

                    expect(pointerEvent).to.have.been.calledThrice;
                    expect(pointerEvent.firstCall).to.have.been.calledWith(client._sock,
                                                                           20, 40, 0x0);
                    expect(pointerEvent.secondCall).to.have.been.calledWith(client._sock,
                                                                            20, 40, bmask);
                    expect(pointerEvent.thirdCall).to.have.been.calledWith(client._sock,
                                                                           20, 40, 0x0);
                });

                it('should not keep same position for onetap events when too far apart', function () {
                    let bmask = 0x1;

                    gestureStart('onetap', 20, 40, client);
                    gestureEnd('onetap', 20, 40, client);

                    expect(pointerEvent).to.have.been.calledThrice;
                    expect(pointerEvent.firstCall).to.have.been.calledWith(client._sock,
                                                                           20, 40, 0x0);
                    expect(pointerEvent.secondCall).to.have.been.calledWith(client._sock,
                                                                            20, 40, bmask);
                    expect(pointerEvent.thirdCall).to.have.been.calledWith(client._sock,
                                                                           20, 40, 0x0);

                    pointerEvent.resetHistory();

                    gestureStart('onetap', 80, 95, client);
                    gestureEnd('onetap', 80, 95, client);

                    expect(pointerEvent).to.have.been.calledThrice;
                    expect(pointerEvent.firstCall).to.have.been.calledWith(client._sock,
                                                                           80, 95, 0x0);
                    expect(pointerEvent.secondCall).to.have.been.calledWith(client._sock,
                                                                            80, 95, bmask);
                    expect(pointerEvent.thirdCall).to.have.been.calledWith(client._sock,
                                                                           80, 95, 0x0);
                });

                it('should not keep same position for onetap events when enough time inbetween', function () {
                    let bmask = 0x1;

                    gestureStart('onetap', 10, 20, client);
                    gestureEnd('onetap', 10, 20, client);

                    expect(pointerEvent).to.have.been.calledThrice;
                    expect(pointerEvent.firstCall).to.have.been.calledWith(client._sock,
                                                                           10, 20, 0x0);
                    expect(pointerEvent.secondCall).to.have.been.calledWith(client._sock,
                                                                            10, 20, bmask);
                    expect(pointerEvent.thirdCall).to.have.been.calledWith(client._sock,
                                                                           10, 20, 0x0);

                    pointerEvent.resetHistory();
                    this.clock.tick(1500);

                    gestureStart('onetap', 15, 20, client);
                    gestureEnd('onetap', 15, 20, client);

                    expect(pointerEvent).to.have.been.calledThrice;
                    expect(pointerEvent.firstCall).to.have.been.calledWith(client._sock,
                                                                           15, 20, 0x0);
                    expect(pointerEvent.secondCall).to.have.been.calledWith(client._sock,
                                                                            15, 20, bmask);
                    expect(pointerEvent.thirdCall).to.have.been.calledWith(client._sock,
                                                                           15, 20, 0x0);

                    pointerEvent.resetHistory();
                });
            });

            describe('Gesture twotap', function () {
                it('should handle gesture twotap events', function () {
                    let bmask = 0x4;

                    gestureStart("twotap", 20, 40, client);

                    expect(pointerEvent).to.have.been.calledThrice;
                    expect(pointerEvent.firstCall).to.have.been.calledWith(client._sock,
                                                                           20, 40, 0x0);
                    expect(pointerEvent.secondCall).to.have.been.calledWith(client._sock,
                                                                            20, 40, bmask);
                    expect(pointerEvent.thirdCall).to.have.been.calledWith(client._sock,
                                                                           20, 40, 0x0);
                });

                it('should keep same position for multiple twotap events', function () {
                    let bmask = 0x4;

                    for (let offset = 0;offset < 30;offset += 10) {
                        pointerEvent.resetHistory();

                        gestureStart('twotap', 20, 40 + offset, client);
                        gestureEnd('twotap', 20, 40 + offset, client);

                        expect(pointerEvent).to.have.been.calledThrice;
                        expect(pointerEvent.firstCall).to.have.been.calledWith(client._sock,
                                                                               20, 40, 0x0);
                        expect(pointerEvent.secondCall).to.have.been.calledWith(client._sock,
                                                                                20, 40, bmask);
                        expect(pointerEvent.thirdCall).to.have.been.calledWith(client._sock,
                                                                               20, 40, 0x0);
                    }
                });
            });

            describe('Gesture threetap', function () {
                it('should handle gesture start for threetap events', function () {
                    let bmask = 0x2;

                    gestureStart("threetap", 20, 40, client);

                    expect(pointerEvent).to.have.been.calledThrice;
                    expect(pointerEvent.firstCall).to.have.been.calledWith(client._sock,
                                                                           20, 40, 0x0);
                    expect(pointerEvent.secondCall).to.have.been.calledWith(client._sock,
                                                                            20, 40, bmask);
                    expect(pointerEvent.thirdCall).to.have.been.calledWith(client._sock,
                                                                           20, 40, 0x0);
                });

                it('should keep same position for multiple threetap events', function () {
                    let bmask = 0x2;

                    for (let offset = 0;offset < 30;offset += 10) {
                        pointerEvent.resetHistory();

                        gestureStart('threetap', 20, 40 + offset, client);
                        gestureEnd('threetap', 20, 40 + offset, client);

                        expect(pointerEvent).to.have.been.calledThrice;
                        expect(pointerEvent.firstCall).to.have.been.calledWith(client._sock,
                                                                               20, 40, 0x0);
                        expect(pointerEvent.secondCall).to.have.been.calledWith(client._sock,
                                                                                20, 40, bmask);
                        expect(pointerEvent.thirdCall).to.have.been.calledWith(client._sock,
                                                                               20, 40, 0x0);
                    }
                });
            });

            describe('Gesture drag', function () {
                it('should handle gesture drag events', function () {
                    let bmask = 0x1;

                    gestureStart('drag', 20, 40, client);

                    expect(pointerEvent).to.have.been.calledTwice;
                    expect(pointerEvent.firstCall).to.have.been.calledWith(client._sock,
                                                                           20, 40, 0x0);
                    expect(pointerEvent.secondCall).to.have.been.calledWith(client._sock,
                                                                            20, 40, bmask);

                    pointerEvent.resetHistory();

                    gestureMove('drag', 30, 50, client);
                    clock.tick(50);

                    expect(pointerEvent).to.have.been.calledOnce;
                    expect(pointerEvent).to.have.been.calledWith(client._sock,
                                                                 30, 50, bmask);

                    pointerEvent.resetHistory();

                    gestureEnd('drag', 30, 50, client);

                    expect(pointerEvent).to.have.been.calledTwice;
                    expect(pointerEvent.firstCall).to.have.been.calledWith(client._sock,
                                                                           30, 50, bmask);
                    expect(pointerEvent.secondCall).to.have.been.calledWith(client._sock,
                                                                            30, 50, 0x0);
                });
            });

            describe('Gesture long press', function () {
                it('should handle long press events', function () {
                    let bmask = 0x4;

                    gestureStart('longpress', 20, 40, client);

                    expect(pointerEvent).to.have.been.calledTwice;
                    expect(pointerEvent.firstCall).to.have.been.calledWith(client._sock,
                                                                           20, 40, 0x0);
                    expect(pointerEvent.secondCall).to.have.been.calledWith(client._sock,
                                                                            20, 40, bmask);
                    pointerEvent.resetHistory();

                    gestureMove('longpress', 40, 60, client);
                    clock.tick(50);

                    expect(pointerEvent).to.have.been.calledOnceWith(client._sock,
                                                                     40, 60, bmask);

                    pointerEvent.resetHistory();

                    gestureEnd('longpress', 40, 60, client);

                    expect(pointerEvent).to.have.been.calledTwice;
                    expect(pointerEvent.firstCall).to.have.been.calledWith(client._sock,
                                                                           40, 60, bmask);
                    expect(pointerEvent.secondCall).to.have.been.calledWith(client._sock,
                                                                            40, 60, 0x0);
                });
            });

            describe('Gesture twodrag', function () {
                it('should handle gesture twodrag up events', function () {
                    let bmask = 0x10; // Button mask for scroll down

                    gestureStart('twodrag', 20, 40, client, 0, 0);

                    expect(pointerEvent).to.have.been.calledOnceWith(client._sock,
                                                                     20, 40, 0x0);

                    pointerEvent.resetHistory();

                    gestureMove('twodrag', 20, 40, client, 0, -60);

                    expect(pointerEvent).to.have.been.calledThrice;
                    expect(pointerEvent.firstCall).to.have.been.calledWith(client._sock,
                                                                           20, 40, 0x0);
                    expect(pointerEvent.secondCall).to.have.been.calledWith(client._sock,
                                                                            20, 40, bmask);
                    expect(pointerEvent.thirdCall).to.have.been.calledWith(client._sock,
                                                                           20, 40, 0x0);
                });

                it('should handle gesture twodrag down events', function () {
                    let bmask = 0x8; // Button mask for scroll up

                    gestureStart('twodrag', 20, 40, client, 0, 0);

                    expect(pointerEvent).to.have.been.calledOnceWith(client._sock,
                                                                     20, 40, 0x0);

                    pointerEvent.resetHistory();

                    gestureMove('twodrag', 20, 40, client, 0, 60);

                    expect(pointerEvent).to.have.been.calledThrice;
                    expect(pointerEvent.firstCall).to.have.been.calledWith(client._sock,
                                                                           20, 40, 0x0);
                    expect(pointerEvent.secondCall).to.have.been.calledWith(client._sock,
                                                                            20, 40, bmask);
                    expect(pointerEvent.thirdCall).to.have.been.calledWith(client._sock,
                                                                           20, 40, 0x0);
                });

                it('should handle gesture twodrag right events', function () {
                    let bmask = 0x20; // Button mask for scroll right

                    gestureStart('twodrag', 20, 40, client, 0, 0);

                    expect(pointerEvent).to.have.been.calledOnceWith(client._sock,
                                                                     20, 40, 0x0);

                    pointerEvent.resetHistory();

                    gestureMove('twodrag', 20, 40, client, 60, 0);

                    expect(pointerEvent).to.have.been.calledThrice;
                    expect(pointerEvent.firstCall).to.have.been.calledWith(client._sock,
                                                                           20, 40, 0x0);
                    expect(pointerEvent.secondCall).to.have.been.calledWith(client._sock,
                                                                            20, 40, bmask);
                    expect(pointerEvent.thirdCall).to.have.been.calledWith(client._sock,
                                                                           20, 40, 0x0);
                });

                it('should handle gesture twodrag left events', function () {
                    let bmask = 0x40; // Button mask for scroll left

                    gestureStart('twodrag', 20, 40, client, 0, 0);

                    expect(pointerEvent).to.have.been.calledOnceWith(client._sock,
                                                                     20, 40, 0x0);

                    pointerEvent.resetHistory();

                    gestureMove('twodrag', 20, 40, client, -60, 0);

                    expect(pointerEvent).to.have.been.calledThrice;
                    expect(pointerEvent.firstCall).to.have.been.calledWith(client._sock,
                                                                           20, 40, 0x0);
                    expect(pointerEvent.secondCall).to.have.been.calledWith(client._sock,
                                                                            20, 40, bmask);
                    expect(pointerEvent.thirdCall).to.have.been.calledWith(client._sock,
                                                                           20, 40, 0x0);
                });

                it('should handle gesture twodrag diag events', function () {
                    let scrlUp = 0x8; // Button mask for scroll up
                    let scrlRight = 0x20; // Button mask for scroll right

                    gestureStart('twodrag', 20, 40, client, 0, 0);

                    expect(pointerEvent).to.have.been.calledOnceWith(client._sock,
                                                                     20, 40, 0x0);

                    pointerEvent.resetHistory();

                    gestureMove('twodrag', 20, 40, client, 60, 60);

                    expect(pointerEvent).to.have.been.callCount(5);
                    expect(pointerEvent.getCall(0)).to.have.been.calledWith(client._sock,
                                                                            20, 40, 0x0);
                    expect(pointerEvent.getCall(1)).to.have.been.calledWith(client._sock,
                                                                            20, 40, scrlUp);
                    expect(pointerEvent.getCall(2)).to.have.been.calledWith(client._sock,
                                                                            20, 40, 0x0);
                    expect(pointerEvent.getCall(3)).to.have.been.calledWith(client._sock,
                                                                            20, 40, scrlRight);
                    expect(pointerEvent.getCall(4)).to.have.been.calledWith(client._sock,
                                                                            20, 40, 0x0);
                });

                it('should handle multiple small gesture twodrag events', function () {
                    let bmask = 0x8; // Button mask for scroll up

                    gestureStart('twodrag', 20, 40, client, 0, 0);

                    expect(pointerEvent).to.have.been.calledOnceWith(client._sock,
                                                                     20, 40, 0x0);

                    pointerEvent.resetHistory();

                    gestureMove('twodrag', 20, 40, client, 0, 10);
                    clock.tick(50);

                    expect(pointerEvent).to.have.been.calledOnceWith(client._sock,
                                                                     20, 40, 0x0);

                    pointerEvent.resetHistory();

                    gestureMove('twodrag', 20, 40, client, 0, 20);
                    clock.tick(50);

                    expect(pointerEvent).to.have.been.calledOnceWith(client._sock,
                                                                     20, 40, 0x0);

                    pointerEvent.resetHistory();

                    gestureMove('twodrag', 20, 40, client, 0, 60);

                    expect(pointerEvent).to.have.been.calledThrice;
                    expect(pointerEvent.firstCall).to.have.been.calledWith(client._sock,
                                                                           20, 40, 0x0);
                    expect(pointerEvent.secondCall).to.have.been.calledWith(client._sock,
                                                                            20, 40, bmask);
                    expect(pointerEvent.thirdCall).to.have.been.calledWith(client._sock,
                                                                           20, 40, 0x0);
                });

                it('should handle large gesture twodrag events', function () {
                    let bmask = 0x8; // Button mask for scroll up

                    gestureStart('twodrag', 30, 50, client, 0, 0);

                    expect(pointerEvent).
                        to.have.been.calledOnceWith(client._sock, 30, 50, 0x0);

                    pointerEvent.resetHistory();

                    gestureMove('twodrag', 30, 50, client, 0, 200);

                    expect(pointerEvent).to.have.callCount(7);
                    expect(pointerEvent.getCall(0)).to.have.been.calledWith(client._sock,
                                                                            30, 50, 0x0);
                    expect(pointerEvent.getCall(1)).to.have.been.calledWith(client._sock,
                                                                            30, 50, bmask);
                    expect(pointerEvent.getCall(2)).to.have.been.calledWith(client._sock,
                                                                            30, 50, 0x0);
                    expect(pointerEvent.getCall(3)).to.have.been.calledWith(client._sock,
                                                                            30, 50, bmask);
                    expect(pointerEvent.getCall(4)).to.have.been.calledWith(client._sock,
                                                                            30, 50, 0x0);
                    expect(pointerEvent.getCall(5)).to.have.been.calledWith(client._sock,
                                                                            30, 50, bmask);
                    expect(pointerEvent.getCall(6)).to.have.been.calledWith(client._sock,
                                                                            30, 50, 0x0);
                });
            });

            describe('Gesture pinch', function () {
                it('should handle gesture pinch in events', function () {
                    let keysym = KeyTable.XK_Control_L;
                    let bmask = 0x10; // Button mask for scroll down

                    gestureStart('pinch', 20, 40, client, 90, 90);

                    expect(pointerEvent).to.have.been.calledOnceWith(client._sock,
                                                                     20, 40, 0x0);
                    expect(keyEvent).to.not.have.been.called;

                    pointerEvent.resetHistory();

                    gestureMove('pinch', 20, 40, client, 30, 30);

                    expect(pointerEvent).to.have.been.calledThrice;
                    expect(pointerEvent.firstCall).to.have.been.calledWith(client._sock,
                                                                           20, 40, 0x0);
                    expect(pointerEvent.secondCall).to.have.been.calledWith(client._sock,
                                                                            20, 40, bmask);
                    expect(pointerEvent.thirdCall).to.have.been.calledWith(client._sock,
                                                                           20, 40, 0x0);

                    expect(keyEvent).to.have.been.calledTwice;
                    expect(keyEvent.firstCall).to.have.been.calledWith(client._sock,
                                                                       keysym, 1);
                    expect(keyEvent.secondCall).to.have.been.calledWith(client._sock,
                                                                        keysym, 0);

                    expect(keyEvent.firstCall).to.have.been.calledBefore(pointerEvent.secondCall);
                    expect(keyEvent.lastCall).to.have.been.calledAfter(pointerEvent.lastCall);

                    pointerEvent.resetHistory();
                    keyEvent.resetHistory();

                    gestureEnd('pinch', 20, 40, client);

                    expect(pointerEvent).to.not.have.been.called;
                    expect(keyEvent).to.not.have.been.called;
                });

                it('should handle gesture pinch out events', function () {
                    let keysym = KeyTable.XK_Control_L;
                    let bmask = 0x8; // Button mask for scroll up

                    gestureStart('pinch', 10, 20, client, 10, 20);

                    expect(pointerEvent).to.have.been.calledOnceWith(client._sock,
                                                                     10, 20, 0x0);
                    expect(keyEvent).to.not.have.been.called;

                    pointerEvent.resetHistory();

                    gestureMove('pinch', 10, 20, client, 70, 80);

                    expect(pointerEvent).to.have.been.calledThrice;
                    expect(pointerEvent.firstCall).to.have.been.calledWith(client._sock,
                                                                           10, 20, 0x0);
                    expect(pointerEvent.secondCall).to.have.been.calledWith(client._sock,
                                                                            10, 20, bmask);
                    expect(pointerEvent.thirdCall).to.have.been.calledWith(client._sock,
                                                                           10, 20, 0x0);

                    expect(keyEvent).to.have.been.calledTwice;
                    expect(keyEvent.firstCall).to.have.been.calledWith(client._sock,
                                                                       keysym, 1);
                    expect(keyEvent.secondCall).to.have.been.calledWith(client._sock,
                                                                        keysym, 0);

                    expect(keyEvent.firstCall).to.have.been.calledBefore(pointerEvent.secondCall);
                    expect(keyEvent.lastCall).to.have.been.calledAfter(pointerEvent.lastCall);

                    pointerEvent.resetHistory();
                    keyEvent.resetHistory();

                    gestureEnd('pinch', 10, 20, client);

                    expect(pointerEvent).to.not.have.been.called;
                    expect(keyEvent).to.not.have.been.called;
                });

                it('should handle large gesture pinch', function () {
                    let keysym = KeyTable.XK_Control_L;
                    let bmask = 0x10; // Button mask for scroll down

                    gestureStart('pinch', 20, 40, client, 150, 150);

                    expect(pointerEvent).to.have.been.calledOnceWith(client._sock,
                                                                     20, 40, 0x0);
                    expect(keyEvent).to.not.have.been.called;

                    pointerEvent.resetHistory();

                    gestureMove('pinch', 20, 40, client, 30, 30);

                    expect(pointerEvent).to.have.been.callCount(5);
                    expect(pointerEvent.getCall(0)).to.have.been.calledWith(client._sock,
                                                                            20, 40, 0x0);
                    expect(pointerEvent.getCall(1)).to.have.been.calledWith(client._sock,
                                                                            20, 40, bmask);
                    expect(pointerEvent.getCall(2)).to.have.been.calledWith(client._sock,
                                                                            20, 40, 0x0);
                    expect(pointerEvent.getCall(3)).to.have.been.calledWith(client._sock,
                                                                            20, 40, bmask);
                    expect(pointerEvent.getCall(4)).to.have.been.calledWith(client._sock,
                                                                            20, 40, 0x0);

                    expect(keyEvent).to.have.been.calledTwice;
                    expect(keyEvent.firstCall).to.have.been.calledWith(client._sock,
                                                                       keysym, 1);
                    expect(keyEvent.secondCall).to.have.been.calledWith(client._sock,
                                                                        keysym, 0);

                    expect(keyEvent.firstCall).to.have.been.calledBefore(pointerEvent.secondCall);
                    expect(keyEvent.lastCall).to.have.been.calledAfter(pointerEvent.lastCall);

                    pointerEvent.resetHistory();
                    keyEvent.resetHistory();

                    gestureEnd('pinch', 20, 40, client);

                    expect(pointerEvent).to.not.have.been.called;
                    expect(keyEvent).to.not.have.been.called;
                });

                it('should handle multiple small gesture pinch out events', function () {
                    let keysym = KeyTable.XK_Control_L;
                    let bmask = 0x8; // Button mask for scroll down

                    gestureStart('pinch', 20, 40, client, 0, 10);

                    expect(pointerEvent).to.have.been.calledOnceWith(client._sock,
                                                                     20, 40, 0x0);
                    expect(keyEvent).to.not.have.been.called;

                    pointerEvent.resetHistory();

                    gestureMove('pinch', 20, 40, client, 0, 30);
                    clock.tick(50);

                    expect(pointerEvent).to.have.been.calledWith(client._sock,
                                                                 20, 40, 0x0);

                    pointerEvent.resetHistory();

                    gestureMove('pinch', 20, 40, client, 0, 60);
                    clock.tick(50);

                    expect(pointerEvent).to.have.been.calledWith(client._sock,
                                                                 20, 40, 0x0);

                    pointerEvent.resetHistory();
                    keyEvent.resetHistory();

                    gestureMove('pinch', 20, 40, client, 0, 90);

                    expect(pointerEvent).to.have.been.calledThrice;
                    expect(pointerEvent.firstCall).to.have.been.calledWith(client._sock,
                                                                           20, 40, 0x0);
                    expect(pointerEvent.secondCall).to.have.been.calledWith(client._sock,
                                                                            20, 40, bmask);
                    expect(pointerEvent.thirdCall).to.have.been.calledWith(client._sock,
                                                                           20, 40, 0x0);

                    expect(keyEvent).to.have.been.calledTwice;
                    expect(keyEvent.firstCall).to.have.been.calledWith(client._sock,
                                                                       keysym, 1);
                    expect(keyEvent.secondCall).to.have.been.calledWith(client._sock,
                                                                        keysym, 0);

                    expect(keyEvent.firstCall).to.have.been.calledBefore(pointerEvent.secondCall);
                    expect(keyEvent.lastCall).to.have.been.calledAfter(pointerEvent.lastCall);

                    pointerEvent.resetHistory();
                    keyEvent.resetHistory();

                    gestureEnd('pinch', 20, 40, client);

                    expect(keyEvent).to.not.have.been.called;
                });

                it('should send correct key control code', function () {
                    let keysym = KeyTable.XK_Control_L;
                    let code = 0x1d;
                    let bmask = 0x10; // Button mask for scroll down

                    client._qemuExtKeyEventSupported = true;

                    gestureStart('pinch', 20, 40, client, 90, 90);

                    expect(pointerEvent).to.have.been.calledOnceWith(client._sock,
                                                                     20, 40, 0x0);
                    expect(qemuKeyEvent).to.not.have.been.called;

                    pointerEvent.resetHistory();

                    gestureMove('pinch', 20, 40, client, 30, 30);

                    expect(pointerEvent).to.have.been.calledThrice;
                    expect(pointerEvent.firstCall).to.have.been.calledWith(client._sock,
                                                                           20, 40, 0x0);
                    expect(pointerEvent.secondCall).to.have.been.calledWith(client._sock,
                                                                            20, 40, bmask);
                    expect(pointerEvent.thirdCall).to.have.been.calledWith(client._sock,
                                                                           20, 40, 0x0);

                    expect(qemuKeyEvent).to.have.been.calledTwice;
                    expect(qemuKeyEvent.firstCall).to.have.been.calledWith(client._sock,
                                                                           keysym,
                                                                           true,
                                                                           code);
                    expect(qemuKeyEvent.secondCall).to.have.been.calledWith(client._sock,
                                                                            keysym,
                                                                            false,
                                                                            code);

                    expect(qemuKeyEvent.firstCall).to.have.been.calledBefore(pointerEvent.secondCall);
                    expect(qemuKeyEvent.lastCall).to.have.been.calledAfter(pointerEvent.lastCall);

                    pointerEvent.resetHistory();
                    qemuKeyEvent.resetHistory();

                    gestureEnd('pinch', 20, 40, client);

                    expect(pointerEvent).to.not.have.been.called;
                    expect(qemuKeyEvent).to.not.have.been.called;
                });
            });
        });

        describe('WebSocket events', function () {
            // message events
            it('should do nothing if we receive an empty message and have nothing in the queue', function () {
                sinon.spy(client, "_normalMsg");
                client._sock._websocket._receiveData(new Uint8Array([]));
                expect(client._normalMsg).to.not.have.been.called;
            });

            it('should handle a message in the connected state as a normal message', function () {
                sinon.spy(client, "_normalMsg");
                client._sock._websocket._receiveData(new Uint8Array([1, 2, 3]));
                expect(client._normalMsg).to.have.been.called;
            });

            it('should handle a message in any non-disconnected/failed state like an init message', function () {
                client._rfbConnectionState = 'connecting';
                client._rfbInitState = 'ProtocolVersion';
                sinon.spy(client, "_initMsg");
                client._sock._websocket._receiveData(new Uint8Array([1, 2, 3]));
                expect(client._initMsg).to.have.been.called;
            });

            it('should process all normal messages directly', function () {
                const spy = sinon.spy();
                client.addEventListener("bell", spy);
                client._sock._websocket._receiveData(new Uint8Array([0x02, 0x02]));
                expect(spy).to.have.been.calledTwice;
            });

            // open events
            it('should update the state to ProtocolVersion on open (if the state is "connecting")', function () {
                client = new RFB(document.createElement('div'), 'wss://host:8675');
                this.clock.tick();
                client._sock._websocket._open();
                expect(client._rfbInitState).to.equal('ProtocolVersion');
            });

            it('should fail if we are not currently ready to connect and we get an "open" event', function () {
                sinon.spy(client, "_fail");
                client._rfbConnectionState = 'connected';
                client._sock._websocket._open();
                expect(client._fail).to.have.been.calledOnce;
            });

            // close events
            it('should transition to "disconnected" from "disconnecting" on a close event', function () {
                const real = client._sock._websocket.close;
                client._sock._websocket.close = () => {};
                client.disconnect();
                expect(client._rfbConnectionState).to.equal('disconnecting');
                client._sock._websocket.close = real;
                client._sock._websocket.close();
                expect(client._rfbConnectionState).to.equal('disconnected');
            });

            it('should fail if we get a close event while connecting', function () {
                sinon.spy(client, "_fail");
                client._rfbConnectionState = 'connecting';
                client._sock._websocket.close();
                expect(client._fail).to.have.been.calledOnce;
            });

            it('should unregister close event handler', function () {
                sinon.spy(client._sock, 'off');
                client.disconnect();
                client._sock._websocket.close();
                expect(client._sock.off).to.have.been.calledWith('close');
            });

            // error events do nothing
        });
    });

    describe('Quality level setting', function () {
        const defaultQuality = 6;

        let client;

        beforeEach(function () {
            client = makeRFB();
            sinon.spy(RFB.messages, "clientEncodings");
        });

        afterEach(function () {
            RFB.messages.clientEncodings.restore();
        });

        it(`should equal ${defaultQuality} by default`, function () {
            expect(client._qualityLevel).to.equal(defaultQuality);
        });

        it('should ignore non-integers when set', function () {
            client.qualityLevel = '1';
            expect(RFB.messages.clientEncodings).to.not.have.been.called;

            RFB.messages.clientEncodings.resetHistory();

            client.qualityLevel = 1.5;
            expect(RFB.messages.clientEncodings).to.not.have.been.called;

            RFB.messages.clientEncodings.resetHistory();

            client.qualityLevel = null;
            expect(RFB.messages.clientEncodings).to.not.have.been.called;

            RFB.messages.clientEncodings.resetHistory();

            client.qualityLevel = undefined;
            expect(RFB.messages.clientEncodings).to.not.have.been.called;

            RFB.messages.clientEncodings.resetHistory();

            client.qualityLevel = {};
            expect(RFB.messages.clientEncodings).to.not.have.been.called;
        });

        it('should ignore integers out of range [0, 9]', function () {
            client.qualityLevel = -1;
            expect(RFB.messages.clientEncodings).to.not.have.been.called;

            RFB.messages.clientEncodings.resetHistory();

            client.qualityLevel = 10;
            expect(RFB.messages.clientEncodings).to.not.have.been.called;
        });

        it('should send clientEncodings with new quality value', function () {
            let newQuality;

            newQuality = 8;
            client.qualityLevel = newQuality;
            expect(client.qualityLevel).to.equal(newQuality);
            expect(RFB.messages.clientEncodings).to.have.been.calledOnce;
            expect(RFB.messages.clientEncodings.getCall(0).args[1]).to.include(encodings.pseudoEncodingQualityLevel0 + newQuality);
        });

        it('should not send clientEncodings if quality is the same', function () {
            let newQuality;

            newQuality = 2;
            client.qualityLevel = newQuality;
            expect(RFB.messages.clientEncodings).to.have.been.calledOnce;
            expect(RFB.messages.clientEncodings.getCall(0).args[1]).to.include(encodings.pseudoEncodingQualityLevel0 + newQuality);

            RFB.messages.clientEncodings.resetHistory();

            client.qualityLevel = newQuality;
            expect(RFB.messages.clientEncodings).to.not.have.been.called;
        });

        it('should not send clientEncodings if not in connected state', function () {
            let newQuality;

            client._rfbConnectionState = '';
            newQuality = 2;
            client.qualityLevel = newQuality;
            expect(RFB.messages.clientEncodings).to.not.have.been.called;

            RFB.messages.clientEncodings.resetHistory();

            client._rfbConnectionState = 'connnecting';
            newQuality = 6;
            client.qualityLevel = newQuality;
            expect(RFB.messages.clientEncodings).to.not.have.been.called;

            RFB.messages.clientEncodings.resetHistory();

            client._rfbConnectionState = 'connected';
            newQuality = 5;
            client.qualityLevel = newQuality;
            expect(RFB.messages.clientEncodings).to.have.been.calledOnce;
            expect(RFB.messages.clientEncodings.getCall(0).args[1]).to.include(encodings.pseudoEncodingQualityLevel0 + newQuality);
        });
    });

    describe('Compression level setting', function () {
        const defaultCompression = 2;

        let client;

        beforeEach(function () {
            client = makeRFB();
            sinon.spy(RFB.messages, "clientEncodings");
        });

        afterEach(function () {
            RFB.messages.clientEncodings.restore();
        });

        it(`should equal ${defaultCompression} by default`, function () {
            expect(client._compressionLevel).to.equal(defaultCompression);
        });

        it('should ignore non-integers when set', function () {
            client.compressionLevel = '1';
            expect(RFB.messages.clientEncodings).to.not.have.been.called;

            RFB.messages.clientEncodings.resetHistory();

            client.compressionLevel = 1.5;
            expect(RFB.messages.clientEncodings).to.not.have.been.called;

            RFB.messages.clientEncodings.resetHistory();

            client.compressionLevel = null;
            expect(RFB.messages.clientEncodings).to.not.have.been.called;

            RFB.messages.clientEncodings.resetHistory();

            client.compressionLevel = undefined;
            expect(RFB.messages.clientEncodings).to.not.have.been.called;

            RFB.messages.clientEncodings.resetHistory();

            client.compressionLevel = {};
            expect(RFB.messages.clientEncodings).to.not.have.been.called;
        });

        it('should ignore integers out of range [0, 9]', function () {
            client.compressionLevel = -1;
            expect(RFB.messages.clientEncodings).to.not.have.been.called;

            RFB.messages.clientEncodings.resetHistory();

            client.compressionLevel = 10;
            expect(RFB.messages.clientEncodings).to.not.have.been.called;
        });

        it('should send clientEncodings with new compression value', function () {
            let newCompression;

            newCompression = 5;
            client.compressionLevel = newCompression;
            expect(client.compressionLevel).to.equal(newCompression);
            expect(RFB.messages.clientEncodings).to.have.been.calledOnce;
            expect(RFB.messages.clientEncodings.getCall(0).args[1]).to.include(encodings.pseudoEncodingCompressLevel0 + newCompression);
        });

        it('should not send clientEncodings if compression is the same', function () {
            let newCompression;

            newCompression = 9;
            client.compressionLevel = newCompression;
            expect(RFB.messages.clientEncodings).to.have.been.calledOnce;
            expect(RFB.messages.clientEncodings.getCall(0).args[1]).to.include(encodings.pseudoEncodingCompressLevel0 + newCompression);

            RFB.messages.clientEncodings.resetHistory();

            client.compressionLevel = newCompression;
            expect(RFB.messages.clientEncodings).to.not.have.been.called;
        });

        it('should not send clientEncodings if not in connected state', function () {
            let newCompression;

            client._rfbConnectionState = '';
            newCompression = 7;
            client.compressionLevel = newCompression;
            expect(RFB.messages.clientEncodings).to.not.have.been.called;

            RFB.messages.clientEncodings.resetHistory();

            client._rfbConnectionState = 'connnecting';
            newCompression = 6;
            client.compressionLevel = newCompression;
            expect(RFB.messages.clientEncodings).to.not.have.been.called;

            RFB.messages.clientEncodings.resetHistory();

            client._rfbConnectionState = 'connected';
            newCompression = 5;
            client.compressionLevel = newCompression;
            expect(RFB.messages.clientEncodings).to.have.been.calledOnce;
            expect(RFB.messages.clientEncodings.getCall(0).args[1]).to.include(encodings.pseudoEncodingCompressLevel0 + newCompression);
        });
    });
});

describe('RFB messages', function () {
    let sock;

    beforeEach(function () {
        let websock = new FakeWebSocket();
        websock._open();
        sock = new Websock();
        sock.attach(websock);
    });

    describe('Input events', function () {
        it('should send correct data for keyboard events', function () {
            // FIXME: down should be boolean
            RFB.messages.keyEvent(sock, 0x12345678, 0);
            let expected =
                [ 4, 0, 0, 0, 0x12, 0x34, 0x56, 0x78];
            expect(sock).to.have.sent(new Uint8Array(expected));

            RFB.messages.keyEvent(sock, 0x90abcdef, 1);
            expected =
                [ 4, 1, 0, 0, 0x90, 0xab, 0xcd, 0xef];
            expect(sock).to.have.sent(new Uint8Array(expected));
        });

        it('should send correct data for QEMU keyboard events', function () {
            // FIXME: down should be boolean
            RFB.messages.QEMUExtendedKeyEvent(sock, 0x12345678, 0, 0x55);
            let expected =
                [ 255, 0, 0, 0, 0x12, 0x34, 0x56, 0x78, 0x00, 0x00, 0x00, 0x55];
            expect(sock).to.have.sent(new Uint8Array(expected));

            RFB.messages.QEMUExtendedKeyEvent(sock, 0x90abcdef, 1, 0xe055);
            expected =
                [ 255, 0, 0, 1, 0x90, 0xab, 0xcd, 0xef, 0x00, 0x00, 0x00, 0xd5];
            expect(sock).to.have.sent(new Uint8Array(expected));
        });

        it('should send correct data for pointer events', function () {
            RFB.messages.pointerEvent(sock, 12345, 54321, 0x2b);
            let expected =
                [ 5, 0x2b, 0x30, 0x39, 0xd4, 0x31];
            expect(sock).to.have.sent(new Uint8Array(expected));
        });

        it('should send correct data for pointer events with marker bit set', function () {
            RFB.messages.pointerEvent(sock, 12345, 54321, 0xab);
            let expected =
                [ 5, 0x2b, 0x30, 0x39, 0xd4, 0x31];
            expect(sock).to.have.sent(new Uint8Array(expected));
        });

        it('should send correct data for pointer events with extended button bits set', function () {
            RFB.messages.pointerEvent(sock, 12345, 54321, 0x3ab);
            let expected =
                [ 5, 0x2b, 0x30, 0x39, 0xd4, 0x31];
            expect(sock).to.have.sent(new Uint8Array(expected));
        });

        it('should send correct data for extended pointer events', function () {
            RFB.messages.extendedPointerEvent(sock, 12345, 54321, 0xab);
            let expected =
                [ 5, 0xab, 0x30, 0x39, 0xd4, 0x31, 0x1];
            expect(sock).to.have.sent(new Uint8Array(expected));
        });

        it('should not send invalid data for extended pointer events', function () {
            expect(() => RFB.messages.extendedPointerEvent(sock, 12345, 54321, 0x3ab)).to.throw(Error);
        });
    });

    describe('Clipboard events', function () {
        it('should send correct data for clipboard events', function () {
            RFB.messages.clientCutText(sock, new Uint8Array([ 0x01, 0x23, 0x45, 0x67 ]));
            let expected =
                [ 6, 0, 0, 0, 0x00, 0x00, 0x00, 0x04,
                  0x01, 0x23, 0x45, 0x67 ];
            expect(sock).to.have.sent(new Uint8Array(expected));
        });
    });

    describe('Extended clipboard handling send', function () {
        it('should call clientCutText with correct Caps data', function () {
            let formats = {
                0: 2,
                2: 4121
            };
            let expectedData = new Uint8Array([0x06, 0x00, 0x00, 0x00,
                                               0xFF, 0xFF, 0xFF, 0xF4,
                                               0x1F, 0x00, 0x00, 0x05,
                                               0x00, 0x00, 0x00, 0x02,
                                               0x00, 0x00, 0x10, 0x19]);
            let actions = [
                1 << 24,  // Caps
                1 << 25,  // Request
                1 << 26,  // Peek
                1 << 27,  // Notify
                1 << 28   // Provide
            ];

            RFB.messages.extendedClipboardCaps(sock, actions, formats);

            expect(sock).to.have.sent(expectedData);
        });

        it('should call clientCutText with correct Request data', function () {
            let formats = new Uint8Array([0x01]);
            let expectedData = new Uint8Array([0x06, 0x00, 0x00, 0x00,
                                               0xFF, 0xFF, 0xFF, 0xFC,
                                               0x02, 0x00, 0x00, 0x01]);

            RFB.messages.extendedClipboardRequest(sock, formats);

            expect(sock).to.have.sent(expectedData);
        });

        it('should call clientCutText with correct Notify data', function () {
            let formats = new Uint8Array([0x01]);
            let expectedData = new Uint8Array([0x06, 0x00, 0x00, 0x00,
                                               0xFF, 0xFF, 0xFF, 0xFC,
                                               0x08, 0x00, 0x00, 0x01]);

            RFB.messages.extendedClipboardNotify(sock, formats);

            expect(sock).to.have.sent(expectedData);
        });

        it('should call clientCutText with correct Provide data', function () {
            let testText = "Test string";
            let expectedText = encodeUTF8(testText + "\0");

            let deflatedData =  deflateWithSize(expectedText);

            // Build Expected with flags and deflated data
            let expectedData = new Uint8Array(8 + 4 + deflatedData.length);
            expectedData[0] = 0x06; // Message type
            expectedData[1] = 0x00;
            expectedData[2] = 0x00;
            expectedData[3] = 0x00;
            expectedData[4] = 0xFF; // Size
            expectedData[5] = 0xFF;
            expectedData[6] = 0xFF;
            expectedData[7] = 256 - (4 + deflatedData.length);
            expectedData[8] = 0x10; // The client capabilities
            expectedData[9] = 0x00; // Reserved flags
            expectedData[10] = 0x00; // Reserved flags
            expectedData[11] = 0x01; // The formats client supports
            expectedData.set(deflatedData, 12);

            RFB.messages.extendedClipboardProvide(sock, [0x01], [testText]);

            expect(sock).to.have.sent(expectedData);

        });

        describe('End of line characters', function () {
            it('Carriage return', function () {

                let testText = "Hello\rworld\r\r!";
                let expectedText = encodeUTF8("Hello\r\nworld\r\n\r\n!\0");

                let deflatedData =  deflateWithSize(expectedText);

                // Build Expected with flags and deflated data
                let expectedData = new Uint8Array(8 + 4 + deflatedData.length);
                expectedData[0] = 0x06; // Message type
                expectedData[1] = 0x00;
                expectedData[2] = 0x00;
                expectedData[3] = 0x00;
                expectedData[4] = 0xFF; // Size
                expectedData[5] = 0xFF;
                expectedData[6] = 0xFF;
                expectedData[7] = 256 - (4 + deflatedData.length);
                expectedData[8] = 0x10; // The client capabilities
                expectedData[9] = 0x00; // Reserved flags
                expectedData[10] = 0x00; // Reserved flags
                expectedData[11] = 0x01; // The formats client supports
                expectedData.set(deflatedData, 12);

                RFB.messages.extendedClipboardProvide(sock, [0x01], [testText]);

                expect(sock).to.have.sent(expectedData);
            });

            it('Carriage return Line feed', function () {

                let testText = "Hello\r\n\r\nworld\r\n!";
                let expectedText = encodeUTF8(testText + "\0");

                let deflatedData =  deflateWithSize(expectedText);

                // Build Expected with flags and deflated data
                let expectedData = new Uint8Array(8 + 4 + deflatedData.length);
                expectedData[0] = 0x06; // Message type
                expectedData[1] = 0x00;
                expectedData[2] = 0x00;
                expectedData[3] = 0x00;
                expectedData[4] = 0xFF; // Size
                expectedData[5] = 0xFF;
                expectedData[6] = 0xFF;
                expectedData[7] = 256 - (4 + deflatedData.length);
                expectedData[8] = 0x10; // The client capabilities
                expectedData[9] = 0x00; // Reserved flags
                expectedData[10] = 0x00; // Reserved flags
                expectedData[11] = 0x01; // The formats client supports
                expectedData.set(deflatedData, 12);

                RFB.messages.extendedClipboardProvide(sock, [0x01], [testText]);

                expect(sock).to.have.sent(expectedData);
            });

            it('Line feed', function () {
                let testText = "Hello\n\n\nworld\n!";
                let expectedText = encodeUTF8("Hello\r\n\r\n\r\nworld\r\n!\0");

                let deflatedData =  deflateWithSize(expectedText);

                // Build Expected with flags and deflated data
                let expectedData = new Uint8Array(8 + 4 + deflatedData.length);
                expectedData[0] = 0x06; // Message type
                expectedData[1] = 0x00;
                expectedData[2] = 0x00;
                expectedData[3] = 0x00;
                expectedData[4] = 0xFF; // Size
                expectedData[5] = 0xFF;
                expectedData[6] = 0xFF;
                expectedData[7] = 256 - (4 + deflatedData.length);
                expectedData[8] = 0x10; // The client capabilities
                expectedData[9] = 0x00; // Reserved flags
                expectedData[10] = 0x00; // Reserved flags
                expectedData[11] = 0x01; // The formats client supports
                expectedData.set(deflatedData, 12);

                RFB.messages.extendedClipboardProvide(sock, [0x01], [testText]);

                expect(sock).to.have.sent(expectedData);
            });

            it('Carriage return and Line feed mixed', function () {
                let testText = "\rHello\r\n\rworld\n\n!";
                let expectedText = encodeUTF8("\r\nHello\r\n\r\nworld\r\n\r\n!\0");

                let deflatedData =  deflateWithSize(expectedText);

                // Build Expected with flags and deflated data
                let expectedData = new Uint8Array(8 + 4 + deflatedData.length);
                expectedData[0] = 0x06; // Message type
                expectedData[1] = 0x00;
                expectedData[2] = 0x00;
                expectedData[3] = 0x00;
                expectedData[4] = 0xFF; // Size
                expectedData[5] = 0xFF;
                expectedData[6] = 0xFF;
                expectedData[7] = 256 - (4 + deflatedData.length);
                expectedData[8] = 0x10; // The client capabilities
                expectedData[9] = 0x00; // Reserved flags
                expectedData[10] = 0x00; // Reserved flags
                expectedData[11] = 0x01; // The formats client supports
                expectedData.set(deflatedData, 12);

                RFB.messages.extendedClipboardProvide(sock, [0x01], [testText]);

                expect(sock).to.have.sent(expectedData);
            });
        });
    });

    describe('Screen layout', function () {
        it('should send correct data for screen layout changes', function () {
            RFB.messages.setDesktopSize(sock, 12345, 54321, 0x12345678, 0x90abcdef);
            let expected =
                [ 251, 0, 0x30, 0x39, 0xd4, 0x31, 0x01, 0x00,
                  0x12, 0x34, 0x56, 0x78, 0x00, 0x00, 0x00, 0x00,
                  0x30, 0x39, 0xd4, 0x31, 0x90, 0xab, 0xcd, 0xef ];
            expect(sock).to.have.sent(new Uint8Array(expected));
        });
    });

    describe('Fences', function () {
        it('should send correct data for fences', function () {
            // FIXME: Payload should be a byte array
            RFB.messages.clientFence(sock, 0x12345678, "text");
            let expected =
                [ 248, 0, 0, 0, 0x12, 0x34, 0x56, 0x78,
                  4, 0x74, 0x65, 0x78, 0x74 ];
            expect(sock).to.have.sent(new Uint8Array(expected));
        });
    });

    describe('Continuous updates', function () {
        it('should send correct data for continuous updates configuration', function () {
            // FIXME: enable should be boolean
            RFB.messages.enableContinuousUpdates(sock, 0, 12345, 54321, 34343, 18181);
            let expected =
                [ 150, 0, 0x30, 0x39, 0xd4, 0x31, 0x86, 0x27, 0x47, 0x05 ];
            expect(sock).to.have.sent(new Uint8Array(expected));
        });
    });

    describe('Pixel format', function () {
        it('should send correct data for normal depth', function () {
            RFB.messages.pixelFormat(sock, 24, true);
            let expected =
                [ 0, 0, 0, 0, 32, 24, 0, 1,
                  0, 255, 0, 255, 0, 255, 0, 8, 16, 0, 0, 0 ];
            expect(sock).to.have.sent(new Uint8Array(expected));
        });

        it('should send correct data for low depth', function () {
            RFB.messages.pixelFormat(sock, 8, true);
            let expected =
                [ 0, 0, 0, 0, 8, 8, 0, 1,
                  0, 3, 0, 3, 0, 3, 0, 2, 4, 0, 0, 0 ];
            expect(sock).to.have.sent(new Uint8Array(expected));
        });
    });

    describe('Encodings', function () {
        it('should send correct data for supported encodings', function () {
            RFB.messages.clientEncodings(sock, [ 0x12345678,
                                                 0x90abcdef,
                                                 0x10293847 ]);
            let expected =
                [ 2, 0, 0, 3, 0x12, 0x34, 0x56, 0x78, 0x90, 0xab, 0xcd,
                  0xef, 0x10, 0x29, 0x38, 0x47 ];
            expect(sock).to.have.sent(new Uint8Array(expected));
        });
    });

    describe('Update request', function () {
        it('should send correct data for update request', function () {
            RFB.messages.fbUpdateRequest(sock, true, 12345, 54321, 34343, 18181);
            let expected =
                [ 3, 1, 0x30, 0x39, 0xd4, 0x31, 0x86, 0x27, 0x47, 0x05 ];
            expect(sock).to.have.sent(new Uint8Array(expected));
        });
    });

    describe('XVP operations', function () {
        it('should send correct data for XVP operations', function () {
            RFB.messages.xvpOp(sock, 123, 45);
            let expected =
                [ 250, 0, 123, 45 ];
            expect(sock).to.have.sent(new Uint8Array(expected));
        });
    });
});
