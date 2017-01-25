var assert = chai.assert;
var expect = chai.expect;

import keysyms from '../core/input/keysymdef.js';
import * as KeyboardUtil from "../core/input/util.js";

describe('Helpers', function() {
    "use strict";

    describe('keysyms.lookup', function() {
        it('should map ASCII characters to keysyms', function() {
            expect(keysyms.lookup('a'.charCodeAt())).to.be.equal(0x61);
            expect(keysyms.lookup('A'.charCodeAt())).to.be.equal(0x41);
            });
        it('should map Latin-1 characters to keysyms', function() {
            expect(keysyms.lookup('ø'.charCodeAt())).to.be.equal(0xf8);

            expect(keysyms.lookup('é'.charCodeAt())).to.be.equal(0xe9);
        });
        it('should map characters that are in Windows-1252 but not in Latin-1 to keysyms', function() {
            expect(keysyms.lookup('Š'.charCodeAt())).to.be.equal(0x01a9);
        });
        it('should map characters which aren\'t in Latin1 *or* Windows-1252 to keysyms', function() {
            expect(keysyms.lookup('ũ'.charCodeAt())).to.be.equal(0x03fd);
        });
        it('should map unknown codepoints to the Unicode range', function() {
            expect(keysyms.lookup('\n'.charCodeAt())).to.be.equal(0x100000a);
            expect(keysyms.lookup('\u262D'.charCodeAt())).to.be.equal(0x100262d);
        });
        // This requires very recent versions of most browsers... skipping for now
        it.skip('should map UCS-4 codepoints to the Unicode range', function() {
            //expect(keysyms.lookup('\u{1F686}'.codePointAt())).to.be.equal(0x101f686);
        });
    });

    describe('getKeycode', function() {
        it('should pass through proper code', function() {
            expect(KeyboardUtil.getKeycode({code: 'Semicolon'})).to.be.equal('Semicolon');
        });
        it('should map legacy values', function() {
            expect(KeyboardUtil.getKeycode({code: ''})).to.be.equal('Unidentified');
            expect(KeyboardUtil.getKeycode({code: 'OSLeft'})).to.be.equal('MetaLeft');
        });
        it('should map keyCode to code when possible', function() {
            expect(KeyboardUtil.getKeycode({keyCode: 0x14})).to.be.equal('CapsLock');
            expect(KeyboardUtil.getKeycode({keyCode: 0x5b})).to.be.equal('MetaLeft');
            expect(KeyboardUtil.getKeycode({keyCode: 0x35})).to.be.equal('Digit5');
            expect(KeyboardUtil.getKeycode({keyCode: 0x65})).to.be.equal('Numpad5');
        });
        it('should map keyCode left/right side', function() {
            expect(KeyboardUtil.getKeycode({keyCode: 0x10, location: 1})).to.be.equal('ShiftLeft');
            expect(KeyboardUtil.getKeycode({keyCode: 0x10, location: 2})).to.be.equal('ShiftRight');
            expect(KeyboardUtil.getKeycode({keyCode: 0x11, location: 1})).to.be.equal('ControlLeft');
            expect(KeyboardUtil.getKeycode({keyCode: 0x11, location: 2})).to.be.equal('ControlRight');
        });
        it('should map keyCode on numpad', function() {
            expect(KeyboardUtil.getKeycode({keyCode: 0x0d, location: 0})).to.be.equal('Enter');
            expect(KeyboardUtil.getKeycode({keyCode: 0x0d, location: 3})).to.be.equal('NumpadEnter');
            expect(KeyboardUtil.getKeycode({keyCode: 0x23, location: 0})).to.be.equal('End');
            expect(KeyboardUtil.getKeycode({keyCode: 0x23, location: 3})).to.be.equal('Numpad1');
        });
        it('should return Unidentified when it cannot map the keyCode', function() {
            expect(KeyboardUtil.getKeycode({keycode: 0x42})).to.be.equal('Unidentified');
        });

        describe('Fix Meta on macOS', function() {
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

            it('should respect ContextMenu on modern browser', function() {
                expect(KeyboardUtil.getKeycode({code: 'ContextMenu', keyCode: 0x5d})).to.be.equal('ContextMenu');
            });
            it('should translate legacy ContextMenu to MetaRight', function() {
                expect(KeyboardUtil.getKeycode({keyCode: 0x5d})).to.be.equal('MetaRight');
            });
        });
    });

    describe('getKeysym', function() {
        it('should prefer key', function() {
            expect(KeyboardUtil.getKeysym({key: 'a', charCode: 'Š'.charCodeAt(), keyCode: 0x42, which: 0x43})).to.be.equal(0x61);
        });
        it('should use charCode if no key', function() {
            expect(KeyboardUtil.getKeysym({charCode: 'Š'.charCodeAt(), keyCode: 0x42, which: 0x43})).to.be.equal(0x01a9);
        });

        describe('Non-character keys', function() {
            it('should recognize the right keys', function() {
                expect(KeyboardUtil.getKeysym({keyCode: 0x0d})).to.be.equal(0xFF0D);
                expect(KeyboardUtil.getKeysym({keyCode: 0x08})).to.be.equal(0xFF08);
                expect(KeyboardUtil.getKeysym({keyCode: 0x09})).to.be.equal(0xFF09);
                expect(KeyboardUtil.getKeysym({keyCode: 0x10})).to.be.equal(0xFFE1);
                expect(KeyboardUtil.getKeysym({keyCode: 0x11})).to.be.equal(0xFFE3);
                expect(KeyboardUtil.getKeysym({keyCode: 0x12})).to.be.equal(0xFFE9);
                expect(KeyboardUtil.getKeysym({keyCode: 0xe0})).to.be.equal(0xFFE7);
                expect(KeyboardUtil.getKeysym({keyCode: 0xe1})).to.be.equal(0xFE03);
                expect(KeyboardUtil.getKeysym({keyCode: 0x1b})).to.be.equal(0xFF1B);
                expect(KeyboardUtil.getKeysym({keyCode: 0x26})).to.be.equal(0xFF52);
            });
            it('should return null for unknown keycodes', function() {
                expect(KeyboardUtil.getKeysym({keyCode: 0xc0})).to.be.null;
                expect(KeyboardUtil.getKeysym({keyCode: 0xde})).to.be.null;
            });
            it('should not recognize character keys', function() {
                expect(KeyboardUtil.getKeysym({keyCode: 'A'})).to.be.null;
                expect(KeyboardUtil.getKeysym({keyCode: '1'})).to.be.null;
                expect(KeyboardUtil.getKeysym({keyCode: '.'})).to.be.null;
                expect(KeyboardUtil.getKeysym({keyCode: ' '})).to.be.null;
            });
        });
    });

    describe('Modifier Sync', function() { // return a list of fake events necessary to fix modifier state
        describe('Toggle all modifiers', function() {
            var sync = KeyboardUtil.ModifierSync();
            it ('should do nothing if all modifiers are up as expected', function() {
                expect(sync.keydown({
                    keyCode: 0x41,
                    ctrlKey: false,
                    altKey: false,
                    altGraphKey: false,
                    shiftKey: false,
                    metaKey: false})
                    ).to.have.lengthOf(0);
            });
            it ('should synthesize events if all keys are unexpectedly down', function() {
                var result = sync.keydown({
                    keyCode: 0x41,
                    ctrlKey: true,
                    altKey: true,
                    altGraphKey: true,
                    shiftKey: true,
                    metaKey: true
                });
                expect(result).to.have.lengthOf(5);
                var keysyms = {};
                for (var i = 0; i < result.length; ++i) {
                    keysyms[result[i].keysym] = (result[i].type == 'keydown');
                }
                expect(keysyms[0xffe3]);
                expect(keysyms[0xffe9]);
                expect(keysyms[0xfe03]);
                expect(keysyms[0xffe1]);
                expect(keysyms[0xffe7]);
            });
            it ('should do nothing if all modifiers are down as expected', function() {
                expect(sync.keydown({
                    keyCode: 0x41,
                    ctrlKey: true,
                    altKey: true,
                    altGraphKey: true,
                    shiftKey: true,
                    metaKey: true
                    })).to.have.lengthOf(0);
            });
        });
        describe('Toggle Ctrl', function() {
            var sync = KeyboardUtil.ModifierSync();
            it('should sync if modifier is suddenly down', function() {
                expect(sync.keydown({
                    keyCode: 0x41,
                    ctrlKey: true,
                })).to.be.deep.equal([{keysym: 0xffe3, type: 'keydown'}]);
            });
            it('should sync if modifier is suddenly up', function() {
                expect(sync.keydown({
                    keyCode: 0x41,
                    ctrlKey: false
                })).to.be.deep.equal([{keysym: 0xffe3, type: 'keyup'}]);
            });
        });
        describe('Toggle Alt', function() {
            var sync = KeyboardUtil.ModifierSync();
            it('should sync if modifier is suddenly down', function() {
                expect(sync.keydown({
                    keyCode: 0x41,
                    altKey: true,
                })).to.be.deep.equal([{keysym: 0xffe9, type: 'keydown'}]);
            });
            it('should sync if modifier is suddenly up', function() {
                expect(sync.keydown({
                    keyCode: 0x41,
                    altKey: false
                })).to.be.deep.equal([{keysym: 0xffe9, type: 'keyup'}]);
            });
        });
        describe('Toggle AltGr', function() {
            var sync = KeyboardUtil.ModifierSync();
            it('should sync if modifier is suddenly down', function() {
                expect(sync.keydown({
                    keyCode: 0x41,
                    altGraphKey: true,
                })).to.be.deep.equal([{keysym: 0xfe03, type: 'keydown'}]);
            });
            it('should sync if modifier is suddenly up', function() {
                expect(sync.keydown({
                    keyCode: 0x41,
                    altGraphKey: false
                })).to.be.deep.equal([{keysym: 0xfe03, type: 'keyup'}]);
            });
        });
        describe('Toggle Shift', function() {
            var sync = KeyboardUtil.ModifierSync();
            it('should sync if modifier is suddenly down', function() {
                expect(sync.keydown({
                    keyCode: 0x41,
                    shiftKey: true,
                })).to.be.deep.equal([{keysym: 0xffe1, type: 'keydown'}]);
            });
            it('should sync if modifier is suddenly up', function() {
                expect(sync.keydown({
                    keyCode: 0x41,
                    shiftKey: false
                })).to.be.deep.equal([{keysym: 0xffe1, type: 'keyup'}]);
            });
        });
        describe('Toggle Meta', function() {
            var sync = KeyboardUtil.ModifierSync();
            it('should sync if modifier is suddenly down', function() {
                expect(sync.keydown({
                    keyCode: 0x41,
                    metaKey: true,
                })).to.be.deep.equal([{keysym: 0xffe7, type: 'keydown'}]);
            });
            it('should sync if modifier is suddenly up', function() {
                expect(sync.keydown({
                    keyCode: 0x41,
                    metaKey: false
                })).to.be.deep.equal([{keysym: 0xffe7, type: 'keyup'}]);
            });
        });
        describe('Modifier keyevents', function() {
            it('should not sync a modifier on its own events', function() {
                expect(KeyboardUtil.ModifierSync().keydown({
                    keyCode: 0x11,
                    ctrlKey: false
                })).to.be.deep.equal([]);
                expect(KeyboardUtil.ModifierSync().keydown({
                    keyCode: 0x11,
                    ctrlKey: true
                }), 'B').to.be.deep.equal([]);
            })
            it('should update state on modifier keyevents', function() {
                var sync = KeyboardUtil.ModifierSync();
                sync.keydown({
                    keyCode: 0x11,
                });
                expect(sync.keydown({
                    keyCode: 0x41,
                    ctrlKey: true,
                })).to.be.deep.equal([]);
            });
            it('should sync other modifiers on ctrl events', function() {
                expect(KeyboardUtil.ModifierSync().keydown({
                    keyCode: 0x11,
                    altKey: true
                })).to.be.deep.equal([{keysym: 0xffe9, type: 'keydown'}]);
            })
        });
        describe('sync modifiers on non-key events', function() {
            it('should generate sync events when receiving non-keyboard events', function() {
                expect(KeyboardUtil.ModifierSync().syncAny({
                    altKey: true
                })).to.be.deep.equal([{keysym: 0xffe9, type: 'keydown'}]);
            });
        });
        describe('do not treat shift as a modifier key', function() {
            it('should not treat shift as a shortcut modifier', function() {
                expect(KeyboardUtil.hasShortcutModifier([], {0xffe1 : true})).to.be.false;
            });
            it('should not treat shift as a char modifier', function() {
                expect(KeyboardUtil.hasCharModifier([], {0xffe1 : true})).to.be.false;
            });
        });
    });
});
