const expect = chai.expect;

import Websock from '../core/websock.js';
import Display from '../core/display.js';

import RawDecoder from '../core/decoders/raw.js';

import FakeWebSocket from './fake.websocket.js';

function testDecodeRect(decoder, x, y, width, height, data, display, depth) {
    let sock;
    let done = false;

    sock = new Websock;
    sock.open("ws://example.com");

    sock.on('message', () => {
        done = decoder.decodeRect(x, y, width, height, sock, display, depth);
    });

    // Empty messages are filtered at multiple layers, so we need to
    // do a direct call
    if (data.length === 0) {
        done = decoder.decodeRect(x, y, width, height, sock, display, depth);
    } else {
        sock._websocket._receiveData(new Uint8Array(data));
    }

    display.flip();

    return done;
}

describe('Raw Decoder', function () {
    let decoder;
    let display;

    before(FakeWebSocket.replace);
    after(FakeWebSocket.restore);

    beforeEach(function () {
        decoder = new RawDecoder();
        display = new Display(document.createElement('canvas'));
        display.resize(4, 4);
    });

    it('should handle the Raw encoding', function () {
        let done;

        done = testDecodeRect(decoder, 0, 0, 2, 2,
                              [0xff, 0x00, 0x00, 0,
                               0x00, 0xff, 0x00, 0,
                               0x00, 0xff, 0x00, 0,
                               0xff, 0x00, 0x00, 0],
                              display, 24);
        expect(done).to.be.true;
        done = testDecodeRect(decoder, 2, 0, 2, 2,
                              [0x00, 0x00, 0xff, 0,
                               0x00, 0x00, 0xff, 0,
                               0x00, 0x00, 0xff, 0,
                               0x00, 0x00, 0xff, 0],
                              display, 24);
        expect(done).to.be.true;
        done = testDecodeRect(decoder, 0, 2, 4, 1,
                              [0xee, 0x00, 0xff, 0,
                               0x00, 0xee, 0xff, 0,
                               0xaa, 0xee, 0xff, 0,
                               0xab, 0xee, 0xff, 0],
                              display, 24);
        expect(done).to.be.true;
        done = testDecodeRect(decoder, 0, 3, 4, 1,
                              [0xee, 0x00, 0xff, 0,
                               0x00, 0xee, 0xff, 0,
                               0xaa, 0xee, 0xff, 0,
                               0xab, 0xee, 0xff, 0],
                              display, 24);
        expect(done).to.be.true;

        let targetData = new Uint8Array([
            0xff, 0x00, 0x00, 255, 0x00, 0xff, 0x00, 255, 0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255,
            0x00, 0xff, 0x00, 255, 0xff, 0x00, 0x00, 255, 0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255,
            0xee, 0x00, 0xff, 255, 0x00, 0xee, 0xff, 255, 0xaa, 0xee, 0xff, 255, 0xab, 0xee, 0xff, 255,
            0xee, 0x00, 0xff, 255, 0x00, 0xee, 0xff, 255, 0xaa, 0xee, 0xff, 255, 0xab, 0xee, 0xff, 255
        ]);

        expect(display).to.have.displayed(targetData);
    });

    it('should handle the Raw encoding in low colour mode', function () {
        let done;

        done = testDecodeRect(decoder, 0, 0, 2, 2,
                              [0x30, 0x30, 0x30, 0x30],
                              display, 8);
        expect(done).to.be.true;
        done = testDecodeRect(decoder, 2, 0, 2, 2,
                              [0x0c, 0x0c, 0x0c, 0x0c],
                              display, 8);
        expect(done).to.be.true;
        done = testDecodeRect(decoder, 0, 2, 4, 1,
                              [0x0c, 0x0c, 0x30, 0x30],
                              display, 8);
        expect(done).to.be.true;
        done = testDecodeRect(decoder, 0, 3, 4, 1,
                              [0x0c, 0x0c, 0x30, 0x30],
                              display, 8);
        expect(done).to.be.true;

        let targetData = new Uint8Array([
            0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255, 0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255,
            0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255, 0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255,
            0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255, 0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255,
            0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255, 0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255
        ]);

        expect(display).to.have.displayed(targetData);
    });

    it('should handle empty rects', function () {
        display.fillRect(0, 0, 4, 4, [ 0x00, 0x00, 0xff ]);
        display.fillRect(2, 0, 2, 2, [ 0x00, 0xff, 0x00 ]);
        display.fillRect(0, 2, 2, 2, [ 0x00, 0xff, 0x00 ]);

        let done = testDecodeRect(decoder, 1, 2, 0, 0, [], display, 24);

        let targetData = new Uint8Array([
            0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255, 0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255,
            0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255, 0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255,
            0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255, 0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255,
            0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255, 0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255
        ]);

        expect(done).to.be.true;
        expect(display).to.have.displayed(targetData);
    });

    it('should handle empty rects in low colour mode', function () {
        display.fillRect(0, 0, 4, 4, [ 0x00, 0x00, 0xff ]);
        display.fillRect(2, 0, 2, 2, [ 0x00, 0xff, 0x00 ]);
        display.fillRect(0, 2, 2, 2, [ 0x00, 0xff, 0x00 ]);

        let done = testDecodeRect(decoder, 1, 2, 0, 0, [], display, 8);

        let targetData = new Uint8Array([
            0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255, 0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255,
            0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255, 0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255,
            0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255, 0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255,
            0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255, 0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255
        ]);

        expect(done).to.be.true;
        expect(display).to.have.displayed(targetData);
    });
});
