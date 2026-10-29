import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const bundlePath = path.join(here, '..', 'app', 'src', 'main', 'assets', 'novnc', 'novnc.bundle.js');
const code = fs.readFileSync(bundlePath, 'utf8');

let pageLoadedCalled = false;

globalThis.window = {
    document: {
        documentElement: {},
        getElementById: () => ({ style: {} }),
        addEventListener: () => {},
        readyState: 'complete'
    },
    navigator: { maxTouchPoints: 5, userAgent: 'Mozilla/5.0 Android' },
    devicePixelRatio: 2.75,
    innerWidth: 1080,
    innerHeight: 2400,
    isSecureContext: true,
    addEventListener: () => {},
    MutationObserver: class { observe() {} disconnect() {} },
    ResizeObserver: class { observe() {} disconnect() {} },
    AndroidBridge: {
        onPageLoaded: () => { pageLoadedCalled = true; },
        log: () => {}
    }
};
globalThis.document = window.document;
try {
    Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true, writable: true });
} catch (e) {
    Object.assign(globalThis.navigator, window.navigator);
}
globalThis.WebSocket = class {};
globalThis.MutationObserver = window.MutationObserver;
globalThis.ResizeObserver = window.ResizeObserver;

(0, eval)(code);

assert.ok(window.novnc, 'window.novnc must be defined');
assert.strictEqual(window.novnc.isReady, true, 'window.novnc.isReady must be true');
assert.strictEqual(pageLoadedCalled, true, 'AndroidBridge.onPageLoaded must be invoked upon load');

console.log('bundle.test.mjs: novnc.bundle.js verified successfully');
