var assert = chai.assert;
var expect = chai.expect;

import keysyms from '../core/input/keysymdef.js';
import * as KeyboardUtil from '../core/input/util.js';

/* jshint newcap: false, expr: true */
describe('Key Event Pipeline Stages', function() {
    "use strict";
    describe('Decode Keyboard Events', function() {
        it('should pass events to the next stage', function(done) {
            KeyboardUtil.KeyEventDecoder(KeyboardUtil.ModifierSync(), function(evt) {
                expect(evt).to.be.an.object;
                done();
            }).keydown({code: 'KeyA', key: 'a'});
        });
        it('should pass the right keysym through', function(done) {
            KeyboardUtil.KeyEventDecoder(KeyboardUtil.ModifierSync(), function(evt) {
                expect(evt.keysym).to.be.deep.equal(0x61);
                done();
            }).keypress({code: 'KeyA', key: 'a'});
        });
        it('should pass the right keyid through', function(done) {
            KeyboardUtil.KeyEventDecoder(KeyboardUtil.ModifierSync(), function(evt) {
                expect(evt).to.have.property('code', 'KeyA');
                done();
            }).keydown({code: 'KeyA', key: 'a'});
        });
        it('should forward keydown events with the right type', function(done) {
            KeyboardUtil.KeyEventDecoder(KeyboardUtil.ModifierSync(), function(evt) {
                expect(evt).to.be.deep.equal({code: 'KeyA', keysym: 0x61, type: 'keydown'});
                done();
            }).keydown({code: 'KeyA', key: 'a'});
        });
        it('should forward keyup events with the right type', function(done) {
            KeyboardUtil.KeyEventDecoder(KeyboardUtil.ModifierSync(), function(evt) {
                expect(evt).to.be.deep.equal({code: 'KeyA', keysym: 0x61, type: 'keyup'});
                done();
            }).keyup({code: 'KeyA', key: 'a'});
        });
        it('should forward keypress events with the right type', function(done) {
            KeyboardUtil.KeyEventDecoder(KeyboardUtil.ModifierSync(), function(evt) {
                expect(evt).to.be.deep.equal({code: 'KeyA', keysym: 0x61, type: 'keypress'});
                done();
            }).keypress({code: 'KeyA', key: 'a'});
        });
        describe('suppress the right events at the right time', function() {
            it('should suppress anything while a shortcut modifier is down', function() {
                var obj = KeyboardUtil.KeyEventDecoder(KeyboardUtil.ModifierSync(), function(evt) {});

                obj.keydown({code: 'ControlLeft'});
                expect(obj.keydown({code: 'KeyA', key: 'a'})).to.be.true;
                expect(obj.keydown({code: 'Space', key: ' '})).to.be.true;
                expect(obj.keydown({code: 'Digit1', key: '1'})).to.be.true;
                expect(obj.keydown({code: 'IntlBackslash', key: '<'})).to.be.true;
                expect(obj.keydown({code: 'Semicolon', key: 'ø'})).to.be.true;
            });
            it('should suppress non-character keys', function() {
                var obj = KeyboardUtil.KeyEventDecoder(KeyboardUtil.ModifierSync(), function(evt) {});

                expect(obj.keydown({code: 'Backspace'}), 'a').to.be.true;
                expect(obj.keydown({code: 'Tab'}), 'b').to.be.true;
                expect(obj.keydown({code: 'ControlLeft'}), 'd').to.be.true;
                expect(obj.keydown({code: 'AltLeft'}), 'e').to.be.true;
            });
            it('should generate event for shift keydown', function() {
                var called = false;
                var obj = KeyboardUtil.KeyEventDecoder(KeyboardUtil.ModifierSync(), function(evt) {
                    expect(evt).to.have.property('keysym');
                    called = true;
                }).keydown({code: 'ShiftLeft'});
                expect(called).to.be.true;
            });
            it('should suppress character keys with key', function() {
                var obj = KeyboardUtil.KeyEventDecoder(KeyboardUtil.ModifierSync(), function(evt) {});

                expect(obj.keydown({code: 'KeyA', key: 'a'})).to.be.true;
                expect(obj.keydown({code: 'Digit1', key: '1'})).to.be.true;
                expect(obj.keydown({code: 'IntlBackslash', key: '<'})).to.be.true;
                expect(obj.keydown({code: 'Semicolon', key: 'ø'})).to.be.true;
            });
            it('should not suppress character keys without key', function() {
                var obj = KeyboardUtil.KeyEventDecoder(KeyboardUtil.ModifierSync(), function(evt) {});

                expect(obj.keydown({code: 'KeyA'})).to.be.false;
                expect(obj.keydown({code: 'Digit1'})).to.be.false;
                expect(obj.keydown({code: 'IntlBackslash'})).to.be.false;
                expect(obj.keydown({code: 'Semicolon'})).to.be.false;
            });
        });
        describe('Keypress and keyup events', function() {
            it('should always suppress event propagation', function() {
                var obj = KeyboardUtil.KeyEventDecoder(KeyboardUtil.ModifierSync(), function(evt) {});

                expect(obj.keypress({code: 'KeyA', key: 'a'})).to.be.true;
                expect(obj.keypress({code: 'IntlBackslash', key: '<'})).to.be.true;
                expect(obj.keypress({code: 'ControlLeft', key: 'Control'})).to.be.true;

                expect(obj.keyup({code: 'KeyA', key: 'a'})).to.be.true;
                expect(obj.keyup({code: 'IntlBackslash', key: '<'})).to.be.true;
                expect(obj.keyup({code: 'ControlLeft', key: 'Control'})).to.be.true;
            });
        });
        describe('mark events if a char modifier is down', function() {
            it('should not mark modifiers on a keydown event', function() {
                var times_called = 0;
                var obj = KeyboardUtil.KeyEventDecoder(KeyboardUtil.ModifierSync([0xfe03]), function(evt) {
                    switch (times_called++) {
                    case 0: //altgr
                        break;
                    case 1: // 'a'
                        expect(evt).to.not.have.property('escape');
                        break;
                    }
                });

                obj.keydown({code: 'AltRight', key: 'AltGraph'})
                obj.keydown({code: 'KeyA', key: 'a'});
            });

            it('should indicate on events if a single-key char modifier is down', function(done) {
                var times_called = 0;
                var obj = KeyboardUtil.KeyEventDecoder(KeyboardUtil.ModifierSync([0xfe03]), function(evt) {
                    switch (times_called++) {
                    case 0: //altgr
                        break;
                    case 1: // 'a'
                        expect(evt).to.be.deep.equal({
                            type: 'keypress',
                            code: 'KeyA',
                            keysym: 0x61,
                            escape: [0xfe03]
                        });
                        done();
                        return;
                    }
                });

                obj.keydown({code: 'AltRight', key: 'AltGraph'})
                obj.keypress({code: 'KeyA', key: 'a'});
            });
            it('should indicate on events if a multi-key char modifier is down', function(done) {
                var times_called = 0;
                var obj = KeyboardUtil.KeyEventDecoder(KeyboardUtil.ModifierSync([0xffe9, 0xffe3]), function(evt) {
                    switch (times_called++) {
                    case 0: //ctrl
                        break;
                    case 1: //alt
                        break;
                    case 2: // 'a'
                        expect(evt).to.be.deep.equal({
                            type: 'keypress',
                            code: 'KeyA',
                            keysym: 0x61,
                            escape: [0xffe9, 0xffe3]
                        });
                        done();
                        return;
                    }
                });

                obj.keydown({code: 'ControlLeft'});
                obj.keydown({code: 'AltLeft'});
                obj.keypress({code: 'KeyA', key: 'a'});
            });
            it('should not consider a char modifier to be down on the modifier key itself', function() {
                var obj = KeyboardUtil.KeyEventDecoder(KeyboardUtil.ModifierSync([0xfe03]), function(evt) {
                    expect(evt).to.not.have.property('escape');
                });

                obj.keydown({code: 'AltRight', key: 'AltGraph'})

            });
        });
    });

    describe('Track Key State', function() {
        it('should do nothing on keyup events if no keys are down', function() {
            var obj = KeyboardUtil.TrackKeyState(function(evt) {
                expect(true).to.be.false;
            });
            obj({type: 'keyup', code: 'KeyA'});
        });
        it('should insert into the queue on keydown if no keys are down', function() {
            var times_called = 0;
            var elem = null;
            var keysymsdown = {};
            var obj = KeyboardUtil.TrackKeyState(function(evt) {
                ++times_called;
                if (elem.type == 'keyup') {
                expect(evt).to.have.property('keysym');
                    expect (keysymsdown[evt.keysym]).to.not.be.undefined;
                    delete keysymsdown[evt.keysym];
                }
                else {
                    expect(evt).to.be.deep.equal(elem);
                    expect (keysymsdown[evt.keysym]).to.not.be.undefined;
                }
                elem = null;
            });

            expect(elem).to.be.null;
            elem = {type: 'keydown', code: 'KeyA', keysym: 0x42};
            keysymsdown[0x42] = true;
            obj(elem);
            expect(elem).to.be.null;
            elem = {type: 'keyup', code: 'KeyA'};
            obj(elem);
            expect(elem).to.be.null;
            expect(times_called).to.be.equal(2);
        });
        it('should insert into the queue on keypress if no keys are down', function() {
            var times_called = 0;
            var elem = null;
            var keysymsdown = {};
            var obj = KeyboardUtil.TrackKeyState(function(evt) {
                ++times_called;
                if (elem.type == 'keyup') {
                    expect(evt).to.have.property('keysym');
                    expect (keysymsdown[evt.keysym]).to.not.be.undefined;
                    delete keysymsdown[evt.keysym];
                }
                else {
                    expect(evt).to.be.deep.equal(elem);
                    expect (keysymsdown[evt.keysym]).to.not.be.undefined;
                }
                elem = null;
            });

            expect(elem).to.be.null;
            elem = {type: 'keypress', code: 'KeyA', keysym: 0x42};
            keysymsdown[0x42] = true;
            obj(elem);
            expect(elem).to.be.null;
            elem = {type: 'keyup', code: 'KeyA'};
            obj(elem);
            expect(elem).to.be.null;
            expect(times_called).to.be.equal(2);
        });
        it('should add keysym to last key entry if code matches', function() {
            // this implies that a single keyup will release both keysyms
            var times_called = 0;
            var elem = null;
            var keysymsdown = {};
            var obj = KeyboardUtil.TrackKeyState(function(evt) {
                ++times_called;
                if (elem.type == 'keyup') {
                    expect(evt).to.have.property('keysym');
                    expect (keysymsdown[evt.keysym]).to.not.be.undefined;
                    delete keysymsdown[evt.keysym];
                }
                else {
                    expect(evt).to.be.deep.equal(elem);
                    expect (keysymsdown[evt.keysym]).to.not.be.undefined;
                    elem = null;
                }
            });

            expect(elem).to.be.null;
            elem = {type: 'keypress', code: 'KeyA', keysym: 0x42};
            keysymsdown[0x42] = true;
            obj(elem);
            expect(elem).to.be.null;
            elem = {type: 'keypress', code: 'KeyA', keysym: 0x43};
            keysymsdown[0x43] = true;
            obj(elem);
            expect(elem).to.be.null;
            elem = {type: 'keyup', code: 'KeyA'};
            obj(elem);
            expect(times_called).to.be.equal(4);
        });
        it('should create new key entry if code matches and keysym does not', function() {
            // this implies that a single keyup will release both keysyms
            var times_called = 0;
            var elem = null;
            var keysymsdown = {};
            var obj = KeyboardUtil.TrackKeyState(function(evt) {
                ++times_called;
                if (elem.type == 'keyup') {
                    expect(evt).to.have.property('keysym');
                    expect (keysymsdown[evt.keysym]).to.not.be.undefined;
                    delete keysymsdown[evt.keysym];
                }
                else {
                    expect(evt).to.be.deep.equal(elem);
                    expect (keysymsdown[evt.keysym]).to.not.be.undefined;
                    elem = null;
                }
            });

            expect(elem).to.be.null;
            elem = {type: 'keydown', code: 'Unidentified', keysym: 0x42};
            keysymsdown[0x42] = true;
            obj(elem);
            expect(elem).to.be.null;
            elem = {type: 'keydown', code: 'Unidentified', keysym: 0x43};
            keysymsdown[0x43] = true;
            obj(elem);
            expect(times_called).to.be.equal(2);
            expect(elem).to.be.null;
            elem = {type: 'keyup', code: 'Unidentified'};
            obj(elem);
            expect(times_called).to.be.equal(3);
            elem = {type: 'keyup', code: 'Unidentified'};
            obj(elem);
            expect(times_called).to.be.equal(4);
        });
        it('should merge key entry if codes are zero and keysyms match', function() {
            // this implies that a single keyup will release both keysyms
            var times_called = 0;
            var elem = null;
            var keysymsdown = {};
            var obj = KeyboardUtil.TrackKeyState(function(evt) {
                ++times_called;
                if (elem.type == 'keyup') {
                    expect(evt).to.have.property('keysym');
                    expect (keysymsdown[evt.keysym]).to.not.be.undefined;
                    delete keysymsdown[evt.keysym];
                }
                else {
                    expect(evt).to.be.deep.equal(elem);
                    expect (keysymsdown[evt.keysym]).to.not.be.undefined;
                    elem = null;
                }
            });

            expect(elem).to.be.null;
            elem = {type: 'keydown', code: 'Unidentified', keysym: 0x42};
            keysymsdown[0x42] = true;
            obj(elem);
            expect(elem).to.be.null;
            elem = {type: 'keydown', code: 'Unidentified', keysym: 0x42};
            keysymsdown[0x42] = true;
            obj(elem);
            expect(times_called).to.be.equal(2);
            expect(elem).to.be.null;
            elem = {type: 'keyup', code: 'Unidentified'};
            obj(elem);
            expect(times_called).to.be.equal(3);
        });
        it('should add keysym as separate entry if code does not match last event', function() {
            // this implies that separate keyups are required
            var times_called = 0;
            var elem = null;
            var keysymsdown = {};
            var obj = KeyboardUtil.TrackKeyState(function(evt) {
                ++times_called;
                if (elem.type == 'keyup') {
                    expect(evt).to.have.property('keysym');
                    expect (keysymsdown[evt.keysym]).to.not.be.undefined;
                    delete keysymsdown[evt.keysym];
                }
                else {
                    expect(evt).to.be.deep.equal(elem);
                    expect (keysymsdown[evt.keysym]).to.not.be.undefined;
                    elem = null;
                }
            });

            expect(elem).to.be.null;
            elem = {type: 'keypress', code: 'KeyA', keysym: 0x42};
            keysymsdown[0x42] = true;
            obj(elem);
            expect(elem).to.be.null;
            elem = {type: 'keypress', code: 'KeyB', keysym: 0x43};
            keysymsdown[0x43] = true;
            obj(elem);
            expect(elem).to.be.null;
            elem = {type: 'keyup', code: 'KeyA'};
            obj(elem);
            expect(times_called).to.be.equal(4);
            elem = {type: 'keyup', code: 'KeyB'};
            obj(elem);
            expect(times_called).to.be.equal(4);
        });
        it('should add keysym as separate entry if code does not match last event and first is zero', function() {
            // this implies that separate keyups are required
            var times_called = 0;
            var elem = null;
            var keysymsdown = {};
            var obj = KeyboardUtil.TrackKeyState(function(evt) {
                ++times_called;
                if (elem.type == 'keyup') {
                    expect(evt).to.have.property('keysym');
                    expect (keysymsdown[evt.keysym]).to.not.be.undefined;
                    delete keysymsdown[evt.keysym];
                }
                else {
                    expect(evt).to.be.deep.equal(elem);
                    expect (keysymsdown[evt.keysym]).to.not.be.undefined;
                    elem = null;
                }
            });

            expect(elem).to.be.null;
            elem = {type: 'keydown', code: 'Unidentified', keysym: 0x42};
            keysymsdown[0x42] = true;
            obj(elem);
            expect(elem).to.be.null;
            elem = {type: 'keydown', code: 'KeyB', keysym: 0x43};
            keysymsdown[0x43] = true;
            obj(elem);
            expect(elem).to.be.null;
            expect(times_called).to.be.equal(2);
            elem = {type: 'keyup', code: 'Unidentified'};
            obj(elem);
            expect(times_called).to.be.equal(3);
            elem = {type: 'keyup', code: 'KeyB'};
            obj(elem);
            expect(times_called).to.be.equal(4);
        });
        it('should add keysym as separate entry if code does not match last event and second is zero', function() {
            // this implies that a separate keyups are required
            var times_called = 0;
            var elem = null;
            var keysymsdown = {};
            var obj = KeyboardUtil.TrackKeyState(function(evt) {
                ++times_called;
                if (elem.type == 'keyup') {
                    expect(evt).to.have.property('keysym');
                    expect (keysymsdown[evt.keysym]).to.not.be.undefined;
                    delete keysymsdown[evt.keysym];
                }
                else {
                    expect(evt).to.be.deep.equal(elem);
                    expect (keysymsdown[evt.keysym]).to.not.be.undefined;
                    elem = null;
                }
            });

            expect(elem).to.be.null;
            elem = {type: 'keydown', code: 'KeyA', keysym: 0x42};
            keysymsdown[0x42] = true;
            obj(elem);
            expect(elem).to.be.null;
            elem = {type: 'keydown', code: 'Unidentified', keysym: 0x43};
            keysymsdown[0x43] = true;
            obj(elem);
            expect(elem).to.be.null;
            elem = {type: 'keyup', code: 'KeyA'};
            obj(elem);
            expect(times_called).to.be.equal(3);
            elem = {type: 'keyup', code: 'Unidentified'};
            obj(elem);
            expect(times_called).to.be.equal(4);
        });
        it('should pop matching key event on keyup', function() {
            var times_called = 0;
            var obj = KeyboardUtil.TrackKeyState(function(evt) {
                switch (times_called++) {
                    case 0:
                    case 1:
                    case 2:
                        expect(evt.type).to.be.equal('keydown');
                        break;
                    case 3:
                        expect(evt).to.be.deep.equal({type: 'keyup', code: 'KeyB', keysym: 0x62});
                        break;
                }
            });

            obj({type: 'keydown', code: 'KeyA', keysym: 0x61});
            obj({type: 'keydown', code: 'KeyB', keysym: 0x62});
            obj({type: 'keydown', code: 'KeyC', keysym: 0x63});
            obj({type: 'keyup', code: 'KeyB'});
            expect(times_called).to.equal(4);
        });
        it('should pop the first zero keyevent on keyup with zero code', function() {
            var times_called = 0;
            var obj = KeyboardUtil.TrackKeyState(function(evt) {
                switch (times_called++) {
                    case 0:
                    case 1:
                    case 2:
                        expect(evt.type).to.be.equal('keydown');
                        break;
                    case 3:
                        expect(evt).to.be.deep.equal({type: 'keyup', code: 'Unidentified', keysym: 0x61});
                        break;
                }
            });

            obj({type: 'keydown', code: 'Unidentified', keysym: 0x61});
            obj({type: 'keydown', code: 'Unidentified', keysym: 0x62});
            obj({type: 'keydown', code: 'KeyA', keysym: 0x63});
            obj({type: 'keyup', code: 'Unidentified'});
            expect(times_called).to.equal(4);
        });
        it('should pop the last keyevents keysym if no match is found for code', function() {
            var times_called = 0;
            var obj = KeyboardUtil.TrackKeyState(function(evt) {
                switch (times_called++) {
                    case 0:
                    case 1:
                    case 2:
                        expect(evt.type).to.be.equal('keydown');
                        break;
                    case 3:
                        expect(evt).to.be.deep.equal({type: 'keyup', code: 'KeyD', keysym: 0x63});
                        break;
                }
            });

            obj({type: 'keydown', code: 'KeyA', keysym: 0x61});
            obj({type: 'keydown', code: 'KeyB', keysym: 0x62});
            obj({type: 'keydown', code: 'KeyC', keysym: 0x63});
            obj({type: 'keyup', code: 'KeyD'});
            expect(times_called).to.equal(4);
        });
        describe('Firefox sends keypress even when keydown is suppressed', function() {
            it('should discard the keypress', function() {
                var times_called = 0;
                var obj = KeyboardUtil.TrackKeyState(function(evt) {
                    expect(times_called).to.be.equal(0);
                    ++times_called;
                });

                obj({type: 'keydown', code: 'KeyA', keysym: 0x42});
                expect(times_called).to.be.equal(1);
                obj({type: 'keypress', code: 'KeyA', keysym: 0x43});
            });
        });
        describe('releaseAll', function() {
            it('should do nothing if no keys have been pressed', function() {
                var times_called = 0;
                var obj = KeyboardUtil.TrackKeyState(function(evt) {
                    ++times_called;
                });
                obj({type: 'releaseall'});
                expect(times_called).to.be.equal(0);
            });
            it('should release the keys that have been pressed', function() {
                var times_called = 0;
                var obj = KeyboardUtil.TrackKeyState(function(evt) {
                    switch (times_called++) {
                    case 2:
                        expect(evt).to.be.deep.equal({type: 'keyup', code: 'Unidentified', keysym: 0x41});
                        break;
                    case 3:
                        expect(evt).to.be.deep.equal({type: 'keyup', code: 'Unidentified', keysym: 0x42});
                        break;
                    }
                });
                obj({type: 'keydown', code: 'KeyA', keysym: 0x41});
                obj({type: 'keydown', code: 'KeyB', keysym: 0x42});
                expect(times_called).to.be.equal(2);
                obj({type: 'releaseall'});
                expect(times_called).to.be.equal(4);
                obj({type: 'releaseall'});
                expect(times_called).to.be.equal(4);
            });
        });

    });

    describe('Escape Modifiers', function() {
        describe('Keydown', function() {
            it('should pass through when a char modifier is not down', function() {
                var times_called = 0;
                KeyboardUtil.EscapeModifiers(function(evt) {
                    expect(times_called).to.be.equal(0);
                    ++times_called;
                    expect(evt).to.be.deep.equal({type: 'keydown', code: 'KeyA', keysym: 0x42});
                })({type: 'keydown', code: 'KeyA', keysym: 0x42});
                expect(times_called).to.be.equal(1);
            });
            it('should generate fake undo/redo events when a char modifier is down', function() {
                var times_called = 0;
                KeyboardUtil.EscapeModifiers(function(evt) {
                    switch(times_called++) {
                    case 0:
                        expect(evt).to.be.deep.equal({type: 'keyup', code: 'Unidentified', keysym: 0xffe9});
                        break;
                    case 1:
                        expect(evt).to.be.deep.equal({type: 'keyup', code: 'Unidentified', keysym: 0xffe3});
                        break;
                    case 2:
                        expect(evt).to.be.deep.equal({type: 'keydown', code: 'KeyA', keysym: 0x42, escape: [0xffe9, 0xffe3]});
                        break;
                    case 3:
                        expect(evt).to.be.deep.equal({type: 'keydown', code: 'Unidentified', keysym: 0xffe9});
                        break;
                    case 4:
                        expect(evt).to.be.deep.equal({type: 'keydown', code: 'Unidentified', keysym: 0xffe3});
                        break;
                    }
                })({type: 'keydown', code: 'KeyA', keysym: 0x42, escape: [0xffe9, 0xffe3]});
                expect(times_called).to.be.equal(5);
            });
        });
        describe('Keyup', function() {
            it('should pass through when a char modifier is down', function() {
                var times_called = 0;
                KeyboardUtil.EscapeModifiers(function(evt) {
                    expect(times_called).to.be.equal(0);
                    ++times_called;
                    expect(evt).to.be.deep.equal({type: 'keyup', code: 'KeyA', keysym: 0x42, escape: [0xfe03]});
                })({type: 'keyup', code: 'KeyA', keysym: 0x42, escape: [0xfe03]});
                expect(times_called).to.be.equal(1);
            });
            it('should pass through when a char modifier is not down', function() {
                var times_called = 0;
                KeyboardUtil.EscapeModifiers(function(evt) {
                    expect(times_called).to.be.equal(0);
                    ++times_called;
                    expect(evt).to.be.deep.equal({type: 'keyup', code: 'KeyA', keysym: 0x42});
                })({type: 'keyup', code: 'KeyA', keysym: 0x42});
                expect(times_called).to.be.equal(1);
            });
        });
    });
});
