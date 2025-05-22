import Keyboard from '../core/input/keyboard.js';

describe('Key event handling', function () {
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
        e.getModifierState = function (key) {
            return e[key];
        };

        return e;
    }

    describe('Decode keyboard events', function () {
        it('should decode keydown events', function (done) {
            const kbd = new Keyboard(document);
            kbd.onkeyevent = (keysym, code, down) => {
                expect(keysym).to.be.equal(0x61);
                expect(code).to.be.equal('KeyA');
                expect(down).to.be.equal(true);
                done();
            };
            kbd._handleKeyDown(keyevent('keydown', {code: 'KeyA', key: 'a'}));
        });
        it('should decode keyup events', function (done) {
            let calls = 0;
            const kbd = new Keyboard(document);
            kbd.onkeyevent = (keysym, code, down) => {
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
    });

    describe('Fake keyup', function () {
        it('should fake keyup events for virtual keyboards', function (done) {
            let count = 0;
            const kbd = new Keyboard(document);
            kbd.onkeyevent = (keysym, code, down) => {
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
    });

    describe('Track key state', function () {
        it('should send release using the same keysym as the press', function (done) {
            const kbd = new Keyboard(document);
            kbd.onkeyevent = (keysym, code, down) => {
                expect(keysym).to.be.equal(0x61);
                expect(code).to.be.equal('KeyA');
                if (!down) {
                    done();
                }
            };
            kbd._handleKeyDown(keyevent('keydown', {code: 'KeyA', key: 'a'}));
            kbd._handleKeyUp(keyevent('keyup', {code: 'KeyA', key: 'b'}));
        });
        it('should send the same keysym for multiple presses', function () {
            let count = 0;
            const kbd = new Keyboard(document);
            kbd.onkeyevent = (keysym, code, down) => {
                expect(keysym).to.be.equal(0x61);
                expect(code).to.be.equal('KeyA');
                expect(down).to.be.equal(true);
                count++;
            };
            kbd._handleKeyDown(keyevent('keydown', {code: 'KeyA', key: 'a'}));
            kbd._handleKeyDown(keyevent('keydown', {code: 'KeyA', key: 'b'}));
            expect(count).to.be.equal(2);
        });
        it('should do nothing on keyup events if no keys are down', function () {
            const kbd = new Keyboard(document);
            kbd.onkeyevent = sinon.spy();
            kbd._handleKeyUp(keyevent('keyup', {code: 'KeyA', key: 'a'}));
            expect(kbd.onkeyevent).to.not.have.been.called;
        });

        describe('Legacy events', function () {
            it('should track keys using keyCode if no code', function (done) {
                const kbd = new Keyboard(document);
                kbd.onkeyevent = (keysym, code, down) => {
                    expect(keysym).to.be.equal(0x61);
                    expect(code).to.be.equal('Platform65');
                    if (!down) {
                        done();
                    }
                };
                kbd._handleKeyDown(keyevent('keydown', {keyCode: 65, key: 'a'}));
                kbd._handleKeyUp(keyevent('keyup', {keyCode: 65, key: 'b'}));
            });
            it('should ignore compositing code', function () {
                const kbd = new Keyboard(document);
                kbd.onkeyevent = (keysym, code, down) => {
                    expect(keysym).to.be.equal(0x61);
                    expect(code).to.be.equal('Unidentified');
                };
                kbd._handleKeyDown(keyevent('keydown', {keyCode: 229, key: 'a'}));
            });
            it('should track keys using keyIdentifier if no code', function (done) {
                const kbd = new Keyboard(document);
                kbd.onkeyevent = (keysym, code, down) => {
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

    describe('Shuffle modifiers on macOS', function () {
        let origNavigator;
        beforeEach(function () {
            // window.navigator is a protected read-only property in many
            // environments, so we need to redefine it whilst running these
            // tests.
            origNavigator = Object.getOwnPropertyDescriptor(window, "navigator");

            Object.defineProperty(window, "navigator", {value: {}});
            window.navigator.platform = "Mac x86_64";
        });
        afterEach(function () {
            Object.defineProperty(window, "navigator", origNavigator);
        });

        it('should change Alt to AltGraph', function () {
            let count = 0;
            const kbd = new Keyboard(document);
            kbd.onkeyevent = (keysym, code, down) => {
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
        it('should change left Super to Alt', function (done) {
            const kbd = new Keyboard(document);
            kbd.onkeyevent = (keysym, code, down) => {
                expect(keysym).to.be.equal(0xFFE9);
                expect(code).to.be.equal('MetaLeft');
                done();
            };
            kbd._handleKeyDown(keyevent('keydown', {code: 'MetaLeft', key: 'Meta', location: 1}));
        });
        it('should change right Super to left Super', function (done) {
            const kbd = new Keyboard(document);
            kbd.onkeyevent = (keysym, code, down) => {
                expect(keysym).to.be.equal(0xFFEB);
                expect(code).to.be.equal('MetaRight');
                done();
            };
            kbd._handleKeyDown(keyevent('keydown', {code: 'MetaRight', key: 'Meta', location: 2}));
        });
    });

    describe('Meta key combination on iOS and macOS', function () {
        let origNavigator;
        beforeEach(function () {
            // window.navigator is a protected read-only property in many
            // environments, so we need to redefine it whilst running these
            // tests.
            origNavigator = Object.getOwnPropertyDescriptor(window, "navigator");

            Object.defineProperty(window, "navigator", {value: {}});
            if (window.navigator.platform !== undefined) {
                // Object.defineProperty() doesn't work properly in old
                // versions of Chrome
                this.skip();
            }
        });

        afterEach(function () {
            if (origNavigator !== undefined) {
                Object.defineProperty(window, "navigator", origNavigator);
            }
        });

        it('should send keyup when meta key is pressed on iOS', function () {
            window.navigator.platform = "iPad";
            const kbd = new Keyboard(document);
            kbd.onkeyevent = sinon.spy();

            kbd._handleKeyDown(keyevent('keydown', {code: 'MetaRight', key: 'Meta', location: 2, metaKey: true}));
            expect(kbd.onkeyevent).to.have.been.calledOnce;
            kbd.onkeyevent.resetHistory();

            kbd._handleKeyDown(keyevent('keydown', {code: 'KeyA', key: 'a', metaKey: true}));
            expect(kbd.onkeyevent).to.have.been.calledTwice;
            expect(kbd.onkeyevent).to.have.been.calledWith(0x61, "KeyA", true);
            expect(kbd.onkeyevent).to.have.been.calledWith(0x61, "KeyA", false);
            kbd.onkeyevent.resetHistory();

            kbd._handleKeyUp(keyevent('keyup', {code: 'MetaRight', key: 'Meta', location: 2, metaKey: true}));
            expect(kbd.onkeyevent).to.have.been.calledOnce;
        });

        it('should send keyup when meta key is pressed on macOS', function () {
            window.navigator.platform = "Mac";
            const kbd = new Keyboard(document);
            kbd.onkeyevent = sinon.spy();

            kbd._handleKeyDown(keyevent('keydown', {code: 'MetaRight', key: 'Meta', location: 2, metaKey: true}));
            expect(kbd.onkeyevent).to.have.been.calledOnce;
            kbd.onkeyevent.resetHistory();

            kbd._handleKeyDown(keyevent('keydown', {code: 'KeyA', key: 'a', metaKey: true}));
            expect(kbd.onkeyevent).to.have.been.calledTwice;
            expect(kbd.onkeyevent).to.have.been.calledWith(0x61, "KeyA", true);
            expect(kbd.onkeyevent).to.have.been.calledWith(0x61, "KeyA", false);
            kbd.onkeyevent.resetHistory();

            kbd._handleKeyUp(keyevent('keyup', {code: 'MetaRight', key: 'Meta', location: 2, metaKey: true}));
            expect(kbd.onkeyevent).to.have.been.calledOnce;
        });
    });

    describe('Caps Lock on iOS and macOS', function () {
        let origNavigator;
        beforeEach(function () {
            // window.navigator is a protected read-only property in many
            // environments, so we need to redefine it whilst running these
            // tests.
            origNavigator = Object.getOwnPropertyDescriptor(window, "navigator");

            Object.defineProperty(window, "navigator", {value: {}});
        });

        afterEach(function () {
            Object.defineProperty(window, "navigator", origNavigator);
        });

        it('should toggle caps lock on key press on iOS', function () {
            window.navigator.platform = "iPad";
            const kbd = new Keyboard(document);
            kbd.onkeyevent = sinon.spy();
            kbd._handleKeyDown(keyevent('keydown', {code: 'CapsLock', key: 'CapsLock'}));

            expect(kbd.onkeyevent).to.have.been.calledTwice;
            expect(kbd.onkeyevent.firstCall).to.have.been.calledWith(0xFFE5, "CapsLock", true);
            expect(kbd.onkeyevent.secondCall).to.have.been.calledWith(0xFFE5, "CapsLock", false);
        });

        it('should toggle caps lock on key press on mac', function () {
            window.navigator.platform = "Mac";
            const kbd = new Keyboard(document);
            kbd.onkeyevent = sinon.spy();
            kbd._handleKeyDown(keyevent('keydown', {code: 'CapsLock', key: 'CapsLock'}));

            expect(kbd.onkeyevent).to.have.been.calledTwice;
            expect(kbd.onkeyevent.firstCall).to.have.been.calledWith(0xFFE5, "CapsLock", true);
            expect(kbd.onkeyevent.secondCall).to.have.been.calledWith(0xFFE5, "CapsLock", false);
        });

        it('should toggle caps lock on key release on iOS', function () {
            window.navigator.platform = "iPad";
            const kbd = new Keyboard(document);
            kbd.onkeyevent = sinon.spy();
            kbd._handleKeyUp(keyevent('keyup', {code: 'CapsLock', key: 'CapsLock'}));

            expect(kbd.onkeyevent).to.have.been.calledTwice;
            expect(kbd.onkeyevent.firstCall).to.have.been.calledWith(0xFFE5, "CapsLock", true);
            expect(kbd.onkeyevent.secondCall).to.have.been.calledWith(0xFFE5, "CapsLock", false);
        });

        it('should toggle caps lock on key release on mac', function () {
            window.navigator.platform = "Mac";
            const kbd = new Keyboard(document);
            kbd.onkeyevent = sinon.spy();
            kbd._handleKeyUp(keyevent('keyup', {code: 'CapsLock', key: 'CapsLock'}));

            expect(kbd.onkeyevent).to.have.been.calledTwice;
            expect(kbd.onkeyevent.firstCall).to.have.been.calledWith(0xFFE5, "CapsLock", true);
            expect(kbd.onkeyevent.secondCall).to.have.been.calledWith(0xFFE5, "CapsLock", false);
        });
    });

    describe('Modifier status info', function () {
        let origNavigator;
        beforeEach(function () {
            // window.navigator is a protected read-only property in many
            // environments, so we need to redefine it whilst running these
            // tests.
            origNavigator = Object.getOwnPropertyDescriptor(window, "navigator");

            Object.defineProperty(window, "navigator", {value: {}});
        });

        afterEach(function () {
            Object.defineProperty(window, "navigator", origNavigator);
        });

        it('should provide caps lock state', function () {
            const kbd = new Keyboard(document);
            kbd.onkeyevent = sinon.spy();
            kbd._handleKeyDown(keyevent('keydown', {code: 'KeyA', key: 'A', NumLock: false, CapsLock: true}));

            expect(kbd.onkeyevent).to.have.been.calledOnce;
            expect(kbd.onkeyevent.firstCall).to.have.been.calledWith(0x41, "KeyA", true, false, true);
        });

        it('should provide num lock state', function () {
            const kbd = new Keyboard(document);
            kbd.onkeyevent = sinon.spy();
            kbd._handleKeyDown(keyevent('keydown', {code: 'KeyA', key: 'A', NumLock: true, CapsLock: false}));

            expect(kbd.onkeyevent).to.have.been.calledOnce;
            expect(kbd.onkeyevent.firstCall).to.have.been.calledWith(0x41, "KeyA", true, true, false);
        });

        it('should have no num lock state on mac', function () {
            window.navigator.platform = "Mac";
            const kbd = new Keyboard(document);
            kbd.onkeyevent = sinon.spy();
            kbd._handleKeyDown(keyevent('keydown', {code: 'KeyA', key: 'A', NumLock: false, CapsLock: true}));

            expect(kbd.onkeyevent).to.have.been.calledOnce;
            expect(kbd.onkeyevent.firstCall).to.have.been.calledWith(0x41, "KeyA", true, null, true);
        });
    });

    describe('Japanese IM keys on Windows', function () {
        let origNavigator;
        beforeEach(function () {
            // window.navigator is a protected read-only property in many
            // environments, so we need to redefine it whilst running these
            // tests.
            origNavigator = Object.getOwnPropertyDescriptor(window, "navigator");

            Object.defineProperty(window, "navigator", {value: {}});
            window.navigator.platform = "Windows";
        });

        afterEach(function () {
            Object.defineProperty(window, "navigator", origNavigator);
        });

        const keys = { 'Zenkaku': 0xff2a, 'Hankaku': 0xff2a,
                       'Alphanumeric': 0xff30, 'Katakana': 0xff26,
                       'Hiragana': 0xff25, 'Romaji': 0xff24,
                       'KanaMode': 0xff24 };
        for (let [key, keysym] of Object.entries(keys)) {
            it(`should fake key release for ${key} on Windows`, function () {
                let kbd = new Keyboard(document);
                kbd.onkeyevent = sinon.spy();
                kbd._handleKeyDown(keyevent('keydown', {code: 'FakeIM', key: key}));

                expect(kbd.onkeyevent).to.have.been.calledTwice;
                expect(kbd.onkeyevent.firstCall).to.have.been.calledWith(keysym, "FakeIM", true);
                expect(kbd.onkeyevent.secondCall).to.have.been.calledWith(keysym, "FakeIM", false);
            });
        }
    });

    describe('Escape AltGraph on Windows', function () {
        let origNavigator;
        beforeEach(function () {
            // window.navigator is a protected read-only property in many
            // environments, so we need to redefine it whilst running these
            // tests.
            origNavigator = Object.getOwnPropertyDescriptor(window, "navigator");

            Object.defineProperty(window, "navigator", {value: {}});
            window.navigator.platform = "Windows x86_64";

            this.clock = sinon.useFakeTimers();
        });
        afterEach(function () {
            Object.defineProperty(window, "navigator", origNavigator);
            if (this.clock !== undefined) {
                this.clock.restore();
            }
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
            kbd.onkeyevent.resetHistory();
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
            kbd.onkeyevent.resetHistory();
            this.clock.tick(100);
            expect(kbd.onkeyevent).to.not.have.been.called;
        });

        it('should release ControlLeft on blur', function () {
            const kbd = new Keyboard(document);
            kbd.onkeyevent = sinon.spy();
            kbd._handleKeyDown(keyevent('keydown', {code: 'ControlLeft', key: 'Control', location: 1}));
            expect(kbd.onkeyevent).to.not.have.been.called;
            kbd._allKeysUp();
            expect(kbd.onkeyevent).to.have.been.calledTwice;
            expect(kbd.onkeyevent.firstCall).to.have.been.calledWith(0xffe3, "ControlLeft", true);
            expect(kbd.onkeyevent.secondCall).to.have.been.calledWith(0xffe3, "ControlLeft", false);

            // Check that the timer is properly dead
            kbd.onkeyevent.resetHistory();
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
            kbd.onkeyevent.resetHistory();
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
            kbd.onkeyevent.resetHistory();
            this.clock.tick(100);
            expect(kbd.onkeyevent).to.not.have.been.called;
        });

        it('should generate AltGraph for quick Ctrl+AltGraph sequence', function () {
            const kbd = new Keyboard(document);
            kbd.onkeyevent = sinon.spy();
            kbd._handleKeyDown(keyevent('keydown', {code: 'ControlLeft', key: 'Control', location: 1, timeStamp: Date.now()}));
            this.clock.tick(20);
            kbd._handleKeyDown(keyevent('keydown', {code: 'AltRight', key: 'AltGraph', location: 2, timeStamp: Date.now()}));
            expect(kbd.onkeyevent).to.have.been.calledOnce;
            expect(kbd.onkeyevent).to.have.been.calledWith(0xfe03, 'AltRight', true);

            // Check that the timer is properly dead
            kbd.onkeyevent.resetHistory();
            this.clock.tick(100);
            expect(kbd.onkeyevent).to.not.have.been.called;
        });

        it('should generate Ctrl, AltGraph for slow Ctrl+AltGraph sequence', function () {
            const kbd = new Keyboard(document);
            kbd.onkeyevent = sinon.spy();
            kbd._handleKeyDown(keyevent('keydown', {code: 'ControlLeft', key: 'Control', location: 1, timeStamp: Date.now()}));
            this.clock.tick(60);
            kbd._handleKeyDown(keyevent('keydown', {code: 'AltRight', key: 'AltGraph', location: 2, timeStamp: Date.now()}));
            expect(kbd.onkeyevent).to.have.been.calledTwice;
            expect(kbd.onkeyevent.firstCall).to.have.been.calledWith(0xffe3, "ControlLeft", true);
            expect(kbd.onkeyevent.secondCall).to.have.been.calledWith(0xfe03, "AltRight", true);

            // Check that the timer is properly dead
            kbd.onkeyevent.resetHistory();
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

    describe('Missing Shift keyup on Windows', function () {
        let origNavigator;
        beforeEach(function () {
            // window.navigator is a protected read-only property in many
            // environments, so we need to redefine it whilst running these
            // tests.
            origNavigator = Object.getOwnPropertyDescriptor(window, "navigator");

            Object.defineProperty(window, "navigator", {value: {}});
            window.navigator.platform = "Windows x86_64";

            this.clock = sinon.useFakeTimers();
        });
        afterEach(function () {
            Object.defineProperty(window, "navigator", origNavigator);
            if (this.clock !== undefined) {
                this.clock.restore();
            }
        });

        it('should fake a left Shift keyup', function () {
            const kbd = new Keyboard(document);
            kbd.onkeyevent = sinon.spy();

            kbd._handleKeyDown(keyevent('keydown', {code: 'ShiftLeft', key: 'Shift', location: 1}));
            expect(kbd.onkeyevent).to.have.been.calledOnce;
            expect(kbd.onkeyevent).to.have.been.calledWith(0xffe1, 'ShiftLeft', true);
            kbd.onkeyevent.resetHistory();

            kbd._handleKeyDown(keyevent('keydown', {code: 'ShiftRight', key: 'Shift', location: 2}));
            expect(kbd.onkeyevent).to.have.been.calledOnce;
            expect(kbd.onkeyevent).to.have.been.calledWith(0xffe2, 'ShiftRight', true);
            kbd.onkeyevent.resetHistory();

            kbd._handleKeyUp(keyevent('keyup', {code: 'ShiftLeft', key: 'Shift', location: 1}));
            expect(kbd.onkeyevent).to.have.been.calledTwice;
            expect(kbd.onkeyevent).to.have.been.calledWith(0xffe2, 'ShiftRight', false);
            expect(kbd.onkeyevent).to.have.been.calledWith(0xffe1, 'ShiftLeft', false);
        });

        it('should fake a right Shift keyup', function () {
            const kbd = new Keyboard(document);
            kbd.onkeyevent = sinon.spy();

            kbd._handleKeyDown(keyevent('keydown', {code: 'ShiftLeft', key: 'Shift', location: 1}));
            expect(kbd.onkeyevent).to.have.been.calledOnce;
            expect(kbd.onkeyevent).to.have.been.calledWith(0xffe1, 'ShiftLeft', true);
            kbd.onkeyevent.resetHistory();

            kbd._handleKeyDown(keyevent('keydown', {code: 'ShiftRight', key: 'Shift', location: 2}));
            expect(kbd.onkeyevent).to.have.been.calledOnce;
            expect(kbd.onkeyevent).to.have.been.calledWith(0xffe2, 'ShiftRight', true);
            kbd.onkeyevent.resetHistory();

            kbd._handleKeyUp(keyevent('keyup', {code: 'ShiftRight', key: 'Shift', location: 2}));
            expect(kbd.onkeyevent).to.have.been.calledTwice;
            expect(kbd.onkeyevent).to.have.been.calledWith(0xffe2, 'ShiftRight', false);
            expect(kbd.onkeyevent).to.have.been.calledWith(0xffe1, 'ShiftLeft', false);
        });
    });
});
