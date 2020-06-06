const expect = chai.expect;

import Websock from '../core/websock.js';
import Display from '../core/display.js';

import TightPngDecoder from '../core/decoders/tightpng.js';

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

describe('TightPng Decoder', function () {
    let decoder;
    let display;

    before(FakeWebSocket.replace);
    after(FakeWebSocket.restore);

    beforeEach(function () {
        decoder = new TightPngDecoder();
        display = new Display(document.createElement('canvas'));
        display.resize(4, 4);
    });

    it.skip('should handle the TightPng encoding', function () {
        // TODO(directxman12): test this
    });
});
