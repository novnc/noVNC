var assert = chai.assert;
var expect = chai.expect;

import sinon from '../vendor/sinon.js';

import Mouse from '../core/input/mouse.js';
import * as eventUtils from '../core/util/events.js';

describe('Mouse Event Handling', function() {
    "use strict";

    sinon.stub(eventUtils, 'setCapture');
    // This function is only used on target (the canvas)
    // and for these tests we can assume that the canvas is 100x100
    // located at coordinates 10x10
    sinon.stub(Element.prototype, 'getBoundingClientRect').returns(
        {left: 10, right: 110, top: 10, bottom: 110, width: 100, height: 100});
    var target = document.createElement('canvas');

    // The real constructors might not work everywhere we
    // want to run these tests
    var mouseevent, touchevent;
    mouseevent = touchevent = function(typeArg, MouseEventInit) {
        var e = { type: typeArg };
        for (var key in MouseEventInit) {
            e[key] = MouseEventInit[key];
        }
        e.stopPropagation = sinon.spy();
        e.preventDefault = sinon.spy();
        return e;
    };

    describe('Decode Mouse Events', function() {
        it('should decode mousedown events', function(done) {
            var mouse = new Mouse(target);
            mouse.onmousebutton = function(x, y, down, bmask) {
                expect(bmask).to.be.equal(0x01);
                expect(down).to.be.equal(1);
                done();
            };
            mouse._handleMouseDown(mouseevent('mousedown', { button: '0x01' }));
        });
        it('should decode mouseup events', function(done) {
            var calls = 0;
            var mouse = new Mouse(target);
            mouse.onmousebutton = function(x, y, down, bmask) {
                expect(bmask).to.be.equal(0x01);
                if (calls++ === 1) {
                    expect(down).to.not.be.equal(1);
                    done();
                }
            };
            mouse._handleMouseDown(mouseevent('mousedown', { button: '0x01' }));
            mouse._handleMouseUp(mouseevent('mouseup', { button: '0x01' }));
        });
        it('should decode mousemove events', function(done) {
            var mouse = new Mouse(target);
            mouse.onmousemove = function(x, y) {
                // Note that target relative coordinates are sent
                expect(x).to.be.equal(40);
                expect(y).to.be.equal(10);
                done();
            };
            mouse._handleMouseMove(mouseevent('mousemove',
                                              { clientX: 50, clientY: 20 }));
        });
        it('should decode mousewheel events', function(done) {
            var calls = 0;
            var mouse = new Mouse(target);
            mouse.onmousebutton = function(x, y, down, bmask) {
                calls++;
                expect(bmask).to.be.equal(1<<6);
                if (calls === 1) {
                    expect(down).to.be.equal(1);
                } else if (calls === 2) {
                    expect(down).to.not.be.equal(1);
                    done();
                }
            };
            mouse._handleMouseWheel(mouseevent('mousewheel',
                                               { deltaX: 50, deltaY: 0,
                                                 deltaMode: 0}));
        });
    });

    describe('Double-click for Touch', function() {

        beforeEach(function () { this.clock = sinon.useFakeTimers(); });
        afterEach(function () { this.clock.restore(); });

        it('should use same pos for 2nd tap if close enough', function(done) {
            var calls = 0;
            var mouse = new Mouse(target);
            mouse.onmousebutton = function(x, y, down, bmask) {
                calls++;
                if (calls === 1) {
                    expect(down).to.be.equal(1);
                    expect(x).to.be.equal(68);
                    expect(y).to.be.equal(36);
                } else if (calls === 3) {
                    expect(down).to.be.equal(1);
                    expect(x).to.be.equal(68);
                    expect(y).to.be.equal(36);
                    done();
                }
            };
            // touch events are sent in an array of events
            // with one item for each touch point
            mouse._handleMouseDown(touchevent(
                'touchstart', { touches: [{ clientX: 78, clientY: 46 }]}));
            this.clock.tick(10);
            mouse._handleMouseUp(touchevent(
                'touchend', { touches: [{ clientX: 79, clientY: 45 }]}));
            this.clock.tick(200);
            mouse._handleMouseDown(touchevent(
                'touchstart', { touches: [{ clientX: 67, clientY: 35 }]}));
            this.clock.tick(10);
            mouse._handleMouseUp(touchevent(
                'touchend', { touches: [{ clientX: 66, clientY: 36 }]}));
        });

        it('should not modify 2nd tap pos if far apart', function(done) {
            var calls = 0;
            var mouse = new Mouse(target);
            mouse.onmousebutton = function(x, y, down, bmask) {
                calls++;
                if (calls === 1) {
                    expect(down).to.be.equal(1);
                    expect(x).to.be.equal(68);
                    expect(y).to.be.equal(36);
                } else if (calls === 3) {
                    expect(down).to.be.equal(1);
                    expect(x).to.not.be.equal(68);
                    expect(y).to.not.be.equal(36);
                    done();
                }
            };
            mouse._handleMouseDown(touchevent(
                'touchstart', { touches: [{ clientX: 78, clientY: 46 }]}));
            this.clock.tick(10);
            mouse._handleMouseUp(touchevent(
                'touchend', { touches: [{ clientX: 79, clientY: 45 }]}));
            this.clock.tick(200);
            mouse._handleMouseDown(touchevent(
                'touchstart', { touches: [{ clientX: 57, clientY: 35 }]}));
            this.clock.tick(10);
            mouse._handleMouseUp(touchevent(
                'touchend', { touches: [{ clientX: 56, clientY: 36 }]}));
        });

        it('should not modify 2nd tap pos if not soon enough', function(done) {
            var calls = 0;
            var mouse = new Mouse(target);
            mouse.onmousebutton = function(x, y, down, bmask) {
                calls++;
                if (calls === 1) {
                    expect(down).to.be.equal(1);
                    expect(x).to.be.equal(68);
                    expect(y).to.be.equal(36);
                } else if (calls === 3) {
                    expect(down).to.be.equal(1);
                    expect(x).to.not.be.equal(68);
                    expect(y).to.not.be.equal(36);
                    done();
                }
            };
            mouse._handleMouseDown(touchevent(
                'touchstart', { touches: [{ clientX: 78, clientY: 46 }]}));
            this.clock.tick(10);
            mouse._handleMouseUp(touchevent(
                'touchend', { touches: [{ clientX: 79, clientY: 45 }]}));
            this.clock.tick(500);
            mouse._handleMouseDown(touchevent(
                'touchstart', { touches: [{ clientX: 67, clientY: 35 }]}));
            this.clock.tick(10);
            mouse._handleMouseUp(touchevent(
                'touchend', { touches: [{ clientX: 66, clientY: 36 }]}));
        });

        it('should not modify 2nd tap pos if not touch', function(done) {
            var calls = 0;
            var mouse = new Mouse(target);
            mouse.onmousebutton = function(x, y, down, bmask) {
                calls++;
                if (calls === 1) {
                    expect(down).to.be.equal(1);
                    expect(x).to.be.equal(68);
                    expect(y).to.be.equal(36);
                } else if (calls === 3) {
                    expect(down).to.be.equal(1);
                    expect(x).to.not.be.equal(68);
                    expect(y).to.not.be.equal(36);
                    done();
                }
            };
            mouse._handleMouseDown(mouseevent(
                'mousedown', { button: '0x01', clientX: 78, clientY: 46 }));
            this.clock.tick(10);
            mouse._handleMouseUp(mouseevent(
                'mouseup', { button: '0x01', clientX: 79, clientY: 45 }));
            this.clock.tick(200);
            mouse._handleMouseDown(mouseevent(
                'mousedown', { button: '0x01', clientX: 67, clientY: 35 }));
            this.clock.tick(10);
            mouse._handleMouseUp(mouseevent(
                'mouseup', { button: '0x01', clientX: 66, clientY: 36 }));
        });

    });

    describe('Accumulate mouse wheel events with small delta', function() {

        beforeEach(function () { this.clock = sinon.useFakeTimers(); });
        afterEach(function () { this.clock.restore(); });

        it('should accumulate wheel events if small enough', function () {
            var mouse = new Mouse(target);
            mouse.onmousebutton = sinon.spy();

            mouse._handleMouseWheel(mouseevent(
                'mousewheel', { clientX: 18, clientY: 40,
                                deltaX: 4, deltaY: 0, deltaMode: 0 }));
            this.clock.tick(10);
            mouse._handleMouseWheel(mouseevent(
                'mousewheel', { clientX: 18, clientY: 40,
                                deltaX: 4, deltaY: 0, deltaMode: 0 }));

            // threshold is 10
            expect(mouse._accumulatedWheelDeltaX).to.be.equal(8);

            this.clock.tick(10);
            mouse._handleMouseWheel(mouseevent(
                'mousewheel', { clientX: 18, clientY: 40,
                                deltaX: 4, deltaY: 0, deltaMode: 0 }));

            expect(mouse.onmousebutton).to.have.callCount(2); // mouse down and up

            this.clock.tick(10);
            mouse._handleMouseWheel(mouseevent(
                'mousewheel', { clientX: 18, clientY: 40,
                                deltaX: 4, deltaY: 9, deltaMode: 0 }));

            expect(mouse._accumulatedWheelDeltaX).to.be.equal(4);
            expect(mouse._accumulatedWheelDeltaY).to.be.equal(9);

            expect(mouse.onmousebutton).to.have.callCount(2); // still
        });

        it('should not accumulate large wheel events', function () {
            var mouse = new Mouse(target);
            mouse.onmousebutton = sinon.spy();

            mouse._handleMouseWheel(mouseevent(
                'mousewheel', { clientX: 18, clientY: 40,
                                deltaX: 11, deltaY: 0, deltaMode: 0 }));
            this.clock.tick(10);
            mouse._handleMouseWheel(mouseevent(
                'mousewheel', { clientX: 18, clientY: 40,
                                deltaX: 0, deltaY: 70, deltaMode: 0 }));
            this.clock.tick(10);
            mouse._handleMouseWheel(mouseevent(
                'mousewheel', { clientX: 18, clientY: 40,
                                deltaX: 400, deltaY: 400, deltaMode: 0 }));

            expect(mouse.onmousebutton).to.have.callCount(8); // mouse down and up
        });

        it('should send even small wheel events after a timeout', function () {
            var mouse = new Mouse(target);
            mouse.onmousebutton = sinon.spy();

            mouse._handleMouseWheel(mouseevent(
                'mousewheel', { clientX: 18, clientY: 40,
                                deltaX: 1, deltaY: 0, deltaMode: 0 }));
            this.clock.tick(51); // timeout on 50 ms

            expect(mouse.onmousebutton).to.have.callCount(2); // mouse down and up
        });

        it('should account for non-zero deltaMode', function () {
            var mouse = new Mouse(target);
            mouse.onmousebutton = sinon.spy();

            mouse._handleMouseWheel(mouseevent(
                'mousewheel', { clientX: 18, clientY: 40,
                                deltaX: 0, deltaY: 2, deltaMode: 1 }));

            this.clock.tick(10);

            mouse._handleMouseWheel(mouseevent(
                'mousewheel', { clientX: 18, clientY: 40,
                                deltaX: 1, deltaY: 0, deltaMode: 2 }));

            expect(mouse.onmousebutton).to.have.callCount(4); // mouse down and up
        });
    });

});
