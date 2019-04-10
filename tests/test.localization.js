const expect = chai.expect;
import { l10n } from '../app/localization.js';

describe('Localization', function () {
    "use strict";

    describe('language selection', function () {
        let origNavigator;
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

        it('should use English by default', function () {
            expect(l10n.language).to.equal('en');
        });
    });
});
