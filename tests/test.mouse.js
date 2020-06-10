const expect = chai.expect;

import Mouse from '../core/input/mouse.js';

describe('Mouse Event Handling', function () {
    "use strict";

    let target;

    beforeEach(function () {
        // For these tests we can assume that the canvas is 100x100
        // located at coordinates 10x10
        target = document.createElement('canvas');
        target.style.position = "absolute";
        target.style.top = "10px";
        target.style.left = "10px";
        target.style.width = "100px";
        target.style.height = "100px";
        document.body.appendChild(target);
    });
    afterEach(function () {
        document.body.removeChild(target);
        target = null;
    });

    // The real constructors might not work everywhere we
    // want to run these tests
    const mouseevent = (typeArg, MouseEventInit) => {
        const e = { type: typeArg };
        for (let key in MouseEventInit) {
            e[key] = MouseEventInit[key];
        }
        e.stopPropagation = sinon.spy();
        e.preventDefault = sinon.spy();
        return e;
    };

    describe('Decode Mouse Events', function () {
        it('should decode mousedown events', function (done) {
            const mouse = new Mouse(target);
            mouse.onmousebutton = (x, y, down, bmask) => {
                expect(bmask).to.be.equal(0x01);
                expect(down).to.be.equal(1);
                done();
            };
            mouse._handleMouseDown(mouseevent('mousedown', { button: '0x01' }));
        });
        it('should decode mouseup events', function (done) {
            let calls = 0;
            const mouse = new Mouse(target);
            mouse.onmousebutton = (x, y, down, bmask) => {
                expect(bmask).to.be.equal(0x01);
                if (calls++ === 1) {
                    expect(down).to.not.be.equal(1);
                    done();
                }
            };
            mouse._handleMouseDown(mouseevent('mousedown', { button: '0x01' }));
            mouse._handleMouseUp(mouseevent('mouseup', { button: '0x01' }));
        });
        it('should decode mousemove events', function (done) {
            const mouse = new Mouse(target);
            mouse.onmousemove = (x, y) => {
                // Note that target relative coordinates are sent
                expect(x).to.be.equal(40);
                expect(y).to.be.equal(10);
                done();
            };
            mouse._handleMouseMove(mouseevent('mousemove',
                                              { clientX: 50, clientY: 20 }));
        });
        it('should decode mousewheel events', function (done) {
            let calls = 0;
            const mouse = new Mouse(target);
            mouse.onmousebutton = (x, y, down, bmask) => {
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

    describe('Accumulate mouse wheel events with small delta', function () {

        it('should accumulate wheel events if small enough', function () {
            const mouse = new Mouse(target);
            mouse.onmousebutton = sinon.spy();

            mouse._handleMouseWheel(mouseevent(
                'mousewheel', { clientX: 18, clientY: 40,
                                deltaX: 4, deltaY: 0, deltaMode: 0 }));
            mouse._handleMouseWheel(mouseevent(
                'mousewheel', { clientX: 18, clientY: 40,
                                deltaX: 4, deltaY: 0, deltaMode: 0 }));

            // threshold is 10
            expect(mouse._accumulatedWheelDeltaX).to.be.equal(8);

            mouse._handleMouseWheel(mouseevent(
                'mousewheel', { clientX: 18, clientY: 40,
                                deltaX: 4, deltaY: 0, deltaMode: 0 }));

            expect(mouse.onmousebutton).to.have.callCount(2); // mouse down and up

            mouse._handleMouseWheel(mouseevent(
                'mousewheel', { clientX: 18, clientY: 40,
                                deltaX: 4, deltaY: 9, deltaMode: 0 }));

            expect(mouse._accumulatedWheelDeltaX).to.be.equal(4);
            expect(mouse._accumulatedWheelDeltaY).to.be.equal(9);

            expect(mouse.onmousebutton).to.have.callCount(2); // still
        });

        it('should not accumulate large wheel events', function () {
            const mouse = new Mouse(target);
            mouse.onmousebutton = sinon.spy();

            mouse._handleMouseWheel(mouseevent(
                'mousewheel', { clientX: 18, clientY: 40,
                                deltaX: 11, deltaY: 0, deltaMode: 0 }));
            mouse._handleMouseWheel(mouseevent(
                'mousewheel', { clientX: 18, clientY: 40,
                                deltaX: 0, deltaY: 70, deltaMode: 0 }));
            mouse._handleMouseWheel(mouseevent(
                'mousewheel', { clientX: 18, clientY: 40,
                                deltaX: 400, deltaY: 400, deltaMode: 0 }));

            expect(mouse.onmousebutton).to.have.callCount(8); // mouse down and up
        });

        it('should account for non-zero deltaMode', function () {
            const mouse = new Mouse(target);
            mouse.onmousebutton = sinon.spy();

            mouse._handleMouseWheel(mouseevent(
                'mousewheel', { clientX: 18, clientY: 40,
                                deltaX: 0, deltaY: 2, deltaMode: 1 }));

            mouse._handleMouseWheel(mouseevent(
                'mousewheel', { clientX: 18, clientY: 40,
                                deltaX: 1, deltaY: 0, deltaMode: 2 }));

            expect(mouse.onmousebutton).to.have.callCount(4); // mouse down and up
        });
    });
});
