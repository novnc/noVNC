/* jshint expr: true */

var assert = chai.assert;
var expect = chai.expect;

import * as Log from '../core/util/logging.js';
import l10nGet, { l10n } from '../core/util/localization.js';

import 'sinon';
import sinonChai from '../node_modules/sinon-chai/lib/sinon-chai.js';
chai.use(sinonChai);

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

    describe('language selection', function () {
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
            if (window.navigator.languages !== undefined) {
                // Object.defineProperty() doesn't work properly in old
                // versions of Chrome
                this.skip();
            }

            window.navigator.languages = [];
        });
        afterEach(function () {
            Object.defineProperty(window, "navigator", origNavigator);
        });

        it('should use English by default', function() {
            expect(l10n.language).to.equal('en');
        });
        it('should use English if no user language matches', function() {
            window.navigator.languages = ["nl", "de"];
            l10n.setup(["es", "fr"]);
            expect(l10n.language).to.equal('en');
        });
        it('should use the most preferred user language', function() {
            window.navigator.languages = ["nl", "de", "fr"];
            l10n.setup(["es", "fr", "de"]);
            expect(l10n.language).to.equal('de');
        });
        it('should prefer sub-languages languages', function() {
            window.navigator.languages = ["pt-BR"];
            l10n.setup(["pt", "pt-BR"]);
            expect(l10n.language).to.equal('pt-BR');
        });
        it('should fall back to language "parents"', function() {
            window.navigator.languages = ["pt-BR"];
            l10n.setup(["fr", "pt", "de"]);
            expect(l10n.language).to.equal('pt');
        });
        it('should not use specific language when user asks for a generic language', function() {
            window.navigator.languages = ["pt", "de"];
            l10n.setup(["fr", "pt-BR", "de"]);
            expect(l10n.language).to.equal('de');
        });
        it('should handle underscore as a separator', function() {
            window.navigator.languages = ["pt-BR"];
            l10n.setup(["pt_BR"]);
            expect(l10n.language).to.equal('pt_BR');
        });
        it('should handle difference in case', function() {
            window.navigator.languages = ["pt-br"];
            l10n.setup(["pt-BR"]);
            expect(l10n.language).to.equal('pt-BR');
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
