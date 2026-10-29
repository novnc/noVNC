import RFB from './core/rfb.js';
import KeyTable from './core/input/keysym.js';

(function () {
    const screenElement = document.getElementById('screen');
    const cursorElement = document.getElementById('virtual-cursor');

    let rfb = null;
    let desktopName = '';

    // Remote (framebuffer) coordinates of the virtual pointer.
    let cursorX = 0;
    let cursorY = 0;

    let isTrackpadMode = true;
    let pointerGain = 0.4;
    let accelEnabled = true;

    // ================= Zoom and Pan engine =================
    // Implements continuous two-finger pinch-to-zoom and two-finger panning
    // centered around the gesture focus point, identical to Chrome Remote Desktop.

    let userZoom = 1.0;
    let panX = 0;
    let panY = 0;
    const MIN_ZOOM = 1.0;
    const MAX_ZOOM = 5.0;

    function getCanvasBaseMetrics() {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        if (!rfb || !rfb._canvas) {
            return { w: vw, h: vh, left: 0, top: 0, vw: vw, vh: vh };
        }
        const cw = rfb._canvas.offsetWidth || (rfb._display ? rfb._display.scale * rfb._display.width : vw);
        const ch = rfb._canvas.offsetHeight || (rfb._display ? rfb._display.scale * rfb._display.height : vh);
        const left = (vw - cw) / 2;
        const top = (vh - ch) / 2;
        return { w: cw, h: ch, left: left, top: top, vw: vw, vh: vh };
    }

    function clampPan() {
        if (userZoom <= 1.005) {
            userZoom = 1.0;
            panX = 0;
            panY = 0;
            return;
        }

        const m = getCanvasBaseMetrics();
        const sw = m.w * userZoom;
        const sh = m.h * userZoom;

        // Horizontal clamping: keep canvas covering viewport without showing excess void
        if (sw > m.vw) {
            const minPan = m.vw - sw - m.left * userZoom;
            const maxPan = -m.left * userZoom;
            panX = Math.max(minPan, Math.min(maxPan, panX));
        } else {
            panX = (m.vw - sw) / 2 - m.left * userZoom;
        }

        // Vertical clamping
        if (sh > m.vh) {
            const minPan = m.vh - sh - m.top * userZoom;
            const maxPan = -m.top * userZoom;
            panY = Math.max(minPan, Math.min(maxPan, panY));
        } else {
            panY = (m.vh - sh) / 2 - m.top * userZoom;
        }
    }

    function applyTransform() {
        if (userZoom <= 1.005) {
            screenElement.style.transform = '';
            screenElement.style.transformOrigin = '';
        } else {
            screenElement.style.transformOrigin = '0 0';
            screenElement.style.transform =
                `translate(${panX.toFixed(2)}px, ${panY.toFixed(2)}px) scale(${userZoom.toFixed(4)})`;
        }
        drawCursor();
    }

    function applyPinchZoom(scaleDelta, focusX, focusY, panDx, panDy) {
        if (!rfb || !rfb._canvas) return;

        const oldZoom = userZoom;
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, oldZoom * scaleDelta));

        // Focal point zooming: maintain the content under (focusX, focusY)
        panX = (focusX + (panDx || 0)) - (focusX - panX) * (newZoom / oldZoom);
        panY = (focusY + (panDy || 0)) - (focusY - panY) * (newZoom / oldZoom);

        userZoom = newZoom;
        clampPan();
        applyTransform();

        bridge('onZoomChanged', userZoom);
    }

    function resetZoom() {
        userZoom = 1.0;
        panX = 0;
        panY = 0;
        applyTransform();
        bridge('onZoomChanged', 1.0);
    }

    function autoPanForCursor() {
        if (userZoom <= 1.05 || !rfb || !rfb._canvas) return;
        const rect = rfb._canvas.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const curScale = rect.width / (fbWidth() || 1);
        const screenCursorX = rect.left + cursorX * curScale;
        const screenCursorY = rect.top + cursorY * curScale;

        const margin = 48; // Edge threshold in CSS pixels
        let adjusted = false;

        if (screenCursorX > vw - margin) {
            panX -= (screenCursorX - (vw - margin));
            adjusted = true;
        } else if (screenCursorX < margin) {
            panX += (margin - screenCursorX);
            adjusted = true;
        }

        if (screenCursorY > vh - margin) {
            panY -= (screenCursorY - (vh - margin));
            adjusted = true;
        } else if (screenCursorY < margin) {
            panY += (margin - screenCursorY);
            adjusted = true;
        }

        if (adjusted) {
            clampPan();
            applyTransform();
        }
    }

    // ================= Bridge plumbing =================

    function log(msg) {
        console.log('[noVNC-Embedded] ' + msg);
        if (window.AndroidBridge && window.AndroidBridge.log) {
            try { window.AndroidBridge.log('noVNC-JS', String(msg)); } catch (e) {}
        }
    }

    function bridge(method, ...args) {
        if (!window.AndroidBridge || typeof window.AndroidBridge[method] !== 'function') return;
        try {
            window.AndroidBridge[method](...args);
        } catch (e) {
            console.error('Bridge call failed: ' + method, e);
        }
    }

    window.onerror = function (msg, url, line, col, err) {
        const errorDetails = msg + ' (' + (url ? url.split('/').pop() : 'script') + ':' + line + ')';
        log('Global JS Error: ' + errorDetails);
        bridge('onError', errorDetails);
    };

    window.addEventListener('unhandledrejection', function (e) {
        const reason = (e && e.reason) ? (e.reason.message || String(e.reason)) : 'unknown';
        log('Unhandled Promise Rejection: ' + reason);
        bridge('onError', 'Promise error: ' + reason);
    });

    // ================= State helpers =================

    function isConnected() {
        return rfb !== null && rfb._sock !== null && rfb._rfbConnectionState === 'connected';
    }

    function fbWidth() {
        return (rfb && rfb._display && rfb._display.width) ? rfb._display.width : 0;
    }

    function fbHeight() {
        return (rfb && rfb._display && rfb._display.height) ? rfb._display.height : 0;
    }

    function clampToDesktop(x, y) {
        const w = fbWidth() || 1;
        const h = fbHeight() || 1;
        return {
            x: Math.max(0, Math.min(w - 1, Math.round(x))),
            y: Math.max(0, Math.min(h - 1, Math.round(y)))
        };
    }

    // ================= Pointer pipeline =================

    function sendPointer(x, y, mask) {
        if (!isConnected()) return;
        if (rfb.viewOnly) return;
        const p = clampToDesktop(x, y);
        cursorX = p.x;
        cursorY = p.y;
        try {
            RFB.messages.pointerEvent(rfb._sock, cursorX, cursorY, mask & 0x7f);
        } catch (err) {
            log('pointerEvent failed: ' + err.message);
        }
        autoPanForCursor();
        drawCursor();
    }

    function pressButton(mask) {
        sendPointer(cursorX, cursorY, mask);
    }

    function releaseButtons() {
        sendPointer(cursorX, cursorY, 0);
    }

    function clickMask(mask, count) {
        const clicks = Math.max(1, count || 1);
        const step = 120;
        sendPointer(cursorX, cursorY, 0);
        let t = 15;
        for (let i = 0; i < clicks; i++) {
            setTimeout(() => sendPointer(cursorX, cursorY, mask), t);
            setTimeout(() => sendPointer(cursorX, cursorY, 0), t + 55);
            t += step;
        }
    }

    let scrollQueue = [];
    let scrollTimer = null;

    function processScrollQueue() {
        if (scrollQueue.length === 0) {
            scrollTimer = null;
            return;
        }
        const item = scrollQueue.shift();
        sendPointer(item.x, item.y, item.mask);
        setTimeout(() => {
            sendPointer(item.x, item.y, 0);
            scrollTimer = setTimeout(processScrollQueue, 20);
        }, 20);
    }

    function scrollSteps(steps, targetX, targetY) {
        if (!isConnected() || rfb.viewOnly) return;
        const n = Math.max(1, Math.min(8, Math.abs(steps)));
        const mask = steps < 0 ? (1 << 3) : (1 << 4);
        const x = (typeof targetX === 'number') ? targetX : cursorX;
        const y = (typeof targetY === 'number') ? targetY : cursorY;
        for (let i = 0; i < n; i++) {
            scrollQueue.push({ x, y, mask });
        }
        if (scrollQueue.length > 20) {
            scrollQueue.length = 20;
        }
        if (!scrollTimer) {
            processScrollQueue();
        }
    }

    // ================= Cursor overlay =================

    function drawCursor() {
        if (!isTrackpadMode || !rfb || !rfb._canvas || !rfb._display) {
            cursorElement.style.display = 'none';
            return;
        }

        const rect = rfb._canvas.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
            cursorElement.style.display = 'none';
            return;
        }

        const curScale = rect.width / (fbWidth() || 1);
        const screenX = rect.left + cursorX * curScale;
        const screenY = rect.top + cursorY * curScale;

        cursorElement.style.display = 'block';
        cursorElement.style.transform =
            `translate(${Math.round(screenX)}px, ${Math.round(screenY)}px)`;
    }

    // ================= Public JS API used by Android =================

    window.novnc = {
        isReady: true,

        connect: function (configJson) {
            try {
                const cfg = (typeof configJson === 'string') ? JSON.parse(configJson) : configJson;
                log('Connecting to ' + (cfg.rawUrl || cfg.url || cfg.host));

                if (rfb) {
                    try { rfb.disconnect(); } catch (e) {}
                    rfb = null;
                }

                resetZoom();

                let wsUrl = cfg.rawUrl || cfg.url;
                if (!wsUrl) {
                    if (cfg.host && (cfg.host.startsWith('ws://') || cfg.host.startsWith('wss://'))) {
                        wsUrl = cfg.host;
                    } else {
                        const protocol = cfg.ssl ? 'wss:' : 'ws:';
                        const hasPort = cfg.port && cfg.port > 0 && cfg.port !== 80 && cfg.port !== 443;
                        const portPart = hasPort ? (':' + cfg.port) : '';
                        let pathPart = '/websockify';
                        if (cfg.path && cfg.path.length > 0) {
                            pathPart = cfg.path.startsWith('/') ? cfg.path : ('/' + cfg.path);
                        }
                        wsUrl = `${protocol}//${cfg.host}${portPart}${pathPart}`;
                    }
                }
                log('Resolved WebSocket URL: ' + wsUrl);

                const options = {
                    shared: cfg.shared !== false,
                    credentials: {}
                };
                if (cfg.password) options.credentials.password = cfg.password;
                if (cfg.username) options.credentials.username = cfg.username;

                rfb = new RFB(screenElement, wsUrl, options);

                rfb.scaleViewport = cfg.scaleViewport !== false;
                rfb.viewOnly = !!cfg.viewOnly;
                if (typeof cfg.qualityLevel === 'number') rfb.qualityLevel = cfg.qualityLevel;
                if (typeof cfg.compressionLevel === 'number') rfb.compressionLevel = cfg.compressionLevel;

                rfb.addEventListener('connect', () => {
                    desktopName = rfb._fbName || 'Remote Desktop';
                    cursorX = Math.floor(fbWidth() / 2);
                    cursorY = Math.floor(fbHeight() / 2);
                    log('Connected: ' + desktopName + ' ' + fbWidth() + 'x' + fbHeight());

                    // Sync cursor coordinate whenever direct touch sends a mouse event
                    const origSendMouse = rfb._sendMouse ? rfb._sendMouse.bind(rfb) : null;
                    if (origSendMouse) {
                        rfb._sendMouse = function (x, y, mask) {
                            if (!isTrackpadMode && rfb._display) {
                                try {
                                    cursorX = rfb._display.absX(x);
                                    cursorY = rfb._display.absY(y);
                                } catch (e) {}
                            }
                            return origSendMouse(x, y, mask);
                        };
                    }

                    resetZoom();
                    window.novnc.setTrackpadMode(isTrackpadMode);
                    drawCursor();
                    bridge('onConnected', desktopName, fbWidth(), fbHeight());
                });

                rfb.addEventListener('disconnect', (e) => {
                    const clean = !!(e.detail && e.detail.clean);
                    const reason = (e.detail && e.detail.reason) ? e.detail.reason : '';
                    log('Disconnected clean=' + clean + ' reason=' + reason);
                    cursorElement.style.display = 'none';
                    resetZoom();
                    bridge('onDisconnected', clean, reason);
                });

                rfb.addEventListener('credentialsrequired', () => bridge('onCredentialsRequired'));

                rfb.addEventListener('desktopname', (e) => {
                    desktopName = e.detail.name || desktopName;
                    bridge('onDesktopName', desktopName);
                });

                rfb.addEventListener('bell', () => bridge('onBell'));

                rfb.addEventListener('clipboard', (e) => bridge('onClipboard', e.detail.text || ''));

                rfb.addEventListener('securityfailure', (e) => {
                    bridge('onSecurityFailure',
                        (e.detail && e.detail.status) ? e.detail.status : 0,
                        (e.detail && e.detail.reason) ? e.detail.reason : '');
                });

                window.addEventListener('resize', () => {
                    resetZoom();
                    drawCursor();
                });

                if (window.ResizeObserver && rfb._canvas) {
                    try {
                        new ResizeObserver(() => drawCursor()).observe(rfb._canvas);
                    } catch (e) {}
                }
            } catch (err) {
                log('Connection error: ' + err.message);
                bridge('onDisconnected', false, err.message);
            }
        },

        disconnect: function () {
            scrollQueue = [];
            if (scrollTimer) { clearTimeout(scrollTimer); scrollTimer = null; }
            if (rfb) {
                try { rfb.disconnect(); } catch (e) { log('disconnect: ' + e.message); }
                rfb = null;
            }
            cursorElement.style.display = 'none';
            resetZoom();
        },

        sendCredentials: function (password) {
            if (rfb) rfb.sendCredentials({ password: password });
        },

        sendCtrlAltDel: function () {
            if (rfb) rfb.sendCtrlAltDel();
        },

        sendKey: function (keysym, code, down) {
            if (rfb) rfb.sendKey(keysym, code || '', !!down);
        },

        sendKeyPress: function (keysym, code) {
            if (!rfb) return;
            rfb.sendKey(keysym, code || '', true);
            rfb.sendKey(keysym, code || '', false);
        },

        sendString: function (str) {
            if (!rfb || !str) return;
            for (let i = 0; i < str.length; i++) {
                let keysym = str.codePointAt(i);
                if (keysym > 0xffff) i++;
                if (keysym === 10 || keysym === 13) {
                    keysym = KeyTable.XK_Return;
                } else if (keysym < 0x20) {
                    continue;
                } else if (keysym > 0xff) {
                    keysym = 0x01000000 + keysym;
                }
                rfb.sendKey(keysym, '', true);
                rfb.sendKey(keysym, '', false);
            }
        },

        clipboardPaste: function (text) {
            if (rfb && text) rfb.clipboardPasteFrom(text);
        },

        movePointerRelative: function (dxPixels, dyPixels, buttonMask) {
            if (!isConnected()) return;
            const canvas = rfb._canvas;
            if (!canvas) return;
            const rect = canvas.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            const w = fbWidth() || 1;
            const h = fbHeight() || 1;

            const fx = (w / Math.max(1, rect.width)) / dpr;
            const fy = (h / Math.max(1, rect.height)) / dpr;

            let dx = dxPixels * fx * pointerGain;
            let dy = dyPixels * fy * pointerGain;

            if (accelEnabled) {
                const speed = Math.hypot(dx, dy);
                if (speed > 4) {
                    const gain = 1.0 + Math.min(1.6, (speed - 4) / 20.0);
                    dx *= gain;
                    dy *= gain;
                }
            }

            sendPointer(cursorX + dx, cursorY + dy, buttonMask || 0);
        },

        mouseClick: function (buttonMask, count) {
            clickMask(buttonMask || 1, count || 1);
        },

        mousePress: function (buttonMask) {
            pressButton(buttonMask || 1);
        },

        mouseRelease: function () {
            releaseButtons();
        },

        mouseScroll: function (steps, nx, ny) {
            let targetX = cursorX;
            let targetY = cursorY;
            if (typeof nx === 'number' && typeof ny === 'number' && !isTrackpadMode && rfb && rfb._canvas) {
                const rect = rfb._canvas.getBoundingClientRect();
                const curScale = rect.width / (fbWidth() || 1);
                if (curScale > 0) {
                    const cssX = nx * window.innerWidth - rect.left;
                    const cssY = ny * window.innerHeight - rect.top;
                    targetX = Math.round(cssX / curScale);
                    targetY = Math.round(cssY / curScale);
                    cursorX = targetX;
                    cursorY = targetY;
                }
            }
            scrollSteps(steps, targetX, targetY);
        },

        pointerAbsolute: function (nx, ny, buttonMask) {
            if (!isConnected() || !rfb || !rfb._canvas) return;
            const rect = rfb._canvas.getBoundingClientRect();
            const curScale = rect.width / (fbWidth() || 1);
            if (curScale <= 0) return;
            const cssX = nx * window.innerWidth - rect.left;
            const cssY = ny * window.innerHeight - rect.top;
            const fbX = Math.round(cssX / curScale);
            const fbY = Math.round(cssY / curScale);
            sendPointer(fbX, fbY, buttonMask || 0);
        },

        directTouchTap: function (nx, ny, buttonMask) {
            if (!isConnected() || !rfb || !rfb._canvas) return;
            const mask = (typeof buttonMask === 'number') ? buttonMask : 1;
            window.novnc.pointerAbsolute(nx, ny, mask);
            setTimeout(() => {
                window.novnc.pointerAbsolute(nx, ny, 0);
            }, 35);
        },

        directTouchDown: function (nx, ny) {
            if (!isConnected() || !rfb || !rfb._canvas) return;
            window.novnc.pointerAbsolute(nx, ny, 1);
        },

        directTouchMove: function (nx, ny) {
            if (!isConnected() || !rfb || !rfb._canvas) return;
            window.novnc.pointerAbsolute(nx, ny, 1);
        },

        directTouchUp: function (nx, ny) {
            if (!isConnected() || !rfb || !rfb._canvas) return;
            window.novnc.pointerAbsolute(nx, ny, 0);
        },

        getCursorPosition: function () {
            return JSON.stringify({ x: cursorX, y: cursorY, w: fbWidth(), h: fbHeight() });
        },

        // ---- Two-finger pinch-to-zoom & pan API ----

        applyPinchZoom: function (scaleDelta, focusX, focusY, panDx, panDy) {
            applyPinchZoom(scaleDelta, focusX, focusY, panDx, panDy);
        },

        resetZoom: function () {
            resetZoom();
        },

        relayout: function () {
            if (rfb) {
                try {
                    rfb._updateClip();
                    rfb._updateScale();
                } catch (e) {}
            }
            resetZoom();
            drawCursor();
        },

        getZoom: function () {
            return userZoom;
        },

        setTrackpadMode: function (enabled) {
            isTrackpadMode = !!enabled;
            drawCursor();
        },

        setPointerSensitivity: function (gain) {
            pointerGain = Math.max(0.2, Math.min(3.0, gain));
        },

        setPointerAcceleration: function (enabled) {
            accelEnabled = !!enabled;
        },

        setScaleViewport: function (scale) {
            if (rfb) {
                rfb.scaleViewport = !!scale;
                resetZoom();
                setTimeout(drawCursor, 60);
            }
        },

        setViewOnly: function (viewOnly) {
            if (rfb) rfb.viewOnly = !!viewOnly;
        },

        setQuality: function (level) {
            if (rfb && typeof level === 'number') rfb.qualityLevel = Math.max(0, Math.min(9, level));
        },

        setCompression: function (level) {
            if (rfb && typeof level === 'number') rfb.compressionLevel = Math.max(0, Math.min(9, level));
        },

        getDesktopInfo: function () {
            if (!rfb || !rfb._display) return '{}';
            return JSON.stringify({
                name: desktopName,
                width: fbWidth(),
                height: fbHeight()
            });
        }
    };

    function notifyReady() {
        if (window._bridgeNotified) return;
        window._bridgeNotified = true;
        log('Page ready: notifying AndroidBridge.onPageLoaded');
        bridge('onPageLoaded');
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        notifyReady();
    } else {
        document.addEventListener('DOMContentLoaded', notifyReady);
        window.addEventListener('load', notifyReady);
    }
})();
