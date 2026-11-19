const expect = chai.expect;

import Display from '../core/display.js';
import makeCanvas, { sizeDisplay } from './fake.canvas.js';

// Every VideoFrame the Display is handed must be closed; one that is only garbage
// collected triggers a browser warning and holds decoder memory until then.
describe('Display VideoFrame lifetime', function () {
    let display;
    let closed;

    function makeFrame() {
        return {
            format: 'I420',
            displayWidth: 2, displayHeight: 2, codedWidth: 2, codedHeight: 2,
            close() { closed++; },
        };
    }

    function addSecondary(screenID, encodedFramePort) {
        const channel = { postMessage() {}, close() {} };
        display.addScreen({
            screenID, width: 2, height: 2, pixelRatio: 1, containerHeight: 2, containerWidth: 2, scale: 1,
            serverWidth: 4, serverHeight: 2, x: 2, y: 0, windowId: 'win-' + screenID, channel, encodedFramePort,
        });
    }

    beforeEach(function () {
        closed = 0;
        display = new Display(makeCanvas(), null, true);
        sizeDisplay(display, 4, 2);
    });

    it('should not announce a screen again on the channel it already has', function () {
        const channel = { postMessage: sinon.spy(), close() {} };
        const spec = {
            screenID: 8, width: 2, height: 2, pixelRatio: 1, containerHeight: 2, containerWidth: 2, scale: 1,
            serverWidth: 4, serverHeight: 2, x: 2, y: 0, windowId: 'win-8', channel,
        };
        display.addScreen(spec);
        channel.postMessage.resetHistory();
        display.addScreen({ ...spec, x: 3 });
        expect(channel.postMessage).to.not.have.been.called;
        display.addScreen({ ...spec, channel: { postMessage: sinon.spy(), close() {} } });
    });

    it('should update a screen that is added again with a new position', function () {
        addSecondary(7, null);
        const screen = display.screens.find(s => s.screenID === 7);
        const channel = { postMessage: sinon.spy(), close() {} };
        const changed = display.addScreen({
            screenID: 7, width: 3, height: 3, pixelRatio: 1, containerHeight: 3, containerWidth: 3, scale: 1,
            serverWidth: 5, serverHeight: 3, x: 4, y: 6, windowId: 'win-7', channel,
        });
        expect(changed).to.be.true;
        expect([screen.x, screen.y, screen.x2, screen.y2]).to.deep.equal([4, 6, 9, 9]);
        expect(channel.postMessage).to.have.been.calledOnce;
    });

    it('should close the oldest bitmap when a popup queue overflows', function () {
        display._isPrimaryDisplay = false;
        const bitmap = () => ({ close() { closed++; } });
        display._syncFrameQueue = [];
        for (let i = 0; i < 5000; i++) {
            display._syncFrameQueue.push({ type: 'bitmap', img: bitmap() });
        }
        const rect = { type: 'bitmap', img: bitmap(), screenLocations: [{ x: 0, y: 0 }] };
        display._handleSecondaryDisplayMessage({ data: { eventType: 'rect', rect, screenLocationIndex: 0 } });
        expect(display._syncFrameQueue.length).to.equal(5000);
        expect(closed).to.equal(1);
    });

    it('should close a frame whose screen was removed while it was queued', function () {
        addSecondary(7, null);
        const screenIndex = display.screens.findIndex(s => s.screenID === 7);
        display.videoFrameRect(screenIndex, makeFrame(), 1, 2, 0, 2, 2);

        display.removeScreen(7);
        display.flush(false);

        expect(closed).to.equal(1);
    });

    it('should close a frame sent through the ImageBitmap fallback', async function () {
        addSecondary(7, null);
        const screenIndex = display.screens.findIndex(s => s.screenID === 7);
        const origCreate = window.createImageBitmap;
        window.createImageBitmap = () => Promise.resolve({});
        try {
            display.videoFrameRect(screenIndex, makeFrame(), 1, 2, 0, 2, 2);
            display.flush(false);
            await new Promise(r => setTimeout(r, 0));
            expect(closed).to.equal(1);

            window.createImageBitmap = () => Promise.reject(new Error('boom'));
            display.videoFrameRect(screenIndex, makeFrame(), 2, 2, 0, 2, 2);
            display.flush(false);
            await new Promise(r => setTimeout(r, 0));
            expect(closed).to.equal(2);
        } finally {
            window.createImageBitmap = origCreate;
        }
    });

    function makeImage() {
        return { width: 2, height: 2, close() { closed++; } };
    }

    function pushImage(type, frameId) {
        const rect = { type, img: makeImage(), x: 0, y: 0, width: 2, height: 2, 'frame_id': frameId };
        display._processRectScreens(rect);
        display._asyncRenderQPush(rect);
        return rect;
    }

    ['vid', 'bitmap'].forEach((type) => {
        it(`should close a ${type} image once it has been drawn on the primary`, function () {
            pushImage(type, 1);
            display.flush(false);
            expect(closed).to.equal(1);
        });

        it(`should close a ${type} image whose frame was cleared before it was drawn`, function () {
            pushImage(type, 1);
            expect(closed).to.equal(0);
            display._clearAsyncQueue();
            expect(closed).to.equal(1);
        });

        it(`should close a ${type} image whose id falls between queued frames`, function () {
            const slots = display._maxAsyncFrameQueue;
            for (let i = 0; i < slots; i++) {
                pushImage(type, 1 + 2 * i);
            }
            expect(closed).to.equal(0);
            pushImage(type, 2);
            expect(closed).to.equal(1);
        });
    });

    it('should close an image once even when it was handed to a popup', function () {
        addSecondary(7, null);
        const channel = display.screens.find(s => s.screenID === 7).channel;
        channel.postMessage = sinon.spy();
        const rect = { type: 'vid', img: makeImage(), x: 4, y: 0, width: 2, height: 2, 'frame_id': 1 };
        display._processRectScreens(rect);
        display._asyncRenderQPush(rect);
        display.flush(false);
        const sent = channel.postMessage.getCalls().filter(c => c.args[0].rect && c.args[0].rect.type === 'vid');
        expect(sent).to.have.lengthOf(1);
        expect(closed).to.equal(1);
    });

    it('should close a frame whose id falls between queued frames', function () {
        // Fill the queue with odd ids so the even ones (dropped upstream) match no slot
        const slots = display._maxAsyncFrameQueue;
        for (let i = 0; i < slots; i++) {
            display.videoFrameRect(0, makeFrame(), 1 + 2 * i, 0, 0, 2, 2);
        }
        expect(closed).to.equal(0);

        display.videoFrameRect(0, makeFrame(), 2, 0, 0, 2, 2);

        expect(closed).to.equal(1);
    });
});
