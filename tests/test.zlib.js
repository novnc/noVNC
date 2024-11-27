import Websock from '../core/websock.js';
import Display from '../core/display.js';

import ZlibDecoder from '../core/decoders/zlib.js';

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

describe('Zlib decoder', function () {
    let decoder;
    let display;

    before(FakeWebSocket.replace);
    after(FakeWebSocket.restore);

    beforeEach(function () {
        decoder = new ZlibDecoder();
        display = new Display(document.createElement('canvas'));
        display.resize(4, 4);
    });

    it('should handle the Zlib encoding', function () {
        let done;

        let zlibData = new Uint8Array([
            0x00, 0x00, 0x00, 0x23, /* length */
            0x78, 0x01, 0xfa, 0xcf, 0x00, 0x04, 0xff, 0x61, 0x04, 0x90, 0x01, 0x41, 0x50, 0xc1, 0xff, 0x0c,
            0xef, 0x40, 0x02, 0xef, 0xfe, 0x33, 0xac, 0x02, 0xe2, 0xd5, 0x40, 0x8c, 0xce, 0x07, 0x00, 0x00,
            0x00, 0xff, 0xff,
        ]);
        done = testDecodeRect(decoder, 0, 0, 4, 4, zlibData, display, 24);
        expect(done).to.be.true;

        let targetData = new Uint8ClampedArray([
            0xff, 0x00, 0x00, 255, 0x00, 0xff, 0x00, 255, 0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255,
            0x00, 0xff, 0x00, 255, 0xff, 0x00, 0x00, 255, 0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255,
            0xee, 0x00, 0xff, 255, 0x00, 0xee, 0xff, 255, 0xaa, 0xee, 0xff, 255, 0xab, 0xee, 0xff, 255,
            0xee, 0x00, 0xff, 255, 0x00, 0xee, 0xff, 255, 0xaa, 0xee, 0xff, 255, 0xab, 0xee, 0xff, 255
        ]);

        expect(display).to.have.displayed(targetData);
    });

    it('should handle empty rects', function () {
        display.fillRect(0, 0, 4, 4, [0x00, 0x00, 0xff]);
        display.fillRect(2, 0, 2, 2, [0x00, 0xff, 0x00]);
        display.fillRect(0, 2, 2, 2, [0x00, 0xff, 0x00]);

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
});
