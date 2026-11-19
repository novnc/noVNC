const expect = chai.expect;

import RFB from '../core/rfb.js';

describe('Native touch coordinates', function () {
    let rfb, sandbox;

    beforeEach(function () {
        sandbox = sinon.createSandbox();
        sandbox.stub(RFB.messages, 'touchEvent');
        rfb = Object.create(RFB.prototype);
        Object.assign(rfb, { _sock: {}, _fbWidth: 1920, _fbHeight: 1080 });
    });

    afterEach(function () { sandbox.restore(); });

    const sent = () => RFB.messages.touchEvent.firstCall.args.slice(2);

    it('passes a position inside the framebuffer through unchanged', function () {
        rfb._sendTouch(7, 1, 100, 200);
        expect(sent()).to.deep.equal([1, 100, 200]);
    });

    it('pins a drag that left the canvas on the top or left to the edge instead of wrapping', function () {
        rfb._sendTouch(7, 1, -5, -300);
        expect(sent()).to.deep.equal([1, 0, 0]);
    });

    it('pins a drag that left the canvas on the bottom or right to the last pixel', function () {
        rfb._sendTouch(7, 1, 5000, 99999);
        expect(sent()).to.deep.equal([1, 1919, 1079]);
    });

    it('keeps the last pixel itself reachable', function () {
        rfb._sendTouch(7, 2, 1919, 1079);
        expect(sent()).to.deep.equal([2, 1919, 1079]);
    });

    it('drops the event when a coordinate is not a number', function () {
        rfb._sendTouch(7, 1, NaN, 5);
        rfb._sendTouch(7, 1, 5, undefined);
        expect(RFB.messages.touchEvent.called).to.be.false;
    });

    it('still sends the touch id and state', function () {
        rfb._sendTouch(0xfffffff0, 2, 1, 1);
        expect(RFB.messages.touchEvent.firstCall.args[1]).to.equal(0xfffffff0);
        expect(RFB.messages.touchEvent.firstCall.args[2]).to.equal(2);
    });

    it('does not send a negative size framebuffer position', function () {
        rfb._fbWidth = 0;
        rfb._fbHeight = 0;
        rfb._sendTouch(7, 1, 40, 40);
        expect(sent()).to.deep.equal([1, 0, 0]);
    });
});
