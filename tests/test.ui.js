import UI from '../app/ui.js';
import * as WebUtil from '../app/webutil.js';

describe('UI', function () {
    "use strict";

    describe('Ignore Keys Feature', function () {
        let originalSupportedIgnoreKeys;

        beforeEach(async function () {
            await WebUtil.initSettings();

            // Save original reference
            originalSupportedIgnoreKeys = UI.supportedIgnoreKeys;

            // Clone + remove one key (MetaLeft) for testing
            UI.supportedIgnoreKeys = UI.supportedIgnoreKeys.filter(
                k => k.label !== 'MetaLeft'
            );
        });

        afterEach(function () {
            UI.rfb = null;

            // Restore original list
            UI.supportedIgnoreKeys = originalSupportedIgnoreKeys;

            WebUtil.eraseSetting('ignore_keys');
        });

        describe('shouldIgnoreKey()', function () {
            it('returns false for removed keys', function () {
                WebUtil.setSetting('ignore_keys', 'cmd,win');

                expect(UI.shouldIgnoreKey('MetaLeft')).to.be.false;
            });

            it('still works for remaining keys', function () {
                WebUtil.setSetting('ignore_keys', 'esc,ctrl');

                expect(UI.shouldIgnoreKey('Escape')).to.be.true;
                expect(UI.shouldIgnoreKey('ControlLeft')).to.be.true;
            });
        });
    });
});
