/* eslint-disable no-console */
import * as Log from '../core/util/logging.js';
import { encodeUTF8, decodeUTF8 } from '../core/util/strings.js';

describe('Utils', function () {
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
            Log.initLogging();
        });

        it('should use noop for levels lower than the min level', function () {
            Log.initLogging('warn');
            Log.Debug('hi');
            Log.Info('hello');
            expect(console.log).to.not.have.been.called;
        });

        it('should use console.debug for Debug', function () {
            Log.initLogging('debug');
            Log.Debug('dbg');
            expect(console.debug).to.have.been.calledWith('dbg');
        });

        it('should use console.info for Info', function () {
            Log.initLogging('debug');
            Log.Info('inf');
            expect(console.info).to.have.been.calledWith('inf');
        });

        it('should use console.warn for Warn', function () {
            Log.initLogging('warn');
            Log.Warn('wrn');
            expect(console.warn).to.have.been.called;
            expect(console.warn).to.have.been.calledWith('wrn');
        });

        it('should use console.error for Error', function () {
            Log.initLogging('error');
            Log.Error('err');
            expect(console.error).to.have.been.called;
            expect(console.error).to.have.been.calledWith('err');
        });
    });

    describe('string functions', function () {
        it('should decode UTF-8 to DOMString correctly', function () {
            const utf8string = '\xd0\x9f';
            const domstring = decodeUTF8(utf8string);
            expect(domstring).to.equal("П");
        });

        it('should encode DOMString to UTF-8 correctly', function () {
            const domstring = "åäöa";
            const utf8string = encodeUTF8(domstring);
            expect(utf8string).to.equal('\xc3\xa5\xc3\xa4\xc3\xb6\x61');
        });

        it('should allow Latin-1 strings if allowLatin1 is set when decoding', function () {
            const latin1string = '\xe5\xe4\xf6';
            expect(() => decodeUTF8(latin1string)).to.throw(Error);
            expect(decodeUTF8(latin1string, true)).to.equal('åäö');
        });
    });

    // TODO(directxman12): test the conf_default and conf_defaults methods
    // TODO(directxman12): test the event methods (addEvent, removeEvent, stopEvent)
    // TODO(directxman12): figure out a good way to test getPosition and getEventPosition
    // TODO(directxman12): figure out how to test the browser detection functions properly
    //                     (we can't really test them against the browsers, except for Gecko
    //                     via PhantomJS, the default test driver)
});
/* eslint-enable no-console */
