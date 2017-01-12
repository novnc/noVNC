"use strict";
/*global DCTSIZE, DCTSIZE2, JpegHuffmanTable, BitStream, AST2100IDCT, AAN_IDCT_SCALING_FACTORS, ZIGZAG_ORDER */
/*global ATEN_QT_LUMA, ATEN_QT_CHROMA, TABLE_CLASS_AC, TABLE_CLASS_DC */
/*global BITS_AC_LUMA, BITS_AC_CHROMA, BITS_DC_LUMA, BITS_DC_CHROMA, HUFFVAL_AC_LUMA, HUFFVAL_AC_CHROMA, HUFFVAL_DC_LUMA, HUFFVAL_DC_CHROMA */
/*global inRangeIncl, isEmpty */
/*global fmt_u8a, fmt_u8, fmt_u16 */

/*
(c) Copyright 2015-2017 Kevin Kelley <kelleyk@kelleyk.net>.

This implementation is the product of clean-room reverse engineering (that is, I
am not and have never been subject to enondisclosure agreements, nor have I had
access to proprietary information, related to the subject matter of this
project).
*/

var verboseDebug = false;
var verboseMcuCount = false;
var traceUpdates = false;
var verboseStats = false;
var verboseVideoSettings = true;


var Ast2100Decoder;


(function () {
    "use strict";
    
    Ast2100Decoder = function (defaults) {

        this._blitCallback = defaults.blitCallback;
        this._videoSettingsChangedCallback = defaults.videoSettingsChangedCallback;
        this._frame_width = defaults.width;
        this._frame_height = defaults.height;

        if (!this._frame_width || !this._frame_height)
            throw 'Missing required parameter: width, height';

        // Either 444u or 422u (though the "422" mode is really 4:2:0, where
        // chroma is subsampled by a factor of two in each direction)..  Applies
        // only to JPEG-ish blocks, not to VQ blocks; but VQ blocks seem to only
        // appear in 4:4:4 color mode.
        this.subsamplingMode = -1;
        
        this.quantTables = [new Int32Array(64), new Int32Array(64)];
        this._loadedQuantTables = [-1, -1];

        this.huffTables = [
            [new JpegHuffmanTable({bits: BITS_DC_LUMA, huffval: HUFFVAL_DC_LUMA}),
             new JpegHuffmanTable({bits: BITS_DC_CHROMA, huffval: HUFFVAL_DC_CHROMA})],
            [new JpegHuffmanTable({bits: BITS_AC_LUMA, huffval: HUFFVAL_AC_LUMA}),
             new JpegHuffmanTable({bits: BITS_AC_CHROMA, huffval: HUFFVAL_AC_CHROMA})],
        ];
        
        this._scan_components = [
            {huffTableSelectorDC: 0, huffTableSelectorAC: 0},  // Y
            {huffTableSelectorDC: 1, huffTableSelectorAC: 1},  // Cb
            {huffTableSelectorDC: 1, huffTableSelectorAC: 1}   // Cr
        ];
        this._scan_prev_dc = [0, 0, 0];

        this._mcuPosX = 0;
        this._mcuPosY = 0;

        this._initializeVq();

        // Allocate memory here once and then re-use it.  These buffers store
        // data after entropy decoding (Huffman, zigzag) and before we dequant
        // and apply the IDCT.
        this._tmpBufY = [
            new Int16Array(DCTSIZE2),
            new Int16Array(DCTSIZE2),
            new Int16Array(DCTSIZE2),
            new Int16Array(DCTSIZE2)];
        this._tmpBufCb = new Int16Array(DCTSIZE2);
        this._tmpBufCr = new Int16Array(DCTSIZE2);

        // These buffers store IDCT output.
        this._componentBufY = [
            new Uint8Array(DCTSIZE2),
            new Uint8Array(DCTSIZE2),
            new Uint8Array(DCTSIZE2),
            new Uint8Array(DCTSIZE2)];
        this._componentBufCb = new Uint8Array(DCTSIZE2);
        this._componentBufCr = new Uint8Array(DCTSIZE2);
        
        // The final RGB output goes here; noVNC expects each group of four
        // elements to represent one RGBA pixel.  this._outputBuf = new
        // Uint8Array(DCTSIZE2 * 4);
        this._outputBuf = new Uint8Array(DCTSIZE2 * 4);
        
    };

    Ast2100Decoder.prototype = {

        // TODO: Could/should remove this indirection.
        _idct: function (quant_table, data_unit, dstBuf) {
            if (!quant_table)
                throw 'Required argument missing: quant_table';
            if (!data_unit)
                throw 'Required argument missing: data_unit';
            if (!dstBuf)
                throw 'Required argument missing: dstBuf';
                
            return AST2100IDCT.idct_fixed_aan(quant_table, data_unit, dstBuf);
        },

        _getMcuSize: function () {
            return {444: 8, 422: 16}[this.subsamplingMode];
        },

        // Bakes in C(u)*C(v) and the cosine terms (from the IDCT formula).
        _loadQuantTable: function (slot, srcTable) {
            for (var y = 0; y < 8; ++y) {
                for (var x = 0; x < 8; ++x) {
                    this.quantTables[slot][y*8+x] = ~~(srcTable[y*8+x] * AAN_IDCT_SCALING_FACTORS[x] * AAN_IDCT_SCALING_FACTORS[y] * 65536.0);
                }
            }
        },

        _initializeVq: function () {
            // These colors are in YCbCr, so they're just black, white, and two
            // shades of grey.
            this._vqCodewordLookup = [0, 1, 2, 3];
            this._vqCodebook = [
                [0x00, 0x80, 0x80],
                [0xFF, 0x80, 0x80],
                [0x80, 0x80, 0x80],
                [0xC0, 0x80, 0x80]
            ];
        },

        // Update our position variables to point at the next MCU.
        _advancePosition: function () {
            var mcuSize = this._getMcuSize();
            var widthInMcus = ~~(this._frame_width / mcuSize);
            if (this._frame_width % mcuSize != 0)
                widthInMcus += 1;
            var heightInMcus = ~~(this._frame_height / mcuSize);
            if (this._frame_height % mcuSize != 0)
                heightInMcus += 1;

            this._mcuPosX += 1;
            if (this._mcuPosX >= widthInMcus) {
                this._mcuPosX = 0;
                this._mcuPosY += 1;
            }
            if (this._mcuPosY >= heightInMcus) {
                this._mcuPosY = 0;
            }
        },

        // Change the frame's size.
        setSize: function (width, height) {
            if (this._frame_width != width || this._frame_height != height)
                Util.Debug('Ast2100Decoder: frame height changed to '+width+'x'+height);
            this._frame_width = width;
            this._frame_height = height;
        },

        // Each quant table selector is between 0x0 (lowest quality) and 0xB (highest quality).  The ATEN client shows a
        // single quality slider, which changes both values in tandem.  The server sends all three values with each
        // FramebufferUpdate message, so these values are updated with every call to decode().  They will be -1 before
        // the first frame is decoded.
        getVideoSettings: function () {
            return {
                quantTableSelectorLuma: this._loadedQuantTables[0],
                quantTableSelectorChroma: this._loadedQuantTables[1],
                subsamplingMode: this.subsamplingMode
            };
        },
        
        decode: function (data) {
            
            var mcuIdx = 0;
            if (verboseStats) {
                var blockTypeCounter = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];  // length 16
            }

            // Reset state that must be reset between frames.
            this._scan_prev_dc = [0, 0, 0];
            this._mcuPosX = 0;
            this._mcuPosY = 0;
            
            // First four bytes.
            var quantTableSelectorLuma = data[0];  // 0 <= x <= 0xB
            var quantTableSelectorChroma = data[1];  // 0 <= x <= 0xB
            var subsamplingMode = (data[2] << 8) | data[3];  // 422u or 444u
            
            var changedSettings = false;
            if (this.subsamplingMode != subsamplingMode) {
                if (verboseVideoSettings)
                    console.log('decode(): new subsampling mode: '+subsamplingMode);
                this.subsamplingMode = subsamplingMode;
                changedSettings = true;
            }

            // The remainder of the stream is byte-swapped in four-byte chunks.
            // BitStream takes care of this.
            this._stream = new BitStream({data: data});
            this._stream.skip(16);
            this._stream.skip(16);  // do this in two parts because bits must be < 32; thanks JavaScript!
           
            if (quantTableSelectorLuma != this._loadedQuantTables[0]) {
                if (!inRangeIncl(quantTableSelectorLuma, 0, 0xB))
                    throw 'Out-of-range selector for luma quant table: ' + quantTableSelectorLuma.toString(16);
                if (verboseVideoSettings)
                    console.log('decode(): loading new luma quant table: '+fmt_u8(quantTableSelectorLuma));
                this._loadQuantTable(0, ATEN_QT_LUMA[quantTableSelectorLuma]);
                this._loadedQuantTables[0] = quantTableSelectorLuma;
                changedSettings = true;
            }
            if (quantTableSelectorChroma != this._loadedQuantTables[1]) {
                if (!inRangeIncl(quantTableSelectorChroma, 0, 0xB))
                    throw 'Out-of-range selector for chroma quant table: ' + quantTableSelectorChroma.toString(16);
                if (verboseVideoSettings)
                    console.log('decode(): loading new chroma quant table: '+fmt_u8(quantTableSelectorChroma));
                this._loadQuantTable(1, ATEN_QT_CHROMA[quantTableSelectorChroma]);
                this._loadedQuantTables[1] = quantTableSelectorChroma;
                changedSettings = true;
            }
            
            if (this.subsamplingMode != 422 && this.subsamplingMode != 444)
                throw 'Unexpected value for subsamplingMode: 0x' + fmt_u16(this.subsamplingMode);

            if (changedSettings && this._videoSettingsChangedCallback)
                this._videoSettingsChangedCallback(this.getVideoSettings());
            
            // The remainder of the stream is byte-swapped in four-byte chunks.  BitStream takes care of this.
            this._stream = new BitStream({data: data});
            this._stream.skip(16);
            this._stream.skip(16);  // do this in two parts because bits must be < 32; thanks JavaScript!

            while (true) {
                var controlFlag = this._stream.read(4);  // uint4

                if (verboseStats)
                    ++blockTypeCounter[controlFlag];
                
                if (verboseMcuCount) {
                    console.log('MCU #' + mcuIdx + '- Control flag: ' + controlFlag.toString(16));
                    console.log('  stream pos = ' + this._stream.getPos());
                }

                if (controlFlag == 0 || controlFlag == 4 || controlFlag == 8 || controlFlag == 0xC) {
                    // JPEG-ish (DCT-compressed) data.
                    
                    if (controlFlag == 8 || controlFlag == 0xC) {
                        this._mcuPosX = this._stream.read(8);  // uint8
                        this._mcuPosY = this._stream.read(8);  // uint8
                        if (traceUpdates)
                            console.log("decode(): read new MCU pos: (0x"+fmt_u8(this._mcuPosX)+",0x"+fmt_u8(this._mcuPosY)+")");
                    }

                    if (controlFlag == 4 || controlFlag == 0xC) {
                        // Haven't seen traffic where this feature is used yet.
                        throw 'Unexpected control flag: alternate quant table';
                    }

                    // Since we always have 4:2:2 chroma subsampling on, we'll read 6 blocks (4 Y, 1 Cr, 1 Cb) and
                    // produce a block of 16x16 pixels.
                    this._parseMcu();

                } else if (inRangeIncl(controlFlag, 5, 7) || inRangeIncl(controlFlag, 0xD, 0xF)) {
                    // VQ-compressed data.

                    if (controlFlag >= 0xD) {
                        this._mcuPosX = this._stream.read(8);  // uint8
                        this._mcuPosY = this._stream.read(8);  // uint8
                        if (traceUpdates)
                            console.log("decode(): read new MCU pos: (0x"+fmt_u8(this._mcuPosX)+",0x"+fmt_u8(this._mcuPosY)+")");
                    }

                    var codewordSize = (controlFlag & 7) - 5;  // 0 <= codewordSize <= 2
                    this._parseVqBlock(codewordSize);
                    
                } else if (controlFlag == 9) {
                    // Done with frame!
                    break;
                } else {
                    throw 'Unexpected control flag: unknown value 0x'+fmt_u8(controlFlag);
                }

                ++mcuIdx;
            }

            // The 0x9 "end-of-frame" block is included in this count.
            if (traceUpdates)
                console.log("decode(): finished after "+mcuIdx+" blocks");

            if (verboseStats) {
                var counts = {};
                for (var i = 0; i < 16; ++i)
                    if (i != 9 && blockTypeCounter[i] > 0)
                        counts[i] = blockTypeCounter[i];
                if (!isEmpty(counts))
                    console.log(counts);
            }
            
        },

        // - Always 8x8, since chroma subsampling does not apply to
        //   VQ-compressed data.  (As a consequence, VQ blocks only seem to
        //   appear when DCT chroma subsampling is disabled; that is, in "444"
        //   mode.)
        // - Reads 64 * codewordSize bits from the input stream.
        _parseVqBlock: function (codewordSize) {

            var mcuSize = this._getMcuSize();
            if (mcuSize != 8)
                throw 'Unexpected MCU size for VQ block!';
            if (!inRangeIncl(codewordSize, 0, 2))
                throw 'Out-of-range codewordSize!';

            var i;
            
            var y_buf = this._componentBufY[0];
            var cb_buf = this._componentBufCb;
            var cr_buf = this._componentBufCr;

            var that = this;
            var setColor = function (j, codeword) {
                var color = that._vqCodebook[that._vqCodewordLookup[codeword]];
                y_buf[j] = color[0];
                cb_buf[j] = color[1];
                cr_buf[j] = color[2];
            };

            // Read new codebook data.  (That is: new colors for each of our
            // codewords (the values we'll read from the input data) to map to.)
            for (i = 0; i < (1 << codewordSize); ++i) {
                // Read 1b flag and 2b codebook slot number.  if flag is set,
                // read 24b RGB value and set colors[slot #].  Regardless (?),
                // set the ith codeowrd to map to this slot.
                var hasNewColor = this._stream.read(1);
                var codebookSlotIdx = this._stream.read(2);
                if (hasNewColor) {
                    var color = [this._stream.read(8), this._stream.read(8), this._stream.read(8)];  // Y, Cb, Cr
                    this._vqCodebook[codebookSlotIdx] = color;
                }
                this._vqCodewordLookup[i] = codebookSlotIdx;
            }
            
            // Read a block of image data.
            if (codewordSize == 0) {
                // Act as though we've got a single-entry codebook.
                for (i = 0; i < 64; ++i)
                    setColor(i, 0);
            } else {
                for (i = 0; i < 64; ++i)
                    setColor(i, this._stream.read(codewordSize));
            }

            // Perform colorspace conversion and copy into destination image buffer.
            for (var j = 0; j < 64; ++j)
                this._ycbcrToRgb(this._outputBuf, j, this._componentBufY[0][j], this._componentBufCb[j], this._componentBufCr[j]);
            
            this._blitCallback(8 * this._mcuPosX, 8 * this._mcuPosY, 8, 8, this._outputBuf);

            this._advancePosition();
        },

        _parseMcu: function () {

            var qtLuma = this.quantTables[0];
            var qtChroma = this.quantTables[1];

            this._parseDataUnit(0, this._tmpBufY[0]);
            this._idct(qtLuma, this._tmpBufY[0], this._componentBufY[0]);
            if (this.subsamplingMode != 444) {
                this._parseDataUnit(0, this._tmpBufY[1]);
                this._idct(qtLuma, this._tmpBufY[1], this._componentBufY[1]);
                this._parseDataUnit(0, this._tmpBufY[2]);
                this._idct(qtLuma, this._tmpBufY[2], this._componentBufY[2]);
                this._parseDataUnit(0, this._tmpBufY[3]);
                this._idct(qtLuma, this._tmpBufY[3], this._componentBufY[3]);
            }
            this._parseDataUnit(1, this._tmpBufCb);
            this._idct(qtChroma, this._tmpBufCb, this._componentBufCb);
            this._parseDataUnit(2, this._tmpBufCr);
            this._idct(qtChroma, this._tmpBufCr, this._componentBufCr);

            if (this.subsamplingMode != 444) {
                // 4:2:0 subsampling (x2 in each direction), or what ATEN calls "422" (even though it's not).
                for (var dy = 0; dy < 2; ++ dy) {
                    for (var dx = 0; dx < 2; ++dx) {
                        // for each of the four blocks in this MCU
                        var componentBufY = this._componentBufY[dx*2+dy];
                        for (var y = 0; y < 8; ++y) {
                            for (var x = 0; x < 8; ++x) {
                                var hy = ~~((8*dx+y)/2);
                                var hx = ~~((8*dy+x)/2);
                                this._ycbcrToRgb(this._outputBuf, y*8+x, componentBufY[y*8+x], this._componentBufCb[hy*8+hx], this._componentBufCr[hy*8+hx]);
                            }
                        }
                        this._blitCallback(16 * this._mcuPosX + 8 * dy, 16 * this._mcuPosY + 8 * dx, 8, 8, this._outputBuf);
                    }
                }
            } else {
                // No subsampling.
                for (var j = 0; j < 64; ++j)
                    this._ycbcrToRgb(this._outputBuf, j, this._componentBufY[0][j], this._componentBufCb[j], this._componentBufCr[j]);
                this._blitCallback(8 * this._mcuPosX, 8 * this._mcuPosY, 8, 8, this._outputBuf);
            }
            
            this._advancePosition();
        },
        
        _parseDataUnit: function (componentIdx, buf) {
            var scanComponent = this._scan_components[componentIdx];
            var dc_hufftable = this.huffTables[TABLE_CLASS_DC][scanComponent.huffTableSelectorDC];
            var ac_hufftable = this.huffTables[TABLE_CLASS_AC][scanComponent.huffTableSelectorAC];

            var setValue = function (i, val) {
                buf[ZIGZAG_ORDER[i]] = val;
            };
            
            // First element is the DC component, followed by 63 AC components.
            // The DC component is encoded slightly differently than the AC
            // components: it is stored as the delta between the value and the
            // last DC component from the same component.
            var dc_delta = this._readEncodedValueDC(dc_hufftable);
            this._scan_prev_dc[componentIdx] += dc_delta;
            buf[0] = this._scan_prev_dc[componentIdx];

            // Read the AC components.
            for (var i = 1; i < 64;) {
                var x = ac_hufftable.readCode(this._stream);

                // N.B.(kelleyk): Renamed r, s to runlen, size.
                // See ITU T.81 p89 (e.g. Fig F.1).
                // r is runlength of zeroes; if s==0, r==0 means EOB and r==15
                // means ZRL.  s is number of bits required to represent the
                // amplitude that follows the codeword.
                var runlen = x >>> 4;
                var size = x & 0x0F;

                if (size == 0) {
                    if (runlen == 0) {  // special EOB (end-of-block) codeword; fill remainder with zeroes
                        while (i < 64) {
                            setValue(i, 0);
                            ++i;
                        }
                        break;
                    } else if (runlen == 0xF) {  // special ZLE (zero-length-encode) codeword; emit sixteen zeroes
                        for (var j = 0; j < 16; ++j)
                            setValue(i + j, 0);
                        i += 16;
                        continue;
                    }
                }

                // Emit runlen zero entries.
                for (var j = 0; j < runlen; ++j)
                    setValue(i + j, 0);
                i += runlen;

                setValue(i, this._readEncodedValueAC(size));  // category=size
                i += 1;
            }

            return buf;
        },

        _readEncodedValueDC: function (huffTable) {
            var category = huffTable.readCode(this._stream);
            return this._readEncodedValueAC(category);
        },
        
        _readEncodedValueAC: function (category) {
            if (category == 0)
                return 0;

            var value;  // sint32
            var val_sign = this._stream.read(1);

            if (val_sign == 0) {
                // Negative (unlike the more common two's-complement
                // representation).
                value = -(1 << category) + 1;
            } else {
                value = (1 << category - 1);
            }

            if (category > 1) {
                var more_bits = this._stream.read(category - 1);  // uint
                value += more_bits;
            }

            return value;
        },

        _ycbcrToRgb: function (outputBuf, outputOffset, y, cb, cr) {
            outputOffset *= 4;
            outputBuf[outputOffset + 0] = clamp(YUVTORGB_Y_TABLE[y] + YUVTORGB_CR_R_TABLE[cr]);
            outputBuf[outputOffset + 1] = clamp(YUVTORGB_Y_TABLE[y] + YUVTORGB_CR_G_TABLE[cr] + YUVTORGB_CB_G_TABLE[cb]);
            outputBuf[outputOffset + 2] = clamp(YUVTORGB_Y_TABLE[y] + YUVTORGB_CB_B_TABLE[cb]);
            outputBuf[outputOffset + 3] = 0xFF;  // noVNC expects alpha
        }
        
    };
        
})();
