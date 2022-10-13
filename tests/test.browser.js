/* eslint-disable no-console */
const expect = chai.expect;

import { isSafari, isFirefox } from '../core/util/browser.js';

describe('Browser detection', function () {
    let origNavigator;
    beforeEach(function () {
        // window.navigator is a protected read-only property in many
        // environments, so we need to redefine it whilst running these
        // tests.
        origNavigator = Object.getOwnPropertyDescriptor(window, "navigator");

        Object.defineProperty(window, "navigator", {value: {}});
    });

    afterEach(function () {
        Object.defineProperty(window, "navigator", origNavigator);
    });

    it('should handle Chrome', function () {
        navigator.userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/106.0.0.0 Safari/537.36";

        expect(isSafari()).to.be.false;
        expect(isFirefox()).to.be.false;
    });

    it('should handle Chromium', function () {
        navigator.userAgent = "Mozilla/5.0 (X11; Linux armv7l) AppleWebKit/537.36 (KHTML, like Gecko) Raspbian Chromium/74.0.3729.157 Chrome/74.0.3729.157 Safari/537.36";

        expect(isSafari()).to.be.false;
        expect(isFirefox()).to.be.false;
    });

    it('should handle Firefox', function () {
        navigator.userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:105.0) Gecko/20100101 Firefox/105.0";

        expect(isSafari()).to.be.false;
        expect(isFirefox()).to.be.true;
    });

    it('should handle Edge', function () {
        navigator.userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/106.0.0.0 Safari/537.36 Edg/106.0.1370.34";

        expect(isSafari()).to.be.false;
        expect(isFirefox()).to.be.false;
    });

    it('should handle Opera', function () {
        navigator.userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/106.0.0.0 Safari/537.36 OPR/91.0.4516.20";

        expect(isSafari()).to.be.false;
        expect(isFirefox()).to.be.false;
    });
});
