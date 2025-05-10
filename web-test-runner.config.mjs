import { defaultReporter } from '@web/test-runner';
import { summaryReporter } from '@web/test-runner';
import { webdriverLauncher } from '@web/test-runner-webdriver';

let browsers;
let launchers;

if (process.env.TEST_BROWSER_NAME) {
    browsers = process.env.TEST_BROWSER_NAME.split(',');
} else {
    browsers = ['chrome', 'firefox'];
    if (process.platform === 'win32') {
        browsers.push('edge');
    }
    if (process.platform === 'darwin') {
        browsers.push('safari');
    }
}

launchers = [];

for (let browser of browsers) {
    switch (browser) {
        case 'chrome':
            launchers.push(webdriverLauncher({
                capabilities: {
                    browserName: 'chrome',
                    'goog:chromeOptions': {
                        args: ['headless', 'disable-gpu']
                    },
                },
            }));
            break;
        case 'firefox':
            launchers.push(webdriverLauncher({
                capabilities: {
                    browserName: 'firefox',
                    'moz:firefoxOptions': {
                        args: ['-headless']
                    }
                },
            }));
            break;
        case 'edge':
            launchers.push(webdriverLauncher({
                capabilities: {
                    browserName: 'edge',
                    'ms:edgeOptions': {
                        args: ['--headless']
                    }
                },
            }));
            break;
        case 'safari':
            launchers.push(webdriverLauncher({
                capabilities: {
                    browserName: 'safari',
                },
            }));
            break;
        default:
            throw new Error('Unknown browser: ' + browser);
    }
}

export default {
    nodeResolve: true,
    files: [
        'tests/test.*.js',
    ],
    browsers: launchers,
    reporters: [
        defaultReporter(),
        summaryReporter(),
    ],
    // We have small test files, so let's kill hangs quickly
    testsFinishTimeout: 10000,
};