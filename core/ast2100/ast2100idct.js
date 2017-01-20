/* (c) Copyright 2015-2017 Kevin Kelley <kelleyk@kelleyk.net>. */


var AST2100IDCT;


// N.B.: These values assume CONST_BITS == 8
var FIX_1_082392200 = 277;  // fix(1.082392200)
var FIX_1_414213562 = 362;  // fix(1.414213562)
var FIX_1_847759065 = 473;  // fix(1.847759065)
var FIX_2_613125930 = 669;  // fix(2.613125930)


var MAXJSAMPLE = 255;  // largest value of a sample; 8-bit, so 2**8-1
var CONST_BITS = 8;
var PASS1_BITS = 0;

// This is like clamp() except that it also adds the MAXJSAMPLE/2 offset.
var range_limit = function (x) {
    // XXX(kelleyk): This offset is baked into the range limit table in the ATEN
    // stuff and in libjpeg; see commpent above prepare_range_limit_table() in
    // jdmaster.c.
    x += 128;
    
    return Math.max(0, Math.min(255, x));
};

// Convert float to fixed-point.
var fix = function (x) {
    return ~~(x * (1 << CONST_BITS) + 0.5);
};

var fixed_dequant = function (scaled_quant_table, buf, i) {
    // N.B.: The data in buf is unscaled; the data in scaled_quant_table has
    // been scaled by 1<<16.
    return fixed_mul(scaled_quant_table[i], buf[i]);
};

var descale = function (x, n) {
    // console.log([x, x>>n, (x>>n)+128]);
    return x >> n;
};

// if not accurate rounding mode...
var idescale = descale;
// else use better implementation

// N.B.(kelleyk): This isn't a libjpeg parameter; it just means that ATEN
// downshifts all the way back to "normal ints" at the end of pass 1.
var END_PASS1_DESCALE_BITS = CONST_BITS;

var fixed_mul = function (a, b) {
    return descale(a * b, CONST_BITS);
};


(function () {
    "use strict";

    AST2100IDCT = {

        // Uses the 16/16 integer representation that ATEN and libjpeg's
        // jidctfst.c ("fast, not-so-accurate integer IDCT") do.  Note that, for
        // performance, this routine *also* incorporates the dequantization
        // step, which is why it takes scaled_quant_table as an argument.  (This
        // argument does not actually contain "just" a scaled quant table; some
        // constants have been pre-multiplied into it.  See the function that
        // loads quant tables for more details.)
        idct_fixed_aan: function (scaled_quant_table, buf, dstBuf) {

            // ATEN rounds things off early, at a cost to precision: the int32
            // values in 'workspace' are not scaled at all.
            var workspace = new Int32Array(64);
    
            for (var x = 0; x < 8; ++x)
                AST2100IDCT._aan_idct_col(scaled_quant_table, buf, workspace, x);
                
            for (var y = 0; y < 8; ++y)
                AST2100IDCT._aan_idct_row(scaled_quant_table, dstBuf, workspace, y);
                
            return dstBuf;
        },

        // Columns; aka "Pass 1".
        _aan_idct_col: function(scaled_quant_table, buf, workspace, x) {

            var dequant = function (idx) { return fixed_dequant(scaled_quant_table, buf, idx); };
            var mul = fixed_mul;

            var y;

            var all_ac_zero = true;
            for (y = 1; y < 8; ++y) {
                if (buf[8 * y + x] != 0) {
                    all_ac_zero = false;
                    break;
                }
            }
            if (all_ac_zero) {
                var raw_dcval = buf[8 * 0 + x];
                var quant_val = scaled_quant_table[8 * 0 + x];
                var dcval = idescale(dequant(8 * 0 + x), END_PASS1_DESCALE_BITS);  // in total, >> 16
                for (y = 0; y < 8; ++y)
                    workspace[8 * y + x] = dcval;
                return;
            }
    
            // Even part.
            var tmp0 = dequant(8 * 0 + x);
            var tmp1 = dequant(8 * 2 + x);
            var tmp2 = dequant(8 * 4 + x);
            var tmp3 = dequant(8 * 6 + x);
            
            var tmp10 = tmp0 + tmp2;  // Phase 3
            var tmp11 = tmp0 - tmp2;

            var tmp13 = tmp1 + tmp3;  // Phases 5-3
            var tmp12 = mul((tmp1 - tmp3), FIX_1_414213562) - tmp13;  // 2 * c4

            tmp0 = tmp10 + tmp13;
            tmp3 = tmp10 - tmp13;
            tmp1 = tmp11 + tmp12;
            tmp2 = tmp11 - tmp12;

            // Odd part.
            var tmp4 = dequant(8 * 1 + x);
            var tmp5 = dequant(8 * 3 + x);
            var tmp6 = dequant(8 * 5 + x);
            var tmp7 = dequant(8 * 7 + x);
            
            var z13 = tmp6 + tmp5;  // Phase 6
            var z10 = tmp6 - tmp5;
            var z11 = tmp4 + tmp7;
            var z12 = tmp4 - tmp7;

            tmp7 = z11 + z13;  // Phase 5
            tmp11 = mul((z11 - z13), FIX_1_414213562);  // 2 * c4
    
            var z5 = mul((z10 + z12), FIX_1_847759065);  // 2 * c2
            tmp10 = mul(FIX_1_082392200, z12) - z5;  // 2 * (c2-c6)
            tmp12 = mul(-FIX_2_613125930, z10) + z5;

            tmp6 = tmp12 - tmp7;
            tmp5 = tmp11 - tmp6;
            tmp4 = tmp10 + tmp5;

            workspace[x + 8 * 0] = idescale(tmp0 + tmp7, END_PASS1_DESCALE_BITS);
            workspace[x + 8 * 7] = idescale(tmp0 - tmp7, END_PASS1_DESCALE_BITS);
            workspace[x + 8 * 1] = idescale(tmp1 + tmp6, END_PASS1_DESCALE_BITS);
            workspace[x + 8 * 6] = idescale(tmp1 - tmp6, END_PASS1_DESCALE_BITS);
            workspace[x + 8 * 2] = idescale(tmp2 + tmp5, END_PASS1_DESCALE_BITS);
            workspace[x + 8 * 5] = idescale(tmp2 - tmp5, END_PASS1_DESCALE_BITS);
            workspace[x + 8 * 4] = idescale(tmp3 + tmp4, END_PASS1_DESCALE_BITS);
            workspace[x + 8 * 3] = idescale(tmp3 - tmp4, END_PASS1_DESCALE_BITS);
            
        },
        
        // Rows; aka "Pass 2".
        _aan_idct_row: function(scaled_quant_table, buf, workspace, y) {

            var wsptr = function (x) { return workspace[8 * y + x]; };
            var mul = fixed_mul;

            // Even part.
            var tmp10 = wsptr(0) + wsptr(4);
            var tmp11 = wsptr(0) - wsptr(4);
            
            var tmp13 = wsptr(2) + wsptr(6);
            var tmp12 = mul((wsptr(2) - wsptr(6)), FIX_1_414213562) - tmp13;

            var tmp0 = tmp10 + tmp13;
            var tmp3 = tmp10 - tmp13;
            var tmp1 = tmp11 + tmp12;
            var tmp2 = tmp11 - tmp12;

            // Odd part.
            var z13 = wsptr(5) + wsptr(3);
            var z10 = wsptr(5) - wsptr(3);
            var z11 = wsptr(1) + wsptr(7);
            var z12 = wsptr(1) - wsptr(7);

            var tmp7 = z11 + z13;
            tmp11 = mul((z11 - z13), FIX_1_414213562);

            var z5 = mul((z10 + z12), FIX_1_847759065);  // 2 * c2
            tmp10 = mul(FIX_1_082392200, z12) - z5;  // 2 * (c2-c6)
            tmp12 = mul(-FIX_2_613125930, z10) + z5;

            var tmp6 = tmp12 - tmp7;
            var tmp5 = tmp11 - tmp6;
            var tmp4 = tmp10 + tmp5;

            var set_out = function (x, val) {
                // Shift right by PASS1_BITS bits to convert back to a normal
                // int, and then by another 3 to divide by 8.
                val = idescale(val, PASS1_BITS + 3);                
                val = range_limit(val);  // This also applies the +128 offset.
                buf[y * 8 + x] = val;
            };
    
            // Final output stage: scale down by a factor of 8 and range-limit
            set_out(0, tmp0 + tmp7);
            set_out(7, tmp0 - tmp7);
            set_out(1, tmp1 + tmp6);
            set_out(6, tmp0 - tmp6);
            set_out(2, tmp2 + tmp5);
            set_out(5, tmp2 - tmp5);
            set_out(4, tmp3 + tmp4);
            set_out(3, tmp3 - tmp4);
        }
        
    };

})();
