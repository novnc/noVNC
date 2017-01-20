// requires local modules: util
/* jshint expr: true */

var assert = chai.assert;
var expect = chai.expect;

describe('Utils', function() {
    "use strict";

    describe('Array class methods', function () {

        var expectTypedArrayEq = function (cls, arr) {
            var other = cls.from(arr);
            
            expect(other).to.be.instanceof(cls);

            // N.B.: We might be tempted to say 'expect(other).to.deep.equal(arr);',
            // but that would be incorrect in the situation where
            // 'arr' is not an instance of 'cls'.
            expect(other.length).to.equal(arr.length);
            for (var i = 0; i < arr.length; ++i)
                expect(other[i]).to.equal(arr[i]);

            // TODO: Test deep/shallow copy behavior?
        };

        describe('Array.from', function () {
            it('should create a new object with the same type and contents', function () {
                var arr = [5, 4, 3];
                expectTypedArrayEq(Array, arr);
            });
        });
        
        // As a stand-in for all of the TypedArray classes
        describe('Int32Array.from', function () {
            it('should create a new object with the same type and contents', function () {
                var arr = new Int32Array(3);
                arr[0] = 5; arr[1] = 4; arr[2] = 3;  // want to do this without from(), obviously
                expectTypedArrayEq(Int32Array, arr);
            });

            it('should return an Int32Array even if the argument is a different type of array', function () {
             var arr = [5, 4, 3];
             expectTypedArrayEq(Int32Array, arr);
            });
        });
    });

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
            expect(Util.Localisation.language).to.equal('en');
        });
        it('should use English if no user language matches', function() {
            window.navigator.languages = ["nl", "de"];
            Util.Localisation.setup(["es", "fr"]);
            expect(Util.Localisation.language).to.equal('en');
        });
        it('should use the most preferred user language', function() {
            window.navigator.languages = ["nl", "de", "fr"];
            Util.Localisation.setup(["es", "fr", "de"]);
            expect(Util.Localisation.language).to.equal('de');
        });
        it('should prefer sub-languages languages', function() {
            window.navigator.languages = ["pt-BR"];
            Util.Localisation.setup(["pt", "pt-BR"]);
            expect(Util.Localisation.language).to.equal('pt-BR');
        });
        it('should fall back to language "parents"', function() {
            window.navigator.languages = ["pt-BR"];
            Util.Localisation.setup(["fr", "pt", "de"]);
            expect(Util.Localisation.language).to.equal('pt');
        });
        it('should not use specific language when user asks for a generic language', function() {
            window.navigator.languages = ["pt", "de"];
            Util.Localisation.setup(["fr", "pt-BR", "de"]);
            expect(Util.Localisation.language).to.equal('de');
        });
        it('should handle underscore as a separator', function() {
            window.navigator.languages = ["pt-BR"];
            Util.Localisation.setup(["pt_BR"]);
            expect(Util.Localisation.language).to.equal('pt_BR');
        });
        it('should handle difference in case', function() {
            window.navigator.languages = ["pt-br"];
            Util.Localisation.setup(["pt-BR"]);
            expect(Util.Localisation.language).to.equal('pt-BR');
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
