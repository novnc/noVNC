const expect = chai.expect;

import Websock from '../core/websock.js';
import FakeWebSocket from './fake.websocket.js';

describe('Websock', function () {
    "use strict";

    describe('Receive queue methods', function () {
        let sock;
        const RQ_TEMPLATE = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);

        beforeEach(function () {
            sock = new Websock();
            // skip init
            sock._allocateBuffers();
            sock._rQ.set(RQ_TEMPLATE);
            sock._rQlen = RQ_TEMPLATE.length;
        });

        describe('rQpeek8', function () {
            it('should peek at the next byte without poping it off the queue', function () {
                const befLen = sock._rQlen - sock._rQi;
                const peek = sock.rQpeek8();
                expect(sock.rQpeek8()).to.equal(peek);
                expect(sock._rQlen - sock._rQi).to.equal(befLen);
            });
        });

        describe('rQshift8()', function () {
            it('should pop a single byte from the receive queue', function () {
                const peek = sock.rQpeek8();
                const befLen = sock._rQlen - sock._rQi;
                expect(sock.rQshift8()).to.equal(peek);
                expect(sock._rQlen - sock._rQi).to.equal(befLen - 1);
            });
        });

        describe('rQshift16()', function () {
            it('should pop two bytes from the receive queue and return a single number', function () {
                const befLen = sock._rQlen - sock._rQi;
                const expected = (RQ_TEMPLATE[0] << 8) + RQ_TEMPLATE[1];
                expect(sock.rQshift16()).to.equal(expected);
                expect(sock._rQlen - sock._rQi).to.equal(befLen - 2);
            });
        });

        describe('rQshift32()', function () {
            it('should pop four bytes from the receive queue and return a single number', function () {
                const befLen = sock._rQlen - sock._rQi;
                const expected = (RQ_TEMPLATE[0] << 24) +
                               (RQ_TEMPLATE[1] << 16) +
                               (RQ_TEMPLATE[2] << 8) +
                               RQ_TEMPLATE[3];
                expect(sock.rQshift32()).to.equal(expected);
                expect(sock._rQlen - sock._rQi).to.equal(befLen - 4);
            });
        });

        describe('rQshiftStr', function () {
            it('should shift the given number of bytes off of the receive queue and return a string', function () {
                const befLen = sock._rQlen;
                const befRQi = sock._rQi;
                const shifted = sock.rQshiftStr(3);
                expect(shifted).to.be.a('string');
                expect(shifted).to.equal(String.fromCharCode.apply(null, Array.prototype.slice.call(new Uint8Array(RQ_TEMPLATE.buffer, befRQi, 3))));
                expect(sock._rQlen - sock._rQi).to.equal(befLen - 3);
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

                const shifted = sock.rQshiftStr(BIG_LEN);

                expect(shifted).to.be.equal(expected);
                expect(sock._rQlen - sock._rQi).to.equal(0);
            });
        });

        describe('rQshiftBytes', function () {
            it('should shift the given number of bytes of the receive queue and return an array', function () {
                const befLen = sock._rQlen;
                const befRQi = sock._rQi;
                const shifted = sock.rQshiftBytes(3);
                expect(shifted).to.be.an.instanceof(Uint8Array);
                expect(shifted).to.array.equal(new Uint8Array(RQ_TEMPLATE.buffer, befRQi, 3));
                expect(sock._rQlen - sock._rQi).to.equal(befLen - 3);
            });
            it('should return a shared array if requested', function () {
                const befRQi = sock._rQi;
                const shifted = sock.rQshiftBytes(3, false);
                expect(shifted).to.array.equal(new Uint8Array(RQ_TEMPLATE.buffer, befRQi, 3));
                expect(shifted.buffer.byteLength).to.not.equal(shifted.length);
            });
        });

        describe('rQpeekBytes', function () {
            beforeEach(function () {
                sock._rQi = 0;
            });

            it('should not modify the receive queue', function () {
                const befLen = sock._rQlen - sock._rQi;
                sock.rQpeekBytes(2);
                expect(sock._rQlen - sock._rQi).to.equal(befLen);
            });

            it('should return an array containing the requested bytes of the receive queue', function () {
                const sl = sock.rQpeekBytes(2);
                expect(sl).to.be.an.instanceof(Uint8Array);
                expect(sl).to.array.equal(new Uint8Array(RQ_TEMPLATE.buffer, 0, 2));
            });

            it('should take the current rQi in to account', function () {
                sock._rQi = 1;
                expect(sock.rQpeekBytes(2)).to.array.equal(new Uint8Array(RQ_TEMPLATE.buffer, 1, 2));
            });

            it('should return a shared array if requested', function () {
                const sl = sock.rQpeekBytes(2, false);
                expect(sl).to.array.equal(new Uint8Array(RQ_TEMPLATE.buffer, 0, 2));
                expect(sl.buffer.byteLength).to.not.equal(sl.length);
            });
        });

        describe('rQwait', function () {
            beforeEach(function () {
                sock._rQi = 0;
            });

            it('should return true if there are not enough bytes in the receive queue', function () {
                expect(sock.rQwait('hi', RQ_TEMPLATE.length + 1)).to.be.true;
            });

            it('should return false if there are enough bytes in the receive queue', function () {
                expect(sock.rQwait('hi', RQ_TEMPLATE.length)).to.be.false;
            });

            it('should return true and reduce rQi by "goback" if there are not enough bytes', function () {
                sock._rQi = 5;
                expect(sock.rQwait('hi', RQ_TEMPLATE.length, 4)).to.be.true;
                expect(sock._rQi).to.equal(1);
            });

            it('should raise an error if we try to go back more than possible', function () {
                sock._rQi = 5;
                expect(() => sock.rQwait('hi', RQ_TEMPLATE.length, 6)).to.throw(Error);
            });

            it('should not reduce rQi if there are enough bytes', function () {
                sock._rQi = 5;
                sock.rQwait('hi', 1, 6);
                expect(sock._rQi).to.equal(5);
            });
        });
    });

    describe('Send queue methods', function () {
        let sock;

        beforeEach(function () {
            let websock = new FakeWebSocket();
            websock._open();
            sock = new Websock();
            sock.attach(websock);
        });

        describe('flush', function () {
            it('should actually send on the websocket', function () {
                sock._sQ = new Uint8Array([1, 2, 3]);
                sock._sQlen = 3;
                const encoded = sock._encodeMessage();

                sock.flush();
                expect(sock).to.have.sent(encoded);
            });

            it('should not call send if we do not have anything queued up', function () {
                sock._sQlen = 0;

                sock.flush();

                expect(sock).to.have.sent(new Uint8Array([]));
            });
        });

        describe('send', function () {
            it('should send the given data immediately', function () {
                sock.send([1, 2, 3]);
                expect(sock).to.have.sent(new Uint8Array([1, 2, 3]));
            });
        });

        describe('sendString', function () {
            it('should send after converting the string to an array', function () {
                sock.sendString("\x01\x02\x03");
                expect(sock).to.have.sent(new Uint8Array([1, 2, 3]));
            });
        });
    });

    describe('lifecycle methods', function () {
        let oldWS;
        before(function () {
            oldWS = WebSocket;
        });

        let sock;
        beforeEach(function () {
            sock = new Websock();
            // eslint-disable-next-line no-global-assign
            WebSocket = sinon.spy(FakeWebSocket);
        });

        describe('opening', function () {
            it('should pick the correct protocols if none are given', function () {

            });

            it('should open the actual websocket', function () {
                sock.open('ws://localhost:8675', 'binary');
                expect(WebSocket).to.have.been.calledWith('ws://localhost:8675', 'binary');
            });

            // it('should initialize the event handlers')?
        });

        describe('attaching', function () {
            it('should attach to an existing websocket', function () {
                let ws = new FakeWebSocket('ws://localhost:8675');
                sock.attach(ws);
                expect(WebSocket).to.not.have.been.called;
            });
        });

        describe('closing', function () {
            beforeEach(function () {
                sock.open('ws://localhost');
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

            it('should reset onmessage to not call _recvMessage', function () {
                sinon.spy(sock, '_recvMessage');
                sock.close();
                sock._websocket.onmessage(null);
                try {
                    expect(sock._recvMessage).not.to.have.been.called;
                } finally {
                    sock._recvMessage.restore();
                }
            });
        });

        describe('event handlers', function () {
            beforeEach(function () {
                sock._recvMessage = sinon.spy();
                sock.on('open', sinon.spy());
                sock.on('close', sinon.spy());
                sock.on('error', sinon.spy());
                sock.open('ws://localhost');
            });

            it('should call _recvMessage on a message', function () {
                sock._websocket.onmessage(null);
                expect(sock._recvMessage).to.have.been.calledOnce;
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

        describe('ready state', function () {
            it('should be "unused" after construction', function () {
                let sock = new Websock();
                expect(sock.readyState).to.equal('unused');
            });

            it('should be "connecting" if WebSocket is connecting', function () {
                let sock = new Websock();
                let ws = new FakeWebSocket();
                ws.readyState = WebSocket.CONNECTING;
                sock.attach(ws);
                expect(sock.readyState).to.equal('connecting');
            });

            it('should be "open" if WebSocket is open', function () {
                let sock = new Websock();
                let ws = new FakeWebSocket();
                ws.readyState = WebSocket.OPEN;
                sock.attach(ws);
                expect(sock.readyState).to.equal('open');
            });

            it('should be "closing" if WebSocket is closing', function () {
                let sock = new Websock();
                let ws = new FakeWebSocket();
                ws.readyState = WebSocket.CLOSING;
                sock.attach(ws);
                expect(sock.readyState).to.equal('closing');
            });

            it('should be "closed" if WebSocket is closed', function () {
                let sock = new Websock();
                let ws = new FakeWebSocket();
                ws.readyState = WebSocket.CLOSED;
                sock.attach(ws);
                expect(sock.readyState).to.equal('closed');
            });

            it('should be "unknown" if WebSocket state is unknown', function () {
                let sock = new Websock();
                let ws = new FakeWebSocket();
                ws.readyState = 666;
                sock.attach(ws);
                expect(sock.readyState).to.equal('unknown');
            });

            it('should be "connecting" if RTCDataChannel is connecting', function () {
                let sock = new Websock();
                let ws = new FakeWebSocket();
                ws.readyState = 'connecting';
                sock.attach(ws);
                expect(sock.readyState).to.equal('connecting');
            });

            it('should be "open" if RTCDataChannel is open', function () {
                let sock = new Websock();
                let ws = new FakeWebSocket();
                ws.readyState = 'open';
                sock.attach(ws);
                expect(sock.readyState).to.equal('open');
            });

            it('should be "closing" if RTCDataChannel is closing', function () {
                let sock = new Websock();
                let ws = new FakeWebSocket();
                ws.readyState = 'closing';
                sock.attach(ws);
                expect(sock.readyState).to.equal('closing');
            });

            it('should be "closed" if RTCDataChannel is closed', function () {
                let sock = new Websock();
                let ws = new FakeWebSocket();
                ws.readyState = 'closed';
                sock.attach(ws);
                expect(sock.readyState).to.equal('closed');
            });

            it('should be "unknown" if RTCDataChannel state is unknown', function () {
                let sock = new Websock();
                let ws = new FakeWebSocket();
                ws.readyState = 'foobar';
                sock.attach(ws);
                expect(sock.readyState).to.equal('unknown');
            });
        });

        after(function () {
            // eslint-disable-next-line no-global-assign
            WebSocket = oldWS;
        });
    });

    describe('WebSocket Receiving', function () {
        let sock;
        beforeEach(function () {
            sock = new Websock();
            sock._allocateBuffers();
        });

        it('should support adding binary Uint8Array data to the receive queue', function () {
            const msg = { data: new Uint8Array([1, 2, 3]) };
            sock._mode = 'binary';
            sock._recvMessage(msg);
            expect(sock.rQshiftStr(3)).to.equal('\x01\x02\x03');
        });

        it('should call the message event handler if present', function () {
            sock._eventHandlers.message = sinon.spy();
            const msg = { data: new Uint8Array([1, 2, 3]).buffer };
            sock._mode = 'binary';
            sock._recvMessage(msg);
            expect(sock._eventHandlers.message).to.have.been.calledOnce;
        });

        it('should not call the message event handler if there is nothing in the receive queue', function () {
            sock._eventHandlers.message = sinon.spy();
            const msg = { data: new Uint8Array([]).buffer };
            sock._mode = 'binary';
            sock._recvMessage(msg);
            expect(sock._eventHandlers.message).not.to.have.been.called;
        });

        it('should compact the receive queue when a message handler empties it', function () {
            sock._eventHandlers.message = () => { sock._rQi = sock._rQlen; };
            sock._rQ = new Uint8Array([0, 1, 2, 3, 4, 5, 0, 0, 0, 0]);
            sock._rQlen = 6;
            sock._rQi = 6;
            const msg = { data: new Uint8Array([1, 2, 3]).buffer };
            sock._mode = 'binary';
            sock._recvMessage(msg);
            expect(sock._rQlen).to.equal(0);
            expect(sock._rQi).to.equal(0);
        });

        it('should compact the receive queue when we reach the end of the buffer', function () {
            sock._rQ = new Uint8Array(20);
            sock._rQbufferSize = 20;
            sock._rQlen = 20;
            sock._rQi = 10;
            const msg = { data: new Uint8Array([1, 2]).buffer };
            sock._mode = 'binary';
            sock._recvMessage(msg);
            expect(sock._rQlen).to.equal(12);
            expect(sock._rQi).to.equal(0);
        });

        it('should automatically resize the receive queue if the incoming message is larger than the buffer', function () {
            sock._rQ = new Uint8Array(20);
            sock._rQlen = 0;
            sock._rQi = 0;
            sock._rQbufferSize = 20;
            const msg = { data: new Uint8Array(30).buffer };
            sock._mode = 'binary';
            sock._recvMessage(msg);
            expect(sock._rQlen).to.equal(30);
            expect(sock._rQi).to.equal(0);
            expect(sock._rQ.length).to.equal(240);  // keep the invariant that rQbufferSize / 8 >= rQlen
        });

        it('should automatically resize the receive queue if the incoming message is larger than 1/8th of the buffer and we reach the end of the buffer', function () {
            sock._rQ = new Uint8Array(20);
            sock._rQlen = 16;
            sock._rQi = 16;
            sock._rQbufferSize = 20;
            const msg = { data: new Uint8Array(6).buffer };
            sock._mode = 'binary';
            sock._recvMessage(msg);
            expect(sock._rQlen).to.equal(6);
            expect(sock._rQi).to.equal(0);
            expect(sock._rQ.length).to.equal(48);
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
                const res = sock._encodeMessage();
                expect(res).to.array.equal(new Uint8Array([1, 2, 3]));
            });

            it('should properly pass the encoded data off to the actual WebSocket', function () {
                sock.send([1, 2, 3]);
                expect(sock._websocket._getSentData()).to.array.equal(new Uint8Array([1, 2, 3]));
            });
        });
    });
});
