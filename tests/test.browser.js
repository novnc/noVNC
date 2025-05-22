import { isMac, isWindows, isIOS, isAndroid, isChromeOS,
         isSafari, isFirefox, isChrome, isChromium, isOpera, isEdge,
         isGecko, isWebKit, isBlink } from '../core/util/browser.js';

describe('OS detection', function () {
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

    it('should handle macOS', function () {
        const platforms = [
            "MacIntel",
            "MacPPC",
        ];

        navigator.userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 12_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Safari/605.1.15";
        platforms.forEach((platform) => {
            navigator.platform = platform;
            expect(isMac()).to.be.true;
            expect(isWindows()).to.be.false;
            expect(isIOS()).to.be.false;
            expect(isAndroid()).to.be.false;
            expect(isChromeOS()).to.be.false;
        });
    });

    it('should handle Windows', function () {
        const platforms = [
            "Win32",
            "Win64",
        ];

        navigator.userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/106.0.0.0 Safari/537.36";
        platforms.forEach((platform) => {
            navigator.platform = platform;
            expect(isMac()).to.be.false;
            expect(isWindows()).to.be.true;
            expect(isIOS()).to.be.false;
            expect(isAndroid()).to.be.false;
            expect(isChromeOS()).to.be.false;
        });
    });

    it('should handle iOS', function () {
        const platforms = [
            "iPhone",
            "iPod",
            "iPad",
        ];

        navigator.userAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.1 Mobile/15E148 Safari/604.1";
        platforms.forEach((platform) => {
            navigator.platform = platform;
            expect(isMac()).to.be.false;
            expect(isWindows()).to.be.false;
            expect(isIOS()).to.be.true;
            expect(isAndroid()).to.be.false;
            expect(isChromeOS()).to.be.false;
        });
    });

    it('should handle Android', function () {
        let userAgents = [
            "Mozilla/5.0 (Linux; Android 13; SM-G960U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.5359.128 Mobile Safari/537.36",
            "Mozilla/5.0 (Android 13; Mobile; LG-M255; rv:108.0) Gecko/108.0 Firefox/108.0",
        ];

        navigator.platform = "Linux x86_64";
        userAgents.forEach((ua) => {
            navigator.userAgent = ua;
            expect(isMac()).to.be.false;
            expect(isWindows()).to.be.false;
            expect(isIOS()).to.be.false;
            expect(isAndroid()).to.be.true;
            expect(isChromeOS()).to.be.false;
        });
    });

    it('should handle ChromeOS', function () {
        let userAgents = [
            "Mozilla/5.0 (X11; CrOS x86_64 15183.59.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.5359.75 Safari/537.36",
            "Mozilla/5.0 (X11; CrOS aarch64 15183.59.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.5359.75 Safari/537.36",
        ];

        navigator.platform = "Linux x86_64";
        userAgents.forEach((ua) => {
            navigator.userAgent = ua;
            expect(isMac()).to.be.false;
            expect(isWindows()).to.be.false;
            expect(isIOS()).to.be.false;
            expect(isAndroid()).to.be.false;
            expect(isChromeOS()).to.be.true;
        });
    });
});

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
        expect(isChrome()).to.be.true;
        expect(isChromium()).to.be.false;
        expect(isOpera()).to.be.false;
        expect(isEdge()).to.be.false;

        expect(isGecko()).to.be.false;
        expect(isWebKit()).to.be.false;
        expect(isBlink()).to.be.true;
    });

    it('should handle Chromium', function () {
        navigator.userAgent = "Mozilla/5.0 (X11; Linux armv7l) AppleWebKit/537.36 (KHTML, like Gecko) Raspbian Chromium/74.0.3729.157 Chrome/74.0.3729.157 Safari/537.36";

        expect(isSafari()).to.be.false;
        expect(isFirefox()).to.be.false;
        expect(isChrome()).to.be.false;
        expect(isChromium()).to.be.true;
        expect(isOpera()).to.be.false;
        expect(isEdge()).to.be.false;

        expect(isGecko()).to.be.false;
        expect(isWebKit()).to.be.false;
        expect(isBlink()).to.be.true;
    });

    it('should handle Firefox', function () {
        navigator.userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:105.0) Gecko/20100101 Firefox/105.0";

        expect(isSafari()).to.be.false;
        expect(isFirefox()).to.be.true;
        expect(isChrome()).to.be.false;
        expect(isChromium()).to.be.false;
        expect(isOpera()).to.be.false;
        expect(isEdge()).to.be.false;

        expect(isGecko()).to.be.true;
        expect(isWebKit()).to.be.false;
        expect(isBlink()).to.be.false;
    });

    it('should handle Seamonkey', function () {
        navigator.userAgent = "Mozilla/5.0 (Windows NT 6.1; rv:36.0) Gecko/20100101 Firefox/36.0 Seamonkey/2.33.1";

        expect(isSafari()).to.be.false;
        expect(isFirefox()).to.be.false;
        expect(isChrome()).to.be.false;
        expect(isChromium()).to.be.false;
        expect(isOpera()).to.be.false;
        expect(isEdge()).to.be.false;

        expect(isGecko()).to.be.true;
        expect(isWebKit()).to.be.false;
        expect(isBlink()).to.be.false;
    });

    it('should handle Safari', function () {
        navigator.userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 12_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Safari/605.1.15";

        expect(isSafari()).to.be.true;
        expect(isFirefox()).to.be.false;
        expect(isChrome()).to.be.false;
        expect(isChromium()).to.be.false;
        expect(isOpera()).to.be.false;
        expect(isEdge()).to.be.false;

        expect(isGecko()).to.be.false;
        expect(isWebKit()).to.be.true;
        expect(isBlink()).to.be.false;
    });

    it('should handle Edge', function () {
        navigator.userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/106.0.0.0 Safari/537.36 Edg/106.0.1370.34";

        expect(isSafari()).to.be.false;
        expect(isFirefox()).to.be.false;
        expect(isChrome()).to.be.false;
        expect(isChromium()).to.be.false;
        expect(isOpera()).to.be.false;
        expect(isEdge()).to.be.true;

        expect(isGecko()).to.be.false;
        expect(isWebKit()).to.be.false;
        expect(isBlink()).to.be.true;
    });

    it('should handle Opera', function () {
        navigator.userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/106.0.0.0 Safari/537.36 OPR/91.0.4516.20";

        expect(isSafari()).to.be.false;
        expect(isFirefox()).to.be.false;
        expect(isChrome()).to.be.false;
        expect(isChromium()).to.be.false;
        expect(isOpera()).to.be.true;
        expect(isEdge()).to.be.false;

        expect(isGecko()).to.be.false;
        expect(isWebKit()).to.be.false;
        expect(isBlink()).to.be.true;
    });

    it('should handle Epiphany', function () {
        navigator.userAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/11.0 Safari/605.1.15 Epiphany/605.1.15";

        expect(isSafari()).to.be.false;
        expect(isFirefox()).to.be.false;
        expect(isChrome()).to.be.false;
        expect(isChromium()).to.be.false;
        expect(isOpera()).to.be.false;
        expect(isEdge()).to.be.false;

        expect(isGecko()).to.be.false;
        expect(isWebKit()).to.be.true;
        expect(isBlink()).to.be.false;
    });
});
