const expect = chai.expect;

import RFB from '../core/rfb.js';
import Display from '../core/display.js';
import SecondaryLinkManager from '../core/secondary/link-manager.js';
import { MAX_FB_DIMENSION, MAX_FB_SPAN, clampDimension } from '../core/util/fb-limits.js';

// Covers the framebuffer dimension limits (VNC-534 / VNC-535). Display and RFB
// objects are built by hand so no canvas, renderer or websocket is needed.

const MAX = MAX_FB_DIMENSION;
const P = RFB.prototype;

function makeScreen(index, overrides = {}) {
    return Object.assign({
        screenID: 's' + index, screenIndex: index, width: 0, height: 0,
        serverWidth: 0, serverHeight: 0, serverReportedWidth: 0, serverReportedHeight: 0,
        x: 0, y: 0, scale: 1, pixelRatio: 1, containerWidth: 1920, containerHeight: 1080, x2: 0, y2: 0
    }, overrides);
}

// Real Display.getScreenSize / applyServerResolution on a hand-built instance
function makeDisplay(screens) {
    const display = Object.create(Display.prototype);
    display._screens = screens;
    display._target = { parentNode: { getBoundingClientRect: () => ({ width: 1920, height: 1080 }) } };
    display._renderer = null;
    return display;
}

function reported(display) {
    return display._screens.map(s => [s.serverReportedWidth, s.serverReportedHeight]);
}

// An RFB `this` that uses the real _screenSize inputs and getScreenSize
function makeRfb(display, overrides = {}) {
    const rfb = Object.create(P);
    Object.assign(rfb, {
        _resizeTimeout: null, _isPrimaryDisplay: true, _viewOnly: false, _supportsSetDesktopSize: true,
        _resizeSession: true, _forcedResolutionX: 0, _forcedResolutionY: 0, _display: display, _sock: {},
        _screenFlags: 0, _hiDpi: false, _streamMode: 0, _forceFullFrameUpdateAfterResize: false,
        _validateDimensions: P._validateDimensions,
        _screenSize(limited, ignoreServerReported) {
            return this._display.getScreenSize(0, this._forcedResolutionX, this._forcedResolutionY,
                                               false, true, !this._resizeSession, 0, ignoreServerReported);
        }
    }, overrides);
    return rfb;
}

describe('Framebuffer dimension limits', function () {
    let setDesktopSize;

    beforeEach(function () {
        setDesktopSize = sinon.stub(RFB.messages, 'setDesktopSize');
    });
    afterEach(function () {
        setDesktopSize.restore();
    });

    describe('clampDimension', function () {
        [[0, 0], [1, 1], [1920.9, 1920], [MAX, MAX], [MAX_FB_SPAN, MAX_FB_SPAN], [MAX_FB_SPAN + 1, MAX_FB_SPAN], [1e9, MAX_FB_SPAN],
         [-5, 0], [Infinity, MAX_FB_SPAN], [-Infinity, 0], [NaN, 0], [undefined, 0]].forEach(([input, expected]) => {
            it(`should turn ${input} into ${expected}`, function () {
                expect(clampDimension(input)).to.equal(expected);
            });
        });
    });

    describe('RFB._validateDimensions', function () {
        [[1, 1, true], [1920, 1080, true], [MAX, MAX, true], [11520, 2160, true], [MAX_FB_SPAN, 2048, true], [MAX_FB_SPAN + 1, 100, false], [100, MAX_FB_SPAN + 1, false],
         [20000, 4000, false], [MAX + 1, MAX, false], [MAX, MAX + 1, false],
         [0, 1080, false], [1920, 0, false], [-1, 10, false], [NaN, 10, false], [10, NaN, false],
         [Infinity, 10, false]].forEach(([w, h, valid]) => {
            it(`should ${valid ? 'accept' : 'reject'} ${w}x${h}`, function () {
                expect(P._validateDimensions.call({}, w, h)).to.equal(valid);
            });
        });
    });

    describe('RFB._resize', function () {
        let rfb, displayResize;
        beforeEach(function () {
            displayResize = sinon.spy();
            rfb = makeRfb({ resize: displayResize }, {
                _fbWidth: 1024, _fbHeight: 768,
                _updateClip() {}, _updateScale() {}, _updateContinuousUpdates() {}
            });
        });

        it('should apply a valid size', function () {
            expect(P._resize.call(rfb, 1920, 1080)).to.be.true;
            expect([rfb._fbWidth, rfb._fbHeight]).to.deep.equal([1920, 1080]);
            expect(displayResize).to.have.been.calledOnce;
        });
        it('should reject an oversize framebuffer without changing state', function () {
            expect(P._resize.call(rfb, 100000, 100000)).to.be.false;
            expect([rfb._fbWidth, rfb._fbHeight]).to.deep.equal([1024, 768]);
            expect(displayResize).to.not.have.been.called;
        });
        it('should reject a zero size', function () {
            expect(P._resize.call(rfb, 0, 0)).to.be.false;
            expect(displayResize).to.not.have.been.called;
        });
    });

    describe('Display.resize', function () {
        let display, rendererResize;
        beforeEach(function () {
            display = makeDisplay([makeScreen(0, { serverWidth: 1920, serverHeight: 1080 })]);
            rendererResize = sinon.spy();
            display._renderer = { resize: rendererResize };
            display.viewportChangeSize = () => {};
            display.viewportChangePos = () => {};
        });

        it('should clamp each side before it reaches the renderer', function () {
            display.resize(100000, 2048);
            expect(rendererResize.firstCall.args.slice(0, 2)).to.deep.equal([MAX_FB_SPAN, 2048]);
            expect([display._fbWidth, display._fbHeight]).to.deep.equal([MAX_FB_SPAN, 2048]);
        });
        it('should ignore a size over the pixel budget', function () {
            display.resize(100000, 100000);
            expect(rendererResize).to.not.have.been.called;
            expect(display._fbWidth).to.not.equal(MAX_FB_SPAN);
        });
        it('should leave a normal size untouched', function () {
            display.resize(1920, 1080);
            expect(rendererResize.firstCall.args.slice(0, 2)).to.deep.equal([1920, 1080]);
        });
    });

    ['X', 'Y'].forEach(function (axis) {
        const key = 'maxVideoResolution' + axis;
        const priv = '_' + key;

        describe(key, function () {
            function assign(value, start = 1920) {
                const rfb = Object.create(P);
                rfb[priv] = start;
                rfb._pendingApplyVideoRes = false;
                rfb[key] = value;
                return rfb;
            }

            it(`should clamp an oversize value to ${MAX}`, function () {
                const rfb = assign(50000);
                expect(rfb[priv]).to.equal(MAX);
                expect(rfb._pendingApplyVideoRes).to.be.true;
            });
            it('should accept exactly the maximum', function () {
                expect(assign(MAX)[priv]).to.equal(MAX);
            });
            [1920.5, 50, NaN].forEach(function (bad) {
                it(`should reject ${bad} and keep the old value`, function () {
                    const rfb = assign(bad, 1280);
                    expect(rfb[priv]).to.equal(1280);
                    expect(rfb._pendingApplyVideoRes).to.be.false;
                });
            });
            it('should not flag a pending change for the same value', function () {
                expect(assign(1280, 1280)._pendingApplyVideoRes).to.be.false;
            });
        });
    });

    describe('Display.applyServerResolution', function () {
        let display;
        beforeEach(function () {
            display = makeDisplay([
                makeScreen(0, { serverReportedWidth: 1920, serverReportedHeight: 1080 }),
                makeScreen(1, { serverReportedWidth: 800, serverReportedHeight: 600 })
            ]);
        });

        it('should accept 0x0 as a clear, as enableHiDpi does', function () {
            expect(display.applyServerResolution(0, 0, 0)).to.not.be.false;
            expect(reported(display)).to.deep.equal([[0, 0], [800, 600]]);
        });
        it('should apply a valid resolution to the matching screen only', function () {
            display.applyServerResolution(1280, 720, 1);
            expect(reported(display)).to.deep.equal([[1920, 1080], [1280, 720]]);
        });
        it('should accept exactly the maximum', function () {
            display.applyServerResolution(MAX, MAX, 0);
            expect(reported(display)[0]).to.deep.equal([MAX, MAX]);
        });
        it('should do nothing for an unknown screen index', function () {
            display.applyServerResolution(1280, 720, 7);
            expect(reported(display)).to.deep.equal([[1920, 1080], [800, 600]]);
        });
        [[MAX_FB_SPAN + 1, 720], [1280, MAX_FB_SPAN + 1], [20000, 4000], [1280, 0], [0, 720], [-1, -1], [NaN, NaN], [Infinity, 720]].forEach(([w, h]) => {
            it(`should reject ${w}x${h} and leave the state unchanged`, function () {
                expect(display.applyServerResolution(w, h, 0)).to.be.false;
                expect(reported(display)).to.deep.equal([[1920, 1080], [800, 600]]);
            });
        });
    });

    describe('Display.getScreenSize', function () {
        let display;
        beforeEach(function () {
            display = makeDisplay([makeScreen(0, { serverReportedWidth: 1000, serverReportedHeight: 500 })]);
        });

        it('should use the server reported resolution by default', function () {
            const size = display.getScreenSize(0, 0, 0, false, true, true, 0);
            expect([size.serverWidth, size.serverHeight]).to.deep.equal([1000, 500]);
        });
        it('should compute from the container and leave the reported resolution alone when ignoring it', function () {
            const size = display.getScreenSize(0, 0, 0, false, true, true, 0, true);
            expect([size.serverWidth, size.serverHeight]).to.deep.equal([1920, 1080]);
            expect(reported(display)).to.deep.equal([[1000, 500]]);
        });
    });

    describe('Zeroing the reported resolution before or after computing the size', function () {
        function build() {
            return makeDisplay([
                makeScreen(0, { serverReportedWidth: 1000, serverReportedHeight: 500, serverWidth: 800, serverHeight: 600 }),
                makeScreen(1, { x: 1920, serverWidth: 1280, serverHeight: 720, serverReportedWidth: 640, serverReportedHeight: 480 })
            ]);
        }
        [true, false].forEach(function (disableScaling) {
            it(`should leave identical screens and size either way (disableScaling=${disableScaling})`, function () {
                const before = build();   // original order: zero first, then compute
                before._screens.forEach(s => before.applyServerResolution(0, 0, s.screenIndex));
                const sizeBefore = before.getScreenSize(0, 0, 0, false, true, disableScaling, 0);

                const after = build();    // new order: compute ignoring reported, then zero
                const sizeAfter = after.getScreenSize(0, 0, 0, false, true, disableScaling, 0, true);
                after._screens.forEach(s => after.applyServerResolution(0, 0, s.screenIndex));

                expect([sizeAfter.serverWidth, sizeAfter.serverHeight]).to.deep.equal([sizeBefore.serverWidth, sizeBefore.serverHeight]);
                expect(after._screens).to.deep.equal(before._screens);
            });
        });
    });

    describe('RFB.enableHiDpi', function () {
        it('should clear the reported resolution of screen 0 only', function () {
            const display = makeDisplay([
                makeScreen(0, { serverReportedWidth: 1920, serverReportedHeight: 1080 }),
                makeScreen(1, { serverReportedWidth: 800, serverReportedHeight: 600 })
            ]);
            const rfb = makeRfb(display);
            rfb.enableHiDpi = true;
            expect(rfb._hiDpi).to.be.true;
            expect(rfb._pendingApplyResolutionChange).to.be.true;
            expect(reported(display)).to.deep.equal([[0, 0], [800, 600]]);
        });
        it('should do nothing when the value is unchanged', function () {
            const display = makeDisplay([makeScreen(0, { serverReportedWidth: 1920, serverReportedHeight: 1080 })]);
            const rfb = makeRfb(display, { _hiDpi: true });
            rfb.enableHiDpi = true;
            expect(reported(display)).to.deep.equal([[1920, 1080]]);
        });
    });

    describe('RFB._requestRemoteResize', function () {
        function twoScreens(secondX) {
            const display = makeDisplay([
                makeScreen(0, { serverReportedWidth: 1920, serverReportedHeight: 1080 }),
                makeScreen(1, { x: secondX, serverWidth: 1920, serverHeight: 1080,
                                serverReportedWidth: 1280, serverReportedHeight: 720 })
            ]);
            return display;
        }

        it('should send a normal request and clear the reported resolution', function () {
            const display = makeDisplay([makeScreen(0, { serverReportedWidth: 1920, serverReportedHeight: 1080 })]);
            P._requestRemoteResize.call(makeRfb(display));
            expect(setDesktopSize).to.have.been.calledOnce;
            expect(reported(display)).to.deep.equal([[0, 0]]);
        });
        it('should send nothing and restore the reported resolution when a forced size is oversize', function () {
            const display = makeDisplay([makeScreen(0, { serverReportedWidth: 1920, serverReportedHeight: 1080 })]);
            P._requestRemoteResize.call(makeRfb(display, { _forcedResolutionX: 20000, _forcedResolutionY: 20000 }));
            expect(setDesktopSize).to.not.have.been.called;
            expect(reported(display)).to.deep.equal([[1920, 1080]]);
        });
        it('should restore every screen when the aggregate of in-range screens is oversize', function () {
            const display = twoScreens(MAX_FB_SPAN);
            P._requestRemoteResize.call(makeRfb(display));
            expect(setDesktopSize).to.not.have.been.called;
            expect(reported(display)).to.deep.equal([[1920, 1080], [1280, 720]]);
        });
        it('should leave every screen field untouched when the request is rejected', function () {
            // 3840x2160 at scale 0.5, then a forced 9000x2160 request
            const display = makeDisplay([makeScreen(0, {
                serverWidth: 3840, serverHeight: 2160, width: 1920, height: 1080, scale: 0.5,
                x2: 3840, y2: 2160, serverReportedWidth: 3840, serverReportedHeight: 2160
            })]);
            const before = JSON.parse(JSON.stringify(display._screens));
            const screenObject = display._screens[0];
            P._requestRemoteResize.call(makeRfb(display, { _forcedResolutionX: 9000, _forcedResolutionY: 9000 }));
            expect(setDesktopSize).to.not.have.been.called;
            expect(JSON.parse(JSON.stringify(display._screens))).to.deep.equal(before);
            expect(display._screens[0]).to.equal(screenObject);
        });
        it('should accept an aggregate of exactly the maximum', function () {
            P._requestRemoteResize.call(makeRfb(twoScreens(MAX - 1920)));
            expect(setDesktopSize).to.have.been.calledOnce;
        });
        it('should still work after a rejected request', function () {
            const display = makeDisplay([makeScreen(0, { serverReportedWidth: 1920, serverReportedHeight: 1080 })]);
            const rfb = makeRfb(display, { _forcedResolutionX: 20000, _forcedResolutionY: 20000 });
            P._requestRemoteResize.call(rfb);
            expect(setDesktopSize).to.not.have.been.called;
            rfb._forcedResolutionX = 1600;
            rfb._forcedResolutionY = 900;
            P._requestRemoteResize.call(rfb);
            expect(setDesktopSize).to.have.been.calledOnce;
        });
        [{ _viewOnly: true }, { _supportsSetDesktopSize: false }, { _resizeSession: false }].forEach((state) => {
            it(`should return early and leave the display alone for ${Object.keys(state)[0]}`, function () {
                const display = makeDisplay([makeScreen(0, { serverReportedWidth: 1920, serverReportedHeight: 1080 })]);
                P._requestRemoteResize.call(makeRfb(display, state));
                expect(setDesktopSize).to.not.have.been.called;
                expect(reported(display)).to.deep.equal([[1920, 1080]]);
            });
        });
    });

    describe('Secondary monitor unregister', function () {
        function unregister(size) {
            const calls = [];
            // control messages are only accepted over a registered link's private ports
            const closeable = () => ({ close() {} });
            const link = { windowId: 'w1', screenID: 'x', port: closeable(), channel: closeable(),
                           encodedFramePort: closeable() };
            const links = new SecondaryLinkManager({
                isConnected: () => true, handleControlMessage: () => {}, removeLinkedScreen: () => {},
            });
            links._links.set('w1', link);
            const rfb = makeRfb({ removeScreen: () => true, screens: [{ screenID: 'x' }] }, {
                _links: links,
                _rfbConnectionState: 'connected',
                _screenSize: () => size, dispatchEvent: () => {},
                _sendEncodings: () => calls.push('encodings'),
                _updateContinuousUpdates: () => calls.push('continuous')
            });
            P._handleControlMessage.call(rfb, { data: { eventType: 'unregister', screenID: 'x' } }, link);
            return calls;
        }

        it('should send the new size when it is valid', function () {
            unregister({ serverWidth: 1920, serverHeight: 1080 });
            expect(setDesktopSize).to.have.been.calledOnce;
        });
        it('should not send an oversize size but still refresh encodings', function () {
            const calls = unregister({ serverWidth: MAX_FB_SPAN + 1, serverHeight: 1080 });
            expect(setDesktopSize).to.not.have.been.called;
            expect(calls).to.deep.equal(['encodings', 'continuous']);
        });
    });

    describe('RFB._handleExtendedDesktopSize', function () {
        function receive(screens, fbu = { x: 0, y: 0, width: 1920, height: 1080 }) {
            const display = makeDisplay([makeScreen(0, { serverReportedWidth: 111, serverReportedHeight: 222 })]);
            display.resize = () => {};
            const values = [];
            screens.forEach(([w, h]) => values.push(0, 0, w, h));
            let next = 0;
            const sock = {
                rQwait: () => false, rQpeek8: () => screens.length, rQskipBytes: () => {},
                rQshift32: () => 7, rQshiftBytes: () => 0, rQshift16: () => values[next++]
            };
            const rfb = makeRfb(display, {
                _sock: sock, _FBU: fbu, _resize: P._resize, _fbWidth: 1024, _fbHeight: 768,
                _updateClip() {}, _updateScale() {}, _updateContinuousUpdates() {}
            });
            P._handleExtendedDesktopSize.call(rfb);
            return { display, rfb };
        }

        it('should store a valid reported screen', function () {
            expect(reported(receive([[1920, 1080]]).display)[0]).to.deep.equal([1920, 1080]);
        });
        it('should ignore an oversize reported screen and keep the previous value', function () {
            expect(reported(receive([[50000, 1080]]).display)[0]).to.deep.equal([111, 222]);
        });
        it('should not change the framebuffer size for an oversize update', function () {
            const { rfb } = receive([[1920, 1080]], { x: 0, y: 0, width: 100000, height: 100000 });
            expect([rfb._fbWidth, rfb._fbHeight]).to.deep.equal([1024, 768]);
        });
    });
});
