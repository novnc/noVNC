export class AESECBCipher {
    constructor() {
        this._key = null;
        this._jsCipher = null;
    }

    get algorithm() {
        return { name: "AES-ECB" };
    }

    static async importKey(key, _algorithm, extractable, keyUsages) {
        const cipher = new AESECBCipher;
        await cipher._importKey(key, extractable, keyUsages);
        return cipher;
    }

    async _importKey(key, extractable, keyUsages) {
        if (window?.crypto?.subtle) {
            try {
                this._key = await window.crypto.subtle.importKey(
                    "raw", key, { name: "AES-CBC" }, extractable, keyUsages);
                this._jsCipher = null;
                return;
            } catch (_e) {
                // Fall through to JS fallback
            }
        }
        this._key = null;
        this._jsCipher = new JSAESECB(key);
    }

    async encrypt(_algorithm, plaintext) {
        const input = new Uint8Array(plaintext);
        if (input.length % 16 !== 0) {
            return null;
        }

        // WebCrypto fast path
        if (this._key !== null && window?.crypto?.subtle) {
            try {
                const blocks = input.length / 16;
                const out = new Uint8Array(input.length);
                for (let i = 0; i < blocks; i++) {
                    const block = input.slice(i * 16, i * 16 + 16);
                    const enc = await window.crypto.subtle.encrypt({
                        name: "AES-CBC",
                        iv: new Uint8Array(16),
                    }, this._key, block);
                    const truncated = new Uint8Array(enc).slice(0, 16);
                    out.set(truncated, i * 16);
                }
                return out;
            } catch (_e) {
                // Fallback handled below
            }
        }

        // JS fallback for non-secure contexts (no SubtleCrypto)
        if (this._jsCipher !== null) {
            const blocks = input.length / 16;
            const out = new Uint8Array(input.length);
            for (let i = 0; i < blocks; i++) {
                const block = input.slice(i * 16, i * 16 + 16);
                const enc = this._jsCipher.encryptBlock(block);
                out.set(enc, i * 16);
            }
            return out;
        }

        return null;
    }
}

// Minimal AES-128 ECB implementation used as a fallback when SubtleCrypto
// is not available (e.g. non-secure contexts). Only encryption is implemented.
class JSAESECB {
    constructor(keyBytes) {
        if (!(keyBytes instanceof Uint8Array)) {
            throw new Error("AES key must be Uint8Array");
        }
        if (keyBytes.length !== 16) {
            // ARD uses MD5-derived 16-byte key (AES-128)
            throw new Error("Only AES-128 is supported in JS fallback");
        }
        this._sbox = JSAESECB._SBOX;
        this._rcon = JSAESECB._RCON;
        this._roundKeys = this._keyExpansion(keyBytes);
    }

    encryptBlock(block) {
        if (!(block instanceof Uint8Array) || block.length !== 16) {
            throw new Error("AES block must be 16 bytes");
        }
        const state = new Uint8Array(block);
        const rk = this._roundKeys;

        this._addRoundKey(state, rk, 0);
        for (let round = 1; round <= 9; round++) {
            this._subBytes(state);
            this._shiftRows(state);
            this._mixColumns(state);
            this._addRoundKey(state, rk, round);
        }
        this._subBytes(state);
        this._shiftRows(state);
        this._addRoundKey(state, rk, 10);
        return state;
    }

    _addRoundKey(state, roundKeys, round) {
        const offset = round * 16;
        for (let i = 0; i < 16; i++) {
            state[i] ^= roundKeys[offset + i];
        }
    }

    _subBytes(state) {
        const s = this._sbox;
        for (let i = 0; i < 16; i++) {
            state[i] = s[state[i]];
        }
    }

    _shiftRows(state) {
        // Row 0 stays
        // Row 1: shift left by 1
        let t = state[1];
        state[1] = state[5];
        state[5] = state[9];
        state[9] = state[13];
        state[13] = t;
        // Row 2: shift left by 2
        t = state[2];
        let t2 = state[6];
        state[2] = state[10];
        state[6] = state[14];
        state[10] = t;
        state[14] = t2;
        // Row 3: shift left by 3
        t = state[3];
        state[3] = state[15];
        state[15] = state[11];
        state[11] = state[7];
        state[7] = t;
    }

    _mixColumns(state) {
        for (let c = 0; c < 4; c++) {
            const i = c * 4;
            const a0 = state[i];
            const a1 = state[i + 1];
            const a2 = state[i + 2];
            const a3 = state[i + 3];
            const a0x = JSAESECB._xtime(a0);
            const a1x = JSAESECB._xtime(a1);
            const a2x = JSAESECB._xtime(a2);
            const a3x = JSAESECB._xtime(a3);
            state[i]     = a0x ^ (a1 ^ a1x) ^ a2 ^ a3;
            state[i + 1] = a0 ^ a1x ^ (a2 ^ a2x) ^ a3;
            state[i + 2] = a0 ^ a1 ^ a2x ^ (a3 ^ a3x);
            state[i + 3] = (a0 ^ a0x) ^ a1 ^ a2 ^ a3x;
        }
    }

    _keyExpansion(key) {
        const sbox = this._sbox;
        const rcon = this._rcon;
        const w = new Uint8Array(176); // 11 * 16
        // first 16 bytes are the key
        w.set(key);
        let bytesGenerated = 16;
        let rconIter = 1;
        const temp = new Uint8Array(4);
        while (bytesGenerated < 176) {
            for (let i = 0; i < 4; i++) {
                temp[i] = w[bytesGenerated - 4 + i];
            }
            if (bytesGenerated % 16 === 0) {
                // RotWord
                const t = temp[0];
                temp[0] = temp[1];
                temp[1] = temp[2];
                temp[2] = temp[3];
                temp[3] = t;
                // SubWord
                for (let i = 0; i < 4; i++) {
                    temp[i] = sbox[temp[i]];
                }
                temp[0] ^= rcon[rconIter++];
            }
            for (let i = 0; i < 4; i++) {
                w[bytesGenerated] = w[bytesGenerated - 16] ^ temp[i];
                bytesGenerated++;
            }
        }
        return w;
    }

    static _xtime(a) {
        return ((a << 1) & 0xff) ^ ((a & 0x80) ? 0x1b : 0x00);
    }

    // Precomputed S-box and Rcon tables
    static get _SBOX() {
        return new Uint8Array([
            0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,
            0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,
            0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,
            0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,
            0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,
            0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,
            0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,
            0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,
            0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,
            0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,
            0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,
            0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,
            0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,
            0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,
            0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,
            0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16
        ]);
    }

    static get _RCON() {
        return new Uint8Array([
            0x00,0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80,0x1b,0x36
        ]);
    }
}

export class AESEAXCipher {
    constructor() {
        this._rawKey = null;
        this._ctrKey = null;
        this._cbcKey = null;
        this._zeroBlock = new Uint8Array(16);
        this._prefixBlock0 = this._zeroBlock;
        this._prefixBlock1 = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
        this._prefixBlock2 = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2]);
    }

    get algorithm() {
        return { name: "AES-EAX" };
    }

    async _encryptBlock(block) {
        const encrypted = await window.crypto.subtle.encrypt({
            name: "AES-CBC",
            iv: this._zeroBlock,
        }, this._cbcKey, block);
        return new Uint8Array(encrypted).slice(0, 16);
    }

    async _initCMAC() {
        const k1 = await this._encryptBlock(this._zeroBlock);
        const k2 = new Uint8Array(16);
        const v = k1[0] >>> 6;
        for (let i = 0; i < 15; i++) {
            k2[i] = (k1[i + 1] >> 6) | (k1[i] << 2);
            k1[i] = (k1[i + 1] >> 7) | (k1[i] << 1);
        }
        const lut = [0x0, 0x87, 0x0e, 0x89];
        k2[14] ^= v >>> 1;
        k2[15] = (k1[15] << 2) ^ lut[v];
        k1[15] = (k1[15] << 1) ^ lut[v >> 1];
        this._k1 = k1;
        this._k2 = k2;
    }

    async _encryptCTR(data, counter) {
        const encrypted = await window.crypto.subtle.encrypt({
            name: "AES-CTR",
            counter: counter,
            length: 128
        }, this._ctrKey, data);
        return new Uint8Array(encrypted);
    }

    async _decryptCTR(data, counter) {
        const decrypted = await window.crypto.subtle.decrypt({
            name: "AES-CTR",
            counter: counter,
            length: 128
        }, this._ctrKey, data);
        return new Uint8Array(decrypted);
    }

    async _computeCMAC(data, prefixBlock) {
        if (prefixBlock.length !== 16) {
            return null;
        }
        const n = Math.floor(data.length / 16);
        const m = Math.ceil(data.length / 16);
        const r = data.length - n * 16;
        const cbcData = new Uint8Array((m + 1) * 16);
        cbcData.set(prefixBlock);
        cbcData.set(data, 16);
        if (r === 0) {
            for (let i = 0; i < 16; i++) {
                cbcData[n * 16 + i] ^= this._k1[i];
            }
        } else {
            cbcData[(n + 1) * 16 + r] = 0x80;
            for (let i = 0; i < 16; i++) {
                cbcData[(n + 1) * 16 + i] ^= this._k2[i];
            }
        }
        let cbcEncrypted = await window.crypto.subtle.encrypt({
            name: "AES-CBC",
            iv: this._zeroBlock,
        }, this._cbcKey, cbcData);

        cbcEncrypted = new Uint8Array(cbcEncrypted);
        const mac = cbcEncrypted.slice(cbcEncrypted.length - 32, cbcEncrypted.length - 16);
        return mac;
    }

    static async importKey(key, _algorithm, _extractable, _keyUsages) {
        const cipher = new AESEAXCipher;
        await cipher._importKey(key);
        return cipher;
    }

    async _importKey(key) {
        this._rawKey = key;
        this._ctrKey = await window.crypto.subtle.importKey(
            "raw", key, {name: "AES-CTR"}, false, ["encrypt", "decrypt"]);
        this._cbcKey = await window.crypto.subtle.importKey(
            "raw", key, {name: "AES-CBC"}, false, ["encrypt"]);
        await this._initCMAC();
    }

    async encrypt(algorithm, message) {
        const ad = algorithm.additionalData;
        const nonce = algorithm.iv;
        const nCMAC = await this._computeCMAC(nonce, this._prefixBlock0);
        const encrypted = await this._encryptCTR(message, nCMAC);
        const adCMAC = await this._computeCMAC(ad, this._prefixBlock1);
        const mac = await this._computeCMAC(encrypted, this._prefixBlock2);
        for (let i = 0; i < 16; i++) {
            mac[i] ^= nCMAC[i] ^ adCMAC[i];
        }
        const res = new Uint8Array(16 + encrypted.length);
        res.set(encrypted);
        res.set(mac, encrypted.length);
        return res;
    }

    async decrypt(algorithm, data) {
        const encrypted = data.slice(0, data.length - 16);
        const ad = algorithm.additionalData;
        const nonce = algorithm.iv;
        const mac = data.slice(data.length - 16);
        const nCMAC = await this._computeCMAC(nonce, this._prefixBlock0);
        const adCMAC = await this._computeCMAC(ad, this._prefixBlock1);
        const computedMac = await this._computeCMAC(encrypted, this._prefixBlock2);
        for (let i = 0; i < 16; i++) {
            computedMac[i] ^= nCMAC[i] ^ adCMAC[i];
        }
        if (computedMac.length !== mac.length) {
            return null;
        }
        for (let i = 0; i < mac.length; i++) {
            if (computedMac[i] !== mac[i]) {
                return null;
            }
        }
        const res = await this._decryptCTR(encrypted, nCMAC);
        return res;
    }
}
