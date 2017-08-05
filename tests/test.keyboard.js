var assert = chai.assert;
var expect = chai.expect;


describe('Key Event Pipeline Stages', function() {
    "use strict";
    describe('Decode Keyboard Events', function() {
        it('should pass events to the next stage', function(done) {
            KeyEventDecoder(kbdUtil.ModifierSync(), function(evt) {
                expect(evt).to.be.an.object;
                done();
            }).keydown({keyCode: 0x41});
        });
        it('should pass the right keysym through', function(done) {
            KeyEventDecoder(kbdUtil.ModifierSync(), function(evt) {
                expect(evt.keysym).to.be.deep.equal(keysyms.lookup(0x61));
                done();
            }).keypress({keyCode: 0x41});
        });
        it('should pass the right keyid through', function(done) {
            KeyEventDecoder(kbdUtil.ModifierSync(), function(evt) {
                expect(evt).to.have.property('keyId', 0x41);
                done();
            }).keydown({keyCode: 0x41});
        });
        it('should not sync modifiers on a keypress', function() {
            // Firefox provides unreliable modifier state on keypress events
            var count = 0;
            KeyEventDecoder(kbdUtil.ModifierSync(), function(evt) {
                ++count;
            }).keypress({keyCode: 0x41, ctrlKey: true});
            expect(count).to.be.equal(1);
        });
        it('should sync modifiers if necessary', function(done) {
            var count = 0;
            KeyEventDecoder(kbdUtil.ModifierSync(), function(evt) {
                switch (count) {
                case 0: // fake a ctrl keydown
                    expect(evt).to.be.deep.equal({keysym: keysyms.lookup(0xffe3), type: 'keydown'});
                    ++count;
                    break;
                case 1:
                    expect(evt).to.be.deep.equal({keyId: 0x41, type: 'keydown', keysym: keysyms.lookup(0x61)});
                    done();
                    break;
                }
            }).keydown({keyCode: 0x41, ctrlKey: true});
        });
        it('should forward keydown events with the right type', function(done) {
            KeyEventDecoder(kbdUtil.ModifierSync(), function(evt) {
                expect(evt).to.be.deep.equal({keyId: 0x41, type: 'keydown'});
                done();
            }).keydown({keyCode: 0x41})
        });
        it('should forward keyup events with the right type', function(done) {
            KeyEventDecoder(kbdUtil.ModifierSync(), function(evt) {
                expect(evt).to.be.deep.equal({keyId: 0x41, keysym: keysyms.lookup(0x61), type: 'keyup'});
                done();
            }).keyup({keyCode: 0x41});
        });
        it('should forward keypress events with the right type', function(done) {
            KeyEventDecoder(kbdUtil.ModifierSync(), function(evt) {
                expect(evt).to.be.deep.equal({keyId: 0x41, keysym: keysyms.lookup(0x61), type: 'keypress'});
                done();
            }).keypress({keyCode: 0x41});
        });
        it('should generate stalls if a char modifier is down while a key is pressed', function(done) {
            var count = 0;
            KeyEventDecoder(kbdUtil.ModifierSync([0xfe03]), function(evt) {
                switch (count) {
                case 0: // fake altgr
                    expect(evt).to.be.deep.equal({keysym: keysyms.lookup(0xfe03), type: 'keydown'});
                    ++count;
                    break;
                case 1: // stall before processing the 'a' keydown
                    expect(evt).to.be.deep.equal({type: 'stall'});
                    ++count;
                    break;
                case 2: // 'a'
                    expect(evt).to.be.deep.equal({
                        type: 'keydown',
                        keyId: 0x41,
                        keysym: keysyms.lookup(0x61)
                    });

                    done();
                    break;
                }
            }).keydown({keyCode: 0x41, altGraphKey: true});

        });
        describe('suppress the right events at the right time', function() {
            it('should suppress anything while a shortcut modifier is down', function() {
                var obj = KeyEventDecoder(kbdUtil.ModifierSync(), function(evt) {});

                obj.keydown({keyCode: 0x11}); // press ctrl
                expect(obj.keydown({keyCode: 'A'.charCodeAt()})).to.be.true;
                expect(obj.keydown({keyCode: ' '.charCodeAt()})).to.be.true;
                expect(obj.keydown({keyCode: '1'.charCodeAt()})).to.be.true;
                expect(obj.keydown({keyCode: 0x3c})).to.be.true; // < key on DK Windows
                expect(obj.keydown({keyCode: 0xde})).to.be.true; // Ø key on DK
            });
            it('should suppress non-character keys', function() {
                var obj = KeyEventDecoder(kbdUtil.ModifierSync(), function(evt) {});

                expect(obj.keydown({keyCode: 0x08}), 'a').to.be.true;
                expect(obj.keydown({keyCode: 0x09}), 'b').to.be.true;
                expect(obj.keydown({keyCode: 0x11}), 'd').to.be.true;
                expect(obj.keydown({keyCode: 0x12}), 'e').to.be.true;
            });
            it('should not suppress shift', function() {
                var obj = KeyEventDecoder(kbdUtil.ModifierSync(), function(evt) {});

                expect(obj.keydown({keyCode: 0x10}), 'd').to.be.false;
            });
            it('should generate event for shift keydown', function() {
                var called = false;
                var obj = KeyEventDecoder(kbdUtil.ModifierSync(), function(evt) {
                    expect(evt).to.have.property('keysym');
                    called = true;
                }).keydown({keyCode: 0x10});
                expect(called).to.be.true;
            });
            it('should not suppress character keys', function() {
                var obj = KeyEventDecoder(kbdUtil.ModifierSync(), function(evt) {});

                expect(obj.keydown({keyCode: 'A'.charCodeAt()})).to.be.false;
                expect(obj.keydown({keyCode: ' '.charCodeAt()})).to.be.false;
                expect(obj.keydown({keyCode: '1'.charCodeAt()})).to.be.false;
                expect(obj.keydown({keyCode: 0x3c})).to.be.false; // < key on DK Windows
                expect(obj.keydown({keyCode: 0xde})).to.be.false; // Ø key on DK
            });
            it('should not suppress if a char modifier is down', function() {
                var obj = KeyEventDecoder(kbdUtil.ModifierSync([0xfe03]), function(evt) {});

                obj.keydown({keyCode: 0xe1}); // press altgr
                expect(obj.keydown({keyCode: 'A'.charCodeAt()})).to.be.false;
                expect(obj.keydown({keyCode: ' '.charCodeAt()})).to.be.false;
                expect(obj.keydown({keyCode: '1'.charCodeAt()})).to.be.false;
                expect(obj.keydown({keyCode: 0x3c})).to.be.false; // < key on DK Windows
                expect(obj.keydown({keyCode: 0xde})).to.be.false; // Ø key on DK
            });
        });
        describe('Keypress and keyup events', function() {
            it('should always suppress event propagation', function() {
                var obj = KeyEventDecoder(kbdUtil.ModifierSync(), function(evt) {});

                expect(obj.keypress({keyCode: 'A'.charCodeAt()})).to.be.true;
                expect(obj.keypress({keyCode: 0x3c})).to.be.true; // < key on DK Windows
                expect(obj.keypress({keyCode: 0x11})).to.be.true;

                expect(obj.keyup({keyCode: 'A'.charCodeAt()})).to.be.true;
                expect(obj.keyup({keyCode: 0x3c})).to.be.true; // < key on DK Windows
                expect(obj.keyup({keyCode: 0x11})).to.be.true;
            });
            it('should never generate stalls', function() {
                var obj = KeyEventDecoder(kbdUtil.ModifierSync(), function(evt) {
                    expect(evt.type).to.not.be.equal('stall');
                });

                obj.keypress({keyCode: 'A'.charCodeAt()});
                obj.keypress({keyCode: 0x3c});
                obj.keypress({keyCode: 0x11});

                obj.keyup({keyCode: 'A'.charCodeAt()});
                obj.keyup({keyCode: 0x3c});
                obj.keyup({keyCode: 0x11});
            });
        });
        describe('mark events if a char modifier is down', function() {
            it('should not mark modifiers on a keydown event', function() {
                var times_called = 0;
                var obj = KeyEventDecoder(kbdUtil.ModifierSync([0xfe03]), function(evt) {
                    switch (times_called++) {
                    case 0: //altgr
                        break;
                    case 1: // 'a'
                        expect(evt).to.not.have.property('escape');
                        break;
                    }
                });

                obj.keydown({keyCode: 0xe1}); // press altgr
                obj.keydown({keyCode: 'A'.charCodeAt()});
            });

            it('should indicate on events if a single-key char modifier is down', function(done) {
                var times_called = 0;
                var obj = KeyEventDecoder(kbdUtil.ModifierSync([0xfe03]), function(evt) {
                    switch (times_called++) {
                    case 0: //altgr
                        break;
                    case 1: // 'a'
                        expect(evt).to.be.deep.equal({
                            type: 'keypress',
                            keyId: 'A'.charCodeAt(),
                            keysym: keysyms.lookup('a'.charCodeAt()),
                            escape: [0xfe03]
                        });
                        done();
                        return;
                    }
                });

                obj.keydown({keyCode: 0xe1}); // press altgr
                obj.keypress({keyCode: 'A'.charCodeAt()});
            });
            it('should indicate on events if a multi-key char modifier is down', function(done) {
                var times_called = 0;
                var obj = KeyEventDecoder(kbdUtil.ModifierSync([0xffe9, 0xffe3]), function(evt) {
                    switch (times_called++) {
                    case 0: //ctrl
                        break;
                    case 1: //alt
                        break;
                    case 2: // 'a'
                        expect(evt).to.be.deep.equal({
                            type: 'keypress',
                            keyId: 'A'.charCodeAt(),
                            keysym: keysyms.lookup('a'.charCodeAt()),
                            escape: [0xffe9, 0xffe3]
                        });
                        done();
                        return;
                    }
                });

                obj.keydown({keyCode: 0x11}); // press ctrl
                obj.keydown({keyCode: 0x12}); // press alt
                obj.keypress({keyCode: 'A'.charCodeAt()});
            });
            it('should not consider a char modifier to be down on the modifier key itself', function() {
                var obj = KeyEventDecoder(kbdUtil.ModifierSync([0xfe03]), function(evt) {
                    expect(evt).to.not.have.property('escape');
                });

                obj.keydown({keyCode: 0xe1}); // press altgr

            });
        });
        describe('add/remove keysym', function() {
            it('should remove keysym from keydown if a char key and no modifier', function() {
                KeyEventDecoder(kbdUtil.ModifierSync(), function(evt) {
                    expect(evt).to.be.deep.equal({keyId: 0x41, type: 'keydown'});
                }).keydown({keyCode: 0x41});
            });
            it('should not remove keysym from keydown if a shortcut modifier is down', function() {
                var times_called = 0;
                KeyEventDecoder(kbdUtil.ModifierSync(), function(evt) {
                    switch (times_called++) {
                    case 1:
                        expect(evt).to.be.deep.equal({keyId: 0x41, keysym: keysyms.lookup(0x61), type: 'keydown'});
                        break;
                    }
                }).keydown({keyCode: 0x41, ctrlKey: true});
                expect(times_called).to.be.equal(2);
            });
            it('should not remove keysym from keydown if a char modifier is down', function() {
                var times_called = 0;
                KeyEventDecoder(kbdUtil.ModifierSync([0xfe03]), function(evt) {
                    switch (times_called++) {
                    case 2:
                        expect(evt).to.be.deep.equal({keyId: 0x41, keysym: keysyms.lookup(0x61), type: 'keydown'});
                        break;
                    }
                }).keydown({keyCode: 0x41, altGraphKey: true});
                expect(times_called).to.be.equal(3);
            });
            it('should not remove keysym from keydown if key is noncharacter', function() {
                KeyEventDecoder(kbdUtil.ModifierSync(), function(evt) {
                    expect(evt, 'bacobjpace').to.be.deep.equal({keyId: 0x09, keysym: keysyms.lookup(0xff09), type: 'keydown'});
                }).keydown({keyCode: 0x09});

                KeyEventDecoder(kbdUtil.ModifierSync(), function(evt) {
                    expect(evt, 'ctrl').to.be.deep.equal({keyId: 0x11, keysym: keysyms.lookup(0xffe3), type: 'keydown'});
                }).keydown({keyCode: 0x11});
            });
            it('should never remove keysym from keypress', function() {
                KeyEventDecoder(kbdUtil.ModifierSync(), function(evt) {
                    expect(evt).to.be.deep.equal({keyId: 0x41, keysym: keysyms.lookup(0x61), type: 'keypress'});
                }).keypress({keyCode: 0x41});
            });
            it('should never remove keysym from keyup', function() {
                KeyEventDecoder(kbdUtil.ModifierSync(), function(evt) {
                    expect(evt).to.be.deep.equal({keyId: 0x41, keysym: keysyms.lookup(0x61), type: 'keyup'});
                }).keyup({keyCode: 0x41});
            });
        });
        // on keypress, keyup(?), always set keysym
        // on keydown, only do it if we don't expect a keypress: if noncharacter OR modifier is down
    });

    describe('Verify that char modifiers are active', function() {
        it('should pass keydown events through if there is no stall', function(done) {
            var obj = VerifyCharModifier(function(evt){
                expect(evt).to.deep.equal({type: 'keydown', keyId: 0x41, keysym: keysyms.lookup(0x41)});
                done();
            })({type: 'keydown', keyId: 0x41, keysym: keysyms.lookup(0x41)});
        });
        it('should pass keyup events through if there is no stall', function(done) {
            var obj = VerifyCharModifier(function(evt){
                expect(evt).to.deep.equal({type: 'keyup', keyId: 0x41, keysym: keysyms.lookup(0x41)});
                done();
            })({type: 'keyup', keyId: 0x41, keysym: keysyms.lookup(0x41)});
        });
        it('should pass keypress events through if there is no stall', function(done) {
            var obj = VerifyCharModifier(function(evt){
                expect(evt).to.deep.equal({type: 'keypress', keyId: 0x41, keysym: keysyms.lookup(0x41)});
                done();
            })({type: 'keypress', keyId: 0x41, keysym: keysyms.lookup(0x41)});
        });
        it('should not pass stall events through', function(done){
            var obj = VerifyCharModifier(function(evt){
                // should only be called once, for the keydown
                expect(evt).to.deep.equal({type: 'keydown', keyId: 0x41, keysym: keysyms.lookup(0x41)});
                done();
            });

            obj({type: 'stall'});
            obj({type: 'keydown', keyId: 0x41, keysym: keysyms.lookup(0x41)});
        });
        it('should merge keydown and keypress events if they come after a stall', function(done) {
            var next_called = false;
            var obj = VerifyCharModifier(function(evt){
                // should only be called once, for the keydown
                expect(next_called).to.be.false;
                next_called = true;
                expect(evt).to.deep.equal({type: 'keydown', keyId: 0x41, keysym: keysyms.lookup(0x44)});
                done();
            });

            obj({type: 'stall'});
            obj({type: 'keydown', keyId: 0x41, keysym: keysyms.lookup(0x42)});
            obj({type: 'keypress', keyId: 0x43, keysym: keysyms.lookup(0x44)});
            expect(next_called).to.be.false;
        });
        it('should preserve modifier attribute when merging if keysyms differ', function(done) {
            var next_called = false;
            var obj = VerifyCharModifier(function(evt){
                // should only be called once, for the keydown
                expect(next_called).to.be.false;
                next_called = true;
                expect(evt).to.deep.equal({type: 'keydown', keyId: 0x41, keysym: keysyms.lookup(0x44), escape: [0xffe3]});
                done();
            });

            obj({type: 'stall'});
            obj({type: 'keydown', keyId: 0x41, keysym: keysyms.lookup(0x42)});
            obj({type: 'keypress', keyId: 0x43, keysym: keysyms.lookup(0x44), escape: [0xffe3]});
            expect(next_called).to.be.false;
        });
        it('should not preserve modifier attribute when merging if keysyms are the same', function() {
            var obj = VerifyCharModifier(function(evt){
                expect(evt).to.not.have.property('escape');
            });

            obj({type: 'stall'});
            obj({type: 'keydown', keyId: 0x41, keysym: keysyms.lookup(0x42)});
            obj({type: 'keypress', keyId: 0x43, keysym: keysyms.lookup(0x42), escape: [0xffe3]});
        });
        it('should not merge keydown and keypress events if there is no stall', function(done) {
            var times_called = 0;
            var obj = VerifyCharModifier(function(evt){
                switch(times_called) {
                case 0:
                    expect(evt).to.deep.equal({type: 'keydown', keyId: 0x41, keysym: keysyms.lookup(0x42)});
                    break;
                case 1:
                    expect(evt).to.deep.equal({type: 'keypress', keyId: 0x43, keysym: keysyms.lookup(0x44)});
                    done();
                    break;
                }

                ++times_called;
            });

            obj({type: 'keydown', keyId: 0x41, keysym: keysyms.lookup(0x42)});
            obj({type: 'keypress', keyId: 0x43, keysym: keysyms.lookup(0x44)});
        });
        it('should not merge keydown and keypress events if separated by another event', function(done) {
            var times_called = 0;
            var obj = VerifyCharModifier(function(evt){
                switch(times_called) {
                case 0:
                    expect(evt,1).to.deep.equal({type: 'keydown', keyId: 0x41, keysym: keysyms.lookup(0x42)});
                    break;
                case 1:
                    expect(evt,2).to.deep.equal({type: 'keyup', keyId: 0x43, keysym: keysyms.lookup(0x44)});
                    break;
                case 2:
                    expect(evt,3).to.deep.equal({type: 'keypress', keyId: 0x45, keysym: keysyms.lookup(0x46)});
                    done();
                    break;
                }

                ++times_called;
            });

            obj({type: 'stall'});
            obj({type: 'keydown', keyId: 0x41, keysym: keysyms.lookup(0x42)});
            obj({type: 'keyup', keyId: 0x43, keysym: keysyms.lookup(0x44)});
            obj({type: 'keypress', keyId: 0x45, keysym: keysyms.lookup(0x46)});
        });
    });

    describe('Track Key State', function() {
        it('should do nothing on keyup events if no keys are down', function() {
            var obj = TrackKeyState(function(evt) {
                expect(true).to.be.false;
            });
            obj({type: 'keyup', keyId: 0x41});
        });
        it('should insert into the queue on keydown if no keys are down', function() {
            var times_called = 0;
            var elem = null;
            var keysymsdown = {};
            var obj = TrackKeyState(function(evt) {
                ++times_called;
                if (elem.type == 'keyup') {
                expect(evt).to.have.property('keysym');
                    expect (keysymsdown[evt.keysym.keysym]).to.not.be.undefined;
                    delete keysymsdown[evt.keysym.keysym];
                }
                else {
                    expect(evt).to.be.deep.equal(elem);
                    expect (keysymsdown[evt.keysym.keysym]).to.not.be.undefined;
                }
                elem = null;
            });

            expect(elem).to.be.null;
            elem = {type: 'keydown', keyId: 0x41, keysym: keysyms.lookup(0x42)};
            keysymsdown[keysyms.lookup(0x42).keysym] = true;
            obj(elem);
            expect(elem).to.be.null;
            elem = {type: 'keyup', keyId: 0x41};
            obj(elem);
            expect(elem).to.be.null;
            expect(times_called).to.be.equal(2);
        });
        it('should insert into the queue on keypress if no keys are down', function() {
            var times_called = 0;
            var elem = null;
            var keysymsdown = {};
            var obj = TrackKeyState(function(evt) {
                ++times_called;
                if (elem.type == 'keyup') {
                    expect(evt).to.have.property('keysym');
                    expect (keysymsdown[evt.keysym.keysym]).to.not.be.undefined;
                    delete keysymsdown[evt.keysym.keysym];
                }
                else {
                    expect(evt).to.be.deep.equal(elem);
                    expect (keysymsdown[evt.keysym.keysym]).to.not.be.undefined;
                }
                elem = null;
            });

            expect(elem).to.be.null;
            elem = {type: 'keypress', keyId: 0x41, keysym: keysyms.lookup(0x42)};
            keysymsdown[keysyms.lookup(0x42).keysym] = true;
            obj(elem);
            expect(elem).to.be.null;
            elem = {type: 'keyup', keyId: 0x41};
            obj(elem);
            expect(elem).to.be.null;
            expect(times_called).to.be.equal(2);
        });
        it('should add keysym to last key entry if keyId matches', function() {
            // this implies that a single keyup will release both keysyms
            var times_called = 0;
            var elem = null;
            var keysymsdown = {};
            var obj = TrackKeyState(function(evt) {
                ++times_called;
                if (elem.type == 'keyup') {
                    expect(evt).to.have.property('keysym');
                    expect (keysymsdown[evt.keysym.keysym]).to.not.be.undefined;
                    delete keysymsdown[evt.keysym.keysym];
                }
                else {
                    expect(evt).to.be.deep.equal(elem);
                    expect (keysymsdown[evt.keysym.keysym]).to.not.be.undefined;
                    elem = null;
                }
            });

            expect(elem).to.be.null;
            elem = {type: 'keypress', keyId: 0x41, keysym: keysyms.lookup(0x42)};
            keysymsdown[keysyms.lookup(0x42).keysym] = true;
            obj(elem);
            expect(elem).to.be.null;
            elem = {type: 'keypress', keyId: 0x41, keysym: keysyms.lookup(0x43)};
            keysymsdown[keysyms.lookup(0x43).keysym] = true;
            obj(elem);
            expect(elem).to.be.null;
            elem = {type: 'keyup', keyId: 0x41};
            obj(elem);
            expect(times_called).to.be.equal(4);
        });
        it('should create new key entry if keyId matches and keysym does not', function() {
            // this implies that a single keyup will release both keysyms
            var times_called = 0;
            var elem = null;
            var keysymsdown = {};
            var obj = TrackKeyState(function(evt) {
                ++times_called;
                if (elem.type == 'keyup') {
                    expect(evt).to.have.property('keysym');
                    expect (keysymsdown[evt.keysym.keysym]).to.not.be.undefined;
                    delete keysymsdown[evt.keysym.keysym];
                }
                else {
                    expect(evt).to.be.deep.equal(elem);
                    expect (keysymsdown[evt.keysym.keysym]).to.not.be.undefined;
                    elem = null;
                }
            });

            expect(elem).to.be.null;
            elem = {type: 'keydown', keyId: 0, keysym: keysyms.lookup(0x42)};
            keysymsdown[keysyms.lookup(0x42).keysym] = true;
            obj(elem);
            expect(elem).to.be.null;
            elem = {type: 'keydown', keyId: 0, keysym: keysyms.lookup(0x43)};
            keysymsdown[keysyms.lookup(0x43).keysym] = true;
            obj(elem);
            expect(times_called).to.be.equal(2);
            expect(elem).to.be.null;
            elem = {type: 'keyup', keyId: 0};
            obj(elem);
            expect(times_called).to.be.equal(3);
            elem = {type: 'keyup', keyId: 0};
            obj(elem);
            expect(times_called).to.be.equal(4);
        });
        it('should merge key entry if keyIds are zero and keysyms match', function() {
            // this implies that a single keyup will release both keysyms
            var times_called = 0;
            var elem = null;
            var keysymsdown = {};
            var obj = TrackKeyState(function(evt) {
                ++times_called;
                if (elem.type == 'keyup') {
                    expect(evt).to.have.property('keysym');
                    expect (keysymsdown[evt.keysym.keysym]).to.not.be.undefined;
                    delete keysymsdown[evt.keysym.keysym];
                }
                else {
                    expect(evt).to.be.deep.equal(elem);
                    expect (keysymsdown[evt.keysym.keysym]).to.not.be.undefined;
                    elem = null;
                }
            });

            expect(elem).to.be.null;
            elem = {type: 'keydown', keyId: 0, keysym: keysyms.lookup(0x42)};
            keysymsdown[keysyms.lookup(0x42).keysym] = true;
            obj(elem);
            expect(elem).to.be.null;
            elem = {type: 'keydown', keyId: 0, keysym: keysyms.lookup(0x42)};
            keysymsdown[keysyms.lookup(0x42).keysym] = true;
            obj(elem);
            expect(times_called).to.be.equal(2);
            expect(elem).to.be.null;
            elem = {type: 'keyup', keyId: 0};
            obj(elem);
            expect(times_called).to.be.equal(3);
        });
        it('should add keysym as separate entry if keyId does not match last event', function() {
            // this implies that separate keyups are required
            var times_called = 0;
            var elem = null;
            var keysymsdown = {};
            var obj = TrackKeyState(function(evt) {
                ++times_called;
                if (elem.type == 'keyup') {
                    expect(evt).to.have.property('keysym');
                    expect (keysymsdown[evt.keysym.keysym]).to.not.be.undefined;
                    delete keysymsdown[evt.keysym.keysym];
                }
                else {
                    expect(evt).to.be.deep.equal(elem);
                    expect (keysymsdown[evt.keysym.keysym]).to.not.be.undefined;
                    elem = null;
                }
            });

            expect(elem).to.be.null;
            elem = {type: 'keypress', keyId: 0x41, keysym: keysyms.lookup(0x42)};
            keysymsdown[keysyms.lookup(0x42).keysym] = true;
            obj(elem);
            expect(elem).to.be.null;
            elem = {type: 'keypress', keyId: 0x42, keysym: keysyms.lookup(0x43)};
            keysymsdown[keysyms.lookup(0x43).keysym] = true;
            obj(elem);
            expect(elem).to.be.null;
            elem = {type: 'keyup', keyId: 0x41};
            obj(elem);
            expect(times_called).to.be.equal(4);
            elem = {type: 'keyup', keyId: 0x42};
            obj(elem);
            expect(times_called).to.be.equal(4);
        });
        it('should add keysym as separate entry if keyId does not match last event and first is zero', function() {
            // this implies that separate keyups are required
            var times_called = 0;
            var elem = null;
            var keysymsdown = {};
            var obj = TrackKeyState(function(evt) {
                ++times_called;
                if (elem.type == 'keyup') {
                    expect(evt).to.have.property('keysym');
                    expect (keysymsdown[evt.keysym.keysym]).to.not.be.undefined;
                    delete keysymsdown[evt.keysym.keysym];
                }
                else {
                    expect(evt).to.be.deep.equal(elem);
                    expect (keysymsdown[evt.keysym.keysym]).to.not.be.undefined;
                    elem = null;
                }
            });

            expect(elem).to.be.null;
            elem = {type: 'keydown', keyId: 0, keysym: keysyms.lookup(0x42)};
            keysymsdown[keysyms.lookup(0x42).keysym] = true;
            obj(elem);
            expect(elem).to.be.null;
            elem = {type: 'keydown', keyId: 0x42, keysym: keysyms.lookup(0x43)};
            keysymsdown[keysyms.lookup(0x43).keysym] = true;
            obj(elem);
            expect(elem).to.be.null;
            expect(times_called).to.be.equal(2);
            elem = {type: 'keyup', keyId: 0};
            obj(elem);
            expect(times_called).to.be.equal(3);
            elem = {type: 'keyup', keyId: 0x42};
            obj(elem);
            expect(times_called).to.be.equal(4);
        });
        it('should add keysym as separate entry if keyId does not match last event and second is zero', function() {
            // this implies that a separate keyups are required
            var times_called = 0;
            var elem = null;
            var keysymsdown = {};
            var obj = TrackKeyState(function(evt) {
                ++times_called;
                if (elem.type == 'keyup') {
                    expect(evt).to.have.property('keysym');
                    expect (keysymsdown[evt.keysym.keysym]).to.not.be.undefined;
                    delete keysymsdown[evt.keysym.keysym];
                }
                else {
                    expect(evt).to.be.deep.equal(elem);
                    expect (keysymsdown[evt.keysym.keysym]).to.not.be.undefined;
                    elem = null;
                }
            });

            expect(elem).to.be.null;
            elem = {type: 'keydown', keyId: 0x41, keysym: keysyms.lookup(0x42)};
            keysymsdown[keysyms.lookup(0x42).keysym] = true;
            obj(elem);
            expect(elem).to.be.null;
            elem = {type: 'keydown', keyId: 0, keysym: keysyms.lookup(0x43)};
            keysymsdown[keysyms.lookup(0x43).keysym] = true;
            obj(elem);
            expect(elem).to.be.null;
            elem = {type: 'keyup', keyId: 0x41};
            obj(elem);
            expect(times_called).to.be.equal(3);
            elem = {type: 'keyup', keyId: 0};
            obj(elem);
            expect(times_called).to.be.equal(4);
        });
        it('should pop matching key event on keyup', function() {
            var times_called = 0;
            var obj = TrackKeyState(function(evt) {
                switch (times_called++) {
                    case 0:
                    case 1:
                    case 2:
                        expect(evt.type).to.be.equal('keydown');
                        break;
                    case 3:
                        expect(evt).to.be.deep.equal({type: 'keyup', keyId: 0x42, keysym: keysyms.lookup(0x62)});
                        break;
                }
            });

            obj({type: 'keydown', keyId: 0x41, keysym: keysyms.lookup(0x61)});
            obj({type: 'keydown', keyId: 0x42, keysym: keysyms.lookup(0x62)});
            obj({type: 'keydown', keyId: 0x43, keysym: keysyms.lookup(0x63)});
            obj({type: 'keyup', keyId: 0x42});
            expect(times_called).to.equal(4);
        });
        it('should pop the first zero keyevent on keyup with zero keyId', function() {
            var times_called = 0;
            var obj = TrackKeyState(function(evt) {
                switch (times_called++) {
                    case 0:
                    case 1:
                    case 2:
                        expect(evt.type).to.be.equal('keydown');
                        break;
                    case 3:
                        expect(evt).to.be.deep.equal({type: 'keyup', keyId: 0, keysym: keysyms.lookup(0x61)});
                        break;
                }
            });

            obj({type: 'keydown', keyId: 0, keysym: keysyms.lookup(0x61)});
            obj({type: 'keydown', keyId: 0, keysym: keysyms.lookup(0x62)});
            obj({type: 'keydown', keyId: 0x41, keysym: keysyms.lookup(0x63)});
            obj({type: 'keyup', keyId: 0x0});
            expect(times_called).to.equal(4);
        });
        it('should pop the last keyevents keysym if no match is found for keyId', function() {
            var times_called = 0;
            var obj = TrackKeyState(function(evt) {
                switch (times_called++) {
                    case 0:
                    case 1:
                    case 2:
                        expect(evt.type).to.be.equal('keydown');
                        break;
                    case 3:
                        expect(evt).to.be.deep.equal({type: 'keyup', keyId: 0x44, keysym: keysyms.lookup(0x63)});
                        break;
                }
            });

            obj({type: 'keydown', keyId: 0x41, keysym: keysyms.lookup(0x61)});
            obj({type: 'keydown', keyId: 0x42, keysym: keysyms.lookup(0x62)});
            obj({type: 'keydown', keyId: 0x43, keysym: keysyms.lookup(0x63)});
            obj({type: 'keyup', keyId: 0x44});
            expect(times_called).to.equal(4);
        });
        describe('Firefox sends keypress even when keydown is suppressed', function() {
            it('should discard the keypress', function() {
                var times_called = 0;
                var obj = TrackKeyState(function(evt) {
                    expect(times_called).to.be.equal(0);
                    ++times_called;
                });

                obj({type: 'keydown', keyId: 0x41, keysym: keysyms.lookup(0x42)});
                expect(times_called).to.be.equal(1);
                obj({type: 'keypress', keyId: 0x41, keysym: keysyms.lookup(0x43)});
            });
        });
        describe('releaseAll', function() {
            it('should do nothing if no keys have been pressed', function() {
                var times_called = 0;
                var obj = TrackKeyState(function(evt) {
                    ++times_called;
                });
                obj({type: 'releaseall'});
                expect(times_called).to.be.equal(0);
            });
            it('should release the keys that have been pressed', function() {
                var times_called = 0;
                var obj = TrackKeyState(function(evt) {
                    switch (times_called++) {
                    case 2:
                        expect(evt).to.be.deep.equal({type: 'keyup', keyId: 0, keysym: keysyms.lookup(0x41)});
                        break;
                    case 3:
                        expect(evt).to.be.deep.equal({type: 'keyup', keyId: 0, keysym: keysyms.lookup(0x42)});
                        break;
                    }
                });
                obj({type: 'keydown', keyId: 0x41, keysym: keysyms.lookup(0x41)});
                obj({type: 'keydown', keyId: 0x42, keysym: keysyms.lookup(0x42)});
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
                EscapeModifiers(function(evt) {
                    expect(times_called).to.be.equal(0);
                    ++times_called;
                    expect(evt).to.be.deep.equal({type: 'keydown', keyId: 0x41, keysym: keysyms.lookup(0x42)});
                })({type: 'keydown', keyId: 0x41, keysym: keysyms.lookup(0x42)});
                expect(times_called).to.be.equal(1);
            });
            it('should generate fake undo/redo events when a char modifier is down', function() {
                var times_called = 0;
                EscapeModifiers(function(evt) {
                    switch(times_called++) {
                    case 0:
                        expect(evt).to.be.deep.equal({type: 'keyup', keyId: 0, keysym: keysyms.lookup(0xffe9)});
                        break;
                    case 1:
                        expect(evt).to.be.deep.equal({type: 'keyup', keyId: 0, keysym: keysyms.lookup(0xffe3)});
                        break;
                    case 2:
                        expect(evt).to.be.deep.equal({type: 'keydown', keyId: 0x41, keysym: keysyms.lookup(0x42), escape: [0xffe9, 0xffe3]});
                        break;
                    case 3:
                        expect(evt).to.be.deep.equal({type: 'keydown', keyId: 0, keysym: keysyms.lookup(0xffe9)});
                        break;
                    case 4:
                        expect(evt).to.be.deep.equal({type: 'keydown', keyId: 0, keysym: keysyms.lookup(0xffe3)});
                        break;
                    }
                })({type: 'keydown', keyId: 0x41, keysym: keysyms.lookup(0x42), escape: [0xffe9, 0xffe3]});
                expect(times_called).to.be.equal(5);
            });
        });
        describe('Keyup', function() {
            it('should pass through when a char modifier is down', function() {
                var times_called = 0;
                EscapeModifiers(function(evt) {
                    expect(times_called).to.be.equal(0);
                    ++times_called;
                    expect(evt).to.be.deep.equal({type: 'keyup', keyId: 0x41, keysym: keysyms.lookup(0x42), escape: [0xfe03]});
                })({type: 'keyup', keyId: 0x41, keysym: keysyms.lookup(0x42), escape: [0xfe03]});
                expect(times_called).to.be.equal(1);
            });
            it('should pass through when a char modifier is not down', function() {
                var times_called = 0;
                EscapeModifiers(function(evt) {
                    expect(times_called).to.be.equal(0);
                    ++times_called;
                    expect(evt).to.be.deep.equal({type: 'keyup', keyId: 0x41, keysym: keysyms.lookup(0x42)});
                })({type: 'keyup', keyId: 0x41, keysym: keysyms.lookup(0x42)});
                expect(times_called).to.be.equal(1);
            });
        });
    });
});
