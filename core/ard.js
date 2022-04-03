import { encodeUTF8 } from './util/strings.js';
import EventTargetMixin from './util/eventtarget.js';

export class AESBlockCipher {
    constructor() {
        this._key = null;
        this._zeroBlock = new Uint8Array(16);
    }

    async setKey(key) {
        this._key = await window.crypto.subtle.importKey(
            "raw", key, {"name": "AES-CBC"}, false, ["encrypt", "decrypt"]);
    }

    async encrypt(block) {
        const encrypted = await window.crypto.subtle.encrypt({
            name: "AES-CBC",
            iv: this._zeroBlock,
        }, this._key, block);
        return new Uint8Array(encrypted).slice(0, 16);
    }

    async encryptInplace(data, offset) {
        let block = data.slice(offset, offset + 16);
        block = await this.encrypt(block);
        data.set(block, offset);
    }
}

export default class ARDAuthenticationState extends EventTargetMixin {
    constructor(sock, getCredentials) {
        super();
        this._hasStarted = false;
        this._checkSock = null;
        this._checkCredentials = null;
        this._sockReject = null;
        this._credentialsReject = null;
        this._sock = sock;
        this._getCredentials = getCredentials;
    }

    _waitSockAsync(len) {
        return new Promise((resolve, reject) => {
            const hasData = () => !this._sock.rQwait('RA2', len);
            if (hasData()) {
                resolve();
            } else {
                this._checkSock = () => {
                    if (hasData()) {
                        resolve();
                        this._checkSock = null;
                        this._sockReject = null;
                    }
                };
                this._sockReject = reject;
            }
        });
    }

    _waitCredentialsAsync() {
        const hasCredentials = () => (
            this._getCredentials().username !== undefined && this._getCredentials().password !== undefined
        );
        return new Promise((resolve, reject) => {
            if (hasCredentials()) {
                resolve();
            } else {
                this._checkCredentials = () => {
                    if (hasCredentials()) {
                        resolve();
                        this._checkCredentials = null;
                        this._credentialsReject = null;
                    }
                };
                this._credentialsReject = reject;
            }
        });
    }

    _md5(msg) {
        const s = [
            7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
            5,  9, 14, 20, 5,  9, 14, 20, 5,  9, 14, 20, 5,  9, 14, 20,
            4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
            6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
        ];
        const k = [
            0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee,
            0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
            0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
            0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
            0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa,
            0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
            0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
            0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
            0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
            0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
            0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05,
            0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
            0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039,
            0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
            0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
            0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
        ];
        let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
        const length = msg.length + 1;
        const padLength = Math.ceil((length - 56) / 64) * 64 + 64;
        const x = new Uint8Array(padLength);
        x.set(msg);
        x[msg.length] = 0x80;
        let view = new DataView(x.buffer);
        view.setUint32(padLength - 8, msg.length * 8, true);
        for (let i = 0; i < padLength; i += 64) {
            let a = a0, b = b0, c = c0, d = d0;
            for (let j = 0; j < 64; j++) {
                let f, g;
                if (j < 16) {
                    f = (b & c) | (~b & d);
                    g = j;
                } else if (j < 32) {
                    f = (d & b) | (~d & c);
                    g = (5 * j + 1) % 16;
                } else if (j < 48) {
                    f = b ^ c ^ d;
                    g = (3 * j + 5) % 16;
                } else {
                    f = c ^ (b | ~d);
                    g = (7 * j) % 16;
                }
                f = (f + a + k[j] + view.getUint32(i + g * 4, true)) >>> 0;
                a = d;
                d = c;
                c = b;
                b = (b + ((f << s[j]) | (f >>> (32 - s[j])))) >>> 0;
            }
            a0 = (a0 + a) >>> 0;
            b0 = (b0 + b) >>> 0;
            c0 = (c0 + c) >>> 0;
            d0 = (d0 + d) >>> 0;
        }
        const digest = new Uint8Array(16);
        view = new DataView(digest.buffer);
        view.setUint32(0, a0, true);
        view.setUint32(4, b0, true);
        view.setUint32(8, c0, true);
        view.setUint32(12, d0, true);
        return digest;
    }

    _u8ArrayToBigInt(arr) {
        let hex = '0x';
        for (let i = 0; i < arr.length; i++) {
            hex += arr[i].toString(16).padStart(2, '0');
        }
        return BigInt(hex);
    }

    _bigIntToU8Array(bigint, padLength) {
        let hex = bigint.toString(16);
        hex = hex.padStart(padLength * 2, '0');
        const length = hex.length / 2;
        const arr = new Uint8Array(length);
        for (let i = 0; i < length; i++) {
            arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
        }
        return arr;
    }

    _modPow(b, e, m) {
        if (m === 1n) {
            return 0;
        }
        let r = 1n;
        b = b % m;
        while (e > 0) {
            if (e % 2n === 1n) {
                r = (r * b) % m;
            }
            e = e / 2n;
            b = (b * b) % m;
        }
        return r;
    }

    checkInternalEvents() {
        if (this._checkSock !== null) {
            this._checkSock();
        }
        if (this._checkCredentials !== null) {
            this._checkCredentials();
        }
    }

    disconnect() {
        if (this._sockReject !== null) {
            this._sockReject(new Error("disconnect normally"));
            this._sockReject = null;
        }
        if (this._credentialsReject !== null) {
            this._credentialsReject(new Error("disconnect normally"));
            this._credentialsReject = null;
        }
    }

    async negotiateARDAuthAsync() {
        this._hasStarted = true;
        await this._waitSockAsync(4);
        const generator = this._sock.rQshift16();
        const keyLength = this._sock.rQshift16();
        await this._waitSockAsync(keyLength * 2);
        const primeModulus = this._sock.rQshiftBytes(keyLength);
        const serverPublickey = this._sock.rQshiftBytes(keyLength);
        const primeModulusBigInt = this._u8ArrayToBigInt(primeModulus);
        const serverPublickeyBigInt = this._u8ArrayToBigInt(serverPublickey);
        const generatorBigInt = BigInt(generator);

        const clientPrivatekey = new Uint8Array(keyLength);
        window.crypto.getRandomValues(clientPrivatekey);
        const clientPrivatekeyBigInt = this._u8ArrayToBigInt(clientPrivatekey);
        const sharedSecret = this._bigIntToU8Array(
            this._modPow(serverPublickeyBigInt, clientPrivatekeyBigInt, primeModulusBigInt), keyLength);
        const clientPublickey = this._bigIntToU8Array(
            this._modPow(generatorBigInt, clientPrivatekeyBigInt, primeModulusBigInt), keyLength);
        const aesKey = this._md5(sharedSecret);
        const cipher = new AESBlockCipher;
        await cipher.setKey(aesKey);

        const credentials = new Uint8Array(128);
        window.crypto.getRandomValues(credentials);
        this.dispatchEvent(new CustomEvent("credentialsrequired", {
            detail: { types: ["username", "password"] }
        }));
        await this._waitCredentialsAsync();
        const username = encodeUTF8(this._getCredentials().username).slice(0, 63);
        const password = encodeUTF8(this._getCredentials().password).slice(0, 63);
        for (let i = 0; i < username.length; i++) {
            credentials[i] = username.charCodeAt(i);
        }
        for (let i = 0; i < password.length; i++) {
            credentials[64 + i] = password.charCodeAt(i);
        }
        credentials[username.length] = 0;
        credentials[64 + password.length] = 0;
        for (let i = 0; i < 8; i++) {
            await cipher.encryptInplace(credentials, i * 16);
        }
        this._sock.send(credentials);
        this._sock.send(clientPublickey);
    }

    get hasStarted() {
        return this._hasStarted;
    }

    set hasStarted(s) {
        this._hasStarted = s;
    }
}