#!/usr/bin/env node

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import http from 'node:http';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pageUrl = pathToFileURL(path.join(scriptDir, 'rfb_stream_bench.html')).href;
const repoRoot = path.resolve(scriptDir, '..', '..');

const DEFAULT_SCENARIOS = [
    {
        name: 'smoke-raw',
        type: 'smoke',
        scenario: 'smoke-raw',
    },
    {
        name: 'protocol-copyrect-parser',
        type: 'compare',
        scenario: 'protocol-copyrect',
        params: {
            iterations: 6,
            warmup: 2,
            messages: 50,
            rects: 5000,
            stubDisplay: 1,
        },
    },
    {
        name: 'protocol-copyrect-full',
        type: 'compare',
        scenario: 'protocol-copyrect',
        params: {
            iterations: 5,
            warmup: 2,
            messages: 20,
            rects: 2000,
            stubDisplay: 0,
        },
    },
];

function printHelp() {
    console.log(`Usage: node tests/perf/run_rfb_bench.mjs [options]

Options:
  --candidate <path>      Repo checkout to benchmark. Defaults to the current checkout.
  --baseline <path>       Baseline repo checkout. If omitted, a temporary worktree is created.
  --baseline-ref <ref>    Git ref to use for the temporary baseline worktree.
  --chrome <path>         Chrome/Chromium executable to launch.
  --json                  Print JSON only.
  --keep-worktree         Keep the temporary baseline worktree on disk.
  --help                  Show this message.
`);
}

function parseArgs(argv) {
    const options = {
        candidate: repoRoot,
        baseline: null,
        baselineRef: null,
        chrome: null,
        json: false,
        keepWorktree: false,
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];

        switch (arg) {
            case '--candidate':
                options.candidate = argv[++i];
                break;
            case '--baseline':
                options.baseline = argv[++i];
                break;
            case '--baseline-ref':
                options.baselineRef = argv[++i];
                break;
            case '--chrome':
                options.chrome = argv[++i];
                break;
            case '--json':
                options.json = true;
                break;
            case '--keep-worktree':
                options.keepWorktree = true;
                break;
            case '--help':
                options.help = true;
                break;
            default:
                throw new Error(`Unknown argument: ${arg}`);
        }
    }

    return options;
}

function runCommand(command, args, cwd) {
    const result = spawnSync(command, args, {
        cwd,
        encoding: 'utf8',
    });

    if (result.status !== 0) {
        throw new Error([
            `Command failed: ${command} ${args.join(' ')}`,
            result.stdout.trim(),
            result.stderr.trim(),
        ].filter(Boolean).join('\n'));
    }

    return result.stdout.trim();
}

function resolveChromeExecutable(explicitChrome) {
    if (explicitChrome) {
        return explicitChrome;
    }

    if (process.env.CHROME_BIN) {
        return process.env.CHROME_BIN;
    }

    const candidates = [
        'google-chrome',
        'google-chrome-stable',
        'chromium',
        'chromium-browser',
    ];

    for (const candidate of candidates) {
        const result = spawnSync('bash', ['-lc', `command -v ${candidate}`], {
            encoding: 'utf8',
        });

        if (result.status === 0) {
            return result.stdout.trim();
        }
    }

    throw new Error('Unable to locate a Chrome/Chromium executable');
}

function resolveDefaultBaselineRef(candidateRoot) {
    const refs = ['origin/master', 'master', 'origin/main', 'main'];

    for (const ref of refs) {
        const result = spawnSync('git', ['-C', candidateRoot, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
            encoding: 'utf8',
        });

        if (result.status === 0) {
            return ref;
        }
    }

    throw new Error('Unable to resolve a default baseline ref (tried origin/master, master, origin/main, main)');
}

function dirToFileUrl(dirPath) {
    const href = pathToFileURL(path.resolve(dirPath)).href;
    return href.endsWith('/') ? href : `${href}/`;
}

async function allocatePort() {
    return await new Promise((resolve, reject) => {
        const server = net.createServer();
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            server.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }

                resolve(address.port);
            });
        });
        server.on('error', reject);
    });
}

async function httpGetJson(url) {
    return await new Promise((resolve, reject) => {
        const request = http.get(url, (response) => {
            let data = '';
            response.setEncoding('utf8');
            response.on('data', (chunk) => { data += chunk; });
            response.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (error) {
                    reject(error);
                }
            });
        });

        request.on('error', reject);
    });
}

async function waitForDevtools(port, timeoutMs) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        try {
            await httpGetJson(`http://127.0.0.1:${port}/json/version`);
            return;
        } catch (error) {
            await delay(100);
        }
    }

    throw new Error(`Timed out waiting for Chrome DevTools on port ${port}`);
}

async function getPageTarget(port, expectedUrl, timeoutMs) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        const pages = await httpGetJson(`http://127.0.0.1:${port}/json/list`);
        const page = pages.find((entry) => entry.type === 'page' && entry.url === expectedUrl);

        if (page) {
            return page;
        }

        await delay(100);
    }

    throw new Error(`Timed out waiting for page target: ${expectedUrl}`);
}

async function cdpEvaluate(page, expression) {
    return await new Promise((resolve, reject) => {
        const ws = new WebSocket(page.webSocketDebuggerUrl);

        ws.addEventListener('open', () => {
            ws.send(JSON.stringify({
                id: 1,
                method: 'Runtime.evaluate',
                params: {
                    expression,
                    returnByValue: true,
                },
            }));
        });

        ws.addEventListener('message', (event) => {
            try {
                resolve(JSON.parse(event.data.toString()));
            } catch (error) {
                reject(error);
            } finally {
                ws.close();
            }
        });

        ws.addEventListener('error', reject);
    });
}

async function killChrome(child) {
    if (child.exitCode !== null || child.signalCode !== null) {
        return;
    }

    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGTERM');
    await Promise.race([exited, delay(5000)]);

    if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await Promise.race([exited, delay(5000)]);
    }
}

function createScenarioUrl(repoPath, scenario) {
    const params = new URLSearchParams();
    params.set('repo', dirToFileUrl(repoPath));
    params.set('scenario', scenario.scenario);

    if (scenario.params) {
        for (const [key, value] of Object.entries(scenario.params)) {
            params.set(key, String(value));
        }
    }

    return `${pageUrl}?${params.toString()}`;
}

async function runScenario(chromeExecutable, repoPath, scenario) {
    const port = await allocatePort();
    const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'novnc-rfb-bench-chrome-'));
    const logs = [];
    const scenarioUrl = createScenarioUrl(repoPath, scenario);
    const child = spawn(chromeExecutable, [
        '--headless',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-default-apps',
        '--disable-sync',
        '--incognito',
        '--no-default-browser-check',
        '--no-first-run',
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${userDataDir}`,
        '--allow-file-access-from-files',
        scenarioUrl,
    ], {
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { logs.push(chunk.trim()); });
    child.stderr.on('data', (chunk) => { logs.push(chunk.trim()); });

    try {
        await waitForDevtools(port, 15000);
        const page = await getPageTarget(port, scenarioUrl, 15000);
        const deadline = Date.now() + 120000;

        while (Date.now() < deadline) {
            const response = await cdpEvaluate(page, `(() => ({
                done: window.__BENCH_DONE === true,
                error: window.__ERROR || null,
                result: window.__RESULT || null,
                status: document.getElementById('status')?.textContent || document.title,
            }))()`);

            const state = response.result.result.value;

            if (state.done) {
                if (state.error) {
                    throw new Error(`Scenario ${scenario.name} failed:\n${state.error}`);
                }

                return state.result;
            }

            await delay(200);
        }

        throw new Error(`Scenario ${scenario.name} timed out`);
    } catch (error) {
        const logTail = logs.filter(Boolean).slice(-20).join('\n');
        if (logTail) {
            error.message = `${error.message}\n\nChrome log tail:\n${logTail}`;
        }
        throw error;
    } finally {
        await killChrome(child);
        await rm(userDataDir, {
            recursive: true,
            force: true,
            maxRetries: 5,
            retryDelay: 100,
        });
    }
}

function formatMs(value) {
    return `${value.toFixed(2)} ms`;
}

function formatPct(value) {
    return `${value.toFixed(1)}%`;
}

function formatDeltaSentence(deltaPct) {
    if (deltaPct >= 0) {
        return `${formatPct(deltaPct)} faster on the candidate`;
    }

    return `${formatPct(Math.abs(deltaPct))} slower on the candidate`;
}

function summarizeComparison(baseline, candidate) {
    const deltaPct = ((baseline.avgMs - candidate.avgMs) / baseline.avgMs) * 100;
    return {
        baseline,
        candidate,
        deltaPct,
    };
}

function buildMarkdown(summary) {
    const lines = [
        '## Browser-level smoke + protocol-stream benchmark',
        '',
        `- Smoke test (\`smoke-raw\`): baseline ${summary.smoke.baseline.pass ? 'pass' : 'fail'}, candidate ${summary.smoke.candidate.pass ? 'pass' : 'fail'}, candidate pixel ${JSON.stringify(summary.smoke.candidate.pixel)}.`,
        `- Parser-focused protocol benchmark (\`CopyRect\`, display stubbed): baseline ${formatMs(summary.parser.baseline.avgMs)}, candidate ${formatMs(summary.parser.candidate.avgMs)}, ${formatDeltaSentence(summary.parser.deltaPct)}.`,
        `- Full-pipeline protocol benchmark (\`CopyRect\`, display active): baseline ${formatMs(summary.full.baseline.avgMs)}, candidate ${formatMs(summary.full.candidate.avgMs)}, delta ${formatPct(summary.full.deltaPct)}.`,
        '',
        'The parser-focused benchmark runs actual noVNC `RFB/Websock` protocol parsing on complete `FramebufferUpdate` messages and stubs the display layer so the measurement stays attributable to the receive path. When display work is included, the signal is largely drowned out by rendering cost, so the end-to-end delta is not a good attribution tool for this specific change.',
    ];

    return lines.join('\n');
}

async function createBaselineWorktree(candidateRoot, baselineRef) {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'novnc-rfb-bench-baseline-'));
    const worktreePath = path.join(tempRoot, 'checkout');
    runCommand('git', ['-C', candidateRoot, 'worktree', 'add', '--detach', worktreePath, baselineRef], candidateRoot);
    return { tempRoot, worktreePath };
}

async function removeBaselineWorktree(candidateRoot, worktree) {
    try {
        runCommand('git', ['-C', candidateRoot, 'worktree', 'remove', '--force', worktree.worktreePath], candidateRoot);
    } finally {
        await rm(worktree.tempRoot, { recursive: true, force: true });
    }
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        printHelp();
        return;
    }

    const chromeExecutable = resolveChromeExecutable(options.chrome);
    const candidateRoot = path.resolve(options.candidate);
    const baselineRef = options.baseline ? null : (options.baselineRef || resolveDefaultBaselineRef(candidateRoot));

    let baselineRoot = options.baseline ? path.resolve(options.baseline) : null;
    let worktree = null;

    if (!baselineRoot) {
        worktree = await createBaselineWorktree(candidateRoot, baselineRef);
        baselineRoot = worktree.worktreePath;
    }

    try {
        const smokeScenario = DEFAULT_SCENARIOS.find((scenario) => scenario.name === 'smoke-raw');
        const parserScenario = DEFAULT_SCENARIOS.find((scenario) => scenario.name === 'protocol-copyrect-parser');
        const fullScenario = DEFAULT_SCENARIOS.find((scenario) => scenario.name === 'protocol-copyrect-full');

        const smokeBaseline = await runScenario(chromeExecutable, baselineRoot, smokeScenario);
        const smokeCandidate = await runScenario(chromeExecutable, candidateRoot, smokeScenario);
        const parserBaseline = await runScenario(chromeExecutable, baselineRoot, parserScenario);
        const parserCandidate = await runScenario(chromeExecutable, candidateRoot, parserScenario);
        const fullBaseline = await runScenario(chromeExecutable, baselineRoot, fullScenario);
        const fullCandidate = await runScenario(chromeExecutable, candidateRoot, fullScenario);

        const summary = {
            chromeExecutable,
            candidateRoot,
            baselineRoot,
            baselineRef,
            smoke: {
                baseline: smokeBaseline,
                candidate: smokeCandidate,
            },
            parser: summarizeComparison(parserBaseline, parserCandidate),
            full: summarizeComparison(fullBaseline, fullCandidate),
        };

        if (options.json) {
            console.log(JSON.stringify(summary, null, 2));
            return;
        }

        console.log(JSON.stringify(summary, null, 2));
        console.log('\nSuggested PR summary:\n');
        console.log(buildMarkdown(summary));
    } finally {
        if (worktree && !options.keepWorktree) {
            await removeBaselineWorktree(candidateRoot, worktree);
        }
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
});
