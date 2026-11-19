const expect = chai.expect;

import RFB from '../core/rfb.js';
import Display from '../core/display.js';
import { MAX_FB_SPAN } from '../core/util/fb-limits.js';
import { encodings } from '../core/encodings.js';

const P = RFB.prototype;

function sockFor(screens) {
    const queue = [];
    screens.forEach(([w, h]) => queue.push(1, 0, 0, w, h));
    return {
        rQwait: () => false,
        rQpeek8: () => screens.length,
        rQskipBytes: () => {},
        rQshiftBytes: () => 0,
        rQshift32: () => queue.shift(),
        rQshift16: () => queue.shift(),
    };
}

describe('Unusable server framebuffer size', function () {
    let rfb, fail;

    beforeEach(function () {
        fail = sinon.spy(() => false);
        const display = Object.create(Display.prototype);
        display._screens = [{ screenIndex: 0, screenID: 's0', serverReportedWidth: 5, serverReportedHeight: 6 }];
        display.resize = sinon.spy();
        rfb = Object.create(P);
        Object.assign(rfb, {
            _display: display, _fail: fail, _fbWidth: 800, _fbHeight: 600,
            _FBU: { x: 0, y: 0, width: 800, height: 600, rects: 1 },
            _supportsSetDesktopSize: true, _forceFullFrameUpdateAfterResize: false,
            _updateClip: () => {}, _updateScale: () => {}, _updateContinuousUpdates: () => {},
        });
    });

    const desktopSize = (w, h) => {
        rfb._FBU.encoding = encodings.pseudoEncodingDesktopSize;
        rfb._FBU.width = w;
        rfb._FBU.height = h;
        return rfb._handleRect();
    };

    it('fails the connection on a DesktopSize rect of zero or oversize', function () {
        expect(desktopSize(0, 0)).to.be.false;
        expect(desktopSize(MAX_FB_SPAN + 1, 600)).to.be.false;
        expect(fail).to.have.been.calledTwice;
        expect(fail.firstCall.args[0]).to.include('unsupported framebuffer size');
    });

    it('fails the connection on a DesktopSize rect over the pixel budget', function () {
        expect(desktopSize(20000, 4000)).to.be.false;
        expect(fail).to.have.been.calledOnce;
    });

    it('applies a three 4K monitor DesktopSize rect', function () {
        expect(desktopSize(11520, 2160)).to.be.true;
        expect(fail).to.not.have.been.called;
    });

    it('applies a valid DesktopSize rect', function () {
        expect(desktopSize(1024, 768)).to.be.true;
        expect(fail).to.not.have.been.called;
        expect(rfb._fbWidth).to.equal(1024);
    });

    it('fails the connection on an ExtendedDesktopSize screen the display rejects', function () {
        rfb._sock = sockFor([[MAX_FB_SPAN + 1, 600]]);
        expect(rfb._handleExtendedDesktopSize()).to.be.false;
        expect(fail).to.have.been.calledOnce;
        expect(rfb._display._screens[0].serverReportedWidth).to.equal(5);
    });

    it('fails the connection on an ExtendedDesktopSize with an unusable framebuffer size', function () {
        rfb._sock = sockFor([[800, 600]]);
        rfb._FBU.width = 0;
        rfb._FBU.height = 0;
        expect(rfb._handleExtendedDesktopSize()).to.be.false;
        expect(fail).to.have.been.calledOnce;
    });

    it('accepts a valid ExtendedDesktopSize', function () {
        rfb._sock = sockFor([[800, 600]]);
        expect(rfb._handleExtendedDesktopSize()).to.be.true;
        expect(fail).to.not.have.been.called;
        expect(rfb._display._screens[0].serverReportedWidth).to.equal(800);
    });
});
