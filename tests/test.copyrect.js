const expect = chai.expect;

import Websock from '../core/websock.js';
import Display from '../core/display.js';
import makeCanvas, { sizeDisplay } from './fake.canvas.js';

import CopyRectDecoder from '../core/decoders/copyrect.js';

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

describe('CopyRect Decoder', function () {
    let decoder;
    let display;

    before(FakeWebSocket.replace);
    after(FakeWebSocket.restore);

    beforeEach(function () {
        decoder = new CopyRectDecoder();
        display = new Display(makeCanvas());
        sizeDisplay(display, 4, 4);
    });

    it('should handle the CopyRect encoding', function () {
        // seed some initial data to copy
        display.fillRect(0, 0, 4, 4, [ 0x11, 0x22, 0x33 ], 0, true);
        display.fillRect(0, 0, 2, 2, [ 0x00, 0x00, 0xff ], 0, true);
        display.fillRect(2, 0, 2, 2, [ 0x00, 0xff, 0x00 ], 0, true);

        testDecodeRect(decoder, 0, 2, 2, 2,
                       [0x00, 0x02, 0x00, 0x00],
                       display, 24);
        testDecodeRect(decoder, 2, 2, 2, 2,
                       [0x00, 0x00, 0x00, 0x00],
                       display, 24);

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

        testDecodeRect(decoder, 1, 2, 0, 0, [0x00, 0x00, 0x00, 0x00], display, 24);

        let targetData = new Uint8Array([
            0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255, 0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255,
            0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255, 0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255,
            0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255, 0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255,
            0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255, 0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255
        ]);

        expect(display).to.have.displayed(targetData);
    });
});
