import { toUnsigned32bit, toSigned32bit } from '../core/util/int.js';

describe('Integer casting', function () {
    it('should cast unsigned to signed', function () {
        let expected = 4294967286;
        expect(toUnsigned32bit(-10)).to.equal(expected);
    });

    it('should cast signed to unsigned', function () {
        let expected = -10;
        expect(toSigned32bit(4294967286)).to.equal(expected);
    });
});
