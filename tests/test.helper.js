const expect = chai.expect;

import keysyms from '../core/input/keysymdef.js';
import * as KeyboardUtil from "../core/input/util.js";
import * as browser from '../core/util/browser.js';

describe('Helpers', function () {
    "use strict";

    describe('keysyms.lookup', function () {
        it('should map ASCII characters to keysyms', function () {
            expect(keysyms.lookup('a'.charCodeAt())).to.be.equal(0x61);
            expect(keysyms.lookup('A'.charCodeAt())).to.be.equal(0x41);
        });
        it('should map Latin-1 characters to keysyms', function () {
            expect(keysyms.lookup('ø'.charCodeAt())).to.be.equal(0xf8);

            expect(keysyms.lookup('é'.charCodeAt())).to.be.equal(0xe9);
        });
        it('should map characters that are in Windows-1252 but not in Latin-1 to keysyms', function () {
            expect(keysyms.lookup('Š'.charCodeAt())).to.be.equal(0x01a9);
        });
        it('should map characters which aren\'t in Latin1 *or* Windows-1252 to keysyms', function () {
            expect(keysyms.lookup('ũ'.charCodeAt())).to.be.equal(0x03fd);
        });
        it('should map unknown codepoints to the Unicode range', function () {
            expect(keysyms.lookup('\n'.charCodeAt())).to.be.equal(0x100000a);
            expect(keysyms.lookup('\u262D'.charCodeAt())).to.be.equal(0x100262d);
        });
        // This requires very recent versions of most browsers... skipping for now
        it.skip('should map UCS-4 codepoints to the Unicode range', function () {
            //expect(keysyms.lookup('\u{1F686}'.codePointAt())).to.be.equal(0x101f686);
        });
    });

    describe('getKeycode', function () {
        it('should pass through proper code', function () {
            expect(KeyboardUtil.getKeycode({code: 'Semicolon'})).to.be.equal('Semicolon');
        });
        it('should map legacy values', function () {
            expect(KeyboardUtil.getKeycode({code: ''})).to.be.equal('Unidentified');
            expect(KeyboardUtil.getKeycode({code: 'OSLeft'})).to.be.equal('MetaLeft');
        });
        it('should map keyCode to code when possible', function () {
            expect(KeyboardUtil.getKeycode({keyCode: 0x14})).to.be.equal('CapsLock');
            expect(KeyboardUtil.getKeycode({keyCode: 0x5b})).to.be.equal('MetaLeft');
            expect(KeyboardUtil.getKeycode({keyCode: 0x35})).to.be.equal('Digit5');
            expect(KeyboardUtil.getKeycode({keyCode: 0x65})).to.be.equal('Numpad5');
        });
        it('should map keyCode left/right side', function () {
            expect(KeyboardUtil.getKeycode({keyCode: 0x10, location: 1})).to.be.equal('ShiftLeft');
            expect(KeyboardUtil.getKeycode({keyCode: 0x10, location: 2})).to.be.equal('ShiftRight');
            expect(KeyboardUtil.getKeycode({keyCode: 0x11, location: 1})).to.be.equal('ControlLeft');
            expect(KeyboardUtil.getKeycode({keyCode: 0x11, location: 2})).to.be.equal('ControlRight');
        });
        it('should map keyCode on numpad', function () {
            expect(KeyboardUtil.getKeycode({keyCode: 0x0d, location: 0})).to.be.equal('Enter');
            expect(KeyboardUtil.getKeycode({keyCode: 0x0d, location: 3})).to.be.equal('NumpadEnter');
            expect(KeyboardUtil.getKeycode({keyCode: 0x23, location: 0})).to.be.equal('End');
            expect(KeyboardUtil.getKeycode({keyCode: 0x23, location: 3})).to.be.equal('Numpad1');
        });
        it('should return Unidentified when it cannot map the keyCode', function () {
            expect(KeyboardUtil.getKeycode({keycode: 0x42})).to.be.equal('Unidentified');
        });

        describe('Fix Meta on macOS', function () {
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

            it('should respect ContextMenu on modern browser', function () {
                expect(KeyboardUtil.getKeycode({code: 'ContextMenu', keyCode: 0x5d})).to.be.equal('ContextMenu');
            });
            it('should translate legacy ContextMenu to MetaRight', function () {
                expect(KeyboardUtil.getKeycode({keyCode: 0x5d})).to.be.equal('MetaRight');
            });
        });
    });

    describe('getKey', function () {
        it('should prefer key', function () {
            if (browser.isIE() || browser.isEdge()) this.skip();
            expect(KeyboardUtil.getKey({key: 'a', charCode: 'Š'.charCodeAt(), keyCode: 0x42, which: 0x43})).to.be.equal('a');
        });
        it('should map legacy values', function () {
            expect(KeyboardUtil.getKey({key: 'Spacebar'})).to.be.equal(' ');
            expect(KeyboardUtil.getKey({key: 'Left'})).to.be.equal('ArrowLeft');
            expect(KeyboardUtil.getKey({key: 'OS'})).to.be.equal('Meta');
            expect(KeyboardUtil.getKey({key: 'Win'})).to.be.equal('Meta');
            expect(KeyboardUtil.getKey({key: 'UIKeyInputLeftArrow'})).to.be.equal('ArrowLeft');
        });
        it('should handle broken Delete', function () {
            expect(KeyboardUtil.getKey({key: '\x00', code: 'NumpadDecimal'})).to.be.equal('Delete');
        });
        it('should use code if no key', function () {
            expect(KeyboardUtil.getKey({code: 'NumpadBackspace'})).to.be.equal('Backspace');
        });
        it('should not use code fallback for character keys', function () {
            expect(KeyboardUtil.getKey({code: 'KeyA'})).to.be.equal('Unidentified');
            expect(KeyboardUtil.getKey({code: 'Digit1'})).to.be.equal('Unidentified');
            expect(KeyboardUtil.getKey({code: 'Period'})).to.be.equal('Unidentified');
            expect(KeyboardUtil.getKey({code: 'Numpad1'})).to.be.equal('Unidentified');
        });
        it('should use charCode if no key', function () {
            expect(KeyboardUtil.getKey({charCode: 'Š'.charCodeAt(), keyCode: 0x42, which: 0x43})).to.be.equal('Š');
        });
        it('should return Unidentified when it cannot map the key', function () {
            expect(KeyboardUtil.getKey({keycode: 0x42})).to.be.equal('Unidentified');
        });

        describe('Broken key AltGraph on IE/Edge', function () {
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
            });
            afterEach(function () {
                Object.defineProperty(window, "navigator", origNavigator);
            });

            it('should ignore printable character key on IE', function () {
                window.navigator.userAgent = "Mozilla/5.0 (Windows NT 6.3; Trident/7.0; rv:11.0) like Gecko";
                expect(KeyboardUtil.getKey({key: 'a'})).to.be.equal('Unidentified');
            });
            it('should ignore printable character key on Edge', function () {
                window.navigator.userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.79 Safari/537.36 Edge/14.14393";
                expect(KeyboardUtil.getKey({key: 'a'})).to.be.equal('Unidentified');
            });
            it('should allow non-printable character key on IE', function () {
                window.navigator.userAgent = "Mozilla/5.0 (Windows NT 6.3; Trident/7.0; rv:11.0) like Gecko";
                expect(KeyboardUtil.getKey({key: 'Shift'})).to.be.equal('Shift');
            });
            it('should allow non-printable character key on Edge', function () {
                window.navigator.userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.79 Safari/537.36 Edge/14.14393";
                expect(KeyboardUtil.getKey({key: 'Shift'})).to.be.equal('Shift');
            });
        });
    });

    describe('getKeysym', function () {
        describe('Non-character keys', function () {
            it('should recognize the right keys', function () {
                expect(KeyboardUtil.getKeysym({key: 'Enter'})).to.be.equal(0xFF0D);
                expect(KeyboardUtil.getKeysym({key: 'Backspace'})).to.be.equal(0xFF08);
                expect(KeyboardUtil.getKeysym({key: 'Tab'})).to.be.equal(0xFF09);
                expect(KeyboardUtil.getKeysym({key: 'Shift'})).to.be.equal(0xFFE1);
                expect(KeyboardUtil.getKeysym({key: 'Control'})).to.be.equal(0xFFE3);
                expect(KeyboardUtil.getKeysym({key: 'Alt'})).to.be.equal(0xFFE9);
                expect(KeyboardUtil.getKeysym({key: 'Meta'})).to.be.equal(0xFFEB);
                expect(KeyboardUtil.getKeysym({key: 'Escape'})).to.be.equal(0xFF1B);
                expect(KeyboardUtil.getKeysym({key: 'ArrowUp'})).to.be.equal(0xFF52);
            });
            it('should map left/right side', function () {
                expect(KeyboardUtil.getKeysym({key: 'Shift', location: 1})).to.be.equal(0xFFE1);
                expect(KeyboardUtil.getKeysym({key: 'Shift', location: 2})).to.be.equal(0xFFE2);
                expect(KeyboardUtil.getKeysym({key: 'Control', location: 1})).to.be.equal(0xFFE3);
                expect(KeyboardUtil.getKeysym({key: 'Control', location: 2})).to.be.equal(0xFFE4);
            });
            it('should handle AltGraph', function () {
                expect(KeyboardUtil.getKeysym({code: 'AltRight', key: 'Alt', location: 2})).to.be.equal(0xFFEA);
                expect(KeyboardUtil.getKeysym({code: 'AltRight', key: 'AltGraph', location: 2})).to.be.equal(0xFE03);
            });
            it('should handle Meta/Windows distinction', function () {
                expect(KeyboardUtil.getKeysym({code: 'AltLeft', key: 'Meta', location: 1})).to.be.equal(0xFFE7);
                expect(KeyboardUtil.getKeysym({code: 'AltRight', key: 'Meta', location: 2})).to.be.equal(0xFFE8);
                expect(KeyboardUtil.getKeysym({code: 'MetaLeft', key: 'Meta', location: 1})).to.be.equal(0xFFEB);
                expect(KeyboardUtil.getKeysym({code: 'MetaRight', key: 'Meta', location: 2})).to.be.equal(0xFFEC);
            });
            it('should return null for unknown keys', function () {
                expect(KeyboardUtil.getKeysym({key: 'Semicolon'})).to.be.null;
                expect(KeyboardUtil.getKeysym({key: 'BracketRight'})).to.be.null;
            });
            it('should handle remappings', function () {
                expect(KeyboardUtil.getKeysym({code: 'ControlLeft', key: 'Tab'})).to.be.equal(0xFF09);
            });
        });

        describe('Numpad', function () {
            it('should handle Numpad numbers', function () {
                if (browser.isIE() || browser.isEdge()) this.skip();
                expect(KeyboardUtil.getKeysym({code: 'Digit5', key: '5', location: 0})).to.be.equal(0x0035);
                expect(KeyboardUtil.getKeysym({code: 'Numpad5', key: '5', location: 3})).to.be.equal(0xFFB5);
            });
            it('should handle Numpad non-character keys', function () {
                expect(KeyboardUtil.getKeysym({code: 'Home', key: 'Home', location: 0})).to.be.equal(0xFF50);
                expect(KeyboardUtil.getKeysym({code: 'Numpad5', key: 'Home', location: 3})).to.be.equal(0xFF95);
                expect(KeyboardUtil.getKeysym({code: 'Delete', key: 'Delete', location: 0})).to.be.equal(0xFFFF);
                expect(KeyboardUtil.getKeysym({code: 'NumpadDecimal', key: 'Delete', location: 3})).to.be.equal(0xFF9F);
            });
            it('should handle Numpad Decimal key', function () {
                if (browser.isIE() || browser.isEdge()) this.skip();
                expect(KeyboardUtil.getKeysym({code: 'NumpadDecimal', key: '.', location: 3})).to.be.equal(0xFFAE);
                expect(KeyboardUtil.getKeysym({code: 'NumpadDecimal', key: ',', location: 3})).to.be.equal(0xFFAC);
            });
        });
    });
});
