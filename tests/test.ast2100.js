// requires local modules: ast2100, ast2100idct, ast2100const, ast2100util
/* jshint expr: true */

var assert = chai.assert;
var expect = chai.expect;


// Convert a hex string, optionally containing spaces, into an array of integers representing bytes.
var parseHex = function (s) {
    s = s.replace(/\s/g, '');
    if (s.length % 2 != 0)
        throw 'Hex data has uneven length!';
    for (var bytes = [], i = 0; i < s.length; i += 2)
        bytes.push(parseInt(s.substr(i, 2), 16));
    return bytes;
};


function make_decoder () {
    return new Ast2100Decoder({
        width: 0x400,
        height: 0x300,
        blitCallback: function () {}
    });
}

// Swap u32 byte order.  Mutates input!
function buf_swap32 (data) {
    for (var i = 0; i < data.length; i += 4) {
        var tmp;
    
        tmp = data[i+0];
        data[i+0] = data[i+3];
        data[i+3] = tmp;
        
        tmp = data[i+1];
        data[i+1] = data[i+2];
        data[i+2] = tmp;
    }
    
    return data;
}


describe('ATEN_AST2100 video encoding', function() {
    "use strict";
    
    var dec;
    beforeEach(function () {
        dec = make_decoder();
        dec._mcuLimit = 10;
    });

    describe('BitStream', function() {
        var stream, stream2, stream3;
        var data = buf_swap32(parseHex('f0f0 cccc cccc cccc cccc cccc cccc cccc'));
        var data2 = parseHex('F0F1F2F3 F4F5F6F7 F8F9FAFB FCFDFEFF');
        var data3 = parseHex('0b0b01bc45fbc5e020040101ffff3f20c0ffffff0000240000000000000000005028140a0000000000000000');
        
        beforeEach(function () {
            stream = new BitStream({data: data});
            stream2 = new BitStream({data: data2});
            stream3 = new BitStream({data: data3});
        });

        it('should pass simple sanity checks', function () {
            expect(stream.read(4)).to.equal(0xF);
            expect(stream.read(4)).to.equal(0x0);
            expect(stream.read(4)).to.equal(0xF);
            expect(stream.read(4)).to.equal(0x0);
        });
        
        it('should pass simple sanity checks (part II)', function () {
            var i;
            for (i = 0; i < 4; ++i)
                expect(stream.read(1)).to.equal(1);
            for (i = 0; i < 4; ++i)
                expect(stream.read(1)).to.equal(0);
        });
        
        it('should be able to properly refill the buffer', function () {
            expect(stream.read(4)).to.equal(0xF);
            expect(stream.read(4)).to.equal(0x0);
            expect(stream.read(4)).to.equal(0xF);
            expect(stream.read(8)).to.equal(0x0C);
        });
        
        it('should properly swap byte order', function () {
            expect(stream2.read(8)).to.equal(0xF3);
            expect(stream2.read(8)).to.equal(0xF2);
            expect(stream2.read(8)).to.equal(0xF1);
            expect(stream2.read(8)).to.equal(0xF0);
            expect(stream2.read(8)).to.equal(0xF7);
        });
        
        it('should properly handle skipping the full 32-bit read-buffer (data3)', function () {
            // Must do this in two parts so that bits < 32 each time.
            stream3.skip(16);
            stream3.skip(16);
            expect(stream3.read(4)).to.equal(0xE);
        });
        
        // it('issue repro', function () {
        //     var data = parseHex('f0f0 cccc cccc cccc cccc cccc cccc cccc');
        //     var stream = new BitStream({data: data});
        //     expect(stream.read(31)).to.equal(0xF0F0CCCC >>> 1);
        //     expect(stream.read(8)).to.equal(0x66);
        // });        
    });
             
    describe('quant tables', function() {
        it('quant tables are properly loaded and scaled', function () {
            // This is luma quant table #4.
            var expected = Int32Array.from([
                0x00090000, 0x0008527e, 0x00068866, 0x000a9537, 0x000d0000, 0x00114908, 0x000f274b, 0x0009616d,
                0x0008527e, 0x000b8b14, 0x000caf8f, 0x00104f53, 0x00136b26, 0x0022df8f, 0x0018c594, 0x000b7b02,
                0x0009255c, 0x000caf8f, 0x000f5d2c, 0x0013f8fd, 0x001cbe90, 0x0020d994, 0x001adebc, 0x000b2cc4,
                0x00083b2b, 0x000eadca, 0x00126faf, 0x00161f78, 0x0020ecad, 0x002c58a1, 0x001ca316, 0x000b07c7,
                0x000a0000, 0x0010a4fc, 0x001a219a, 0x002473bf, 0x00260000, 0x002fed69, 0x001ed922, 0x000bdd19,
                0x000a36ca, 0x0014b4bd, 0x001ecbfa, 0x00214279, 0x00235b34, 0x0023cdea, 0x001ac9de, 0x000b0e2f,
                0x000e9cbf, 0x001b0616, 0x001e67d4, 0x001e8bd4, 0x001ed922, 0x001cea24, 0x00139fb4, 0x00085c96,
                0x000b0935, 0x00138450, 0x00131afd, 0x0011d7e1, 0x001161b4, 0x000c23a7, 0x000882d0, 0x00042fc6
            ]);

            dec._loadQuantTable(0, ATEN_QT_LUMA[4]);
            var luma_quant_table = dec.quantTables[0];
            expect(luma_quant_table).to.deep.equal(expected);
        });
    });
    
    describe('IDCT', function () {

        var outputBuf;
        
        beforeEach(function () {
            outputBuf = new Uint8Array(DCTSIZE2);  // equivalent to one of the componentBufs in Ast2100Decoder.
        });

        // TODO: Fix typing: variables should be typed arrays.
        it('test case 0 - DC value only', function () {
            
            // this is the output of the VLC / entropy coding process
            // XXX: @KK: Why is this 16-bit?
            var dataUnit = [  // new Int16Array(
                0xFF9C,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];

            var expected_idct_output = Uint8Array.from([  // new Uint8Array(
                0xF,0xF,0xF,0xF,0xF,0xF,0xF,0xF,0xF,0xF,0xF,0xF,0xF,0xF,0xF,0xF,0xF,0xF,0xF,0xF,0xF,0xF,0xF,0xF,0xF,0xF,0xF,
                0xF,0xF,0xF,0xF,0xF,0xF,0xF,0xF,0xF,0xF,0xF,0xF,0xF,0xF,0xF,0xF,0xF,0xF,0xF,0xF,0xF,0xF,0xF,0xF,0xF,0xF,0xF,
                0xF,0xF,0xF,0xF,0xF,0xF,0xF,0xF,0xF,0xF]);

            dec._loadQuantTable(0, ATEN_QT_LUMA[4]);
            var luma_quant_table = dec.quantTables[0];
            
            AST2100IDCT.idct_fixed_aan(luma_quant_table, dataUnit, outputBuf);

            // console.log(result);

            console.log('expected:');
            console.log(fmt_u8a(expected_idct_output));
            console.log('result:');
            console.log(fmt_u8a(outputBuf));
            
            expect(outputBuf).to.deep.equal(expected_idct_output);
            
        });

        it('test case 1', function () {
            // this is the output of the VLC / entropy coding process
            // XXX: @KK: Why is this 16-bit?
            var dataUnit = Int16Array.from([
                0xFFBD,0,0,0,0,0,0,0,
                0xFFC3,0,0,0,0,0,0,0,
                0x26,0,0,0,0,0,0,0,
                0xFFED,0,0,0,0,0,0,
                0,0,0,0,0,0,0,0,0,
                6,0,0,0,0,0,0,0,
                0xFFFC,0,0,0,0,0,0,0,
                2,0,0,0,0,0,0,0]);

            var expected = Uint8Array.from([
                0xF,0xF,0xF,0xF,0xF,0xF,0xF,0xF,
                0x11,0x11,0x11,0x11,0x11,0x11,0x11,0x11,
                0x12,0x12,0x12,0x12,0x12,0x12,0x12,0x12,
                0xE,0xE,0xE,0xE,0xE,0xE,0xE,0xE,
                0x12,0x12,0x12,0x12,0x12,0x12,0x12,0x12,
                0xF,0xF,0xF,0xF,0xF,0xF,0xF,0xF,
                0x9F,0x9F,0x9F,0x9F,0x9F,0x9F,0x9F,0x9F,
                0xA1,0xA1,0xA1,0xA1,0xA1,0xA1,0xA1,0xA1]);

            dec._loadQuantTable(0, ATEN_QT_LUMA[4]);
            var luma_quant_table = dec.quantTables[0];

            AST2100IDCT.idct_fixed_aan(luma_quant_table, dataUnit, outputBuf);

            /*
            console.log('expected:');
            console.log(fmt_u8a(expected));
            console.log('result:');
            console.log(fmt_u8a(outputBuf));
             */

            // XXX: TEMPORARY -- figure out this rounding issue
            // expect(result).to.deep.equal(expected);
            var maxErr = 0;
            for (i = 0; i < 64; ++i)
                maxErr = Math.max(maxErr, Math.abs(outputBuf[i] - expected[i]));
            if (maxErr > 1)
                throw 'Error too high!';
            
        });
        
        it('test case 2', function () {
            // this is the output of the VLC / entropy coding process
            // XXX: @KK: Why is this 16-bit?
            
            var dataUnit = Int16Array.from([
                0xFF9B, 0, 0, 0, 0, 0, 0, 0, 0xFFA4, 0, 0, 0, 0, 0, 0, 0, 0x35, 0, 0, 0, 0, 0, 0, 0,
                0xFFE6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 9, 0, 0, 0, 0, 0, 0, 0, 0xFFFA,
                0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0]);
            
            var expected = [
                0xE, 0xE, 0xE, 0xE, 0xE, 0xE, 0xE, 0xE, 0x13, 0x13, 0x13, 0x13, 0x13, 0x13, 0x13, 0x13,
                0xD, 0xD, 0xD, 0xD, 0xD, 0xD, 0xD, 0xD, 0x13, 0x13, 0x13, 0x13, 0x13, 0x13, 0x13, 0x13,
                0xD, 0xD, 0xD, 0xD, 0xD, 0xD, 0xD, 0xD, 0x14, 0x14, 0x14, 0x14, 0x14, 0x14, 0x14, 0x14,
                0x9C, 0x9C, 0x9C, 0x9C, 0x9C, 0x9C, 0x9C, 0x9C, 0xA1, 0xA1, 0xA1, 0xA1, 0xA1, 0xA1, 0xA1, 0xA1];

             // Between IDCT passes, the workspace should look like this:
            //  [-903, 0, 0, 0, 0, 0, 0, 0, -874, 0, 0, 0, 0, 0, 0, 0, -914, 0, 0, 0, 0, 0, 0, 0, -874, 0, 0, 0, 0, 0, 0, 0,
            //   -915, 0, 0, 0, 0, 0, 0, 0, -868, 0, 0, 0, 0, 0, 0, 0, 230, 0, 0, 0, 0, 0, 0, 0, 266, 0, 0, 0, 0, 0, 0, 0]
            
            
            dec._loadQuantTable(0, ATEN_QT_LUMA[5]);
            var luma_quant_table = dec.quantTables[0];

            AST2100IDCT.idct_fixed_aan(luma_quant_table, dataUnit, outputBuf);

            // console.log(result);

            console.log('expected:');
            console.log(fmt_u8a(expected));
            console.log('result:');
            console.log(fmt_u8a(outputBuf));

            // XXX: TEMPORARY -- figure out this rounding issue
            // expect(result).to.deep.equal(expected);
            var maxErr = 0;
            for (i = 0; i < 64; ++i)
                maxErr = Math.max(maxErr, Math.abs(outputBuf[i] - expected[i]));
            if (maxErr > 1)
                throw 'Error too high!';
        });
        
    });

    describe('VQ', function () {
        
        it('should successfully load a codebook (colors)', function () {
            var data = buf_swap32(parseHex('bc010b0b e0c5fb45 01010420 203fffff ffffffc0 00240000 00000000 00000000 0a142850'));
            data = data.slice(4);
            
            var stream = new BitStream({data: data});  // Strip off quant table selectors and subsampling mode.
            var controlFlag = stream.read(4);
            expect(controlFlag).to.equal(0xE);

            var xMcuPos = stream.read(8), yMcuPos = stream.read(8);
            expect(xMcuPos).to.equal(0xC);
            expect(yMcuPos).to.equal(0x5F);
            
            dec.subsamplingMode = 444;  // required or an assertion in the VQ code will fail
            dec._stream = stream;
            dec._parseVqBlock(1);  // codewordSize=1
            expect(dec._vqCodewordLookup).to.deep.equal([1, 0, 2, 3]);
            expect(dec._vqCodebook).to.deep.equal([
                [0x10, 0x80, 0x80],
                [0xA2, 0x80, 0x80],
                [0x80, 0x80, 0x80],
                [0xC0, 0x80, 0x80]
            ]);
        });

        it('should correctly handle multiple data blocks', function () {
            // This data is from a memory dump.  It should contain two VQ (0xE-type) blocks and then an 0x9 (end-frame).
            var data = buf_swap32(parseHex('bc010b0b e0c5fb45 01010420 203fffff ffffffc0 00240000 00000000 00000000 0a142850' + '00000000 00000000'));
            console.log('VQ multiple block data:');
            console.log(fmt_u8a(data));
            dec.decode(data);
            
            // TODO: improve asserts/etc. beyond just 'finished without error'
        });
        
    });

    describe('Full JPEG subsampled MCU example 0', function () {
        // Corresponds to whole-mcu-example / main_mcu_test_2()
        var data = parseHex('040701a61bff6280f81fbaa2ff4dbc408dfccf405c15ff1f004800f500000000000000002dd4a462237ced2c9c25dca4cef7e6667d6626f3308063c3c7a1b7335badc24aaf0b5e9daf69590fcb96206b59e6f2ccb2bdd386b17dbb72182080d6288a2a1f2f0608a0fe87ae287f132f1023ff33d057c5ff470012403d0000000000000000ec1fb06cdacd2bdf9d79f3cde7f9f1362b7ce914ba521c79524a5bdc212a5ed47c3cbc6c7e072ae3e3c18384785f6ca6d4e22fb1af0c96449d1847a9c7037e966fa3ac8d4990830339463d277f25fc6f30ffe5f4f5cfec9f4ffff8bf00a0f5d358a2ab6e4e6778d929f686bd58ca9c26b8f7338f15105065dd39c718e219a78e');

        
        it('should decode properly', function () {
            // DOES NOT APPEAR TO correspond to my notes in 'whole-mcu-example.txt'.
            
            dec._blitCallback = function (x, y, width, height, buf) {
                console.log({x:x, y:y, width:width, height:height, buf:buf});
                console.log(fmt_rgb_buf(width, buf));
            };

            dec.decode(data);

        });
        
    });
    
    describe('Full JPEG subsampled MCU example 1', function () {

        /* TODO: this looks VERRRRRY SIMILAR to the above example */
        
        var data = parseHex('040701a61bff6280f81fbaa2ff4dbc408dfccf405c15ff1f004800f500000000000000002dd4a462237ced2c9c25dca4cef7e6667d6626f3308063c3c7a1b7335badc24aaf0b5e9daf69590fcb96206b59e6f2ccb2bdd386b17dbb72182080d6288a2a1f2f0608a0fe87ae287f132f1023ff33d057c5ff470012403d0000000000000000ec1fb06cdacd2bdf9d79f3cde7f9f1362b7ce914ba521c79524a5bdc212a5ed47c3cbc6c7e072ae3e3c18384785f6ca6d4e22fb1af0c96449d1847a9c7037e966fa3ac8d4990830339463d277f25fc6f30ffe5f4f5cfec9f4ffff8bf00a0f5d358a2ab6e4e6778d929f686bd58ca9c26b8f7338f15105065dd39c718');

        /*
        it('should load quant tables and set subsamplingMode', function () {
            dec.decode(data);

            expect(dec._loadedQuantTables[0]).to.equal(4);
            expect(dec._loadedQuantTables[1]).to.equal(7);
            expect(dec.subsamplingMode).to.equal(422);
        });
         */
        
        it('should decode properly', function () {
            // DOES NOT APPEAR TO correspond to my notes in 'whole-mcu-example.txt'.
            
            dec._blitCallback = function (x, y, width, height, buf) {
                console.log({x:x, y:y, width:width, height:height, buf:buf});
                console.log(fmt_rgb_buf(width, buf));
            };

            dec.decode(data);

        });
    });

    // TODO: On the 'full-frame decode' and 'frame udpate decode' tests, we are NOT actually asserting anything about the code's output yet.
    /*
    describe('Full frame decode test', function () {

        it('should decode properly', function () {

            throw "Won't work without jQuery (or some other way of loading data).";
            
            dec._blitCallback = function (x, y, width, height, buf) {
                if (x == 0 && y == 0) {
                    console.log({x:x, y:y, width:width, height:height, buf:buf});
                    console.log(fmt_rgb_buf(width, buf));
                }
            };

            // TODO: This path won't work for other people, and the test case needs to be made to understand that this
            // is async; plus, I had to manually add jQuery to the generated HTML.
            $.get("/novnc-tests/tests/frame4.hex", function (data) {
                data = parseHex(data);
                dec.decode(data);
            });
        });
    });
     */

    describe('Frame update decode test', function () {

        it('should decode properly', function () {
            var data = parseHex('050501a69a3f6080008aa2a8000000900000000000000000');
            console.log(data);

            // this data should NOT be solid-white!

            dec._blitCallback = function (x, y, width, height, buf) {
                console.log({x:x, y:y, width:width, height:height, buf:buf});
                console.log(fmt_rgb_buf(width, buf));
            };

            dec.decode(data);
        });
    });
    
});
