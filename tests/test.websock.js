// requires local modules: websock, base64, util
// requires test modules: fake.websocket
/* jshint expr: true */
var assert = chai.assert;
var expect = chai.expect;

describe('Websock', function() {
    "use strict";

    describe('Queue methods', function () {
        var sock;
        var RQ_TEMPLATE = [0, 1, 2, 3, 4, 5, 6, 7];

        beforeEach(function () {
            sock = new Websock();
            for (var i = RQ_TEMPLATE.length - 1; i >= 0; i--) {
               sock.rQunshift8(RQ_TEMPLATE[i]);
            }
        });
        describe('rQlen', function () {
            it('should return the length of the receive queue', function () {
               sock.set_rQi(0);

               expect(sock.rQlen()).to.equal(RQ_TEMPLATE.length);
            });

            it("should return the proper length if we read some from the receive queue", function () {
                sock.set_rQi(1);

                expect(sock.rQlen()).to.equal(RQ_TEMPLATE.length - 1);
            });
        });

        describe('rQpeek8', function () {
            it('should peek at the next byte without poping it off the queue', function () {
                var bef_len = sock.rQlen();
                var peek = sock.rQpeek8();
                expect(sock.rQpeek8()).to.equal(peek);
                expect(sock.rQlen()).to.equal(bef_len);
            });
        });

        describe('rQshift8', function () {
            it('should pop a single byte from the receive queue', function () {
                var peek = sock.rQpeek8();
                var bef_len = sock.rQlen();
                expect(sock.rQshift8()).to.equal(peek);
                expect(sock.rQlen()).to.equal(bef_len - 1);
            });
        });

        describe('rQunshift8', function () {
            it('should place a byte at the front of the queue', function () {
                sock.rQunshift8(255);
                expect(sock.rQpeek8()).to.equal(255);
                expect(sock.rQlen()).to.equal(RQ_TEMPLATE.length + 1);
            });
        });

        describe('rQshift16', function () {
            it('should pop two bytes from the receive queue and return a single number', function () {
                var bef_len = sock.rQlen();
                var expected = (RQ_TEMPLATE[0] << 8) + RQ_TEMPLATE[1];
                expect(sock.rQshift16()).to.equal(expected);
                expect(sock.rQlen()).to.equal(bef_len - 2);
            });
        });

        describe('rQshift32', function () {
            it('should pop four bytes from the receive queue and return a single number', function () {
                var bef_len = sock.rQlen();
                var expected = (RQ_TEMPLATE[0] << 24) +
                               (RQ_TEMPLATE[1] << 16) +
                               (RQ_TEMPLATE[2] << 8) +
                               RQ_TEMPLATE[3];
                expect(sock.rQshift32()).to.equal(expected);
                expect(sock.rQlen()).to.equal(bef_len - 4);
            });
        });

        describe('rQshiftStr', function () {
            it('should shift the given number of bytes off of the receive queue and return a string', function () {
                var bef_len = sock.rQlen();
                var bef_rQi = sock.get_rQi();
                var shifted = sock.rQshiftStr(3);
                expect(shifted).to.be.a('string');
                expect(shifted).to.equal(String.fromCharCode.apply(null, RQ_TEMPLATE.slice(bef_rQi, bef_rQi + 3)));
                expect(sock.rQlen()).to.equal(bef_len - 3);
            });

            it('should shift the entire rest of the queue off if no length is given', function () {
                sock.rQshiftStr();
                expect(sock.rQlen()).to.equal(0);
            });
        });

        describe('rQshiftBytes', function () {
            it('should shift the given number of bytes of the receive queue and return an array', function () {
                var bef_len = sock.rQlen();
                var bef_rQi = sock.get_rQi();
                var shifted = sock.rQshiftBytes(3);
                expect(shifted).to.be.an.instanceof(Array);
                expect(shifted).to.deep.equal(RQ_TEMPLATE.slice(bef_rQi, bef_rQi + 3));
                expect(sock.rQlen()).to.equal(bef_len - 3);
            });

            it('should shift the entire rest of the queue off if no length is given', function () {
                sock.rQshiftBytes();
                expect(sock.rQlen()).to.equal(0);
            });
        });

        describe('rQslice', function () {
            beforeEach(function () {
                sock.set_rQi(0);
            });

            it('should not modify the receive queue', function () {
                var bef_len = sock.rQlen();
                sock.rQslice(0, 2);
                expect(sock.rQlen()).to.equal(bef_len);
            });

            it('should return an array containing the given slice of the receive queue', function () {
                var sl = sock.rQslice(0, 2);
                expect(sl).to.be.an.instanceof(Array);
                expect(sl).to.deep.equal(RQ_TEMPLATE.slice(0, 2));
            });

            it('should use the rest of the receive queue if no end is given', function () {
                var sl = sock.rQslice(1);
                expect(sl).to.have.length(RQ_TEMPLATE.length - 1);
                expect(sl).to.deep.equal(RQ_TEMPLATE.slice(1));
            });

            it('should take the current rQi in to account', function () {
                sock.set_rQi(1);
                expect(sock.rQslice(0, 2)).to.deep.equal(RQ_TEMPLATE.slice(1, 3));
            });
        });

        describe('rQwait', function () {
            beforeEach(function () {
                sock.set_rQi(0);
            });

            it('should return true if there are not enough bytes in the receive queue', function () {
                expect(sock.rQwait('hi', RQ_TEMPLATE.length + 1)).to.be.true;
            });

            it('should return false if there are enough bytes in the receive queue', function () {
                expect(sock.rQwait('hi', RQ_TEMPLATE.length)).to.be.false;
            });

            it('should return true and reduce rQi by "goback" if there are not enough bytes', function () {
                sock.set_rQi(5);
                expect(sock.rQwait('hi', RQ_TEMPLATE.length, 4)).to.be.true;
                expect(sock.get_rQi()).to.equal(1);
            });

            it('should raise an error if we try to go back more than possible', function () {
                sock.set_rQi(5);
                expect(function () { sock.rQwait('hi', RQ_TEMPLATE.length, 6); }).to.throw(Error);
            });

            it('should not reduce rQi if there are enough bytes', function () {
                sock.set_rQi(5);
                sock.rQwait('hi', 1, 6);
                expect(sock.get_rQi()).to.equal(5);
            });
        });

        describe('flush', function () {
            beforeEach(function () {
                sock._websocket = {
                    send: sinon.spy()
                };
            });

            it('should actually send on the websocket if the websocket does not have too much buffered', function () {
                sock.maxBufferedAmount = 10;
                sock._websocket.bufferedAmount = 8;
                sock._sQ = [1, 2, 3];
                var encoded = sock._encode_message();

                sock.flush();
                expect(sock._websocket.send).to.have.been.calledOnce;
                expect(sock._websocket.send).to.have.been.calledWith(encoded);
            });

            it('should return true if the websocket did not have too much buffered', function () {
                sock.maxBufferedAmount = 10;
                sock._websocket.bufferedAmount = 8;

                expect(sock.flush()).to.be.true;
            });

            it('should not call send if we do not have anything queued up', function () {
                sock._sQ = [];
                sock.maxBufferedAmount = 10;
                sock._websocket.bufferedAmount = 8;

                sock.flush();

                expect(sock._websocket.send).not.to.have.been.called;
            });

            it('should not send and return false if the websocket has too much buffered', function () {
                sock.maxBufferedAmount = 10;
                sock._websocket.bufferedAmount = 12;

                expect(sock.flush()).to.be.false;
                expect(sock._websocket.send).to.not.have.been.called;
            });
        });

        describe('send', function () {
            beforeEach(function () {
                sock.flush = sinon.spy();
            });

            it('should add to the send queue', function () {
                sock.send([1, 2, 3]);
                var sq = sock.get_sQ();
                expect(sock.get_sQ().slice(sq.length - 3)).to.deep.equal([1, 2, 3]);
            });

            it('should call flush', function () {
                sock.send([1, 2, 3]);
                expect(sock.flush).to.have.been.calledOnce;
            });
        });

        describe('send_string', function () {
            beforeEach(function () {
                sock.send = sinon.spy();
            });

            it('should call send after converting the string to an array', function () {
                sock.send_string("\x01\x02\x03");
                expect(sock.send).to.have.been.calledWith([1, 2, 3]);
            });
        });
    });

    describe('lifecycle methods', function () {
        var old_WS;
        before(function () {
           old_WS = WebSocket;
        });

        var sock;
        beforeEach(function () {
           sock = new Websock();
           WebSocket = sinon.spy();
           WebSocket.OPEN = old_WS.OPEN;
           WebSocket.CONNECTING = old_WS.CONNECTING;
           WebSocket.CLOSING = old_WS.CLOSING;
           WebSocket.CLOSED = old_WS.CLOSED;
        });

        describe('opening', function () {
            it('should pick the correct protocols if none are given' , function () {

            });

            it('should open the actual websocket', function () {
                sock.open('ws://localhost:8675', 'base64');
                expect(WebSocket).to.have.been.calledWith('ws://localhost:8675', 'base64');
            });

            it('should fail if we try to use binary but do not support it', function () {
                expect(function () { sock.open('ws:///', 'binary'); }).to.throw(Error);
            });

            it('should fail if we specified an array with only binary and we do not support it', function () {
                expect(function () { sock.open('ws:///', ['binary']); }).to.throw(Error);
            });

            it('should skip binary if we have multiple options for encoding and do not support binary', function () {
                sock.open('ws:///', ['binary', 'base64']);
                expect(WebSocket).to.have.been.calledWith('ws:///', ['base64']);
            });
            // it('should initialize the event handlers')?
        });

        describe('closing', function () {
            beforeEach(function () {
                sock.open('ws://');
                sock._websocket.close = sinon.spy();
            });

            it('should close the actual websocket if it is open', function () {
                sock._websocket.readyState = WebSocket.OPEN;
                sock.close();
                expect(sock._websocket.close).to.have.been.calledOnce;
            });

            it('should close the actual websocket if it is connecting', function () {
                sock._websocket.readyState = WebSocket.CONNECTING;
                sock.close();
                expect(sock._websocket.close).to.have.been.calledOnce;
            });

            it('should not try to close the actual websocket if closing', function () {
                sock._websocket.readyState = WebSocket.CLOSING;
                sock.close();
                expect(sock._websocket.close).not.to.have.been.called;
            });

            it('should not try to close the actual websocket if closed', function () {
                sock._websocket.readyState = WebSocket.CLOSED;
                sock.close();
                expect(sock._websocket.close).not.to.have.been.called;
            });

            it('should reset onmessage to not call _recv_message', function () {
                sinon.spy(sock, '_recv_message');
                sock.close();
                sock._websocket.onmessage(null);
                try {
                    expect(sock._recv_message).not.to.have.been.called;
                } finally {
                    sock._recv_message.restore();
                }
            });
        });

        describe('event handlers', function () {
            beforeEach(function () {
                sock._recv_message = sinon.spy();
                sock.on('open', sinon.spy());
                sock.on('close', sinon.spy());
                sock.on('error', sinon.spy());
                sock.open('ws://');
            });

            it('should call _recv_message on a message', function () {
                sock._websocket.onmessage(null);
                expect(sock._recv_message).to.have.been.calledOnce;
            });

            it('should copy the mode over upon opening', function () {
                sock._websocket.protocol = 'cheese';
                sock._websocket.onopen();
                expect(sock._mode).to.equal('cheese');
            });

            it('should assume base64 if no protocol was available on opening', function () {
                sock._websocket.protocol = null;
                sock._websocket.onopen();
                expect(sock._mode).to.equal('base64');
            });

            it('should call the open event handler on opening', function () {
                sock._websocket.onopen();
                expect(sock._eventHandlers.open).to.have.been.calledOnce;
            });

            it('should call the close event handler on closing', function () {
                sock._websocket.onclose();
                expect(sock._eventHandlers.close).to.have.been.calledOnce;
            });

            it('should call the error event handler on error', function () {
                sock._websocket.onerror();
                expect(sock._eventHandlers.error).to.have.been.calledOnce;
            });
        });

        after(function () {
            WebSocket = old_WS;
        });
    });

    describe('WebSocket Receiving', function () {
        var sock;
        beforeEach(function () {
           sock = new Websock();
        });

        it('should support decoding base64 string data to add it to the receive queue', function () {
            var msg = { data: Base64.encode([1, 2, 3]) };
            sock._mode = 'base64';
            sock._recv_message(msg);
            expect(sock.rQshiftStr(3)).to.equal('\x01\x02\x03');
        });

        it('should support adding binary Uint8Array data to the receive queue', function () {
            var msg = { data: new Uint8Array([1, 2, 3]) };
            sock._mode = 'binary';
            sock._recv_message(msg);
            expect(sock.rQshiftStr(3)).to.equal('\x01\x02\x03');
        });

        it('should call the message event handler if present', function () {
            sock._eventHandlers.message = sinon.spy();
            var msg = { data: Base64.encode([1, 2, 3]) };
            sock._mode = 'base64';
            sock._recv_message(msg);
            expect(sock._eventHandlers.message).to.have.been.calledOnce;
        });

        it('should not call the message event handler if there is nothing in the receive queue', function () {
            sock._eventHandlers.message = sinon.spy();
            var msg = { data: Base64.encode([]) };
            sock._mode = 'base64';
            sock._recv_message(msg);
            expect(sock._eventHandlers.message).not.to.have.been.called;
        });

        it('should compact the receive queue', function () {
            // NB(sross): while this is an internal implementation detail, it's important to
            //            test, otherwise the receive queue could become very large very quickly
            sock._rQ = [0, 1, 2, 3, 4, 5];
            sock.set_rQi(6);
            sock._rQmax = 3;
            var msg = { data: Base64.encode([1, 2, 3]) };
            sock._mode = 'base64';
            sock._recv_message(msg);
            expect(sock._rQ.length).to.equal(3);
            expect(sock.get_rQi()).to.equal(0);
        });

        it('should call the error event handler on an exception', function () {
            sock._eventHandlers.error = sinon.spy();
            sock._eventHandlers.message = sinon.stub().throws();
            var msg = { data: Base64.encode([1, 2, 3]) };
            sock._mode = 'base64';
            sock._recv_message(msg);
            expect(sock._eventHandlers.error).to.have.been.calledOnce;
        });
    });

    describe('Data encoding', function () {
        before(function () { FakeWebSocket.replace(); });
        after(function () { FakeWebSocket.restore(); });

        describe('as binary data', function () {
            var sock;
            beforeEach(function () {
                sock = new Websock();
                sock.open('ws://', 'binary');
                sock._websocket._open();
            });

            it('should convert the send queue into an ArrayBuffer', function () {
                sock._sQ = [1, 2, 3];
                var res = sock._encode_message();  // An ArrayBuffer
                expect(new Uint8Array(res)).to.deep.equal(new Uint8Array(res));
            });

            it('should properly pass the encoded data off to the actual WebSocket', function () {
                sock.send([1, 2, 3]);
                expect(sock._websocket._get_sent_data()).to.deep.equal([1, 2, 3]);
            });
        });

        describe('as Base64 data', function () {
            var sock;
            beforeEach(function () {
                sock = new Websock();
                sock.open('ws://', 'base64');
                sock._websocket._open();
            });

            it('should convert the send queue into a Base64-encoded string', function () {
                sock._sQ = [1, 2, 3];
                expect(sock._encode_message()).to.equal(Base64.encode([1, 2, 3]));
            });

            it('should properly pass the encoded data off to the actual WebSocket', function () {
                sock.send([1, 2, 3]);
                expect(sock._websocket._get_sent_data()).to.deep.equal([1, 2, 3]);
            });

        });

    });
});
