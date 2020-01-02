/* eslint-disable no-console */
const expect = chai.expect;

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

    describe('string functions', function () {
        it('should decode UTF-8 to DOMString correctly', function () {
            // The capital cyrillic letter 'PE' has the hexcode 'd0 9f' in UTF-8
            const utf8string = String.fromCodePoint(parseInt("d0", 16),
                                                    parseInt("9f", 16));
            const domstring = decodeUTF8(utf8string);
            expect(domstring).to.equal("П");
        });

        it('should encode DOMString to UTF-8 correctly', function () {
            const domstring = "åäöa";
            const utf8string = encodeUTF8(domstring);

            // The hexcode in UTF-8 for 'å' is 'c3 a5'
            expect(utf8string.codePointAt(0).toString(16)).to.equal("c3");
            expect(utf8string.codePointAt(1).toString(16)).to.equal("a5");
            // ä
            expect(utf8string.codePointAt(2).toString(16)).to.equal("c3");
            expect(utf8string.codePointAt(3).toString(16)).to.equal("a4");
            // ö
            expect(utf8string.codePointAt(4).toString(16)).to.equal("c3");
            expect(utf8string.codePointAt(5).toString(16)).to.equal("b6");
            // a
            expect(utf8string.codePointAt(6).toString(16)).to.equal("61");
        });

        it('should keep the string intact if encoding to UTF-8 and then decoding', function() {
            const domstring = "κόσμε";
            const utf8string = encodeUTF8(domstring);
            expect(decodeUTF8(utf8string)).to.equal(domstring);
        });

        it('should ignore URIErrors when UTF-8 decoding if allowLatin1 is set', function() {
            expect(() => decodeUTF8("�")).to.throw(URIError);
            expect(() => decodeUTF8("�", true)).to.not.throw(URIError);

            // Only URIError should be ignored
            expect(() => decodeUTF8(undefVar, true)).to.throw(Error);
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
