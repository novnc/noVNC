const expect = chai.expect;

import Touch from '../core/input/touch.js';

describe('Touch Event Handling', function () {
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
    const touchevent = mouseevent;

    describe('Double-click for Touch', function () {

        beforeEach(function () { this.clock = sinon.useFakeTimers(); });
        afterEach(function () { this.clock.restore(); });

        it('should use same pos for 2nd tap if close enough', function (done) {
            let calls = 0;
            const touch = new Touch(target);
            touch.ontouch = (x, y, down, bmask) => {
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
            touch._handleTouchStart(touchevent(
                'touchstart', { touches: [{ clientX: 78, clientY: 46 }]}));
            this.clock.tick(10);
            touch._handleTouchEnd(touchevent(
                'touchend', { touches: [{ clientX: 79, clientY: 45 }]}));
            this.clock.tick(200);
            touch._handleTouchStart(touchevent(
                'touchstart', { touches: [{ clientX: 67, clientY: 35 }]}));
            this.clock.tick(10);
            touch._handleTouchEnd(touchevent(
                'touchend', { touches: [{ clientX: 66, clientY: 36 }]}));
        });

        it('should not modify 2nd tap pos if far apart', function (done) {
            let calls = 0;
            const touch = new Touch(target);
            touch.ontouch = (x, y, down, bmask) => {
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
            touch._handleTouchStart(touchevent(
                'touchstart', { touches: [{ clientX: 78, clientY: 46 }]}));
            this.clock.tick(10);
            touch._handleTouchEnd(touchevent(
                'touchend', { touches: [{ clientX: 79, clientY: 45 }]}));
            this.clock.tick(200);
            touch._handleTouchStart(touchevent(
                'touchstart', { touches: [{ clientX: 57, clientY: 35 }]}));
            this.clock.tick(10);
            touch._handleTouchEnd(touchevent(
                'touchend', { touches: [{ clientX: 56, clientY: 36 }]}));
        });

        it('should not modify 2nd tap pos if not soon enough', function (done) {
            let calls = 0;
            const touch = new Touch(target);
            touch.ontouch = (x, y, down, bmask) => {
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
            touch._handleTouchStart(touchevent(
                'touchstart', { touches: [{ clientX: 78, clientY: 46 }]}));
            this.clock.tick(10);
            touch._handleTouchEnd(touchevent(
                'touchend', { touches: [{ clientX: 79, clientY: 45 }]}));
            this.clock.tick(500);
            touch._handleTouchStart(touchevent(
                'touchstart', { touches: [{ clientX: 67, clientY: 35 }]}));
            this.clock.tick(10);
            touch._handleTouchEnd(touchevent(
                'touchend', { touches: [{ clientX: 66, clientY: 36 }]}));
        });

    });

});
