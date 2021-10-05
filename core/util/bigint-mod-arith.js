/*
 * bigint-mod-arith implementation:
 *    https://github.com/juanelas/bigint-mod-arith
 *
 * Full attribution follows:
 *
 * -------------------------------------------------------------------------
 *
 * MIT License
 *
 * Copyright (c) 2018 Juan Hernández Serrano
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
*/

/**
 * Absolute value. abs(a)==a if a>=0. abs(a)==-a if a<0
 *
 * @param a
 *
 * @returns The absolute value of a
 */
function abs(a) {
    return (a >= 0) ? a : -a;
}

/**
 * Returns the bitlength of a number
 *
 * @param a
 * @returns The bit length
 */
function bitLength(a) {
    if (typeof a === 'number') {
        a = BigInt(a);
    }
    if (a === 1n) {
        return 1;
    }
    let bits = 1;
    do {
        bits++;
    } while ((a >>= 1n) > 1n);
    return bits;
}

/**
 * An iterative implementation of the extended euclidean algorithm or extended greatest common divisor algorithm.
 * Take positive integers a, b as input, and return a triple (g, x, y), such that ax + by = g = gcd(a, b).
 *
 * @param a
 * @param b
 *
 * @throws {RangeError}
 * This excepction is thrown if a or b are less than 0
 *
 * @returns A triple (g, x, y), such that ax + by = g = gcd(a, b).
 */
function eGcd(a, b) {
    if (typeof a === 'number') {
        a = BigInt(a);
    }
    if (typeof b === 'number') {
        b = BigInt(b);
    }
    if (a <= 0n || b <= 0n) {
        throw new RangeError('a and b MUST be > 0'); // a and b MUST be positive
    }
    let x = 0n;
    let y = 1n;
    let u = 1n;
    let v = 0n;
    while (a !== 0n) {
        const q = b / a;
        const r = b % a;
        const m = x - (u * q);
        const n = y - (v * q);
        b = a;
        a = r;
        x = u;
        y = v;
        u = m;
        v = n;
    }
    return {
        g: b,
        x: x,
        y: y
    };
}

/**
 * Greatest-common divisor of two integers based on the iterative binary algorithm.
 *
 * @param a
 * @param b
 *
 * @returns The greatest common divisor of a and b
 */
function gcd(a, b) {
    let aAbs = (typeof a === 'number') ? BigInt(abs(a)) : abs(a);
    let bAbs = (typeof b === 'number') ? BigInt(abs(b)) : abs(b);
    if (aAbs === 0n) {
        return bAbs;
    } else if (bAbs === 0n) {
        return aAbs;
    }
    let shift = 0n;
    while (((aAbs | bAbs) & 1n) === 0n) {
        aAbs >>= 1n;
        bAbs >>= 1n;
        shift++;
    }
    while ((aAbs & 1n) === 0n) {
        aAbs >>= 1n;
    }
    do {
        while ((bAbs & 1n) === 0n) {
            bAbs >>= 1n;
        }
        if (aAbs > bAbs) {
            const x = aAbs;
            aAbs = bAbs;
            bAbs = x;
        }
        bAbs -= aAbs;
    } while (bAbs !== 0n);
    // rescale
    return aAbs << shift;
}

/**
 * The least common multiple computed as abs(a*b)/gcd(a,b)
 * @param a
 * @param b
 *
 * @returns The least common multiple of a and b
 */
function lcm(a, b) {
    if (typeof a === 'number') {
        a = BigInt(a);
    }
    if (typeof b === 'number') {
        b = BigInt(b);
    }
    if (a === 0n && b === 0n) {
        return BigInt(0);
    }
    return abs(a * b) / gcd(a, b);
}

/**
 * Maximum. max(a,b)==a if a>=b. max(a,b)==b if a<=b
 *
 * @param a
 * @param b
 *
 * @returns Maximum of numbers a and b
 */
function max(a, b) {
    return (a >= b) ? a : b;
}

/**
 * Minimum. min(a,b)==b if a>=b. min(a,b)==a if a<=b
 *
 * @param a
 * @param b
 *
 * @returns Minimum of numbers a and b
 */
function min(a, b) {
    return (a >= b) ? b : a;
}

/**
 * Finds the smallest positive element that is congruent to a in modulo n
 *
 * @remarks
 * a and b must be the same type, either number or bigint
 *
 * @param a - An integer
 * @param n - The modulo
 *
 * @throws {RangeError}
 * Excpeption thrown when n is not > 0
 *
 * @returns A bigint with the smallest positive representation of a modulo n
 */
function toZn(a, n) {
    if (typeof a === 'number') {
        a = BigInt(a);
    }
    if (typeof n === 'number') {
        n = BigInt(n);
    }
    if (n <= 0n) {
        throw new RangeError('n must be > 0');
    }
    const aZn = a % n;
    return (aZn < 0n) ? aZn + n : aZn;
}

/**
 * Modular inverse.
 *
 * @param a The number to find an inverse for
 * @param n The modulo
 *
 * @throws {RangeError}
 * Excpeption thorwn when a does not have inverse modulo n
 *
 * @returns The inverse modulo n
 */
function modInv(a, n) {
    const egcd = eGcd(toZn(a, n), n);
    if (egcd.g !== 1n) {
        throw new RangeError(`${a.toString()} does not have inverse modulo ${n.toString()}`); // modular inverse does not exist
    } else {
        return toZn(egcd.x, n);
    }
}

/**
 * Modular exponentiation b**e mod n. Currently using the right-to-left binary method
 *
 * @param b base
 * @param e exponent
 * @param n modulo
 *
 * @throws {RangeError}
 * Excpeption thrown when n is not > 0
 *
 * @returns b**e mod n
 */
function modPow(b, e, n) {
    if (typeof b === 'number') {
        b = BigInt(b);
    }
    if (typeof e === 'number') {
        e = BigInt(e);
    }
    if (typeof n === 'number') {
        n = BigInt(n);
    }
    if (n <= 0n) {
        throw new RangeError('n must be > 0');
    } else if (n === 1n) {
        return 0n;
    }
    b = toZn(b, n);
    if (e < 0n) {
        return modInv(modPow(b, abs(e), n), n);
    }
    let r = 1n;
    while (e > 0) {
        if ((e % 2n) === 1n) {
            r = r * b % n;
        }
        e = e / 2n;
        b = b ** 2n % n;
    }
    return r;
}

export { abs, bitLength, eGcd, gcd, lcm, max, min, modInv, modPow, toZn };