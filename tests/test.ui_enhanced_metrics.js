/* jshint expr: true */

const expect = chai.expect;

// Covers VNC-696: with enhanced metrics enabled, stats are forwarded to the
// embedder but the stats panel must stay hidden. app/ui.js cannot be imported
// here (bare module imports, side effects on load), so the handlers under test
// are extracted from its source by name and brace matching and run against a
// minimal UI stub. The suite skips on branches that lack the feature.

function matchingBrace(src, open) {
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        const ch = src[i];
        if (ch === '{') {
            depth++;
        } else if (ch === '}') {
            depth--;
            if (depth === 0) return i;
        }
    }
    throw new Error('unbalanced braces in app/ui.js');
}

// Object-literal method, found by name whatever the indentation, ending at its matching brace
function extractMethod(src, name) {
    const match = new RegExp('(^|\\n)[ \\t]*' + name + '\\s*\\(\\s*\\)\\s*\\{').exec(src);
    if (!match) throw new Error('not found in app/ui.js: ' + name);
    const open = match.index + match[0].length - 1;
    return src.slice(src.indexOf(name, match.index), matchingBrace(src, open) + 1);
}

function extractCase(src, label) {
    const start = src.indexOf("case '" + label + "':");
    if (start < 0) throw new Error('not found in app/ui.js: case ' + label);
    const rest = src.slice(start + label.length + 8);
    const end = rest.search(/\bbreak;/);
    if (end < 0) throw new Error('end of case not found in app/ui.js: ' + label);
    return rest.slice(0, end);
}

describe('UI enhanced metrics (VNC-696)', function () {
    "use strict";

    let UI, handleMessage, clock;
    let panel, charts, perfToggle;

    before(async function () {
        const src = await (await fetch('/base/app/ui.js')).text();
        // The feature lives on the VNC-696 branch; without it there is nothing to test here
        if (!/updateEnhancedMetrics\s*\(\s*\)\s*\{/.test(src)) {
            this.skip();
        }
        const methods = ['showStats', 'updateStatsPolling', 'updateEnhancedMetrics']
            .map(n => extractMethod(src, n).trim());
        const factory = new Function('UI', 'WebUtil', 'return {\n' + methods.join(',\n') + '\n};');
        this.factory = factory;
        this.src = src;
    });

    beforeEach(function () {
        clock = sinon.useFakeTimers();

        panel = document.createElement('div');
        panel.id = 'noVNC_connection_stats';
        panel.style.visibility = 'hidden';
        charts = document.createElement('div');
        charts.id = 'noVNC_charts_container';
        perfToggle = document.createElement('input');
        perfToggle.type = 'checkbox';
        perfToggle.id = 'noVNC_setting_enable_perf_stats';
        [panel, charts, perfToggle].forEach(e => document.body.appendChild(e));

        const settings = { enable_perf_stats: false, enable_latency_stats: false };
        UI = {
            enhancedMetrics: false,
            statsInterval: null,
            STATS_INTERVAL_MS: 5000,
            rfb: {
                requestBottleneckStats: sinon.spy(),
                enableInputLatencyMeasurement: sinon.spy(),
            },
            getSetting: (n) => settings[n],
            saveSetting: (n) => {
                if (n === 'enable_perf_stats') settings[n] = perfToggle.checked;
            },
            forceSetting: (n, v) => {
                settings[n] = v;
                if (n === 'enable_perf_stats') perfToggle.checked = v;
            },
            toggleLatencyStats: sinon.spy(),
        };
        Object.assign(UI, this.factory(UI, { isInsideKasmVDI: () => false }));

        // Same case bodies the postMessage handler runs
        handleMessage = (action, value) => {
            if (action === 'set_perf_stats') {
                UI.forceSetting('enable_perf_stats', value, false);
                UI.showStats();
            } else if (action === 'set_enhanced_metrics') {
                UI.enhancedMetrics = !!value;
                UI.updateEnhancedMetrics();
            }
        };
    });

    afterEach(function () {
        clearInterval(UI.statsInterval);
        clock.restore();
        [panel, charts, perfToggle].forEach(e => e.remove());
    });

    const panelVisible = () => panel.style.visibility === 'visible';
    const chartsVisible = () => charts.classList.contains('visible');

    it('should keep the handler sequences in sync with app/ui.js', function () {
        // Guards the replicated message dispatch above against drift
        const perf = extractCase(this.src, 'set_perf_stats');
        expect(perf).to.contain("UI.forceSetting('enable_perf_stats', event.data.value, false)");
        expect(perf).to.contain('UI.showStats()');
        const enhanced = extractCase(this.src, 'set_enhanced_metrics');
        expect(enhanced).to.contain('UI.enhancedMetrics = !!event.data.value');
        expect(enhanced).to.contain('UI.updateEnhancedMetrics()');
    });

    it('should show the panel for set_perf_stats when enhanced mode is off', function () {
        handleMessage('set_perf_stats', true);
        expect(panelVisible()).to.be.true;
        expect(chartsVisible()).to.be.true;
    });

    it('should hide the panel when enhanced mode starts', function () {
        handleMessage('set_perf_stats', true);
        handleMessage('set_enhanced_metrics', true);
        expect(panelVisible()).to.be.false;
        expect(chartsVisible()).to.be.false;
    });

    it('should not show the panel for set_perf_stats(true) in enhanced mode', function () {
        handleMessage('set_enhanced_metrics', true);
        handleMessage('set_perf_stats', true);
        expect(panelVisible()).to.be.false;
        expect(chartsVisible()).to.be.false;
    });

    it('should not show the panel when the checkbox is toggled in enhanced mode', function () {
        handleMessage('set_enhanced_metrics', true);
        perfToggle.checked = true;
        UI.showStats();
        expect(panelVisible()).to.be.false;
        expect(chartsVisible()).to.be.false;
    });

    it('should restore the panel when enhanced mode ends and perf stats are on', function () {
        handleMessage('set_perf_stats', true);
        handleMessage('set_enhanced_metrics', true);
        handleMessage('set_enhanced_metrics', false);
        expect(panelVisible()).to.be.true;
        expect(chartsVisible()).to.be.true;
    });

    it('should show the panel after enhanced mode ends if enabled during it', function () {
        handleMessage('set_enhanced_metrics', true);
        handleMessage('set_perf_stats', true);
        handleMessage('set_enhanced_metrics', false);
        expect(panelVisible()).to.be.true;
    });

    it('should leave the panel hidden after enhanced mode ends if perf stats are off', function () {
        handleMessage('set_enhanced_metrics', true);
        handleMessage('set_enhanced_metrics', false);
        expect(panelVisible()).to.be.false;
        expect(chartsVisible()).to.be.false;
    });

    describe('stats forwarding', function () {
        it('should poll bottleneck stats in enhanced mode with the panel hidden', function () {
            handleMessage('set_enhanced_metrics', true);
            handleMessage('set_perf_stats', true);
            clock.tick(5000);
            expect(UI.rfb.requestBottleneckStats).to.have.been.calledOnce;
            clock.tick(5000);
            expect(UI.rfb.requestBottleneckStats).to.have.been.calledTwice;
        });

        it('should keep a single polling interval across repeated messages', function () {
            handleMessage('set_enhanced_metrics', true);
            handleMessage('set_perf_stats', true);
            handleMessage('set_perf_stats', true);
            clock.tick(5000);
            expect(UI.rfb.requestBottleneckStats).to.have.been.calledOnce;
        });

        it('should stop polling when enhanced mode ends and perf stats are off', function () {
            handleMessage('set_enhanced_metrics', true);
            handleMessage('set_enhanced_metrics', false);
            clock.tick(10000);
            expect(UI.rfb.requestBottleneckStats).to.not.have.been.called;
        });

        it('should keep polling when enhanced mode ends and the panel is enabled', function () {
            handleMessage('set_perf_stats', true);
            handleMessage('set_enhanced_metrics', true);
            handleMessage('set_enhanced_metrics', false);
            clock.tick(5000);
            expect(UI.rfb.requestBottleneckStats).to.have.been.calledOnce;
        });
    });

    describe('latency measurement', function () {
        it('should enable input latency measurement in enhanced mode', function () {
            handleMessage('set_enhanced_metrics', true);
            expect(UI.rfb.enableInputLatencyMeasurement).to.have.been.calledWith(true);
        });

        it('should disable input latency measurement when enhanced mode ends', function () {
            handleMessage('set_enhanced_metrics', true);
            handleMessage('set_enhanced_metrics', false);
            expect(UI.rfb.enableInputLatencyMeasurement.lastCall).to.have.been.calledWith(false);
        });
    });
});
