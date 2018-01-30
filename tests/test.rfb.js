var assert = chai.assert;
var expect = chai.expect;

import RFB from '../core/rfb.js';
import Websock from '../core/websock.js';
import { encodings } from '../core/encodings.js';

import FakeWebSocket from './fake.websocket.js';
import sinon from '../vendor/sinon.js';

/* UIEvent constructor polyfill for IE */
(function () {
    if (typeof window.UIEvent === "function") return;

    function UIEvent ( event, params ) {
        params = params || { bubbles: false, cancelable: false, view: window, detail: undefined };
        var evt = document.createEvent( 'UIEvent' );
        evt.initUIEvent( event, params.bubbles, params.cancelable, params.view, params.detail );
        return evt;
    }

    UIEvent.prototype = window.UIEvent.prototype;

    window.UIEvent = UIEvent;
})();

var push8 = function (arr, num) {
    "use strict";
    arr.push(num & 0xFF);
};

var push16 = function (arr, num) {
    "use strict";
    arr.push((num >> 8) & 0xFF,
              num & 0xFF);
};

var push32 = function (arr, num) {
    "use strict";
    arr.push((num >> 24) & 0xFF,
              (num >> 16) & 0xFF,
              (num >>  8) & 0xFF,
              num & 0xFF);
};

describe('Remote Frame Buffer Protocol Client', function() {
    var clock;
    var raf;

    before(FakeWebSocket.replace);
    after(FakeWebSocket.restore);

    before(function () {
        this.clock = clock = sinon.useFakeTimers();
        // sinon doesn't support this yet
        raf = window.requestAnimationFrame;
        window.requestAnimationFrame = setTimeout;
        // Use a single set of buffers instead of reallocating to
        // speed up tests
        var sock = new Websock();
        var _sQ = new Uint8Array(sock._sQbufferSize);
        var rQ = new Uint8Array(sock._rQbufferSize);

        Websock.prototype._old_allocate_buffers = Websock.prototype._allocate_buffers;
        Websock.prototype._allocate_buffers = function () {
            this._sQ = _sQ;
            this._rQ = rQ;
        };

    });

    after(function () {
        Websock.prototype._allocate_buffers = Websock.prototype._old_allocate_buffers;
        this.clock.restore();
        window.requestAnimationFrame = raf;
    });

    var container;
    var rfbs;

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

    function make_rfb (url, options) {
        url = url || 'wss://host:8675';
        var rfb = new RFB(container, url, options);
        clock.tick();
        rfb._sock._websocket._open();
        rfb._rfb_connection_state = 'connected';
        sinon.spy(rfb, "_disconnect");
        rfbs.push(rfb);
        return rfb;
    }

    describe('Connecting/Disconnecting', function () {
        describe('#RFB', function () {
            it('should set the current state to "connecting"', function () {
                var client = new RFB(document.createElement('div'), 'wss://host:8675');
                client._rfb_connection_state = '';
                this.clock.tick();
                expect(client._rfb_connection_state).to.equal('connecting');
            });

            it('should actually connect to the websocket', function () {
                var client = new RFB(document.createElement('div'), 'ws://HOST:8675/PATH');
                sinon.spy(client._sock, 'open');
                this.clock.tick();
                expect(client._sock.open).to.have.been.calledOnce;
                expect(client._sock.open).to.have.been.calledWith('ws://HOST:8675/PATH');
            });
        });

        describe('#disconnect', function () {
            var client;
            beforeEach(function () {
                client = make_rfb();
            });

            it('should go to state "disconnecting" before "disconnected"', function () {
                sinon.spy(client, '_updateConnectionState');
                client.disconnect();
                expect(client._updateConnectionState).to.have.been.calledTwice;
                expect(client._updateConnectionState.getCall(0).args[0])
                    .to.equal('disconnecting');
                expect(client._updateConnectionState.getCall(1).args[0])
                    .to.equal('disconnected');
                expect(client._rfb_connection_state).to.equal('disconnected');
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

        describe('#sendCredentials', function () {
            var client;
            beforeEach(function () {
                client = make_rfb();
                client._rfb_connection_state = 'connecting';
            });

            it('should set the rfb credentials properly"', function () {
                client.sendCredentials({ password: 'pass' });
                expect(client._rfb_credentials).to.deep.equal({ password: 'pass' });
            });

            it('should call init_msg "soon"', function () {
                client._init_msg = sinon.spy();
                client.sendCredentials({ password: 'pass' });
                this.clock.tick(5);
                expect(client._init_msg).to.have.been.calledOnce;
            });
        });
    });

    describe('Public API Basic Behavior', function () {
        var client;
        beforeEach(function () {
            client = make_rfb();
        });

        describe('#sendCtrlAlDel', function () {
            it('should sent ctrl[down]-alt[down]-del[down] then del[up]-alt[up]-ctrl[up]', function () {
                var expected = {_sQ: new Uint8Array(48), _sQlen: 0, flush: function () {}};
                RFB.messages.keyEvent(expected, 0xFFE3, 1);
                RFB.messages.keyEvent(expected, 0xFFE9, 1);
                RFB.messages.keyEvent(expected, 0xFFFF, 1);
                RFB.messages.keyEvent(expected, 0xFFFF, 0);
                RFB.messages.keyEvent(expected, 0xFFE9, 0);
                RFB.messages.keyEvent(expected, 0xFFE3, 0);

                client.sendCtrlAltDel();
                expect(client._sock).to.have.sent(expected._sQ);
            });

            it('should not send the keys if we are not in a normal state', function () {
                sinon.spy(client._sock, 'flush');
                client._rfb_connection_state = "connecting";
                client.sendCtrlAltDel();
                expect(client._sock.flush).to.not.have.been.called;
            });

            it('should not send the keys if we are set as view_only', function () {
                sinon.spy(client._sock, 'flush');
                client._viewOnly = true;
                client.sendCtrlAltDel();
                expect(client._sock.flush).to.not.have.been.called;
            });
        });

        describe('#sendKey', function () {
            it('should send a single key with the given code and state (down = true)', function () {
                var expected = {_sQ: new Uint8Array(8), _sQlen: 0, flush: function () {}};
                RFB.messages.keyEvent(expected, 123, 1);
                client.sendKey(123, 'Key123', true);
                expect(client._sock).to.have.sent(expected._sQ);
            });

            it('should send both a down and up event if the state is not specified', function () {
                var expected = {_sQ: new Uint8Array(16), _sQlen: 0, flush: function () {}};
                RFB.messages.keyEvent(expected, 123, 1);
                RFB.messages.keyEvent(expected, 123, 0);
                client.sendKey(123, 'Key123');
                expect(client._sock).to.have.sent(expected._sQ);
            });

            it('should not send the key if we are not in a normal state', function () {
                sinon.spy(client._sock, 'flush');
                client._rfb_connection_state = "connecting";
                client.sendKey(123, 'Key123');
                expect(client._sock.flush).to.not.have.been.called;
            });

            it('should not send the key if we are set as view_only', function () {
                sinon.spy(client._sock, 'flush');
                client._viewOnly = true;
                client.sendKey(123, 'Key123');
                expect(client._sock.flush).to.not.have.been.called;
            });

            it('should send QEMU extended events if supported', function () {
                client._qemuExtKeyEventSupported = true;
                var expected = {_sQ: new Uint8Array(12), _sQlen: 0, flush: function () {}};
                RFB.messages.QEMUExtendedKeyEvent(expected, 0x20, true, 0x0039);
                client.sendKey(0x20, 'Space', true);
                expect(client._sock).to.have.sent(expected._sQ);
            });

            it('should not send QEMU extended events if unknown key code', function () {
                client._qemuExtKeyEventSupported = true;
                var expected = {_sQ: new Uint8Array(8), _sQlen: 0, flush: function () {}};
                RFB.messages.keyEvent(expected, 123, 1);
                client.sendKey(123, 'FooBar', true);
                expect(client._sock).to.have.sent(expected._sQ);
            });
        });

        describe('#focus', function () {
            it('should move focus to canvas object', function () {
                client._canvas.focus = sinon.spy();
                client.focus();
                expect(client._canvas.focus).to.have.been.called.once;
            });
        });

        describe('#blur', function () {
            it('should remove focus from canvas object', function () {
                client._canvas.blur = sinon.spy();
                client.blur();
                expect(client._canvas.blur).to.have.been.called.once;
            });
        });

        describe('#clipboardPasteFrom', function () {
            it('should send the given text in a paste event', function () {
                var expected = {_sQ: new Uint8Array(11), _sQlen: 0, flush: function () {}};
                RFB.messages.clientCutText(expected, 'abc');
                client.clipboardPasteFrom('abc');
                expect(client._sock).to.have.sent(expected._sQ);
            });

            it('should not send the text if we are not in a normal state', function () {
                sinon.spy(client._sock, 'flush');
                client._rfb_connection_state = "connecting";
                client.clipboardPasteFrom('abc');
                expect(client._sock.flush).to.not.have.been.called;
            });
        });

        describe("XVP operations", function () {
            beforeEach(function () {
                client._rfb_xvp_ver = 1;
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
        var client;
        beforeEach(function () {
            client = make_rfb();
            container.style.width = '70px';
            container.style.height = '80px';
            client.clipViewport = true;
        });

        it('should update display clip state when changing the property', function () {
            var spy = sinon.spy(client._display, "clipViewport", ["set"]);

            client.clipViewport = false;
            expect(spy.set).to.have.been.calledOnce;
            expect(spy.set).to.have.been.calledWith(false);
            spy.set.reset();

            client.clipViewport = true;
            expect(spy.set).to.have.been.calledOnce;
            expect(spy.set).to.have.been.calledWith(true);
        });

        it('should update the viewport when the container size changes', function () {
            sinon.spy(client._display, "viewportChangeSize");

            container.style.width = '40px';
            container.style.height = '50px';
            var event = new UIEvent('resize');
            window.dispatchEvent(event);
            clock.tick();

            expect(client._display.viewportChangeSize).to.have.been.calledOnce;
            expect(client._display.viewportChangeSize).to.have.been.calledWith(40, 50);
        });

        it('should update the viewport when the remote session resizes', function () {
            // Simple ExtendedDesktopSize FBU message
            var incoming = [ 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
                             0x00, 0xff, 0x00, 0xff, 0xff, 0xff, 0xfe, 0xcc,
                             0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                             0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0x00, 0xff,
                             0x00, 0x00, 0x00, 0x00 ];

            sinon.spy(client._display, "viewportChangeSize");

            client._sock._websocket._receive_data(new Uint8Array(incoming));

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
            var event = new UIEvent('resize');
            window.dispatchEvent(event);
            clock.tick();

            expect(client._display.viewportChangeSize).to.not.have.been.called;
        });

        it('should not update the viewport if scaling', function () {
            client.scaleViewport = true;
            sinon.spy(client._display, "viewportChangeSize");

            container.style.width = '40px';
            container.style.height = '50px';
            var event = new UIEvent('resize');
            window.dispatchEvent(event);
            clock.tick();

            expect(client._display.viewportChangeSize).to.not.have.been.called;
        });

        describe('Dragging', function () {
            beforeEach(function () {
                client.dragViewport = true;
                sinon.spy(RFB.messages, "pointerEvent");
            });

            afterEach(function () {
                RFB.messages.pointerEvent.restore();
            });

            it('should not send button messages when initiating viewport dragging', function () {
                client._handleMouseButton(13, 9, 0x001);
                expect(RFB.messages.pointerEvent).to.not.have.been.called;
            });

            it('should send button messages when release without movement', function () {
                // Just up and down
                client._handleMouseButton(13, 9, 0x001);
                client._handleMouseButton(13, 9, 0x000);
                expect(RFB.messages.pointerEvent).to.have.been.calledTwice;

                RFB.messages.pointerEvent.reset();

                // Small movement
                client._handleMouseButton(13, 9, 0x001);
                client._handleMouseMove(15, 14);
                client._handleMouseButton(15, 14, 0x000);
                expect(RFB.messages.pointerEvent).to.have.been.calledTwice;
            });

            it('should send button message directly when drag is disabled', function () {
                client.dragViewport = false;
                client._handleMouseButton(13, 9, 0x001);
                expect(RFB.messages.pointerEvent).to.have.been.calledOnce;
            });

            it('should be initiate viewport dragging on sufficient movement', function () {
                sinon.spy(client._display, "viewportChangePos");

                // Too small movement

                client._handleMouseButton(13, 9, 0x001);
                client._handleMouseMove(18, 9);

                expect(RFB.messages.pointerEvent).to.not.have.been.called;
                expect(client._display.viewportChangePos).to.not.have.been.called;

                // Sufficient movement

                client._handleMouseMove(43, 9);

                expect(RFB.messages.pointerEvent).to.not.have.been.called;
                expect(client._display.viewportChangePos).to.have.been.calledOnce;
                expect(client._display.viewportChangePos).to.have.been.calledWith(-30, 0);

                client._display.viewportChangePos.reset();

                // Now a small movement should move right away

                client._handleMouseMove(43, 14);

                expect(RFB.messages.pointerEvent).to.not.have.been.called;
                expect(client._display.viewportChangePos).to.have.been.calledOnce;
                expect(client._display.viewportChangePos).to.have.been.calledWith(0, -5);
            });

            it('should not send button messages when dragging ends', function () {
                // First the movement

                client._handleMouseButton(13, 9, 0x001);
                client._handleMouseMove(43, 9);
                client._handleMouseButton(43, 9, 0x000);

                expect(RFB.messages.pointerEvent).to.not.have.been.called;
            });

            it('should terminate viewport dragging on a button up event', function () {
                // First the dragging movement

                client._handleMouseButton(13, 9, 0x001);
                client._handleMouseMove(43, 9);
                client._handleMouseButton(43, 9, 0x000);

                // Another movement now should not move the viewport

                sinon.spy(client._display, "viewportChangePos");

                client._handleMouseMove(43, 59);

                expect(client._display.viewportChangePos).to.not.have.been.called;
            });
        });
    });

    describe('Scaling', function () {
        var client;
        beforeEach(function () {
            client = make_rfb();
            container.style.width = '70px';
            container.style.height = '80px';
            client.scaleViewport = true;
        });

        it('should update display scale factor when changing the property', function () {
            var spy = sinon.spy(client._display, "scale", ["set"]);
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

            var spy = sinon.spy(client._display, "clipViewport", ["set"]);

            client.scaleViewport = false;
            expect(spy.set).to.have.been.calledOnce;
            expect(spy.set).to.have.been.calledWith(true);

            spy.set.reset();

            client.scaleViewport = true;
            expect(spy.set).to.have.been.calledOnce;
            expect(spy.set).to.have.been.calledWith(false);
        });

        it('should update the scaling when the container size changes', function () {
            sinon.spy(client._display, "autoscale");

            container.style.width = '40px';
            container.style.height = '50px';
            var event = new UIEvent('resize');
            window.dispatchEvent(event);
            clock.tick();

            expect(client._display.autoscale).to.have.been.calledOnce;
            expect(client._display.autoscale).to.have.been.calledWith(40, 50);
        });

        it('should update the scaling when the remote session resizes', function () {
            // Simple ExtendedDesktopSize FBU message
            var incoming = [ 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
                             0x00, 0xff, 0x00, 0xff, 0xff, 0xff, 0xfe, 0xcc,
                             0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                             0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0x00, 0xff,
                             0x00, 0x00, 0x00, 0x00 ];

            sinon.spy(client._display, "autoscale");

            client._sock._websocket._receive_data(new Uint8Array(incoming));

            expect(client._display.autoscale).to.have.been.calledOnce;
            expect(client._display.autoscale).to.have.been.calledWith(70, 80);
        });

        it('should not update the display scale factor if not scaling', function () {
            client.scaleViewport = false;

            sinon.spy(client._display, "autoscale");

            container.style.width = '40px';
            container.style.height = '50px';
            var event = new UIEvent('resize');
            window.dispatchEvent(event);
            clock.tick();

            expect(client._display.autoscale).to.not.have.been.called;
        });
    });

    describe('Remote resize', function () {
        var client;
        beforeEach(function () {
            client = make_rfb();
            client._supportsSetDesktopSize = true;
            client.resizeSession = true;
            container.style.width = '70px';
            container.style.height = '80px';
            sinon.spy(RFB.messages, "setDesktopSize");
        });

        afterEach(function () {
            RFB.messages.setDesktopSize.restore();
        });

        it('should only request a resize when turned on', function () {
            client.resizeSession = false;
            expect(RFB.messages.setDesktopSize).to.not.have.been.called;
            client.resizeSession = true;
            expect(RFB.messages.setDesktopSize).to.have.been.calledOnce;
        });

        it('should request a resize when initially connecting', function () {
            // Simple ExtendedDesktopSize FBU message
            var incoming = [ 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
                             0x00, 0x04, 0x00, 0x04, 0xff, 0xff, 0xfe, 0xcc,
                             0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                             0x00, 0x00, 0x00, 0x00, 0x00, 0x04, 0x00, 0x04,
                             0x00, 0x00, 0x00, 0x00 ];

            // First message should trigger a resize

            client._supportsSetDesktopSize = false;

            client._sock._websocket._receive_data(new Uint8Array(incoming));

            expect(RFB.messages.setDesktopSize).to.have.been.calledOnce;
            expect(RFB.messages.setDesktopSize).to.have.been.calledWith(sinon.match.object, 70, 80, 0, 0);

            RFB.messages.setDesktopSize.reset();

            // Second message should not trigger a resize

            client._sock._websocket._receive_data(new Uint8Array(incoming));

            expect(RFB.messages.setDesktopSize).to.not.have.been.called;
        });

        it('should request a resize when the container resizes', function () {
            container.style.width = '40px';
            container.style.height = '50px';
            var event = new UIEvent('resize');
            window.dispatchEvent(event);
            clock.tick(1000);

            expect(RFB.messages.setDesktopSize).to.have.been.calledOnce;
            expect(RFB.messages.setDesktopSize).to.have.been.calledWith(sinon.match.object, 40, 50, 0, 0);
        });

        it('should not resize until the container size is stable', function () {
            container.style.width = '20px';
            container.style.height = '30px';
            var event = new UIEvent('resize');
            window.dispatchEvent(event);
            clock.tick(400);

            expect(RFB.messages.setDesktopSize).to.not.have.been.called;

            container.style.width = '40px';
            container.style.height = '50px';
            var event = new UIEvent('resize');
            window.dispatchEvent(event);
            clock.tick(400);

            expect(RFB.messages.setDesktopSize).to.not.have.been.called;

            clock.tick(200);

            expect(RFB.messages.setDesktopSize).to.have.been.calledOnce;
            expect(RFB.messages.setDesktopSize).to.have.been.calledWith(sinon.match.object, 40, 50, 0, 0);
        });

        it('should not resize when resize is disabled', function () {
            client._resizeSession = false;

            container.style.width = '40px';
            container.style.height = '50px';
            var event = new UIEvent('resize');
            window.dispatchEvent(event);
            clock.tick(1000);

            expect(RFB.messages.setDesktopSize).to.not.have.been.called;
        });

        it('should not resize when resize is not supported', function () {
            client._supportsSetDesktopSize = false;

            container.style.width = '40px';
            container.style.height = '50px';
            var event = new UIEvent('resize');
            window.dispatchEvent(event);
            clock.tick(1000);

            expect(RFB.messages.setDesktopSize).to.not.have.been.called;
        });

        it('should not resize when in view only mode', function () {
            client._viewOnly = true;

            container.style.width = '40px';
            container.style.height = '50px';
            var event = new UIEvent('resize');
            window.dispatchEvent(event);
            clock.tick(1000);

            expect(RFB.messages.setDesktopSize).to.not.have.been.called;
        });

        it('should not try to override a server resize', function () {
            // Simple ExtendedDesktopSize FBU message
            var incoming = [ 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
                             0x00, 0x04, 0x00, 0x04, 0xff, 0xff, 0xfe, 0xcc,
                             0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                             0x00, 0x00, 0x00, 0x00, 0x00, 0x04, 0x00, 0x04,
                             0x00, 0x00, 0x00, 0x00 ];

            client._sock._websocket._receive_data(new Uint8Array(incoming));

            expect(RFB.messages.setDesktopSize).to.not.have.been.called;
        });
    });

    describe('Misc Internals', function () {
        describe('#_updateConnectionState', function () {
            var client;
            beforeEach(function () {
                client = make_rfb();
            });

            it('should clear the disconnect timer if the state is not "disconnecting"', function () {
                var spy = sinon.spy();
                client._disconnTimer = setTimeout(spy, 50);
                client._rfb_connection_state = 'connecting';
                client._updateConnectionState('connected');
                this.clock.tick(51);
                expect(spy).to.not.have.been.called;
                expect(client._disconnTimer).to.be.null;
            });

            it('should set the rfb_connection_state', function () {
                client._rfb_connection_state = 'connecting';
                client._updateConnectionState('connected');
                expect(client._rfb_connection_state).to.equal('connected');
            });

            it('should not change the state when we are disconnected', function () {
                client.disconnect();
                expect(client._rfb_connection_state).to.equal('disconnected');
                client._updateConnectionState('connecting');
                expect(client._rfb_connection_state).to.not.equal('connecting');
            });

            it('should ignore state changes to the same state', function () {
                var connectSpy = sinon.spy();
                client.addEventListener("connect", connectSpy);

                expect(client._rfb_connection_state).to.equal('connected');
                client._updateConnectionState('connected');
                expect(connectSpy).to.not.have.been.called;

                client.disconnect();

                var disconnectSpy = sinon.spy();
                client.addEventListener("disconnect", disconnectSpy);

                expect(client._rfb_connection_state).to.equal('disconnected');
                client._updateConnectionState('disconnected');
                expect(disconnectSpy).to.not.have.been.called;
            });

            it('should ignore illegal state changes', function () {
                var spy = sinon.spy();
                client.addEventListener("disconnect", spy);
                client._updateConnectionState('disconnected');
                expect(client._rfb_connection_state).to.not.equal('disconnected');
                expect(spy).to.not.have.been.called;
            });
        });

        describe('#_fail', function () {
            var client;
            beforeEach(function () {
                client = make_rfb();
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
                expect(client._rfb_connection_state).to.equal('disconnected');
            });

            it('should set clean_disconnect variable', function () {
                client._rfb_clean_disconnect = true;
                client._rfb_connection_state = 'connected';
                client._fail();
                expect(client._rfb_clean_disconnect).to.be.false;
            });

            it('should result in disconnect event with clean set to false', function () {
                client._rfb_connection_state = 'connected';
                var spy = sinon.spy();
                client.addEventListener("disconnect", spy);
                client._fail();
                this.clock.tick(2000);
                expect(spy).to.have.been.calledOnce;
                expect(spy.args[0][0].detail.clean).to.be.false;
            });

        });
    });

    describe('Connection States', function () {
        describe('connecting', function () {
            it('should open the websocket connection', function () {
                var client = new RFB(document.createElement('div'),
                                     'ws://HOST:8675/PATH');
                sinon.spy(client._sock, 'open');
                this.clock.tick();
                expect(client._sock.open).to.have.been.calledOnce;
            });
        });

        describe('connected', function () {
            var client;
            beforeEach(function () {
                client = make_rfb();
            });

            it('should result in a connect event if state becomes connected', function () {
                var spy = sinon.spy();
                client.addEventListener("connect", spy);
                client._rfb_connection_state = 'connecting';
                client._updateConnectionState('connected');
                expect(spy).to.have.been.calledOnce;
            });

            it('should not result in a connect event if the state is not "connected"', function () {
                var spy = sinon.spy();
                client.addEventListener("connect", spy);
                client._sock._websocket.open = function () {};  // explicitly don't call onopen
                client._updateConnectionState('connecting');
                expect(spy).to.not.have.been.called;
            });
        });

        describe('disconnecting', function () {
            var client;
            beforeEach(function () {
                client = make_rfb();
            });

            it('should force disconnect if we do not call Websock.onclose within the disconnection timeout', function () {
                sinon.spy(client, '_updateConnectionState');
                client._sock._websocket.close = function () {};  // explicitly don't call onclose
                client._updateConnectionState('disconnecting');
                this.clock.tick(3 * 1000);
                expect(client._updateConnectionState).to.have.been.calledTwice;
                expect(client._rfb_disconnect_reason).to.not.equal("");
                expect(client._rfb_connection_state).to.equal("disconnected");
            });

            it('should not fail if Websock.onclose gets called within the disconnection timeout', function () {
                client._updateConnectionState('disconnecting');
                this.clock.tick(3 * 1000 / 2);
                client._sock._websocket.close();
                this.clock.tick(3 * 1000 / 2 + 1);
                expect(client._rfb_connection_state).to.equal('disconnected');
            });

            it('should close the WebSocket connection', function () {
                sinon.spy(client._sock, 'close');
                client._updateConnectionState('disconnecting');
                expect(client._sock.close).to.have.been.calledOnce;
            });

            it('should not result in a disconnect event', function () {
                var spy = sinon.spy();
                client.addEventListener("disconnect", spy);
                client._sock._websocket.close = function () {};  // explicitly don't call onclose
                client._updateConnectionState('disconnecting');
                expect(spy).to.not.have.been.called;
            });
        });

        describe('disconnected', function () {
            var client;
            beforeEach(function () {
                client = new RFB(document.createElement('div'), 'ws://HOST:8675/PATH');
            });

            it('should result in a disconnect event if state becomes "disconnected"', function () {
                var spy = sinon.spy();
                client.addEventListener("disconnect", spy);
                client._rfb_connection_state = 'disconnecting';
                client._updateConnectionState('disconnected');
                expect(spy).to.have.been.calledOnce;
                expect(spy.args[0][0].detail.clean).to.be.true;
            });

            it('should result in a disconnect event without msg when no reason given', function () {
                var spy = sinon.spy();
                client.addEventListener("disconnect", spy);
                client._rfb_connection_state = 'disconnecting';
                client._rfb_disconnect_reason = "";
                client._updateConnectionState('disconnected');
                expect(spy).to.have.been.calledOnce;
                expect(spy.args[0].length).to.equal(1);
            });
        });
    });

    describe('Protocol Initialization States', function () {
        var client;
        beforeEach(function () {
            client = make_rfb();
            client._rfb_connection_state = 'connecting';
        });

        describe('ProtocolVersion', function () {
            function send_ver (ver, client) {
                var arr = new Uint8Array(12);
                for (var i = 0; i < ver.length; i++) {
                    arr[i+4] = ver.charCodeAt(i);
                }
                arr[0] = 'R'; arr[1] = 'F'; arr[2] = 'B'; arr[3] = ' ';
                arr[11] = '\n';
                client._sock._websocket._receive_data(arr);
            }

            describe('version parsing', function () {
                it('should interpret version 003.003 as version 3.3', function () {
                    send_ver('003.003', client);
                    expect(client._rfb_version).to.equal(3.3);
                });

                it('should interpret version 003.006 as version 3.3', function () {
                    send_ver('003.006', client);
                    expect(client._rfb_version).to.equal(3.3);
                });

                it('should interpret version 003.889 as version 3.3', function () {
                    send_ver('003.889', client);
                    expect(client._rfb_version).to.equal(3.3);
                });

                it('should interpret version 003.007 as version 3.7', function () {
                    send_ver('003.007', client);
                    expect(client._rfb_version).to.equal(3.7);
                });

                it('should interpret version 003.008 as version 3.8', function () {
                    send_ver('003.008', client);
                    expect(client._rfb_version).to.equal(3.8);
                });

                it('should interpret version 004.000 as version 3.8', function () {
                    send_ver('004.000', client);
                    expect(client._rfb_version).to.equal(3.8);
                });

                it('should interpret version 004.001 as version 3.8', function () {
                    send_ver('004.001', client);
                    expect(client._rfb_version).to.equal(3.8);
                });

                it('should interpret version 005.000 as version 3.8', function () {
                    send_ver('005.000', client);
                    expect(client._rfb_version).to.equal(3.8);
                });

                it('should fail on an invalid version', function () {
                    sinon.spy(client, "_fail");
                    send_ver('002.000', client);
                    expect(client._fail).to.have.been.calledOnce;
                });
            });

            it('should send back the interpreted version', function () {
                send_ver('004.000', client);

                var expected_str = 'RFB 003.008\n';
                var expected = [];
                for (var i = 0; i < expected_str.length; i++) {
                    expected[i] = expected_str.charCodeAt(i);
                }

                expect(client._sock).to.have.sent(new Uint8Array(expected));
            });

            it('should transition to the Security state on successful negotiation', function () {
                send_ver('003.008', client);
                expect(client._rfb_init_state).to.equal('Security');
            });

            describe('Repeater', function () {
                beforeEach(function () {
                    client = make_rfb('wss://host:8675', { repeaterID: "12345" });
                    client._rfb_connection_state = 'connecting';
                });

                it('should interpret version 000.000 as a repeater', function () {
                    send_ver('000.000', client);
                    expect(client._rfb_version).to.equal(0);

                    var sent_data = client._sock._websocket._get_sent_data();
                    expect(new Uint8Array(sent_data.buffer, 0, 9)).to.array.equal(new Uint8Array([73, 68, 58, 49, 50, 51, 52, 53, 0]));
                    expect(sent_data).to.have.length(250);
                });

                it('should handle two step repeater negotiation', function () {
                    send_ver('000.000', client);
                    send_ver('003.008', client);
                    expect(client._rfb_version).to.equal(3.8);
                });
            });
        });

        describe('Security', function () {
            beforeEach(function () {
                client._rfb_init_state = 'Security';
            });

            it('should simply receive the auth scheme when for versions < 3.7', function () {
                client._rfb_version = 3.6;
                var auth_scheme_raw = [1, 2, 3, 4];
                var auth_scheme = (auth_scheme_raw[0] << 24) + (auth_scheme_raw[1] << 16) +
                                  (auth_scheme_raw[2] << 8) + auth_scheme_raw[3];
                client._sock._websocket._receive_data(auth_scheme_raw);
                expect(client._rfb_auth_scheme).to.equal(auth_scheme);
            });

            it('should prefer no authentication is possible', function () {
                client._rfb_version = 3.7;
                var auth_schemes = [2, 1, 3];
                client._sock._websocket._receive_data(auth_schemes);
                expect(client._rfb_auth_scheme).to.equal(1);
                expect(client._sock).to.have.sent(new Uint8Array([1, 1]));
            });

            it('should choose for the most prefered scheme possible for versions >= 3.7', function () {
                client._rfb_version = 3.7;
                var auth_schemes = [2, 22, 16];
                client._sock._websocket._receive_data(auth_schemes);
                expect(client._rfb_auth_scheme).to.equal(22);
                expect(client._sock).to.have.sent(new Uint8Array([22]));
            });

            it('should fail if there are no supported schemes for versions >= 3.7', function () {
                sinon.spy(client, "_fail");
                client._rfb_version = 3.7;
                var auth_schemes = [1, 32];
                client._sock._websocket._receive_data(auth_schemes);
                expect(client._fail).to.have.been.calledOnce;
            });

            it('should fail with the appropriate message if no types are sent for versions >= 3.7', function () {
                client._rfb_version = 3.7;
                var failure_data = [0, 0, 0, 0, 6, 119, 104, 111, 111, 112, 115];
                sinon.spy(client, '_fail');
                client._sock._websocket._receive_data(failure_data);

                expect(client._fail).to.have.been.calledOnce;
                expect(client._fail).to.have.been.calledWith(
                    'Security negotiation failed on no security types (reason: whoops)');
            });

            it('should transition to the Authentication state and continue on successful negotiation', function () {
                client._rfb_version = 3.7;
                var auth_schemes = [1, 1];
                client._negotiate_authentication = sinon.spy();
                client._sock._websocket._receive_data(auth_schemes);
                expect(client._rfb_init_state).to.equal('Authentication');
                expect(client._negotiate_authentication).to.have.been.calledOnce;
            });
        });

        describe('Authentication', function () {
            beforeEach(function () {
                client._rfb_init_state = 'Security';
            });

            function send_security(type, cl) {
                cl._sock._websocket._receive_data(new Uint8Array([1, type]));
            }

            it('should fail on auth scheme 0 (pre 3.7) with the given message', function () {
                client._rfb_version = 3.6;
                var err_msg = "Whoopsies";
                var data = [0, 0, 0, 0];
                var err_len = err_msg.length;
                push32(data, err_len);
                for (var i = 0; i < err_len; i++) {
                    data.push(err_msg.charCodeAt(i));
                }

                sinon.spy(client, '_fail');
                client._sock._websocket._receive_data(new Uint8Array(data));
                expect(client._fail).to.have.been.calledWith(
                    'Security negotiation failed on authentication scheme (reason: Whoopsies)');
            });

            it('should transition straight to SecurityResult on "no auth" (1) for versions >= 3.8', function () {
                client._rfb_version = 3.8;
                send_security(1, client);
                expect(client._rfb_init_state).to.equal('SecurityResult');
            });

            it('should transition straight to ServerInitialisation on "no auth" for versions < 3.8', function () {
                client._rfb_version = 3.7;
                send_security(1, client);
                expect(client._rfb_init_state).to.equal('ServerInitialisation');
            });

            it('should fail on an unknown auth scheme', function () {
                sinon.spy(client, "_fail");
                client._rfb_version = 3.8;
                send_security(57, client);
                expect(client._fail).to.have.been.calledOnce;
            });

            describe('VNC Authentication (type 2) Handler', function () {
                beforeEach(function () {
                    client._rfb_init_state = 'Security';
                    client._rfb_version = 3.8;
                });

                it('should fire the credentialsrequired event if missing a password', function () {
                    var spy = sinon.spy();
                    client.addEventListener("credentialsrequired", spy);
                    send_security(2, client);

                    var challenge = [];
                    for (var i = 0; i < 16; i++) { challenge[i] = i; }
                    client._sock._websocket._receive_data(new Uint8Array(challenge));

                    expect(client._rfb_credentials).to.be.empty;
                    expect(spy).to.have.been.calledOnce;
                    expect(spy.args[0][0].detail.types).to.have.members(["password"]);
                });

                it('should encrypt the password with DES and then send it back', function () {
                    client._rfb_credentials = { password: 'passwd' };
                    send_security(2, client);
                    client._sock._websocket._get_sent_data(); // skip the choice of auth reply

                    var challenge = [];
                    for (var i = 0; i < 16; i++) { challenge[i] = i; }
                    client._sock._websocket._receive_data(new Uint8Array(challenge));

                    var des_pass = RFB.genDES('passwd', challenge);
                    expect(client._sock).to.have.sent(new Uint8Array(des_pass));
                });

                it('should transition to SecurityResult immediately after sending the password', function () {
                    client._rfb_credentials = { password: 'passwd' };
                    send_security(2, client);

                    var challenge = [];
                    for (var i = 0; i < 16; i++) { challenge[i] = i; }
                    client._sock._websocket._receive_data(new Uint8Array(challenge));

                    expect(client._rfb_init_state).to.equal('SecurityResult');
                });
            });

            describe('XVP Authentication (type 22) Handler', function () {
                beforeEach(function () {
                    client._rfb_init_state = 'Security';
                    client._rfb_version = 3.8;
                });

                it('should fall through to standard VNC authentication upon completion', function () {
                    client._rfb_credentials = { username: 'user',
                                                target: 'target',
                                                password: 'password' };
                    client._negotiate_std_vnc_auth = sinon.spy();
                    send_security(22, client);
                    expect(client._negotiate_std_vnc_auth).to.have.been.calledOnce;
                });

                it('should fire the credentialsrequired event if all credentials are missing', function() {
                    var spy = sinon.spy();
                    client.addEventListener("credentialsrequired", spy);
                    client._rfb_credentials = {};
                    send_security(22, client);

                    expect(client._rfb_credentials).to.be.empty;
                    expect(spy).to.have.been.calledOnce;
                    expect(spy.args[0][0].detail.types).to.have.members(["username", "password", "target"]);
                });

                it('should fire the credentialsrequired event if some credentials are missing', function() {
                    var spy = sinon.spy();
                    client.addEventListener("credentialsrequired", spy);
                    client._rfb_credentials = { username: 'user',
                                                target: 'target' };
                    send_security(22, client);

                    expect(spy).to.have.been.calledOnce;
                    expect(spy.args[0][0].detail.types).to.have.members(["username", "password", "target"]);
                });

                it('should send user and target separately', function () {
                    client._rfb_credentials = { username: 'user',
                                                target: 'target',
                                                password: 'password' };
                    client._negotiate_std_vnc_auth = sinon.spy();

                    send_security(22, client);

                    var expected = [22, 4, 6]; // auth selection, len user, len target
                    for (var i = 0; i < 10; i++) { expected[i+3] = 'usertarget'.charCodeAt(i); }

                    expect(client._sock).to.have.sent(new Uint8Array(expected));
                });
            });

            describe('TightVNC Authentication (type 16) Handler', function () {
                beforeEach(function () {
                    client._rfb_init_state = 'Security';
                    client._rfb_version = 3.8;
                    send_security(16, client);
                    client._sock._websocket._get_sent_data();  // skip the security reply
                });

                function send_num_str_pairs(pairs, client) {
                    var pairs_len = pairs.length;
                    var data = [];
                    push32(data, pairs_len);

                    for (var i = 0; i < pairs_len; i++) {
                        push32(data, pairs[i][0]);
                        var j;
                        for (j = 0; j < 4; j++) {
                            data.push(pairs[i][1].charCodeAt(j));
                        }
                        for (j = 0; j < 8; j++) {
                            data.push(pairs[i][2].charCodeAt(j));
                        }
                    }

                    client._sock._websocket._receive_data(new Uint8Array(data));
                }

                it('should skip tunnel negotiation if no tunnels are requested', function () {
                    client._sock._websocket._receive_data(new Uint8Array([0, 0, 0, 0]));
                    expect(client._rfb_tightvnc).to.be.true;
                });

                it('should fail if no supported tunnels are listed', function () {
                    sinon.spy(client, "_fail");
                    send_num_str_pairs([[123, 'OTHR', 'SOMETHNG']], client);
                    expect(client._fail).to.have.been.calledOnce;
                });

                it('should choose the notunnel tunnel type', function () {
                    send_num_str_pairs([[0, 'TGHT', 'NOTUNNEL'], [123, 'OTHR', 'SOMETHNG']], client);
                    expect(client._sock).to.have.sent(new Uint8Array([0, 0, 0, 0]));
                });

                it('should continue to sub-auth negotiation after tunnel negotiation', function () {
                    send_num_str_pairs([[0, 'TGHT', 'NOTUNNEL']], client);
                    client._sock._websocket._get_sent_data();  // skip the tunnel choice here
                    send_num_str_pairs([[1, 'STDV', 'NOAUTH__']], client);
                    expect(client._sock).to.have.sent(new Uint8Array([0, 0, 0, 1]));
                    expect(client._rfb_init_state).to.equal('SecurityResult');
                });

                /*it('should attempt to use VNC auth over no auth when possible', function () {
                    client._rfb_tightvnc = true;
                    client._negotiate_std_vnc_auth = sinon.spy();
                    send_num_str_pairs([[1, 'STDV', 'NOAUTH__'], [2, 'STDV', 'VNCAUTH_']], client);
                    expect(client._sock).to.have.sent([0, 0, 0, 1]);
                    expect(client._negotiate_std_vnc_auth).to.have.been.calledOnce;
                    expect(client._rfb_auth_scheme).to.equal(2);
                });*/ // while this would make sense, the original code doesn't actually do this

                it('should accept the "no auth" auth type and transition to SecurityResult', function () {
                    client._rfb_tightvnc = true;
                    send_num_str_pairs([[1, 'STDV', 'NOAUTH__']], client);
                    expect(client._sock).to.have.sent(new Uint8Array([0, 0, 0, 1]));
                    expect(client._rfb_init_state).to.equal('SecurityResult');
                });

                it('should accept VNC authentication and transition to that', function () {
                    client._rfb_tightvnc = true;
                    client._negotiate_std_vnc_auth = sinon.spy();
                    send_num_str_pairs([[2, 'STDV', 'VNCAUTH__']], client);
                    expect(client._sock).to.have.sent(new Uint8Array([0, 0, 0, 2]));
                    expect(client._negotiate_std_vnc_auth).to.have.been.calledOnce;
                    expect(client._rfb_auth_scheme).to.equal(2);
                });

                it('should fail if there are no supported auth types', function () {
                    sinon.spy(client, "_fail");
                    client._rfb_tightvnc = true;
                    send_num_str_pairs([[23, 'stdv', 'badval__']], client);
                    expect(client._fail).to.have.been.calledOnce;
                });
            });
        });

        describe('SecurityResult', function () {
            beforeEach(function () {
                client._rfb_init_state = 'SecurityResult';
            });

            it('should fall through to ServerInitialisation on a response code of 0', function () {
                client._sock._websocket._receive_data(new Uint8Array([0, 0, 0, 0]));
                expect(client._rfb_init_state).to.equal('ServerInitialisation');
            });

            it('should fail on an error code of 1 with the given message for versions >= 3.8', function () {
                client._rfb_version = 3.8;
                sinon.spy(client, '_fail');
                var failure_data = [0, 0, 0, 1, 0, 0, 0, 6, 119, 104, 111, 111, 112, 115];
                client._sock._websocket._receive_data(new Uint8Array(failure_data));
                expect(client._fail).to.have.been.calledWith(
                    'Security negotiation failed on security result (reason: whoops)');
            });

            it('should fail on an error code of 1 with a standard message for version < 3.8', function () {
                sinon.spy(client, '_fail');
                client._rfb_version = 3.7;
                client._sock._websocket._receive_data(new Uint8Array([0, 0, 0, 1]));
                expect(client._fail).to.have.been.calledWith(
                    'Security handshake failed');
            });

            it('should result in securityfailure event when receiving a non zero status', function () {
                var spy = sinon.spy();
                client.addEventListener("securityfailure", spy);
                client._sock._websocket._receive_data(new Uint8Array([0, 0, 0, 2]));
                expect(spy).to.have.been.calledOnce;
                expect(spy.args[0][0].detail.status).to.equal(2);
            });

            it('should include reason when provided in securityfailure event', function () {
                client._rfb_version = 3.8;
                var spy = sinon.spy();
                client.addEventListener("securityfailure", spy);
                var failure_data = [0, 0, 0, 1, 0, 0, 0, 12, 115, 117, 99, 104,
                                    32, 102, 97, 105, 108, 117, 114, 101];
                client._sock._websocket._receive_data(new Uint8Array(failure_data));
                expect(spy.args[0][0].detail.status).to.equal(1);
                expect(spy.args[0][0].detail.reason).to.equal('such failure');
            });

            it('should not include reason when length is zero in securityfailure event', function () {
                client._rfb_version = 3.9;
                var spy = sinon.spy();
                client.addEventListener("securityfailure", spy);
                var failure_data = [0, 0, 0, 1, 0, 0, 0, 0];
                client._sock._websocket._receive_data(new Uint8Array(failure_data));
                expect(spy.args[0][0].detail.status).to.equal(1);
                expect('reason' in spy.args[0][0].detail).to.be.false;
            });

            it('should not include reason in securityfailure event for version < 3.8', function () {
                client._rfb_version = 3.6;
                var spy = sinon.spy();
                client.addEventListener("securityfailure", spy);
                client._sock._websocket._receive_data(new Uint8Array([0, 0, 0, 2]));
                expect(spy.args[0][0].detail.status).to.equal(2);
                expect('reason' in spy.args[0][0].detail).to.be.false;
            });
        });

        describe('ClientInitialisation', function () {
            it('should transition to the ServerInitialisation state', function () {
                var client = make_rfb();
                client._rfb_connection_state = 'connecting';
                client._rfb_init_state = 'SecurityResult';
                client._sock._websocket._receive_data(new Uint8Array([0, 0, 0, 0]));
                expect(client._rfb_init_state).to.equal('ServerInitialisation');
            });

            it('should send 1 if we are in shared mode', function () {
                var client = make_rfb('wss://host:8675', { shared: true });
                client._rfb_connection_state = 'connecting';
                client._rfb_init_state = 'SecurityResult';
                client._sock._websocket._receive_data(new Uint8Array([0, 0, 0, 0]));
                expect(client._sock).to.have.sent(new Uint8Array([1]));
            });

            it('should send 0 if we are not in shared mode', function () {
                var client = make_rfb('wss://host:8675', { shared: false });
                client._rfb_connection_state = 'connecting';
                client._rfb_init_state = 'SecurityResult';
                client._sock._websocket._receive_data(new Uint8Array([0, 0, 0, 0]));
                expect(client._sock).to.have.sent(new Uint8Array([0]));
            });
        });

        describe('ServerInitialisation', function () {
            beforeEach(function () {
                client._rfb_init_state = 'ServerInitialisation';
            });

            function send_server_init(opts, client) {
                var full_opts = { width: 10, height: 12, bpp: 24, depth: 24, big_endian: 0,
                                  true_color: 1, red_max: 255, green_max: 255, blue_max: 255,
                                  red_shift: 16, green_shift: 8, blue_shift: 0, name: 'a name' };
                for (var opt in opts) {
                    full_opts[opt] = opts[opt];
                }
                var data = [];

                push16(data, full_opts.width);
                push16(data, full_opts.height);

                data.push(full_opts.bpp);
                data.push(full_opts.depth);
                data.push(full_opts.big_endian);
                data.push(full_opts.true_color);

                push16(data, full_opts.red_max);
                push16(data, full_opts.green_max);
                push16(data, full_opts.blue_max);
                push8(data, full_opts.red_shift);
                push8(data, full_opts.green_shift);
                push8(data, full_opts.blue_shift);

                // padding
                push8(data, 0);
                push8(data, 0);
                push8(data, 0);

                client._sock._websocket._receive_data(new Uint8Array(data));

                var name_data = [];
                push32(name_data, full_opts.name.length);
                for (var i = 0; i < full_opts.name.length; i++) {
                    name_data.push(full_opts.name.charCodeAt(i));
                }
                client._sock._websocket._receive_data(new Uint8Array(name_data));
            }

            it('should set the framebuffer width and height', function () {
                send_server_init({ width: 32, height: 84 }, client);
                expect(client._fb_width).to.equal(32);
                expect(client._fb_height).to.equal(84);
            });

            // NB(sross): we just warn, not fail, for endian-ness and shifts, so we don't test them

            it('should set the framebuffer name and call the callback', function () {
                var spy = sinon.spy();
                client.addEventListener("desktopname", spy);
                send_server_init({ name: 'some name' }, client);

                expect(client._fb_name).to.equal('some name');
                expect(spy).to.have.been.calledOnce;
                expect(spy.args[0][0].detail.name).to.equal('some name');
            });

            it('should handle the extended init message of the tight encoding', function () {
                // NB(sross): we don't actually do anything with it, so just test that we can
                //            read it w/o throwing an error
                client._rfb_tightvnc = true;
                send_server_init({}, client);

                var tight_data = [];
                push16(tight_data, 1);
                push16(tight_data, 2);
                push16(tight_data, 3);
                push16(tight_data, 0);
                for (var i = 0; i < 16 + 32 + 48; i++) {
                    tight_data.push(i);
                }
                client._sock._websocket._receive_data(tight_data);

                expect(client._rfb_connection_state).to.equal('connected');
            });

            it('should resize the display', function () {
                sinon.spy(client._display, 'resize');
                send_server_init({ width: 27, height: 32 }, client);

                expect(client._display.resize).to.have.been.calledOnce;
                expect(client._display.resize).to.have.been.calledWith(27, 32);
            });

            it('should grab the mouse and keyboard', function () {
                sinon.spy(client._keyboard, 'grab');
                sinon.spy(client._mouse, 'grab');
                send_server_init({}, client);
                expect(client._keyboard.grab).to.have.been.calledOnce;
                expect(client._mouse.grab).to.have.been.calledOnce;
            });

            describe('Initial Update Request', function () {
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
                    send_server_init({ width: 27, height: 32 }, client);

                    expect(RFB.messages.pixelFormat).to.have.been.calledOnce;
                    expect(RFB.messages.pixelFormat).to.have.been.calledWith(client._sock, 24, true);
                    expect(RFB.messages.pixelFormat).to.have.been.calledBefore(RFB.messages.clientEncodings);
                    expect(RFB.messages.clientEncodings).to.have.been.calledOnce;
                    expect(RFB.messages.clientEncodings.getCall(0).args[1]).to.include(encodings.encodingTight);
                    expect(RFB.messages.clientEncodings).to.have.been.calledBefore(RFB.messages.fbUpdateRequest);
                    expect(RFB.messages.fbUpdateRequest).to.have.been.calledOnce;
                    expect(RFB.messages.fbUpdateRequest).to.have.been.calledWith(client._sock, false, 0, 0, 27, 32);
                });

                it('should reply with restricted settings for Intel AMT servers', function () {
                    send_server_init({ width: 27, height: 32, name: "Intel(r) AMT KVM"}, client);

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

            it('should transition to the "connected" state', function () {
                send_server_init({}, client);
                expect(client._rfb_connection_state).to.equal('connected');
            });
        });
    });

    describe('Protocol Message Processing After Completing Initialization', function () {
        var client;

        beforeEach(function () {
            client = make_rfb();
            client._fb_name = 'some device';
            client._fb_width = 640;
            client._fb_height = 20;
        });

        describe('Framebuffer Update Handling', function () {
            var target_data_arr = [
                0xff, 0x00, 0x00, 255, 0x00, 0xff, 0x00, 255, 0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255,
                0x00, 0xff, 0x00, 255, 0xff, 0x00, 0x00, 255, 0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255,
                0xee, 0x00, 0xff, 255, 0x00, 0xee, 0xff, 255, 0xaa, 0xee, 0xff, 255, 0xab, 0xee, 0xff, 255,
                0xee, 0x00, 0xff, 255, 0x00, 0xee, 0xff, 255, 0xaa, 0xee, 0xff, 255, 0xab, 0xee, 0xff, 255
            ];
            var target_data;

            var target_data_check_arr = [
                0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255, 0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255,
                0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255, 0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255,
                0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255, 0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255,
                0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255, 0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255
            ];
            var target_data_check;

            before(function () {
                // NB(directxman12): PhantomJS 1.x doesn't implement Uint8ClampedArray
                target_data = new Uint8Array(target_data_arr);
                target_data_check = new Uint8Array(target_data_check_arr);
            });

            function send_fbu_msg (rect_info, rect_data, client, rect_cnt) {
                var data = [];

                if (!rect_cnt || rect_cnt > -1) {
                    // header
                    data.push(0);  // msg type
                    data.push(0);  // padding
                    push16(data, rect_cnt || rect_data.length);
                }

                for (var i = 0; i < rect_data.length; i++) {
                    if (rect_info[i]) {
                        push16(data, rect_info[i].x);
                        push16(data, rect_info[i].y);
                        push16(data, rect_info[i].width);
                        push16(data, rect_info[i].height);
                        push32(data, rect_info[i].encoding);
                    }
                    data = data.concat(rect_data[i]);
                }

                client._sock._websocket._receive_data(new Uint8Array(data));
            }

            it('should send an update request if there is sufficient data', function () {
                var expected_msg = {_sQ: new Uint8Array(10), _sQlen: 0, flush: function() {}};
                RFB.messages.fbUpdateRequest(expected_msg, true, 0, 0, 640, 20);

                client._framebufferUpdate = function () { return true; };
                client._sock._websocket._receive_data(new Uint8Array([0]));

                expect(client._sock).to.have.sent(expected_msg._sQ);
            });

            it('should not send an update request if we need more data', function () {
                client._sock._websocket._receive_data(new Uint8Array([0]));
                expect(client._sock._websocket._get_sent_data()).to.have.length(0);
            });

            it('should resume receiving an update if we previously did not have enough data', function () {
                var expected_msg = {_sQ: new Uint8Array(10), _sQlen: 0, flush: function() {}};
                RFB.messages.fbUpdateRequest(expected_msg, true, 0, 0, 640, 20);

                // just enough to set FBU.rects
                client._sock._websocket._receive_data(new Uint8Array([0, 0, 0, 3]));
                expect(client._sock._websocket._get_sent_data()).to.have.length(0);

                client._framebufferUpdate = function () { this._sock.rQskip8(); return true; };  // we magically have enough data
                // 247 should *not* be used as the message type here
                client._sock._websocket._receive_data(new Uint8Array([247]));
                expect(client._sock).to.have.sent(expected_msg._sQ);
            });

            it('should not send a request in continuous updates mode', function () {
                client._enabledContinuousUpdates = true;
                client._framebufferUpdate = function () { return true; };
                client._sock._websocket._receive_data(new Uint8Array([0]));

                expect(client._sock._websocket._get_sent_data()).to.have.length(0);
            });

            it('should fail on an unsupported encoding', function () {
                sinon.spy(client, "_fail");
                var rect_info = { x: 8, y: 11, width: 27, height: 32, encoding: 234 };
                send_fbu_msg([rect_info], [[]], client);
                expect(client._fail).to.have.been.calledOnce;
            });

            it('should be able to pause and resume receiving rects if not enought data', function () {
                // seed some initial data to copy
                client._fb_width = 4;
                client._fb_height = 4;
                client._display.resize(4, 4);
                client._display.blitRgbxImage(0, 0, 4, 2, new Uint8Array(target_data_check_arr.slice(0, 32)), 0);

                var info = [{ x: 0, y: 2, width: 2, height: 2, encoding: 0x01},
                            { x: 2, y: 2, width: 2, height: 2, encoding: 0x01}];
                // data says [{ old_x: 2, old_y: 0 }, { old_x: 0, old_y: 0 }]
                var rects = [[0, 2, 0, 0], [0, 0, 0, 0]];
                send_fbu_msg([info[0]], [rects[0]], client, 2);
                send_fbu_msg([info[1]], [rects[1]], client, -1);
                expect(client._display).to.have.displayed(target_data_check);
            });

            describe('Message Encoding Handlers', function () {
                beforeEach(function () {
                    // a really small frame
                    client._fb_width = 4;
                    client._fb_height = 4;
                    client._fb_depth = 24;
                    client._display.resize(4, 4);
                });

                it('should handle the RAW encoding', function () {
                    var info = [{ x: 0, y: 0, width: 2, height: 2, encoding: 0x00 },
                                { x: 2, y: 0, width: 2, height: 2, encoding: 0x00 },
                                { x: 0, y: 2, width: 4, height: 1, encoding: 0x00 },
                                { x: 0, y: 3, width: 4, height: 1, encoding: 0x00 }];
                    // data is in bgrx
                    var rects = [
                        [0x00, 0x00, 0xff, 0, 0x00, 0xff, 0x00, 0, 0x00, 0xff, 0x00, 0, 0x00, 0x00, 0xff, 0],
                        [0xff, 0x00, 0x00, 0, 0xff, 0x00, 0x00, 0, 0xff, 0x00, 0x00, 0, 0xff, 0x00, 0x00, 0],
                        [0xff, 0x00, 0xee, 0, 0xff, 0xee, 0x00, 0, 0xff, 0xee, 0xaa, 0, 0xff, 0xee, 0xab, 0],
                        [0xff, 0x00, 0xee, 0, 0xff, 0xee, 0x00, 0, 0xff, 0xee, 0xaa, 0, 0xff, 0xee, 0xab, 0]];
                    send_fbu_msg(info, rects, client);
                    expect(client._display).to.have.displayed(target_data);
                });

                it('should handle the RAW encoding in low colour mode', function () {
                    var info = [{ x: 0, y: 0, width: 2, height: 2, encoding: 0x00 },
                                { x: 2, y: 0, width: 2, height: 2, encoding: 0x00 },
                                { x: 0, y: 2, width: 4, height: 1, encoding: 0x00 },
                                { x: 0, y: 3, width: 4, height: 1, encoding: 0x00 }];
                    var rects = [
                        [0x03, 0x03, 0x03, 0x03],
                        [0x0c, 0x0c, 0x0c, 0x0c],
                        [0x0c, 0x0c, 0x03, 0x03],
                        [0x0c, 0x0c, 0x03, 0x03]];
                    client._fb_depth = 8;
                    send_fbu_msg(info, rects, client);
                    expect(client._display).to.have.displayed(target_data_check);
                });

                it('should handle the COPYRECT encoding', function () {
                    // seed some initial data to copy
                    client._display.blitRgbxImage(0, 0, 4, 2, new Uint8Array(target_data_check_arr.slice(0, 32)), 0);

                    var info = [{ x: 0, y: 2, width: 2, height: 2, encoding: 0x01},
                                { x: 2, y: 2, width: 2, height: 2, encoding: 0x01}];
                    // data says [{ old_x: 0, old_y: 0 }, { old_x: 0, old_y: 0 }]
                    var rects = [[0, 2, 0, 0], [0, 0, 0, 0]];
                    send_fbu_msg(info, rects, client);
                    expect(client._display).to.have.displayed(target_data_check);
                });

                // TODO(directxman12): for encodings with subrects, test resuming on partial send?
                // TODO(directxman12): test rre_chunk_sz (related to above about subrects)?

                it('should handle the RRE encoding', function () {
                    var info = [{ x: 0, y: 0, width: 4, height: 4, encoding: 0x02 }];
                    var rect = [];
                    push32(rect, 2); // 2 subrects
                    push32(rect, 0xff00ff); // becomes 00ff00ff --> #00FF00 bg color
                    rect.push(0xff); // becomes ff0000ff --> #0000FF color
                    rect.push(0x00);
                    rect.push(0x00);
                    rect.push(0xff);
                    push16(rect, 0); // x: 0
                    push16(rect, 0); // y: 0
                    push16(rect, 2); // width: 2
                    push16(rect, 2); // height: 2
                    rect.push(0xff); // becomes ff0000ff --> #0000FF color
                    rect.push(0x00);
                    rect.push(0x00);
                    rect.push(0xff);
                    push16(rect, 2); // x: 2
                    push16(rect, 2); // y: 2
                    push16(rect, 2); // width: 2
                    push16(rect, 2); // height: 2

                    send_fbu_msg(info, [rect], client);
                    expect(client._display).to.have.displayed(target_data_check);
                });

                describe('the HEXTILE encoding handler', function () {
                    it('should handle a tile with fg, bg specified, normal subrects', function () {
                        var info = [{ x: 0, y: 0, width: 4, height: 4, encoding: 0x05 }];
                        var rect = [];
                        rect.push(0x02 | 0x04 | 0x08); // bg spec, fg spec, anysubrects
                        push32(rect, 0xff00ff); // becomes 00ff00ff --> #00FF00 bg color
                        rect.push(0xff); // becomes ff0000ff --> #0000FF fg color
                        rect.push(0x00);
                        rect.push(0x00);
                        rect.push(0xff);
                        rect.push(2); // 2 subrects
                        rect.push(0); // x: 0, y: 0
                        rect.push(1 | (1 << 4)); // width: 2, height: 2
                        rect.push(2 | (2 << 4)); // x: 2, y: 2
                        rect.push(1 | (1 << 4)); // width: 2, height: 2
                        send_fbu_msg(info, [rect], client);
                        expect(client._display).to.have.displayed(target_data_check);
                    });

                    it('should handle a raw tile', function () {
                        var info = [{ x: 0, y: 0, width: 4, height: 4, encoding: 0x05 }];
                        var rect = [];
                        rect.push(0x01); // raw
                        for (var i = 0; i < target_data.length; i += 4) {
                            rect.push(target_data[i + 2]);
                            rect.push(target_data[i + 1]);
                            rect.push(target_data[i]);
                            rect.push(target_data[i + 3]);
                        }
                        send_fbu_msg(info, [rect], client);
                        expect(client._display).to.have.displayed(target_data);
                    });

                    it('should handle a tile with only bg specified (solid bg)', function () {
                        var info = [{ x: 0, y: 0, width: 4, height: 4, encoding: 0x05 }];
                        var rect = [];
                        rect.push(0x02);
                        push32(rect, 0xff00ff); // becomes 00ff00ff --> #00FF00 bg color
                        send_fbu_msg(info, [rect], client);

                        var expected = [];
                        for (var i = 0; i < 16; i++) { push32(expected, 0xff00ff); }
                        expect(client._display).to.have.displayed(new Uint8Array(expected));
                    });

                    it('should handle a tile with only bg specified and an empty frame afterwards', function () {
                        // set the width so we can have two tiles
                        client._fb_width = 8;
                        client._display.resize(8, 4);

                        var info = [{ x: 0, y: 0, width: 32, height: 4, encoding: 0x05 }];

                        var rect = [];

                        // send a bg frame
                        rect.push(0x02);
                        push32(rect, 0xff00ff); // becomes 00ff00ff --> #00FF00 bg color

                        // send an empty frame
                        rect.push(0x00);

                        send_fbu_msg(info, [rect], client);

                        var expected = [];
                        var i;
                        for (i = 0; i < 16; i++) { push32(expected, 0xff00ff); }     // rect 1: solid
                        for (i = 0; i < 16; i++) { push32(expected, 0xff00ff); }    // rect 2: same bkground color
                        expect(client._display).to.have.displayed(new Uint8Array(expected));
                    });

                    it('should handle a tile with bg and coloured subrects', function () {
                        var info = [{ x: 0, y: 0, width: 4, height: 4, encoding: 0x05 }];
                        var rect = [];
                        rect.push(0x02 | 0x08 | 0x10); // bg spec, anysubrects, colouredsubrects
                        push32(rect, 0xff00ff); // becomes 00ff00ff --> #00FF00 bg color
                        rect.push(2); // 2 subrects
                        rect.push(0xff); // becomes ff0000ff --> #0000FF fg color
                        rect.push(0x00);
                        rect.push(0x00);
                        rect.push(0xff);
                        rect.push(0); // x: 0, y: 0
                        rect.push(1 | (1 << 4)); // width: 2, height: 2
                        rect.push(0xff); // becomes ff0000ff --> #0000FF fg color
                        rect.push(0x00);
                        rect.push(0x00);
                        rect.push(0xff);
                        rect.push(2 | (2 << 4)); // x: 2, y: 2
                        rect.push(1 | (1 << 4)); // width: 2, height: 2
                        send_fbu_msg(info, [rect], client);
                        expect(client._display).to.have.displayed(target_data_check);
                    });

                    it('should carry over fg and bg colors from the previous tile if not specified', function () {
                        client._fb_width = 4;
                        client._fb_height = 17;
                        client._display.resize(4, 17);

                        var info = [{ x: 0, y: 0, width: 4, height: 17, encoding: 0x05}];
                        var rect = [];
                        rect.push(0x02 | 0x04 | 0x08); // bg spec, fg spec, anysubrects
                        push32(rect, 0xff00ff); // becomes 00ff00ff --> #00FF00 bg color
                        rect.push(0xff); // becomes ff0000ff --> #0000FF fg color
                        rect.push(0x00);
                        rect.push(0x00);
                        rect.push(0xff);
                        rect.push(8); // 8 subrects
                        var i;
                        for (i = 0; i < 4; i++) {
                            rect.push((0 << 4) | (i * 4)); // x: 0, y: i*4
                            rect.push(1 | (1 << 4)); // width: 2, height: 2
                            rect.push((2 << 4) | (i * 4 + 2)); // x: 2, y: i * 4 + 2
                            rect.push(1 | (1 << 4)); // width: 2, height: 2
                        }
                        rect.push(0x08); // anysubrects
                        rect.push(1); // 1 subrect
                        rect.push(0); // x: 0, y: 0
                        rect.push(1 | (1 << 4)); // width: 2, height: 2
                        send_fbu_msg(info, [rect], client);

                        var expected = [];
                        for (i = 0; i < 4; i++) { expected = expected.concat(target_data_check_arr); }
                        expected = expected.concat(target_data_check_arr.slice(0, 16));
                        expect(client._display).to.have.displayed(new Uint8Array(expected));
                    });

                    it('should fail on an invalid subencoding', function () {
                        sinon.spy(client,"_fail");
                        var info = [{ x: 0, y: 0, width: 4, height: 4, encoding: 0x05 }];
                        var rects = [[45]];  // an invalid subencoding
                        send_fbu_msg(info, rects, client);
                        expect(client._fail).to.have.been.calledOnce;
                    });
                });

                it.skip('should handle the TIGHT encoding', function () {
                    // TODO(directxman12): test this
                });

                it.skip('should handle the TIGHT_PNG encoding', function () {
                    // TODO(directxman12): test this
                });

                it('should handle the DesktopSize pseduo-encoding', function () {
                    var spy = sinon.spy();
                    sinon.spy(client._display, 'resize');
                    send_fbu_msg([{ x: 0, y: 0, width: 20, height: 50, encoding: -223 }], [[]], client);

                    expect(client._fb_width).to.equal(20);
                    expect(client._fb_height).to.equal(50);

                    expect(client._display.resize).to.have.been.calledOnce;
                    expect(client._display.resize).to.have.been.calledWith(20, 50);
                });

                describe('the ExtendedDesktopSize pseudo-encoding handler', function () {
                    var resizeSpy;

                    beforeEach(function () {
                        // a really small frame
                        client._fb_width = 4;
                        client._fb_height = 4;
                        client._display.resize(4, 4);
                        sinon.spy(client._display, 'resize');
                        resizeSpy = sinon.spy();
                    });

                    function make_screen_data (nr_of_screens) {
                        var data = [];
                        push8(data, nr_of_screens);   // number-of-screens
                        push8(data, 0);               // padding
                        push16(data, 0);              // padding
                        for (var i=0; i<nr_of_screens; i += 1) {
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
                        var reason_for_change = 1; // requested by this client
                        var status_code       = 0; // No error

                        send_fbu_msg([{ x: reason_for_change, y: status_code,
                                        width: 20, height: 50, encoding: -308 }],
                                     make_screen_data(1), client);

                        expect(client._fb_width).to.equal(20);
                        expect(client._fb_height).to.equal(50);

                        expect(client._display.resize).to.have.been.calledOnce;
                        expect(client._display.resize).to.have.been.calledWith(20, 50);
                    });

                    it('should handle a resize requested by another client', function () {
                        var reason_for_change = 2; // requested by another client
                        var status_code       = 0; // No error

                        send_fbu_msg([{ x: reason_for_change, y: status_code,
                                        width: 20, height: 50, encoding: -308 }],
                                     make_screen_data(1), client);

                        expect(client._fb_width).to.equal(20);
                        expect(client._fb_height).to.equal(50);

                        expect(client._display.resize).to.have.been.calledOnce;
                        expect(client._display.resize).to.have.been.calledWith(20, 50);
                    });

                    it('should be able to recieve requests which contain data for multiple screens', function () {
                        var reason_for_change = 2; // requested by another client
                        var status_code       = 0; // No error

                        send_fbu_msg([{ x: reason_for_change, y: status_code,
                                        width: 60, height: 50, encoding: -308 }],
                                     make_screen_data(3), client);

                        expect(client._fb_width).to.equal(60);
                        expect(client._fb_height).to.equal(50);

                        expect(client._display.resize).to.have.been.calledOnce;
                        expect(client._display.resize).to.have.been.calledWith(60, 50);
                    });

                    it('should not handle a failed request', function () {
                        var reason_for_change = 1; // requested by this client
                        var status_code       = 1; // Resize is administratively prohibited

                        send_fbu_msg([{ x: reason_for_change, y: status_code,
                                        width: 20, height: 50, encoding: -308 }],
                                     make_screen_data(1), client);

                        expect(client._fb_width).to.equal(4);
                        expect(client._fb_height).to.equal(4);

                        expect(client._display.resize).to.not.have.been.called;
                    });
                });

                it.skip('should handle the Cursor pseudo-encoding', function () {
                    // TODO(directxman12): test
                });

                it('should handle the last_rect pseudo-encoding', function () {
                    send_fbu_msg([{ x: 0, y: 0, width: 0, height: 0, encoding: -224}], [[]], client, 100);
                    expect(client._FBU.rects).to.equal(0);
                });
            });
        });

        describe('XVP Message Handling', function () {
            it('should set the XVP version and fire the callback with the version on XVP_INIT', function () {
                var spy = sinon.spy();
                client.addEventListener("capabilities", spy);
                client._sock._websocket._receive_data(new Uint8Array([250, 0, 10, 1]));
                expect(client._rfb_xvp_ver).to.equal(10);
                expect(spy).to.have.been.calledOnce;
                expect(spy.args[0][0].detail.capabilities.power).to.be.true;
                expect(client.capabilities.power).to.be.true;
            });

            it('should fail on unknown XVP message types', function () {
                sinon.spy(client, "_fail");
                client._sock._websocket._receive_data(new Uint8Array([250, 0, 10, 237]));
                expect(client._fail).to.have.been.calledOnce;
            });
        });

        it('should fire the clipboard callback with the retrieved text on ServerCutText', function () {
            var expected_str = 'cheese!';
            var data = [3, 0, 0, 0];
            push32(data, expected_str.length);
            for (var i = 0; i < expected_str.length; i++) { data.push(expected_str.charCodeAt(i)); }
            var spy = sinon.spy();
            client.addEventListener("clipboard", spy);

            client._sock._websocket._receive_data(new Uint8Array(data));
            expect(spy).to.have.been.calledOnce;
            expect(spy.args[0][0].detail.text).to.equal(expected_str);
        });

        it('should fire the bell callback on Bell', function () {
            var spy = sinon.spy();
            client.addEventListener("bell", spy);
            client._sock._websocket._receive_data(new Uint8Array([2]));
            expect(spy).to.have.been.calledOnce;
        });

        it('should respond correctly to ServerFence', function () {
            var expected_msg = {_sQ: new Uint8Array(16), _sQlen: 0, flush: function() {}};
            var incoming_msg = {_sQ: new Uint8Array(16), _sQlen: 0, flush: function() {}};

            var payload = "foo\x00ab9";

            // ClientFence and ServerFence are identical in structure
            RFB.messages.clientFence(expected_msg, (1<<0) | (1<<1), payload);
            RFB.messages.clientFence(incoming_msg, 0xffffffff, payload);

            client._sock._websocket._receive_data(incoming_msg._sQ);

            expect(client._sock).to.have.sent(expected_msg._sQ);

            expected_msg._sQlen = 0;
            incoming_msg._sQlen = 0;

            RFB.messages.clientFence(expected_msg, (1<<0), payload);
            RFB.messages.clientFence(incoming_msg, (1<<0) | (1<<31), payload);

            client._sock._websocket._receive_data(incoming_msg._sQ);

            expect(client._sock).to.have.sent(expected_msg._sQ);
        });

        it('should enable continuous updates on first EndOfContinousUpdates', function () {
            var expected_msg = {_sQ: new Uint8Array(10), _sQlen: 0, flush: function() {}};

            RFB.messages.enableContinuousUpdates(expected_msg, true, 0, 0, 640, 20);

            expect(client._enabledContinuousUpdates).to.be.false;

            client._sock._websocket._receive_data(new Uint8Array([150]));

            expect(client._enabledContinuousUpdates).to.be.true;
            expect(client._sock).to.have.sent(expected_msg._sQ);
        });

        it('should disable continuous updates on subsequent EndOfContinousUpdates', function () {
            client._enabledContinuousUpdates = true;
            client._supportsContinuousUpdates = true;

            client._sock._websocket._receive_data(new Uint8Array([150]));

            expect(client._enabledContinuousUpdates).to.be.false;
        });

        it('should update continuous updates on resize', function () {
            var expected_msg = {_sQ: new Uint8Array(10), _sQlen: 0, flush: function() {}};
            RFB.messages.enableContinuousUpdates(expected_msg, true, 0, 0, 90, 700);

            client._resize(450, 160);

            expect(client._sock._websocket._get_sent_data()).to.have.length(0);

            client._enabledContinuousUpdates = true;

            client._resize(90, 700);

            expect(client._sock).to.have.sent(expected_msg._sQ);
        });

        it('should fail on an unknown message type', function () {
            sinon.spy(client, "_fail");
            client._sock._websocket._receive_data(new Uint8Array([87]));
            expect(client._fail).to.have.been.calledOnce;
        });
    });

    describe('Asynchronous Events', function () {
        var client;
        beforeEach(function () {
            client = make_rfb();
        });

        describe('Mouse event handlers', function () {
            it('should not send button messages in view-only mode', function () {
                client._viewOnly = true;
                sinon.spy(client._sock, 'flush');
                client._handleMouseButton(0, 0, 1, 0x001);
                expect(client._sock.flush).to.not.have.been.called;
            });

            it('should not send movement messages in view-only mode', function () {
                client._viewOnly = true;
                sinon.spy(client._sock, 'flush');
                client._handleMouseMove(0, 0);
                expect(client._sock.flush).to.not.have.been.called;
            });

            it('should send a pointer event on mouse button presses', function () {
                client._handleMouseButton(10, 12, 1, 0x001);
                var pointer_msg = {_sQ: new Uint8Array(6), _sQlen: 0, flush: function () {}};
                RFB.messages.pointerEvent(pointer_msg, 10, 12, 0x001);
                expect(client._sock).to.have.sent(pointer_msg._sQ);
            });

            it('should send a mask of 1 on mousedown', function () {
                client._handleMouseButton(10, 12, 1, 0x001);
                var pointer_msg = {_sQ: new Uint8Array(6), _sQlen: 0, flush: function () {}};
                RFB.messages.pointerEvent(pointer_msg, 10, 12, 0x001);
                expect(client._sock).to.have.sent(pointer_msg._sQ);
            });

            it('should send a mask of 0 on mouseup', function () {
                client._mouse_buttonMask = 0x001;
                client._handleMouseButton(10, 12, 0, 0x001);
                var pointer_msg = {_sQ: new Uint8Array(6), _sQlen: 0, flush: function () {}};
                RFB.messages.pointerEvent(pointer_msg, 10, 12, 0x000);
                expect(client._sock).to.have.sent(pointer_msg._sQ);
            });

            it('should send a pointer event on mouse movement', function () {
                client._handleMouseMove(10, 12);
                var pointer_msg = {_sQ: new Uint8Array(6), _sQlen: 0, flush: function () {}};
                RFB.messages.pointerEvent(pointer_msg, 10, 12, 0x000);
                expect(client._sock).to.have.sent(pointer_msg._sQ);
            });

            it('should set the button mask so that future mouse movements use it', function () {
                client._handleMouseButton(10, 12, 1, 0x010);
                client._handleMouseMove(13, 9);
                var pointer_msg = {_sQ: new Uint8Array(12), _sQlen: 0, flush: function () {}};
                RFB.messages.pointerEvent(pointer_msg, 10, 12, 0x010);
                RFB.messages.pointerEvent(pointer_msg, 13, 9, 0x010);
                expect(client._sock).to.have.sent(pointer_msg._sQ);
            });
        });

        describe('Keyboard Event Handlers', function () {
            it('should send a key message on a key press', function () {
                var keyevent = {};
                client._handleKeyEvent(0x41, 'KeyA', true);
                var key_msg = {_sQ: new Uint8Array(8), _sQlen: 0, flush: function () {}};
                RFB.messages.keyEvent(key_msg, 0x41, 1);
                expect(client._sock).to.have.sent(key_msg._sQ);
            });

            it('should not send messages in view-only mode', function () {
                client._viewOnly = true;
                sinon.spy(client._sock, 'flush');
                client._handleKeyEvent('a', 'KeyA', true);
                expect(client._sock.flush).to.not.have.been.called;
            });
        });

        describe('WebSocket event handlers', function () {
            // message events
            it ('should do nothing if we receive an empty message and have nothing in the queue', function () {
                client._normal_msg = sinon.spy();
                client._sock._websocket._receive_data(new Uint8Array([]));
                expect(client._normal_msg).to.not.have.been.called;
            });

            it('should handle a message in the connected state as a normal message', function () {
                client._normal_msg = sinon.spy();
                client._sock._websocket._receive_data(new Uint8Array([1, 2, 3]));
                expect(client._normal_msg).to.have.been.calledOnce;
            });

            it('should handle a message in any non-disconnected/failed state like an init message', function () {
                client._rfb_connection_state = 'connecting';
                client._rfb_init_state = 'ProtocolVersion';
                client._init_msg = sinon.spy();
                client._sock._websocket._receive_data(new Uint8Array([1, 2, 3]));
                expect(client._init_msg).to.have.been.calledOnce;
            });

            it('should process all normal messages directly', function () {
                var spy = sinon.spy();
                client.addEventListener("bell", spy);
                client._sock._websocket._receive_data(new Uint8Array([0x02, 0x02]));
                expect(spy).to.have.been.calledTwice;
            });

            // open events
            it('should update the state to ProtocolVersion on open (if the state is "connecting")', function () {
                client = new RFB(document.createElement('div'), 'wss://host:8675');
                this.clock.tick();
                client._sock._websocket._open();
                expect(client._rfb_init_state).to.equal('ProtocolVersion');
            });

            it('should fail if we are not currently ready to connect and we get an "open" event', function () {
                sinon.spy(client, "_fail");
                client._rfb_connection_state = 'connected';
                client._sock._websocket._open();
                expect(client._fail).to.have.been.calledOnce;
            });

            // close events
            it('should transition to "disconnected" from "disconnecting" on a close event', function () {
                var real = client._sock._websocket.close;
                client._sock._websocket.close = function () {};
                client.disconnect();
                expect(client._rfb_connection_state).to.equal('disconnecting');
                client._sock._websocket.close = real;
                client._sock._websocket.close();
                expect(client._rfb_connection_state).to.equal('disconnected');
            });

            it('should fail if we get a close event while connecting', function () {
                sinon.spy(client, "_fail");
                client._rfb_connection_state = 'connecting';
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
});
