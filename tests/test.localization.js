const expect = chai.expect;
import { l10n } from '../app/localization.js';

describe('Localization', function() {
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
});
