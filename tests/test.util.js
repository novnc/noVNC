// requires local modules: util
/* jshint expr: true */

var assert = chai.assert;
var expect = chai.expect;

describe('Utils', function() {
    "use strict";

    describe('Array instance methods', function () {
        describe('push8', function () {
            it('should push a byte on to the array', function () {
                var arr = [1];
                arr.push8(128);
                expect(arr).to.deep.equal([1, 128]);
            });

            it('should only use the least significant byte of any number passed in', function () {
                var arr = [1];
                arr.push8(0xABCD);
                expect(arr).to.deep.equal([1, 0xCD]);
            });
        });

        describe('push16', function () {
            it('should push two bytes on to the array', function () {
                var arr = [1];
                arr.push16(0xABCD);
                expect(arr).to.deep.equal([1, 0xAB, 0xCD]);
            });

            it('should only use the two least significant bytes of any number passed in', function () {
                var arr = [1];
                arr.push16(0xABCDEF);
                expect(arr).to.deep.equal([1, 0xCD, 0xEF]);
            });
        });

        describe('push32', function () {
            it('should push four bytes on to the array', function () {
                var arr = [1];
                arr.push32(0xABCDEF12);
                expect(arr).to.deep.equal([1, 0xAB, 0xCD, 0xEF, 0x12]);
            });

            it('should only use the four least significant bytes of any number passed in', function () {
                var arr = [1];
                arr.push32(0xABCDEF1234);
                expect(arr).to.deep.equal([1, 0xCD, 0xEF, 0x12, 0x34]);
            });
        });
    });

    describe('logging functions', function () {
        beforeEach(function () {
            sinon.spy(console, 'log');
            sinon.spy(console, 'warn');
            sinon.spy(console, 'error');
        });

        afterEach(function () {
           console.log.restore();
           console.warn.restore();
           console.error.restore();
        });

        it('should use noop for levels lower than the min level', function () {
            Util.init_logging('warn');
            Util.Debug('hi');
            Util.Info('hello');
            expect(console.log).to.not.have.been.called;
        });

        it('should use console.log for Debug and Info', function () {
            Util.init_logging('debug');
            Util.Debug('dbg');
            Util.Info('inf');
            expect(console.log).to.have.been.calledWith('dbg');
            expect(console.log).to.have.been.calledWith('inf');
        });

        it('should use console.warn for Warn', function () {
            Util.init_logging('warn');
            Util.Warn('wrn');
            expect(console.warn).to.have.been.called;
            expect(console.warn).to.have.been.calledWith('wrn');
        });

        it('should use console.error for Error', function () {
            Util.init_logging('error');
            Util.Error('err');
            expect(console.error).to.have.been.called;
            expect(console.error).to.have.been.calledWith('err');
        });
    });

    // TODO(directxman12): test the conf_default and conf_defaults methods
    // TODO(directxman12): test decodeUTF8
    // TODO(directxman12): test the event methods (addEvent, removeEvent, stopEvent)
    // TODO(directxman12): figure out a good way to test getPosition and getEventPosition
    // TODO(directxman12): figure out how to test the browser detection functions properly
    //                     (we can't really test them against the browsers, except for Gecko
    //                     via PhantomJS, the default test driver)
    // TODO(directxman12): figure out how to test Util.Flash
});
