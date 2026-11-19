const expect = chai.expect;

import { validPointerArgs, validKeyArgs, validClipboardArgs, validScreenGeometry } from '../core/secondary/messages.js';

const GEOMETRY = {
    width: 924, height: 868, serverWidth: 924, serverHeight: 868, x: 1878, y: 0,
    containerWidth: 924, containerHeight: 868, pixelRatio: 1, scale: 1,
};

describe('Secondary display message validation', function () {
    describe('pointer arguments', function () {
        it('accepts coordinates for a move', function () {
            expect(validPointerArgs('mousemove', [1, 2, 0, false])).to.be.true;
        });
        it('rejects missing or non numeric coordinates', function () {
            for (const args of [undefined, null, [], [1], ['a', 'b'], [NaN, 1], [1, Infinity]]) {
                expect(validPointerArgs('mousemove', args), JSON.stringify(args)).to.be.false;
            }
        });
        it('accepts the buttons the server knows and nothing above them', function () {
            for (const mask of [0, 1, 128, 256, 0x3FF]) {
                expect(validPointerArgs('mousedown', [1, 2, mask]), String(mask)).to.be.true;
            }
            for (const mask of [-1, 0x400, 0xFFFF, 1.5, '1', NaN, undefined]) {
                expect(validPointerArgs('mouseup', [1, 2, mask]), String(mask)).to.be.false;
            }
        });
        it('needs finite scroll deltas', function () {
            expect(validPointerArgs('scroll', [1, 2, 0, 120])).to.be.true;
            expect(validPointerArgs('scroll', [1, 2])).to.be.false;
            expect(validPointerArgs('scroll', [1, 2, 'a', 0])).to.be.false;
            expect(validPointerArgs('scroll', [1, 2, 0, Infinity])).to.be.false;
        });
    });

    describe('key arguments', function () {
        it('needs an integer keysym and a down flag of 0 or 1', function () {
            expect(validKeyArgs([65, 0])).to.be.true;
            expect(validKeyArgs([65, 1])).to.be.true;
            for (const args of [undefined, [], [65], [65, 2], [65, 'x'], [65, true], ['a', 1], [1.5, 1], [65, 1, {}]]) {
                expect(validKeyArgs(args), JSON.stringify(args)).to.be.false;
            }
        });
    });

    describe('clipboard arguments', function () {
        it('accepts matching data and mime lists', function () {
            expect(validClipboardArgs([['a'], ['text/plain']])).to.be.true;
        });
        it('rejects mismatched, oversize or non string content', function () {
            expect(validClipboardArgs([['a'], []])).to.be.false;
            expect(validClipboardArgs([['a'], [1]])).to.be.false;
            expect(validClipboardArgs([new Array(256).fill('a'), new Array(256).fill('t')])).to.be.false;
            expect(validClipboardArgs([['a'], ['x'.repeat(256)]])).to.be.false;
            expect(validClipboardArgs([[null], ['text/plain']])).to.be.false;
            expect(validClipboardArgs('nope')).to.be.false;
        });
    });

    describe('screen geometry', function () {
        it('accepts what a real popup sends, including a window with no layout yet', function () {
            expect(validScreenGeometry(GEOMETRY)).to.be.true;
            expect(validScreenGeometry({ ...GEOMETRY, containerWidth: 0, containerHeight: 0, scale: 0 })).to.be.true;
        });
        it('rejects a screen that would push the layout past the framebuffer span', function () {
            expect(validScreenGeometry({ ...GEOMETRY, x: 32767, serverWidth: 32767, serverHeight: 100 })).to.be.false;
            expect(validScreenGeometry({ ...GEOMETRY, y: 32767, serverHeight: 100, serverWidth: 100 })).to.be.false;
            expect(validScreenGeometry({ ...GEOMETRY, x: 30000, serverWidth: 2767, serverHeight: 100 })).to.be.true;
        });
        it('rejects values that are not finite or are out of range', function () {
            const bad = [
                { serverWidth: 1e9 }, { serverWidth: NaN }, { serverHeight: -1 }, { x: Infinity }, { y: -5 },
                { width: 'a' }, { pixelRatio: NaN }, { scale: NaN }, { scale: 1e6 }, { scale: -1 },
                { containerWidth: undefined }, { serverWidth: 32767, serverHeight: 32767 },
            ];
            for (const change of bad) {
                expect(validScreenGeometry({ ...GEOMETRY, ...change }), JSON.stringify(change)).to.be.false;
            }
        });
    });
});
