// requires local modules: util, websock, rfb, input/util, input/keysym, input/keysymdef, input/devices, inflator, des, display
// requires test modules: fake.websocket, assertions
/* jshint expr: true */
var assert = chai.assert;
var expect = chai.expect;

function make_rfb (extra_opts) {
    if (!extra_opts) {
        extra_opts = {};
    }

    extra_opts.target = extra_opts.target || document.createElement('canvas');
    return new RFB(extra_opts);
}

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
    "use strict";
    before(FakeWebSocket.replace);
    after(FakeWebSocket.restore);

    before(function () {
        this.clock = sinon.useFakeTimers();
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
    });

    describe('Public API Basic Behavior', function () {
        var client;
        beforeEach(function () {
            client = make_rfb();
        });

        describe('#connect', function () {
            beforeEach(function () { client._updateConnectionState = sinon.spy(); });

            it('should set the current state to "connecting"', function () {
                client.connect('host', 8675);
                expect(client._updateConnectionState).to.have.been.calledOnce;
                expect(client._updateConnectionState).to.have.been.calledWith('connecting');
            });

            it('should not try to connect if we are missing a host', function () {
                client._fail = sinon.spy();
                client._rfb_connection_state = '';
                client.connect(undefined, 8675);
                expect(client._fail).to.have.been.calledOnce;
                expect(client._updateConnectionState).to.not.have.been.called;
                expect(client._rfb_connection_state).to.equal('');
            });

            it('should not try to connect if we are missing a port', function () {
                client._fail = sinon.spy();
                client._rfb_connection_state = '';
                client.connect('abc');
                expect(client._fail).to.have.been.calledOnce;
                expect(client._updateConnectionState).to.not.have.been.called;
                expect(client._rfb_connection_state).to.equal('');
            });
        });

        describe('#disconnect', function () {
            beforeEach(function () { client._updateConnectionState = sinon.spy(); });

            it('should set the current state to "disconnecting"', function () {
                client.disconnect();
                expect(client._updateConnectionState).to.have.been.calledOnce;
                expect(client._updateConnectionState).to.have.been.calledWith('disconnecting');
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

        describe('#sendPassword', function () {
            beforeEach(function () { this.clock = sinon.useFakeTimers(); });
            afterEach(function () { this.clock.restore(); });

            it('should set the rfb password properly"', function () {
                client.sendPassword('pass');
                expect(client._rfb_password).to.equal('pass');
            });

            it('should call init_msg "soon"', function () {
                client._init_msg = sinon.spy();
                client.sendPassword('pass');
                this.clock.tick(5);
                expect(client._init_msg).to.have.been.calledOnce;
            });
        });

        describe('#sendCtrlAlDel', function () {
            beforeEach(function () {
                client._sock = new Websock();
                client._sock.open('ws://', 'binary');
                client._sock._websocket._open();
                sinon.spy(client._sock, 'flush');
                client._rfb_connection_state = 'connected';
                client._view_only = false;
            });

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
                client._rfb_connection_state = "broken";
                client.sendCtrlAltDel();
                expect(client._sock.flush).to.not.have.been.called;
            });

            it('should not send the keys if we are set as view_only', function () {
                client._view_only = true;
                client.sendCtrlAltDel();
                expect(client._sock.flush).to.not.have.been.called;
            });
        });

        describe('#sendKey', function () {
            beforeEach(function () {
                client._sock = new Websock();
                client._sock.open('ws://', 'binary');
                client._sock._websocket._open();
                sinon.spy(client._sock, 'flush');
                client._rfb_connection_state = 'connected';
                client._view_only = false;
            });

            it('should send a single key with the given code and state (down = true)', function () {
                var expected = {_sQ: new Uint8Array(8), _sQlen: 0, flush: function () {}};
                RFB.messages.keyEvent(expected, 123, 1);
                client.sendKey(123, true);
                expect(client._sock).to.have.sent(expected._sQ);
            });

            it('should send both a down and up event if the state is not specified', function () {
                var expected = {_sQ: new Uint8Array(16), _sQlen: 0, flush: function () {}};
                RFB.messages.keyEvent(expected, 123, 1);
                RFB.messages.keyEvent(expected, 123, 0);
                client.sendKey(123);
                expect(client._sock).to.have.sent(expected._sQ);
            });

            it('should not send the key if we are not in a normal state', function () {
                client._rfb_connection_state = "broken";
                client.sendKey(123);
                expect(client._sock.flush).to.not.have.been.called;
            });

            it('should not send the key if we are set as view_only', function () {
                client._view_only = true;
                client.sendKey(123);
                expect(client._sock.flush).to.not.have.been.called;
            });
        });

        describe('#clipboardPasteFrom', function () {
            beforeEach(function () {
                client._sock = new Websock();
                client._sock.open('ws://', 'binary');
                client._sock._websocket._open();
                sinon.spy(client._sock, 'flush');
                client._rfb_connection_state = 'connected';
                client._view_only = false;
            });

            it('should send the given text in a paste event', function () {
                var expected = {_sQ: new Uint8Array(11), _sQlen: 0, flush: function () {}};
                RFB.messages.clientCutText(expected, 'abc');
                client.clipboardPasteFrom('abc');
                expect(client._sock).to.have.sent(expected._sQ);
            });

            it('should not send the text if we are not in a normal state', function () {
                client._rfb_connection_state = "broken";
                client.clipboardPasteFrom('abc');
                expect(client._sock.flush).to.not.have.been.called;
            });
        });

        describe("#requestDesktopSize", function () {
            beforeEach(function() {
                client._sock = new Websock();
                client._sock.open('ws://', 'binary');
                client._sock._websocket._open();
                sinon.spy(client._sock, 'flush');
                client._rfb_connection_state = 'connected';
                client._view_only = false;
                client._supportsSetDesktopSize = true;
            });

            it('should send the request with the given width and height', function () {
                var expected = [251];
                push8(expected, 0);  // padding
                push16(expected, 1); // width
                push16(expected, 2); // height
                push8(expected, 1);  // number-of-screens
                push8(expected, 0);  // padding before screen array
                push32(expected, 0); // id
                push16(expected, 0); // x-position
                push16(expected, 0); // y-position
                push16(expected, 1); // width
                push16(expected, 2); // height
                push32(expected, 0); // flags

                client.requestDesktopSize(1, 2);
                expect(client._sock).to.have.sent(new Uint8Array(expected));
            });

            it('should not send the request if the client has not recieved a ExtendedDesktopSize rectangle', function () {
                client._supportsSetDesktopSize = false;
                client.requestDesktopSize(1,2);
                expect(client._sock.flush).to.not.have.been.called;
            });

            it('should not send the request if we are not in a normal state', function () {
                client._rfb_connection_state = "broken";
                client.requestDesktopSize(1,2);
                expect(client._sock.flush).to.not.have.been.called;
            });
        });

        describe("XVP operations", function () {
            beforeEach(function () {
                client._sock = new Websock();
                client._sock.open('ws://', 'binary');
                client._sock._websocket._open();
                sinon.spy(client._sock, 'flush');
                client._rfb_connection_state = 'connected';
                client._view_only = false;
                client._rfb_xvp_ver = 1;
            });

            it('should send the shutdown signal on #xvpShutdown', function () {
                client.xvpShutdown();
                expect(client._sock).to.have.sent(new Uint8Array([0xFA, 0x00, 0x01, 0x02]));
            });

            it('should send the reboot signal on #xvpReboot', function () {
                client.xvpReboot();
                expect(client._sock).to.have.sent(new Uint8Array([0xFA, 0x00, 0x01, 0x03]));
            });

            it('should send the reset signal on #xvpReset', function () {
                client.xvpReset();
                expect(client._sock).to.have.sent(new Uint8Array([0xFA, 0x00, 0x01, 0x04]));
            });

            it('should support sending arbitrary XVP operations via #xvpOp', function () {
                client.xvpOp(1, 7);
                expect(client._sock).to.have.sent(new Uint8Array([0xFA, 0x00, 0x01, 0x07]));
            });

            it('should not send XVP operations with higher versions than we support', function () {
                expect(client.xvpOp(2, 7)).to.be.false;
                expect(client._sock.flush).to.not.have.been.called;
            });
        });
    });

    describe('Misc Internals', function () {
        describe('#_updateConnectionState', function () {
            var client;
            beforeEach(function () {
                this.clock = sinon.useFakeTimers();
                client = make_rfb();
            });

            afterEach(function () {
                this.clock.restore();
            });

            it('should clear the disconnect timer if the state is not "disconnecting"', function () {
                var spy = sinon.spy();
                client._disconnTimer = setTimeout(spy, 50);
                client._updateConnectionState('connected');
                this.clock.tick(51);
                expect(spy).to.not.have.been.called;
                expect(client._disconnTimer).to.be.null;
            });

            it('should call the updateState callback', function () {
                client.set_onUpdateState(sinon.spy());
                client._updateConnectionState('a specific state');
                var spy = client.get_onUpdateState();
                expect(spy).to.have.been.calledOnce;
                expect(spy.args[0][1]).to.equal('a specific state');
            });

            it('should set the rfb_connection_state', function () {
                client._updateConnectionState('a specific state');
                expect(client._rfb_connection_state).to.equal('a specific state');
            });

            it('should not change the state when we are disconnected', function () {
                client._rfb_connection_state = 'disconnected';
                client._updateConnectionState('a specific state');
                expect(client._rfb_connection_state).to.not.equal('a specific state');
            });

            it('should ignore state changes to the same state', function () {
                client.set_onUpdateState(sinon.spy());
                client._rfb_connection_state = 'a specific state';
                client._updateConnectionState('a specific state');
                var spy = client.get_onUpdateState();
                expect(spy).to.not.have.been.called;
            });
        });

        describe('#_fail', function () {
            var client;
            beforeEach(function () {
                this.clock = sinon.useFakeTimers();
                client = make_rfb();
                client.connect('host', 8675);
            });

            afterEach(function () {
                this.clock.restore();
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

            it('should set disconnect_reason', function () {
                client._fail('a reason');
                expect(client._rfb_disconnect_reason).to.equal('a reason');
            });

            it('should result in disconnect callback with message when reason given', function () {
                client.set_onDisconnected(sinon.spy());
                client._fail('a reason');
                var spy = client.get_onDisconnected();
                this.clock.tick(2000);
                expect(spy).to.have.been.calledOnce;
                expect(spy.args[0].length).to.equal(2);
                expect(spy.args[0][1]).to.equal('a reason');
            });

        });

        describe('#_notification', function () {
            var client;
            beforeEach(function () { client = make_rfb(); });

            it('should call the notification callback', function () {
                client.set_onNotification(sinon.spy());
                client._notification('notify!', 'warn');
                var spy = client.get_onNotification();
                expect(spy).to.have.been.calledOnce;
                expect(spy.args[0][1]).to.equal('notify!');
                expect(spy.args[0][2]).to.equal('warn');
            });

            it('should not call the notification callback when level is invalid', function () {
                client.set_onNotification(sinon.spy());
                client._notification('notify!', 'invalid');
                var spy = client.get_onNotification();
                expect(spy).to.not.have.been.called;
            });
        });
    });

    describe('Connection States', function () {
        describe('connecting', function () {
            var client;
            beforeEach(function () { client = make_rfb(); });

            it('should reset the variable states', function () {
                sinon.spy(client, '_init_vars');
                client._updateConnectionState('connecting');
                expect(client._init_vars).to.have.been.calledOnce;
            });

            it('should actually connect to the websocket', function () {
                sinon.spy(client._sock, 'open');
                client._updateConnectionState('connecting');
                expect(client._sock.open).to.have.been.calledOnce;
            });

            it('should use wss:// to connect if encryption is enabled', function () {
                sinon.spy(client._sock, 'open');
                client.set_encrypt(true);
                client._updateConnectionState('connecting');
                expect(client._sock.open.args[0][0]).to.contain('wss://');
            });

            it('should use ws:// to connect if encryption is not enabled', function () {
                sinon.spy(client._sock, 'open');
                client.set_encrypt(true);
                client._updateConnectionState('connecting');
                expect(client._sock.open.args[0][0]).to.contain('wss://');
            });

            it('should use a uri with the host, port, and path specified to connect', function () {
                sinon.spy(client._sock, 'open');
                client.set_encrypt(false);
                client._rfb_host = 'HOST';
                client._rfb_port = 8675;
                client._rfb_path = 'PATH';
                client._updateConnectionState('connecting');
                expect(client._sock.open).to.have.been.calledWith('ws://HOST:8675/PATH');
            });
        });

        describe('disconnecting', function () {
            var client;
            beforeEach(function () {
                this.clock = sinon.useFakeTimers();
                client = make_rfb();
                client.connect('host', 8675);
            });

            afterEach(function () {
                this.clock.restore();
            });

            it('should force disconnect if we do not call Websock.onclose within the disconnection timeout', function () {
                sinon.spy(client, '_updateConnectionState');
                client._sock._websocket.close = function () {};  // explicitly don't call onclose
                client._updateConnectionState('disconnecting');
                this.clock.tick(client.get_disconnectTimeout() * 1000);
                expect(client._updateConnectionState).to.have.been.calledTwice;
                expect(client._rfb_disconnect_reason).to.not.equal("");
                expect(client._rfb_connection_state).to.equal("disconnected");
            });

            it('should not fail if Websock.onclose gets called within the disconnection timeout', function () {
                client._updateConnectionState('disconnecting');
                this.clock.tick(client.get_disconnectTimeout() * 500);
                client._sock._websocket.close();
                this.clock.tick(client.get_disconnectTimeout() * 500 + 1);
                expect(client._rfb_connection_state).to.equal('disconnected');
            });

            it('should close the WebSocket connection', function () {
                sinon.spy(client._sock, 'close');
                client._updateConnectionState('disconnecting');
                expect(client._sock.close).to.have.been.calledOnce;
            });
        });

        describe('disconnected', function () {
            var client;
            beforeEach(function () { client = make_rfb(); });

            it('should call the disconnect callback if the state is "disconnected"', function () {
                client.set_onDisconnected(sinon.spy());
                client._rfb_connection_state = 'disconnecting';
                client._rfb_disconnect_reason = "error";
                client._updateConnectionState('disconnected');
                var spy = client.get_onDisconnected();
                expect(spy).to.have.been.calledOnce;
                expect(spy.args[0][1]).to.equal("error");
            });

            it('should not call the disconnect callback if the state is not "disconnected"', function () {
                client.set_onDisconnected(sinon.spy());
                client._updateConnectionState('disconnecting');
                var spy = client.get_onDisconnected();
                expect(spy).to.not.have.been.called;
            });

            it('should call the disconnect callback without msg when no reason given', function () {
                client.set_onDisconnected(sinon.spy());
                client._rfb_connection_state = 'disconnecting';
                client._rfb_disconnect_reason = "";
                client._updateConnectionState('disconnected');
                var spy = client.get_onDisconnected();
                expect(spy).to.have.been.calledOnce;
                expect(spy.args[0].length).to.equal(1);
            });

            it('should call the updateState callback before the disconnect callback', function () {
                client.set_onDisconnected(sinon.spy());
                client.set_onUpdateState(sinon.spy());
                client._rfb_connection_state = 'other state';
                client._updateConnectionState('disconnected');
                var updateStateSpy = client.get_onUpdateState();
                var disconnectSpy = client.get_onDisconnected();
                expect(updateStateSpy.calledBefore(disconnectSpy)).to.be.true;
            });
        });

        // NB(directxman12): Connected does *nothing* in updateConnectionState
    });

    describe('Protocol Initialization States', function () {
        describe('ProtocolVersion', function () {
            beforeEach(function () {
                this.clock = sinon.useFakeTimers();
            });

            afterEach(function () {
                this.clock.restore();
            });

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
                var client;
                beforeEach(function () {
                    client = make_rfb();
                    client.connect('host', 8675);
                    client._sock._websocket._open();
                });

                it('should interpret version 000.000 as a repeater', function () {
                    client._repeaterID = '\x01\x02\x03\x04\x05';
                    send_ver('000.000', client);
                    expect(client._rfb_version).to.equal(0);

                    var sent_data = client._sock._websocket._get_sent_data();
                    expect(new Uint8Array(sent_data.buffer, 0, 5)).to.array.equal(new Uint8Array([1, 2, 3, 4, 5]));
                });

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

            var client;
            beforeEach(function () {
                client = make_rfb();
                client.connect('host', 8675);
                client._sock._websocket._open();
            });

            it('should handle two step repeater negotiation', function () {
                client._repeaterID = '\x01\x02\x03\x04\x05';

                send_ver('000.000', client);
                expect(client._rfb_version).to.equal(0);
                var sent_data = client._sock._websocket._get_sent_data();
                expect(new Uint8Array(sent_data.buffer, 0, 5)).to.array.equal(new Uint8Array([1, 2, 3, 4, 5]));
                expect(sent_data).to.have.length(250);

                send_ver('003.008', client);
                expect(client._rfb_version).to.equal(3.8);
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
        });

        describe('Security', function () {
            var client;

            beforeEach(function () {
                client = make_rfb();
                client.connect('host', 8675);
                client._sock._websocket._open();
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

            it('should choose for the most prefered scheme possible for versions >= 3.7', function () {
                client._rfb_version = 3.7;
                var auth_schemes = [2, 1, 2];
                client._sock._websocket._receive_data(auth_schemes);
                expect(client._rfb_auth_scheme).to.equal(2);
                expect(client._sock).to.have.sent(new Uint8Array([2]));
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
                expect(client._fail).to.have.been.calledWith('Security failure: whoops');
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
            var client;

            beforeEach(function () {
                client = make_rfb();
                client.connect('host', 8675);
                client._sock._websocket._open();
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
                expect(client._fail).to.have.been.calledWith('Auth failure: Whoopsies');
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
                var client;

                beforeEach(function () {
                    client = make_rfb();
                    client.connect('host', 8675);
                    client._sock._websocket._open();
                    client._rfb_init_state = 'Security';
                    client._rfb_version = 3.8;
                });

                it('should call the passwordRequired callback if missing a password', function () {
                    client.set_onPasswordRequired(sinon.spy());
                    send_security(2, client);

                    var spy = client.get_onPasswordRequired();
                    expect(client._rfb_password.length).to.equal(0);
                    expect(spy).to.have.been.calledOnce;
                });

                it('should encrypt the password with DES and then send it back', function () {
                    client._rfb_password = 'passwd';
                    send_security(2, client);
                    client._sock._websocket._get_sent_data(); // skip the choice of auth reply

                    var challenge = [];
                    for (var i = 0; i < 16; i++) { challenge[i] = i; }
                    client._sock._websocket._receive_data(new Uint8Array(challenge));

                    var des_pass = RFB.genDES('passwd', challenge);
                    expect(client._sock).to.have.sent(new Uint8Array(des_pass));
                });

                it('should transition to SecurityResult immediately after sending the password', function () {
                    client._rfb_password = 'passwd';
                    send_security(2, client);

                    var challenge = [];
                    for (var i = 0; i < 16; i++) { challenge[i] = i; }
                    client._sock._websocket._receive_data(new Uint8Array(challenge));

                    expect(client._rfb_init_state).to.equal('SecurityResult');
                });
            });

            describe('XVP Authentication (type 22) Handler', function () {
                var client;

                beforeEach(function () {
                    client = make_rfb();
                    client.connect('host', 8675);
                    client._sock._websocket._open();
                    client._rfb_init_state = 'Security';
                    client._rfb_version = 3.8;
                });

                it('should fall through to standard VNC authentication upon completion', function () {
                    client.set_xvp_password_sep('#');
                    client._rfb_password = 'user#target#password';
                    client._negotiate_std_vnc_auth = sinon.spy();
                    send_security(22, client);
                    expect(client._negotiate_std_vnc_auth).to.have.been.calledOnce;
                });

                it('should call the passwordRequired callback if the password is missing', function() {
                    client.set_onPasswordRequired(sinon.spy());
                    client._rfb_password = '';
                    send_security(22, client);

                    var spy = client.get_onPasswordRequired();
                    expect(client._rfb_password.length).to.equal(0);
                    expect(spy).to.have.been.calledOnce;
                });

                it('should call the passwordRequired callback if the password is improperly formatted', function() {
                    client.set_onPasswordRequired(sinon.spy());
                    client._rfb_password = 'user@target';
                    send_security(22, client);

                    var spy = client.get_onPasswordRequired();
                    expect(spy).to.have.been.calledOnce;
                });

                it('should split the password, send the first two parts, and pass on the last part', function () {
                    client.set_xvp_password_sep('#');
                    client._rfb_password = 'user#target#password';
                    client._negotiate_std_vnc_auth = sinon.spy();

                    send_security(22, client);

                    expect(client._rfb_password).to.equal('password');

                    var expected = [22, 4, 6]; // auth selection, len user, len target
                    for (var i = 0; i < 10; i++) { expected[i+3] = 'usertarget'.charCodeAt(i); }

                    expect(client._sock).to.have.sent(new Uint8Array(expected));
                });
            });

            describe('TightVNC Authentication (type 16) Handler', function () {
                var client;

                beforeEach(function () {
                    client = make_rfb();
                    client.connect('host', 8675);
                    client._sock._websocket._open();
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
            var client;

            beforeEach(function () {
                client = make_rfb();
                client.connect('host', 8675);
                client._sock._websocket._open();
                client._rfb_init_state = 'SecurityResult';
            });

            it('should fall through to ServerInitialisation on a response code of 0', function () {
                client._updateConnectionState = sinon.spy();
                client._sock._websocket._receive_data(new Uint8Array([0, 0, 0, 0]));
                expect(client._rfb_init_state).to.equal('ServerInitialisation');
            });

            it('should fail on an error code of 1 with the given message for versions >= 3.8', function () {
                client._rfb_version = 3.8;
                sinon.spy(client, '_fail');
                var failure_data = [0, 0, 0, 1, 0, 0, 0, 6, 119, 104, 111, 111, 112, 115];
                client._sock._websocket._receive_data(new Uint8Array(failure_data));
                expect(client._fail).to.have.been.calledWith('whoops');
            });

            it('should fail on an error code of 1 with a standard message for version < 3.8', function () {
                sinon.spy(client, '_fail');
                client._rfb_version = 3.7;
                client._sock._websocket._receive_data(new Uint8Array([0, 0, 0, 1]));
                expect(client._fail).to.have.been.calledWith('Authentication failure');
            });
        });

        describe('ClientInitialisation', function () {
            var client;

            beforeEach(function () {
                client = make_rfb();
                client.connect('host', 8675);
                client._sock._websocket._open();
                client._rfb_init_state = 'SecurityResult';
            });

            it('should transition to the ServerInitialisation state', function () {
                client._sock._websocket._receive_data(new Uint8Array([0, 0, 0, 0]));
                expect(client._rfb_init_state).to.equal('ServerInitialisation');
            });

            it('should send 1 if we are in shared mode', function () {
                client.set_shared(true);
                client._sock._websocket._receive_data(new Uint8Array([0, 0, 0, 0]));
                expect(client._sock).to.have.sent(new Uint8Array([1]));
            });

            it('should send 0 if we are not in shared mode', function () {
                client.set_shared(false);
                client._sock._websocket._receive_data(new Uint8Array([0, 0, 0, 0]));
                expect(client._sock).to.have.sent(new Uint8Array([0]));
            });
        });

        describe('ServerInitialisation', function () {
            var client;

            beforeEach(function () {
                client = make_rfb();
                client.connect('host', 8675);
                client._sock._websocket._open();
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
                client.set_onDesktopName(sinon.spy());
                send_server_init({ name: 'some name' }, client);

                var spy = client.get_onDesktopName();
                expect(client._fb_name).to.equal('some name');
                expect(spy).to.have.been.calledOnce;
                expect(spy.args[0][1]).to.equal('some name');
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

            it('should set the true color mode on the display to the configuration variable', function () {
                client.set_true_color(false);
                sinon.spy(client._display, 'set_true_color');
                send_server_init({ true_color: 1 }, client);
                expect(client._display.set_true_color).to.have.been.calledOnce;
                expect(client._display.set_true_color).to.have.been.calledWith(false);
            });

            it('should call the resize callback and resize the display', function () {
                client.set_onFBResize(sinon.spy());
                sinon.spy(client._display, 'resize');
                send_server_init({ width: 27, height: 32 }, client);

                var spy = client.get_onFBResize();
                expect(client._display.resize).to.have.been.calledOnce;
                expect(client._display.resize).to.have.been.calledWith(27, 32);
                expect(spy).to.have.been.calledOnce;
                expect(spy.args[0][1]).to.equal(27);
                expect(spy.args[0][2]).to.equal(32);
            });

            it('should grab the mouse and keyboard', function () {
                sinon.spy(client._keyboard, 'grab');
                sinon.spy(client._mouse, 'grab');
                send_server_init({}, client);
                expect(client._keyboard.grab).to.have.been.calledOnce;
                expect(client._mouse.grab).to.have.been.calledOnce;
            });

            it('should set the BPP and depth to 4 and 3 respectively if in true color mode', function () {
                client.set_true_color(true);
                send_server_init({}, client);
                expect(client._fb_Bpp).to.equal(4);
                expect(client._fb_depth).to.equal(3);
            });

            it('should set the BPP and depth to 1 and 1 respectively if not in true color mode', function () {
                client.set_true_color(false);
                send_server_init({}, client);
                expect(client._fb_Bpp).to.equal(1);
                expect(client._fb_depth).to.equal(1);
            });

            // TODO(directxman12): test the various options in this configuration matrix
            it('should reply with the pixel format, client encodings, and initial update request', function () {
                client.set_true_color(true);
                client.set_local_cursor(false);
                // we skip the cursor encoding
                var expected = {_sQ: new Uint8Array(34 + 4 * (client._encodings.length - 1)),
                                _sQlen: 0,
                                flush: function () {}};
                RFB.messages.pixelFormat(expected, 4, 3, true);
                RFB.messages.clientEncodings(expected, client._encodings, false, true);
                RFB.messages.fbUpdateRequest(expected, false, 0, 0, 27, 32);

                send_server_init({ width: 27, height: 32 }, client);
                expect(client._sock).to.have.sent(expected._sQ);
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
            client.connect('host', 8675);
            client._sock._websocket._open();
            client._rfb_connection_state = 'connected';
            client._fb_name = 'some device';
            client._fb_width = 640;
            client._fb_height = 20;
        });

        describe('Framebuffer Update Handling', function () {
            var client;

            beforeEach(function () {
                client = make_rfb();
                client.connect('host', 8675);
                client._sock._websocket._open();
                client._rfb_connection_state = 'connected';
                client._fb_name = 'some device';
                client._fb_width = 640;
                client._fb_height = 20;
            });

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
                RFB.messages.fbUpdateRequest(expected_msg, false, 0, 0, 240, 20);

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
                RFB.messages.fbUpdateRequest(expected_msg, false, 0, 0, 240, 20);

                // just enough to set FBU.rects
                client._sock._websocket._receive_data(new Uint8Array([0, 0, 0, 3]));
                expect(client._sock._websocket._get_sent_data()).to.have.length(0);

                client._framebufferUpdate = function () { this._sock.rQskip8(); return true; };  // we magically have enough data
                // 247 should *not* be used as the message type here
                client._sock._websocket._receive_data(new Uint8Array([247]));
                expect(client._sock).to.have.sent(expected_msg._sQ);
            });

            it('should send a request for both clean and dirty areas', function () {
                var expected_msg = {_sQ: new Uint8Array(20), _sQlen: 0, flush: function() {}};
                var expected_cdr = { cleanBox: { x: 0, y: 0, w: 120, h: 20 },
                                     dirtyBoxes: [ { x: 120, y: 0, w: 120, h: 20 } ] };

                RFB.messages.fbUpdateRequest(expected_msg, true, 0, 0, 120, 20);
                RFB.messages.fbUpdateRequest(expected_msg, false, 120, 0, 120, 20);

                client._framebufferUpdate = function () { return true; };
                client._display.getCleanDirtyReset = function () { return expected_cdr; };
                client._sock._websocket._receive_data(new Uint8Array([0]));

                expect(client._sock).to.have.sent(expected_msg._sQ);
            });

            it('should only request non-incremental rects in continuous updates mode', function () {
                var expected_msg = {_sQ: new Uint8Array(10), _sQlen: 0, flush: function() {}};
                var expected_cdr = { cleanBox: { x: 0, y: 0, w: 120, h: 20 },
                                     dirtyBoxes: [ { x: 120, y: 0, w: 120, h: 20 } ] };

                RFB.messages.fbUpdateRequest(expected_msg, false, 120, 0, 120, 20);

                client._enabledContinuousUpdates = true;
                client._framebufferUpdate = function () { return true; };
                client._display.getCleanDirtyReset = function () { return expected_cdr; };
                client._sock._websocket._receive_data(new Uint8Array([0]));

                expect(client._sock).to.have.sent(expected_msg._sQ);
            });

            it('should not send a request in continuous updates mode when clean', function () {
                var expected_cdr = { cleanBox: { x: 0, y: 0, w: 240, h: 20 },
                                     dirtyBoxes: [] };

                client._enabledContinuousUpdates = true;
                client._framebufferUpdate = function () { return true; };
                client._display.getCleanDirtyReset = function () { return expected_cdr; };
                client._sock._websocket._receive_data(new Uint8Array([0]));

                expect(client._sock._websocket._get_sent_data()).to.have.length(0);
            });

            it('should parse out information from a header before any actual data comes in', function () {
                client.set_onFBUReceive(sinon.spy());
                var rect_info = { x: 8, y: 11, width: 27, height: 32, encoding: 0x02, encodingName: 'RRE' };
                send_fbu_msg([rect_info], [[]], client);

                var spy = client.get_onFBUReceive();
                expect(spy).to.have.been.calledOnce;
                expect(spy).to.have.been.calledWith(sinon.match.any, rect_info);
            });

            it('should fire onFBUComplete when the update is complete', function () {
                client.set_onFBUComplete(sinon.spy());
                var rect_info = { x: 8, y: 11, width: 27, height: 32, encoding: -224, encodingName: 'last_rect' };
                send_fbu_msg([rect_info], [[]], client);  // last_rect

                var spy = client.get_onFBUComplete();
                expect(spy).to.have.been.calledOnce;
                expect(spy).to.have.been.calledWith(sinon.match.any, rect_info);
            });

            it('should not fire onFBUComplete if we have not finished processing the update', function () {
                client.set_onFBUComplete(sinon.spy());
                var rect_info = { x: 8, y: 11, width: 27, height: 32, encoding: 0x00, encodingName: 'RAW' };
                send_fbu_msg([rect_info], [[]], client);
                expect(client.get_onFBUComplete()).to.not.have.been.called;
            });

            it('should call the appropriate encoding handler', function () {
                client._encHandlers[0x02] = sinon.spy();
                var rect_info = { x: 8, y: 11, width: 27, height: 32, encoding: 0x02 };
                send_fbu_msg([rect_info], [[]], client);
                expect(client._encHandlers[0x02]).to.have.been.calledOnce;
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
                var initial_data = client._display._drawCtx.createImageData(4, 2);
                var initial_data_arr = target_data_check_arr.slice(0, 32);
                for (var i = 0; i < 32; i++) { initial_data.data[i] = initial_data_arr[i]; }
                client._display._drawCtx.putImageData(initial_data, 0, 0);

                var info = [{ x: 0, y: 2, width: 2, height: 2, encoding: 0x01},
                            { x: 2, y: 2, width: 2, height: 2, encoding: 0x01}];
                // data says [{ old_x: 0, old_y: 0 }, { old_x: 0, old_y: 0 }]
                var rects = [[0, 2, 0, 0], [0, 0, 0, 0]];
                send_fbu_msg([info[0]], [rects[0]], client, 2);
                send_fbu_msg([info[1]], [rects[1]], client, -1);
                expect(client._display).to.have.displayed(target_data_check);
            });

            describe('Message Encoding Handlers', function () {
                var client;

                beforeEach(function () {
                    client = make_rfb();
                    client.connect('host', 8675);
                    client._sock._websocket._open();
                    client._rfb_connection_state = 'connected';
                    client._fb_name = 'some device';
                    // a really small frame
                    client._fb_width = 4;
                    client._fb_height = 4;
                    client._display._fb_width = 4;
                    client._display._fb_height = 4;
                    client._display._viewportLoc.w = 4;
                    client._display._viewportLoc.h = 4;
                    client._fb_Bpp = 4;
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

                it('should handle the COPYRECT encoding', function () {
                    // seed some initial data to copy
                    var initial_data = client._display._drawCtx.createImageData(4, 2);
                    var initial_data_arr = target_data_check_arr.slice(0, 32);
                    for (var i = 0; i < 32; i++) { initial_data.data[i] = initial_data_arr[i]; }
                    client._display._drawCtx.putImageData(initial_data, 0, 0);

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
                    var client;
                    beforeEach(function () {
                        client = make_rfb();
                        client.connect('host', 8675);
                        client._sock._websocket._open();
                        client._rfb_connection_state = 'connected';
                        client._fb_name = 'some device';
                        // a really small frame
                        client._fb_width = 4;
                        client._fb_height = 4;
                        client._display._fb_width = 4;
                        client._display._fb_height = 4;
                        client._display._viewportLoc.w = 4;
                        client._display._viewportLoc.h = 4;
                        client._fb_Bpp = 4;
                    });

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
                        client._display._fb_width = 8;
                        client._display._viewportLoc.w = 8;

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
                    client.set_onFBResize(sinon.spy());
                    sinon.spy(client._display, 'resize');
                    send_fbu_msg([{ x: 0, y: 0, width: 20, height: 50, encoding: -223 }], [[]], client);

                    var spy = client.get_onFBResize();
                    expect(spy).to.have.been.calledOnce;
                    expect(spy).to.have.been.calledWith(sinon.match.any, 20, 50);

                    expect(client._fb_width).to.equal(20);
                    expect(client._fb_height).to.equal(50);

                    expect(client._display.resize).to.have.been.calledOnce;
                    expect(client._display.resize).to.have.been.calledWith(20, 50);
                });

                describe('the ExtendedDesktopSize pseudo-encoding handler', function () {
                    var client;

                    beforeEach(function () {
                        client = make_rfb();
                        client.connect('host', 8675);
                        client._sock._websocket._open();
                        client._rfb_connection_state = 'connected';
                        client._fb_name = 'some device';
                        client._supportsSetDesktopSize = false;
                        // a really small frame
                        client._fb_width = 4;
                        client._fb_height = 4;
                        client._display._fb_width = 4;
                        client._display._fb_height = 4;
                        client._display._viewportLoc.w = 4;
                        client._display._viewportLoc.h = 4;
                        client._fb_Bpp = 4;
                        sinon.spy(client._display, 'resize');
                        client.set_onFBResize(sinon.spy());
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

                        expect(client._supportsSetDesktopSize).to.be.true;
                        expect(client._fb_width).to.equal(20);
                        expect(client._fb_height).to.equal(50);

                        expect(client._display.resize).to.have.been.calledOnce;
                        expect(client._display.resize).to.have.been.calledWith(20, 50);

                        var spy = client.get_onFBResize();
                        expect(spy).to.have.been.calledOnce;
                        expect(spy).to.have.been.calledWith(sinon.match.any, 20, 50);
                    });

                    it('should handle a resize requested by another client', function () {
                        var reason_for_change = 2; // requested by another client
                        var status_code       = 0; // No error

                        send_fbu_msg([{ x: reason_for_change, y: status_code,
                                        width: 20, height: 50, encoding: -308 }],
                                     make_screen_data(1), client);

                        expect(client._supportsSetDesktopSize).to.be.true;
                        expect(client._fb_width).to.equal(20);
                        expect(client._fb_height).to.equal(50);

                        expect(client._display.resize).to.have.been.calledOnce;
                        expect(client._display.resize).to.have.been.calledWith(20, 50);

                        var spy = client.get_onFBResize();
                        expect(spy).to.have.been.calledOnce;
                        expect(spy).to.have.been.calledWith(sinon.match.any, 20, 50);
                    });

                    it('should be able to recieve requests which contain data for multiple screens', function () {
                        var reason_for_change = 2; // requested by another client
                        var status_code       = 0; // No error

                        send_fbu_msg([{ x: reason_for_change, y: status_code,
                                        width: 60, height: 50, encoding: -308 }],
                                     make_screen_data(3), client);

                        expect(client._supportsSetDesktopSize).to.be.true;
                        expect(client._fb_width).to.equal(60);
                        expect(client._fb_height).to.equal(50);

                        expect(client._display.resize).to.have.been.calledOnce;
                        expect(client._display.resize).to.have.been.calledWith(60, 50);

                        var spy = client.get_onFBResize();
                        expect(spy).to.have.been.calledOnce;
                        expect(spy).to.have.been.calledWith(sinon.match.any, 60, 50);
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

                        var spy = client.get_onFBResize();
                        expect(spy).to.not.have.been.called;
                    });
                });

                it.skip('should handle the Cursor pseudo-encoding', function () {
                    // TODO(directxman12): test
                });

                it('should handle the last_rect pseudo-encoding', function () {
                    client.set_onFBUReceive(sinon.spy());
                    send_fbu_msg([{ x: 0, y: 0, width: 0, height: 0, encoding: -224}], [[]], client, 100);
                    expect(client._FBU.rects).to.equal(0);
                    expect(client.get_onFBUReceive()).to.have.been.calledOnce;
                });
            });
        });

        it('should set the colour map on the display on SetColourMapEntries', function () {
            var expected_cm = [];
            var data = [1, 0, 0, 1, 0, 4];
            var i;
            for (i = 0; i < 4; i++) {
                expected_cm[i + 1] = [i * 10, i * 10 + 1, i * 10 + 2];
                push16(data, expected_cm[i + 1][2] << 8);
                push16(data, expected_cm[i + 1][1] << 8);
                push16(data, expected_cm[i + 1][0] << 8);
            }

            client._sock._websocket._receive_data(new Uint8Array(data));
            expect(client._display.get_colourMap()).to.deep.equal(expected_cm);
        });

        describe('XVP Message Handling', function () {
            beforeEach(function () {
                client = make_rfb();
                client.connect('host', 8675);
                client._sock._websocket._open();
                client._rfb_connection_state = 'connected';
                client._fb_name = 'some device';
                client._fb_width = 27;
                client._fb_height = 32;
            });

            it('should send a notification on XVP_FAIL', function () {
                client.set_onNotification(sinon.spy());
                client._sock._websocket._receive_data(new Uint8Array([250, 0, 10, 0]));
                var spy = client.get_onNotification();
                expect(spy).to.have.been.calledOnce;
                expect(spy.args[0][1]).to.equal('XVP Operation Failed');
            });

            it('should set the XVP version and fire the callback with the version on XVP_INIT', function () {
                client.set_onXvpInit(sinon.spy());
                client._sock._websocket._receive_data(new Uint8Array([250, 0, 10, 1]));
                expect(client._rfb_xvp_ver).to.equal(10);
                expect(client.get_onXvpInit()).to.have.been.calledOnce;
                expect(client.get_onXvpInit()).to.have.been.calledWith(10);
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
            client.set_onClipboard(sinon.spy());

            client._sock._websocket._receive_data(new Uint8Array(data));
            var spy = client.get_onClipboard();
            expect(spy).to.have.been.calledOnce;
            expect(spy.args[0][1]).to.equal(expected_str);
        });

        it('should fire the bell callback on Bell', function () {
            client.set_onBell(sinon.spy());
            client._sock._websocket._receive_data(new Uint8Array([2]));
            expect(client.get_onBell()).to.have.been.calledOnce;
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

            client._FBU.width = 450;
            client._FBU.height = 160;

            client._encHandlers.handle_FB_resize();

            expect(client._sock._websocket._get_sent_data()).to.have.length(0);

            client._enabledContinuousUpdates = true;

            client._FBU.width = 90;
            client._FBU.height = 700;

            client._encHandlers.handle_FB_resize();

            expect(client._sock).to.have.sent(expected_msg._sQ);
        });

        it('should fail on an unknown message type', function () {
            sinon.spy(client, "_fail");
            client._sock._websocket._receive_data(new Uint8Array([87]));
            expect(client._fail).to.have.been.calledOnce;
        });
    });

    describe('Asynchronous Events', function () {
        describe('Mouse event handlers', function () {
            var client;
            beforeEach(function () {
                client = make_rfb();
                client._sock = new Websock();
                client._sock.open('ws://', 'binary');
                client._sock._websocket._open();
                sinon.spy(client._sock, 'flush');
                client._rfb_connection_state = 'connected';
            });

            it('should not send button messages in view-only mode', function () {
                client._view_only = true;
                client._mouse._onMouseButton(0, 0, 1, 0x001);
                expect(client._sock.flush).to.not.have.been.called;
            });

            it('should not send movement messages in view-only mode', function () {
                client._view_only = true;
                client._mouse._onMouseMove(0, 0);
                expect(client._sock.flush).to.not.have.been.called;
            });

            it('should send a pointer event on mouse button presses', function () {
                client._mouse._onMouseButton(10, 12, 1, 0x001);
                var pointer_msg = {_sQ: new Uint8Array(6), _sQlen: 0, flush: function () {}};
                RFB.messages.pointerEvent(pointer_msg, 10, 12, 0x001);
                expect(client._sock).to.have.sent(pointer_msg._sQ);
            });

            it('should send a mask of 1 on mousedown', function () {
                client._mouse._onMouseButton(10, 12, 1, 0x001);
                var pointer_msg = {_sQ: new Uint8Array(6), _sQlen: 0, flush: function () {}};
                RFB.messages.pointerEvent(pointer_msg, 10, 12, 0x001);
                expect(client._sock).to.have.sent(pointer_msg._sQ);
            });

            it('should send a mask of 0 on mouseup', function () {
                client._mouse_buttonMask = 0x001;
                client._mouse._onMouseButton(10, 12, 0, 0x001);
                var pointer_msg = {_sQ: new Uint8Array(6), _sQlen: 0, flush: function () {}};
                RFB.messages.pointerEvent(pointer_msg, 10, 12, 0x000);
                expect(client._sock).to.have.sent(pointer_msg._sQ);
            });

            it('should send a pointer event on mouse movement', function () {
                client._mouse._onMouseMove(10, 12);
                var pointer_msg = {_sQ: new Uint8Array(6), _sQlen: 0, flush: function () {}};
                RFB.messages.pointerEvent(pointer_msg, 10, 12, 0x000);
                expect(client._sock).to.have.sent(pointer_msg._sQ);
            });

            it('should set the button mask so that future mouse movements use it', function () {
                client._mouse._onMouseButton(10, 12, 1, 0x010);
                client._mouse._onMouseMove(13, 9);
                var pointer_msg = {_sQ: new Uint8Array(12), _sQlen: 0, flush: function () {}};
                RFB.messages.pointerEvent(pointer_msg, 10, 12, 0x010);
                RFB.messages.pointerEvent(pointer_msg, 13, 9, 0x010);
                expect(client._sock).to.have.sent(pointer_msg._sQ);
            });

            // NB(directxman12): we don't need to test not sending messages in
            //                   non-normal modes, since we haven't grabbed input
            //                   yet (grabbing input should be checked in the lifecycle tests).

            it('should not send movement messages when viewport dragging', function () {
                client._viewportDragging = true;
                client._display.viewportChangePos = sinon.spy();
                client._mouse._onMouseMove(13, 9);
                expect(client._sock.flush).to.not.have.been.called;
            });

            it('should not send button messages when initiating viewport dragging', function () {
                client._viewportDrag = true;
                client._mouse._onMouseButton(13, 9, 0x001);
                expect(client._sock.flush).to.not.have.been.called;
            });

            it('should be initiate viewport dragging on a button down event, if enabled', function () {
                client._viewportDrag = true;
                client._mouse._onMouseButton(13, 9, 0x001);
                expect(client._viewportDragging).to.be.true;
                expect(client._viewportDragPos).to.deep.equal({ x: 13, y: 9 });
            });

            it('should terminate viewport dragging on a button up event, if enabled', function () {
                client._viewportDrag = true;
                client._viewportDragging = true;
                client._mouse._onMouseButton(13, 9, 0x000);
                expect(client._viewportDragging).to.be.false;
            });

            it('if enabled, viewportDragging should occur on mouse movement while a button is down', function () {
                client._viewportDrag = true;
                client._viewportDragging = true;
                client._viewportHasMoved = false;
                client._viewportDragPos = { x: 23, y: 9 };
                client._display.viewportChangePos = sinon.spy();

                client._mouse._onMouseMove(10, 4);

                expect(client._viewportDragging).to.be.true;
                expect(client._viewportHasMoved).to.be.true;
                expect(client._viewportDragPos).to.deep.equal({ x: 10, y: 4 });
                expect(client._display.viewportChangePos).to.have.been.calledOnce;
                expect(client._display.viewportChangePos).to.have.been.calledWith(13, 5);
            });
        });

        describe('Keyboard Event Handlers', function () {
            var client;
            beforeEach(function () {
                client = make_rfb();
                client._sock = new Websock();
                client._sock.open('ws://', 'binary');
                client._sock._websocket._open();
                sinon.spy(client._sock, 'flush');
            });

            it('should send a key message on a key press', function () {
                var keyevent = {};
                keyevent.type = 'keydown';
                keyevent.keysym = {};
                keyevent.keysym.keysym = 1234;
                client._keyboard._onKeyPress(keyevent);
                var key_msg = {_sQ: new Uint8Array(8), _sQlen: 0, flush: function () {}};
                RFB.messages.keyEvent(key_msg, 1234, 1);
                expect(client._sock).to.have.sent(key_msg._sQ);
            });

            it('should not send messages in view-only mode', function () {
                client._view_only = true;
                client._keyboard._onKeyPress(1234, 1);
                expect(client._sock.flush).to.not.have.been.called;
            });
        });

        describe('WebSocket event handlers', function () {
            var client;
            beforeEach(function () {
                client = make_rfb();
                this.clock = sinon.useFakeTimers();
            });

            afterEach(function () { this.clock.restore(); });

            // message events
            it ('should do nothing if we receive an empty message and have nothing in the queue', function () {
                client.connect('host', 8675);
                client._rfb_connection_state = 'connected';
                client._normal_msg = sinon.spy();
                client._sock._websocket._receive_data(new Uint8Array([]));
                expect(client._normal_msg).to.not.have.been.called;
            });

            it('should handle a message in the connected state as a normal message', function () {
                client.connect('host', 8675);
                client._rfb_connection_state = 'connected';
                client._normal_msg = sinon.spy();
                client._sock._websocket._receive_data(new Uint8Array([1, 2, 3]));
                expect(client._normal_msg).to.have.been.calledOnce;
            });

            it('should handle a message in any non-disconnected/failed state like an init message', function () {
                client.connect('host', 8675);
                client._rfb_init_state = 'ProtocolVersion';
                client._init_msg = sinon.spy();
                client._sock._websocket._receive_data(new Uint8Array([1, 2, 3]));
                expect(client._init_msg).to.have.been.calledOnce;
            });

            it('should process all normal messages directly', function () {
                client.connect('host', 8675);
                client._sock._websocket._open();
                client._rfb_connection_state = 'connected';
                client.set_onBell(sinon.spy());
                client._sock._websocket._receive_data(new Uint8Array([0x02, 0x02]));
                expect(client.get_onBell()).to.have.been.calledTwice;
            });

            // open events
            it('should update the state to ProtocolVersion on open (if the state is "connecting")', function () {
                client.connect('host', 8675);
                client._sock._websocket._open();
                expect(client._rfb_init_state).to.equal('ProtocolVersion');
            });

            it('should fail if we are not currently ready to connect and we get an "open" event', function () {
                sinon.spy(client, "_fail");
                client.connect('host', 8675);
                client._rfb_connection_state = 'some_other_state';
                client._sock._websocket._open();
                expect(client._fail).to.have.been.calledOnce;
            });

            // close events
            it('should transition to "disconnected" from "disconnecting" on a close event', function () {
                client.connect('host', 8675);
                client._rfb_connection_state = 'disconnecting';
                client._sock._websocket.close();
                expect(client._rfb_connection_state).to.equal('disconnected');
            });

            it('should transition to failed if we get a close event from any non-"disconnection" state', function () {
                sinon.spy(client, "_fail");
                client.connect('host', 8675);
                client._rfb_connection_state = 'connected';
                client._sock._websocket.close();
                expect(client._fail).to.have.been.calledOnce;
            });

            it('should unregister close event handler', function () {
                sinon.spy(client._sock, 'off');
                client.connect('host', 8675);
                client._rfb_connection_state = 'disconnecting';
                client._sock._websocket.close();
                expect(client._sock.off).to.have.been.calledWith('close');
            });

            // error events do nothing
        });
    });
});
