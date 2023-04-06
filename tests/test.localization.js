const expect = chai.expect;
import _, { Localizer, l10n } from '../app/localization.js';

describe('Localization', function () {
    "use strict";

    describe('Singleton', function () {
        it('should export a singleton object', function () {
            expect(l10n).to.be.instanceOf(Localizer);
        });
        it('should export a singleton translation function', function () {
            // FIXME: Can we use some spy instead?
            l10n.dictionary = { "Foobar": "gazonk" };
            expect(_("Foobar")).to.equal("gazonk");
        });
    });

    describe('language selection', function () {
        let origNavigator;
        beforeEach(function () {
            // window.navigator is a protected read-only property in many
            // environments, so we need to redefine it whilst running these
            // tests.
            origNavigator = Object.getOwnPropertyDescriptor(window, "navigator");

            Object.defineProperty(window, "navigator", {value: {}});
            window.navigator.languages = [];
        });
        afterEach(function () {
            Object.defineProperty(window, "navigator", origNavigator);
        });

        it('should use English by default', function () {
            let lclz = new Localizer();
            expect(lclz.language).to.equal('en');
        });
        it('should use English if no user language matches', function () {
            window.navigator.languages = ["nl", "de"];
            let lclz = new Localizer();
            lclz.setup(["es", "fr"]);
            expect(lclz.language).to.equal('en');
        });
        it('should fall back to generic English for other English', function () {
            window.navigator.languages = ["en-AU", "de"];
            let lclz = new Localizer();
            lclz.setup(["de", "fr", "en-GB"]);
            expect(lclz.language).to.equal('en');
        });
        it('should prefer specific English over generic', function () {
            window.navigator.languages = ["en-GB", "de"];
            let lclz = new Localizer();
            lclz.setup(["de", "en-AU", "en-GB"]);
            expect(lclz.language).to.equal('en-GB');
        });
        it('should use the most preferred user language', function () {
            window.navigator.languages = ["nl", "de", "fr"];
            let lclz = new Localizer();
            lclz.setup(["es", "fr", "de"]);
            expect(lclz.language).to.equal('de');
        });
        it('should prefer sub-languages languages', function () {
            window.navigator.languages = ["pt-BR"];
            let lclz = new Localizer();
            lclz.setup(["pt", "pt-BR"]);
            expect(lclz.language).to.equal('pt-BR');
        });
        it('should fall back to language "parents"', function () {
            window.navigator.languages = ["pt-BR"];
            let lclz = new Localizer();
            lclz.setup(["fr", "pt", "de"]);
            expect(lclz.language).to.equal('pt');
        });
        it('should not use specific language when user asks for a generic language', function () {
            window.navigator.languages = ["pt", "de"];
            let lclz = new Localizer();
            lclz.setup(["fr", "pt-BR", "de"]);
            expect(lclz.language).to.equal('de');
        });
        it('should handle underscore as a separator', function () {
            window.navigator.languages = ["pt-BR"];
            let lclz = new Localizer();
            lclz.setup(["pt_BR"]);
            expect(lclz.language).to.equal('pt_BR');
        });
        it('should handle difference in case', function () {
            window.navigator.languages = ["pt-br"];
            let lclz = new Localizer();
            lclz.setup(["pt-BR"]);
            expect(lclz.language).to.equal('pt-BR');
        });
    });
});
