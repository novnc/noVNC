const expect = chai.expect;

import Base64 from '../core/base64.js';
import Display from '../core/display.js';
import makeCanvas, { sizeDisplay } from './fake.canvas.js';

describe('Display/Canvas Helper', function () {
    const checkedData = new Uint8ClampedArray([
        0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255, 0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255,
        0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255, 0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255,
        0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255, 0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255,
        0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255, 0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255
    ]);

    const basicData = new Uint8ClampedArray([0xff, 0x00, 0x00, 255, 0x00, 0xff, 0x00, 255, 0x00, 0x00, 0xff, 255, 0xff, 0xff, 0xff, 255]);

    function makeImageCanvas(inputData, width, height) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        const data = new ImageData(inputData, width, height);
        ctx.putImageData(data, 0, 0);
        return canvas;
    }

    function makeImagePng(inputData, width, height) {
        const canvas = makeImageCanvas(inputData, width, height);
        const url = canvas.toDataURL();
        const data = url.split(",")[1];
        return Base64.decode(data);
    }

    describe('viewport handling', function () {
        let display;
        beforeEach(function () {
            display = new Display(makeCanvas());
            display.clipViewport = true;
            display.resize(5, 5);
            display.viewportChangeSize(3, 3);
            display.viewportChangePos(1, 1);
        });

        it('should draw images relative to the origin of the target canvas', function () {
            display.resize(4, 4);
            display.viewportChangeSize(2, 2);
            display.drawImage(makeImageCanvas(basicData, 4, 1), 1, 1, 4, 1);

            // the viewport no longer pans, so only the first pixel lands inside the 2x2 target
            const expected = new Uint8Array(16);
            for (let i = 0; i < 4; i++) { expected[12 + i] = basicData[i]; }
            expect(display).to.have.displayed(expected);
        });

        it('should resize the target canvas when resizing the viewport', function () {
            display.viewportChangeSize(2, 2);
            expect(display._target.width).to.equal(2);
            expect(display._target.height).to.equal(2);
        });

        it('should move the viewport if necessary', function () {
            display.viewportChangeSize(5, 5);
            expect(display.absX(0)).to.equal(0);
            expect(display.absY(0)).to.equal(0);
            expect(display._target.width).to.equal(5);
            expect(display._target.height).to.equal(5);
        });

        it('should limit the viewport to the framebuffer size', function () {
            display.viewportChangeSize(6, 6);
            expect(display._target.width).to.equal(5);
            expect(display._target.height).to.equal(5);
        });

        it('should rescale the target when resizing the viewport', function () {
            display._rescale = sinon.spy();
            display.viewportChangeSize(2, 2);
            expect(display._rescale).to.have.been.calledOnce;
        });

        it('should not move the viewport, panning is handled by the screen layout', function () {
            display.viewportChangePos(-1, 1);
            expect(display.absX(0)).to.equal(0);
            expect(display.absY(0)).to.equal(0);
        });

        it('should show the entire framebuffer when disabling the viewport', function () {
            display.clipViewport = false;
            expect(display.absX(0)).to.equal(0);
            expect(display.absY(0)).to.equal(0);
            expect(display._target.width).to.equal(5);
            expect(display._target.height).to.equal(5);
        });

        it('should ignore viewport changes when the viewport is disabled', function () {
            display.clipViewport = false;
            display.viewportChangeSize(2, 2);
            display.viewportChangePos(1, 1);
            expect(display.absX(0)).to.equal(0);
            expect(display.absY(0)).to.equal(0);
            expect(display._target.width).to.equal(5);
            expect(display._target.height).to.equal(5);
        });

        it('should show the entire framebuffer just after enabling the viewport', function () {
            display.clipViewport = false;
            display.clipViewport = true;
            expect(display.absX(0)).to.equal(0);
            expect(display.absY(0)).to.equal(0);
            expect(display._target.width).to.equal(5);
            expect(display._target.height).to.equal(5);
        });
    });

    describe('resizing', function () {
        let display;
        beforeEach(function () {
            display = new Display(makeCanvas());
            display.clipViewport = false;
            display.resize(4, 4);
        });

        it('should change the size of the logical canvas', function () {
            display.resize(5, 7);
            expect(display._fbWidth).to.equal(5);
            expect(display._fbHeight).to.equal(7);
        });

        it('should keep the framebuffer data', function () {
            display.fillRect(0, 0, 4, 4, [0xff, 0, 0], 0, true);
            display.resize(2, 2);
            const expected = [];
            for (let i = 0; i < 4 * 2*2; i += 4) {
                expected[i] = 0xff;
                expected[i+1] = expected[i+2] = 0;
                expected[i+3] = 0xff;
            }
            expect(display).to.have.displayed(new Uint8Array(expected));
        });

        describe('viewport', function () {
            beforeEach(function () {
                display.clipViewport = true;
                display.viewportChangeSize(3, 3);
                display.viewportChangePos(1, 1);
            });

            it('should keep the viewport size if possible and reset its position', function () {
                display.resize(6, 6);
                // resize() always puts the viewport back at the origin
                expect(display.absX(0)).to.equal(0);
                expect(display.absY(0)).to.equal(0);
                expect(display._target.width).to.equal(3);
                expect(display._target.height).to.equal(3);
            });

            it('should move the viewport if necessary', function () {
                display.resize(3, 3);
                expect(display.absX(0)).to.equal(0);
                expect(display.absY(0)).to.equal(0);
                expect(display._target.width).to.equal(3);
                expect(display._target.height).to.equal(3);
            });

            it('should shrink the viewport if necessary', function () {
                display.resize(2, 2);
                expect(display.absX(0)).to.equal(0);
                expect(display.absY(0)).to.equal(0);
                expect(display._target.width).to.equal(2);
                expect(display._target.height).to.equal(2);
            });
        });
    });

    describe('rescaling', function () {
        let display;
        let canvas;

        beforeEach(function () {
            canvas = document.createElement('canvas');
            document.body.appendChild(canvas);
            display = new Display(canvas);
            display.clipViewport = true;
            display.resize(4, 4);
            display.viewportChangeSize(3, 3);
            display.viewportChangePos(1, 1);
        });

        afterEach(function () {
            document.body.removeChild(canvas);
        });

        it('should not change the bitmap size of the canvas', function () {
            display.scale = 2.0;
            expect(canvas.width).to.equal(3);
            expect(canvas.height).to.equal(3);
        });

        it('should change the effective rendered size of the canvas', function () {
            display.scale = 2.0;
            expect(canvas.clientWidth).to.equal(6);
            expect(canvas.clientHeight).to.equal(6);
        });

        it('should not change when resizing', function () {
            display.scale = 2.0;
            display.resize(5, 5);
            expect(display.scale).to.equal(2.0);
            expect(canvas.width).to.equal(3);
            expect(canvas.height).to.equal(3);
            expect(canvas.clientWidth).to.equal(6);
            expect(canvas.clientHeight).to.equal(6);
        });
    });

    describe('autoscaling', function () {
        let display;
        let canvas;

        beforeEach(function () {
            canvas = document.createElement('canvas');
            document.body.appendChild(canvas);
            display = new Display(canvas);
            display.clipViewport = true;
            display.resize(4, 3);
            display.viewportChangeSize(4, 3);
            // autoscale compares the aspect ratio of the client area, not the framebuffer
            display.screens[0].width = 4;
            display.screens[0].height = 3;
        });

        afterEach(function () {
            document.body.removeChild(canvas);
        });

        it('should preserve aspect ratio while autoscaling', function () {
            display.autoscale(16, 9);
            expect(canvas.clientWidth / canvas.clientHeight).to.equal(4 / 3);
        });

        it('should use width to determine scale when the current aspect ratio is wider than the target', function () {
            display.autoscale(9, 16);
            expect(display.absX(9)).to.equal(4);
            expect(display.absY(18)).to.equal(8);
            expect(canvas.clientWidth).to.equal(9);
            expect(canvas.clientHeight).to.equal(7); // round 9 / (4 / 3)
        });

        it('should use height to determine scale when the current aspect ratio is taller than the target', function () {
            display.autoscale(16, 9);
            expect(display.absX(9)).to.equal(3);
            expect(display.absY(18)).to.equal(6);
            expect(canvas.clientWidth).to.equal(12);  // 16 * (4 / 3)
            expect(canvas.clientHeight).to.equal(9);

        });

        it('should not change the bitmap size of the canvas', function () {
            display.autoscale(16, 9);
            expect(canvas.width).to.equal(4);
            expect(canvas.height).to.equal(3);
        });
    });

    describe('drawing', function () {

        // TODO(directxman12): improve the tests for each of the drawing functions to cover more than just the
        //                     basic cases
        //
        // fillRect, copyImage, blitImage and imageRect only queue a rect for a frame, nothing reaches
        // the canvas until the frame is flushed. drawImage and the fromQueue variants draw immediately.
        let display;
        beforeEach(function () {
            display = new Display(makeCanvas());
            sizeDisplay(display, 4, 4);
        });

        it('should not draw directly on the target canvas', function () {
            display.fillRect(0, 0, 4, 4, [0xff, 0, 0], 1);
            display.flush(false);
            display.fillRect(0, 0, 4, 4, [0, 0xff, 0], 2);
            const expected = [];
            for (let i = 0; i < 4 * display._fbWidth * display._fbHeight; i += 4) {
                expected[i] = 0xff;
                expected[i+1] = expected[i+2] = 0;
                expected[i+3] = 0xff;
            }
            expect(display).to.have.displayed(new Uint8Array(expected));
        });

        it('should support filling a rectangle with particular color via #fillRect', function () {
            display.fillRect(0, 0, 4, 4, [0, 0xff, 0], 1);
            display.fillRect(0, 0, 2, 2, [0, 0, 0xff], 1);
            display.fillRect(2, 2, 2, 2, [0, 0, 0xff], 1);
            display.flush(false);
            expect(display).to.have.displayed(checkedData);
        });

        it('should support copying an portion of the canvas via #copyImage', function () {
            display.fillRect(0, 0, 4, 4, [0, 0xff, 0], 0, true);
            display.fillRect(0, 0, 2, 2, [0, 0, 0xff], 0, true);
            display.copyImage(0, 0, 2, 2, 2, 2, 1);
            display.flush(false);
            expect(display).to.have.displayed(checkedData);
        });

        it('should support drawing images via #imageRect', function (done) {
            display.imageRect(0, 0, 4, 4, "image/png", makeImagePng(checkedData, 4, 4), 1);

            // the image is decoded asynchronously and only joins the frame queue once ready
            const queued = () => display._asyncFrameQueue.some((frame) => frame[2].length > 0);
            const waitForImage = (tries = 100) => new Promise((resolve, reject) => {
                const check = () => {
                    if (queued()) { resolve(); } else if (tries-- <= 0) { reject(new Error('image was never queued')); } else { setTimeout(check, 20); }
                };
                check();
            });

            waitForImage().then(() => {
                display.onflush = () => {
                    try {
                        expect(display).to.have.displayed(checkedData);
                        done();
                    } catch (e) {
                        done(e);
                    }
                };
                display.flush();
            }).catch(done);
        });

        it('should support blit images with true color via #blitImage', function () {
            display.blitImage(0, 0, 4, 4, checkedData, 0, 1);
            display.flush(false);
            expect(display).to.have.displayed(checkedData);
        });

        it('should blit from the given offset into the data', function () {
            const padded = new Uint8Array(checkedData.length + 8);
            padded.set(checkedData, 8);
            display.blitImage(0, 0, 4, 4, padded, 8, 1);
            display.flush(false);
            expect(display).to.have.displayed(checkedData);
        });

        it('should support drawing an image object via #drawImage', function () {
            const img = makeImageCanvas(checkedData, 4, 4);
            display.drawImage(img, 0, 0, 4, 4);
            expect(display).to.have.displayed(checkedData);
        });
    });

    describe('delivering a rect that spans several screens', function () {
        let display;
        const screen = () => ({ x: 0, y: 0, x2: 100, y2: 100, channel: { postMessage: sinon.spy() } });
        const rectCalls = s => s.channel.postMessage.getCalls().filter(c => c.args[0].eventType === 'rect');
        const push = (rect) => {
            display._asyncFrameQueue[0] = [1, 0, [rect], true, 1, 0];
            display._pushAsyncFrame(true);
        };

        beforeEach(function () {
            display = new Display(makeCanvas());
            display._screens = [{ x: 0, y: 0, x2: 10, y2: 10 }, screen(), screen()];
        });

        it('should transfer the buffer only to the last screen and copy it for the others', function () {
            const data = new Uint8Array(16);
            const rect = { type: 'blit', x: 0, y: 0, width: 2, height: 2, data, 'frame_id': 1,
                           screenLocations: [{ screenIndex: 1, x: 0, y: 0 }, { screenIndex: 2, x: 0, y: 0 }] };
            push(rect);
            const [first, second] = [display._screens[1], display._screens[2]].map(rectCalls);
            expect(first).to.have.lengthOf(1);
            expect(second).to.have.lengthOf(1);
            expect(first[0].args[1]).to.deep.equal([]);
            expect(second[0].args[1]).to.deep.equal([data.buffer]);
        });

        it('should keep the primary readable when it is not the last destination', function () {
            display.blitImage = sinon.spy();
            const data = new Uint8Array(16);
            const rect = { type: 'blit', x: 0, y: 0, width: 2, height: 2, data, 'frame_id': 1,
                           screenLocations: [{ screenIndex: 1, x: 0, y: 0 }, { screenIndex: 0, x: 0, y: 0 }] };
            push(rect);
            expect(rectCalls(display._screens[1])[0].args[1]).to.deep.equal([]);
            expect(display.blitImage).to.have.been.calledOnce;
        });

        it('should transfer to the last screen that really receives the rect, not to a removed one', function () {
            const data = new Uint8Array(16);
            push({ type: 'blit', x: 0, y: 0, width: 2, height: 2, data, 'frame_id': 1,
                   screenLocations: [{ screenIndex: 1, x: 0, y: 0 }, { screenIndex: 2, x: 0, y: 0 }, { screenIndex: 9, x: 0, y: 0 }] });
            expect(rectCalls(display._screens[1])[0].args[1]).to.deep.equal([]);
            expect(rectCalls(display._screens[2])[0].args[1]).to.deep.equal([data.buffer]);
        });

        it('should send only the bytes of a blit that is a view into a larger buffer', function () {
            const backing = new Uint8Array(64);
            backing.set([1, 2, 3, 4, 5, 6, 7, 8], 16);
            const view = backing.subarray(16, 24);
            push({ type: 'blit', x: 0, y: 0, width: 2, height: 1, data: view, 'frame_id': 1,
                   screenLocations: [{ screenIndex: 1, x: 0, y: 0 }] });
            const sent = rectCalls(display._screens[1])[0].args[0].rect.data;
            expect(new Uint8Array(sent)).to.deep.equal(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
        });

        it('should give every secondary the right bytes of a blit that is a view into a larger buffer', function () {
            const backing = new Uint8Array(64);
            backing.set([1, 2, 3, 4, 5, 6, 7, 8], 16);
            push({ type: 'blit', x: 0, y: 0, width: 2, height: 1, data: backing.subarray(16, 24), 'frame_id': 1,
                   screenLocations: [{ screenIndex: 1, x: 0, y: 0 }, { screenIndex: 2, x: 0, y: 0 }] });
            for (const index of [1, 2]) {
                const sent = rectCalls(display._screens[index])[0].args[0].rect.data;
                expect(new Uint8Array(sent)).to.deep.equal(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
            }
        });

        it('should let the secondaries take a video frame before the primary draws and closes it', function () {
            const events = [];
            const f = { close: () => events.push('close'), format: 'I420' };
            display._screens[1].encodedFramePort = {};
            display._screens[2].channel = { postMessage: () => events.push('secondary') };
            display._screens[2].encodedFramePort = null;
            display.drawVideoFrame = () => events.push('primary');
            const OriginalCreate = window.createImageBitmap;
            window.createImageBitmap = () => { events.push('bitmap'); return Promise.resolve({}); };
            try {
                push({ type: 'video_frame', frame: f, x: 0, y: 0, width: 2, height: 2,
                       screenLocations: [{ screenIndex: 0, x: 0, y: 0 }, { screenIndex: 2, x: 0, y: 0 }, { screenIndex: 1, x: 0, y: 0 }] });
            } finally {
                window.createImageBitmap = OriginalCreate;
            }
            expect(events.indexOf('bitmap')).to.be.below(events.indexOf('primary'));
            expect(events.filter(e => e === 'close')).to.have.lengthOf(1);
            expect(events.indexOf('close')).to.be.above(events.indexOf('primary'));
        });

        const frame = () => ({ close: sinon.spy(), format: null });

        it('should release a video frame when every screen it was meant for is gone', function () {
            const f = frame();
            push({ type: 'video_frame', frame: f, x: 0, y: 0, width: 2, height: 2,
                   screenLocations: [{ screenIndex: 7, x: 0, y: 0 }, { screenIndex: 8, x: 0, y: 0 }] });
            expect(f.close).to.have.been.calledOnce;
        });

        it('should not release a video frame another location still draws', function () {
            const f = frame();
            display.drawVideoFrame = sinon.spy();
            push({ type: 'video_frame', frame: f, x: 0, y: 0, width: 2, height: 2,
                   screenLocations: [{ screenIndex: 7, x: 0, y: 0 }, { screenIndex: 0, x: 0, y: 0 }] });
            expect(display.drawVideoFrame).to.have.been.calledOnce;
            expect(f.close).to.not.have.been.called;
        });
    });

    describe('routing rects when there is only the primary screen', function () {
        it('should send every rect to the primary even if its bounds were never computed', function () {
            const display = new Display(makeCanvas());
            display._screens = [{ x: 0, y: 0, x2: 0, y2: 0 }];
            for (const [x, y, w, h] of [[0, 0, 10, 10], [1900, 1000, 20, 20], [5000, 4000, 8, 8]]) {
                const rect = { type: 'blit', x, y, width: w, height: h };
                display._processRectScreens(rect);
                expect(rect.screenLocations.map(l => l.screenIndex)).to.deep.equal([0]);
            }
        });
    });

    describe('adding a screen', function () {
        it('should refuse anything that is not a screen description', function () {
            const display = new Display(makeCanvas());
            for (const bad of [undefined, null, 'id', 5]) {
                expect(() => display.addScreen(bad), String(bad)).to.throw(TypeError);
            }
        });
    });

    describe('disposing a secondary display', function () {
        it('should close the ports it was given', function () {
            const display = new Display(makeCanvas());
            const port = () => ({ close: sinon.spy(), onmessage: () => {} });
            const rects = port(), frames = port();
            display._displayPort = rects;
            display._encodedFramePort = frames;
            display.dispose();
            expect(rects.close).to.have.been.calledOnce;
            expect(frames.close).to.have.been.calledOnce;
            expect(rects.onmessage).to.equal(null);
            expect(display._displayPort).to.equal(null);
        });
    });

    describe('viewport size and the primary screen bounds', function () {
        it('should keep the cached bounds in step with the viewport size', function () {
            const display = new Display(makeCanvas());
            display._renderer = { viewportChangeSize: () => true };
            display._fbWidth = 1920;
            display._fbHeight = 1080;
            display._screens = [{ x: 0, y: 0, x2: 1280, y2: 720, serverWidth: 1280, serverHeight: 720 }];
            display.viewportChangePos = () => {};
            display._rescale = () => {};
            display.viewportChangeSize(1920, 1080);
            expect([display._screens[0].x2, display._screens[0].y2]).to.deep.equal([1920, 1080]);
            const rect = { type: 'blit', x: 1500, y: 900, width: 10, height: 10 };
            display._processRectScreens(rect);
            expect(rect.screenLocations.map(l => l.screenIndex)).to.deep.equal([0]);
        });
    });

    describe('routing rects when a screen has no computed bounds yet', function () {
        it('should treat it as covering everything and still route to a screen with bounds', function () {
            const display = new Display(makeCanvas());
            display._screens = [{ x: 0, y: 0, x2: 0, y2: 0 }, { x: 1878, y: 0, x2: 2802, y2: 868 }];
            const route = (x, y, w, h) => {
                const rect = { type: 'blit', x, y, width: w, height: h };
                display._processRectScreens(rect);
                return rect.screenLocations.map(l => l.screenIndex);
            };
            expect(route(10, 10, 20, 20)).to.deep.equal([0]);
            expect(route(2000, 100, 20, 20)).to.deep.equal([0, 1]);
        });

        it('should not route anything to a secondary screen with zero size', function () {
            const display = new Display(makeCanvas());
            display._screens = [{ x: 0, y: 0, x2: 0, y2: 0 }, { x: 1878, y: 0, x2: 1878, y2: 0 }];
            const rect = { type: 'blit', x: 1800, y: 10, width: 200, height: 20 };
            display._processRectScreens(rect);
            expect(rect.screenLocations.map(l => l.screenIndex)).to.deep.equal([0]);
        });
    });

    describe('translating pointer coordinates for a screen', function () {
        it('should not divide by a screen scale of zero', function () {
            const display = new Display(makeCanvas());
            display._screens = [{ x: 0, y: 0, scale: 1 }, { x: 100, y: 50, scale: 0 }];
            expect(display.getServerRelativeCoordinates(1, 10, 20)).to.deep.equal([110, 70]);
        });

        it('should divide by the scale of a laid out screen', function () {
            const display = new Display(makeCanvas());
            display._screens = [{ x: 0, y: 0, scale: 1 }, { x: 100, y: 50, scale: 2 }];
            expect(display.getServerRelativeCoordinates(1, 10, 20)).to.deep.equal([105, 60]);
        });
    });

    describe('routing rects to screens', function () {
        let display;
        const route = (x, y, width, height) => {
            const rect = { type: 'blit', x, y, width, height };
            display._processRectScreens(rect);
            return rect.screenLocations.map(l => l.screenIndex);
        };

        beforeEach(function () {
            display = new Display(makeCanvas());
            display._screens = [
                { x: 0, y: 0, x2: 1878, y2: 842 },
                { x: 1878, y: 55, x2: 3756, y2: 959 },
            ];
        });

        it('should send a rect that is only on the primary display to the primary only', function () {
            expect(route(100, 100, 50, 50)).to.deep.equal([0]);
        });

        it('should send a rect that is only on the second display to the second only', function () {
            expect(route(2000, 200, 50, 50)).to.deep.equal([1]);
        });

        it('should not send a rect to a display it only shares a vertical range with', function () {
            expect(route(0, 60, 1000, 700)).to.deep.equal([0]);
        });

        it('should not send a rect to a display it only shares a horizontal range with', function () {
            expect(route(100, 10, 50, 20)).to.deep.equal([0]);
            expect(route(2000, 900, 50, 50)).to.deep.equal([1]);
        });

        it('should send a rect that straddles both displays to both', function () {
            expect(route(1800, 100, 200, 50)).to.deep.equal([0, 1]);
        });

        it('should not send a rect to a display it only touches at an edge', function () {
            expect(route(0, 100, 1878, 50)).to.deep.equal([0]);
            expect(route(1878, 100, 100, 50)).to.deep.equal([1]);
            expect(route(100, 842, 50, 50)).to.deep.equal([]);
            expect(route(2000, 959, 50, 50)).to.deep.equal([]);
        });

        it('should send a rect outside every display to none', function () {
            expect(route(4000, 2000, 10, 10)).to.deep.equal([]);
        });
    });
});
