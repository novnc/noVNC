const expect = chai.expect;

import Base64 from '../core/base64.js';
import Display from '../core/display.js';

describe('Display/Canvas Helper', function () {
    const checked_data = new Uint8Array([
        0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255, 0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255,
        0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255, 0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255,
        0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255, 0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255,
        0x00, 0xff, 0x00, 255, 0x00, 0xff, 0x00, 255, 0x00, 0x00, 0xff, 255, 0x00, 0x00, 0xff, 255
    ]);

    const basic_data = new Uint8Array([0xff, 0x00, 0x00, 255, 0x00, 0xff, 0x00, 255, 0x00, 0x00, 0xff, 255, 0xff, 0xff, 0xff, 255]);

    function make_image_canvas(input_data) {
        const canvas = document.createElement('canvas');
        canvas.width = 4;
        canvas.height = 4;
        const ctx = canvas.getContext('2d');
        const data = ctx.createImageData(4, 4);
        for (let i = 0; i < checked_data.length; i++) { data.data[i] = input_data[i]; }
        ctx.putImageData(data, 0, 0);
        return canvas;
    }

    function make_image_png(input_data) {
        const canvas = make_image_canvas(input_data);
        const url = canvas.toDataURL();
        const data = url.split(",")[1];
        return Base64.decode(data);
    }

    describe('viewport handling', function () {
        let display;
        beforeEach(function () {
            display = new Display(document.createElement('canvas'));
            display.clipViewport = true;
            display.resize(5, 5);
            display.viewportChangeSize(3, 3);
            display.viewportChangePos(1, 1);
        });

        it('should take viewport location into consideration when drawing images', function () {
            display.resize(4, 4);
            display.viewportChangeSize(2, 2);
            display.drawImage(make_image_canvas(basic_data), 1, 1);
            display.flip();

            const expected = new Uint8Array(16);
            for (let i = 0; i < 8; i++) { expected[i] = basic_data[i]; }
            for (let i = 8; i < 16; i++) { expected[i] = 0; }
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

        it('should redraw when moving the viewport', function () {
            display.flip = sinon.spy();
            display.viewportChangePos(-1, 1);
            expect(display.flip).to.have.been.calledOnce;
        });

        it('should redraw when resizing the viewport', function () {
            display.flip = sinon.spy();
            display.viewportChangeSize(2, 2);
            expect(display.flip).to.have.been.calledOnce;
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
            display = new Display(document.createElement('canvas'));
            display.clipViewport = false;
            display.resize(4, 4);
        });

        it('should change the size of the logical canvas', function () {
            display.resize(5, 7);
            expect(display._fb_width).to.equal(5);
            expect(display._fb_height).to.equal(7);
        });

        it('should keep the framebuffer data', function () {
            display.fillRect(0, 0, 4, 4, [0, 0, 0xff]);
            display.resize(2, 2);
            display.flip();
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

            it('should keep the viewport position and size if possible', function () {
                display.resize(6, 6);
                expect(display.absX(0)).to.equal(1);
                expect(display.absY(0)).to.equal(1);
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
            display = new Display(canvas);
            display.clipViewport = true;
            display.resize(4, 4);
            display.viewportChangeSize(3, 3);
            display.viewportChangePos(1, 1);
            document.body.appendChild(canvas);
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
            display = new Display(canvas);
            display.clipViewport = true;
            display.resize(4, 3);
            display.viewportChangeSize(4, 3);
            document.body.appendChild(canvas);
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
        let display;
        beforeEach(function () {
            display = new Display(document.createElement('canvas'));
            display.resize(4, 4);
        });

        it('should not draw directly on the target canvas', function () {
            display.fillRect(0, 0, 4, 4, [0, 0, 0xff]);
            display.flip();
            display.fillRect(0, 0, 4, 4, [0, 0xff, 0]);
            const expected = [];
            for (let i = 0; i < 4 * display._fb_width * display._fb_height; i += 4) {
                expected[i] = 0xff;
                expected[i+1] = expected[i+2] = 0;
                expected[i+3] = 0xff;
            }
            expect(display).to.have.displayed(new Uint8Array(expected));
        });

        it('should support filling a rectangle with particular color via #fillRect', function () {
            display.fillRect(0, 0, 4, 4, [0, 0xff, 0]);
            display.fillRect(0, 0, 2, 2, [0xff, 0, 0]);
            display.fillRect(2, 2, 2, 2, [0xff, 0, 0]);
            display.flip();
            expect(display).to.have.displayed(checked_data);
        });

        it('should support copying an portion of the canvas via #copyImage', function () {
            display.fillRect(0, 0, 4, 4, [0, 0xff, 0]);
            display.fillRect(0, 0, 2, 2, [0xff, 0, 0x00]);
            display.copyImage(0, 0, 2, 2, 2, 2);
            display.flip();
            expect(display).to.have.displayed(checked_data);
        });

        it('should support drawing images via #imageRect', function (done) {
            display.imageRect(0, 0, 4, 4, "image/png", make_image_png(checked_data));
            display.flip();
            display.onflush = () => {
                expect(display).to.have.displayed(checked_data);
                done();
            };
            display.flush();
        });

        it('should support drawing tile data with a background color and sub tiles', function () {
            display.startTile(0, 0, 4, 4, [0, 0xff, 0]);
            display.subTile(0, 0, 2, 2, [0xff, 0, 0]);
            display.subTile(2, 2, 2, 2, [0xff, 0, 0]);
            display.finishTile();
            display.flip();
            expect(display).to.have.displayed(checked_data);
        });

        // We have a special cache for 16x16 tiles that we need to test
        it('should support drawing a 16x16 tile', function () {
            const large_checked_data = new Uint8Array(16*16*4);
            display.resize(16, 16);

            for (let y = 0;y < 16;y++) {
                for (let x = 0;x < 16;x++) {
                    let pixel;
                    if ((x < 4) && (y < 4)) {
                        // NB: of course IE11 doesn't support #slice on ArrayBufferViews...
                        pixel = Array.prototype.slice.call(checked_data, (y*4+x)*4, (y*4+x+1)*4);
                    } else {
                        pixel = [0, 0xff, 0, 255];
                    }
                    large_checked_data.set(pixel, (y*16+x)*4);
                }
            }

            display.startTile(0, 0, 16, 16, [0, 0xff, 0]);
            display.subTile(0, 0, 2, 2, [0xff, 0, 0]);
            display.subTile(2, 2, 2, 2, [0xff, 0, 0]);
            display.finishTile();
            display.flip();
            expect(display).to.have.displayed(large_checked_data);
        });

        it('should support drawing BGRX blit images with true color via #blitImage', function () {
            const data = [];
            for (let i = 0; i < 16; i++) {
                data[i * 4] = checked_data[i * 4 + 2];
                data[i * 4 + 1] = checked_data[i * 4 + 1];
                data[i * 4 + 2] = checked_data[i * 4];
                data[i * 4 + 3] = checked_data[i * 4 + 3];
            }
            display.blitImage(0, 0, 4, 4, data, 0);
            display.flip();
            expect(display).to.have.displayed(checked_data);
        });

        it('should support drawing RGB blit images with true color via #blitRgbImage', function () {
            const data = [];
            for (let i = 0; i < 16; i++) {
                data[i * 3] = checked_data[i * 4];
                data[i * 3 + 1] = checked_data[i * 4 + 1];
                data[i * 3 + 2] = checked_data[i * 4 + 2];
            }
            display.blitRgbImage(0, 0, 4, 4, data, 0);
            display.flip();
            expect(display).to.have.displayed(checked_data);
        });

        it('should support drawing an image object via #drawImage', function () {
            const img = make_image_canvas(checked_data);
            display.drawImage(img, 0, 0);
            display.flip();
            expect(display).to.have.displayed(checked_data);
        });
    });

    describe('the render queue processor', function () {
        let display;
        beforeEach(function () {
            display = new Display(document.createElement('canvas'));
            display.resize(4, 4);
            sinon.spy(display, '_scan_renderQ');
        });

        afterEach(function () {
            window.requestAnimationFrame = this.old_requestAnimationFrame;
        });

        it('should try to process an item when it is pushed on, if nothing else is on the queue', function () {
            display._renderQ_push({ type: 'noop' });  // does nothing
            expect(display._scan_renderQ).to.have.been.calledOnce;
        });

        it('should not try to process an item when it is pushed on if we are waiting for other items', function () {
            display._renderQ.length = 2;
            display._renderQ_push({ type: 'noop' });
            expect(display._scan_renderQ).to.not.have.been.called;
        });

        it('should wait until an image is loaded to attempt to draw it and the rest of the queue', function () {
            const img = { complete: false, width: 4, height: 4, addEventListener: sinon.spy() };
            display._renderQ = [{ type: 'img', x: 3, y: 4, width: 4, height: 4, img: img },
                                { type: 'fill', x: 1, y: 2, width: 3, height: 4, color: 5 }];
            display.drawImage = sinon.spy();
            display.fillRect = sinon.spy();

            display._scan_renderQ();
            expect(display.drawImage).to.not.have.been.called;
            expect(display.fillRect).to.not.have.been.called;
            expect(img.addEventListener).to.have.been.calledOnce;

            display._renderQ[0].img.complete = true;
            display._scan_renderQ();
            expect(display.drawImage).to.have.been.calledOnce;
            expect(display.fillRect).to.have.been.calledOnce;
            expect(img.addEventListener).to.have.been.calledOnce;
        });

        it('should wait if an image is incorrectly loaded', function () {
            const img = { complete: true, width: 0, height: 0, addEventListener: sinon.spy() };
            display._renderQ = [{ type: 'img', x: 3, y: 4, width: 4, height: 4, img: img },
                                { type: 'fill', x: 1, y: 2, width: 3, height: 4, color: 5 }];
            display.drawImage = sinon.spy();
            display.fillRect = sinon.spy();

            display._scan_renderQ();
            expect(display.drawImage).to.not.have.been.called;
            expect(display.fillRect).to.not.have.been.called;
            expect(img.addEventListener).to.have.been.calledOnce;

            display._renderQ[0].img.complete = true;
            display._renderQ[0].img.width = 4;
            display._renderQ[0].img.height = 4;
            display._scan_renderQ();
            expect(display.drawImage).to.have.been.calledOnce;
            expect(display.fillRect).to.have.been.calledOnce;
            expect(img.addEventListener).to.have.been.calledOnce;
        });

        it('should call callback when queue is flushed', function () {
            display.onflush = sinon.spy();
            display.fillRect(0, 0, 4, 4, [0, 0xff, 0]);
            expect(display.onflush).to.not.have.been.called;
            display.flush();
            expect(display.onflush).to.have.been.calledOnce;
        });

        it('should draw a blit image on type "blit"', function () {
            display.blitImage = sinon.spy();
            display._renderQ_push({ type: 'blit', x: 3, y: 4, width: 5, height: 6, data: [7, 8, 9] });
            expect(display.blitImage).to.have.been.calledOnce;
            expect(display.blitImage).to.have.been.calledWith(3, 4, 5, 6, [7, 8, 9], 0);
        });

        it('should draw a blit RGB image on type "blitRgb"', function () {
            display.blitRgbImage = sinon.spy();
            display._renderQ_push({ type: 'blitRgb', x: 3, y: 4, width: 5, height: 6, data: [7, 8, 9] });
            expect(display.blitRgbImage).to.have.been.calledOnce;
            expect(display.blitRgbImage).to.have.been.calledWith(3, 4, 5, 6, [7, 8, 9], 0);
        });

        it('should copy a region on type "copy"', function () {
            display.copyImage = sinon.spy();
            display._renderQ_push({ type: 'copy', x: 3, y: 4, width: 5, height: 6, old_x: 7, old_y: 8 });
            expect(display.copyImage).to.have.been.calledOnce;
            expect(display.copyImage).to.have.been.calledWith(7, 8, 3, 4, 5, 6);
        });

        it('should fill a rect with a given color on type "fill"', function () {
            display.fillRect = sinon.spy();
            display._renderQ_push({ type: 'fill', x: 3, y: 4, width: 5, height: 6, color: [7, 8, 9]});
            expect(display.fillRect).to.have.been.calledOnce;
            expect(display.fillRect).to.have.been.calledWith(3, 4, 5, 6, [7, 8, 9]);
        });

        it('should draw an image from an image object on type "img" (if complete)', function () {
            display.drawImage = sinon.spy();
            display._renderQ_push({ type: 'img', x: 3, y: 4, img: { complete: true } });
            expect(display.drawImage).to.have.been.calledOnce;
            expect(display.drawImage).to.have.been.calledWith({ complete: true }, 3, 4);
        });
    });
});
