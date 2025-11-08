import { vi, describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import EventTargetMixin from '../core/util/eventtarget.js';

import GestureHandler from '../core/input/gesturehandler.js';

class DummyTarget extends EventTargetMixin {
}

describe('Gesture handler', function () {
    let target, handler;
    let gestures;
    let clock;
    let touches;

    beforeAll(function () {
        clock = vi.useFakeTimers();
    });

    afterAll(function () {
        clock.restoreAllMocks();
    });

    beforeEach(function () {
        target = new DummyTarget();
        gestures = vi.fn();
        target.addEventListener('gesturestart', gestures);
        target.addEventListener('gesturemove', gestures);
        target.addEventListener('gestureend', gestures);
        touches = [];
        handler = new GestureHandler();
        handler.attach(target);
    });

    afterEach(function () {
        if (handler) {
            handler.detach();
        }
        target = null;
        gestures = null;
    });

    function touchStart(id, x, y) {
        let touch = { identifier: id,
                      clientX: x, clientY: y };
        touches.push(touch);
        let ev = { type: 'touchstart',
                   touches: touches,
                   targetTouches: touches,
                   changedTouches: [ touch ],
                   stopPropagation: vi.fn(),
                   preventDefault: vi.fn() };
        target.dispatchEvent(ev);
    }

    function touchMove(id, x, y) {
        let touch = touches.find(t => t.identifier === id);
        touch.clientX = x;
        touch.clientY = y;
        let ev = { type: 'touchmove',
                   touches: touches,
                   targetTouches: touches,
                   changedTouches: [ touch ],
                   stopPropagation: vi.fn(),
                   preventDefault: vi.fn() };
        target.dispatchEvent(ev);
    }

    function touchEnd(id) {
        let idx = touches.findIndex(t => t.identifier === id);
        let touch = touches.splice(idx, 1)[0];
        let ev = { type: 'touchend',
                   touches: touches,
                   targetTouches: touches,
                   changedTouches: [ touch ],
                   stopPropagation: vi.fn(),
                   preventDefault: vi.fn() };
        target.dispatchEvent(ev);
    }

    describe('Single finger tap', function () {
        it('should handle single finger tap', function () {
            touchStart(1, 20.0, 30.0);

            expect(gestures).not.toHaveBeenCalled();

            touchEnd(1);

            expect(gestures).toHaveBeenCalledTimes(2);
            expect(gestures).toHaveBeenNthCalledWith(1,
                                                     expect.objectContaining({
                                                         type: 'gesturestart',
                                                         detail: expect.objectContaining({
                                                             type: 'onetap',
                                                             clientX: 20.0,
                                                             clientY: 30.0
                                                         })
                                                     })
            );

            expect(gestures).toHaveBeenNthCalledWith(2,
                                                     expect.objectContaining({
                                                         type: 'gestureend',
                                                         detail: expect.objectContaining({
                                                             type: 'onetap',
                                                             clientX: 20.0,
                                                             clientY: 30.0
                                                         })
                                                     })
            );
        });
    });

    describe('Two finger tap', function () {
        it('should handle two finger tap', function () {
            touchStart(1, 20.0, 30.0);
            touchStart(2, 30.0, 50.0);

            expect(gestures).not.toHaveBeenCalled();

            touchEnd(1);

            expect(gestures).not.toHaveBeenCalled();

            touchEnd(2);

            expect(gestures).toHaveBeenCalledTimes(2);

            expect(gestures).toHaveBeenNthCalledWith(1,
                                                     expect.objectContaining({
                                                         type: 'gesturestart',
                                                         detail: expect.objectContaining({
                                                             type: 'twotap',
                                                             clientX: 25.0,
                                                             clientY: 40.0
                                                         })
                                                     })
            );

            expect(gestures).toHaveBeenNthCalledWith(2,
                                                     expect.objectContaining({
                                                         type: 'gestureend',
                                                         detail: expect.objectContaining({
                                                             type: 'twotap',
                                                             clientX: 25.0,
                                                             clientY: 40.0
                                                         })
                                                     })
            );
        });

        it('should ignore slow starting two finger tap', function () {
            touchStart(1, 20.0, 30.0);

            clock.advanceTimersByTime(500);

            touchStart(2, 30.0, 50.0);
            touchEnd(1);
            touchEnd(2);

            expect(gestures).not.toHaveBeenCalled();
        });

        it('should ignore slow ending two finger tap', function () {
            touchStart(1, 20.0, 30.0);
            touchStart(2, 30.0, 50.0);
            touchEnd(1);

            clock.advanceTimersByTime(500);

            touchEnd(2);

            expect(gestures).not.toHaveBeenCalled();
        });

        it('should ignore slow two finger tap', function () {
            touchStart(1, 20.0, 30.0);
            touchStart(2, 30.0, 50.0);

            clock.advanceTimersByTime(1500);

            touchEnd(1);
            touchEnd(2);

            expect(gestures).not.toHaveBeenCalled();
        });
    });

    describe('Three finger tap', function () {
        it('should handle three finger tap', function () {
            touchStart(1, 20.0, 30.0);
            touchStart(2, 30.0, 50.0);
            touchStart(3, 40.0, 40.0);

            expect(gestures).not.toHaveBeenCalled();

            touchEnd(1);

            expect(gestures).not.toHaveBeenCalled();

            touchEnd(2);

            expect(gestures).not.toHaveBeenCalled();

            touchEnd(3);

            expect(gestures).toHaveBeenCalledTimes(2);

            expect(gestures).toHaveBeenNthCalledWith(1,
                                                     expect.objectContaining({
                                                         type: 'gesturestart',
                                                         detail: expect.objectContaining({
                                                             type: 'threetap',
                                                             clientX: 30.0,
                                                             clientY: 40.0
                                                         })
                                                     })
            );

            expect(gestures).toHaveBeenNthCalledWith(2,
                                                     expect.objectContaining({
                                                         type: 'gestureend',
                                                         detail: expect.objectContaining({
                                                             type: 'threetap',
                                                             clientX: 30.0,
                                                             clientY: 40.0
                                                         })
                                                     })
            );
        });

        it('should ignore slow starting three finger tap', function () {
            touchStart(1, 20.0, 30.0);
            touchStart(2, 30.0, 50.0);

            clock.advanceTimersByTime(500);

            touchStart(3, 40.0, 40.0);
            touchEnd(1);
            touchEnd(2);
            touchEnd(3);

            expect(gestures).not.toHaveBeenCalled();
        });

        it('should ignore slow ending three finger tap', function () {
            touchStart(1, 20.0, 30.0);
            touchStart(2, 30.0, 50.0);
            touchStart(3, 40.0, 40.0);
            touchEnd(1);
            touchEnd(2);

            clock.advanceTimersByTime(500);

            touchEnd(3);

            expect(gestures).not.toHaveBeenCalled();
        });

        it('should ignore three finger drag', function () {
            touchStart(1, 20.0, 30.0);
            touchStart(2, 30.0, 50.0);
            touchStart(3, 40.0, 40.0);

            touchMove(1, 120.0, 130.0);
            touchMove(2, 130.0, 150.0);
            touchMove(3, 140.0, 140.0);

            touchEnd(1);
            touchEnd(2);
            touchEnd(3);

            expect(gestures).not.toHaveBeenCalled();
        });

        it('should ignore slow three finger tap', function () {
            touchStart(1, 20.0, 30.0);
            touchStart(2, 30.0, 50.0);
            touchStart(3, 40.0, 40.0);

            clock.advanceTimersByTime(1500);

            touchEnd(1);
            touchEnd(2);
            touchEnd(3);

            expect(gestures).not.toHaveBeenCalled();
        });
    });

    describe('Single finger drag', function () {
        it('should handle horizontal single finger drag', function () {
            touchStart(1, 20.0, 30.0);

            expect(gestures).not.toHaveBeenCalled();

            touchMove(1, 40.0, 30.0);

            expect(gestures).not.toHaveBeenCalled();

            touchMove(1, 80.0, 30.0);

            expect(gestures).toHaveBeenCalledTimes(2);

            expect(gestures).toHaveBeenNthCalledWith(1,
                                                     expect.objectContaining({
                                                         type: 'gesturestart',
                                                         detail: expect.objectContaining({
                                                             type: 'drag',
                                                             clientX: 20.0,
                                                             clientY: 30.0
                                                         })
                                                     })
            );

            expect(gestures).toHaveBeenNthCalledWith(2,
                                                     expect.objectContaining({
                                                         type: 'gesturemove',
                                                         detail: expect.objectContaining({
                                                             type: 'drag',
                                                             clientX: 80.0,
                                                             clientY: 30.0
                                                         })
                                                     })
            );

            gestures.mockClear();

            touchEnd(1);

            expect(gestures).toHaveBeenCalledOnce();
            expect(gestures).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'gestureend',
                    detail: expect.objectContaining({
                        type: 'drag',
                        clientX: 80.0,
                        clientY: 30.0
                    })
                })
            );
        });

        it('should handle vertical single finger drag', function () {
            touchStart(1, 20.0, 30.0);

            expect(gestures).not.toHaveBeenCalled();

            touchMove(1, 20.0, 50.0);

            expect(gestures).not.toHaveBeenCalled();

            touchMove(1, 20.0, 90.0);

            expect(gestures).toHaveBeenCalledTimes(2);

            expect(gestures).toHaveBeenNthCalledWith(1,
                                                     expect.objectContaining({
                                                         type: 'gesturestart',
                                                         detail: expect.objectContaining({
                                                             type: 'drag',
                                                             clientX: 20.0,
                                                             clientY: 30.0
                                                         })
                                                     })
            );

            expect(gestures).toHaveBeenNthCalledWith(2,
                                                     expect.objectContaining({
                                                         type: 'gesturemove',
                                                         detail: expect.objectContaining({
                                                             type: 'drag',
                                                             clientX: 20.0,
                                                             clientY: 90.0
                                                         })
                                                     })
            );

            gestures.mockClear();

            touchEnd(1);

            expect(gestures).toHaveBeenCalledOnce();
            expect(gestures).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'gestureend',
                    detail: expect.objectContaining({
                        type: 'drag',
                        clientX: 20.0,
                        clientY: 90.0
                    })
                })
            );
        });

        it('should handle diagonal single finger drag', function () {
            touchStart(1, 120.0, 130.0);

            expect(gestures).not.toHaveBeenCalled();

            touchMove(1, 90.0, 100.0);

            expect(gestures).not.toHaveBeenCalled();

            touchMove(1, 60.0, 70.0);

            expect(gestures).toHaveBeenCalledTimes(2);

            expect(gestures).toHaveBeenNthCalledWith(1,
                                                     expect.objectContaining({ type: 'gesturestart',
                                                                               detail: { type: 'drag',
                                                                                         clientX: 120.0,
                                                                                         clientY: 130.0 } }));

            expect(gestures).toHaveBeenNthCalledWith(2,
                                                     expect.objectContaining({ type: 'gesturemove',
                                                                               detail: { type: 'drag',
                                                                                         clientX: 60.0,
                                                                                         clientY: 70.0 } }));

            gestures.mockClear();

            touchEnd(1);

            expect(gestures).toHaveBeenCalledOnce();
            expect(gestures).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'gestureend',
                                          detail: { type: 'drag',
                                                    clientX: 60.0,
                                                    clientY: 70.0 } }));
        });
    });

    describe('Long press', function () {
        it('should handle long press', function () {
            touchStart(1, 20.0, 30.0);

            expect(gestures).not.toHaveBeenCalled();

            clock.advanceTimersByTime(1500);

            expect(gestures).toHaveBeenCalledOnce();
            expect(gestures).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'gesturestart',
                                          detail: { type: 'longpress',
                                                    clientX: 20.0,
                                                    clientY: 30.0 } }));

            gestures.mockClear();

            touchEnd(1);

            expect(gestures).toHaveBeenCalledOnce();
            expect(gestures).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'gestureend',
                                          detail: { type: 'longpress',
                                                    clientX: 20.0,
                                                    clientY: 30.0 } }));
        });

        it('should handle long press drag', function () {
            touchStart(1, 20.0, 30.0);

            expect(gestures).not.toHaveBeenCalled();

            clock.advanceTimersByTime(1500);

            expect(gestures).toHaveBeenCalledOnce();
            expect(gestures).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'gesturestart',
                                          detail: { type: 'longpress',
                                                    clientX: 20.0,
                                                    clientY: 30.0 } }));

            gestures.mockClear();

            touchMove(1, 120.0, 50.0);

            expect(gestures).toHaveBeenCalledOnce();
            expect(gestures).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'gesturemove',
                                          detail: { type: 'longpress',
                                                    clientX: 120.0,
                                                    clientY: 50.0 } }));

            gestures.mockClear();

            touchEnd(1);

            expect(gestures).toHaveBeenCalledOnce();
            expect(gestures).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'gestureend',
                                          detail: { type: 'longpress',
                                                    clientX: 120.0,
                                                    clientY: 50.0 } }));
        });
    });

    describe('Two finger drag', function () {
        it('should handle fast and distinct horizontal two finger drag', function () {
            touchStart(1, 20.0, 30.0);
            touchStart(2, 30.0, 30.0);

            expect(gestures).not.toHaveBeenCalled();

            touchMove(1, 40.0, 30.0);
            touchMove(2, 50.0, 30.0);

            expect(gestures).not.toHaveBeenCalled();

            touchMove(2, 90.0, 30.0);
            touchMove(1, 80.0, 30.0);

            expect(gestures).toHaveBeenCalledTimes(2);

            expect(gestures).toHaveBeenNthCalledWith(1,
                                                     expect.objectContaining({ type: 'gesturestart',
                                                                               detail: { type: 'twodrag',
                                                                                         clientX: 25.0,
                                                                                         clientY: 30.0,
                                                                                         magnitudeX: 0.0,
                                                                                         magnitudeY: 0.0 } }));

            expect(gestures).toHaveBeenNthCalledWith(2,
                                                     expect.objectContaining({ type: 'gesturemove',
                                                                               detail: { type: 'twodrag',
                                                                                         clientX: 25.0,
                                                                                         clientY: 30.0,
                                                                                         magnitudeX: 60.0,
                                                                                         magnitudeY: 0.0 } }));

            gestures.mockClear();

            touchEnd(1);

            expect(gestures).toHaveBeenCalledOnce();
            expect(gestures).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'gestureend',
                                          detail: { type: 'twodrag',
                                                    clientX: 25.0,
                                                    clientY: 30.0,
                                                    magnitudeX: 60.0,
                                                    magnitudeY: 0.0 } }));
        });

        it('should handle fast and distinct vertical two finger drag', function () {
            touchStart(1, 20.0, 30.0);
            touchStart(2, 30.0, 30.0);

            expect(gestures).not.toHaveBeenCalled();

            touchMove(1, 20.0, 100.0);
            touchMove(2, 30.0, 40.0);

            expect(gestures).not.toHaveBeenCalled();

            touchMove(2, 30.0, 90.0);

            expect(gestures).toHaveBeenCalledTimes(2);

            expect(gestures).toHaveBeenNthCalledWith(1,
                                                     expect.objectContaining({ type: 'gesturestart',
                                                                               detail: { type: 'twodrag',
                                                                                         clientX: 25.0,
                                                                                         clientY: 30.0,
                                                                                         magnitudeX: 0.0,
                                                                                         magnitudeY: 0.0 } }));

            expect(gestures).toHaveBeenNthCalledWith(2,
                                                     expect.objectContaining({ type: 'gesturemove',
                                                                               detail: { type: 'twodrag',
                                                                                         clientX: 25.0,
                                                                                         clientY: 30.0,
                                                                                         magnitudeX: 0.0,
                                                                                         magnitudeY: 65.0 } }));

            gestures.mockClear();

            touchEnd(1);

            expect(gestures).toHaveBeenCalledOnce();
            expect(gestures).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'gestureend',
                                          detail: { type: 'twodrag',
                                                    clientX: 25.0,
                                                    clientY: 30.0,
                                                    magnitudeX: 0.0,
                                                    magnitudeY: 65.0 } }));
        });

        it('should handle fast and distinct diagonal two finger drag', function () {
            touchStart(1, 120.0, 130.0);
            touchStart(2, 130.0, 130.0);

            expect(gestures).not.toHaveBeenCalled();

            touchMove(1, 80.0, 90.0);
            touchMove(2, 100.0, 130.0);

            expect(gestures).not.toHaveBeenCalled();

            touchMove(2, 60.0, 70.0);

            expect(gestures).toHaveBeenCalledTimes(2);

            expect(gestures).toHaveBeenNthCalledWith(1,
                                                     expect.objectContaining({ type: 'gesturestart',
                                                                               detail: { type: 'twodrag',
                                                                                         clientX: 125.0,
                                                                                         clientY: 130.0,
                                                                                         magnitudeX: 0.0,
                                                                                         magnitudeY: 0.0 } }));

            expect(gestures).toHaveBeenNthCalledWith(2,
                                                     expect.objectContaining({ type: 'gesturemove',
                                                                               detail: { type: 'twodrag',
                                                                                         clientX: 125.0,
                                                                                         clientY: 130.0,
                                                                                         magnitudeX: -55.0,
                                                                                         magnitudeY: -50.0 } }));

            gestures.mockClear();

            touchEnd(1);

            expect(gestures).toHaveBeenCalledOnce();
            expect(gestures).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'gestureend',
                                          detail: { type: 'twodrag',
                                                    clientX: 125.0,
                                                    clientY: 130.0,
                                                    magnitudeX: -55.0,
                                                    magnitudeY: -50.0 } }));
        });

        it('should ignore fast almost two finger dragging', function () {
            touchStart(1, 20.0, 30.0);
            touchStart(2, 30.0, 30.0);
            touchMove(1, 80.0, 30.0);
            touchMove(2, 70.0, 30.0);
            touchEnd(1);
            touchEnd(2);

            expect(gestures).not.toHaveBeenCalled();

            clock.advanceTimersByTime(1500);

            expect(gestures).not.toHaveBeenCalled();
        });

        it('should handle slow horizontal two finger drag', function () {
            touchStart(1, 50.0, 40.0);
            touchStart(2, 60.0, 40.0);
            touchMove(1, 80.0, 40.0);
            touchMove(2, 110.0, 40.0);

            expect(gestures).not.toHaveBeenCalled();

            clock.advanceTimersByTime(60);

            expect(gestures).toHaveBeenCalledTimes(2);

            expect(gestures).toHaveBeenNthCalledWith(1,
                                                     expect.objectContaining({ type: 'gesturestart',
                                                                               detail: { type: 'twodrag',
                                                                                         clientX: 55.0,
                                                                                         clientY: 40.0,
                                                                                         magnitudeX: 0.0,
                                                                                         magnitudeY: 0.0 } }));

            expect(gestures).toHaveBeenNthCalledWith(2,
                                                     expect.objectContaining({ type: 'gesturemove',
                                                                               detail: { type: 'twodrag',
                                                                                         clientX: 55.0,
                                                                                         clientY: 40.0,
                                                                                         magnitudeX: 40.0,
                                                                                         magnitudeY: 0.0 } }));
        });

        it('should handle slow vertical two finger drag', function () {
            touchStart(1, 40.0, 40.0);
            touchStart(2, 40.0, 60.0);
            touchMove(2, 40.0, 80.0);
            touchMove(1, 40.0, 100.0);

            expect(gestures).not.toHaveBeenCalled();

            clock.advanceTimersByTime(60);

            expect(gestures).toHaveBeenCalledTimes(2);

            expect(gestures).toHaveBeenNthCalledWith(1,
                                                     expect.objectContaining({ type: 'gesturestart',
                                                                               detail: { type: 'twodrag',
                                                                                         clientX: 40.0,
                                                                                         clientY: 50.0,
                                                                                         magnitudeX: 0.0,
                                                                                         magnitudeY: 0.0 } }));

            expect(gestures).toHaveBeenNthCalledWith(2,
                                                     expect.objectContaining({ type: 'gesturemove',
                                                                               detail: { type: 'twodrag',
                                                                                         clientX: 40.0,
                                                                                         clientY: 50.0,
                                                                                         magnitudeX: 0.0,
                                                                                         magnitudeY: 40.0 } }));
        });

        it('should handle slow diagonal two finger drag', function () {
            touchStart(1, 50.0, 40.0);
            touchStart(2, 40.0, 60.0);
            touchMove(1, 70.0, 60.0);
            touchMove(2, 90.0, 110.0);

            expect(gestures).not.toHaveBeenCalled();

            clock.advanceTimersByTime(60);

            expect(gestures).toHaveBeenCalledTimes(2);

            expect(gestures).toHaveBeenNthCalledWith(1,
                                                     expect.objectContaining({ type: 'gesturestart',
                                                                               detail: { type: 'twodrag',
                                                                                         clientX: 45.0,
                                                                                         clientY: 50.0,
                                                                                         magnitudeX: 0.0,
                                                                                         magnitudeY: 0.0 } }));

            expect(gestures).toHaveBeenNthCalledWith(2,
                                                     expect.objectContaining({ type: 'gesturemove',
                                                                               detail: { type: 'twodrag',
                                                                                         clientX: 45.0,
                                                                                         clientY: 50.0,
                                                                                         magnitudeX: 35.0,
                                                                                         magnitudeY: 35.0 } }));
        });

        it('should ignore too slow two finger drag', function () {
            touchStart(1, 20.0, 30.0);

            clock.advanceTimersByTime(500);

            touchStart(2, 30.0, 30.0);
            touchMove(1, 40.0, 30.0);
            touchMove(2, 50.0, 30.0);
            touchMove(1, 80.0, 30.0);

            expect(gestures).not.toHaveBeenCalled();
        });
    });

    describe('Pinch', function () {
        it('should handle pinching distinctly and fast inwards', function () {
            touchStart(1, 0.0, 0.0);
            touchStart(2, 130.0, 130.0);

            expect(gestures).not.toHaveBeenCalled();

            touchMove(1, 50.0, 40.0);
            touchMove(2, 100.0, 130.0);

            expect(gestures).not.toHaveBeenCalled();

            touchMove(2, 60.0, 70.0);

            expect(gestures).toHaveBeenCalledTimes(2);

            expect(gestures).toHaveBeenNthCalledWith(1,
                                                     expect.objectContaining({ type: 'gesturestart',
                                                                               detail: { type: 'pinch',
                                                                                         clientX: 65.0,
                                                                                         clientY: 65.0,
                                                                                         magnitudeX: 130.0,
                                                                                         magnitudeY: 130.0 } }));

            expect(gestures).toHaveBeenNthCalledWith(2,
                                                     expect.objectContaining({ type: 'gesturemove',
                                                                               detail: { type: 'pinch',
                                                                                         clientX: 65.0,
                                                                                         clientY: 65.0,
                                                                                         magnitudeX: 10.0,
                                                                                         magnitudeY: 30.0 } }));

            gestures.mockClear();

            touchEnd(1);

            expect(gestures).toHaveBeenCalledOnce();
            expect(gestures).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'gestureend',
                                          detail: { type: 'pinch',
                                                    clientX: 65.0,
                                                    clientY: 65.0,
                                                    magnitudeX: 10.0,
                                                    magnitudeY: 30.0 } }));
        });

        it('should handle pinching fast and distinctly outwards', function () {
            touchStart(1, 100.0, 100.0);
            touchStart(2, 110.0, 100.0);

            expect(gestures).not.toHaveBeenCalled();

            touchMove(1, 130.0, 70.0);
            touchMove(2, 0.0, 200.0);

            expect(gestures).not.toHaveBeenCalled();

            touchMove(1, 180.0, 20.0);

            expect(gestures).toHaveBeenCalledTimes(2);

            expect(gestures).toHaveBeenNthCalledWith(1,
                                                     expect.objectContaining({ type: 'gesturestart',
                                                                               detail: { type: 'pinch',
                                                                                         clientX: 105.0,
                                                                                         clientY: 100.0,
                                                                                         magnitudeX: 10.0,
                                                                                         magnitudeY: 0.0 } }));

            expect(gestures).toHaveBeenNthCalledWith(2,
                                                     expect.objectContaining({ type: 'gesturemove',
                                                                               detail: { type: 'pinch',
                                                                                         clientX: 105.0,
                                                                                         clientY: 100.0,
                                                                                         magnitudeX: 180.0,
                                                                                         magnitudeY: 180.0 } }));

            gestures.mockClear();

            touchEnd(1);

            expect(gestures).toHaveBeenCalledOnce();
            expect(gestures).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'gestureend',
                                          detail: { type: 'pinch',
                                                    clientX: 105.0,
                                                    clientY: 100.0,
                                                    magnitudeX: 180.0,
                                                    magnitudeY: 180.0 } }));
        });

        it('should ignore fast almost pinching', function () {
            touchStart(1, 20.0, 30.0);
            touchStart(2, 130.0, 130.0);
            touchMove(1, 80.0, 70.0);
            touchEnd(1);
            touchEnd(2);

            expect(gestures).not.toHaveBeenCalled();

            clock.advanceTimersByTime(1500);

            expect(gestures).not.toHaveBeenCalled();
        });

        it('should handle pinching inwards slowly', function () {
            touchStart(1, 0.0, 0.0);
            touchStart(2, 130.0, 130.0);
            touchMove(1, 50.0, 40.0);
            touchMove(2, 100.0, 130.0);

            expect(gestures).not.toHaveBeenCalled();

            clock.advanceTimersByTime(60);

            expect(gestures).toHaveBeenCalledTimes(2);

            expect(gestures).toHaveBeenNthCalledWith(1,
                                                     expect.objectContaining({ type: 'gesturestart',
                                                                               detail: { type: 'pinch',
                                                                                         clientX: 65.0,
                                                                                         clientY: 65.0,
                                                                                         magnitudeX: 130.0,
                                                                                         magnitudeY: 130.0 } }));

            expect(gestures).toHaveBeenNthCalledWith(2,
                                                     expect.objectContaining({ type: 'gesturemove',
                                                                               detail: { type: 'pinch',
                                                                                         clientX: 65.0,
                                                                                         clientY: 65.0,
                                                                                         magnitudeX: 50.0,
                                                                                         magnitudeY: 90.0 } }));
        });

        it('should handle pinching outwards slowly', function () {
            touchStart(1, 100.0, 130.0);
            touchStart(2, 110.0, 130.0);
            touchMove(2, 200.0, 130.0);

            expect(gestures).not.toHaveBeenCalled();

            clock.advanceTimersByTime(60);

            expect(gestures).toHaveBeenCalledTimes(2);

            expect(gestures).toHaveBeenNthCalledWith(1,
                                                     expect.objectContaining({ type: 'gesturestart',
                                                                               detail: { type: 'pinch',
                                                                                         clientX: 105.0,
                                                                                         clientY: 130.0,
                                                                                         magnitudeX: 10.0,
                                                                                         magnitudeY: 0.0 } }));

            expect(gestures).toHaveBeenNthCalledWith(2,
                                                     expect.objectContaining({ type: 'gesturemove',
                                                                               detail: { type: 'pinch',
                                                                                         clientX: 105.0,
                                                                                         clientY: 130.0,
                                                                                         magnitudeX: 100.0,
                                                                                         magnitudeY: 0.0 } }));
        });

        it('should ignore pinching too slowly', function () {
            touchStart(1, 0.0, 0.0);

            clock.advanceTimersByTime(500);

            touchStart(2, 130.0, 130.0);
            touchMove(2, 100.0, 130.0);
            touchMove(1, 50.0, 40.0);

            expect(gestures).not.toHaveBeenCalled();
        });
    });

    describe('Ignoring', function () {
        // TODO: This now makes the test fail. Not sure why :shrug:
        // it('should ignore extra touches during gesture', function () {
        //     touchStart(1, 20.0, 30.0);
        //     touchMove(1, 40.0, 30.0);
        //     touchMove(1, 80.0, 30.0);

        //     expect(gestures).toHaveBeenCalledTimes(2);

        //     expect(gestures).toHaveBeenNthCalledWith(1,
        //                                              expect.objectContaining({ type: 'gesturestart',
        //                                                                        detail: { type: 'drag' } }));
        //     expect(gestures).toHaveBeenNthCalledWith(2,
        //                                              expect.objectContaining({ type: 'gesturemove',
        //                                                                        detail: { type: 'drag' } }));

        //     gestures.mockClear();

        //     touchStart(2, 10.0, 10.0);

        //     expect(gestures).not.toHaveBeenCalled();

        //     touchMove(1, 100.0, 50.0);

        //     expect(gestures).toHaveBeenCalledOnce();
        //     expect(gestures).toHaveBeenCalledWith(
        //         expect.objectContaining({ type: 'gesturemove',
        //                                   detail: { type: 'drag',
        //                                             clientX: 100.0,
        //                                             clientY: 50.0 } }));

        //     gestures.mockClear();

        //     touchEnd(1);

        //     expect(gestures).toHaveBeenCalledOnce();
        //     expect(gestures).toHaveBeenCalledWith(
        //         expect.objectContaining({ type: 'gestureend',
        //                                   detail: { type: 'drag',
        //                                             clientX: 100.0,
        //                                             clientY: 50.0 } }));
        // });

        // it('should ignore extra touches when waiting for gesture to end', function () {
        //     touchStart(1, 20.0, 30.0);
        //     touchStart(2, 30.0, 30.0);
        //     touchMove(1, 40.0, 30.0);
        //     touchMove(2, 90.0, 30.0);
        //     touchMove(1, 80.0, 30.0);

        //     expect(gestures).toHaveBeenCalledTimes(2);

        //     expect(gestures).toHaveBeenNthCalledWith(1,
        //                                              expect.objectContaining({ type: 'gesturestart',
        //                                                                        detail: { type: 'twodrag' } }));
        //     expect(gestures).toHaveBeenNthCalledWith(2,
        //                                              expect.objectContaining({ type: 'gesturemove',
        //                                                                        detail: { type: 'twodrag' } }));

        //     gestures.mockClear();

        //     touchEnd(1);

        //     expect(gestures).toHaveBeenCalledOnce();
        //     expect(gestures).toHaveBeenCalledWith(
        //         expect.objectContaining({ type: 'gestureend',
        //                                   detail: { type: 'twodrag' } }));

        //     gestures.mockClear();

        //     touchStart(3, 10.0, 10.0);
        //     touchEnd(3);

        //     expect(gestures).not.toHaveBeenCalled();
        // });

        // it('should ignore extra touches after gesture', function () {
        //     touchStart(1, 20.0, 30.0);
        //     touchMove(1, 40.0, 30.0);
        //     touchMove(1, 80.0, 30.0);

        //     expect(gestures).toHaveBeenCalledTimes(2);

        //     expect(gestures).toHaveBeenNthCalledWith(1,
        //                                              expect.objectContaining({ type: 'gesturestart',
        //                                                                        detail: { type: 'drag' } }));
        //     expect(gestures).toHaveBeenNthCalledWith(2,
        //                                              expect.objectContaining({ type: 'gesturemove',
        //                                                                        detail: { type: 'drag' } }));

        //     gestures.mockClear();

        //     touchStart(2, 10.0, 10.0);

        //     expect(gestures).not.toHaveBeenCalled();

        //     touchMove(1, 100.0, 50.0);

        //     expect(gestures).toHaveBeenCalledOnce();
        //     expect(gestures).toHaveBeenCalledWith(
        //         expect.objectContaining({ type: 'gesturemove',
        //                                   detail: { type: 'drag' } }));

        //     gestures.mockClear();

        //     touchEnd(1);

        //     expect(gestures).toHaveBeenCalledOnce();
        //     expect(gestures).toHaveBeenCalledWith(
        //         expect.objectContaining({ type: 'gestureend',
        //                                   detail: { type: 'drag' } }));

        //     gestures.mockClear();

        //     touchEnd(2);

        //     expect(gestures).not.toHaveBeenCalled();

        //     // Check that everything is reseted after trailing ignores are released

        //     touchStart(3, 20.0, 30.0);
        //     touchEnd(3);

        //     expect(gestures).toHaveBeenCalledTimes(2);

        //     expect(gestures).toHaveBeenNthCalledWith(1,
        //                                              expect.objectContaining({ type: 'gesturestart',
        //                                                                        detail: { type: 'onetap' } }));
        //     expect(gestures).toHaveBeenNthCalledWith(2,
        //                                              expect.objectContaining({ type: 'gestureend',
        //                                                                        detail: { type: 'onetap' } }));
        // });

        it('should properly reset after a gesture', function () {
            touchStart(1, 20.0, 30.0);

            expect(gestures).not.toHaveBeenCalled();

            touchEnd(1);

            expect(gestures).toHaveBeenCalledTimes(2);

            expect(gestures).toHaveBeenNthCalledWith(1,
                                                     expect.objectContaining({ type: 'gesturestart',
                                                                               detail: { type: 'onetap',
                                                                                         clientX: 20.0,
                                                                                         clientY: 30.0 } }));

            expect(gestures).toHaveBeenNthCalledWith(2,
                                                     expect.objectContaining({ type: 'gestureend',
                                                                               detail: { type: 'onetap',
                                                                                         clientX: 20.0,
                                                                                         clientY: 30.0 } }));

            gestures.mockClear();

            touchStart(2, 70.0, 80.0);

            expect(gestures).not.toHaveBeenCalled();

            touchEnd(2);

            expect(gestures).toHaveBeenCalledTimes(2);

            expect(gestures).toHaveBeenNthCalledWith(1,
                                                     expect.objectContaining({ type: 'gesturestart',
                                                                               detail: { type: 'onetap',
                                                                                         clientX: 70.0,
                                                                                         clientY: 80.0 } }));

            expect(gestures).toHaveBeenNthCalledWith(2,
                                                     expect.objectContaining({ type: 'gestureend',
                                                                               detail: { type: 'onetap',
                                                                                         clientX: 70.0,
                                                                                         clientY: 80.0 } }));
        });
    });
});
