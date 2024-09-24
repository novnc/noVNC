import Base64 from '../core/base64.js';

describe('Base64 Tools', function () {
    "use strict";

    const BIN_ARR = new Array(256);
    for (let i = 0; i < 256; i++) {
        BIN_ARR[i] = i;
    }

    const B64_STR = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0+P0BBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWltcXV5fYGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6e3x9fn+AgYKDhIWGh4iJiouMjY6PkJGSk5SVlpeYmZqbnJ2en6ChoqOkpaanqKmqq6ytrq+wsbKztLW2t7i5uru8vb6/wMHCw8TFxsfIycrLzM3Oz9DR0tPU1dbX2Nna29zd3t/g4eLj5OXm5+jp6uvs7e7v8PHy8/T19vf4+fr7/P3+/w==";


    describe('encode', function () {
        it('should encode a binary string into Base64', function () {
            const encoded = Base64.encode(BIN_ARR);
            expect(encoded).to.equal(B64_STR);
        });
    });

    describe('decode', function () {
        it('should decode a Base64 string into a normal string', function () {
            const decoded = Base64.decode(B64_STR);
            expect(decoded).to.deep.equal(BIN_ARR);
        });

        it('should throw an error if we have extra characters at the end of the string', function () {
            expect(() => Base64.decode(B64_STR+'abcdef')).to.throw(Error);
        });
    });
});
