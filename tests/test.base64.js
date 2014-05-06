// requires local modules: base64
var assert = chai.assert;
var expect = chai.expect;

describe('Base64 Tools', function() {
    "use strict";

    var BIN_ARR = new Array(256);
    for (var i = 0; i < 256; i++) {
        BIN_ARR[i] = i;
    }
    
    var B64_STR = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0+P0BBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWltcXV5fYGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6e3x9fn+AgYKDhIWGh4iJiouMjY6PkJGSk5SVlpeYmZqbnJ2en6ChoqOkpaanqKmqq6ytrq+wsbKztLW2t7i5uru8vb6/wMHCw8TFxsfIycrLzM3Oz9DR0tPU1dbX2Nna29zd3t/g4eLj5OXm5+jp6uvs7e7v8PHy8/T19vf4+fr7/P3+/w==";


    describe('encode', function() {
        it('should encode a binary string into Base64', function() {
            var encoded = Base64.encode(BIN_ARR);
            expect(encoded).to.equal(B64_STR);
        });
    });

    describe('decode', function() {
        it('should decode a Base64 string into a normal string', function() {
            var decoded = Base64.decode(B64_STR);
            expect(decoded).to.deep.equal(BIN_ARR);
        });

        it('should throw an error if we have extra characters at the end of the string', function() {
            expect(function () { Base64.decode(B64_STR+'abcdef'); }).to.throw(Error);
        });
    });
});
