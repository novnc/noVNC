// requires local modules: util
/* jshint expr: true */

var assert = chai.assert;
var expect = chai.expect;

describe('Utils', function() {
    "use strict";

    describe('logging functions', function () {
        beforeEach(function () {
            sinon.spy(console, 'log');
            sinon.spy(console, 'warn');
            sinon.spy(console, 'error');
            sinon.spy(console, 'info');
        });

        afterEach(function () {
           console.log.restore();
           console.warn.restore();
           console.error.restore();
           console.info.restore();
        });

        it('should use noop for levels lower than the min level', function () {
            Util.init_logging('warn');
            Util.Debug('hi');
            Util.Info('hello');
            expect(console.log).to.not.have.been.called;
        });

        it('should use console.log for Debug', function () {
            Util.init_logging('debug');
            Util.Debug('dbg');
            expect(console.log).to.have.been.calledWith('dbg');
        });
        
        it('should use console.info for Info', function () {
            Util.init_logging('debug');
            Util.Info('inf');
            expect(console.info).to.have.been.calledWith('inf');
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
});
