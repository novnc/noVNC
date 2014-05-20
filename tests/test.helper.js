// requires local modules: keysym, keysymdef, keyboard

var assert = chai.assert;
var expect = chai.expect;

describe('Helpers', function() {
    "use strict";
    describe('keysymFromKeyCode', function() {
        it('should map known keycodes to keysyms', function() {
            expect(kbdUtil.keysymFromKeyCode(0x41, false), 'a').to.be.equal(0x61);
            expect(kbdUtil.keysymFromKeyCode(0x41, true), 'A').to.be.equal(0x41);
            expect(kbdUtil.keysymFromKeyCode(0xd, false), 'enter').to.be.equal(0xFF0D);
            expect(kbdUtil.keysymFromKeyCode(0x11, false), 'ctrl').to.be.equal(0xFFE3);
            expect(kbdUtil.keysymFromKeyCode(0x12, false), 'alt').to.be.equal(0xFFE9);
            expect(kbdUtil.keysymFromKeyCode(0xe1, false), 'altgr').to.be.equal(0xFE03);
            expect(kbdUtil.keysymFromKeyCode(0x1b, false), 'esc').to.be.equal(0xFF1B);
            expect(kbdUtil.keysymFromKeyCode(0x26, false), 'up').to.be.equal(0xFF52);
        });
        it('should return null for unknown keycodes', function() {
            expect(kbdUtil.keysymFromKeyCode(0xc0, false), 'DK æ').to.be.null;
            expect(kbdUtil.keysymFromKeyCode(0xde, false), 'DK ø').to.be.null;
        });
    });

    describe('keysyms.fromUnicode', function() {
        it('should map ASCII characters to keysyms', function() {
            expect(keysyms.fromUnicode('a'.charCodeAt())).to.have.property('keysym', 0x61);
            expect(keysyms.fromUnicode('A'.charCodeAt())).to.have.property('keysym', 0x41);
            });
        it('should map Latin-1 characters to keysyms', function() {
            expect(keysyms.fromUnicode('ø'.charCodeAt())).to.have.property('keysym', 0xf8);

            expect(keysyms.fromUnicode('é'.charCodeAt())).to.have.property('keysym', 0xe9);
        });
        it('should map characters that are in Windows-1252 but not in Latin-1 to keysyms', function() {
            expect(keysyms.fromUnicode('Š'.charCodeAt())).to.have.property('keysym', 0x01a9);
        });
        it('should map characters which aren\'t in Latin1 *or* Windows-1252 to keysyms', function() {
            expect(keysyms.fromUnicode('ŵ'.charCodeAt())).to.have.property('keysym', 0x1000175);
        });
        it('should return undefined for unknown codepoints', function() {
            expect(keysyms.fromUnicode('\n'.charCodeAt())).to.be.undefined;
            expect(keysyms.fromUnicode('\u1F686'.charCodeAt())).to.be.undefined;
        });
    });

    describe('substituteCodepoint', function() {
        it('should replace characters which don\'t have a keysym', function() {
            expect(kbdUtil.substituteCodepoint('Ș'.charCodeAt())).to.equal('Ş'.charCodeAt());
            expect(kbdUtil.substituteCodepoint('ș'.charCodeAt())).to.equal('ş'.charCodeAt());
            expect(kbdUtil.substituteCodepoint('Ț'.charCodeAt())).to.equal('Ţ'.charCodeAt());
            expect(kbdUtil.substituteCodepoint('ț'.charCodeAt())).to.equal('ţ'.charCodeAt());
        });
        it('should pass other characters through unchanged', function() {
            expect(kbdUtil.substituteCodepoint('T'.charCodeAt())).to.equal('T'.charCodeAt());
        });
    });

    describe('nonCharacterKey', function() {
        it('should  recognize the right keys', function() {
            expect(kbdUtil.nonCharacterKey({keyCode: 0xd}), 'enter').to.be.defined;
            expect(kbdUtil.nonCharacterKey({keyCode: 0x08}), 'backspace').to.be.defined;
            expect(kbdUtil.nonCharacterKey({keyCode: 0x09}), 'tab').to.be.defined;
            expect(kbdUtil.nonCharacterKey({keyCode: 0x10}), 'shift').to.be.defined;
            expect(kbdUtil.nonCharacterKey({keyCode: 0x11}), 'ctrl').to.be.defined;
            expect(kbdUtil.nonCharacterKey({keyCode: 0x12}), 'alt').to.be.defined;
            expect(kbdUtil.nonCharacterKey({keyCode: 0xe0}), 'meta').to.be.defined;
        });
        it('should  not recognize character keys', function() {
            expect(kbdUtil.nonCharacterKey({keyCode: 'A'}), 'A').to.be.null;
            expect(kbdUtil.nonCharacterKey({keyCode: '1'}), '1').to.be.null;
            expect(kbdUtil.nonCharacterKey({keyCode: '.'}), '.').to.be.null;
            expect(kbdUtil.nonCharacterKey({keyCode: ' '}), 'space').to.be.null;
        });
    });

    describe('getKeysym', function() {
        it('should prefer char', function() {
            expect(kbdUtil.getKeysym({char : 'a', charCode: 'Š'.charCodeAt(), keyCode: 0x42, which: 0x43})).to.have.property('keysym', 0x61);
        });
        it('should use charCode if no char', function() {
            expect(kbdUtil.getKeysym({char : '', charCode: 'Š'.charCodeAt(), keyCode: 0x42, which: 0x43})).to.have.property('keysym', 0x01a9);
            expect(kbdUtil.getKeysym({charCode: 'Š'.charCodeAt(), keyCode: 0x42, which: 0x43})).to.have.property('keysym', 0x01a9);
            expect(kbdUtil.getKeysym({char : 'hello', charCode: 'Š'.charCodeAt(), keyCode: 0x42, which: 0x43})).to.have.property('keysym', 0x01a9);
        });
        it('should use keyCode if no charCode', function() {
            expect(kbdUtil.getKeysym({keyCode: 0x42, which: 0x43, shiftKey: false})).to.have.property('keysym', 0x62);
            expect(kbdUtil.getKeysym({keyCode: 0x42, which: 0x43, shiftKey: true})).to.have.property('keysym', 0x42);
        });
        it('should use which if no keyCode', function() {
            expect(kbdUtil.getKeysym({which: 0x43, shiftKey: false})).to.have.property('keysym', 0x63);
            expect(kbdUtil.getKeysym({which: 0x43, shiftKey: true})).to.have.property('keysym', 0x43);
        });
        it('should substitute where applicable', function() {
            expect(kbdUtil.getKeysym({char : 'Ș'})).to.have.property('keysym', 0x1aa);
        });
    });

    describe('Modifier Sync', function() { // return a list of fake events necessary to fix modifier state
        describe('Toggle all modifiers', function() {
            var sync = kbdUtil.ModifierSync();
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
            var sync = kbdUtil.ModifierSync();
            it('should sync if modifier is suddenly down', function() {
                expect(sync.keydown({
                    keyCode: 0x41,
                    ctrlKey: true,
                })).to.be.deep.equal([{keysym: keysyms.lookup(0xffe3), type: 'keydown'}]);
            });
            it('should sync if modifier is suddenly up', function() {
                expect(sync.keydown({
                    keyCode: 0x41,
                    ctrlKey: false
                })).to.be.deep.equal([{keysym: keysyms.lookup(0xffe3), type: 'keyup'}]);
            });
        });
        describe('Toggle Alt', function() {
            var sync = kbdUtil.ModifierSync();
            it('should sync if modifier is suddenly down', function() {
                expect(sync.keydown({
                    keyCode: 0x41,
                    altKey: true,
                })).to.be.deep.equal([{keysym: keysyms.lookup(0xffe9), type: 'keydown'}]);
            });
            it('should sync if modifier is suddenly up', function() {
                expect(sync.keydown({
                    keyCode: 0x41,
                    altKey: false
                })).to.be.deep.equal([{keysym: keysyms.lookup(0xffe9), type: 'keyup'}]);
            });
        });
        describe('Toggle AltGr', function() {
            var sync = kbdUtil.ModifierSync();
            it('should sync if modifier is suddenly down', function() {
                expect(sync.keydown({
                    keyCode: 0x41,
                    altGraphKey: true,
                })).to.be.deep.equal([{keysym: keysyms.lookup(0xfe03), type: 'keydown'}]);
            });
            it('should sync if modifier is suddenly up', function() {
                expect(sync.keydown({
                    keyCode: 0x41,
                    altGraphKey: false
                })).to.be.deep.equal([{keysym: keysyms.lookup(0xfe03), type: 'keyup'}]);
            });
        });
        describe('Toggle Shift', function() {
            var sync = kbdUtil.ModifierSync();
            it('should sync if modifier is suddenly down', function() {
                expect(sync.keydown({
                    keyCode: 0x41,
                    shiftKey: true,
                })).to.be.deep.equal([{keysym: keysyms.lookup(0xffe1), type: 'keydown'}]);
            });
            it('should sync if modifier is suddenly up', function() {
                expect(sync.keydown({
                    keyCode: 0x41,
                    shiftKey: false
                })).to.be.deep.equal([{keysym: keysyms.lookup(0xffe1), type: 'keyup'}]);
            });
        });
        describe('Toggle Meta', function() {
            var sync = kbdUtil.ModifierSync();
            it('should sync if modifier is suddenly down', function() {
                expect(sync.keydown({
                    keyCode: 0x41,
                    metaKey: true,
                })).to.be.deep.equal([{keysym: keysyms.lookup(0xffe7), type: 'keydown'}]);
            });
            it('should sync if modifier is suddenly up', function() {
                expect(sync.keydown({
                    keyCode: 0x41,
                    metaKey: false
                })).to.be.deep.equal([{keysym: keysyms.lookup(0xffe7), type: 'keyup'}]);
            });
        });
        describe('Modifier keyevents', function() {
            it('should not sync a modifier on its own events', function() {
                expect(kbdUtil.ModifierSync().keydown({
                    keyCode: 0x11,
                    ctrlKey: false
                })).to.be.deep.equal([]);
                expect(kbdUtil.ModifierSync().keydown({
                    keyCode: 0x11,
                    ctrlKey: true
                }), 'B').to.be.deep.equal([]);
            })
            it('should update state on modifier keyevents', function() {
                var sync = kbdUtil.ModifierSync();
                sync.keydown({
                    keyCode: 0x11,
                });
                expect(sync.keydown({
                    keyCode: 0x41,
                    ctrlKey: true,
                })).to.be.deep.equal([]);
            });
            it('should sync other modifiers on ctrl events', function() {
                expect(kbdUtil.ModifierSync().keydown({
                    keyCode: 0x11,
                    altKey: true
                })).to.be.deep.equal([{keysym: keysyms.lookup(0xffe9), type: 'keydown'}]);
            })
        });
        describe('sync modifiers on non-key events', function() {
            it('should generate sync events when receiving non-keyboard events', function() {
                expect(kbdUtil.ModifierSync().syncAny({
                    altKey: true
                })).to.be.deep.equal([{keysym: keysyms.lookup(0xffe9), type: 'keydown'}]);
            });
        });
        describe('do not treat shift as a modifier key', function() {
            it('should not treat shift as a shortcut modifier', function() {
                expect(kbdUtil.hasShortcutModifier([], {0xffe1 : true})).to.be.false;
            });
            it('should not treat shift as a char modifier', function() {
                expect(kbdUtil.hasCharModifier([], {0xffe1 : true})).to.be.false;
            });
        });
    });
});
