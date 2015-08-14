var zlib = require('./lib/zlib/inflate.js');
var ZStream = require('./lib/zlib/zstream.js');

var Inflate = function () {
    this.strm = new ZStream();
    this.chunkSize = 1024 * 10 * 10;
    this.strm.output = new Uint8Array(this.chunkSize);
    this.windowBits = 5;

    zlib.inflateInit(this.strm, this.windowBits);
};

Inflate.prototype = {
    inflate: function (data, flush) {
        this.strm.input = data;
        this.strm.avail_in = this.strm.input.length;
        this.strm.next_in = 0;
        this.strm.next_out = 0;

        this.strm.avail_out = this.chunkSize;

        zlib.inflate(this.strm, flush);

        return new Uint8Array(this.strm.output.buffer, 0, this.strm.next_out);
    },

    reset: function () {
        zlib.inflateReset(this.strm);
    }
};

module.exports = {Inflate: Inflate};
