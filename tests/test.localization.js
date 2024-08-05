import _, { Localizer, l10n } from '../app/localization.js';

describe('Localization', function () {
    "use strict";

    let origNavigator;
    let fetch;

    beforeEach(function () {
        // window.navigator is a protected read-only property in many
        // environments, so we need to redefine it whilst running these
        // tests.
        origNavigator = Object.getOwnPropertyDescriptor(window, "navigator");

        Object.defineProperty(window, "navigator", {value: {}});
        window.navigator.languages = [];

        fetch = sinon.stub(window, "fetch");
        fetch.resolves(new Response("{}"));
    });
    afterEach(function () {
        fetch.restore();

        Object.defineProperty(window, "navigator", origNavigator);
    });

    describe('Singleton', function () {
        it('should export a singleton object', function () {
            expect(l10n).to.be.instanceOf(Localizer);
        });
        it('should export a singleton translation function', async function () {
            // FIXME: Can we use some spy instead?
            window.navigator.languages = ["de"];
            fetch.resolves(new Response(JSON.stringify({ "Foobar": "gazonk" })));
            await l10n.setup(["de"]);
            expect(_("Foobar")).to.equal("gazonk");
        });
    });

    describe('language selection', function () {
        it('should use English by default', function () {
            let lclz = new Localizer();
            expect(lclz.language).to.equal('en');
        });
        it('should use English if no user language matches', async function () {
            window.navigator.languages = ["nl", "de"];
            let lclz = new Localizer();
            await lclz.setup(["es", "fr"]);
            expect(lclz.language).to.equal('en');
        });
        it('should fall back to generic English for other English', async function () {
            window.navigator.languages = ["en-AU", "de"];
            let lclz = new Localizer();
            await lclz.setup(["de", "fr", "en-GB"]);
            expect(lclz.language).to.equal('en');
        });
        it('should prefer specific English over generic', async function () {
            window.navigator.languages = ["en-GB", "de"];
            let lclz = new Localizer();
            await lclz.setup(["de", "en-AU", "en-GB"]);
            expect(lclz.language).to.equal('en-GB');
        });
        it('should use the most preferred user language', async function () {
            window.navigator.languages = ["nl", "de", "fr"];
            let lclz = new Localizer();
            await lclz.setup(["es", "fr", "de"]);
            expect(lclz.language).to.equal('de');
        });
        it('should prefer sub-languages languages', async function () {
            window.navigator.languages = ["pt-BR"];
            let lclz = new Localizer();
            await lclz.setup(["pt", "pt-BR"]);
            expect(lclz.language).to.equal('pt-BR');
        });
        it('should fall back to language "parents"', async function () {
            window.navigator.languages = ["pt-BR"];
            let lclz = new Localizer();
            await lclz.setup(["fr", "pt", "de"]);
            expect(lclz.language).to.equal('pt');
        });
        it('should not use specific language when user asks for a generic language', async function () {
            window.navigator.languages = ["pt", "de"];
            let lclz = new Localizer();
            await lclz.setup(["fr", "pt-BR", "de"]);
            expect(lclz.language).to.equal('de');
        });
        it('should handle underscore as a separator', async function () {
            window.navigator.languages = ["pt-BR"];
            let lclz = new Localizer();
            await lclz.setup(["pt_BR"]);
            expect(lclz.language).to.equal('pt_BR');
        });
        it('should handle difference in case', async function () {
            window.navigator.languages = ["pt-br"];
            let lclz = new Localizer();
            await lclz.setup(["pt-BR"]);
            expect(lclz.language).to.equal('pt-BR');
        });
    });

    describe('Translation loading', function () {
        it('should not fetch a translation for English', async function () {
            window.navigator.languages = [];
            let lclz = new Localizer();
            await lclz.setup([]);
            expect(fetch).to.not.have.been.called;
        });
        it('should fetch dictionary relative base URL', async function () {
            window.navigator.languages = ["de", "fr"];
            fetch.resolves(new Response('{ "Foobar": "gazonk" }'));
            let lclz = new Localizer();
            await lclz.setup(["ru", "fr"], "/some/path/");
            expect(fetch).to.have.been.calledOnceWith("/some/path/fr.json");
            expect(lclz.get("Foobar")).to.equal("gazonk");
        });
        it('should handle base URL without trailing slash', async function () {
            window.navigator.languages = ["de", "fr"];
            fetch.resolves(new Response('{ "Foobar": "gazonk" }'));
            let lclz = new Localizer();
            await lclz.setup(["ru", "fr"], "/some/path");
            expect(fetch).to.have.been.calledOnceWith("/some/path/fr.json");
            expect(lclz.get("Foobar")).to.equal("gazonk");
        });
        it('should handle current base URL', async function () {
            window.navigator.languages = ["de", "fr"];
            fetch.resolves(new Response('{ "Foobar": "gazonk" }'));
            let lclz = new Localizer();
            await lclz.setup(["ru", "fr"]);
            expect(fetch).to.have.been.calledOnceWith("fr.json");
            expect(lclz.get("Foobar")).to.equal("gazonk");
        });
        it('should fail if dictionary cannot be found', async function () {
            window.navigator.languages = ["de", "fr"];
            fetch.resolves(new Response('{}', { status: 404 }));
            let lclz = new Localizer();
            let ok = false;
            try {
                await lclz.setup(["ru", "fr"], "/some/path/");
            } catch (e) {
                ok = true;
            }
            expect(ok).to.be.true;
        });
    });
});
