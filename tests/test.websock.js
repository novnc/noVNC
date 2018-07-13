const expect = chai.expect;

import Websock from '../core/websock.js';
import FakeWebSocket from './fake.websocket.js';

describe('Websock', function() {
    "use strict";

    describe('Queue methods', function () {
        let sock;
        const RQ_TEMPLATE = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);

        beforeEach(function () {
            sock = new Websock();
            // skip init
            sock._allocate_buffers();
            sock._rQ.set(RQ_TEMPLATE);
            sock._rQlen = RQ_TEMPLATE.length;
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
                const bef_len = sock.rQlen();
                const peek = sock.rQpeek8();
                expect(sock.rQpeek8()).to.equal(peek);
                expect(sock.rQlen()).to.equal(bef_len);
            });
        });

        describe('rQshift8', function () {
            it('should pop a single byte from the receive queue', function () {
                const peek = sock.rQpeek8();
                const bef_len = sock.rQlen();
                expect(sock.rQshift8()).to.equal(peek);
                expect(sock.rQlen()).to.equal(bef_len - 1);
            });
        });

        describe('rQshift16', function () {
            it('should pop two bytes from the receive queue and return a single number', function () {
                const bef_len = sock.rQlen();
                const expected = (RQ_TEMPLATE[0] << 8) + RQ_TEMPLATE[1];
                expect(sock.rQshift16()).to.equal(expected);
                expect(sock.rQlen()).to.equal(bef_len - 2);
            });
        });

        describe('rQshift32', function () {
            it('should pop four bytes from the receive queue and return a single number', function () {
                const bef_len = sock.rQlen();
                const expected = (RQ_TEMPLATE[0] << 24) +
                               (RQ_TEMPLATE[1] << 16) +
                               (RQ_TEMPLATE[2] << 8) +
                               RQ_TEMPLATE[3];
                expect(sock.rQshift32()).to.equal(expected);
                expect(sock.rQlen()).to.equal(bef_len - 4);
            });
        });

        describe('rQshiftStr', function () {
            it('should shift the given number of bytes off of the receive queue and return a string', function () {
                const bef_len = sock.rQlen();
                const bef_rQi = sock.get_rQi();
                const shifted = sock.rQshiftStr(3);
                expect(shifted).to.be.a('string');
                expect(shifted).to.equal(String.fromCharCode.apply(null, Array.prototype.slice.call(new Uint8Array(RQ_TEMPLATE.buffer, bef_rQi, 3))));
                expect(sock.rQlen()).to.equal(bef_len - 3);
            });

            it('should shift the entire rest of the queue off if no length is given', function () {
                sock.rQshiftStr();
                expect(sock.rQlen()).to.equal(0);
            });

            it('should be able to handle very large strings', function () {
                const BIG_LEN = 500000;
                const RQ_BIG = new Uint8Array(BIG_LEN);
                let expected = "";
                let letterCode = 'a'.charCodeAt(0);
                for (let i = 0; i < BIG_LEN; i++) {
                    RQ_BIG[i] = letterCode;
                    expected += String.fromCharCode(letterCode);

                    if (letterCode < 'z'.charCodeAt(0)) {
                        letterCode++;
                    } else {
                        letterCode = 'a'.charCodeAt(0);
                    }
                }
                sock._rQ.set(RQ_BIG);
                sock._rQlen = RQ_BIG.length;

                const shifted = sock.rQshiftStr();

                expect(shifted).to.be.equal(expected);
                expect(sock.rQlen()).to.equal(0);
            });
        });

        describe('rQshiftBytes', function () {
            it('should shift the given number of bytes of the receive queue and return an array', function () {
                const bef_len = sock.rQlen();
                const bef_rQi = sock.get_rQi();
                const shifted = sock.rQshiftBytes(3);
                expect(shifted).to.be.an.instanceof(Uint8Array);
                expect(shifted).to.array.equal(new Uint8Array(RQ_TEMPLATE.buffer, bef_rQi, 3));
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
                const bef_len = sock.rQlen();
                sock.rQslice(0, 2);
                expect(sock.rQlen()).to.equal(bef_len);
            });

            it('should return an array containing the given slice of the receive queue', function () {
                const sl = sock.rQslice(0, 2);
                expect(sl).to.be.an.instanceof(Uint8Array);
                expect(sl).to.array.equal(new Uint8Array(RQ_TEMPLATE.buffer, 0, 2));
            });

            it('should use the rest of the receive queue if no end is given', function () {
                const sl = sock.rQslice(1);
                expect(sl).to.have.length(RQ_TEMPLATE.length - 1);
                expect(sl).to.array.equal(new Uint8Array(RQ_TEMPLATE.buffer, 1));
            });

            it('should take the current rQi in to account', function () {
                sock.set_rQi(1);
                expect(sock.rQslice(0, 2)).to.array.equal(new Uint8Array(RQ_TEMPLATE.buffer, 1, 2));
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
                expect(() => sock.rQwait('hi', RQ_TEMPLATE.length, 6)).to.throw(Error);
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

            it('should actually send on the websocket', function () {
                sock._websocket.bufferedAmount = 8;
                sock._websocket.readyState = WebSocket.OPEN
                sock._sQ = new Uint8Array([1, 2, 3]);
                sock._sQlen = 3;
                const encoded = sock._encode_message();

                sock.flush();
                expect(sock._websocket.send).to.have.been.calledOnce;
                expect(sock._websocket.send).to.have.been.calledWith(encoded);
            });

            it('should not call send if we do not have anything queued up', function () {
                sock._sQlen = 0;
                sock._websocket.bufferedAmount = 8;

                sock.flush();

                expect(sock._websocket.send).not.to.have.been.called;
            });
        });

        describe('send', function () {
            beforeEach(function () {
                sock.flush = sinon.spy();
            });

            it('should add to the send queue', function () {
                sock.send([1, 2, 3]);
                const sq = sock.get_sQ();
                expect(new Uint8Array(sq.buffer, sock._sQlen - 3, 3)).to.array.equal(new Uint8Array([1, 2, 3]));
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
        let old_WS;
        before(function () {
           old_WS = WebSocket;
        });

        let sock;
        beforeEach(function () {
            sock = new Websock();
            // eslint-disable-next-line no-global-assign
            WebSocket = sinon.spy();
            WebSocket.OPEN = old_WS.OPEN;
            WebSocket.CONNECTING = old_WS.CONNECTING;
            WebSocket.CLOSING = old_WS.CLOSING;
            WebSocket.CLOSED = old_WS.CLOSED;

            WebSocket.prototype.binaryType = 'arraybuffer';
        });

        describe('opening', function () {
            it('should pick the correct protocols if none are given' , function () {

            });

            it('should open the actual websocket', function () {
                sock.open('ws://localhost:8675', 'binary');
                expect(WebSocket).to.have.been.calledWith('ws://localhost:8675', 'binary');
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
            // eslint-disable-next-line no-global-assign
            WebSocket = old_WS;
        });
    });

    describe('WebSocket Receiving', function () {
        let sock;
        beforeEach(function () {
           sock = new Websock();
           sock._allocate_buffers();
        });

        it('should support adding binary Uint8Array data to the receive queue', function () {
            const msg = { data: new Uint8Array([1, 2, 3]) };
            sock._mode = 'binary';
            sock._recv_message(msg);
            expect(sock.rQshiftStr(3)).to.equal('\x01\x02\x03');
        });

        it('should call the message event handler if present', function () {
            sock._eventHandlers.message = sinon.spy();
            const msg = { data: new Uint8Array([1, 2, 3]).buffer };
            sock._mode = 'binary';
            sock._recv_message(msg);
            expect(sock._eventHandlers.message).to.have.been.calledOnce;
        });

        it('should not call the message event handler if there is nothing in the receive queue', function () {
            sock._eventHandlers.message = sinon.spy();
            const msg = { data: new Uint8Array([]).buffer };
            sock._mode = 'binary';
            sock._recv_message(msg);
            expect(sock._eventHandlers.message).not.to.have.been.called;
        });

        it('should compact the receive queue', function () {
            // NB(sross): while this is an internal implementation detail, it's important to
            //            test, otherwise the receive queue could become very large very quickly
            sock._rQ = new Uint8Array([0, 1, 2, 3, 4, 5, 0, 0, 0, 0]);
            sock._rQlen = 6;
            sock.set_rQi(6);
            sock._rQmax = 3;
            const msg = { data: new Uint8Array([1, 2, 3]).buffer };
            sock._mode = 'binary';
            sock._recv_message(msg);
            expect(sock._rQlen).to.equal(3);
            expect(sock.get_rQi()).to.equal(0);
        });

        it('should automatically resize the receive queue if the incoming message is too large', function () {
            sock._rQ = new Uint8Array(20);
            sock._rQlen = 0;
            sock.set_rQi(0);
            sock._rQbufferSize = 20;
            sock._rQmax = 2;
            const msg = { data: new Uint8Array(30).buffer };
            sock._mode = 'binary';
            sock._recv_message(msg);
            expect(sock._rQlen).to.equal(30);
            expect(sock.get_rQi()).to.equal(0);
            expect(sock._rQ.length).to.equal(240);  // keep the invariant that rQbufferSize / 8 >= rQlen
        });
    });

    describe('Data encoding', function () {
        before(function () { FakeWebSocket.replace(); });
        after(function () { FakeWebSocket.restore(); });

        describe('as binary data', function () {
            let sock;
            beforeEach(function () {
                sock = new Websock();
                sock.open('ws://', 'binary');
                sock._websocket._open();
            });

            it('should only send the send queue up to the send queue length', function () {
                sock._sQ = new Uint8Array([1, 2, 3, 4, 5]);
                sock._sQlen = 3;
                const res = sock._encode_message();
                expect(res).to.array.equal(new Uint8Array([1, 2, 3]));
            });

            it('should properly pass the encoded data off to the actual WebSocket', function () {
                sock.send([1, 2, 3]);
                expect(sock._websocket._get_sent_data()).to.array.equal(new Uint8Array([1, 2, 3]));
            });
        });
    });
});
