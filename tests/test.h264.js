import Websock from '../core/websock.js';
import Display from '../core/display.js';

import { H264Parser } from '../core/decoders/h264.js';
import H264Decoder from '../core/decoders/h264.js';
import Base64 from '../core/base64.js';
import { supportsWebCodecsH264Decode } from '../core/util/browser.js';

import FakeWebSocket from './fake.websocket.js';

/* This is a 3 frame 16x16 video where the first frame is solid red, the second
 * is solid green and the third is solid blue.
 *
 * The colour space is BT.709. It is encoded into the stream.
 */
const redGreenBlue16x16Video = new Uint8Array(Base64.decode(
    'AAAAAWdCwBTZnpuAgICgAAADACAAAAZB4oVNAAAAAWjJYyyAAAABBgX//4HcRem95tlIt5Ys' +
    '2CDZI+7veDI2NCAtIGNvcmUgMTY0IHIzMTA4IDMxZTE5ZjkgLSBILjI2NC9NUEVHLTQgQVZD' +
    'IGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDIzIC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcv' +
    'eDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MCByZWY9NSBkZWJsb2NrPTE6MDowIGFuYWx5' +
    'c2U9MHgxOjB4MTExIG1lPWhleCBzdWJtZT04IHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4' +
    'ZWRfcmVmPTEgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxpcz0yIDh4OGRjdD0wIGNx' +
    'bT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PS0yIHRo' +
    'cmVhZHM9MSBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNp' +
    'bWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9' +
    'MCBiZnJhbWVzPTAgd2VpZ2h0cD0wIGtleWludD1pbmZpbml0ZSBrZXlpbnRfbWluPTI1IHNj' +
    'ZW5lY3V0PTQwIGludHJhX3JlZnJlc2g9MCByY19sb29rYWhlYWQ9NTAgcmM9YWJyIG1idHJl' +
    'ZT0xIGJpdHJhdGU9NDAwIHJhdGV0b2w9MS4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02' +
    'OSBxcHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTE6MS4wMACAAAABZYiEBrxmKAAPVccAAS04' +
    '4AA5DRJMnkycJk4TPwAAAAFBiIga8RigADVVHAAGaGOAANtuAAAAAUGIkBr///wRRQABVf8c' +
    'AAcho4AAiD4='));

function createSolidColorFrameBuffer(color, width, height) {
    const r = (color >> 24) & 0xff;
    const g = (color >> 16) & 0xff;
    const b = (color >> 8) & 0xff;
    const a = (color >> 0) & 0xff;

    const size = width * height * 4;
    let array = new Uint8ClampedArray(size);

    for (let i = 0; i < size / 4; ++i) {
        array[i * 4 + 0] = r;
        array[i * 4 + 1] = g;
        array[i * 4 + 2] = b;
        array[i * 4 + 3] = a;
    }

    return array;
}

function makeMessageHeader(length, resetContext, resetAllContexts) {
    let flags = 0;
    if (resetContext) {
        flags |= 1;
    }
    if (resetAllContexts) {
        flags |= 2;
    }

    let header = new Uint8Array(8);
    let i = 0;

    let appendU32 = (v) => {
        header[i++] = (v >> 24) & 0xff;
        header[i++] = (v >> 16) & 0xff;
        header[i++] = (v >> 8) & 0xff;
        header[i++] = v & 0xff;
    };

    appendU32(length);
    appendU32(flags);

    return header;
}

function wrapRectData(data, resetContext, resetAllContexts) {
    let header = makeMessageHeader(data.length, resetContext, resetAllContexts);
    return Array.from(header).concat(Array.from(data));
}

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

function almost(a, b) {
    let diff = Math.abs(a - b);
    return diff < 5;
}

describe('H.264 parser', function () {
    it('should parse constrained baseline video', function () {
        let parser = new H264Parser(redGreenBlue16x16Video);

        let frame = parser.parse();
        expect(frame).to.have.property('key', true);

        expect(parser).to.have.property('profileIdc', 66);
        expect(parser).to.have.property('constraintSet', 192);
        expect(parser).to.have.property('levelIdc', 20);

        frame = parser.parse();
        expect(frame).to.have.property('key', false);

        frame = parser.parse();
        expect(frame).to.have.property('key', false);

        frame = parser.parse();
        expect(frame).to.be.null;
    });
});

describe('H.264 decoder unit test', function () {
    let decoder;

    beforeEach(function () {
        if (!supportsWebCodecsH264Decode) {
            this.skip();
            return;
        }
        decoder = new H264Decoder();
    });

    it('creates and resets context', function () {
        let context = decoder._getContext(1, 2, 3, 4);
        expect(context._width).to.equal(3);
        expect(context._height).to.equal(4);
        expect(decoder._contexts).to.not.be.empty;
        decoder._resetContext(1, 2, 3, 4);
        expect(decoder._contexts).to.be.empty;
    });

    it('resets all contexts', function () {
        decoder._getContext(0, 0, 1, 1);
        decoder._getContext(2, 2, 1, 1);
        expect(decoder._contexts).to.not.be.empty;
        decoder._resetAllContexts();
        expect(decoder._contexts).to.be.empty;
    });

    it('caches contexts', function () {
        let c1 = decoder._getContext(1, 2, 3, 4);
        c1.lastUsed = 1;
        let c2 = decoder._getContext(1, 2, 3, 4);
        c2.lastUsed = 2;
        expect(Object.keys(decoder._contexts).length).to.equal(1);
        expect(c1.lastUsed).to.equal(c2.lastUsed);
    });

    it('deletes oldest context', function () {
        for (let i = 0; i < 65; ++i) {
            let context = decoder._getContext(i, 0, 1, 1);
            context.lastUsed = i;
        }

        expect(decoder._findOldestContextId()).to.equal('1,0,1,1');
        expect(decoder._contexts[decoder._contextId(0, 0, 1, 1)]).to.be.undefined;
        expect(decoder._contexts[decoder._contextId(1, 0, 1, 1)]).to.not.be.null;
        expect(decoder._contexts[decoder._contextId(63, 0, 1, 1)]).to.not.be.null;
        expect(decoder._contexts[decoder._contextId(64, 0, 1, 1)]).to.not.be.null;
    });
});

describe('H.264 decoder functional test', function () {
    let decoder;
    let display;

    before(FakeWebSocket.replace);
    after(FakeWebSocket.restore);

    beforeEach(function () {
        if (!supportsWebCodecsH264Decode) {
            this.skip();
            return;
        }
        decoder = new H264Decoder();
        display = new Display(document.createElement('canvas'));
        display.resize(16, 16);
    });

    it('should handle H.264 rect', async function () {
        let data = wrapRectData(redGreenBlue16x16Video, false, false);
        let done = testDecodeRect(decoder, 0, 0, 16, 16, data, display, 24);
        expect(done).to.be.true;
        await display.flush();
        let targetData = createSolidColorFrameBuffer(0x0000ffff, 16, 16);
        expect(display).to.have.displayed(targetData, almost);
    });

    it('should handle specific context reset', async function () {
        let data = wrapRectData(redGreenBlue16x16Video, false, false);
        let done = testDecodeRect(decoder, 0, 0, 16, 16, data, display, 24);
        expect(done).to.be.true;
        await display.flush();
        let targetData = createSolidColorFrameBuffer(0x0000ffff, 16, 16);
        expect(display).to.have.displayed(targetData, almost);

        data = wrapRectData([], true, false);
        done = testDecodeRect(decoder, 0, 0, 16, 16, data, display, 24);
        expect(done).to.be.true;
        await display.flush();

        expect(decoder._contexts[decoder._contextId(0, 0, 16, 16)]._decoder).to.be.null;
    });

    it('should handle global context reset', async function () {
        let data = wrapRectData(redGreenBlue16x16Video, false, false);
        let done = testDecodeRect(decoder, 0, 0, 16, 16, data, display, 24);
        expect(done).to.be.true;
        await display.flush();
        let targetData = createSolidColorFrameBuffer(0x0000ffff, 16, 16);
        expect(display).to.have.displayed(targetData, almost);

        data = wrapRectData([], false, true);
        done = testDecodeRect(decoder, 0, 0, 16, 16, data, display, 24);
        expect(done).to.be.true;
        await display.flush();

        expect(decoder._contexts[decoder._contextId(0, 0, 16, 16)]._decoder).to.be.null;
    });
});
