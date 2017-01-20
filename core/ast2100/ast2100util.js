/* (c) Copyright 2015-2017 Kevin Kelley <kelleyk@kelleyk.net>. */


function fmt_rgb_buf (n, buf) {
    var s = "";
    for (var y = 0; y < n; ++y) {
        for (var x = 0; x < n; ++x) {
            var offset = ((y*n)+x)*4;
            s += fmt_u8(buf[offset+0]) + fmt_u8(buf[offset+1]) + fmt_u8(buf[offset+2]) + fmt_u8(buf[offset+3]) + ' ';
        }
        s += '\n';
    }
    return s;
}

var fmt_u8 = function (x) {
    var pad = '00';
    var s = x.toString(16);
    return pad.substring(0, pad.length - s.length) + s;
};
var fmt_u16 = function (x) {
    var pad = '0000';
    var s = x.toString(16);
    return pad.substring(0, pad.length - s.length) + s;
};
var fmt_u32 = function (x) {  // cheesy way to ger around the sign bit
    return fmt_u16(x >>> 16) + fmt_u16(x & 0xFFFF);
};

var fmt_s8 = function (x) {
    if (x < 0)
        x += (1 << 8);
    return fmt_u8(x);
};

var fmt_s16 = function (x) {
    if (x < 0)
        x += (1 << 16);
    return fmt_u16(x);
};

var fmt_s32 = function (x) {
    if (x < 0)
        x += (1 << 32);
    return fmt_u32(x);
};

var fmt_array = function(f, xx) {
    xx = Array.from(xx);  // if xx is a typed array, the strings fmt_u8 returns will be silently coerced back to numbers
    return '[' + xx.map(f).join(', ') + ']';
};


var fmt_u8a = function (xx) { return fmt_array(fmt_u8, xx); };
var fmt_u16a = function (xx) { return fmt_array(fmt_u16, xx); };
var fmt_u32a = function (xx) { return fmt_array(fmt_u32, xx); };
var fmt_s8a = function (xx) { return fmt_array(fmt_s8, xx); };
var fmt_s16a = function (xx) { return fmt_array(fmt_s16, xx); };
var fmt_s32a = function (xx) { return fmt_array(fmt_s32, xx); };


var inRangeIncl = function (x, a, b) {
    return (x >= a && x <= b);
};
var inRange = function (x, a, b) {
    return (x >= a && x < b);
};

var swap32 = function (val) {
    return ((val & 0xFF) << 24)
        | ((val & 0xFF00) << 8)
        | ((val >> 8) & 0xFF00)
        | ((val >> 24) & 0xFF);
};

var arrayEq = function (a, b) {
    if (a.length != b.length)
        return false;
    for (var i = 0; i < a.length; ++i)
        if (a[i] != b[i])
            return false;
    return true;
};

var isEmpty = function (obj) {
    for(var prop in obj)
        if(obj.hasOwnProperty(prop))
            return false;
    return true;
};

var clamp = function (x) {
    x = ~~x;
    if (x <= 0)
        return 0;
    if (x >= 255)
        return 255;
    return x;
};


var BitStream;
var JpegHuffmanTable;


(function () {
    "use strict";
    
    BitStream = function (defaults) {

        // ATEN scan data does not treat 0xFF bytes specially.
        this._interpretMarkers = false;
        // True iff we've encountered "end-of-image".
        this._eoi = false;

        this._data = defaults.data;  // uint8[]
        if (this._data === undefined)
            throw 'BitStream constructor requires argument "data"!';
        
        this._nextDword = 0;  // uint8

        // Fill the readbuf and reservoir with the first two dwords in the data
        // buffer.
        this._reservoir = 0;
        this._bitsInReservoir = 0;
        this._refill();
        this._readbuf = this._reservoir;
        this._reservoir = 0;
        this._bitsInReservoir = 0;
        this._refill();
    };

    BitStream.prototype = {
        getPos: function () {
            return (this._nextDword * 32) - (32 + this._bitsInReservoir);
        },
        skip: function (bits) {
            while (bits > 0) {
                var n = Math.min(32, bits);
                this.read(n);
                bits -= n;
            }
        },
        read: function (bits) {
            // JavaScript's bitwise operators have this limitation.
            if (bits >= 32)
                throw 'Number of bits must be less than 32.';
            
            // this.checkInvariants();

            var that = this;
            var moveFromReservoir = function (n) {
                that._readbuf = (that._readbuf << n) | (that._reservoir >>> (32 - n));
                that._reservoir <<= n;
                that._bitsInReservoir -= n;
            };
            
            var retval = this._readbuf >>> (32 - bits);  // same as this.peek(bits)

            if (bits > this._bitsInReservoir) {
                bits -= this._bitsInReservoir;
                moveFromReservoir(this._bitsInReservoir);
                this._refill();
            }
            moveFromReservoir(bits);
            
            return retval;
        },
        _refill: function () {
            // this.checkInvariants();
            
            // N.B.: Must use >>> for unsigned shift; >> is sra.
            if (this._bitsInReservoir != 0)
                throw 'Oops: in _refill(),  bitsInReservoir='+this._bitsInReservoir;
            for (var i = 0; i < 4; ++i) {
                var x = this._data[(4 * this._nextDword) + i];
                if (x === undefined)
                    throw 'BitStream overran available data!';
                // TODO: if interpretMarkers ...
                this._reservoir = (this._reservoir << 8) | x;
                this._bitsInReservoir += 8;
            }
            this._nextDword += 1;

            this._reservoir = swap32(this._reservoir);
            
            // this.checkInvariants();
        },
        peek: function (bits) {
            if (bits >= 32)  // due to the fact that the bitwise operators have this limitation
                throw 'Number of bits must be less than 32.';
            
            // this.checkInvariants();
            return this._readbuf >>> (32 - bits);
        },
        showDebug: function () {
            console.log('stream readbuf='+fmt_u32(this._readbuf)+' reservoir='+fmt_u32(this._reservoir)+' bitsLeft='+this._bitsInReservoir+'d nextDword='+fmt_u16(this._nextDword));
        },
        checkInvariants: function () {
            var err = null;
            
            if (this._bitsInReservoir < 0 || this._bitsInReservoir > 32)
                err = 'Oops: BitStream invariant violated:  bitsInReservoir='+this._bitsInReservoir;

            if (err) {
                console.log(err);
                this.showDebug();
                throw err;
            }
        }
        
    };   
    
    JpegHuffmanTable = function (defaults) {
        if (!defaults)
            defaults = {};
        if (!defaults.bits || !defaults.huffval)
            throw 'Arguments bits, huffval are required.';

        this._huffsize = new Uint8Array(1<<16);
        this._huffval_lookup = new Uint8Array(1<<16);
        // 1 to 16, plus a useless 0th element to make indexing nicer.
        this._bits = new Uint8Array(17);
        
        this._buildTables(defaults.bits, defaults.huffval);
    };
    
    JpegHuffmanTable.prototype = {
        
        _buildTables: function (bits, huffval) {
            // First, copy BITS.
            for (var i = 0; i < 17; ++i) {
                this._bits[i] = bits[i];
                
                // This follows from the fact that the all-ones codeword of each
                // length is reserved as a prefix for longer codewords, which
                // implies that there may not be more than (2**i)-1 codewords of
                // length i bits.
                if ((1 << i) <= bits[i])
                    throw 'Oops: bad BITS.';
            }

            // Calculate Huffman codewords.  The best explanation for this is a
            // graphical one.  Refer to 'Binary Tree Expansin of DHT' figure
            // here:
            // http://www.impulseadventure.com/photo/jpeg-huffman-coding.html.
            var next_codeword = 0;
            var codeword_qty = 0;
            var codeword_idx = 0;  // index into HUFFVAL
            for (var code_len = 1; code_len < 17; ++code_len) {
                for (var i = 0; i < this._bits[code_len]; ++i) {
                    for (var j = 0; j < (1 << (16 - code_len)); ++j) {
                        this._huffsize[next_codeword + j] = code_len;
                        this._huffval_lookup[next_codeword + j] = huffval[codeword_idx];
                    }
                    next_codeword += (1 << (16 - code_len));
                    codeword_idx += 1;
                }
            }
            if (codeword_idx != huffval.length)
                throw 'Oops: all codewords should be used!';
        },
        
        // Reads the next code from the stream.  Consumes up to 16 bits.
        // Returns the corresponding codeword (the value that the code
        // represents, which is always exactly one byte).
        readCode: function (stream) {
            // Some number of bits, 16 < x <= 0, on the least-significant end of
            // this 16b value are not relevant, depoending on how long the code
            // actually is.  However, we've built our lookup tables so that,
            // regardless of what value the irrelevant bits have, we will get
            // the same result.
            var fixedlenCode = stream.peek(16);  // uint16
            
            var codeLen = this._huffsize[fixedlenCode];
            stream.skip(codeLen);
            var codeword = this._huffval_lookup[fixedlenCode];
            return codeword;
        }
        
    };
        
})();

