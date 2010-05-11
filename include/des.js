/*
 * Ported from Flashlight VNC ActionScript implementation:
 *     http://www.wizhelp.com/flashlight-vnc/
 *
 * Full attribution follows:
 *
 * -------------------------------------------------------------------------
 *
 * This DES class has been extracted from package Acme.Crypto for use in VNC.
 * The bytebit[] array has been reversed so that the most significant bit
 * in each byte of the key is ignored, not the least significant.  Also the
 * unnecessary odd parity code has been removed.
 *
 * These changes are:
 *  Copyright (C) 1999 AT&T Laboratories Cambridge.  All Rights Reserved.
 *
 * This software is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 *

 * DesCipher - the DES encryption method
 *
 * The meat of this code is by Dave Zimmerman <dzimm@widget.com>, and is:
 *
 * Copyright (c) 1996 Widget Workshop, Inc. All Rights Reserved.
 *
 * Permission to use, copy, modify, and distribute this software
 * and its documentation for NON-COMMERCIAL or COMMERCIAL purposes and
 * without fee is hereby granted, provided that this copyright notice is kept 
 * intact. 
 * 
 * WIDGET WORKSHOP MAKES NO REPRESENTATIONS OR WARRANTIES ABOUT THE SUITABILITY
 * OF THE SOFTWARE, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
 * TO THE IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
 * PARTICULAR PURPOSE, OR NON-INFRINGEMENT. WIDGET WORKSHOP SHALL NOT BE LIABLE
 * FOR ANY DAMAGES SUFFERED BY LICENSEE AS A RESULT OF USING, MODIFYING OR
 * DISTRIBUTING THIS SOFTWARE OR ITS DERIVATIVES.
 * 
 * THIS SOFTWARE IS NOT DESIGNED OR INTENDED FOR USE OR RESALE AS ON-LINE
 * CONTROL EQUIPMENT IN HAZARDOUS ENVIRONMENTS REQUIRING FAIL-SAFE
 * PERFORMANCE, SUCH AS IN THE OPERATION OF NUCLEAR FACILITIES, AIRCRAFT
 * NAVIGATION OR COMMUNICATION SYSTEMS, AIR TRAFFIC CONTROL, DIRECT LIFE
 * SUPPORT MACHINES, OR WEAPONS SYSTEMS, IN WHICH THE FAILURE OF THE
 * SOFTWARE COULD LEAD DIRECTLY TO DEATH, PERSONAL INJURY, OR SEVERE
 * PHYSICAL OR ENVIRONMENTAL DAMAGE ("HIGH RISK ACTIVITIES").  WIDGET WORKSHOP
 * SPECIFICALLY DISCLAIMS ANY EXPRESS OR IMPLIED WARRANTY OF FITNESS FOR
 * HIGH RISK ACTIVITIES.
 *
 *
 * The rest is:
 *
 * Copyright (C) 1996 by Jef Poskanzer <jef@acme.com>.  All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR AND CONTRIBUTORS ``AS IS'' AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED.  IN NO EVENT SHALL THE AUTHOR OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS
 * OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
 * HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
 * LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY
 * OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
 * SUCH DAMAGE.
 *
 * Visit the ACME Labs Java page for up-to-date versions of this and other
 * fine Java utilities: http://www.acme.com/java/
 */

DES = {

    // Tables, permutations, S-boxes, etc.

    bytebit : [0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80],
    bigbyte : [ 0x800000, 0x400000, 0x200000, 0x100000,
        0x080000, 0x040000, 0x020000, 0x010000, 0x008000, 0x004000,
        0x002000, 0x001000, 0x000800, 0x000400, 0x000200, 0x000100,
        0x000080, 0x000040, 0x000020, 0x000010, 0x000008, 0x000004,
        0x000002, 0x000001],
    pc1 : [ 56, 48, 40, 32,
        24, 16, 8, 0, 57, 49,
        41, 33, 25, 17, 9, 1,
        58, 50, 42, 34, 26, 18,
        10, 2, 59, 51, 43, 35,
        62, 54, 46, 38, 30, 22,
        14, 6, 61, 53, 45, 37,
        29, 21, 13, 5, 60, 52,
        44, 36, 28, 20, 12, 4,
        27, 19, 11, 3 ],
    totrot : [ 1, 2, 4, 6, 8, 10, 12, 14, 15, 17, 19, 21,
        23, 25, 27, 28],
    pc2 : [ 13, 16, 10, 23,
        0, 4, 2, 27, 14, 5,
        20, 9, 22, 18, 11, 3,
        25, 7, 15, 6, 26, 19,
        12, 1, 40, 51, 30, 36,
        46, 54, 29, 39, 50, 44,
        32, 47, 43, 48, 38, 55,
        33, 52, 45, 41, 49, 35,
        28, 31, ],
    SP1 : [ 0x01010400, 0x00000000, 0x00010000,
        0x01010404, 0x01010004, 0x00010404, 0x00000004, 0x00010000,
        0x00000400, 0x01010400, 0x01010404, 0x00000400, 0x01000404,
        0x01010004, 0x01000000, 0x00000004, 0x00000404, 0x01000400,
        0x01000400, 0x00010400, 0x00010400, 0x01010000, 0x01010000,
        0x01000404, 0x00010004, 0x01000004, 0x01000004, 0x00010004,
        0x00000000, 0x00000404, 0x00010404, 0x01000000, 0x00010000,
        0x01010404, 0x00000004, 0x01010000, 0x01010400, 0x01000000,
        0x01000000, 0x00000400, 0x01010004, 0x00010000, 0x00010400,
        0x01000004, 0x00000400, 0x00000004, 0x01000404, 0x00010404,
        0x01010404, 0x00010004, 0x01010000, 0x01000404, 0x01000004,
        0x00000404, 0x00010404, 0x01010400, 0x00000404, 0x01000400,
        0x01000400, 0x00000000, 0x00010004, 0x00010400, 0x00000000,
        0x01010004],
    SP2 : [ 0x80108020, 0x80008000, 0x00008000,
        0x00108020, 0x00100000, 0x00000020, 0x80100020, 0x80008020,
        0x80000020, 0x80108020, 0x80108000, 0x80000000, 0x80008000,
        0x00100000, 0x00000020, 0x80100020, 0x00108000, 0x00100020,
        0x80008020, 0x00000000, 0x80000000, 0x00008000, 0x00108020,
        0x80100000, 0x00100020, 0x80000020, 0x00000000, 0x00108000,
        0x00008020, 0x80108000, 0x80100000, 0x00008020, 0x00000000,
        0x00108020, 0x80100020, 0x00100000, 0x80008020, 0x80100000,
        0x80108000, 0x00008000, 0x80100000, 0x80008000, 0x00000020,
        0x80108020, 0x00108020, 0x00000020, 0x00008000, 0x80000000,
        0x00008020, 0x80108000, 0x00100000, 0x80000020, 0x00100020,
        0x80008020, 0x80000020, 0x00100020, 0x00108000, 0x00000000,
        0x80008000, 0x00008020, 0x80000000, 0x80100020, 0x80108020,
        0x00108000],
    SP3 : [ 0x00000208, 0x08020200, 0x00000000,
        0x08020008, 0x08000200, 0x00000000, 0x00020208, 0x08000200,
        0x00020008, 0x08000008, 0x08000008, 0x00020000, 0x08020208,
        0x00020008, 0x08020000, 0x00000208, 0x08000000, 0x00000008,
        0x08020200, 0x00000200, 0x00020200, 0x08020000, 0x08020008,
        0x00020208, 0x08000208, 0x00020200, 0x00020000, 0x08000208,
        0x00000008, 0x08020208, 0x00000200, 0x08000000, 0x08020200,
        0x08000000, 0x00020008, 0x00000208, 0x00020000, 0x08020200,
        0x08000200, 0x00000000, 0x00000200, 0x00020008, 0x08020208,
        0x08000200, 0x08000008, 0x00000200, 0x00000000, 0x08020008,
        0x08000208, 0x00020000, 0x08000000, 0x08020208, 0x00000008,
        0x00020208, 0x00020200, 0x08000008, 0x08020000, 0x08000208,
        0x00000208, 0x08020000, 0x00020208, 0x00000008, 0x08020008,
        0x00020200],
    SP4 : [ 0x00802001, 0x00002081, 0x00002081,
        0x00000080, 0x00802080, 0x00800081, 0x00800001, 0x00002001,
        0x00000000, 0x00802000, 0x00802000, 0x00802081, 0x00000081,
        0x00000000, 0x00800080, 0x00800001, 0x00000001, 0x00002000,
        0x00800000, 0x00802001, 0x00000080, 0x00800000, 0x00002001,
        0x00002080, 0x00800081, 0x00000001, 0x00002080, 0x00800080,
        0x00002000, 0x00802080, 0x00802081, 0x00000081, 0x00800080,
        0x00800001, 0x00802000, 0x00802081, 0x00000081, 0x00000000,
        0x00000000, 0x00802000, 0x00002080, 0x00800080, 0x00800081,
        0x00000001, 0x00802001, 0x00002081, 0x00002081, 0x00000080,
        0x00802081, 0x00000081, 0x00000001, 0x00002000, 0x00800001,
        0x00002001, 0x00802080, 0x00800081, 0x00002001, 0x00002080,
        0x00800000, 0x00802001, 0x00000080, 0x00800000, 0x00002000,
        0x00802080],
    SP5 : [ 0x00000100, 0x02080100, 0x02080000,
        0x42000100, 0x00080000, 0x00000100, 0x40000000, 0x02080000,
        0x40080100, 0x00080000, 0x02000100, 0x40080100, 0x42000100,
        0x42080000, 0x00080100, 0x40000000, 0x02000000, 0x40080000,
        0x40080000, 0x00000000, 0x40000100, 0x42080100, 0x42080100,
        0x02000100, 0x42080000, 0x40000100, 0x00000000, 0x42000000,
        0x02080100, 0x02000000, 0x42000000, 0x00080100, 0x00080000,
        0x42000100, 0x00000100, 0x02000000, 0x40000000, 0x02080000,
        0x42000100, 0x40080100, 0x02000100, 0x40000000, 0x42080000,
        0x02080100, 0x40080100, 0x00000100, 0x02000000, 0x42080000,
        0x42080100, 0x00080100, 0x42000000, 0x42080100, 0x02080000,
        0x00000000, 0x40080000, 0x42000000, 0x00080100, 0x02000100,
        0x40000100, 0x00080000, 0x00000000, 0x40080000, 0x02080100,
        0x40000100],
    SP6 : [ 0x20000010, 0x20400000, 0x00004000,
        0x20404010, 0x20400000, 0x00000010, 0x20404010, 0x00400000,
        0x20004000, 0x00404010, 0x00400000, 0x20000010, 0x00400010,
        0x20004000, 0x20000000, 0x00004010, 0x00000000, 0x00400010,
        0x20004010, 0x00004000, 0x00404000, 0x20004010, 0x00000010,
        0x20400010, 0x20400010, 0x00000000, 0x00404010, 0x20404000,
        0x00004010, 0x00404000, 0x20404000, 0x20000000, 0x20004000,
        0x00000010, 0x20400010, 0x00404000, 0x20404010, 0x00400000,
        0x00004010, 0x20000010, 0x00400000, 0x20004000, 0x20000000,
        0x00004010, 0x20000010, 0x20404010, 0x00404000, 0x20400000,
        0x00404010, 0x20404000, 0x00000000, 0x20400010, 0x00000010,
        0x00004000, 0x20400000, 0x00404010, 0x00004000, 0x00400010,
        0x20004010, 0x00000000, 0x20404000, 0x20000000, 0x00400010,
        0x20004010],
    SP7 : [ 0x00200000, 0x04200002, 0x04000802,
        0x00000000, 0x00000800, 0x04000802, 0x00200802, 0x04200800,
        0x04200802, 0x00200000, 0x00000000, 0x04000002, 0x00000002,
        0x04000000, 0x04200002, 0x00000802, 0x04000800, 0x00200802,
        0x00200002, 0x04000800, 0x04000002, 0x04200000, 0x04200800,
        0x00200002, 0x04200000, 0x00000800, 0x00000802, 0x04200802,
        0x00200800, 0x00000002, 0x04000000, 0x00200800, 0x04000000,
        0x00200800, 0x00200000, 0x04000802, 0x04000802, 0x04200002,
        0x04200002, 0x00000002, 0x00200002, 0x04000000, 0x04000800,
        0x00200000, 0x04200800, 0x00000802, 0x00200802, 0x04200800,
        0x00000802, 0x04000002, 0x04200802, 0x04200000, 0x00200800,
        0x00000000, 0x00000002, 0x04200802, 0x00000000, 0x00200802,
        0x04200000, 0x00000800, 0x04000002, 0x04000800, 0x00000800,
        0x00200002],
    SP8 : [ 0x10001040, 0x00001000, 0x00040000,
        0x10041040, 0x10000000, 0x10001040, 0x00000040, 0x10000000,
        0x00040040, 0x10040000, 0x10041040, 0x00041000, 0x10041000,
        0x00041040, 0x00001000, 0x00000040, 0x10040000, 0x10000040,
        0x10001000, 0x00001040, 0x00041000, 0x00040040, 0x10040040,
        0x10041000, 0x00001040, 0x00000000, 0x00000000, 0x10040040,
        0x10000040, 0x10001000, 0x00041040, 0x00040000, 0x00041040,
        0x00040000, 0x10041000, 0x00001000, 0x00000040, 0x10040040,
        0x00001000, 0x00041040, 0x10001000, 0x00000040, 0x10000040,
        0x10040000, 0x10040040, 0x10000000, 0x00040000, 0x10001040,
        0x00000000, 0x10041040, 0x00040040, 0x10000040, 0x10040000,
        0x10001000, 0x10001040, 0x00000000, 0x10041040, 0x00041000,
        0x00041000, 0x00001040, 0x00001040, 0x00040040, 0x10000000,
        0x10041000],

    // Key routines.

    encryptKeys : [],
    decryptKeys : [],

    // / Set the key.
    setKeys : function(key) {
        DES.encryptKeys = new Array(32);
        DES.decryptKeys = new Array(32);
            
        DES.deskey(key, true, DES.encryptKeys);
        DES.deskey(key, false, DES.decryptKeys);
    },

    // Turn an 8-byte key into internal keys.
    deskey : function(keyBlock, encrypting, KnL) {
        var i, j, l, m, n;
        var pc1m = new Array(56);
        var pcr = new Array(56);
        var kn = new Array(32);

        for (j = 0; j < 56; ++j) {
            l = DES.pc1[j];
            m = l & 07;
            pc1m[j] = ((keyBlock[l >>> 3] & DES.bytebit[m]) != 0) ? 1: 0;
        }

        for (i = 0; i < 16; ++i) {
            if (encrypting)
                m = i << 1;
            else
                m = (15- i) << 1;
            n = m + 1;
            kn[m] = kn[n] = 0;
            for (j = 0; j < 28; ++j) {
                l = j + DES.totrot[i];
                if (l < 28)
                    pcr[j] = pc1m[l];
                else
                    pcr[j] = pc1m[l - 28];
            }
            for (j = 28; j < 56; ++j) {
                l = j + DES.totrot[i];
                if (l < 56)
                    pcr[j] = pc1m[l];
                else
                    pcr[j] = pc1m[l - 28];
            }
            for (j = 0; j < 24; ++j) {
                if (pcr[DES.pc2[j]] != 0)
                    kn[m] |= DES.bigbyte[j];
                if (pcr[DES.pc2[j + 24]] != 0)
                    kn[n] |= DES.bigbyte[j];
            }
        }
        DES.cookey(kn, KnL);
    },

    cookey: function(raw, KnL) {
        var raw0, raw1;
        var rawi, KnLi;
        var i;

        for (i = 0, rawi = 0, KnLi = 0; i < 16; ++i) {
            raw0 = raw[rawi++];
            raw1 = raw[rawi++];
            KnL[KnLi] = (raw0 & 0x00fc0000) << 6;
            KnL[KnLi] |= (raw0 & 0x00000fc0) << 10;
            KnL[KnLi] |= (raw1 & 0x00fc0000) >>> 10;
            KnL[KnLi] |= (raw1 & 0x00000fc0) >>> 6;
            ++KnLi;
            KnL[KnLi] = (raw0 & 0x0003f000) << 12;
            KnL[KnLi] |= (raw0 & 0x0000003f) << 16;
            KnL[KnLi] |= (raw1 & 0x0003f000) >>> 4;
            KnL[KnLi] |= (raw1 & 0x0000003f);
            ++KnLi;
        }
    },

    // Block encryption routines.

    // / Encrypt a block of eight bytes.
    encrypt: function(clearText, clearOff, cipherText, cipherOff) {
        var tempInts = new Array(12);
        DES.squashBytesToInts(clearText, clearOff, tempInts, 0, 2);
        DES.des(tempInts, tempInts, DES.encryptKeys);
        DES.spreadIntsToBytes(tempInts, 0, cipherText, cipherOff, 2);
    },

    // / Decrypt a block of eight bytes.
    decrypt: function(cipherText, cipherOff, clearText, clearOff) {
        var tempInts = new Array(12);
        DES.squashBytesToInts(cipherText, cipherOff, tempInts, 0, 2);
        DES.des(tempInts, tempInts, DES.decryptKeys);
        DES.spreadIntsToBytes(tempInts, 0, clearText, clearOff, 2);
    },

    // The DES function.
    des: function(inInts, outInts, keys) {
        var fval, work, right, leftt;
        var round;
        var keysi = 0;

        leftt = inInts[0];
        right = inInts[1];

        work = ((leftt >>> 4) ^ right) & 0x0f0f0f0f;
        right ^= work;
        leftt ^= (work << 4);

        work = ((leftt >>> 16) ^ right) & 0x0000ffff;
        right ^= work;
        leftt ^= (work << 16);

        work = ((right >>> 2) ^ leftt) & 0x33333333;
        leftt ^= work;
        right ^= (work << 2);

        work = ((right >>> 8) ^ leftt) & 0x00ff00ff;
        leftt ^= work;
        right ^= (work << 8);
        right = (right << 1) | ((right >>> 31) & 1);

        work = (leftt ^ right) & 0xaaaaaaaa;
        leftt ^= work;
        right ^= work;
        leftt = (leftt << 1) | ((leftt >>> 31) & 1);

        for (round = 0; round < 8; ++round) {
            work = (right << 28) | (right >>> 4);
            work ^= keys[keysi++];
            fval =  DES.SP7[work & 0x0000003f];
            fval |= DES.SP5[(work >>> 8) & 0x0000003f];
            fval |= DES.SP3[(work >>> 16) & 0x0000003f];
            fval |= DES.SP1[(work >>> 24) & 0x0000003f];
            work = right ^ keys[keysi++];
            fval |= DES.SP8[work & 0x0000003f];
            fval |= DES.SP6[(work >>> 8) & 0x0000003f];
            fval |= DES.SP4[(work >>> 16) & 0x0000003f];
            fval |= DES.SP2[(work >>> 24) & 0x0000003f];
            leftt ^= fval;
            work = (leftt << 28) | (leftt >>> 4);
            work ^= keys[keysi++];
            fval =  DES.SP7[work & 0x0000003f];
            fval |= DES.SP5[(work >>> 8) & 0x0000003f];
            fval |= DES.SP3[(work >>> 16) & 0x0000003f];
            fval |= DES.SP1[(work >>> 24) & 0x0000003f];
            work = leftt ^ keys[keysi++];
            fval |= DES.SP8[work & 0x0000003f];
            fval |= DES.SP6[(work >>> 8) & 0x0000003f];
            fval |= DES.SP4[(work >>> 16) & 0x0000003f];
            fval |= DES.SP2[(work >>> 24) & 0x0000003f];
            right ^= fval;
        }

        right = (right << 31) | (right >>> 1);
        work = (leftt ^ right) & 0xaaaaaaaa;
        leftt ^= work;
        right ^= work;
        leftt = (leftt << 31) | (leftt >>> 1);
        work = ((leftt >>> 8) ^ right) & 0x00ff00ff;
        right ^= work;
        leftt ^= (work << 8);
        work = ((leftt >>> 2) ^ right) & 0x33333333;
        right ^= work;
        leftt ^= (work << 2);
        work = ((right >>> 16) ^ leftt) & 0x0000ffff;
        leftt ^= work;
        right ^= (work << 16);
        work = ((right >>> 4) ^ leftt) & 0x0f0f0f0f;
        leftt ^= work;
        right ^= (work << 4);
        outInts[0] = right;
        outInts[1] = leftt;
    },

    // Routines taken from other parts of the Acme utilities.

    // / Squash bytes down to ints.
    squashBytesToInts: function (inBytes, inOff, outInts, outOff, intLen) {
        for (var i = 0; i < intLen; ++i)
            outInts[outOff + i] = ((inBytes[inOff + i * 4] & 0xff) << 24)
                    | ((inBytes[inOff + i * 4+ 1] & 0xff) << 16)
                    | ((inBytes[inOff + i * 4+ 2] & 0xff) << 8)
                    | (inBytes[inOff + i * 4+ 3] & 0xff);
    },

    // / Spread ints into unsigned bytes.
    spreadIntsToBytes: function (inInts, inOff, outBytes, outOff, intLen) {
        for (var i = 0; i < intLen; ++i) {
            outBytes[outOff + i * 4] =    (inInts[inOff + i] >>> 24) % 256;
            outBytes[outOff + i * 4+ 1] = (inInts[inOff + i] >>> 16) % 256;
            outBytes[outOff + i * 4+ 2] = (inInts[inOff + i] >>> 8) % 256;
            outBytes[outOff + i * 4+ 3] = (inInts[inOff + i]) % 256;
        }
        /* Make unsigned */
        var idx;
        for (var i = 0; i < intLen; ++i) {
            for (var j = 0; j < 4; j++) {
                idx = outOff + i * 4 + j;
                if (outBytes[idx] < 0) {
                    outBytes[idx] += 256;
                }
            }
        }
    }

}
