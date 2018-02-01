var assert = chai.assert;
var expect = chai.expect;

import sinon from '../vendor/sinon.js';

import Keyboard from '../core/input/keyboard.js';
import * as browser from '../core/util/browser.js';

describe('Key Event Handling', function() {
    "use strict";

    // The real KeyboardEvent constructor might not work everywhere we
    // want to run these tests
    function keyevent(typeArg, KeyboardEventInit) {
        var e = { type: typeArg };
        for (var key in KeyboardEventInit) {
            e[key] = KeyboardEventInit[key];
        }
        e.stopPropagation = sinon.spy();
        e.preventDefault = sinon.spy();
        return e;
    };

    describe('Decode Keyboard Events', function() {
        it('should decode keydown events', function(done) {
            if (browser.isIE() || browser.isEdge()) this.skip();
            var kbd = new Keyboard(document);
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
            var calls = 0;
            var kbd = new Keyboard(document);
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
                var kbd = new Keyboard(document);
                kbd.onkeyevent = sinon.spy();
                kbd._handleKeyDown(keyevent('keydown', {code: 'KeyA', keyCode: 0x41}));
                expect(kbd.onkeyevent).to.not.have.been.called;
            });
            it('should decode keypress events', function(done) {
                var kbd = new Keyboard(document);
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
                var kbd = new Keyboard(document);
                kbd.onkeyevent = sinon.spy();
                kbd._handleKeyDown(keyevent('keydown', {code: 'KeyA', keyCode: 0x41}));
                kbd._handleKeyPress(keyevent('keypress', {code: 'KeyB', charCode: 0x61}));
                expect(kbd.onkeyevent).to.not.have.been.called;
            });
            it('should handle keypress with missing code', function(done) {
                var kbd = new Keyboard(document);
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
                var kbd = new Keyboard(document);
                kbd.onkeyevent = function(keysym, code, down) {
                    expect(keysym).to.be.equal(0x32);
                    expect(code).to.be.equal('Digit2');
                    expect(down).to.be.equal(true);
                    done();
                };
                kbd._handleKeyDown(keyevent('keydown', {code: 'Digit2', keyCode: 0x32}));
            });
            it('should guess key if no keypress and alpha key', function(done) {
                var kbd = new Keyboard(document);
                kbd.onkeyevent = function(keysym, code, down) {
                    expect(keysym).to.be.equal(0x61);
                    expect(code).to.be.equal('KeyA');
                    expect(down).to.be.equal(true);
                    done();
                };
                kbd._handleKeyDown(keyevent('keydown', {code: 'KeyA', keyCode: 0x41, shiftKey: false}));
            });
            it('should guess key if no keypress and alpha key (with shift)', function(done) {
                var kbd = new Keyboard(document);
                kbd.onkeyevent = function(keysym, code, down) {
                    expect(keysym).to.be.equal(0x41);
                    expect(code).to.be.equal('KeyA');
                    expect(down).to.be.equal(true);
                    done();
                };
                kbd._handleKeyDown(keyevent('keydown', {code: 'KeyA', keyCode: 0x41, shiftKey: true}));
            });
            it('should not guess key if no keypress and unknown key', function(done) {
                var kbd = new Keyboard(document);
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
                var kbd = new Keyboard(document, {});
                var evt = keyevent('keydown', {code: 'KeyA', key: 'a'});
                kbd._handleKeyDown(evt);
                expect(evt.preventDefault).to.have.been.called;
                evt = keyevent('keyup', {code: 'KeyA', key: 'a'});
                kbd._handleKeyUp(evt);
                expect(evt.preventDefault).to.have.been.called;
            });
            it('should not suppress keys without key', function() {
                var kbd = new Keyboard(document, {});
                var evt = keyevent('keydown', {code: 'KeyA', keyCode: 0x41});
                kbd._handleKeyDown(evt);
                expect(evt.preventDefault).to.not.have.been.called;
            });
            it('should suppress the following keypress event', function() {
                var kbd = new Keyboard(document, {});
                var evt = keyevent('keydown', {code: 'KeyA', keyCode: 0x41});
                kbd._handleKeyDown(evt);
                var evt = keyevent('keypress', {code: 'KeyA', charCode: 0x41});
                kbd._handleKeyPress(evt);
                expect(evt.preventDefault).to.have.been.called;
            });
        });
    });

    describe('Fake keyup', function() {
        it('should fake keyup events for virtual keyboards', function(done) {
            if (browser.isIE() || browser.isEdge()) this.skip();
            var count = 0;
            var kbd = new Keyboard(document);
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
            var origNavigator;
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
                var count = 0;
                var kbd = new Keyboard(document);
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
            var kbd = new Keyboard(document);
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
            var count = 0;
            var kbd = new Keyboard(document);
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
            var kbd = new Keyboard(document);
            kbd.onkeyevent = sinon.spy();
            kbd._handleKeyUp(keyevent('keyup', {code: 'KeyA', key: 'a'}));
            expect(kbd.onkeyevent).to.not.have.been.called;
        });

        describe('Legacy Events', function() {
            it('should track keys using keyCode if no code', function(done) {
                var kbd = new Keyboard(document);
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
                var kbd = new Keyboard(document);
                kbd.onkeyevent = function(keysym, code, down) {
                    expect(keysym).to.be.equal(0x61);
                    expect(code).to.be.equal('Unidentified');
                };
                kbd._handleKeyDown(keyevent('keydown', {keyCode: 229, key: 'a'}));
            });
            it('should track keys using keyIdentifier if no code', function(done) {
                var kbd = new Keyboard(document);
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
        var origNavigator;
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
            var count = 0;
            var kbd = new Keyboard(document);
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
            var kbd = new Keyboard(document);
            kbd.onkeyevent = function(keysym, code, down) {
                expect(keysym).to.be.equal(0xFFE9);
                expect(code).to.be.equal('MetaLeft');
                done();
            };
            kbd._handleKeyDown(keyevent('keydown', {code: 'MetaLeft', key: 'Meta', location: 1}));
        });
        it('should change right Super to left Super', function(done) {
            var kbd = new Keyboard(document);
            kbd.onkeyevent = function(keysym, code, down) {
                expect(keysym).to.be.equal(0xFFEB);
                expect(code).to.be.equal('MetaRight');
                done();
            };
            kbd._handleKeyDown(keyevent('keydown', {code: 'MetaRight', key: 'Meta', location: 2}));
        });
    });

    describe('Escape AltGraph on Windows', function() {
        var origNavigator;
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
        });
        afterEach(function () {
            Object.defineProperty(window, "navigator", origNavigator);
        });

        it('should generate fake undo/redo events on press when AltGraph is down', function() {
            var times_called = 0;
            var kbd = new Keyboard(document);
            kbd.onkeyevent = function(keysym, code, down) {
                switch(times_called++) {
                case 0:
                    expect(keysym).to.be.equal(0xFFE3);
                    expect(code).to.be.equal('ControlLeft');
                    expect(down).to.be.equal(true);
                    break;
                case 1:
                    expect(keysym).to.be.equal(0xFFEA);
                    expect(code).to.be.equal('AltRight');
                    expect(down).to.be.equal(true);
                    break;
                case 2:
                    expect(keysym).to.be.equal(0xFFEA);
                    expect(code).to.be.equal('AltRight');
                    expect(down).to.be.equal(false);
                    break;
                case 3:
                    expect(keysym).to.be.equal(0xFFE3);
                    expect(code).to.be.equal('ControlLeft');
                    expect(down).to.be.equal(false);
                    break;
                case 4:
                    expect(keysym).to.be.equal(0x61);
                    expect(code).to.be.equal('KeyA');
                    expect(down).to.be.equal(true);
                    break;
                case 5:
                    expect(keysym).to.be.equal(0xFFE3);
                    expect(code).to.be.equal('ControlLeft');
                    expect(down).to.be.equal(true);
                    break;
                case 6:
                    expect(keysym).to.be.equal(0xFFEA);
                    expect(code).to.be.equal('AltRight');
                    expect(down).to.be.equal(true);
                    break;
                }
            };
            // First the modifier combo
            kbd._handleKeyDown(keyevent('keydown', {code: 'ControlLeft', key: 'Control', location: 1}));
            kbd._handleKeyDown(keyevent('keydown', {code: 'AltRight', key: 'Alt', location: 2}));
            // Next a normal character
            kbd._handleKeyDown(keyevent('keydown', {code: 'KeyA', key: 'a'}));
            expect(times_called).to.be.equal(7);
        });
        it('should no do anything on key release', function() {
            var times_called = 0;
            var kbd = new Keyboard(document);
            kbd.onkeyevent = function(keysym, code, down) {
                switch(times_called++) {
                case 7:
                    expect(keysym).to.be.equal(0x61);
                    expect(code).to.be.equal('KeyA');
                    expect(down).to.be.equal(false);
                    break;
                }
            };
            // First the modifier combo
            kbd._handleKeyDown(keyevent('keydown', {code: 'ControlLeft', key: 'Control', location: 1}));
            kbd._handleKeyDown(keyevent('keydown', {code: 'AltRight', key: 'Alt', location: 2}));
            // Next a normal character
            kbd._handleKeyDown(keyevent('keydown', {code: 'KeyA', key: 'a'}));
            kbd._handleKeyUp(keyevent('keyup', {code: 'KeyA', key: 'a'}));
            expect(times_called).to.be.equal(8);
        });
        it('should not consider a char modifier to be down on the modifier key itself', function() {
            var times_called = 0;
            var kbd = new Keyboard(document);
            kbd.onkeyevent = function(keysym, code, down) {
                switch(times_called++) {
                case 0:
                    expect(keysym).to.be.equal(0xFFE3);
                    expect(code).to.be.equal('ControlLeft');
                    expect(down).to.be.equal(true);
                    break;
                case 1:
                    expect(keysym).to.be.equal(0xFFE9);
                    expect(code).to.be.equal('AltLeft');
                    expect(down).to.be.equal(true);
                    break;
                case 2:
                    expect(keysym).to.be.equal(0xFFE3);
                    expect(code).to.be.equal('ControlLeft');
                    expect(down).to.be.equal(true);
                    break;
                }
            };
            // First the modifier combo
            kbd._handleKeyDown(keyevent('keydown', {code: 'ControlLeft', key: 'Control', location: 1}));
            kbd._handleKeyDown(keyevent('keydown', {code: 'AltLeft', key: 'Alt', location: 1}));
            // Then one of the keys again
            kbd._handleKeyDown(keyevent('keydown', {code: 'ControlLeft', key: 'Control', location: 1}));
            expect(times_called).to.be.equal(3);
        });
    });
});
