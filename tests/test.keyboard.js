const expect = chai.expect;

import sinon from '../vendor/sinon.js';

import Keyboard from '../core/input/keyboard.js';
import * as browser from '../core/util/browser.js';

describe('Key Event Handling', function() {
    "use strict";

    // The real KeyboardEvent constructor might not work everywhere we
    // want to run these tests
    function keyevent(typeArg, KeyboardEventInit) {
        const e = { type: typeArg };
        for (let key in KeyboardEventInit) {
            e[key] = KeyboardEventInit[key];
        }
        e.stopPropagation = sinon.spy();
        e.preventDefault = sinon.spy();
        return e;
    }

    describe('Decode Keyboard Events', function() {
        it('should decode keydown events', function(done) {
            if (browser.isIE() || browser.isEdge()) this.skip();
            const kbd = new Keyboard(document);
            kbd.onkeyevent = function(keysym, code, down) {
                expect(keysym).to.be.equal(0x61);
                expect(code).to.be.equal('KeyA');
                expect(down).to.be.equal(true);
                done();
            };
            kbd._handleKeyDown(keyevent('keydown', {code: 'KeyA', key: 'a'}));
        });
        it('should decode keyup events', function(done) {
            if (browser.isIE() || browser.isEdge()) this.skip();
            let calls = 0;
            const kbd = new Keyboard(document);
            kbd.onkeyevent = function(keysym, code, down) {
                expect(keysym).to.be.equal(0x61);
                expect(code).to.be.equal('KeyA');
                if (calls++ === 1) {
                    expect(down).to.be.equal(false);
                    done();
                }
            };
            kbd._handleKeyDown(keyevent('keydown', {code: 'KeyA', key: 'a'}));
            kbd._handleKeyUp(keyevent('keyup', {code: 'KeyA', key: 'a'}));
        });

        describe('Legacy keypress Events', function() {
            it('should wait for keypress when needed', function() {
                const kbd = new Keyboard(document);
                kbd.onkeyevent = sinon.spy();
                kbd._handleKeyDown(keyevent('keydown', {code: 'KeyA', keyCode: 0x41}));
                expect(kbd.onkeyevent).to.not.have.been.called;
            });
            it('should decode keypress events', function(done) {
                const kbd = new Keyboard(document);
                kbd.onkeyevent = function(keysym, code, down) {
                    expect(keysym).to.be.equal(0x61);
                    expect(code).to.be.equal('KeyA');
                    expect(down).to.be.equal(true);
                    done();
                };
                kbd._handleKeyDown(keyevent('keydown', {code: 'KeyA', keyCode: 0x41}));
                kbd._handleKeyPress(keyevent('keypress', {code: 'KeyA', charCode: 0x61}));
            });
            it('should ignore keypress with different code', function() {
                const kbd = new Keyboard(document);
                kbd.onkeyevent = sinon.spy();
                kbd._handleKeyDown(keyevent('keydown', {code: 'KeyA', keyCode: 0x41}));
                kbd._handleKeyPress(keyevent('keypress', {code: 'KeyB', charCode: 0x61}));
                expect(kbd.onkeyevent).to.not.have.been.called;
            });
            it('should handle keypress with missing code', function(done) {
                const kbd = new Keyboard(document);
                kbd.onkeyevent = function(keysym, code, down) {
                    expect(keysym).to.be.equal(0x61);
                    expect(code).to.be.equal('KeyA');
                    expect(down).to.be.equal(true);
                    done();
                };
                kbd._handleKeyDown(keyevent('keydown', {code: 'KeyA', keyCode: 0x41}));
                kbd._handleKeyPress(keyevent('keypress', {charCode: 0x61}));
            });
            it('should guess key if no keypress and numeric key', function(done) {
                const kbd = new Keyboard(document);
                kbd.onkeyevent = function(keysym, code, down) {
                    expect(keysym).to.be.equal(0x32);
                    expect(code).to.be.equal('Digit2');
                    expect(down).to.be.equal(true);
                    done();
                };
                kbd._handleKeyDown(keyevent('keydown', {code: 'Digit2', keyCode: 0x32}));
            });
            it('should guess key if no keypress and alpha key', function(done) {
                const kbd = new Keyboard(document);
                kbd.onkeyevent = function(keysym, code, down) {
                    expect(keysym).to.be.equal(0x61);
                    expect(code).to.be.equal('KeyA');
                    expect(down).to.be.equal(true);
                    done();
                };
                kbd._handleKeyDown(keyevent('keydown', {code: 'KeyA', keyCode: 0x41, shiftKey: false}));
            });
            it('should guess key if no keypress and alpha key (with shift)', function(done) {
                const kbd = new Keyboard(document);
                kbd.onkeyevent = function(keysym, code, down) {
                    expect(keysym).to.be.equal(0x41);
                    expect(code).to.be.equal('KeyA');
                    expect(down).to.be.equal(true);
                    done();
                };
                kbd._handleKeyDown(keyevent('keydown', {code: 'KeyA', keyCode: 0x41, shiftKey: true}));
            });
            it('should not guess key if no keypress and unknown key', function(done) {
                const kbd = new Keyboard(document);
                kbd.onkeyevent = function(keysym, code, down) {
                    expect(keysym).to.be.equal(0);
                    expect(code).to.be.equal('KeyA');
                    expect(down).to.be.equal(true);
                    done();
                };
                kbd._handleKeyDown(keyevent('keydown', {code: 'KeyA', keyCode: 0x09}));
            });
        });

        describe('suppress the right events at the right time', function() {
            beforeEach(function () {
                if (browser.isIE() || browser.isEdge()) this.skip();
            });
            it('should suppress anything with a valid key', function() {
                const kbd = new Keyboard(document, {});
                const evt1 = keyevent('keydown', {code: 'KeyA', key: 'a'});
                kbd._handleKeyDown(evt1);
                expect(evt1.preventDefault).to.have.been.called;
                const evt2 = keyevent('keyup', {code: 'KeyA', key: 'a'});
                kbd._handleKeyUp(evt2);
                expect(evt2.preventDefault).to.have.been.called;
            });
            it('should not suppress keys without key', function() {
                const kbd = new Keyboard(document, {});
                const evt = keyevent('keydown', {code: 'KeyA', keyCode: 0x41});
                kbd._handleKeyDown(evt);
                expect(evt.preventDefault).to.not.have.been.called;
            });
            it('should suppress the following keypress event', function() {
                const kbd = new Keyboard(document, {});
                const evt1 = keyevent('keydown', {code: 'KeyA', keyCode: 0x41});
                kbd._handleKeyDown(evt1);
                const evt2 = keyevent('keypress', {code: 'KeyA', charCode: 0x41});
                kbd._handleKeyPress(evt2);
                expect(evt2.preventDefault).to.have.been.called;
            });
        });
    });

    describe('Fake keyup', function() {
        it('should fake keyup events for virtual keyboards', function(done) {
            if (browser.isIE() || browser.isEdge()) this.skip();
            let count = 0;
            const kbd = new Keyboard(document);
            kbd.onkeyevent = function(keysym, code, down) {
                switch (count++) {
                    case 0:
                        expect(keysym).to.be.equal(0x61);
                        expect(code).to.be.equal('Unidentified');
                        expect(down).to.be.equal(true);
                        break;
                    case 1:
                        expect(keysym).to.be.equal(0x61);
                        expect(code).to.be.equal('Unidentified');
                        expect(down).to.be.equal(false);
                        done();
                }
            };
            kbd._handleKeyDown(keyevent('keydown', {code: 'Unidentified', key: 'a'}));
        });

        describe('iOS', function() {
            let origNavigator;
            beforeEach(function () {
                // window.navigator is a protected read-only property in many
                // environments, so we need to redefine it whilst running these
                // tests.
                origNavigator = Object.getOwnPropertyDescriptor(window, "navigator");
                if (origNavigator === undefined) {
                    // Object.getOwnPropertyDescriptor() doesn't work
                    // properly in any version of IE
                    this.skip();
                }

                Object.defineProperty(window, "navigator", {value: {}});
                if (window.navigator.platform !== undefined) {
                    // Object.defineProperty() doesn't work properly in old
                    // versions of Chrome
                    this.skip();
                }

                window.navigator.platform = "iPhone 9.0";
            });
            afterEach(function () {
                Object.defineProperty(window, "navigator", origNavigator);
            });

            it('should fake keyup events on iOS', function(done) {
                if (browser.isIE() || browser.isEdge()) this.skip();
                let count = 0;
                const kbd = new Keyboard(document);
                kbd.onkeyevent = function(keysym, code, down) {
                    switch (count++) {
                        case 0:
                            expect(keysym).to.be.equal(0x61);
                            expect(code).to.be.equal('KeyA');
                            expect(down).to.be.equal(true);
                            break;
                        case 1:
                            expect(keysym).to.be.equal(0x61);
                            expect(code).to.be.equal('KeyA');
                            expect(down).to.be.equal(false);
                            done();
                    }
                };
                kbd._handleKeyDown(keyevent('keydown', {code: 'KeyA', key: 'a'}));
            });
        });
    });

    describe('Track Key State', function() {
        beforeEach(function () {
            if (browser.isIE() || browser.isEdge()) this.skip();
        });
        it('should send release using the same keysym as the press', function(done) {
            const kbd = new Keyboard(document);
            kbd.onkeyevent = function(keysym, code, down) {
                expect(keysym).to.be.equal(0x61);
                expect(code).to.be.equal('KeyA');
                if (!down) {
                    done();
                }
            };
            kbd._handleKeyDown(keyevent('keydown', {code: 'KeyA', key: 'a'}));
            kbd._handleKeyUp(keyevent('keyup', {code: 'KeyA', key: 'b'}));
        });
        it('should send the same keysym for multiple presses', function() {
            let count = 0;
            const kbd = new Keyboard(document);
            kbd.onkeyevent = function(keysym, code, down) {
                expect(keysym).to.be.equal(0x61);
                expect(code).to.be.equal('KeyA');
                expect(down).to.be.equal(true);
                count++;
            };
            kbd._handleKeyDown(keyevent('keydown', {code: 'KeyA', key: 'a'}));
            kbd._handleKeyDown(keyevent('keydown', {code: 'KeyA', key: 'b'}));
            expect(count).to.be.equal(2);
        });
        it('should do nothing on keyup events if no keys are down', function() {
            const kbd = new Keyboard(document);
            kbd.onkeyevent = sinon.spy();
            kbd._handleKeyUp(keyevent('keyup', {code: 'KeyA', key: 'a'}));
            expect(kbd.onkeyevent).to.not.have.been.called;
        });

        describe('Legacy Events', function() {
            it('should track keys using keyCode if no code', function(done) {
                const kbd = new Keyboard(document);
                kbd.onkeyevent = function(keysym, code, down) {
                    expect(keysym).to.be.equal(0x61);
                    expect(code).to.be.equal('Platform65');
                    if (!down) {
                        done();
                    }
                };
                kbd._handleKeyDown(keyevent('keydown', {keyCode: 65, key: 'a'}));
                kbd._handleKeyUp(keyevent('keyup', {keyCode: 65, key: 'b'}));
            });
            it('should ignore compositing code', function() {
                const kbd = new Keyboard(document);
                kbd.onkeyevent = function(keysym, code, down) {
                    expect(keysym).to.be.equal(0x61);
                    expect(code).to.be.equal('Unidentified');
                };
                kbd._handleKeyDown(keyevent('keydown', {keyCode: 229, key: 'a'}));
            });
            it('should track keys using keyIdentifier if no code', function(done) {
                const kbd = new Keyboard(document);
                kbd.onkeyevent = function(keysym, code, down) {
                    expect(keysym).to.be.equal(0x61);
                    expect(code).to.be.equal('Platform65');
                    if (!down) {
                        done();
                    }
                };
                kbd._handleKeyDown(keyevent('keydown', {keyIdentifier: 'U+0041', key: 'a'}));
                kbd._handleKeyUp(keyevent('keyup', {keyIdentifier: 'U+0041', key: 'b'}));
            });
        });
    });

    describe('Shuffle modifiers on macOS', function() {
        let origNavigator;
        beforeEach(function () {
            // window.navigator is a protected read-only property in many
            // environments, so we need to redefine it whilst running these
            // tests.
            origNavigator = Object.getOwnPropertyDescriptor(window, "navigator");
            if (origNavigator === undefined) {
                // Object.getOwnPropertyDescriptor() doesn't work
                // properly in any version of IE
                this.skip();
            }

            Object.defineProperty(window, "navigator", {value: {}});
            if (window.navigator.platform !== undefined) {
                // Object.defineProperty() doesn't work properly in old
                // versions of Chrome
                this.skip();
            }

            window.navigator.platform = "Mac x86_64";
        });
        afterEach(function () {
            Object.defineProperty(window, "navigator", origNavigator);
        });

        it('should change Alt to AltGraph', function() {
            let count = 0;
            const kbd = new Keyboard(document);
            kbd.onkeyevent = function(keysym, code, down) {
                switch (count++) {
                    case 0:
                        expect(keysym).to.be.equal(0xFF7E);
                        expect(code).to.be.equal('AltLeft');
                        break;
                    case 1:
                        expect(keysym).to.be.equal(0xFE03);
                        expect(code).to.be.equal('AltRight');
                        break;
                }
            };
            kbd._handleKeyDown(keyevent('keydown', {code: 'AltLeft', key: 'Alt', location: 1}));
            kbd._handleKeyDown(keyevent('keydown', {code: 'AltRight', key: 'Alt', location: 2}));
            expect(count).to.be.equal(2);
        });
        it('should change left Super to Alt', function(done) {
            const kbd = new Keyboard(document);
            kbd.onkeyevent = function(keysym, code, down) {
                expect(keysym).to.be.equal(0xFFE9);
                expect(code).to.be.equal('MetaLeft');
                done();
            };
            kbd._handleKeyDown(keyevent('keydown', {code: 'MetaLeft', key: 'Meta', location: 1}));
        });
        it('should change right Super to left Super', function(done) {
            const kbd = new Keyboard(document);
            kbd.onkeyevent = function(keysym, code, down) {
                expect(keysym).to.be.equal(0xFFEB);
                expect(code).to.be.equal('MetaRight');
                done();
            };
            kbd._handleKeyDown(keyevent('keydown', {code: 'MetaRight', key: 'Meta', location: 2}));
        });
    });

    describe('Escape AltGraph on Windows', function() {
        let origNavigator;
        beforeEach(function () {
            // window.navigator is a protected read-only property in many
            // environments, so we need to redefine it whilst running these
            // tests.
            origNavigator = Object.getOwnPropertyDescriptor(window, "navigator");
            if (origNavigator === undefined) {
                // Object.getOwnPropertyDescriptor() doesn't work
                // properly in any version of IE
                this.skip();
            }

            Object.defineProperty(window, "navigator", {value: {}});
            if (window.navigator.platform !== undefined) {
                // Object.defineProperty() doesn't work properly in old
                // versions of Chrome
                this.skip();
            }

            window.navigator.platform = "Windows x86_64";

            this.clock = sinon.useFakeTimers();
        });
        afterEach(function () {
            Object.defineProperty(window, "navigator", origNavigator);
            this.clock.restore();
        });

        it('should supress ControlLeft until it knows if it is AltGr', function () {
            const kbd = new Keyboard(document);
            kbd.onkeyevent = sinon.spy();
            kbd._handleKeyDown(keyevent('keydown', {code: 'ControlLeft', key: 'Control', location: 1}));
            expect(kbd.onkeyevent).to.not.have.been.called;
        });

        it('should not trigger on repeating ControlLeft', function () {
            const kbd = new Keyboard(document);
            kbd.onkeyevent = sinon.spy();
            kbd._handleKeyDown(keyevent('keydown', {code: 'ControlLeft', key: 'Control', location: 1}));
            kbd._handleKeyDown(keyevent('keydown', {code: 'ControlLeft', key: 'Control', location: 1}));
            expect(kbd.onkeyevent).to.have.been.calledTwice;
            expect(kbd.onkeyevent.firstCall).to.have.been.calledWith(0xffe3, "ControlLeft", true);
            expect(kbd.onkeyevent.secondCall).to.have.been.calledWith(0xffe3, "ControlLeft", true);
        });

        it('should not supress ControlRight', function () {
            const kbd = new Keyboard(document);
            kbd.onkeyevent = sinon.spy();
            kbd._handleKeyDown(keyevent('keydown', {code: 'ControlRight', key: 'Control', location: 2}));
            expect(kbd.onkeyevent).to.have.been.calledOnce;
            expect(kbd.onkeyevent).to.have.been.calledWith(0xffe4, "ControlRight", true);
        });

        it('should release ControlLeft after 100 ms', function () {
            const kbd = new Keyboard(document);
            kbd.onkeyevent = sinon.spy();
            kbd._handleKeyDown(keyevent('keydown', {code: 'ControlLeft', key: 'Control', location: 1}));
            expect(kbd.onkeyevent).to.not.have.been.called;
            this.clock.tick(100);
            expect(kbd.onkeyevent).to.have.been.calledOnce;
            expect(kbd.onkeyevent).to.have.been.calledWith(0xffe3, "ControlLeft", true);
        });

        it('should release ControlLeft on other key press', function () {
            const kbd = new Keyboard(document);
            kbd.onkeyevent = sinon.spy();
            kbd._handleKeyDown(keyevent('keydown', {code: 'ControlLeft', key: 'Control', location: 1}));
            expect(kbd.onkeyevent).to.not.have.been.called;
            kbd._handleKeyDown(keyevent('keydown', {code: 'KeyA', key: 'a'}));
            expect(kbd.onkeyevent).to.have.been.calledTwice;
            expect(kbd.onkeyevent.firstCall).to.have.been.calledWith(0xffe3, "ControlLeft", true);
            expect(kbd.onkeyevent.secondCall).to.have.been.calledWith(0x61, "KeyA", true);

            // Check that the timer is properly dead
            kbd.onkeyevent.reset();
            this.clock.tick(100);
            expect(kbd.onkeyevent).to.not.have.been.called;
        });

        it('should release ControlLeft on other key release', function () {
            const kbd = new Keyboard(document);
            kbd.onkeyevent = sinon.spy();
            kbd._handleKeyDown(keyevent('keydown', {code: 'KeyA', key: 'a'}));
            kbd._handleKeyDown(keyevent('keydown', {code: 'ControlLeft', key: 'Control', location: 1}));
            expect(kbd.onkeyevent).to.have.been.calledOnce;
            expect(kbd.onkeyevent.firstCall).to.have.been.calledWith(0x61, "KeyA", true);
            kbd._handleKeyUp(keyevent('keyup', {code: 'KeyA', key: 'a'}));
            expect(kbd.onkeyevent).to.have.been.calledThrice;
            expect(kbd.onkeyevent.secondCall).to.have.been.calledWith(0xffe3, "ControlLeft", true);
            expect(kbd.onkeyevent.thirdCall).to.have.been.calledWith(0x61, "KeyA", false);

            // Check that the timer is properly dead
            kbd.onkeyevent.reset();
            this.clock.tick(100);
            expect(kbd.onkeyevent).to.not.have.been.called;
        });

        it('should generate AltGraph for quick Ctrl+Alt sequence', function () {
            const kbd = new Keyboard(document);
            kbd.onkeyevent = sinon.spy();
            kbd._handleKeyDown(keyevent('keydown', {code: 'ControlLeft', key: 'Control', location: 1, timeStamp: Date.now()}));
            this.clock.tick(20);
            kbd._handleKeyDown(keyevent('keydown', {code: 'AltRight', key: 'Alt', location: 2, timeStamp: Date.now()}));
            expect(kbd.onkeyevent).to.have.been.calledOnce;
            expect(kbd.onkeyevent).to.have.been.calledWith(0xfe03, 'AltRight', true);

            // Check that the timer is properly dead
            kbd.onkeyevent.reset();
            this.clock.tick(100);
            expect(kbd.onkeyevent).to.not.have.been.called;
        });

        it('should generate Ctrl, Alt for slow Ctrl+Alt sequence', function () {
            const kbd = new Keyboard(document);
            kbd.onkeyevent = sinon.spy();
            kbd._handleKeyDown(keyevent('keydown', {code: 'ControlLeft', key: 'Control', location: 1, timeStamp: Date.now()}));
            this.clock.tick(60);
            kbd._handleKeyDown(keyevent('keydown', {code: 'AltRight', key: 'Alt', location: 2, timeStamp: Date.now()}));
            expect(kbd.onkeyevent).to.have.been.calledTwice;
            expect(kbd.onkeyevent.firstCall).to.have.been.calledWith(0xffe3, "ControlLeft", true);
            expect(kbd.onkeyevent.secondCall).to.have.been.calledWith(0xffea, "AltRight", true);

            // Check that the timer is properly dead
            kbd.onkeyevent.reset();
            this.clock.tick(100);
            expect(kbd.onkeyevent).to.not.have.been.called;
        });

        it('should pass through single Alt', function () {
            const kbd = new Keyboard(document);
            kbd.onkeyevent = sinon.spy();
            kbd._handleKeyDown(keyevent('keydown', {code: 'AltRight', key: 'Alt', location: 2}));
            expect(kbd.onkeyevent).to.have.been.calledOnce;
            expect(kbd.onkeyevent).to.have.been.calledWith(0xffea, 'AltRight', true);
        });

        it('should pass through single AltGr', function () {
            const kbd = new Keyboard(document);
            kbd.onkeyevent = sinon.spy();
            kbd._handleKeyDown(keyevent('keydown', {code: 'AltRight', key: 'AltGraph', location: 2}));
            expect(kbd.onkeyevent).to.have.been.calledOnce;
            expect(kbd.onkeyevent).to.have.been.calledWith(0xfe03, 'AltRight', true);
        });
    });
});
