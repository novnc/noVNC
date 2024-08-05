import { deflateInit, deflate, Z_FULL_FLUSH } from "../vendor/pako/lib/zlib/deflate.js";
import ZStream from "../vendor/pako/lib/zlib/zstream.js";
import Inflator from "../core/inflator.js";

function _deflator(data) {
    let strm = new ZStream();

    deflateInit(strm, 5);

    /* eslint-disable camelcase */
    strm.input = data;
    strm.avail_in = strm.input.length;
    strm.next_in = 0;
    /* eslint-enable camelcase */

    let chunks = [];
    let totalLen = 0;
    while (strm.avail_in > 0) {
        /* eslint-disable camelcase */
        strm.output = new Uint8Array(1024 * 10 * 10);
        strm.avail_out = strm.output.length;
        strm.next_out = 0;
        /* eslint-enable camelcase */

        let ret = deflate(strm, Z_FULL_FLUSH);

        // Check that return code is not an error
        expect(ret).to.be.greaterThan(-1);

        let chunk = new Uint8Array(strm.output.buffer, 0, strm.next_out);
        totalLen += chunk.length;
        chunks.push(chunk);
    }

    // Combine chunks into a single data

    let outData = new Uint8Array(totalLen);
    let offset = 0;

    for (let i = 0; i < chunks.length; i++) {
        outData.set(chunks[i], offset);
        offset += chunks[i].length;
    }

    return outData;
}

describe('Inflate data', function () {

    it('should be able to inflate messages', function () {
        let inflator = new Inflator();

        let text = "123asdf";
        let preText = new Uint8Array(text.length);
        for (let i = 0; i < preText.length; i++) {
            preText[i] = text.charCodeAt(i);
        }

        let compText = _deflator(preText);

        inflator.setInput(compText);
        let inflatedText = inflator.inflate(preText.length);

        expect(inflatedText).to.array.equal(preText);

    });

    it('should be able to inflate large messages', function () {
        let inflator = new Inflator();

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

        let compText = _deflator(preText);

        //Check that the compressed size is expected size
        expect(compText.length).to.be.greaterThan((1024 * 10 * 10) * 2);

        inflator.setInput(compText);
        let inflatedText = inflator.inflate(preText.length);

        expect(inflatedText).to.array.equal(preText);
    });

    it('should throw an error on insufficient data', function () {
        let inflator = new Inflator();

        let text = "123asdf";
        let preText = new Uint8Array(text.length);
        for (let i = 0; i < preText.length; i++) {
            preText[i] = text.charCodeAt(i);
        }

        let compText = _deflator(preText);

        inflator.setInput(compText);
        expect(() => inflator.inflate(preText.length * 2)).to.throw();
    });
});
