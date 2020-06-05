/* eslint-disable no-console */
const expect = chai.expect;

import { inflateInit, inflate } from "../vendor/pako/lib/zlib/inflate.js";
import ZStream from "../vendor/pako/lib/zlib/zstream.js";
import Deflator from "../core/deflator.js";

function _inflator(compText, expected) {
    let strm = new ZStream();
    let chunkSize = 1024 * 10 * 10;
    strm.output = new Uint8Array(chunkSize);

    inflateInit(strm, 5);

    if (expected > chunkSize) {
        chunkSize = expected;
        strm.output = new Uint8Array(chunkSize);
    }

    /* eslint-disable camelcase */
    strm.input = compText;
    strm.avail_in = strm.input.length;
    strm.next_in = 0;

    strm.next_out = 0;
    strm.avail_out = expected.length;
    /* eslint-enable camelcase */

    let ret = inflate(strm, 0);

    // Check that return code is not an error
    expect(ret).to.be.greaterThan(-1);

    return new Uint8Array(strm.output.buffer, 0, strm.next_out);
}

describe('Deflate data', function () {

    it('should be able to deflate messages', function () {
        let deflator = new Deflator();

        let text = "123asdf";
        let preText = new Uint8Array(text.length);
        for (let i = 0; i < preText.length; i++) {
            preText[i] = text.charCodeAt(i);
        }

        let compText = deflator.deflate(preText);

        let inflatedText = _inflator(compText, text.length);
        expect(inflatedText).to.array.equal(preText);

    });

    it('should be able to deflate large messages', function () {
        let deflator = new Deflator();

        /* Generate a big string with random characters. Used because
           repetition of letters might be deflated more effectively than
           random ones. */
        let text = "";
        let characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 300000; i++) {
            text += characters.charAt(Math.floor(Math.random() * characters.length));
        }

        let preText = new Uint8Array(text.length);
        for (let i = 0; i < preText.length; i++) {
            preText[i] = text.charCodeAt(i);
        }

        let compText = deflator.deflate(preText);

        //Check that the compressed size is expected size
        expect(compText.length).to.be.greaterThan((1024 * 10 * 10) * 2);

        let inflatedText = _inflator(compText, text.length);

        expect(inflatedText).to.array.equal(preText);

    });
});
