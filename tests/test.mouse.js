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
            mouse._handleMouseDown(mouseevent('mousedown', { button: 0 }));
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
            mouse._handleMouseDown(mouseevent('mousedown', { button: 0 }));
            mouse._handleMouseUp(mouseevent('mouseup', { button: 0 }));
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
    });
});
