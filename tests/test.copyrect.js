const expect = chai.expect;

import Websock from '../core/websock.js';
import Display from '../core/display.js';

import CopyRectDecoder from '../core/decoders/copyrect.js';

import FakeWebSocket from './fake.websocket.js';

function testDecodeRect(decoder, x, y, width, height, data, display, depth) {
    let sock;

    sock = new Websock;
    sock.open("ws://example.com");

    sock.on('message', () => {
        decoder.decodeRect(x, y, width, height, sock, display, depth);
    });

    sock._websocket._receiveData(new Uint8Array(data));

    display.flip();
}

describe('CopyRect Decoder', function () {
    let decoder;
    let display;

    before(FakeWebSocket.replace);
    after(FakeWebSocket.restore);

    beforeEach(function () {
        decoder = new CopyRectDecoder();
        display = new Display(document.createElement('canvas'));
        display.resize(4, 4);
    });

    it('should handle the CopyRect encoding', function () {
        let targetData = new Uint8Array([
            0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255, 0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255,
            0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255, 0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255,
            0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255, 0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255,
            0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255, 0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255
        ]);

        // seed some initial data to copy
        display.blitRgbxImage(0, 0, 4, 2, new Uint8Array(targetData.slice(0, 32)), 0);

        testDecodeRect(decoder, 0, 2, 2, 2,
                       [0x00, 0x02, 0x00, 0x00],
                       display, 24);
        testDecodeRect(decoder, 2, 2, 2, 2,
                       [0x00, 0x00, 0x00, 0x00],
                       display, 24);

        expect(display).to.have.displayed(targetData);
    });
});
