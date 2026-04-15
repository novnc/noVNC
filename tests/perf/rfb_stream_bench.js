const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');

const search = new URLSearchParams(window.location.search);
const scenario = search.get('scenario') || 'protocol-copyrect';
const repoUrl = search.get('repo');

window.__BENCH_DONE = false;
window.__RESULT = null;
window.__ERROR = null;

function setStatus(text) {
    statusEl.textContent = text;
    document.title = text;
}

function setResult(result) {
    window.__RESULT = result;
    window.__BENCH_DONE = true;
    setStatus('done');
    resultEl.textContent = JSON.stringify(result, null, 2);
}

function setError(error) {
    const rendered = error instanceof Error ? `${error.message}\n${error.stack || ''}` : String(error);
    window.__ERROR = rendered;
    window.__BENCH_DONE = true;
    setStatus('error');
    resultEl.textContent = rendered;
    console.error(error);
}

function parseInteger(name, fallback) {
    const raw = search.get(name);
    if (raw === null || raw === '') {
        return fallback;
    }

    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0) {
        throw new Error(`Invalid integer for "${name}": ${raw}`);
    }

    return value;
}

function ensureRepoUrl(rawRepoUrl) {
    if (!rawRepoUrl) {
        throw new Error('Missing "repo" query parameter');
    }

    const normalized = rawRepoUrl.endsWith('/') ? rawRepoUrl : `${rawRepoUrl}/`;
    return new URL(normalized);
}

function receive(ws, bytes) {
    ws._receiveData(bytes);
}

function dispatchMessage(ws, data) {
    ws.onmessage(new MessageEvent('message', { data }));
}

function createVersionBuffer() {
    return new TextEncoder().encode('RFB 003.008\n');
}

function encodeName(name) {
    return new TextEncoder().encode(name);
}

function buildServerInit(width, height, name) {
    const nameBytes = encodeName(name);

    const header = new Uint8Array(24);
    const view = new DataView(header.buffer);
    view.setUint16(0, width, false);
    view.setUint16(2, height, false);
    header[4] = 24;
    header[5] = 24;
    header[6] = 0;
    header[7] = 1;
    view.setUint16(8, 255, false);
    view.setUint16(10, 255, false);
    view.setUint16(12, 255, false);
    header[14] = 16;
    header[15] = 8;
    header[16] = 0;
    view.setUint32(20, nameBytes.length, false);

    return { header, nameBytes };
}

function handshake(ws, width, height, name) {
    receive(ws, createVersionBuffer());
    receive(ws, new Uint8Array([1, 1]));
    receive(ws, new Uint8Array([0, 0, 0, 0]));

    const init = buildServerInit(width, height, name);
    receive(ws, init.header);
    receive(ws, init.nameBytes);
}

async function loadModules(repoBase) {
    // util/browser.js has a top-level WebCodecs probe that can stall in
    // headless Chrome. Remove the APIs before importing RFB so the module
    // resolves quickly and deterministically in benchmark runs.
    try { delete window.VideoDecoder; } catch {}
    try { delete window.EncodedVideoChunk; } catch {}

    const [rfbModule, websocketModule] = await Promise.all([
        import(new URL('core/rfb.js', repoBase).href),
        import(new URL('tests/fake.websocket.js', repoBase).href),
    ]);

    return {
        RFB: rfbModule.default,
        FakeWebSocket: websocketModule.default,
    };
}

function createHarness(RFB, FakeWebSocket) {
    const mount = document.createElement('div');
    document.body.appendChild(mount);

    const ws = new FakeWebSocket();
    const rfb = new RFB(mount, ws);
    ws._open();

    return { mount, rfb, ws };
}

function destroyHarness(harness) {
    try {
        harness.rfb.disconnect();
    } catch {}

    if (harness.mount.parentNode !== null) {
        harness.mount.parentNode.removeChild(harness.mount);
    }
}

function buildCopyRectBatch(rectsPerMessage) {
    const bytesPerRect = 16;
    const buffer = new ArrayBuffer(4 + (rectsPerMessage * bytesPerRect));
    const view = new DataView(buffer);
    let offset = 0;

    view.setUint8(offset++, 0);
    view.setUint8(offset++, 0);
    view.setUint16(offset, rectsPerMessage, false);
    offset += 2;

    for (let i = 0; i < rectsPerMessage; i++) {
        view.setUint16(offset, 0, false); offset += 2;
        view.setUint16(offset, 0, false); offset += 2;
        view.setUint16(offset, 1, false); offset += 2;
        view.setUint16(offset, 1, false); offset += 2;
        view.setInt32(offset, 1, false); offset += 4; // CopyRect encoding
        view.setUint16(offset, 0, false); offset += 2;
        view.setUint16(offset, 0, false); offset += 2;
    }

    return buffer;
}

function createCopyRectMessages(messageCount, rectsPerMessage) {
    const messages = [];
    for (let i = 0; i < messageCount; i++) {
        messages.push(buildCopyRectBatch(rectsPerMessage));
    }
    return messages;
}

function average(values) {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function runSmokeRaw(RFB, FakeWebSocket) {
    const start = performance.now();
    const harness = createHarness(RFB, FakeWebSocket);

    try {
        handshake(harness.ws, 2, 2, 'smoke');

        const update = new Uint8Array(4 + 12 + 4);
        const view = new DataView(update.buffer);
        let offset = 0;

        update[offset++] = 0;
        update[offset++] = 0;
        view.setUint16(offset, 1, false); offset += 2;

        view.setUint16(offset, 0, false); offset += 2;
        view.setUint16(offset, 0, false); offset += 2;
        view.setUint16(offset, 1, false); offset += 2;
        view.setUint16(offset, 1, false); offset += 2;
        view.setInt32(offset, 0, false); offset += 4; // Raw encoding

        update[offset++] = 0xff;
        update[offset++] = 0x00;
        update[offset++] = 0x00;
        update[offset++] = 0x00;

        receive(harness.ws, update);
        await new Promise((resolve) => window.setTimeout(resolve, 50));

        const pixel = Array.from(harness.rfb.getImageData().data.slice(0, 4));
        const expectedPixel = [255, 0, 0, 255];
        const pass = harness.rfb._rfbConnectionState === 'connected' &&
            pixel.length === expectedPixel.length &&
            pixel.every((value, index) => value === expectedPixel[index]);

        return {
            scenario: 'smoke-raw',
            pass,
            state: harness.rfb._rfbConnectionState,
            pixel,
            expectedPixel,
            durationMs: performance.now() - start,
        };
    } finally {
        destroyHarness(harness);
    }
}

async function runProtocolCopyRect(RFB, FakeWebSocket) {
    const iterations = parseInteger('iterations', 6);
    const warmup = parseInteger('warmup', 2);
    const messages = parseInteger('messages', 50);
    const rects = parseInteger('rects', 5000);
    const stubDisplay = search.get('stubDisplay') !== '0';
    const harness = createHarness(RFB, FakeWebSocket);

    try {
        handshake(harness.ws, 4, 4, 'bench');
        harness.rfb._enabledContinuousUpdates = true;

        if (typeof harness.ws._getSentData === 'function') {
            harness.ws._getSentData();
        }

        if (stubDisplay) {
            harness.rfb._display.copyImage = () => {};
            harness.rfb._display.fillRect = () => {};
            harness.rfb._display.blitImage = () => {};
            harness.rfb._display.flip = () => {};
        }

        const payloads = createCopyRectMessages(messages, rects);
        const feed = () => {
            for (const payload of payloads) {
                dispatchMessage(harness.ws, payload);
            }
        };

        for (let i = 0; i < warmup; i++) {
            feed();
        }

        const samples = [];
        for (let i = 0; i < iterations; i++) {
            const start = performance.now();
            feed();

            if (typeof harness.rfb._display.flush === 'function' && harness.rfb._display.pending()) {
                await harness.rfb._display.flush();
            }

            samples.push(performance.now() - start);
        }

        const avg = average(samples);
        const min = Math.min(...samples);
        const max = Math.max(...samples);
        const rectsPerIteration = messages * rects;

        return {
            scenario: 'protocol-copyrect',
            stubDisplay,
            iterations,
            warmup,
            messages,
            rectsPerMessage: rects,
            rectsPerIteration,
            avgMs: avg,
            minMs: min,
            maxMs: max,
            rectsPerSecond: rectsPerIteration / (avg / 1000),
            samplesMs: samples,
        };
    } finally {
        destroyHarness(harness);
    }
}

async function run() {
    const repoBase = ensureRepoUrl(repoUrl);
    setStatus(`loading ${scenario}`);
    const { RFB, FakeWebSocket } = await loadModules(repoBase);

    if (scenario === 'smoke-raw') {
        setStatus('running smoke-raw');
        setResult(await runSmokeRaw(RFB, FakeWebSocket));
        return;
    }

    if (scenario === 'protocol-copyrect') {
        setStatus('running protocol-copyrect');
        setResult(await runProtocolCopyRect(RFB, FakeWebSocket));
        return;
    }

    throw new Error(`Unknown scenario "${scenario}"`);
}

run().catch(setError);
