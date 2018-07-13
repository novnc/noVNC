/* eslint-disable no-console */
const expect = chai.expect;

import * as Log from '../core/util/logging.js';

describe('Utils', function() {
    "use strict";

    describe('logging functions', function () {
        beforeEach(function () {
            sinon.spy(console, 'log');
            sinon.spy(console, 'debug');
            sinon.spy(console, 'warn');
            sinon.spy(console, 'error');
            sinon.spy(console, 'info');
        });

        afterEach(function () {
            console.log.restore();
            console.debug.restore();
            console.warn.restore();
            console.error.restore();
            console.info.restore();
            Log.init_logging();
        });

        it('should use noop for levels lower than the min level', function () {
            Log.init_logging('warn');
            Log.Debug('hi');
            Log.Info('hello');
            expect(console.log).to.not.have.been.called;
        });

        it('should use console.debug for Debug', function () {
            Log.init_logging('debug');
            Log.Debug('dbg');
            expect(console.debug).to.have.been.calledWith('dbg');
        });

        it('should use console.info for Info', function () {
            Log.init_logging('debug');
            Log.Info('inf');
            expect(console.info).to.have.been.calledWith('inf');
        });

        it('should use console.warn for Warn', function () {
            Log.init_logging('warn');
            Log.Warn('wrn');
            expect(console.warn).to.have.been.called;
            expect(console.warn).to.have.been.calledWith('wrn');
        });

        it('should use console.error for Error', function () {
            Log.init_logging('error');
            Log.Error('err');
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
/* eslint-enable no-console */
