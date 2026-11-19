const expect = chai.expect;

import Websock from '../core/websock.js';
import Display from '../core/display.js';
import makeCanvas, { sizeDisplay } from './fake.canvas.js';

import RawDecoder from '../core/decoders/raw.js';

import FakeWebSocket from './fake.websocket.js';

// Display queues rects per frame. flush() forces the oldest queued frame onto the canvas
let nextFrameId = 1;

function testDecodeRect(decoder, x, y, width, height, data, display, depth) {
    let sock;
    const frameId = nextFrameId++;

    sock = new Websock;
    sock.open("ws://example.com");

    sock.on('message', () => {
        decoder.decodeRect(x, y, width, height, sock, display, depth, frameId);
    });

    // Empty messages are filtered at multiple layers, so we need to
    // do a direct call
    if (data.length === 0) {
        decoder.decodeRect(x, y, width, height, sock, display, depth, frameId);
    } else {
        sock._websocket._receiveData(new Uint8Array(data));
    }

    display.flush(false);
}

describe('Raw Decoder', function () {
    let decoder;
    let display;

    before(FakeWebSocket.replace);
    after(FakeWebSocket.restore);

    beforeEach(function () {
        decoder = new RawDecoder();
        display = new Display(makeCanvas());
        sizeDisplay(display, 4, 4);
    });

    it('should handle the Raw encoding', function () {
        testDecodeRect(decoder, 0, 0, 2, 2,
                       [0xff, 0x00, 0x00, 0, 0x00, 0xff, 0x00, 0,
                        0x00, 0xff, 0x00, 0, 0xff, 0x00, 0x00, 0],
                       display, 24);
        testDecodeRect(decoder, 2, 0, 2, 2,
                       [0x00, 0x00, 0xff, 0, 0x00, 0x00, 0xff, 0,
                        0x00, 0x00, 0xff, 0, 0x00, 0x00, 0xff, 0],
                       display, 24);
        testDecodeRect(decoder, 0, 2, 4, 1,
                       [0xee, 0x00, 0xff, 0, 0x00, 0xee, 0xff, 0,
                        0xaa, 0xee, 0xff, 0, 0xab, 0xee, 0xff, 0],
                       display, 24);
        testDecodeRect(decoder, 0, 3, 4, 1,
                       [0xee, 0x00, 0xff, 0, 0x00, 0xee, 0xff, 0,
                        0xaa, 0xee, 0xff, 0, 0xab, 0xee, 0xff, 0],
                       display, 24);

        let targetData = new Uint8Array([
            0xff, 0x00, 0x00, 255, 0x00, 0xff, 0x00, 255, 0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255,
            0x00, 0xff, 0x00, 255, 0xff, 0x00, 0x00, 255, 0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255,
            0xee, 0x00, 0xff, 255, 0x00, 0xee, 0xff, 255, 0xaa, 0xee, 0xff, 255, 0xab, 0xee, 0xff, 255,
            0xee, 0x00, 0xff, 255, 0x00, 0xee, 0xff, 255, 0xaa, 0xee, 0xff, 255, 0xab, 0xee, 0xff, 255
        ]);

        expect(display).to.have.displayed(targetData);
    });

    it('should handle the Raw encoding in low colour mode', function () {
        testDecodeRect(decoder, 0, 0, 2, 2,
                       [0x30, 0x30, 0x30, 0x30],
                       display, 8);
        testDecodeRect(decoder, 2, 0, 2, 2,
                       [0x0c, 0x0c, 0x0c, 0x0c],
                       display, 8);
        testDecodeRect(decoder, 0, 2, 4, 1,
                       [0x0c, 0x0c, 0x30, 0x30],
                       display, 8);
        testDecodeRect(decoder, 0, 3, 4, 1,
                       [0x0c, 0x0c, 0x30, 0x30],
                       display, 8);

        let targetData = new Uint8Array([
            0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255, 0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255,
            0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255, 0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255,
            0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255, 0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255,
            0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255, 0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255
        ]);

        expect(display).to.have.displayed(targetData);
    });

    it('should handle empty rects', function () {
        display.fillRect(0, 0, 4, 4, [ 0x00, 0x00, 0xff ], 0, true);
        display.fillRect(2, 0, 2, 2, [ 0x00, 0xff, 0x00 ], 0, true);
        display.fillRect(0, 2, 2, 2, [ 0x00, 0xff, 0x00 ], 0, true);

        testDecodeRect(decoder, 1, 2, 0, 0, [], display, 24);

        let targetData = new Uint8Array([
            0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255, 0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255,
            0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255, 0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255,
            0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255, 0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255,
            0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255, 0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255
        ]);

        expect(display).to.have.displayed(targetData);
    });

    it('should handle empty rects in low colour mode', function () {
        display.fillRect(0, 0, 4, 4, [ 0x00, 0x00, 0xff ], 0, true);
        display.fillRect(2, 0, 2, 2, [ 0x00, 0xff, 0x00 ], 0, true);
        display.fillRect(0, 2, 2, 2, [ 0x00, 0xff, 0x00 ], 0, true);

        testDecodeRect(decoder, 1, 2, 0, 0, [], display, 8);

        let targetData = new Uint8Array([
            0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255, 0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255,
            0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255, 0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255,
            0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255, 0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255,
            0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255, 0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255
        ]);

        expect(display).to.have.displayed(targetData);
    });
});
