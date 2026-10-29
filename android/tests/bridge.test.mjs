// Headless verification of the embedded noVNC bridge.
//
// Extracts the <script type="module"> block from assets/novnc/index.html,
// swaps the real RFB engine for a recorder stub, and asserts that the pointer
// pipeline produces correct framebuffer coordinates and button masks.
//
// Run with:  node android/tests/bridge.test.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const bridgeMainPath = path.join(here, '..', 'app', 'src', 'main', 'assets', 'novnc', 'bridge-main.js');
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'novnc-bridge-'));

const rawSource = fs.readFileSync(bridgeMainPath, 'utf8');
const bridgeSource = rawSource
    .replace("from './core/rfb.js'", "from './rfb-stub.mjs'")
    .replace("from './core/input/keysym.js'", "from './keysyms-stub.mjs'");

fs.writeFileSync(path.join(workDir, 'bridge.mjs'), bridgeSource);
fs.writeFileSync(path.join(workDir, 'keysyms-stub.mjs'),
    'export default { XK_Return: 0xff0d, XK_Control_L: 0xffe3 };\n');

fs.writeFileSync(path.join(workDir, 'rfb-stub.mjs'), `
export const calls = [];

class StubRFB {
    constructor(target, url, options) {
        this.url = url;
        this.options = options;
        this._listeners = {};
        this._sock = {};
        this._rfbConnectionState = 'connected';
        this._fbName = 'Test Desktop';
        this.viewOnly = false;
        this.scaleViewport = true;
        this._display = {
            width: 1920,
            height: 1080,
            scale: 0.204545,
            _viewportLoc: { x: 0, y: 0 },
            absX(css) { return Math.round(css / this.scale); },
            absY(css) { return Math.round(css / this.scale); }
        };
        this._canvas = {
            style: {},
            getBoundingClientRect: () => ({ left: 0, top: 0, width: 392.727, height: 220.909 }),
            addEventListener() {}
        };
        StubRFB.last = this;
    }

    addEventListener(type, cb) {
        (this._listeners[type] = this._listeners[type] || []).push(cb);
    }

    fire(type, detail) {
        (this._listeners[type] || []).forEach((cb) => cb({ detail: detail || {} }));
    }

    sendKey(keysym, code, down) { calls.push({ type: 'key', keysym, code, down }); }
    sendCtrlAltDel() { calls.push({ type: 'cad' }); }
    sendCredentials(creds) { calls.push({ type: 'creds', creds }); }
    clipboardPasteFrom(text) { calls.push({ type: 'clipboard', text }); }

    disconnect() {
        this._rfbConnectionState = 'disconnected';
        this.fire('disconnect', { clean: true });
    }
}

StubRFB.messages = {
    pointerEvent(sock, x, y, mask) { calls.push({ type: 'pointer', x, y, mask }); }
};

export default StubRFB;
`);

// ---- fake DOM -----------------------------------------------------------
const element = () => ({ style: {} });
globalThis.document = {
    addEventListener() {},
    getElementById: () => element(),
};

const bridgeEvents = [];
globalThis.window = {
    devicePixelRatio: 2.75,
    innerWidth: 392.727,
    innerHeight: 872.727,
    addEventListener() {},
    AndroidBridge: {
        onConnected: (name, w, h) => bridgeEvents.push({ e: 'connected', name, w, h }),
        onDisconnected: (clean, reason) => bridgeEvents.push({ e: 'disconnected', clean, reason }),
        onPageLoaded: () => bridgeEvents.push({ e: 'page' }),
        onClipboard: (text) => bridgeEvents.push({ e: 'clipboard', text }),
        onDesktopName: (name) => bridgeEvents.push({ e: 'name', text: name }),
        onZoomChanged: (zoom) => bridgeEvents.push({ e: 'zoom', zoom }),
        log() {},
    },
};

const realLog = console.log;
console.log = () => {};

const stub = await import(pathToFileURL(path.join(workDir, 'rfb-stub.mjs')));
const StubRFB = stub.default;
const calls = stub.calls;
await import(pathToFileURL(path.join(workDir, 'bridge.mjs')));

const novnc = globalThis.window.novnc;
assert.ok(novnc, 'window.novnc must be exposed');

const pointerEvents = () => calls.filter((c) => c.type === 'pointer');
const settle = () => new Promise((r) => setTimeout(r, 450));

// --- connect -------------------------------------------------------------
novnc.connect({ rawUrl: 'wss://example.test/vnc/websockify', password: 'secret' });
const rfb = StubRFB.last;
assert.strictEqual(rfb.url, 'wss://example.test/vnc/websockify', 'full URL is passed through untouched');
assert.strictEqual(rfb.options.credentials.password, 'secret', 'password is forwarded');

rfb.fire('connect');
const connectEvt = bridgeEvents.find((e) => e.e === 'connected');
assert.deepStrictEqual(connectEvt, { e: 'connected', name: 'Test Desktop', w: 1920, h: 1080 },
    'native side receives desktop name and framebuffer size');

// --- left click ----------------------------------------------------------
calls.length = 0;
novnc.mouseClick(1, 1);
await settle();
let evts = pointerEvents();
assert.deepStrictEqual(evts.map((e) => e.mask), [0, 1, 0],
    'left click = position, press, release');
assert.strictEqual(evts[1].x, 960, 'cursor starts centred horizontally');
assert.strictEqual(evts[1].y, 540, 'cursor starts centred vertically');
assert.strictEqual(evts[0].x, evts[1].x, 'positioning move lands on the click pixel');

// --- right click ---------------------------------------------------------
calls.length = 0;
novnc.mouseClick(4, 1);
await settle();
evts = pointerEvents();
assert.ok(evts.some((e) => e.mask === 4), 'two-finger tap sends right button (mask 4)');
assert.strictEqual(evts[evts.length - 1].mask, 0, 'right button released');

// --- double click --------------------------------------------------------
calls.length = 0;
novnc.mouseClick(1, 2);
await settle();
assert.strictEqual(pointerEvents().filter((e) => e.mask === 1).length, 2,
    'double click sends two left presses');

// --- relative movement ---------------------------------------------------
novnc.setPointerAcceleration(false);
novnc.setPointerSensitivity(1.0);
calls.length = 0;
novnc.movePointerRelative(270, 135, 0);
evts = pointerEvents();
assert.strictEqual(evts.length, 1);
assert.strictEqual(evts[0].x, 960 + 480, 'physical px -> framebuffer px (x)');
assert.strictEqual(evts[0].y, 540 + 240, 'physical px -> framebuffer px (y)');
assert.strictEqual(evts[0].mask, 0, 'no buttons held while moving');

// a full-width swipe traverses the whole desktop
calls.length = 0;
novnc.movePointerRelative(1080, 0, 0);
assert.strictEqual(pointerEvents()[0].x, 1919, 'full swipe reaches the right edge');

// --- clamping ------------------------------------------------------------
calls.length = 0;
novnc.movePointerRelative(50000, 50000, 0);
evts = pointerEvents();
assert.strictEqual(evts[0].x, 1919, 'x clamped to framebuffer width');
assert.strictEqual(evts[0].y, 1079, 'y clamped to framebuffer height');

// --- drag ----------------------------------------------------------------
calls.length = 0;
novnc.movePointerRelative(-100000, -100000, 0);
novnc.mousePress(1);
novnc.movePointerRelative(50, 50, 1);
novnc.mouseRelease();
evts = pointerEvents();
assert.strictEqual(evts[evts.length - 1].mask, 0, 'drag releases the button');
assert.ok(evts.some((e) => e.mask === 1), 'drag moves with the left button held');

// --- scrolling -----------------------------------------------------------
calls.length = 0;
novnc.mouseScroll(-1);
await settle();
assert.strictEqual(pointerEvents()[0].mask, 8, 'scroll up uses wheel button 4 (mask 8)');

calls.length = 0;
novnc.mouseScroll(2);
await settle();
assert.strictEqual(pointerEvents().filter((e) => e.mask === 16).length, 2, 'two scroll-down notches');

// --- absolute pointer (direct touch) ------------------------------------
calls.length = 0;
novnc.pointerAbsolute(1, 1, 1);
evts = pointerEvents();
assert.strictEqual(evts[0].x, 1919, 'bottom-right corner maps to the last framebuffer pixel');
assert.strictEqual(evts[0].y, 1079, 'bottom-right corner y');

// --- keyboard ------------------------------------------------------------
calls.length = 0;
novnc.sendString('ls\n');
const keys = calls.filter((c) => c.type === 'key');
assert.ok(keys.some((k) => k.keysym === 0x6c), 'letters are forwarded');
assert.ok(keys.some((k) => k.keysym === 0xff0d), 'newline becomes the Return keysym');

// --- view-only guard ----------------------------------------------------
rfb.viewOnly = true;
calls.length = 0;
novnc.mouseClick(1, 1);
novnc.movePointerRelative(10, 10, 0);
await settle();
assert.strictEqual(pointerEvents().length, 0, 'view-only mode sends no pointer events');
rfb.viewOnly = false;

// --- noVNC -> native event forwarding -----------------------------------
bridgeEvents.length = 0;
rfb.fire('clipboard', { text: 'from remote' });
assert.deepStrictEqual(bridgeEvents[0], { e: 'clipboard', text: 'from remote' },
    'remote clipboard reaches the native layer');

bridgeEvents.length = 0;
rfb.fire('desktopname', { name: 'Renamed desktop' });
assert.deepStrictEqual(bridgeEvents[0], { e: 'name', text: 'Renamed desktop' },
    'desktop rename reaches the native layer');

// --- two-finger pinch-to-zoom --------------------------------------------
assert.strictEqual(novnc.getZoom(), 1.0, 'initial zoom is 1.0');
bridgeEvents.length = 0;
novnc.applyPinchZoom(1.5, 200, 400, 0, 0);
assert.ok(Math.abs(novnc.getZoom() - 1.5) < 0.01, 'zoom scaled to 1.5x');
assert.ok(bridgeEvents.some((e) => e.e === 'zoom' && Math.abs(e.zoom - 1.5) < 0.01),
    'zoom event dispatched to native bridge');

// Zoom clamps to MAX_ZOOM (5.0)
novnc.applyPinchZoom(10.0, 200, 400, 0, 0);
assert.strictEqual(novnc.getZoom(), 5.0, 'zoom clamped at MAX_ZOOM 5.0');

// Zoom reset
novnc.resetZoom();
assert.strictEqual(novnc.getZoom(), 1.0, 'resetZoom brings zoom back to 1.0');

realLog('bridge.test.mjs: all assertions passed');
