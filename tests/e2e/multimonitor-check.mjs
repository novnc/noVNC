#!/usr/bin/env node
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(HERE, '..', '..');

const USAGE = `Usage: node tests/e2e/multimonitor-check.mjs [options]

Drives a headless Chrome against a local Kasm Workspaces session that runs the
KasmVNC dev core image, and checks the multi monitor popup end to end.

Steps: log in, open the session, add a monitor (popup), start two test videos,
measure image and streaming mode at 24 and 60 fps on both displays, run the
relay security checks, check relinking after reloads, and save every console,
network and server log to the output directory.

Options:
  --session <id>     Workspaces session id (default: found from the adminkasm.lo_* container)
  --container <name> Docker container of the session (default: adminkasm.lo_<session>)
  --out <dir>        Output directory (default: tests/e2e/results/<timestamp>)
  --worker <file>    Relay worker asset name (default: newest dist/assets/port-relay-worker-*.js)
  --chrome <path>    Chrome binary (default: /opt/google/chrome/chrome)
  --launch           Start a new session through the dashboard when none is running
  --deploy           Copy dist/ into the session container first (the redeploy step)
  --workspace <name> Workspace to launch (default: KasmVNC dev core)
  --deadline <min>   Abort the whole run after this many minutes (default: 20)
  --seconds <n>      Seconds per performance reading (default: 10)
  --runs <n>         Readings per streaming configuration (default: 3)
  --skip-perf        Skip the performance matrix
  --skip-security    Skip the relay security checks
  --skip-relink      Skip the reload and relink checks
  --frames           Track every decoded VideoFrame in the primary and report frames that were never closed
  --help             Show this text

Environment:
  KASM_URL   Base url (default https://localhost)
  KASM_USER  Login (default admin@kasm.local, the local test deployment)
  KASM_PASS  Password (default password, the local test deployment)

Exit status: 0 all checks passed, 1 a check failed, 2 the run could not complete.
`;

function parseArgs(argv) {
    const opts = { seconds: 10, runs: 3, deadline: 20, chrome: '/opt/google/chrome/chrome', workspace: 'KasmVNC dev core' };
    const flags = new Set(['--skip-perf', '--skip-security', '--skip-relink', '--launch', '--deploy', '--frames', '--help']);
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (flags.has(arg)) {
            opts[arg.slice(2).replace(/-([a-z])/g, (m, c) => c.toUpperCase())] = true;
        } else if (['--session', '--container', '--out', '--worker', '--chrome', '--seconds', '--runs', '--workspace', '--deadline'].includes(arg)) {
            opts[arg.slice(2)] = argv[++i];
        } else {
            throw new Error('Unknown option: ' + arg);
        }
    }
    opts.seconds = Number(opts.seconds);
    opts.runs = Number(opts.runs);
    opts.deadline = Number(opts.deadline);
    if (!Number.isFinite(opts.deadline) || opts.deadline < 1 || opts.deadline > 120) { throw new Error('--deadline must be 1..120'); }
    if (!Number.isInteger(opts.seconds) || opts.seconds < 3 || opts.seconds > 60) { throw new Error('--seconds must be 3..60'); }
    if (!Number.isInteger(opts.runs) || opts.runs < 1 || opts.runs > 10) { throw new Error('--runs must be 1..10'); }
    return opts;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function poll(fn, { timeout = 30000, interval = 250, label = 'condition' } = {}) {
    const end = Date.now() + timeout;
    let last;
    while (Date.now() < end) {
        try {
            last = await fn();
            if (last) { return last; }
        } catch (err) {
            last = err;
        }
        await sleep(interval);
    }
    throw new Error('Timed out waiting for ' + label + (last instanceof Error ? ': ' + last.message : ''));
}

function redact(text) {
    return String(text)
        .replace(/#[0-9a-f]{32}\b/gi, '#<token>')
        .replace(/\b[0-9a-f]{32}\b/gi, '<token>')
        .replace(/(session_token=)[^;\s"]+/gi, '$1<redacted>')
        .replace(/(token["']?\s*[:=]\s*["']?)[A-Za-z0-9._-]{40,}/gi, '$1<redacted>')
        .replace(/([?&](?:token|password|key)=)[^&\s"]*/gi, '$1<redacted>');
}

class Cdp {
    constructor(ws) {
        this.ws = ws;
        this.nextId = 0;
        this.pending = new Map();
        this.listeners = [];
        ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            if (msg.id !== undefined) {
                const waiter = this.pending.get(msg.id);
                if (!waiter) { return; }
                this.pending.delete(msg.id);
                if (msg.error) {
                    waiter.reject(new Error(waiter.method + ': ' + msg.error.message));
                } else {
                    waiter.resolve(msg.result);
                }
            } else {
                for (const fn of this.listeners) { fn(msg); }
            }
        };
        ws.onclose = () => {
            for (const waiter of this.pending.values()) { waiter.reject(new Error('connection closed')); }
            this.pending.clear();
        };
    }

    send(method, params = {}, sessionId, timeoutMs = 90000) {
        return new Promise((resolve, reject) => {
            const id = ++this.nextId;
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(method + ' timed out after ' + Math.round(timeoutMs / 1000) + ' s'));
            }, timeoutMs);
            this.pending.set(id, {
                method,
                resolve: (value) => { clearTimeout(timer); resolve(value); },
                reject: (err) => { clearTimeout(timer); reject(err); },
            });
            this.ws.send(JSON.stringify({ id, method, params, sessionId }));
        });
    }

    on(fn) {
        this.listeners.push(fn);
    }
}

class Recorder {
    constructor(dir) {
        this.dir = dir;
        mkdirSync(dir, { recursive: true });
        this.started = Date.now();
    }

    line(file, text) {
        const stamp = ((Date.now() - this.started) / 1000).toFixed(1).padStart(7);
        appendFileSync(join(this.dir, file), stamp + 's ' + redact(text) + '\n');
    }

    info(text) {
        console.log(redact(text));
        this.line('run.log', text);
    }
}

class Tab {
    constructor(cdp, sessionId, targetId, rec) {
        this.cdp = cdp;
        this.sessionId = sessionId;
        this.targetId = targetId;
        this.rec = rec;
        this.label = 'tab';
        this.contexts = new Map();
        this.mainFrame = null;
    }

    async init() {
        for (const domain of ['Page', 'Runtime', 'Log', 'Network']) {
            await this.cdp.send(domain + '.enable', {}, this.sessionId);
        }
        await this.cdp.send('Runtime.runIfWaitingForDebugger', {}, this.sessionId).catch(() => {});
        const tree = await this.cdp.send('Page.getFrameTree', {}, this.sessionId);
        this.mainFrame = tree.frameTree.frame.id;
    }

    handle(msg) {
        const p = msg.params;
        switch (msg.method) {
            case 'Runtime.executionContextCreated':
                this.contexts.set(p.context.id, p.context);
                break;
            case 'Runtime.executionContextDestroyed':
                this.contexts.delete(p.executionContextId);
                break;
            case 'Runtime.executionContextsCleared':
                this.contexts.clear();
                break;
            case 'Page.javascriptDialogOpening':
                this.rec.line('console-' + this.label + '.log', '[dialog ' + p.type + '] accepted: ' + String(p.message).slice(0, 120));
                this.cdp.send('Page.handleJavaScriptDialog', { accept: true }, this.sessionId).catch(() => {});
                break;
            case 'Runtime.consoleAPICalled':
                this.rec.line('console-' + this.label + '.log', '[' + p.type + '] ' +
                    p.args.map(a => a.value !== undefined ? String(a.value) : (a.description || a.type)).join(' '));
                break;
            case 'Runtime.exceptionThrown':
                this.rec.line('console-' + this.label + '.log', '[exception] ' +
                    (p.exceptionDetails.exception && p.exceptionDetails.exception.description || p.exceptionDetails.text));
                break;
            case 'Log.entryAdded':
                this.rec.line('console-' + this.label + '.log', '[' + p.entry.level + ' ' + p.entry.source + '] ' + p.entry.text +
                    (p.entry.url ? ' (' + p.entry.url.split('?')[0] + ')' : ''));
                break;
            case 'Network.responseReceived':
                if (p.response.status >= 400) {
                    this.rec.line('network-' + this.label + '.log', p.response.status + ' ' + p.response.url.split('?')[0]);
                }
                break;
            case 'Network.loadingFailed':
                this.rec.line('network-' + this.label + '.log', 'failed ' + (p.errorText || '') + ' ' + (p.canceled ? '(canceled)' : ''));
                break;
            default:
                break;
        }
    }

    async evaluate(expression, { context, userGesture = false, timeout = 90000 } = {}) {
        const result = await this.cdp.send('Runtime.evaluate', {
            expression, contextId: context, awaitPromise: true, returnByValue: true, userGesture,
        }, this.sessionId, timeout);
        if (result.exceptionDetails) {
            const d = result.exceptionDetails;
            throw new Error('evaluate failed: ' + (d.exception && d.exception.description || d.text));
        }
        return result.result.value;
    }

    iframeContext() {
        for (const [id, ctx] of this.contexts) {
            const aux = ctx.auxData || {};
            if (aux.isDefault && aux.frameId !== this.mainFrame && ctx.origin.startsWith('http')) {
                return id;
            }
        }
        return null;
    }

    async navigate(url) {
        await this.cdp.send('Page.navigate', { url }, this.sessionId);
    }

    async reload() {
        const before = [...this.contexts.keys()];
        await this.cdp.send('Page.reload', { ignoreCache: true }, this.sessionId);
        await poll(() => before.every(id => !this.contexts.has(id)), { timeout: 30000, label: 'the page to unload' });
    }
}

const FIND_SETTINGS = `
const setting = (id, value) => {
    const e = document.getElementById(id);
    if (!e) { throw new Error('missing setting ' + id); }
    e.value = value;
    e.dispatchEvent(new Event('input', { bubbles: true }));
    e.dispatchEvent(new Event('change', { bubbles: true }));
    return e.value;
};`;

function applySettingsExpr(cfg) {
    return `(async () => { ${FIND_SETTINGS}
        const r = {
            mode: setting('noVNC_setting_stream_mode', ${JSON.stringify(cfg.mode)}),
            quality: setting('noVNC_setting_video_quality', '10'),
            imageFps: setting('noVNC_setting_framerate_image_mode', ${JSON.stringify(String(cfg.fps))}),
            streamFps: setting('noVNC_setting_framerate_streaming_mode', ${JSON.stringify(String(cfg.fps))}),
        };
        await new Promise(r => setTimeout(r, 9000));
        return r; })()`;
}

function streamingExpr(seconds, runs) {
    return `(async () => { const out = []; for (let k = 0; k < ${runs}; k++) {
        const c = { n: 0 }; const orig = VideoDecoder.prototype.decode;
        VideoDecoder.prototype.decode = function () { c.n++; return orig.apply(this, arguments); };
        const t = performance.now(); await new Promise(r => setTimeout(r, ${seconds * 1000}));
        VideoDecoder.prototype.decode = orig;
        out.push(+(c.n / ((performance.now() - t) / 1000)).toFixed(1)); }
        return out; })()`;
}

function imageExpr(seconds) {
    return `(async () => { const c = { put: 0, px: 0 }; const ts = [];
        const orig = CanvasRenderingContext2D.prototype.putImageData;
        CanvasRenderingContext2D.prototype.putImageData = function (img) { c.put++; c.px += img.width * img.height; ts.push(performance.now()); return orig.apply(this, arguments); };
        const t = performance.now(); await new Promise(r => setTimeout(r, ${seconds * 1000}));
        CanvasRenderingContext2D.prototype.putImageData = orig;
        const s = (performance.now() - t) / 1000; let bursts = 0;
        for (let i = 0; i < ts.length; i++) { if (i === 0 || ts[i] - ts[i - 1] > 8) { bursts++; } }
        return { mpxPerSec: +(c.px / s / 1e6).toFixed(2), burstsPerSec: +(bursts / s).toFixed(1) }; })()`;
}

const FRAME_TRACKER_INSTALL = `(() => {
    if (window.__vf) { return 'already installed'; }
    const st = window.__vf = { created: 0, closed: 0, open: new Map(), base: { created: 0, closed: 0 } };
    const Orig = window.VideoDecoder;
    window.VideoDecoder = class extends Orig {
        constructor(init) {
            super({ ...init, output: (frame) => {
                const id = ++st.created;
                st.open.set(id, performance.now());
                const close = frame.close.bind(frame);
                frame.close = () => { if (st.open.delete(id)) { st.closed++; } return close(); };
                return init.output(frame);
            } });
        }
    };
    return 'installed'; })()`;

const FRAME_TRACKER_REPORT = `(() => {
    const st = window.__vf;
    if (!st) { return null; }
    const now = performance.now();
    const stale = [...st.open.values()].filter(t => now - t > 3000).length;
    const out = { created: st.created - st.base.created, closed: st.closed - st.base.closed, openNow: st.open.size, openOver3s: stale };
    st.base = { created: st.created, closed: st.closed };
    return out; })()`;

const DRAW_PROBE = `(async () => { const c = { n: 0 };
    const put = CanvasRenderingContext2D.prototype.putImageData;
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.putImageData = function () { c.n++; return put.apply(this, arguments); };
    CanvasRenderingContext2D.prototype.drawImage = function () { c.n++; return draw.apply(this, arguments); };
    await new Promise(r => setTimeout(r, 4000));
    CanvasRenderingContext2D.prototype.putImageData = put;
    CanvasRenderingContext2D.prototype.drawImage = draw;
    return c.n; })()`;

function attackExpr(workerUrl) {
    return `(async () => {
        const f = window;
        const base = ${JSON.stringify(workerUrl)};
        const key = Object.keys(f.sessionStorage).find(k => k.startsWith('kasm_relay'));
        if (!key) { return { error: 'no relay rooms stored' }; }
        const rec = JSON.parse(f.sessionStorage.getItem(key))[0];
        const live = rec.token;
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        const hex = n => n.toString(16).padStart(32, '0');
        const rnd = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
        const mk = () => { const w = new SharedWorker(base, { type: 'module' }); const o = { port: w.port, log: [] };
            w.port.onmessage = e => o.log.push({ d: e.data, n: e.ports.length }); w.port.start(); return o; };
        const tally = log => { const r = {}; for (const m of log) {
            const x = m.d.type + ':' + (m.d.reason || '') + (m.n ? '(+ports)' : ''); r[x] = (r[x] || 0) + 1; } return r; };
        const A = mk(), B = mk(), res = { rooms: JSON.parse(f.sessionStorage.getItem(key)).length };
        A.port.postMessage({ type: 'register', token: rnd() });
        A.port.postMessage({ type: 'register', token: rnd(), ownerKey: rnd(), replaces: live });
        await sleep(300);
        res.registerAbuse = tally(A.log);
        for (let i = 0; i < 2048; i++) { B.port.postMessage({ type: 'claim', token: hex(i) }); }
        for (let i = 0; i < 2000; i++) { B.port.postMessage({ type: 'claim', token: rnd() }); }
        await sleep(800);
        res.guessedClaims = tally(B.log); B.log.length = 0;
        B.port.postMessage({ type: 'resume', token: live });
        B.port.postMessage({ type: 'resume', token: live, ownerKey: rnd() });
        B.port.postMessage({ type: 'resume', token: live, ownerKey: rec.ownerKey });
        B.port.postMessage({ type: 'offer', token: live, claim: 1 },
            [new MessageChannel().port2, new MessageChannel().port2, new MessageChannel().port2]);
        B.port.postMessage({ type: 'unregister', token: live });
        await sleep(400);
        res.takeoverAttempts = tally(B.log); B.log.length = 0;
        B.port.postMessage({ type: 'claim', token: live });
        await sleep(5000);
        res.leakedTokenClaim = tally(B.log);
        return res; })()`;
}

function sh(cmd, args, opts = {}) {
    return execFileSync(cmd, args, { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

function findContainer(opts) {
    if (opts.container) { return opts.container; }
    if (opts.session) { return 'adminkasm.lo_' + opts.session.split('-')[0]; }
    const names = sh('docker', ['ps', '--format', '{{.Names}}']).split('\n').filter(n => /^adminkasm\.lo_[0-9a-f]{8}$/.test(n));
    if (names.length !== 1) { throw new Error('Expected exactly one adminkasm.lo_* container, found ' + names.length + '; use --container and --session'); }
    return names[0];
}

function findSessionId(container, opts) {
    if (opts.session) { return opts.session; }
    const short = container.replace('adminkasm.lo_', '');
    const out = sh('docker', ['inspect', '--format', '{{range .Config.Env}}{{println .}}{{end}}', container]);
    const match = out.match(/KASM_ID=([0-9a-f-]{36})/);
    if (match) { return match[1]; }
    throw new Error('Could not find the full session id for ' + short + '; use --session');
}

function findWorker(opts) {
    if (opts.worker) { return opts.worker; }
    const dir = join(WEB_ROOT, 'dist', 'assets');
    const files = existsSync(dir) ? readdirSync(dir).filter(f => /^port-relay-worker-.*\.js$/.test(f)) : [];
    if (files.length === 0) { throw new Error('No dist/assets/port-relay-worker-*.js; build first or use --worker'); }
    return files.sort()[files.length - 1];
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) { console.log(USAGE); return 0; }

    const BASE = (process.env.KASM_URL || 'https://localhost').replace(/\/$/, '');
    const USER = process.env.KASM_USER || 'admin@kasm.local';
    const PASS = process.env.KASM_PASS || 'password';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outDir = resolve(opts.out || join(HERE, 'results', stamp));
    const rec = new Recorder(outDir);
    const results = { startedAt: new Date().toISOString(), checks: [], perf: {}, security: {}, relink: {} };
    const check = (name, ok, detail) => {
        results.checks.push({ name, ok, detail });
        rec.info((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' - ' + detail : ''));
    };

    let container = null;
    let sessionId = null;
    let launched = false;
    try {
        container = findContainer(opts);
        sessionId = findSessionId(container, opts);
    } catch (err) {
        if (!opts.launch) { throw err; }
        rec.info('no running session found, one will be launched');
    }
    const workerFile = findWorker(opts);
    rec.info(`worker ${workerFile}`);
    rec.info(`output ${outDir}`);
    const deadline = setTimeout(() => {
        rec.info('ERROR the run exceeded its ' + opts.deadline + ' minute deadline');
        cleanup();
        process.exit(2);
    }, opts.deadline * 60000);
    deadline.unref();

    const profile = mkdtempSync(join(tmpdir(), 'kasm-e2e-'));
    let chrome = null;
    let cdp = null;
    const tabs = new Map();
    let exitCode = 0;

    const cleanup = () => {
        for (const name of ['ffplay']) {
            try {
                sh('docker', ['exec', container, 'sh', '-c', 'for p in /proc/[0-9]*; do c=$(tr "\\0" " " < $p/cmdline 2>/dev/null); case "$c" in "' + name + ' "*) kill ${p#/proc/};; esac; done']);
            } catch (err) { /* container may be gone */ }
        }
        try { if (cdp) { cdp.ws.close(); } } catch (err) { /* already closed */ }
        if (chrome) { chrome.kill('SIGTERM'); }
        try { rmSync(profile, { recursive: true, force: true }); } catch (err) { /* best effort */ }
    };
    process.on('SIGINT', () => { cleanup(); process.exit(2); });

    try {
        chrome = spawn(opts.chrome, [
            '--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-sandbox',
            '--ignore-certificate-errors', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
            '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling',
            '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
            '--window-size=1878,900', 'about:blank',
        ], { stdio: 'ignore' });
        chrome.on('exit', (code) => rec.line('run.log', 'chrome exited ' + code));

        const portFile = join(profile, 'DevToolsActivePort');
        const [port, path] = await poll(() => existsSync(portFile) && readFileSync(portFile, 'utf8').trim().split('\n'),
            { timeout: 20000, label: 'Chrome devtools port' });
        const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
        await new Promise((resolveOpen, rejectOpen) => { ws.onopen = resolveOpen; ws.onerror = () => rejectOpen(new Error('devtools connection failed')); });
        cdp = new Cdp(ws);

        const version = await cdp.send('Browser.getVersion');
        rec.info('browser ' + version.product);

        const popupWaiters = [];
        cdp.on((msg) => {
            if (msg.method === 'Target.attachedToTarget' && msg.params.targetInfo.type === 'page') {
                const tab = new Tab(cdp, msg.params.sessionId, msg.params.targetInfo.targetId, rec);
                tab.label = 'tab' + (tabs.size + 1);
                tabs.set(msg.params.sessionId, tab);
                tab.ready = tab.init().catch(err => rec.line('run.log', 'tab init failed: ' + err.message));
                for (const w of popupWaiters.splice(0)) { w(tab); }
            } else if (msg.sessionId && tabs.has(msg.sessionId)) {
                tabs.get(msg.sessionId).handle(msg);
            }
        });
        await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });

        const created = await cdp.send('Target.createTarget', { url: 'about:blank' });
        const primary = await poll(() => [...tabs.values()].find(t => t.targetId === created.targetId), { label: 'primary tab' });
        primary.label = 'primary';
        await primary.ready;
        const win = await cdp.send('Browser.getWindowForTarget', { targetId: primary.targetId });
        await cdp.send('Browser.setWindowBounds', { windowId: win.windowId, bounds: { width: 1878, height: 900 } }).catch(() => {});

        rec.info('logging in as ' + USER);
        await primary.navigate(BASE + '/#/login');
        await poll(() => primary.evaluate(`document.querySelectorAll('form input').length >= 2`), { label: 'login form' });
        await primary.evaluate(`(() => { const [u, p] = document.querySelectorAll('form input');
            const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
                d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
            set(u, ${JSON.stringify(USER)}); set(p, ${JSON.stringify(PASS)});
            [...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Login').click(); })()`, { userGesture: true });
        await poll(() => primary.evaluate(`/dashboard|userdashboard/.test(location.hash)`), { timeout: 30000, label: 'login to finish' });
        check('login', true);

        if (!sessionId) {
            rec.info('launching ' + opts.workspace);
            await primary.navigate(BASE + '/#/userdashboard');
            await poll(() => primary.evaluate(`[...document.querySelectorAll('button')].some(b => b.innerText.trim() === ${JSON.stringify(opts.workspace)})`),
                { timeout: 30000, label: 'the workspace on the dashboard' });
            await primary.evaluate(`[...document.querySelectorAll('button')].find(b => b.innerText.trim() === ${JSON.stringify(opts.workspace)}).click()`, { userGesture: true });
            await sleep(800);
            await primary.evaluate(`[...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Launch Session').click()`, { userGesture: true });
            const hash = await poll(() => primary.evaluate(`(location.hash.match(new RegExp('/session/([0-9a-f-]{36})')) || [])[1] || false`),
                { timeout: 120000, label: 'the session to start' });
            sessionId = hash;
            container = 'adminkasm.lo_' + sessionId.split('-')[0];
            await poll(() => sh('docker', ['ps', '--filter', 'name=' + container, '--format', '{{.Names}}']).includes(container),
                { timeout: 60000, label: 'the session container' });
            check('session launched', true);
            launched = true;
        }
        if (!/^[0-9a-f-]{36}$/.test(sessionId)) { throw new Error('bad session id'); }
        const workerUrl = `${BASE}/desktop/${sessionId}/vnc/assets/${workerFile}`;
        rec.info(`session ${sessionId.slice(0, 8)}... container ${container}`);

        if (opts.deploy) {
            const dist = join(WEB_ROOT, 'dist');
            if (!existsSync(join(dist, 'index.html'))) { throw new Error('dist/ is missing, build first'); }
            sh('docker', ['cp', dist + '/.', container + ':/usr/share/kasmvnc/www/']);
            check('frontend deployed to the session', true, container);
        }

        rec.info('opening the session');
        await primary.navigate(`${BASE}/#/session/${sessionId}`);
        if (opts.deploy && launched) {
            await sleep(3000);
            await primary.reload();
        }
        const iframeCtx = await poll(() => primary.iframeContext(), { timeout: 60000, label: 'session frame' });
        await poll(() => primary.evaluate(`document.querySelectorAll('canvas').length > 0 && !!document.getElementById('noVNC_displays_button')`, { context: iframeCtx }),
            { timeout: 60000, label: 'session canvas' });
        check('session connects', true);
        const getFrame = () => {
            const id = primary.iframeContext();
            if (!id) { throw new Error('the session frame is not available'); }
            return id;
        };

        rec.info('adding a monitor');
        const popupPromise = new Promise(res => popupWaiters.push(res));
        await primary.evaluate(`(() => { const d = document; d.getElementById('noVNC_displays_button').click(); })()`, { context: getFrame(), userGesture: true });
        await sleep(800);
        await primary.evaluate(`document.getElementById('noVNC_addMonitor').click()`, { context: getFrame(), userGesture: true });
        const popup = await Promise.race([popupPromise, sleep(20000).then(() => null)]);
        if (!popup) { throw new Error('the popup did not open'); }
        popup.label = 'popup';
        await popup.ready;
        const pwin = await cdp.send('Browser.getWindowForTarget', { targetId: popup.targetId });
        await cdp.send('Browser.setWindowBounds', { windowId: pwin.windowId, bounds: { width: 1000, height: 900 } }).catch(() => {});
        const popupCtx = () => {
            const found = [...popup.contexts].find(([, c]) => c.auxData && c.auxData.isDefault && c.auxData.frameId === popup.mainFrame);
            if (!found) { throw new Error('the popup page is not available'); }
            return found[0];
        };
        await poll(() => popup.evaluate(`/^Display \\d/.test(document.title)`, { context: popupCtx(), timeout: 15000 }),
            { timeout: 45000, label: 'popup to register' }).catch(async (err) => {
            const targets = await cdp.send('Target.getTargets').catch(() => ({ targetInfos: [] }));
            for (const t of targets.targetInfos) { rec.info('target ' + t.type + ' attached=' + t.attached + ' ' + String(t.url).split('?')[0]); }
            rec.info('popup contexts ' + popup.contexts.size + ', frame ' + popup.mainFrame);
            throw err;
        });
        check('popup registers a screen', true, await popup.evaluate('document.title.replace(/[0-9a-f-]{36}/, "<id>")', { context: popupCtx() }));

        const info = await primary.evaluate(`({ hasVideoDecoder: typeof VideoDecoder !== 'undefined', cores: navigator.hardwareConcurrency })`, { context: getFrame() });
        rec.info('browser capabilities ' + JSON.stringify(info));
        check('webcodecs available', info.hasVideoDecoder);

        const desktop = () => sh('docker', ['exec', container, 'sh', '-c', 'DISPLAY=:1 xdpyinfo | grep dimensions']).match(/(\d+)x(\d+)/);
        await sleep(6000);
        const dims = desktop();
        const width = Number(dims[1]);
        rec.info('remote desktop ' + dims[1] + 'x' + dims[2]);
        const startVideo = (x, y) => {
            sh('docker', ['exec', '-d', '-e', 'DISPLAY=:1', container, 'ffplay', '-loglevel', 'quiet', '-noborder', '-x', '800', '-y', '600',
                '-left', String(x), '-top', String(y), '-f', 'lavfi', '-i', 'testsrc2=size=800x600:rate=60']);
        };
        const secondX = Math.max(1900, width - 900);
        startVideo(20, 20);
        startVideo(secondX, 80);
        await sleep(4000);
        const wins = sh('docker', ['exec', container, 'sh', '-c', 'DISPLAY=:1 xwininfo -root -tree | grep "800x600+" | grep -v "+0+0"']);
        const onPopup = new RegExp('\\+' + secondX + '\\+80').test(wins);
        check('test video placed on the popup', onPopup, 'desktop width ' + width + ', second video at x=' + secondX);

        if (opts.frames) {
            rec.info('frame tracker ' + await primary.evaluate(FRAME_TRACKER_INSTALL, { context: getFrame() }));
            results.frames = {};
        }

        const configs = [
            { name: 'stream24', mode: '-1027', fps: 24, kind: 'stream' },
            { name: 'stream60', mode: '-1027', fps: 60, kind: 'stream' },
            { name: 'image24', mode: '-1025', fps: 24, kind: 'image' },
            { name: 'image60', mode: '-1025', fps: 60, kind: 'image' },
        ];
        if (!opts.skipPerf) {
            for (const cfg of configs) {
                rec.info('measuring ' + cfg.name);
                await primary.evaluate(applySettingsExpr(cfg), { context: getFrame(), timeout: 60000 });
                const expr = cfg.kind === 'stream' ? streamingExpr(opts.seconds, opts.runs) : imageExpr(opts.seconds);
                const budget = (opts.seconds * (cfg.kind === 'stream' ? opts.runs : 1) + 60) * 1000;
                const [p, q] = await Promise.all([
                    primary.evaluate(expr, { context: getFrame(), timeout: budget }),
                    popup.evaluate(expr, { context: popupCtx(), timeout: budget }),
                ]);
                results.perf[cfg.name] = { primary: p, popup: q };
                if (opts.frames) {
                    results.frames[cfg.name] = await primary.evaluate(FRAME_TRACKER_REPORT, { context: getFrame() });
                    rec.info('frames ' + cfg.name + ' ' + JSON.stringify(results.frames[cfg.name]));
                }
                rec.info(cfg.name + ' primary ' + JSON.stringify(p) + ' popup ' + JSON.stringify(q));
                if (cfg.kind === 'stream') {
                    const floor = cfg.fps === 24 ? 21 : 45;
                    const worst = Math.min(...p, ...q);
                    check('perf ' + cfg.name + ' at least ' + floor + ' decodes/s on both displays', worst >= floor, 'lowest ' + worst);
                } else {
                    check('perf ' + cfg.name + ' draws on both displays', p.mpxPerSec >= 0.8 && q.mpxPerSec >= 0.8,
                        'primary ' + p.mpxPerSec + ' Mpx/s, popup ' + q.mpxPerSec + ' Mpx/s');
                }
            }
        }

        if (!opts.skipSecurity) {
            rec.info('running the relay security checks');
            const res = await primary.evaluate(attackExpr(workerUrl), { context: getFrame(), timeout: 120000 });
            results.security = res;
            rec.info('security results ' + JSON.stringify(res));
            const only = (obj, allowed) => Object.keys(obj).every(k => allowed.includes(k));
            check('security: no usable room found', !res.error, res.error);
            check('security: guessed claims all refused', JSON.stringify(res.guessedClaims) === JSON.stringify({ 'rejected:unknown': 4048 }),
                JSON.stringify(res.guessedClaims));
            check('security: takeover attempts refused', only(res.takeoverAttempts || {}, ['rejected:unknown', 'rejected:busy']),
                JSON.stringify(res.takeoverAttempts));
            check('security: leaked token claim got nothing', Object.keys(res.leakedTokenClaim || { x: 1 }).length === 0,
                JSON.stringify(res.leakedTokenClaim));
            check('security: malformed registration rejected', (res.registerAbuse || {})['rejected:invalid'] === 1, JSON.stringify(res.registerAbuse));
        }

        if (!opts.skipRelink) {
            rec.info('reloading the primary only');
            let t0 = Date.now();
            await primary.reload();
            await poll(() => primary.iframeContext(), { timeout: 60000, label: 'primary frame after reload' });
            await poll(() => primary.evaluate(`document.querySelectorAll('canvas').length > 0`, { context: getFrame() }), { timeout: 60000, label: 'primary canvas' });
            await sleep(6000);
            let drawn = await popup.evaluate(DRAW_PROBE, { context: popupCtx() });
            results.relink.primaryReload = { drawEventsIn4s: drawn, seconds: (Date.now() - t0) / 1000 };
            check('relink after a primary reload', drawn > 0, drawn + ' draw calls in 4 s');

            rec.info('reloading both windows at once');
            t0 = Date.now();
            await Promise.all([primary.reload(), popup.reload()]);
            await poll(() => primary.iframeContext(), { timeout: 60000, label: 'primary frame after double reload' });
            await poll(() => popup.evaluate(`document.querySelectorAll('canvas').length > 0 && /^Display \\d/.test(document.title)`, { context: popupCtx() }),
                { timeout: 90000, label: 'popup to relink after both reloaded' }).catch(() => null);
            await sleep(6000);
            drawn = await popup.evaluate(DRAW_PROBE, { context: popupCtx() }).catch(() => 0);
            results.relink.bothReload = { drawEventsIn4s: drawn, seconds: (Date.now() - t0) / 1000 };
            check('relink after both windows reload at once', drawn > 0, drawn + ' draw calls in 4 s');
        }

        for (const [, tab] of tabs) {
            const errors = readLog(outDir, 'console-' + tab.label + '.log').filter(l => /\[exception\]|\[error\]/.test(l));
            results.checks.push({ name: 'console errors ' + tab.label, ok: true, detail: errors.length + ' error lines (see log)' });
            rec.info(tab.label + ' console error lines: ' + errors.length);
        }
    } catch (err) {
        rec.info('ERROR ' + (err && err.stack || err));
        exitCode = 2;
    } finally {
        try {
            if (!container) { throw new Error('no session container'); }
            writeFileSync(join(outDir, 'server-xvnc.log'), redact(sh('docker', ['exec', container, 'sh', '-c', 'tail -n 400 /home/kasm-user/.vnc/*.log'])));
            writeFileSync(join(outDir, 'server-container.log'), redact(sh('docker', ['logs', '--tail', '400', container], { stdio: ['ignore', 'pipe', 'pipe'] })));
        } catch (err) {
            rec.info('could not read server logs: ' + err.message);
        }
        cleanup();
    }

    results.finishedAt = new Date().toISOString();
    writeFileSync(join(outDir, 'results.json'), JSON.stringify(results, null, 2));
    const failed = results.checks.filter(c => !c.ok);
    rec.info(`${results.checks.length - failed.length} of ${results.checks.length} checks passed; logs in ${outDir}`);
    if (exitCode === 0 && failed.length > 0) { exitCode = 1; }
    return exitCode;
}

function readLog(dir, file) {
    const path = join(dir, file);
    return existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean) : [];
}

main().then(code => process.exit(code), err => { console.error(redact(err && err.message || err)); process.exit(2); });
