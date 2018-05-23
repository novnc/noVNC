import { inflateInit, inflate, inflateReset } from "../vendor/pako/lib/zlib/inflate.js";
import ZStream from "../vendor/pako/lib/zlib/zstream.js";

Inflate.prototype = {
    inflate: function (data, flush, expected) {
        this.strm.input = data;
        this.strm.avail_in = this.strm.input.length;
        this.strm.next_in = 0;
        this.strm.next_out = 0;

        // resize our output buffer if it's too small
        // (we could just use multiple chunks, but that would cause an extra
        // allocation each time to flatten the chunks)
        if (expected > this.chunkSize) {
            this.chunkSize = expected;
            this.strm.output = new Uint8Array(this.chunkSize);
        }

        this.strm.avail_out = this.chunkSize;

        inflate(this.strm, flush);

        return new Uint8Array(this.strm.output.buffer, 0, this.strm.next_out);
    },

    reset: function () {
        inflateReset(this.strm);
    }
};

export default function Inflate() {
    this.strm = new ZStream();
    this.chunkSize = 1024 * 10 * 10;
    this.strm.output = new Uint8Array(this.chunkSize);
    this.windowBits = 5;

    inflateInit(this.strm, this.windowBits);
}
