import Base64 from './base64.js';
import { encodeUTF8 } from './util/strings.js';
import EventTargetMixin from './util/eventtarget.js';

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
            "name": "AES-CTR",
            counter: counter,
            length: 128
        }, this._ctrKey, data);
        return new Uint8Array(encrypted);
    }

    async _decryptCTR(data, counter) {
        const decrypted = await window.crypto.subtle.decrypt({
            "name": "AES-CTR",
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

    async setKey(key) {
        this._rawKey = key;
        this._ctrKey = await window.crypto.subtle.importKey(
            "raw", key, {"name": "AES-CTR"}, false, ["encrypt", "decrypt"]);
        this._cbcKey = await window.crypto.subtle.importKey(
            "raw", key, {"name": "AES-CBC"}, false, ["encrypt", "decrypt"]);
        await this._initCMAC();
    }

    async encrypt(message, associatedData, nonce) {
        const nCMAC = await this._computeCMAC(nonce, this._prefixBlock0);
        const encrypted = await this._encryptCTR(message, nCMAC);
        const adCMAC = await this._computeCMAC(associatedData, this._prefixBlock1);
        const mac = await this._computeCMAC(encrypted, this._prefixBlock2);
        for (let i = 0; i < 16; i++) {
            mac[i] ^= nCMAC[i] ^ adCMAC[i];
        }
        const res = new Uint8Array(16 + encrypted.length);
        res.set(encrypted);
        res.set(mac, encrypted.length);
        return res;
    }

    async decrypt(encrypted, associatedData, nonce, mac) {
        const nCMAC = await this._computeCMAC(nonce, this._prefixBlock0);
        const adCMAC = await this._computeCMAC(associatedData, this._prefixBlock1);
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

export class RA2Cipher {
    constructor() {
        this._cipher = new AESEAXCipher();
        this._counter = new Uint8Array(16);
    }

    async setKey(key) {
        await this._cipher.setKey(key);
    }

    async makeMessage(message) {
        const ad = new Uint8Array([(message.length & 0xff00) >>> 8, message.length & 0xff]);
        const encrypted = await this._cipher.encrypt(message, ad, this._counter);
        for (let i = 0; i < 16 && this._counter[i]++ === 255; i++);
        const res = new Uint8Array(message.length + 2 + 16);
        res.set(ad);
        res.set(encrypted, 2);
        return res;
    }

    async receiveMessage(length, encrypted, mac) {
        const ad = new Uint8Array([(length & 0xff00) >>> 8, length & 0xff]);
        const res = await this._cipher.decrypt(encrypted, ad, this._counter, mac);
        for (let i = 0; i < 16 && this._counter[i]++ === 255; i++);
        return res;
    }
}

export class RSACipher {
    constructor(keyLength) {
        this._key = null;
        this._keyLength = keyLength;
        this._keyBytes = Math.ceil(keyLength / 8);
        this._n = null;
        this._e = null;
        this._d = null;
        this._nBigInt = null;
        this._eBigInt = null;
        this._dBigInt = null;
    }

    _base64urlDecode(data) {
        data = data.replace(/-/g, "+").replace(/_/g, "/");
        data = data.padEnd(Math.ceil(data.length / 4) * 4, "=");
        return Base64.decode(data);
    }

    _u8ArrayToBigInt(arr) {
        let hex = '0x';
        for (let i = 0; i < arr.length; i++) {
            hex += arr[i].toString(16).padStart(2, '0');
        }
        return BigInt(hex);
    }

    _padArray(arr, length) {
        const res = new Uint8Array(length);
        res.set(arr, length - arr.length);
        return res;
    }

    _bigIntToU8Array(bigint, padLength=0) {
        let hex = bigint.toString(16);
        if (padLength === 0) {
            padLength = Math.ceil(hex.length / 2) * 2;
        }
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

    async generateKey() {
        this._key = await window.crypto.subtle.generateKey(
            {
                name: "RSA-OAEP",
                modulusLength: this._keyLength,
                publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
                hash: {name: "SHA-256"},
            },
            true, ["encrypt", "decrypt"]);
        const privateKey = await window.crypto.subtle.exportKey("jwk", this._key.privateKey);
        this._n = this._padArray(this._base64urlDecode(privateKey.n), this._keyBytes);
        this._nBigInt = this._u8ArrayToBigInt(this._n);
        this._e = this._padArray(this._base64urlDecode(privateKey.e), this._keyBytes);
        this._eBigInt = this._u8ArrayToBigInt(this._e);
        this._d = this._padArray(this._base64urlDecode(privateKey.d), this._keyBytes);
        this._dBigInt = this._u8ArrayToBigInt(this._d);
    }

    setPublicKey(n, e) {
        if (n.length !== this._keyBytes || e.length !== this._keyBytes) {
            return;
        }
        this._n = new Uint8Array(this._keyBytes);
        this._e = new Uint8Array(this._keyBytes);
        this._n.set(n);
        this._e.set(e);
        this._nBigInt = this._u8ArrayToBigInt(this._n);
        this._eBigInt = this._u8ArrayToBigInt(this._e);
    }

    encrypt(message) {
        if (message.length > this._keyBytes - 11) {
            return null;
        }
        const ps = new Uint8Array(this._keyBytes - message.length - 3);
        window.crypto.getRandomValues(ps);
        for (let i = 0; i < ps.length; i++) {
            ps[i] = Math.floor(ps[i] * 254 / 255 + 1);
        }
        const em = new Uint8Array(this._keyBytes);
        em[1] = 0x02;
        em.set(ps, 2);
        em.set(message, ps.length + 3);
        const emBigInt = this._u8ArrayToBigInt(em);
        const c = this._modPow(emBigInt, this._eBigInt, this._nBigInt);
        return this._bigIntToU8Array(c, this._keyBytes);
    }

    decrypt(message) {
        if (message.length !== this._keyBytes) {
            return null;
        }
        const msgBigInt = this._u8ArrayToBigInt(message);
        const emBigInt = this._modPow(msgBigInt, this._dBigInt, this._nBigInt);
        const em = this._bigIntToU8Array(emBigInt, this._keyBytes);
        if (em[0] !== 0x00 || em[1] !== 0x02) {
            return null;
        }
        let i = 2;
        for (; i < em.length; i++) {
            if (em[i] === 0x00) {
                break;
            }
        }
        if (i === em.length) {
            return null;
        }
        return em.slice(i + 1, em.length);
    }

    get keyLength() {
        return this._keyLength;
    }

    get n() {
        return this._n;
    }

    get e() {
        return this._e;
    }

    get d() {
        return this._d;
    }
}

export default class RSAAESAuthenticationState extends EventTargetMixin {
    constructor(sock, getCredentials) {
        super();
        this._hasStarted = false;
        this._checkSock = null;
        this._checkCredentials = null;
        this._approveServerResolve = null;
        this._sockReject = null;
        this._credentialsReject = null;
        this._approveServerReject = null;
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

    _waitApproveKeyAsync() {
        return new Promise((resolve, reject) => {
            this._approveServerResolve = resolve;
            this._approveServerReject = reject;
        });
    }

    _waitCredentialsAsync(subtype) {
        const hasCredentials = () => {
            if (subtype === 1 && this._getCredentials().username !== undefined &&
                this._getCredentials().password !== undefined) {
                return true;
            } else if (subtype === 2 && this._getCredentials().password !== undefined) {
                return true;
            }
            return false;
        };
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

    checkInternalEvents() {
        if (this._checkSock !== null) {
            this._checkSock();
        }
        if (this._checkCredentials !== null) {
            this._checkCredentials();
        }
    }

    approveServer() {
        if (this._approveServerResolve !== null) {
            this._approveServerResolve();
            this._approveServerResolve = null;
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
        if (this._approveServerReject !== null) {
            this._approveServerReject(new Error("disconnect normally"));
            this._approveServerReject = null;
        }
    }

    async negotiateRA2neAuthAsync() {
        this._hasStarted = true;
        // 1: Receive server public key
        await this._waitSockAsync(4);
        const serverKeyLengthBuffer = this._sock.rQslice(0, 4);
        const serverKeyLength = this._sock.rQshift32();
        if (serverKeyLength < 1024) {
            throw new Error("RA2: server public key is too short: " + serverKeyLength);
        } else if (serverKeyLength > 8192) {
            throw new Error("RA2: server public key is too long: " + serverKeyLength);
        }
        const serverKeyBytes = Math.ceil(serverKeyLength / 8);
        await this._waitSockAsync(serverKeyBytes * 2);
        const serverN = this._sock.rQshiftBytes(serverKeyBytes);
        const serverE = this._sock.rQshiftBytes(serverKeyBytes);
        const serverRSACipher = new RSACipher(serverKeyLength);
        serverRSACipher.setPublicKey(serverN, serverE);
        const serverPublickey = new Uint8Array(4 + serverKeyBytes * 2);
        serverPublickey.set(serverKeyLengthBuffer);
        serverPublickey.set(serverN, 4);
        serverPublickey.set(serverE, 4 + serverKeyBytes);

        // verify server public key
        this.dispatchEvent(new CustomEvent("serververification", {
            detail: { type: "RSA", publickey: serverPublickey }
        }));
        await this._waitApproveKeyAsync();

        // 2: Send client public key
        const clientKeyLength = 2048;
        const clientKeyBytes = Math.ceil(clientKeyLength / 8);
        const clientRSACipher = new RSACipher(clientKeyLength);
        await clientRSACipher.generateKey();
        const clientN = clientRSACipher.n;
        const clientE = clientRSACipher.e;
        const clientPublicKey = new Uint8Array(4 + clientKeyBytes * 2);
        clientPublicKey[0] = (clientKeyLength & 0xff000000) >>> 24;
        clientPublicKey[1] = (clientKeyLength & 0xff0000) >>> 16;
        clientPublicKey[2] = (clientKeyLength & 0xff00) >>> 8;
        clientPublicKey[3] = clientKeyLength & 0xff;
        clientPublicKey.set(clientN, 4);
        clientPublicKey.set(clientE, 4 + clientKeyBytes);
        this._sock.send(clientPublicKey);

        // 3: Send client random
        const clientRandom = new Uint8Array(16);
        window.crypto.getRandomValues(clientRandom);
        const clientEncryptedRandom = serverRSACipher.encrypt(clientRandom);
        const clientRandomMessage = new Uint8Array(2 + serverKeyBytes);
        clientRandomMessage[0] = (serverKeyBytes & 0xff00) >>> 8;
        clientRandomMessage[1] = serverKeyBytes & 0xff;
        clientRandomMessage.set(clientEncryptedRandom, 2);
        this._sock.send(clientRandomMessage);

        // 4: Receive server random
        await this._waitSockAsync(2);
        if (this._sock.rQshift16() !== clientKeyBytes) {
            throw new Error("RA2: wrong encrypted message length");
        }
        const serverEncryptedRandom = this._sock.rQshiftBytes(clientKeyBytes);
        const serverRandom = clientRSACipher.decrypt(serverEncryptedRandom);
        if (serverRandom === null || serverRandom.length !== 16) {
            throw new Error("RA2: corrupted server encrypted random");
        }

        // 5: Compute session keys and set ciphers
        let clientSessionKey = new Uint8Array(32);
        let serverSessionKey = new Uint8Array(32);
        clientSessionKey.set(serverRandom);
        clientSessionKey.set(clientRandom, 16);
        serverSessionKey.set(clientRandom);
        serverSessionKey.set(serverRandom, 16);
        clientSessionKey = await window.crypto.subtle.digest("SHA-1", clientSessionKey);
        clientSessionKey = new Uint8Array(clientSessionKey).slice(0, 16);
        serverSessionKey = await window.crypto.subtle.digest("SHA-1", serverSessionKey);
        serverSessionKey = new Uint8Array(serverSessionKey).slice(0, 16);
        const clientCipher = new RA2Cipher();
        await clientCipher.setKey(clientSessionKey);
        const serverCipher = new RA2Cipher();
        await serverCipher.setKey(serverSessionKey);

        // 6: Compute and exchange hashes
        let serverHash = new Uint8Array(8 + serverKeyBytes * 2 + clientKeyBytes * 2);
        let clientHash = new Uint8Array(8 + serverKeyBytes * 2 + clientKeyBytes * 2);
        serverHash.set(serverPublickey);
        serverHash.set(clientPublicKey, 4 + serverKeyBytes * 2);
        clientHash.set(clientPublicKey);
        clientHash.set(serverPublickey, 4 + clientKeyBytes * 2);
        serverHash = await window.crypto.subtle.digest("SHA-1", serverHash);
        clientHash = await window.crypto.subtle.digest("SHA-1", clientHash);
        serverHash = new Uint8Array(serverHash);
        clientHash = new Uint8Array(clientHash);
        this._sock.send(await clientCipher.makeMessage(clientHash));
        await this._waitSockAsync(2 + 20 + 16);
        if (this._sock.rQshift16() !== 20) {
            throw new Error("RA2: wrong server hash");
        }
        const serverHashReceived = await serverCipher.receiveMessage(
            20, this._sock.rQshiftBytes(20), this._sock.rQshiftBytes(16));
        if (serverHashReceived === null) {
            throw new Error("RA2: failed to authenticate the message");
        }
        for (let i = 0; i < 20; i++) {
            if (serverHashReceived[i] !== serverHash[i]) {
                throw new Error("RA2: wrong server hash");
            }
        }

        // 7: Receive subtype
        await this._waitSockAsync(2 + 1 + 16);
        if (this._sock.rQshift16() !== 1) {
            throw new Error("RA2: wrong subtype");
        }
        let subtype = (await serverCipher.receiveMessage(
            1, this._sock.rQshiftBytes(1), this._sock.rQshiftBytes(16)));
        if (subtype === null) {
            throw new Error("RA2: failed to authenticate the message");
        }
        subtype = subtype[0];
        if (subtype === 1) {
            if (this._getCredentials().username === undefined ||
                this._getCredentials().password === undefined) {
                this.dispatchEvent(new CustomEvent(
                    "credentialsrequired",
                    { detail: { types: ["username", "password"] } }));
            }
        } else if (subtype === 2) {
            if (this._getCredentials().password === undefined) {
                this.dispatchEvent(new CustomEvent(
                    "credentialsrequired",
                    { detail: { types: ["password"] } }));
            }
        } else {
            throw new Error("RA2: wrong subtype");
        }
        await this._waitCredentialsAsync(subtype);
        let username;
        if (subtype === 1) {
            username = encodeUTF8(this._getCredentials().username).slice(0, 255);
        } else {
            username = "";
        }
        const password = encodeUTF8(this._getCredentials().password).slice(0, 255);
        const credentials = new Uint8Array(username.length + password.length + 2);
        credentials[0] = username.length;
        credentials[username.length + 1] = password.length;
        for (let i = 0; i < username.length; i++) {
            credentials[i + 1] = username.charCodeAt(i);
        }
        for (let i = 0; i < password.length; i++) {
            credentials[username.length + 2 + i] = password.charCodeAt(i);
        }
        this._sock.send(await clientCipher.makeMessage(credentials));
    }

    get hasStarted() {
        return this._hasStarted;
    }

    set hasStarted(s) {
        this._hasStarted = s;
    }
}