import Websock from '../core/websock.js';
import Display from '../core/display.js';

import HextileDecoder from '../core/decoders/hextile.js';

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

function push32(arr, num) {
    arr.push((num >> 24) & 0xFF,
             (num >> 16) & 0xFF,
             (num >>  8) & 0xFF,
             num & 0xFF);
}

describe('Hextile Decoder', function () {
    let decoder;
    let display;

    before(FakeWebSocket.replace);
    after(FakeWebSocket.restore);

    beforeEach(function () {
        decoder = new HextileDecoder();
        display = new Display(document.createElement('canvas'));
        display.resize(4, 4);
    });

    it('should handle a tile with fg, bg specified, normal subrects', function () {
        let data = [];
        data.push(0x02 | 0x04 | 0x08); // bg spec, fg spec, anysubrects
        push32(data, 0x00ff0000); // becomes 00ff0000 --> #00FF00 bg color
        data.push(0x00); // becomes 0000ff00 --> #0000FF fg color
        data.push(0x00);
        data.push(0xff);
        data.push(0x00);
        data.push(2); // 2 subrects
        data.push(0); // x: 0, y: 0
        data.push(1 | (1 << 4)); // width: 2, height: 2
        data.push(2 | (2 << 4)); // x: 2, y: 2
        data.push(1 | (1 << 4)); // width: 2, height: 2

        let done = testDecodeRect(decoder, 0, 0, 4, 4, data, display, 24);

        let targetData = new Uint8Array([
            0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255, 0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255,
            0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255, 0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255,
            0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255, 0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255,
            0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255, 0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255
        ]);

        expect(done).to.be.true;
        expect(display).to.have.displayed(targetData);
    });

    it('should handle a raw tile', function () {
        let targetData = new Uint8Array([
            0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255, 0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255,
            0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255, 0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255,
            0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255, 0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255,
            0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255, 0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255
        ]);

        let data = [];
        data.push(0x01); // raw
        for (let i = 0; i < targetData.length; i += 4) {
            data.push(targetData[i]);
            data.push(targetData[i + 1]);
            data.push(targetData[i + 2]);
            // Last byte zero to test correct alpha handling
            data.push(0);
        }

        let done = testDecodeRect(decoder, 0, 0, 4, 4, data, display, 24);

        expect(done).to.be.true;
        expect(display).to.have.displayed(targetData);
    });

    it('should handle a tile with only bg specified (solid bg)', function () {
        let data = [];
        data.push(0x02);
        push32(data, 0x00ff0000); // becomes 00ff0000 --> #00FF00 bg color

        let done = testDecodeRect(decoder, 0, 0, 4, 4, data, display, 24);

        let expected = [];
        for (let i = 0; i < 16; i++) {
            push32(expected, 0x00ff00ff);
        }

        expect(done).to.be.true;
        expect(display).to.have.displayed(new Uint8Array(expected));
    });

    it('should handle a tile with only bg specified and an empty frame afterwards', function () {
        // set the width so we can have two tiles
        display.resize(8, 4);

        let data = [];

        // send a bg frame
        data.push(0x02);
        push32(data, 0x00ff0000); // becomes 00ff0000 --> #00FF00 bg color

        // send an empty frame
        data.push(0x00);

        let done = testDecodeRect(decoder, 0, 0, 32, 4, data, display, 24);

        let expected = [];
        for (let i = 0; i < 16; i++) {
            push32(expected, 0x00ff00ff);     // rect 1: solid
        }
        for (let i = 0; i < 16; i++) {
            push32(expected, 0x00ff00ff);    // rect 2: same bkground color
        }

        expect(done).to.be.true;
        expect(display).to.have.displayed(new Uint8Array(expected));
    });

    it('should handle a tile with bg and coloured subrects', function () {
        let data = [];
        data.push(0x02 | 0x08 | 0x10); // bg spec, anysubrects, colouredsubrects
        push32(data, 0x00ff0000); // becomes 00ff0000 --> #00FF00 bg color
        data.push(2); // 2 subrects
        data.push(0x00); // becomes 0000ff00 --> #0000FF fg color
        data.push(0x00);
        data.push(0xff);
        data.push(0x00);
        data.push(0); // x: 0, y: 0
        data.push(1 | (1 << 4)); // width: 2, height: 2
        data.push(0x00); // becomes 0000ff00 --> #0000FF fg color
        data.push(0x00);
        data.push(0xff);
        data.push(0x00);
        data.push(2 | (2 << 4)); // x: 2, y: 2
        data.push(1 | (1 << 4)); // width: 2, height: 2

        let done = testDecodeRect(decoder, 0, 0, 4, 4, data, display, 24);

        let targetData = new Uint8Array([
            0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255, 0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255,
            0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255, 0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255,
            0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255, 0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255,
            0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255, 0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255
        ]);

        expect(done).to.be.true;
        expect(display).to.have.displayed(targetData);
    });

    it('should carry over fg and bg colors from the previous tile if not specified', function () {
        display.resize(4, 17);

        let data = [];
        data.push(0x02 | 0x04 | 0x08); // bg spec, fg spec, anysubrects
        push32(data, 0xff00ff); // becomes 00ff00ff --> #00FF00 bg color
        data.push(0x00); // becomes 0000ffff --> #0000FF fg color
        data.push(0x00);
        data.push(0xff);
        data.push(0xff);
        data.push(8); // 8 subrects
        for (let i = 0; i < 4; i++) {
            data.push((0 << 4) | (i * 4)); // x: 0, y: i*4
            data.push(1 | (1 << 4)); // width: 2, height: 2
            data.push((2 << 4) | (i * 4 + 2)); // x: 2, y: i * 4 + 2
            data.push(1 | (1 << 4)); // width: 2, height: 2
        }
        data.push(0x08); // anysubrects
        data.push(1); // 1 subrect
        data.push(0); // x: 0, y: 0
        data.push(1 | (1 << 4)); // width: 2, height: 2

        let done = testDecodeRect(decoder, 0, 0, 4, 17, data, display, 24);

        let targetData = [
            0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255, 0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255,
            0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255, 0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255,
            0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255, 0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255,
            0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255, 0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255
        ];

        let expected = [];
        for (let i = 0; i < 4; i++) {
            expected = expected.concat(targetData);
        }
        expected = expected.concat(targetData.slice(0, 16));

        expect(done).to.be.true;
        expect(display).to.have.displayed(new Uint8Array(expected));
    });

    it('should fail on an invalid subencoding', function () {
        let data = [45];  // an invalid subencoding
        expect(() => testDecodeRect(decoder, 0, 0, 4, 4, data, display, 24)).to.throw();
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
});
