/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2019 The noVNC authors
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 */

import * as Log from '../core/util/logging.js';
import _, { l10n } from './localization.js';
import { isTouchDevice, isMac, isIOS, isAndroid, isChromeOS, isSafari,
         hasScrollbarGutter, dragThreshold }
    from '../core/util/browser.js';
import { setCapture, getPointerEvent } from '../core/util/events.js';
import KeyTable from "../core/input/keysym.js";
import keysyms from "../core/input/keysymdef.js";
import Keyboard from "../core/input/keyboard.js";
import RFB from "../core/rfb.js";
import * as WebUtil from "./webutil.js";

// Import mediabunny for MP4 encoding (dynamically loaded when needed)
let mediabunnyModule = null;
async function loadMediabunny() {
    if (!mediabunnyModule) {
        mediabunnyModule = await import('https://cdn.jsdelivr.net/npm/mediabunny@1.29.1/+esm');
    }
    return mediabunnyModule;
}

const PAGE_TITLE = "noVNC";

const LINGUAS = ["cs", "de", "el", "es", "fr", "it", "ja", "ko", "nl", "pl", "pt_BR", "ru", "sv", "tr", "zh_CN", "zh_TW"];

// FakeWebSocket for playing back recordings (same as playback.js)
class FakeWebSocket {
    constructor() {
        this.binaryType = "arraybuffer";
        this.protocol = "";
        this.readyState = "open";
        this.onerror = () => {};
        this.onmessage = () => {};
        this.onopen = () => {};
        this.onclose = () => {};
    }
    send() {}
    close() {}
}

// Parse binary recording data from OPFS file
// Format: fromClient(1) + timestamp(4) + dataLen(4) + data(dataLen)
async function parseRecordingFrames(file, onProgress) {
    const frames = [];
    const serverFrameIndices = [];
    const buffer = await file.arrayBuffer();
    const data = new Uint8Array(buffer);
    let offset = 0;

    while (offset + 9 <= data.length) {
        const fromClient = data[offset] === 1;
        const timestamp = (data[offset + 1] << 24) | (data[offset + 2] << 16) | (data[offset + 3] << 8) | data[offset + 4];
        const dataLen = (data[offset + 5] << 24) | (data[offset + 6] << 16) | (data[offset + 7] << 8) | data[offset + 8];

        if (offset + 9 + dataLen > data.length) break;

        const frameData = data.slice(offset + 9, offset + 9 + dataLen);
        frames.push({
            fromClient,
            timestamp,
            data: frameData
        });

        if (!fromClient) {
            serverFrameIndices.push(frames.length - 1);
        }

        offset += 9 + dataLen;

        if (onProgress && frames.length % 100 === 0) {
            onProgress(`Parsed ${frames.length} frames...`);
        }
    }

    return { frames, serverFrameIndices };
}

// Convert dataURL to ImageBitmap
async function dataUrlToImageBitmap(dataUrl) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = async () => {
            try {
                const bitmap = await createImageBitmap(img);
                resolve(bitmap);
            } catch (e) {
                reject(e);
            }
        };
        img.onerror = (e) => reject(new Error('Failed to load image: ' + e));
        img.src = dataUrl;
    });
}

// RecordingPlayer - plays through frames and captures after each server frame
class RecordingPlayer {
    constructor(frames, serverFrameIndices, targetContainer) {
        this._frames = frames;
        this._serverFrameIndices = serverFrameIndices;
        this._frameLength = frames.length;
        this._frameIndex = 0;
        this._serverFramePos = 0;
        this._running = false;
        this._captures = [];
        this._targetContainer = targetContainer;

        this._ws = null;
        this._rfb = null;

        this.onprogress = () => {};
    }

    async run() {
        return new Promise((resolve) => {
            this._ws = new FakeWebSocket();
            this._rfb = new RFB(this._targetContainer, this._ws);
            this._rfb.viewOnly = true;

            this._rfb.addEventListener("disconnect", () => {});
            this._rfb.addEventListener("credentialsrequired", () => {
                this._rfb.sendCredentials({ username: "", password: "", target: "" });
            });

            this._frameIndex = 0;
            this._serverFramePos = 0;
            this._running = true;
            this._captures = [];

            this._resolvePromise = resolve;
            this._queueNextPacket();
        });
    }

    _queueNextPacket() {
        if (!this._running) return;

        // Skip client frames
        while (this._frameIndex < this._frameLength &&
               this._frames[this._frameIndex].fromClient) {
            this._frameIndex++;
        }

        if (this._frameIndex >= this._frameLength) {
            this._finish();
            return;
        }

        setTimeout(() => this._doPacket(), 0);
    }

    async _doPacket() {
        if (!this._running) return;

        // Wait if RFB is flushing
        if (this._rfb._flushing) {
            await this._rfb._display.flush();
        }

        const frame = this._frames[this._frameIndex];

        // Send frame to RFB via fake websocket
        this._ws.onmessage({ data: frame.data });

        // Wait for display to settle
        if (this._rfb._display && this._rfb._display.pending()) {
            await this._rfb._display.flush();
        }

        // Small delay to ensure rendering is complete
        await new Promise(r => setTimeout(r, 5));

        // Capture screenshot
        let dataUrl = '';
        let vncWidth = 0;
        let vncHeight = 0;
        try {
            if (this._rfb._display) {
                dataUrl = this._rfb._display.toDataURL('image/png');
                vncWidth = this._rfb._fbWidth || 0;
                vncHeight = this._rfb._fbHeight || 0;
            }
        } catch (e) {
            Log.Warn('Capture failed:', e);
        }

        this._captures.push({
            index: this._serverFramePos,
            frameIndex: this._frameIndex,
            timestamp: frame.timestamp,
            dataUrl,
            vncWidth,
            vncHeight
        });

        this._serverFramePos++;

        // Progress callback
        if (this._serverFramePos % 10 === 0) {
            this.onprogress(this._serverFramePos, this._serverFrameIndices.length);
        }

        this._frameIndex++;
        this._queueNextPacket();
    }

    _finish() {
        this._running = false;

        if (this._rfb._display && this._rfb._display.pending()) {
            this._rfb._display.flush().then(() => {
                this._resolvePromise(this._captures);
            });
        } else {
            this._resolvePromise(this._captures);
        }
    }
}

// Encode captures to MP4 video using mediabunny
async function encodeCapturesToMp4(captures, onProgress) {
    const { Output, Mp4OutputFormat, BufferTarget, VideoSampleSource, VideoSample, QUALITY_HIGH } = await loadMediabunny();

    // Filter valid captures
    const validCaptures = captures.filter(c => c.dataUrl && c.dataUrl.length > 100);
    if (validCaptures.length === 0) {
        throw new Error('No valid frames to encode');
    }

    // Get dimensions from captures
    let width = 0;
    let height = 0;
    for (let i = validCaptures.length - 1; i >= 0; i--) {
        if (validCaptures[i].vncWidth && validCaptures[i].vncHeight) {
            width = validCaptures[i].vncWidth;
            height = validCaptures[i].vncHeight;
            break;
        }
    }

    // Fallback to captured image dimensions
    if (width === 0 || height === 0) {
        const firstBitmap = await dataUrlToImageBitmap(validCaptures[0].dataUrl);
        width = firstBitmap.width;
        height = firstBitmap.height;
        firstBitmap.close();
    }

    // Ensure dimensions are even (required for H.264)
    const encodedWidth = width % 2 === 0 ? width : width + 1;
    const encodedHeight = height % 2 === 0 ? height : height + 1;

    onProgress && onProgress(`Encoding ${validCaptures.length} frames at ${encodedWidth}x${encodedHeight}...`);

    // Create output with mediabunny
    const output = new Output({
        format: new Mp4OutputFormat(),
        target: new BufferTarget(),
    });

    const videoSource = new VideoSampleSource({
        codec: 'avc',
        bitrate: QUALITY_HIGH,
    });

    output.addVideoTrack(videoSource);
    await output.start();

    // Create canvas for frame rendering
    const frameCanvas = new OffscreenCanvas(encodedWidth, encodedHeight);
    const frameCtx = frameCanvas.getContext('2d', { alpha: true });

    // Find first opaque frame
    let firstOpaqueTimestamp = null;
    frameCtx.clearRect(0, 0, encodedWidth, encodedHeight);

    for (let i = 0; i < validCaptures.length; i++) {
        const cap = validCaptures[i];
        try {
            const bitmap = await dataUrlToImageBitmap(cap.dataUrl);
            frameCtx.drawImage(bitmap, 0, 0, encodedWidth, encodedHeight);
            bitmap.close();

            // Check if frame is opaque
            const imageData = frameCtx.getImageData(0, 0, encodedWidth, encodedHeight);
            let isOpaque = true;
            for (let j = 3; j < imageData.data.length; j += 400) {
                if (imageData.data[j] < 255) { isOpaque = false; break; }
            }

            if (isOpaque) {
                firstOpaqueTimestamp = cap.timestamp;
                break;
            }
        } catch (e) {
            Log.Warn(`Error checking frame ${i}:`, e);
        }
    }

    if (firstOpaqueTimestamp === null) {
        firstOpaqueTimestamp = validCaptures[0].timestamp;
    }

    // Encode at max 24 FPS
    const maxFps = 24;
    const frameIntervalMs = 1000 / maxFps;
    const firstTimestamp = firstOpaqueTimestamp;
    const lastTimestamp = validCaptures[validCaptures.length - 1].timestamp;
    const totalDurationMs = lastTimestamp - firstTimestamp;
    const totalFrames = Math.ceil(totalDurationMs / frameIntervalMs) + 1;

    let captureIdx = 0;
    for (let frameNum = 0; frameNum < totalFrames; frameNum++) {
        const frameStartMs = frameNum * frameIntervalMs;
        const frameEndMs = (frameNum + 1) * frameIntervalMs;

        // Find last capture in this frame's time window
        let lastCaptureInBucket = null;
        while (captureIdx < validCaptures.length) {
            const capTimeMs = validCaptures[captureIdx].timestamp - firstTimestamp;
            if (capTimeMs < 0) {
                captureIdx++;
                continue;
            }
            if (capTimeMs < frameEndMs) {
                lastCaptureInBucket = validCaptures[captureIdx];
                captureIdx++;
            } else {
                break;
            }
        }

        if (!lastCaptureInBucket && frameNum > 0) {
            for (let i = captureIdx - 1; i >= 0; i--) {
                if (validCaptures[i].dataUrl && validCaptures[i].dataUrl.length > 100) {
                    lastCaptureInBucket = validCaptures[i];
                    break;
                }
            }
        }

        if (!lastCaptureInBucket) continue;

        if (frameNum % 20 === 0) {
            onProgress && onProgress(`Encoding frame ${frameNum + 1}/${totalFrames}...`);
        }

        try {
            const bitmap = await dataUrlToImageBitmap(lastCaptureInBucket.dataUrl);
            frameCtx.clearRect(0, 0, encodedWidth, encodedHeight);
            frameCtx.drawImage(bitmap, 0, 0, encodedWidth, encodedHeight);
            bitmap.close();

            const timestamp = frameStartMs / 1000;
            const duration = frameIntervalMs / 1000;

            const sample = new VideoSample(frameCanvas, {
                timestamp,
                duration,
            });
            await videoSource.add(sample);
            sample.close();
        } catch (e) {
            Log.Warn(`Failed to encode frame ${frameNum}:`, e);
        }
    }

    videoSource.close();
    await output.finalize();

    return {
        mp4Buffer: output.target.buffer,
        startTimestampOffset: firstOpaqueTimestamp,
        width: encodedWidth,
        height: encodedHeight,
        duration: totalDurationMs
    };
}

const UI = {

    customSettings: {},

    connected: false,
    desktopName: "",

    statusTimeout: null,
    hideKeyboardTimeout: null,
    idleControlbarTimeout: null,
    closeControlbarTimeout: null,

    // Recording state
    recording: false,
    recordingPending: false,  // True if recording should start on next connect
    recordingStartTime: null,
    recordingFrameCount: 0,
    recordingBytesWritten: 0,
    recordingFileHandle: null,
    recordingWritable: null,
    recordingWriteQueue: Promise.resolve(),  // Chain writes to ensure order
    recordingWebSocket: null,  // WebSocket for streaming to external server
    recordingEvents: [],  // Input events captured during recording (for mp4 format)
    recordingKeyBuffer: [],  // Buffer for grouping rapid keystrokes
    recordingLastKeyTime: 0,  // Last key timestamp for buffering
    recordingLastMousePos: { x: 0, y: 0 },  // Last mouse position
    recordingDragStart: null,  // Drag start position
    recordingEventHandlers: null,  // Event handlers for cleanup

    controlbarGrabbed: false,
    controlbarDrag: false,
    controlbarMouseDownClientY: 0,
    controlbarMouseDownOffsetY: 0,

    lastKeyboardinput: null,
    defaultKeyboardinputLen: 100,

    inhibitReconnect: true,
    reconnectCallback: null,
    reconnectPassword: null,

    async start(options={}) {
        UI.customSettings = options.settings || {};
        if (UI.customSettings.defaults === undefined) {
            UI.customSettings.defaults = {};
        }
        if (UI.customSettings.mandatory === undefined) {
            UI.customSettings.mandatory = {};
        }

        // Set up translations
        try {
            await l10n.setup(LINGUAS, "app/locale/");
        } catch (err) {
            Log.Error("Failed to load translations: " + err);
        }

        // Initialize setting storage
        await WebUtil.initSettings();

        // Wait for the page to load
        if (document.readyState !== "interactive" && document.readyState !== "complete") {
            await new Promise((resolve, reject) => {
                document.addEventListener('DOMContentLoaded', resolve);
            });
        }

        UI.initSettings();

        // Translate the DOM
        l10n.translateDOM();

        // We rely on modern APIs which might not be available in an
        // insecure context
        if (!window.isSecureContext) {
            // FIXME: This gets hidden when connecting
            UI.showStatus(_("Running without HTTPS is not recommended, crashes or other issues are likely."), 'error');
        }

        // Try to fetch version number
        try {
            let response = await fetch('./package.json');
            if (!response.ok) {
                throw Error("" + response.status + " " + response.statusText);
            }

            let packageInfo = await response.json();
            Array.from(document.getElementsByClassName('noVNC_version')).forEach(el => el.innerText = packageInfo.version);
        } catch (err) {
            Log.Error("Couldn't fetch package.json: " + err);
            Array.from(document.getElementsByClassName('noVNC_version_wrapper'))
                .concat(Array.from(document.getElementsByClassName('noVNC_version_separator')))
                .forEach(el => el.style.display = 'none');
        }

        // Adapt the interface for touch screen devices
        if (isTouchDevice) {
            // Remove the address bar
            setTimeout(() => window.scrollTo(0, 1), 100);
        }

        // Restore control bar position
        if (WebUtil.readSetting('controlbar_pos') === 'right') {
            UI.toggleControlbarSide();
        }

        UI.initFullscreen();

        // Setup event handlers
        UI.addControlbarHandlers();
        UI.addTouchSpecificHandlers();
        UI.addExtraKeysHandlers();
        UI.addMachineHandlers();
        UI.addConnectionControlHandlers();
        UI.addClipboardHandlers();
        UI.addSettingsHandlers();
        UI.addRecordingHandlers();
        document.getElementById("noVNC_status")
            .addEventListener('click', UI.hideStatus);

        // Bootstrap fallback input handler
        UI.keyboardinputReset();

        UI.openControlbar();

        UI.updateVisualState('init');

        document.documentElement.classList.remove("noVNC_loading");

        // Check for autorecord setting
        let autorecord = UI.getSetting('autorecord');
        if (autorecord === 'true' || autorecord == '1') {
            UI.recordingPending = true;
            document.getElementById('noVNC_record_button').classList.add('noVNC_selected');
            document.getElementById('noVNC_record_button').classList.add('noVNC_recording');
        }

        let autoconnect = UI.getSetting('autoconnect');
        if (autoconnect === 'true' || autoconnect == '1') {
            autoconnect = true;
            UI.connect();
        } else {
            autoconnect = false;
            // Show the connect panel on first load unless autoconnecting
            UI.openConnectPanel();
        }
    },

    initFullscreen() {
        // Only show the button if fullscreen is properly supported
        // * Safari doesn't support alphanumerical input while in fullscreen
        if (!isSafari() &&
            (document.documentElement.requestFullscreen ||
             document.documentElement.mozRequestFullScreen ||
             document.documentElement.webkitRequestFullscreen ||
             document.body.msRequestFullscreen)) {
            document.getElementById('noVNC_fullscreen_button')
                .classList.remove("noVNC_hidden");
            UI.addFullscreenHandlers();
        }
    },

    initSettings() {
        // Logging selection dropdown
        const llevels = ['error', 'warn', 'info', 'debug'];
        for (let i = 0; i < llevels.length; i += 1) {
            UI.addOption(document.getElementById('noVNC_setting_logging'), llevels[i], llevels[i]);
        }

        // Settings with immediate effects
        UI.initSetting('logging', 'warn');
        UI.updateLogging();

        UI.setupSettingLabels();

        /* Populate the controls if defaults are provided in the URL */
        UI.initSetting('host', '');
        UI.initSetting('port', 0);
        UI.initSetting('encrypt', (window.location.protocol === "https:"));
        UI.initSetting('password');
        UI.initSetting('autoconnect', false);
        UI.initSetting('view_clip', false);
        UI.initSetting('resize', 'off');
        UI.initSetting('quality', 6);
        UI.initSetting('compression', 2);
        UI.initSetting('shared', true);
        UI.initSetting('bell', 'on');
        UI.initSetting('view_only', false);
        UI.initSetting('show_dot', false);
        UI.initSetting('path', 'websockify');
        UI.initSetting('repeaterID', '');
        UI.initSetting('reconnect', false);
        UI.initSetting('reconnect_delay', 5000);
        UI.initSetting('autorecord', false);
        UI.initSetting('record_url', '');  // WebSocket URL to stream recording to
        UI.initSetting('record_format', 'bin');  // Recording format: bin, mp4, or js
        UI.initSetting('record_streaming', true);  // Stream to server (only for bin format)
    },
    // Adds a link to the label elements on the corresponding input elements
    setupSettingLabels() {
        const labels = document.getElementsByTagName('LABEL');
        for (let i = 0; i < labels.length; i++) {
            const htmlFor = labels[i].htmlFor;
            if (htmlFor != '') {
                const elem = document.getElementById(htmlFor);
                if (elem) elem.label = labels[i];
            } else {
                // If 'for' isn't set, use the first input element child
                const children = labels[i].children;
                for (let j = 0; j < children.length; j++) {
                    if (children[j].form !== undefined) {
                        children[j].label = labels[i];
                        break;
                    }
                }
            }
        }
    },

/* ------^-------
*     /INIT
* ==============
* EVENT HANDLERS
* ------v------*/

    addControlbarHandlers() {
        document.getElementById("noVNC_control_bar")
            .addEventListener('mousemove', UI.activateControlbar);
        document.getElementById("noVNC_control_bar")
            .addEventListener('mouseup', UI.activateControlbar);
        document.getElementById("noVNC_control_bar")
            .addEventListener('mousedown', UI.activateControlbar);
        document.getElementById("noVNC_control_bar")
            .addEventListener('keydown', UI.activateControlbar);

        document.getElementById("noVNC_control_bar")
            .addEventListener('mousedown', UI.keepControlbar);
        document.getElementById("noVNC_control_bar")
            .addEventListener('keydown', UI.keepControlbar);

        document.getElementById("noVNC_view_drag_button")
            .addEventListener('click', UI.toggleViewDrag);

        document.getElementById("noVNC_control_bar_handle")
            .addEventListener('mousedown', UI.controlbarHandleMouseDown);
        document.getElementById("noVNC_control_bar_handle")
            .addEventListener('mouseup', UI.controlbarHandleMouseUp);
        document.getElementById("noVNC_control_bar_handle")
            .addEventListener('mousemove', UI.dragControlbarHandle);
        // resize events aren't available for elements
        window.addEventListener('resize', UI.updateControlbarHandle);

        const exps = document.getElementsByClassName("noVNC_expander");
        for (let i = 0;i < exps.length;i++) {
            exps[i].addEventListener('click', UI.toggleExpander);
        }
    },

    addTouchSpecificHandlers() {
        document.getElementById("noVNC_keyboard_button")
            .addEventListener('click', UI.toggleVirtualKeyboard);

        UI.touchKeyboard = new Keyboard(document.getElementById('noVNC_keyboardinput'));
        UI.touchKeyboard.onkeyevent = UI.keyEvent;
        UI.touchKeyboard.grab();
        document.getElementById("noVNC_keyboardinput")
            .addEventListener('input', UI.keyInput);
        document.getElementById("noVNC_keyboardinput")
            .addEventListener('focus', UI.onfocusVirtualKeyboard);
        document.getElementById("noVNC_keyboardinput")
            .addEventListener('blur', UI.onblurVirtualKeyboard);
        document.getElementById("noVNC_keyboardinput")
            .addEventListener('submit', () => false);

        document.documentElement
            .addEventListener('mousedown', UI.keepVirtualKeyboard, true);

        document.getElementById("noVNC_control_bar")
            .addEventListener('touchstart', UI.activateControlbar);
        document.getElementById("noVNC_control_bar")
            .addEventListener('touchmove', UI.activateControlbar);
        document.getElementById("noVNC_control_bar")
            .addEventListener('touchend', UI.activateControlbar);
        document.getElementById("noVNC_control_bar")
            .addEventListener('input', UI.activateControlbar);

        document.getElementById("noVNC_control_bar")
            .addEventListener('touchstart', UI.keepControlbar);
        document.getElementById("noVNC_control_bar")
            .addEventListener('input', UI.keepControlbar);

        document.getElementById("noVNC_control_bar_handle")
            .addEventListener('touchstart', UI.controlbarHandleMouseDown);
        document.getElementById("noVNC_control_bar_handle")
            .addEventListener('touchend', UI.controlbarHandleMouseUp);
        document.getElementById("noVNC_control_bar_handle")
            .addEventListener('touchmove', UI.dragControlbarHandle);
    },

    addExtraKeysHandlers() {
        document.getElementById("noVNC_toggle_extra_keys_button")
            .addEventListener('click', UI.toggleExtraKeys);
        document.getElementById("noVNC_toggle_ctrl_button")
            .addEventListener('click', UI.toggleCtrl);
        document.getElementById("noVNC_toggle_windows_button")
            .addEventListener('click', UI.toggleWindows);
        document.getElementById("noVNC_toggle_alt_button")
            .addEventListener('click', UI.toggleAlt);
        document.getElementById("noVNC_send_tab_button")
            .addEventListener('click', UI.sendTab);
        document.getElementById("noVNC_send_esc_button")
            .addEventListener('click', UI.sendEsc);
        document.getElementById("noVNC_send_ctrl_alt_del_button")
            .addEventListener('click', UI.sendCtrlAltDel);
    },

    addMachineHandlers() {
        document.getElementById("noVNC_shutdown_button")
            .addEventListener('click', () => UI.rfb.machineShutdown());
        document.getElementById("noVNC_reboot_button")
            .addEventListener('click', () => UI.rfb.machineReboot());
        document.getElementById("noVNC_reset_button")
            .addEventListener('click', () => UI.rfb.machineReset());
        document.getElementById("noVNC_power_button")
            .addEventListener('click', UI.togglePowerPanel);
    },

    addConnectionControlHandlers() {
        document.getElementById("noVNC_disconnect_button")
            .addEventListener('click', UI.disconnect);
        document.getElementById("noVNC_connect_button")
            .addEventListener('click', UI.connect);
        document.getElementById("noVNC_cancel_reconnect_button")
            .addEventListener('click', UI.cancelReconnect);

        document.getElementById("noVNC_approve_server_button")
            .addEventListener('click', UI.approveServer);
        document.getElementById("noVNC_reject_server_button")
            .addEventListener('click', UI.rejectServer);
        document.getElementById("noVNC_credentials_button")
            .addEventListener('click', UI.setCredentials);
    },

    addClipboardHandlers() {
        document.getElementById("noVNC_clipboard_button")
            .addEventListener('click', UI.toggleClipboardPanel);
        document.getElementById("noVNC_clipboard_text")
            .addEventListener('change', UI.clipboardSend);
    },

    // Add a call to save settings when the element changes,
    // unless the optional parameter changeFunc is used instead.
    addSettingChangeHandler(name, changeFunc) {
        const settingElem = document.getElementById("noVNC_setting_" + name);
        if (changeFunc === undefined) {
            changeFunc = () => UI.saveSetting(name);
        }
        settingElem.addEventListener('change', changeFunc);
    },

    addSettingsHandlers() {
        document.getElementById("noVNC_settings_button")
            .addEventListener('click', UI.toggleSettingsPanel);

        UI.addSettingChangeHandler('encrypt');
        UI.addSettingChangeHandler('resize');
        UI.addSettingChangeHandler('resize', UI.applyResizeMode);
        UI.addSettingChangeHandler('resize', UI.updateViewClip);
        UI.addSettingChangeHandler('quality');
        UI.addSettingChangeHandler('quality', UI.updateQuality);
        UI.addSettingChangeHandler('compression');
        UI.addSettingChangeHandler('compression', UI.updateCompression);
        UI.addSettingChangeHandler('view_clip');
        UI.addSettingChangeHandler('view_clip', UI.updateViewClip);
        UI.addSettingChangeHandler('shared');
        UI.addSettingChangeHandler('view_only');
        UI.addSettingChangeHandler('view_only', UI.updateViewOnly);
        UI.addSettingChangeHandler('show_dot');
        UI.addSettingChangeHandler('show_dot', UI.updateShowDotCursor);
        UI.addSettingChangeHandler('host');
        UI.addSettingChangeHandler('port');
        UI.addSettingChangeHandler('path');
        UI.addSettingChangeHandler('repeaterID');
        UI.addSettingChangeHandler('logging');
        UI.addSettingChangeHandler('logging', UI.updateLogging);
        UI.addSettingChangeHandler('reconnect');
        UI.addSettingChangeHandler('reconnect_delay');
    },

    addRecordingHandlers() {
        document.getElementById("noVNC_record_button")
            .addEventListener('click', UI.toggleRecordingPanel);
        document.getElementById("noVNC_record_start_button")
            .addEventListener('click', UI.startRecording);
        document.getElementById("noVNC_record_stop_button")
            .addEventListener('click', UI.stopRecording);
        document.getElementById("noVNC_record_download_button")
            .addEventListener('click', UI.downloadRecording);

        // Ensure recording is properly closed when page unloads
        const closeRecordingFile = () => {
            if (UI.recording && UI.recordingWritable) {
                UI.recording = false;
                UI.recordingWriteQueue.then(() => {
                    if (UI.recordingWritable) {
                        UI.recordingWritable.close();
                        UI.recordingWritable = null;
                    }
                });
            }
        };
        window.addEventListener('beforeunload', closeRecordingFile);
        window.addEventListener('pagehide', closeRecordingFile);
    },

    addFullscreenHandlers() {
        document.getElementById("noVNC_fullscreen_button")
            .addEventListener('click', UI.toggleFullscreen);

        window.addEventListener('fullscreenchange', UI.updateFullscreenButton);
        window.addEventListener('mozfullscreenchange', UI.updateFullscreenButton);
        window.addEventListener('webkitfullscreenchange', UI.updateFullscreenButton);
        window.addEventListener('msfullscreenchange', UI.updateFullscreenButton);
    },

/* ------^-------
 * /EVENT HANDLERS
 * ==============
 *     VISUAL
 * ------v------*/

    // Disable/enable controls depending on connection state
    updateVisualState(state) {

        document.documentElement.classList.remove("noVNC_connecting");
        document.documentElement.classList.remove("noVNC_connected");
        document.documentElement.classList.remove("noVNC_disconnecting");
        document.documentElement.classList.remove("noVNC_reconnecting");

        const transitionElem = document.getElementById("noVNC_transition_text");
        switch (state) {
            case 'init':
                break;
            case 'connecting':
                transitionElem.textContent = _("Connecting...");
                document.documentElement.classList.add("noVNC_connecting");
                break;
            case 'connected':
                document.documentElement.classList.add("noVNC_connected");
                break;
            case 'disconnecting':
                transitionElem.textContent = _("Disconnecting...");
                document.documentElement.classList.add("noVNC_disconnecting");
                break;
            case 'disconnected':
                break;
            case 'reconnecting':
                transitionElem.textContent = _("Reconnecting...");
                document.documentElement.classList.add("noVNC_reconnecting");
                break;
            default:
                Log.Error("Invalid visual state: " + state);
                UI.showStatus(_("Internal error"), 'error');
                return;
        }

        if (UI.connected) {
            UI.updateViewClip();

            UI.disableSetting('encrypt');
            UI.disableSetting('shared');
            UI.disableSetting('host');
            UI.disableSetting('port');
            UI.disableSetting('path');
            UI.disableSetting('repeaterID');

            // Hide the controlbar after 2 seconds
            UI.closeControlbarTimeout = setTimeout(UI.closeControlbar, 2000);
        } else {
            UI.enableSetting('encrypt');
            UI.enableSetting('shared');
            UI.enableSetting('host');
            UI.enableSetting('port');
            UI.enableSetting('path');
            UI.enableSetting('repeaterID');
            UI.updatePowerButton();
            UI.keepControlbar();
        }

        // State change closes dialogs as they may not be relevant
        // anymore
        UI.closeAllPanels();
        document.getElementById('noVNC_verify_server_dlg')
            .classList.remove('noVNC_open');
        document.getElementById('noVNC_credentials_dlg')
            .classList.remove('noVNC_open');
    },

    showStatus(text, statusType, time) {
        const statusElem = document.getElementById('noVNC_status');

        if (typeof statusType === 'undefined') {
            statusType = 'normal';
        }

        // Don't overwrite more severe visible statuses and never
        // errors. Only shows the first error.
        if (statusElem.classList.contains("noVNC_open")) {
            if (statusElem.classList.contains("noVNC_status_error")) {
                return;
            }
            if (statusElem.classList.contains("noVNC_status_warn") &&
                statusType === 'normal') {
                return;
            }
        }

        clearTimeout(UI.statusTimeout);

        switch (statusType) {
            case 'error':
                statusElem.classList.remove("noVNC_status_warn");
                statusElem.classList.remove("noVNC_status_normal");
                statusElem.classList.add("noVNC_status_error");
                break;
            case 'warning':
            case 'warn':
                statusElem.classList.remove("noVNC_status_error");
                statusElem.classList.remove("noVNC_status_normal");
                statusElem.classList.add("noVNC_status_warn");
                break;
            case 'normal':
            case 'info':
            default:
                statusElem.classList.remove("noVNC_status_error");
                statusElem.classList.remove("noVNC_status_warn");
                statusElem.classList.add("noVNC_status_normal");
                break;
        }

        statusElem.textContent = text;
        statusElem.classList.add("noVNC_open");

        // If no time was specified, show the status for 1.5 seconds
        if (typeof time === 'undefined') {
            time = 1500;
        }

        // Error messages do not timeout
        if (statusType !== 'error') {
            UI.statusTimeout = window.setTimeout(UI.hideStatus, time);
        }
    },

    hideStatus() {
        clearTimeout(UI.statusTimeout);
        document.getElementById('noVNC_status').classList.remove("noVNC_open");
    },

    activateControlbar(event) {
        clearTimeout(UI.idleControlbarTimeout);
        // We manipulate the anchor instead of the actual control
        // bar in order to avoid creating new a stacking group
        document.getElementById('noVNC_control_bar_anchor')
            .classList.remove("noVNC_idle");
        UI.idleControlbarTimeout = window.setTimeout(UI.idleControlbar, 2000);
    },

    idleControlbar() {
        // Don't fade if a child of the control bar has focus
        if (document.getElementById('noVNC_control_bar')
            .contains(document.activeElement) && document.hasFocus()) {
            UI.activateControlbar();
            return;
        }

        document.getElementById('noVNC_control_bar_anchor')
            .classList.add("noVNC_idle");
    },

    keepControlbar() {
        clearTimeout(UI.closeControlbarTimeout);
    },

    openControlbar() {
        document.getElementById('noVNC_control_bar')
            .classList.add("noVNC_open");
    },

    closeControlbar() {
        UI.closeAllPanels();
        document.getElementById('noVNC_control_bar')
            .classList.remove("noVNC_open");
        UI.rfb.focus();
    },

    toggleControlbar() {
        if (document.getElementById('noVNC_control_bar')
            .classList.contains("noVNC_open")) {
            UI.closeControlbar();
        } else {
            UI.openControlbar();
        }
    },

    toggleControlbarSide() {
        // Temporarily disable animation, if bar is displayed, to avoid weird
        // movement. The transitionend-event will not fire when display=none.
        const bar = document.getElementById('noVNC_control_bar');
        const barDisplayStyle = window.getComputedStyle(bar).display;
        if (barDisplayStyle !== 'none') {
            bar.style.transitionDuration = '0s';
            bar.addEventListener('transitionend', () => bar.style.transitionDuration = '');
        }

        const anchor = document.getElementById('noVNC_control_bar_anchor');
        if (anchor.classList.contains("noVNC_right")) {
            WebUtil.writeSetting('controlbar_pos', 'left');
            anchor.classList.remove("noVNC_right");
        } else {
            WebUtil.writeSetting('controlbar_pos', 'right');
            anchor.classList.add("noVNC_right");
        }

        // Consider this a movement of the handle
        UI.controlbarDrag = true;

        // The user has "followed" hint, let's hide it until the next drag
        UI.showControlbarHint(false, false);
    },

    showControlbarHint(show, animate=true) {
        const hint = document.getElementById('noVNC_control_bar_hint');

        if (animate) {
            hint.classList.remove("noVNC_notransition");
        } else {
            hint.classList.add("noVNC_notransition");
        }

        if (show) {
            hint.classList.add("noVNC_active");
        } else {
            hint.classList.remove("noVNC_active");
        }
    },

    dragControlbarHandle(e) {
        if (!UI.controlbarGrabbed) return;

        const ptr = getPointerEvent(e);

        const anchor = document.getElementById('noVNC_control_bar_anchor');
        if (ptr.clientX < (window.innerWidth * 0.1)) {
            if (anchor.classList.contains("noVNC_right")) {
                UI.toggleControlbarSide();
            }
        } else if (ptr.clientX > (window.innerWidth * 0.9)) {
            if (!anchor.classList.contains("noVNC_right")) {
                UI.toggleControlbarSide();
            }
        }

        if (!UI.controlbarDrag) {
            const dragDistance = Math.abs(ptr.clientY - UI.controlbarMouseDownClientY);

            if (dragDistance < dragThreshold) return;

            UI.controlbarDrag = true;
        }

        const eventY = ptr.clientY - UI.controlbarMouseDownOffsetY;

        UI.moveControlbarHandle(eventY);

        e.preventDefault();
        e.stopPropagation();
        UI.keepControlbar();
        UI.activateControlbar();
    },

    // Move the handle but don't allow any position outside the bounds
    moveControlbarHandle(viewportRelativeY) {
        const handle = document.getElementById("noVNC_control_bar_handle");
        const handleHeight = handle.getBoundingClientRect().height;
        const controlbarBounds = document.getElementById("noVNC_control_bar")
            .getBoundingClientRect();
        const margin = 10;

        // These heights need to be non-zero for the below logic to work
        if (handleHeight === 0 || controlbarBounds.height === 0) {
            return;
        }

        let newY = viewportRelativeY;

        // Check if the coordinates are outside the control bar
        if (newY < controlbarBounds.top + margin) {
            // Force coordinates to be below the top of the control bar
            newY = controlbarBounds.top + margin;

        } else if (newY > controlbarBounds.top +
                   controlbarBounds.height - handleHeight - margin) {
            // Force coordinates to be above the bottom of the control bar
            newY = controlbarBounds.top +
                controlbarBounds.height - handleHeight - margin;
        }

        // Corner case: control bar too small for stable position
        if (controlbarBounds.height < (handleHeight + margin * 2)) {
            newY = controlbarBounds.top +
                (controlbarBounds.height - handleHeight) / 2;
        }

        // The transform needs coordinates that are relative to the parent
        const parentRelativeY = newY - controlbarBounds.top;
        handle.style.transform = "translateY(" + parentRelativeY + "px)";
    },

    updateControlbarHandle() {
        // Since the control bar is fixed on the viewport and not the page,
        // the move function expects coordinates relative the the viewport.
        const handle = document.getElementById("noVNC_control_bar_handle");
        const handleBounds = handle.getBoundingClientRect();
        UI.moveControlbarHandle(handleBounds.top);
    },

    controlbarHandleMouseUp(e) {
        if ((e.type == "mouseup") && (e.button != 0)) return;

        // mouseup and mousedown on the same place toggles the controlbar
        if (UI.controlbarGrabbed && !UI.controlbarDrag) {
            UI.toggleControlbar();
            e.preventDefault();
            e.stopPropagation();
            UI.keepControlbar();
            UI.activateControlbar();
        }
        UI.controlbarGrabbed = false;
        UI.showControlbarHint(false);
    },

    controlbarHandleMouseDown(e) {
        if ((e.type == "mousedown") && (e.button != 0)) return;

        const ptr = getPointerEvent(e);

        const handle = document.getElementById("noVNC_control_bar_handle");
        const bounds = handle.getBoundingClientRect();

        // Touch events have implicit capture
        if (e.type === "mousedown") {
            setCapture(handle);
        }

        UI.controlbarGrabbed = true;
        UI.controlbarDrag = false;

        UI.showControlbarHint(true);

        UI.controlbarMouseDownClientY = ptr.clientY;
        UI.controlbarMouseDownOffsetY = ptr.clientY - bounds.top;
        e.preventDefault();
        e.stopPropagation();
        UI.keepControlbar();
        UI.activateControlbar();
    },

    toggleExpander(e) {
        if (this.classList.contains("noVNC_open")) {
            this.classList.remove("noVNC_open");
        } else {
            this.classList.add("noVNC_open");
        }
    },

/* ------^-------
 *    /VISUAL
 * ==============
 *    SETTINGS
 * ------v------*/

    // Initial page load read/initialization of settings
    initSetting(name, defVal) {
        // Has the user overridden the default value?
        if (name in UI.customSettings.defaults) {
            defVal = UI.customSettings.defaults[name];
        }
        // Check Query string followed by cookie
        let val = WebUtil.getConfigVar(name);
        if (name.startsWith('record')) {
            Log.Info("initSetting: " + name + " = " + val + " (from URL: " + (val !== null) + ", default: " + defVal + ")");
        }
        if (val === null) {
            val = WebUtil.readSetting(name, defVal);
        }
        WebUtil.setSetting(name, val);
        UI.updateSetting(name);
        // Has the user forced a value?
        if (name in UI.customSettings.mandatory) {
            val = UI.customSettings.mandatory[name];
            UI.forceSetting(name, val);
        }
        return val;
    },

    // Set the new value, update and disable form control setting
    forceSetting(name, val) {
        WebUtil.setSetting(name, val);
        UI.updateSetting(name);
        UI.disableSetting(name);
    },

    // Update cookie and form control setting. If value is not set, then
    // updates from control to current cookie setting.
    updateSetting(name) {

        // Update the settings control
        let value = UI.getSetting(name);

        const ctrl = document.getElementById('noVNC_setting_' + name);
        if (ctrl === null) {
            return;
        }

        if (ctrl.type === 'checkbox') {
            ctrl.checked = value;
        } else if (typeof ctrl.options !== 'undefined') {
            for (let i = 0; i < ctrl.options.length; i += 1) {
                if (ctrl.options[i].value === value) {
                    ctrl.selectedIndex = i;
                    break;
                }
            }
        } else {
            ctrl.value = value;
        }
    },

    // Save control setting to cookie
    saveSetting(name) {
        const ctrl = document.getElementById('noVNC_setting_' + name);
        let val;
        if (ctrl.type === 'checkbox') {
            val = ctrl.checked;
        } else if (typeof ctrl.options !== 'undefined') {
            val = ctrl.options[ctrl.selectedIndex].value;
        } else {
            val = ctrl.value;
        }
        WebUtil.writeSetting(name, val);
        //Log.Debug("Setting saved '" + name + "=" + val + "'");
        return val;
    },

    // Read form control compatible setting from cookie
    getSetting(name) {
        const ctrl = document.getElementById('noVNC_setting_' + name);
        let val = WebUtil.readSetting(name);
        if (typeof val !== 'undefined' && val !== null &&
            ctrl !== null && ctrl.type === 'checkbox') {
            if (val.toString().toLowerCase() in {'0': 1, 'no': 1, 'false': 1}) {
                val = false;
            } else {
                val = true;
            }
        }
        return val;
    },

    // These helpers compensate for the lack of parent-selectors and
    // previous-sibling-selectors in CSS which are needed when we want to
    // disable the labels that belong to disabled input elements.
    disableSetting(name) {
        const ctrl = document.getElementById('noVNC_setting_' + name);
        if (ctrl !== null) {
            ctrl.disabled = true;
            if (ctrl.label !== undefined) {
                ctrl.label.classList.add('noVNC_disabled');
            }
        }
    },

    enableSetting(name) {
        const ctrl = document.getElementById('noVNC_setting_' + name);
        if (ctrl !== null) {
            ctrl.disabled = false;
            if (ctrl.label !== undefined) {
                ctrl.label.classList.remove('noVNC_disabled');
            }
        }
    },

/* ------^-------
 *   /SETTINGS
 * ==============
 *    PANELS
 * ------v------*/

    closeAllPanels() {
        UI.closeSettingsPanel();
        UI.closePowerPanel();
        UI.closeClipboardPanel();
        UI.closeExtraKeys();
        UI.closeRecordingPanel();
    },

/* ------^-------
 *   /PANELS
 * ==============
 * SETTINGS (panel)
 * ------v------*/

    openSettingsPanel() {
        UI.closeAllPanels();
        UI.openControlbar();

        // Refresh UI elements from saved cookies
        UI.updateSetting('encrypt');
        UI.updateSetting('view_clip');
        UI.updateSetting('resize');
        UI.updateSetting('quality');
        UI.updateSetting('compression');
        UI.updateSetting('shared');
        UI.updateSetting('view_only');
        UI.updateSetting('path');
        UI.updateSetting('repeaterID');
        UI.updateSetting('logging');
        UI.updateSetting('reconnect');
        UI.updateSetting('reconnect_delay');

        document.getElementById('noVNC_settings')
            .classList.add("noVNC_open");
        document.getElementById('noVNC_settings_button')
            .classList.add("noVNC_selected");
    },

    closeSettingsPanel() {
        document.getElementById('noVNC_settings')
            .classList.remove("noVNC_open");
        document.getElementById('noVNC_settings_button')
            .classList.remove("noVNC_selected");
    },

    toggleSettingsPanel() {
        if (document.getElementById('noVNC_settings')
            .classList.contains("noVNC_open")) {
            UI.closeSettingsPanel();
        } else {
            UI.openSettingsPanel();
        }
    },

/* ------^-------
 *   /SETTINGS
 * ==============
 *     POWER
 * ------v------*/

    openPowerPanel() {
        UI.closeAllPanels();
        UI.openControlbar();

        document.getElementById('noVNC_power')
            .classList.add("noVNC_open");
        document.getElementById('noVNC_power_button')
            .classList.add("noVNC_selected");
    },

    closePowerPanel() {
        document.getElementById('noVNC_power')
            .classList.remove("noVNC_open");
        document.getElementById('noVNC_power_button')
            .classList.remove("noVNC_selected");
    },

    togglePowerPanel() {
        if (document.getElementById('noVNC_power')
            .classList.contains("noVNC_open")) {
            UI.closePowerPanel();
        } else {
            UI.openPowerPanel();
        }
    },

    // Disable/enable power button
    updatePowerButton() {
        if (UI.connected &&
            UI.rfb.capabilities.power &&
            !UI.rfb.viewOnly) {
            document.getElementById('noVNC_power_button')
                .classList.remove("noVNC_hidden");
        } else {
            document.getElementById('noVNC_power_button')
                .classList.add("noVNC_hidden");
            // Close power panel if open
            UI.closePowerPanel();
        }
    },

/* ------^-------
 *    /POWER
 * ==============
 *   CLIPBOARD
 * ------v------*/

    openClipboardPanel() {
        UI.closeAllPanels();
        UI.openControlbar();

        document.getElementById('noVNC_clipboard')
            .classList.add("noVNC_open");
        document.getElementById('noVNC_clipboard_button')
            .classList.add("noVNC_selected");
    },

    closeClipboardPanel() {
        document.getElementById('noVNC_clipboard')
            .classList.remove("noVNC_open");
        document.getElementById('noVNC_clipboard_button')
            .classList.remove("noVNC_selected");
    },

    toggleClipboardPanel() {
        if (document.getElementById('noVNC_clipboard')
            .classList.contains("noVNC_open")) {
            UI.closeClipboardPanel();
        } else {
            UI.openClipboardPanel();
        }
    },

    clipboardReceive(e) {
        Log.Debug(">> UI.clipboardReceive: " + e.detail.text.substr(0, 40) + "...");
        document.getElementById('noVNC_clipboard_text').value = e.detail.text;
        Log.Debug("<< UI.clipboardReceive");
    },

    clipboardSend() {
        const text = document.getElementById('noVNC_clipboard_text').value;
        Log.Debug(">> UI.clipboardSend: " + text.substr(0, 40) + "...");
        UI.rfb.clipboardPasteFrom(text);
        Log.Debug("<< UI.clipboardSend");
    },

/* ------^-------
 *  /CLIPBOARD
 * ==============
 *   RECORDING
 * ------v------*/

    openRecordingPanel() {
        UI.closeAllPanels();
        UI.openControlbar();

        UI.updateRecordingStats();

        document.getElementById('noVNC_record')
            .classList.add("noVNC_open");
        document.getElementById('noVNC_record_button')
            .classList.add("noVNC_selected");
    },

    closeRecordingPanel() {
        document.getElementById('noVNC_record')
            .classList.remove("noVNC_open");
        document.getElementById('noVNC_record_button')
            .classList.remove("noVNC_selected");
    },

    toggleRecordingPanel() {
        if (document.getElementById('noVNC_record')
            .classList.contains("noVNC_open")) {
            UI.closeRecordingPanel();
        } else {
            UI.openRecordingPanel();
        }
    },

    updateRecordingStats() {
        const statusElem = document.getElementById('noVNC_record_status');
        const statsElem = document.getElementById('noVNC_record_stats');

        if (UI.recording) {
            const elapsed = Math.floor((Date.now() - UI.recordingStartTime) / 1000);
            const minutes = Math.floor(elapsed / 60);
            const seconds = elapsed % 60;
            statusElem.textContent = `Recording: ${minutes}:${seconds.toString().padStart(2, '0')}`;
            statusElem.style.color = '#ff4444';

            const mbytes = (UI.recordingBytesWritten / (1024 * 1024)).toFixed(2);
            statsElem.textContent = `Frames: ${UI.recordingFrameCount}, Size: ${mbytes} MB (OPFS)`;
        } else if (UI.recordingPending) {
            statusElem.textContent = 'Waiting for connection...';
            statusElem.style.color = '#ffaa00';
            statsElem.textContent = 'Recording will start when you connect';
        } else {
            statusElem.textContent = 'Not recording';
            statusElem.style.color = '';

            if (UI.recordingFrameCount > 0) {
                const mbytes = (UI.recordingBytesWritten / (1024 * 1024)).toFixed(2);
                statsElem.textContent = `Recorded: ${UI.recordingFrameCount} frames, ${mbytes} MB`;
            } else {
                statsElem.textContent = '';
            }
        }

        // Update storage usage (async)
        UI.updateStorageUsage();
    },

    async updateStorageUsage() {
        const storageElem = document.getElementById('noVNC_record_storage');
        if (!storageElem) return;

        try {
            const s = await navigator.storage.estimate();
            const usageGB = (s.usage / 1e9).toFixed(2);
            const quotaGB = (s.quota / 1e9).toFixed(1);
            const percent = (s.usage / s.quota * 100).toFixed(1);
            storageElem.textContent = `Storage: ${usageGB}GB / ${quotaGB}GB (${percent}%)`;
        } catch (e) {
            storageElem.textContent = 'Storage: unavailable';
        }
    },

    async startRecording() {
        if (UI.recording) {
            return;
        }

        // If already connected, user needs to reconnect to capture from beginning
        if (UI.connected) {
            UI.showStatus(_("Disconnect and reconnect to record from the beginning"), 'warn');
            return;
        }

        // Delete any existing recording file
        try {
            const root = await navigator.storage.getDirectory();
            await root.removeEntry('vnc-recording.bin');
        } catch (e) {
            // File doesn't exist, that's fine
        }

        // Set pending - recording will start when connection is made
        UI.recordingPending = true;
        UI.recordingFrameCount = 0;
        UI.recordingBytesWritten = 0;

        // Update UI to show pending state
        document.getElementById('noVNC_record_button').classList.add('noVNC_selected');
        document.getElementById('noVNC_record_button').classList.add('noVNC_recording');
        document.getElementById('noVNC_record_start_button').disabled = true;
        document.getElementById('noVNC_record_stop_button').disabled = false;
        document.getElementById('noVNC_record_download_button').disabled = true;
        document.getElementById('noVNC_record_status').textContent = 'Waiting for connection...';
        document.getElementById('noVNC_record_status').style.color = '#ffaa00';

        UI.showStatus(_("Recording will start when you connect"), 'normal');
    },

    async stopRecording() {
        if (!UI.recording && !UI.recordingPending) {
            return;
        }

        Log.Info("Stopping recording, captured " + UI.recordingFrameCount + " frames");

        // Setting recording to false stops the wrapped handlers from capturing
        UI.recording = false;
        UI.recordingPending = false;

        const recordUrl = UI.getSetting('record_url');
        const recordFormat = UI.getSetting('record_format') || 'bin';
        const recordStreaming = UI.getSetting('record_streaming');
        const wasStreaming = recordStreaming && recordFormat === 'bin' && recordUrl && UI.recordingWebSocket;

        Log.Info("stopRecording settings: record_url='" + recordUrl + "', format='" + recordFormat + "', streaming=" + recordStreaming);

        // Clean up input event capture for MP4 format
        if (recordFormat === 'mp4') {
            UI.cleanupInputEventCapture();
        }

        // Close recording WebSocket if streaming to external server
        if (UI.recordingWebSocket) {
            try {
                UI.recordingWebSocket.close();
            } catch (e) {
                Log.Error("Error closing recording WebSocket: " + e);
            }
            UI.recordingWebSocket = null;
        }

        // Wait for pending writes and close the OPFS file
        if (UI.recordingWritable) {
            try {
                await UI.recordingWriteQueue;  // Wait for all pending writes
                await UI.recordingWritable.close();
            } catch (e) {
                Log.Error("Error closing recording file: " + e);
            }
            UI.recordingWritable = null;
            UI.recordingFileHandle = null;
        }

        // Stop stats update
        if (UI.recordingStatsInterval) {
            clearInterval(UI.recordingStatsInterval);
            UI.recordingStatsInterval = null;
        }

        // If not streaming and we have a record URL, encode and upload
        // For mp4 format, always upload (even with 0 events); for other formats, check frame count
        const hasData = recordFormat === 'mp4' ? true : UI.recordingFrameCount > 0;

        Log.Info("stopRecording: wasStreaming=" + wasStreaming + ", recordUrl=" + recordUrl +
                 ", hasData=" + hasData + ", format=" + recordFormat +
                 ", events=" + (UI.recordingEvents ? UI.recordingEvents.length : 0) +
                 ", frames=" + UI.recordingFrameCount);

        if (!wasStreaming && recordUrl && hasData) {
            UI.showStatus(_("Processing and uploading recording..."), 'normal');
            try {
                await UI.encodeAndUploadRecording(recordFormat, recordUrl);
            } catch (e) {
                Log.Error("Error uploading recording: " + e);
                UI.showStatus(_("Upload error: ") + e.message, 'error');
            }
        } else if (!wasStreaming && recordUrl && !hasData) {
            Log.Warn("No data to upload: events=" + (UI.recordingEvents ? UI.recordingEvents.length : 0) +
                     ", frames=" + UI.recordingFrameCount);
        } else if (!wasStreaming && !recordUrl) {
            Log.Warn("No record_url configured, skipping upload");
        } else if (wasStreaming) {
            Log.Info("Streaming mode was active, data already sent");
        }

        // Hide floating stop button
        UI.hideFloatingRecordButton();

        // Update UI
        document.getElementById('noVNC_record_button').classList.remove('noVNC_recording');
        if (!document.getElementById('noVNC_record').classList.contains('noVNC_open')) {
            document.getElementById('noVNC_record_button').classList.remove('noVNC_selected');
        }
        document.getElementById('noVNC_record_start_button').disabled = false;
        document.getElementById('noVNC_record_stop_button').disabled = true;
        document.getElementById('noVNC_record_download_button').disabled = (UI.recordingFrameCount === 0);

        UI.updateRecordingStats();

        UI.showStatus(_("Recording stopped: ") + UI.recordingFrameCount + _(" frames captured"), 'normal');
    },

    // Set up input event capture for MP4 recording
    setupInputEventCapture() {
        Log.Info("setupInputEventCapture called, rfb=" + !!UI.rfb + ", canvas=" + !!(UI.rfb && UI.rfb._canvas));
        if (!UI.rfb || !UI.rfb._canvas) {
            Log.Warn("setupInputEventCapture: rfb or canvas not available");
            return;
        }

        UI.recordingEvents = [];
        UI.recordingKeyBuffer = [];
        UI.recordingLastKeyTime = 0;
        UI.recordingLastMousePos = { x: 0, y: 0 };
        UI.recordingLastButtonMask = 0;
        UI.recordingDragStart = null;

        const canvas = UI.rfb._canvas;
        Log.Info("Setting up event capture on canvas: " + canvas.width + "x" + canvas.height);

        // Capture mouse events
        const mouseHandler = (e) => {
            if (!UI.recording) return;

            const timestamp = Date.now() - UI.recordingStartTime;
            const rect = canvas.getBoundingClientRect();
            const x = Math.round((e.clientX - rect.left) * (canvas.width / rect.width));
            const y = Math.round((e.clientY - rect.top) * (canvas.height / rect.height));

            UI.recordingLastMousePos = { x, y };

            if (e.type === 'mousedown') {
                if (e.button === 0) {
                    // Left button - could be click or drag start
                    UI.recordingDragStart = { x, y, timestamp };
                } else if (e.button === 2) {
                    // Right click
                    UI.recordingEvents.push({
                        timestamp,
                        type: 'click',
                        data: { x, y, button: 'right' }
                    });
                }
            } else if (e.type === 'mouseup' && e.button === 0 && UI.recordingDragStart) {
                const dx = Math.abs(x - UI.recordingDragStart.x);
                const dy = Math.abs(y - UI.recordingDragStart.y);

                if (dx > 10 || dy > 10) {
                    // Drag
                    UI.recordingEvents.push({
                        timestamp: UI.recordingDragStart.timestamp,
                        type: 'drag',
                        data: {
                            start: { x: UI.recordingDragStart.x, y: UI.recordingDragStart.y },
                            end: { x, y }
                        }
                    });
                } else {
                    // Click
                    UI.recordingEvents.push({
                        timestamp,
                        type: 'click',
                        data: { x, y, button: 'left' }
                    });
                }
                UI.recordingDragStart = null;
            }
        };

        // Capture wheel/scroll events
        const wheelHandler = (e) => {
            if (!UI.recording) return;

            const timestamp = Date.now() - UI.recordingStartTime;
            const rect = canvas.getBoundingClientRect();
            const x = Math.round((e.clientX - rect.left) * (canvas.width / rect.width));
            const y = Math.round((e.clientY - rect.top) * (canvas.height / rect.height));

            UI.recordingEvents.push({
                timestamp,
                type: 'scroll',
                data: {
                    direction: e.deltaY > 0 ? 'down' : 'up',
                    x, y
                }
            });
        };

        // Capture keyboard events by wrapping RFB.sendKey
        // noVNC intercepts keyboard events, so we need to hook into RFB's key sending
        const originalSendKey = UI.rfb.sendKey.bind(UI.rfb);
        UI.rfb.sendKey = (keysym, code, down) => {
            if (UI.recording && down) {
                const timestamp = Date.now() - UI.recordingStartTime;

                // Flush key buffer if time gap > 500ms
                if (UI.recordingKeyBuffer.length && timestamp - UI.recordingLastKeyTime > 500) {
                    UI.flushKeyBuffer();
                }

                // Convert keysym to character/key name
                const key = UI.keysymToChar(keysym);
                const specialKeys = ['Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'];

                if (specialKeys.includes(key) || (key.startsWith('F') && key.length <= 3)) {
                    UI.flushKeyBuffer();
                    UI.recordingEvents.push({
                        timestamp,
                        type: 'key',
                        data: { key, action: 'press' }
                    });
                } else if (key.length === 1) {
                    UI.recordingKeyBuffer.push(key);
                    UI.recordingLastKeyTime = timestamp;
                }
            }
            return originalSendKey(keysym, code, down);
        };

        canvas.addEventListener('mousedown', mouseHandler);
        canvas.addEventListener('mouseup', mouseHandler);
        canvas.addEventListener('wheel', wheelHandler);

        // Store handlers for cleanup
        UI.recordingEventHandlers = { mouseHandler, wheelHandler, canvas, originalSendKey };
    },

    // Flush buffered keystrokes into a type event
    flushKeyBuffer() {
        if (UI.recordingKeyBuffer.length === 0) return;

        UI.recordingEvents.push({
            timestamp: UI.recordingLastKeyTime,
            type: 'type',
            data: { text: UI.recordingKeyBuffer.join('') }
        });
        UI.recordingKeyBuffer = [];
    },

    // Convert keysym to readable character/key name
    keysymToChar(keysym) {
        // Common special keysyms
        const keysymMap = {
            0xff08: 'Backspace', 0xff09: 'Tab', 0xff0d: 'Enter', 0xff1b: 'Escape',
            0xff50: 'Home', 0xff51: 'ArrowLeft', 0xff52: 'ArrowUp', 0xff53: 'ArrowRight', 0xff54: 'ArrowDown',
            0xff55: 'PageUp', 0xff56: 'PageDown', 0xff57: 'End', 0xff63: 'Insert',
            0xffff: 'Delete', 0x0020: ' ',
            0xffe1: 'Shift', 0xffe2: 'Shift', 0xffe3: 'Control', 0xffe4: 'Control',
            0xffe9: 'Alt', 0xffea: 'Alt', 0xffeb: 'Super', 0xffec: 'Super',
        };

        if (keysymMap[keysym]) return keysymMap[keysym];

        // Printable ASCII
        if (keysym >= 0x20 && keysym <= 0x7e) {
            return String.fromCharCode(keysym);
        }

        // Function keys
        if (keysym >= 0xffbe && keysym <= 0xffc9) {
            return 'F' + (keysym - 0xffbe + 1);
        }

        return '';
    },

    // Show floating recording button
    showFloatingRecordButton() {
        // Remove existing button if any
        UI.hideFloatingRecordButton();

        const btn = document.createElement('div');
        btn.id = 'noVNC_floating_record_btn';
        btn.innerHTML = '⏹ Stop Recording';
        btn.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: rgba(220, 53, 69, 0.85);
            color: white;
            padding: 12px 20px;
            border-radius: 25px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            user-select: none;
            z-index: 99999;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            backdrop-filter: blur(4px);
            transition: background 0.2s, transform 0.1s;
        `;

        // Hover effect
        btn.addEventListener('mouseenter', () => {
            btn.style.background = 'rgba(200, 35, 51, 0.95)';
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.background = 'rgba(220, 53, 69, 0.85)';
        });

        // Drag functionality
        let isDragging = false;
        let dragStartX, dragStartY, btnStartX, btnStartY;

        btn.addEventListener('mousedown', (e) => {
            isDragging = true;
            dragStartX = e.clientX;
            dragStartY = e.clientY;
            btnStartX = btn.offsetLeft;
            btnStartY = btn.offsetTop;
            btn.style.cursor = 'grabbing';
            btn.style.transform = 'scale(0.98)';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const dx = e.clientX - dragStartX;
            const dy = e.clientY - dragStartY;
            btn.style.right = 'auto';
            btn.style.left = (btnStartX + dx) + 'px';
            btn.style.top = (btnStartY + dy) + 'px';
        });

        document.addEventListener('mouseup', (e) => {
            if (!isDragging) return;
            isDragging = false;
            btn.style.cursor = 'move';
            btn.style.transform = 'scale(1)';

            // If barely moved, treat as click
            const dx = Math.abs(e.clientX - dragStartX);
            const dy = Math.abs(e.clientY - dragStartY);
            if (dx < 5 && dy < 5) {
                UI.stopRecording();
            }
        });

        document.body.appendChild(btn);
    },

    // Hide floating recording button
    hideFloatingRecordButton() {
        const btn = document.getElementById('noVNC_floating_record_btn');
        if (btn) {
            btn.remove();
        }
    },

    // Clean up input event capture
    cleanupInputEventCapture() {
        if (UI.recordingEventHandlers) {
            const { mouseHandler, wheelHandler, canvas, originalSendKey } = UI.recordingEventHandlers;
            if (canvas) {
                canvas.removeEventListener('mousedown', mouseHandler);
                canvas.removeEventListener('mouseup', mouseHandler);
                canvas.removeEventListener('wheel', wheelHandler);
            }
            // Restore original sendKey
            if (originalSendKey && UI.rfb) {
                UI.rfb.sendKey = originalSendKey;
            }
            UI.recordingEventHandlers = null;
        }

        // Flush any remaining key buffer
        if (UI.recordingKeyBuffer && UI.recordingKeyBuffer.length > 0) {
            UI.flushKeyBuffer();
        }
    },

    async encodeAndUploadRecording(format, uploadUrl) {
        Log.Info("encodeAndUploadRecording: format=" + format + ", url=" + uploadUrl);

        // Check for mixed content (ws:// from https://)
        if (window.location.protocol === 'https:' && uploadUrl && uploadUrl.startsWith('ws://')) {
            // Localhost is usually allowed even from https
            if (!uploadUrl.includes('localhost') && !uploadUrl.includes('127.0.0.1')) {
                Log.Warn("Warning: Attempting to connect to ws:// from https:// page. This may be blocked by the browser.");
            }
        }

        let uploadData;

        try {
            if (format === 'mp4') {
                // For MP4 format: encode video from OPFS recording + JSON events
                UI.cleanupInputEventCapture();

                UI.showStatus(_("Reading recording from storage..."), 'normal');
                Log.Info("Reading recording from OPFS...");

                // Read the bin recording from OPFS
                const root = await navigator.storage.getDirectory();
                const fileHandle = await root.getFileHandle('vnc-recording.bin');
                const file = await fileHandle.getFile();

                UI.showStatus(_("Parsing recording frames..."), 'normal');
                Log.Info("Parsing recording frames...");

                // Parse frames from binary recording
                const { frames, serverFrameIndices } = await parseRecordingFrames(file, (status) => {
                    UI.showStatus(_(status), 'normal');
                });

                Log.Info(`Parsed ${frames.length} frames (${serverFrameIndices.length} server frames)`);

                if (serverFrameIndices.length === 0) {
                    throw new Error('No server frames found in recording');
                }

                UI.showStatus(_("Creating playback container..."), 'normal');

                // Create a hidden container for RFB playback
                const playbackContainer = document.createElement('div');
                playbackContainer.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1920px;height:1080px;overflow:hidden;';
                document.body.appendChild(playbackContainer);

                UI.showStatus(_("Playing back recording to capture frames..."), 'normal');
                Log.Info("Playing back recording to capture frames...");

                // Play through recording and capture frames
                const player = new RecordingPlayer(frames, serverFrameIndices, playbackContainer);
                player.onprogress = (current, total) => {
                    UI.showStatus(_("Capturing frame ") + current + "/" + total + "...", 'normal');
                };

                const captures = await player.run();

                // Clean up playback container
                document.body.removeChild(playbackContainer);

                Log.Info(`Captured ${captures.length} frames`);

                UI.showStatus(_("Encoding video (this may take a moment)..."), 'normal');
                Log.Info("Encoding video...");

                // Encode captures to MP4
                const { mp4Buffer, startTimestampOffset, width, height, duration } = await encodeCapturesToMp4(captures, (status) => {
                    UI.showStatus(_(status), 'normal');
                });

                Log.Info(`Video encoded: ${mp4Buffer.byteLength} bytes, ${width}x${height}, ${duration}ms`);

                // Adjust event timestamps relative to video start
                const adjustedEvents = (UI.recordingEvents || []).map(event => ({
                    ...event,
                    timestamp: event.timestamp - startTimestampOffset
                })).filter(event => event.timestamp >= 0);

                Log.Info(`Events: ${adjustedEvents.length} (adjusted from ${(UI.recordingEvents || []).length})`);

                // Create JSON with events and metadata
                const eventsJson = JSON.stringify({
                    events: adjustedEvents,
                    metadata: {
                        width,
                        height,
                        duration,
                        startTime: UI.recordingStartTime
                    }
                });

                Log.Info("Events JSON length: " + eventsJson.length);

                const jsonBytes = new TextEncoder().encode(eventsJson);

                // Format: [4 bytes JSON length][JSON data][MP4 data]
                const header = new Uint8Array(4);
                header[0] = (jsonBytes.length >> 24) & 0xff;
                header[1] = (jsonBytes.length >> 16) & 0xff;
                header[2] = (jsonBytes.length >> 8) & 0xff;
                header[3] = jsonBytes.length & 0xff;

                // Combine header + JSON + MP4
                const mp4Bytes = new Uint8Array(mp4Buffer);
                const combined = new Uint8Array(4 + jsonBytes.length + mp4Bytes.length);
                combined.set(header, 0);
                combined.set(jsonBytes, 4);
                combined.set(mp4Bytes, 4 + jsonBytes.length);

                Log.Info(`Upload data: ${combined.length} bytes (header: 4, JSON: ${jsonBytes.length}, MP4: ${mp4Bytes.length})`);

                uploadData = combined.buffer;

                UI.showStatus(_("Uploading recording..."), 'normal');
            } else {
                // For bin and js formats, read from OPFS
                const root = await navigator.storage.getDirectory();
                const fileHandle = await root.getFileHandle('vnc-recording.bin');
                const file = await fileHandle.getFile();

                if (format === 'bin') {
                    uploadData = await file.arrayBuffer();
                } else if (format === 'js') {
                    uploadData = await UI.convertRecordingToJS(file);
                } else {
                    throw new Error("Unknown format: " + format);
                }
            }
        } catch (e) {
            Log.Error("Error preparing upload data: " + e);
            throw e;
        }

        // Upload via WebSocket
        const uploadSizeMB = (uploadData.byteLength / (1024 * 1024)).toFixed(2);
        Log.Info("Uploading " + format + " recording (" + uploadData.byteLength + " bytes / " + uploadSizeMB + " MB) to " + uploadUrl);
        UI.showStatus(_("Connecting to upload server..."), 'normal');

        let ws;
        try {
            ws = new WebSocket(uploadUrl);
            ws.binaryType = 'arraybuffer';
        } catch (e) {
            Log.Error("Failed to create WebSocket to " + uploadUrl + ": " + e);
            throw e;
        }

        await new Promise((resolve, reject) => {
            let resolved = false;
            ws.onopen = () => {
                Log.Info("Upload WebSocket connected, sending " + uploadData.byteLength + " bytes");
                UI.showStatus(_("Sending ") + uploadSizeMB + _(" MB to server..."), 'normal');
                try {
                    ws.send(uploadData);
                    Log.Info("Data sent successfully, waiting before close...");
                    UI.showStatus(_("Data sent, finalizing upload..."), 'normal');
                    // Wait a bit before closing to ensure server receives the data
                    setTimeout(() => {
                        Log.Info("Closing upload WebSocket");
                        ws.close();
                    }, 500);
                } catch (e) {
                    Log.Error("Send error: " + e);
                    if (!resolved) { resolved = true; reject(e); }
                }
            };
            ws.onerror = () => {
                Log.Error("Upload WebSocket error");
                UI.showStatus(_("Upload connection error"), 'error');
                if (!resolved) { resolved = true; reject(new Error("Upload failed")); }
            };
            ws.onclose = () => {
                Log.Info("Upload WebSocket closed");
                if (!resolved) { resolved = true; resolve(); }
            };
            setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    UI.showStatus(_("Upload timeout"), 'error');
                    reject(new Error("Upload timeout"));
                }
            }, 120000);  // 2 minute timeout for large files
        });

        UI.showStatus(_("Recording uploaded successfully (") + uploadSizeMB + _(" MB)"), 'normal');
    },

    async convertRecordingToJS(file) {
        const reader = file.stream().getReader();
        const textEncoder = new TextEncoder();
        const chunks = [];

        // Write header
        chunks.push(textEncoder.encode('/* noVNC recording - generated by noVNC client-side recorder */\n'));
        chunks.push(textEncoder.encode('/* eslint-disable */\n'));
        chunks.push(textEncoder.encode('var VNC_frame_data = [\n'));

        let buffer = new Uint8Array(0);

        while (true) {
            // Try to parse frames from buffer
            while (buffer.length >= 9) {
                const fromClient = buffer[0] === 1;
                const timestamp = (buffer[1] << 24) | (buffer[2] << 16) | (buffer[3] << 8) | buffer[4];
                const dataLen = (buffer[5] << 24) | (buffer[6] << 16) | (buffer[7] << 8) | buffer[8];

                if (buffer.length < 9 + dataLen) break;

                const data = buffer.slice(9, 9 + dataLen);
                buffer = buffer.slice(9 + dataLen);

                // Convert to JS format
                const prefix = fromClient ? '}' : '{';
                let binary = '';
                for (let j = 0; j < data.length; j++) {
                    binary += String.fromCharCode(data[j]);
                }
                const base64Data = btoa(binary);
                const frameStr = prefix + timestamp + '{' + base64Data;
                const escaped = JSON.stringify(frameStr);
                chunks.push(textEncoder.encode(escaped + ',\n'));
            }

            // Read more data
            const { done, value } = await reader.read();
            if (done) break;

            const newBuffer = new Uint8Array(buffer.length + value.length);
            newBuffer.set(buffer);
            newBuffer.set(value, buffer.length);
            buffer = newBuffer;
        }

        // Write footer
        chunks.push(textEncoder.encode('"EOF"\n];\n'));

        // Combine chunks
        const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
            result.set(chunk, offset);
            offset += chunk.length;
        }

        return result.buffer;
    },

    async encodeRecordingToMP4(file) {
        // Dynamically import mediabunny
        const { Output, Mp4OutputFormat, BufferTarget, VideoSampleSource, VideoSample, QUALITY_HIGH } =
            await import('https://cdn.jsdelivr.net/npm/mediabunny@1.29.1/+esm');

        UI.showStatus(_("Decoding frames for MP4 encoding..."), 'normal');

        // First pass: collect all server frames and find screen dimensions
        const reader = file.stream().getReader();
        let buffer = new Uint8Array(0);
        const serverFrames = [];  // { timestamp, data }

        while (true) {
            while (buffer.length >= 9) {
                const fromClient = buffer[0] === 1;
                const timestamp = (buffer[1] << 24) | (buffer[2] << 16) | (buffer[3] << 8) | buffer[4];
                const dataLen = (buffer[5] << 24) | (buffer[6] << 16) | (buffer[7] << 8) | buffer[8];

                if (buffer.length < 9 + dataLen) break;

                const data = buffer.slice(9, 9 + dataLen);
                buffer = buffer.slice(9 + dataLen);

                if (!fromClient) {
                    serverFrames.push({ timestamp, data: new Uint8Array(data) });
                }
            }

            const { done, value } = await reader.read();
            if (done) break;

            const newBuffer = new Uint8Array(buffer.length + value.length);
            newBuffer.set(buffer);
            newBuffer.set(value, buffer.length);
            buffer = newBuffer;
        }

        if (serverFrames.length === 0) {
            throw new Error("No server frames to encode");
        }

        // Use RFB to decode frames - we need to replay them through the decoder
        // For now, we'll use a simplified approach that requires the RFB instance
        // This is a placeholder - full implementation would need RFB replay capability

        // Get dimensions from UI.rfb if available, otherwise use defaults
        let width = 1024;
        let height = 768;
        if (UI.rfb && UI.rfb._fbWidth && UI.rfb._fbHeight) {
            width = UI.rfb._fbWidth;
            height = UI.rfb._fbHeight;
        }

        UI.showStatus(_("Encoding MP4 (") + serverFrames.length + _(" frames)..."), 'normal');

        // Create MP4 output
        const output = new Output(new Mp4OutputFormat(), new BufferTarget());
        const videoSource = new VideoSampleSource({
            width,
            height,
            frameRate: 24,
            quality: QUALITY_HIGH
        });
        output.addSource(videoSource);
        await output.start();

        // For each frame, we need the decoded image
        // Since we can't easily replay through RFB here, we'll need to skip MP4 encoding
        // or implement a full RFB decoder replay
        // For now, throw an informative error
        throw new Error("MP4 encoding requires RFB replay capability - use 'bin' or 'js' format for upload, or use debug_demo.html for MP4 encoding");
    },

    async downloadRecording() {
        if (UI.recordingFrameCount === 0) {
            UI.showStatus(_("No recording to download"), 'error');
            return;
        }

        Log.Info("Generating recording file with " + UI.recordingFrameCount + " frames");
        UI.showStatus(_("Preparing download..."), 'normal');

        try {
            // Open the OPFS recording file for reading
            const root = await navigator.storage.getDirectory();
            const fileHandle = await root.getFileHandle('vnc-recording.bin');
            const file = await fileHandle.getFile();

            // Create a streaming response that converts binary to JS format
            const reader = file.stream().getReader();
            const textEncoder = new TextEncoder();

            let buffer = new Uint8Array(0);
            let framesProcessed = 0;
            let headerWritten = false;

            const jsStream = new ReadableStream({
                async pull(controller) {
                    // Write header first
                    if (!headerWritten) {
                        const header = '/* noVNC recording - generated by noVNC client-side recorder */\n' +
                                       '/* eslint-disable */\n' +
                                       'var VNC_frame_data = [\n';
                        controller.enqueue(textEncoder.encode(header));
                        headerWritten = true;
                    }

                    // Read and process frames
                    while (true) {
                        // Try to parse a frame from buffer
                        // Binary format: fromClient(1) + timestamp(4) + dataLen(4) + data(dataLen)
                        if (buffer.length >= 9) {
                            const fromClient = buffer[0] === 1;
                            const timestamp = (buffer[1] << 24) | (buffer[2] << 16) | (buffer[3] << 8) | buffer[4];
                            const dataLen = (buffer[5] << 24) | (buffer[6] << 16) | (buffer[7] << 8) | buffer[8];

                            if (buffer.length >= 9 + dataLen) {
                                // We have a complete frame
                                const data = buffer.slice(9, 9 + dataLen);
                                buffer = buffer.slice(9 + dataLen);

                                // Convert to JS format
                                const prefix = fromClient ? '}' : '{';
                                let binary = '';
                                for (let j = 0; j < data.length; j++) {
                                    binary += String.fromCharCode(data[j]);
                                }
                                const base64Data = btoa(binary);
                                const frameStr = prefix + timestamp + '{' + base64Data;
                                const escaped = JSON.stringify(frameStr);
                                const line = escaped + ',\n';

                                controller.enqueue(textEncoder.encode(line));
                                framesProcessed++;

                                // Update status periodically
                                if (framesProcessed % 1000 === 0) {
                                    UI.showStatus(_("Processing: ") + framesProcessed + "/" + UI.recordingFrameCount + _(" frames"), 'normal');
                                }

                                continue; // Try to parse another frame
                            }
                        }

                        // Need more data
                        const { done, value } = await reader.read();
                        if (done) {
                            // Write footer and close
                            controller.enqueue(textEncoder.encode('"EOF"\n];\n'));
                            controller.close();
                            return;
                        }

                        // Append to buffer
                        const newBuffer = new Uint8Array(buffer.length + value.length);
                        newBuffer.set(buffer);
                        newBuffer.set(value, buffer.length);
                        buffer = newBuffer;
                    }
                }
            });

            // Create blob from stream and trigger download
            const response = new Response(jsStream);
            const blob = await response.blob();

            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;

            const now = new Date();
            const dateStr = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
            a.download = 'vnc-recording-' + dateStr + '.js';

            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            setTimeout(() => URL.revokeObjectURL(url), 10000);

            UI.showStatus(_("Recording downloaded: ") + framesProcessed + _(" frames"), 'normal');

        } catch (e) {
            Log.Error("Error downloading recording: " + e);
            UI.showStatus(_("Download error: ") + e.message, 'error');
        }
    },

/* ------^-------
 *  /RECORDING
 * ==============
 *  CONNECTION
 * ------v------*/

    openConnectPanel() {
        document.getElementById('noVNC_connect_dlg')
            .classList.add("noVNC_open");
    },

    closeConnectPanel() {
        document.getElementById('noVNC_connect_dlg')
            .classList.remove("noVNC_open");
    },

    async connect(event, password) {

        // Ignore when rfb already exists
        if (typeof UI.rfb !== 'undefined') {
            return;
        }

        const host = UI.getSetting('host');
        const port = UI.getSetting('port');
        const path = UI.getSetting('path');

        if (typeof password === 'undefined') {
            password = UI.getSetting('password');
            UI.reconnectPassword = password;
        }

        if (password === null) {
            password = undefined;
        }

        UI.hideStatus();

        UI.closeConnectPanel();

        UI.updateVisualState('connecting');

        let url;

        if (host) {
            url = new URL("https://" + host);

            url.protocol = UI.getSetting('encrypt') ? 'wss:' : 'ws:';
            if (port) {
                url.port = port;
            }

            // "./" is needed to force URL() to interpret the path-variable as
            // a path and not as an URL. This is relevant if for example path
            // starts with more than one "/", in which case it would be
            // interpreted as a host name instead.
            url = new URL("./" + path, url);
        } else {
            // Current (May 2024) browsers support relative WebSocket
            // URLs natively, but we need to support older browsers for
            // some time.
            url = new URL(path, location.href);
            url.protocol = (window.location.protocol === "https:") ? 'wss:' : 'ws:';
        }

        // If recording is pending, set up recording destination and wrap WebSocket
        let OriginalWebSocket = null;
        if (UI.recordingPending) {
            try {
                const recordUrl = UI.getSetting('record_url');
                const recordFormat = UI.getSetting('record_format') || 'bin';
                const recordStreaming = UI.getSetting('record_streaming');

                // Only bin format supports streaming
                const shouldStream = recordStreaming && recordFormat === 'bin' && recordUrl;

                Log.Info("Recording setup: format=" + recordFormat + ", streaming=" + recordStreaming + ", url=" + recordUrl + ", shouldStream=" + shouldStream);

                if (shouldStream) {
                    // Stream recording to external WebSocket server
                    Log.Info("Setting up streaming recording to external server: " + recordUrl);
                    UI.recordingWebSocket = new WebSocket(recordUrl);
                    UI.recordingWebSocket.binaryType = 'arraybuffer';

                    await new Promise((resolve, reject) => {
                        UI.recordingWebSocket.onopen = () => {
                            Log.Info("Recording WebSocket connected");
                            resolve();
                        };
                        UI.recordingWebSocket.onerror = (e) => {
                            reject(new Error("Failed to connect to recording server"));
                        };
                        // Timeout after 5 seconds
                        setTimeout(() => reject(new Error("Recording server connection timeout")), 5000);
                    });
                } else {
                    // Set up OPFS file for local recording (will encode/upload at end)
                    Log.Info("Setting up local recording (format: " + recordFormat + ", will upload at end)");
                    const root = await navigator.storage.getDirectory();
                    UI.recordingFileHandle = await root.getFileHandle('vnc-recording.bin', { create: true });
                    UI.recordingWritable = await UI.recordingFileHandle.createWritable();
                    UI.recordingWriteQueue = Promise.resolve();
                }

                UI.recording = true;
                UI.recordingPending = false;
                UI.recordingStartTime = Date.now();
                UI.recordingFrameCount = 0;
                UI.recordingBytesWritten = 0;
                UI.recordingEvents = [];  // Initialize events array for mp4 format

                Log.Info("Recording started: format=" + recordFormat + ", streaming=" + shouldStream);

                // Helper to write a frame (binary format)
                // Format: fromClient(1) + timestamp(4) + dataLen(4) + data(dataLen)
                const writeFrame = (fromClient, timestamp, data) => {
                    if (!UI.recording) return;

                    const header = new Uint8Array(9);
                    header[0] = fromClient ? 1 : 0;
                    header[1] = (timestamp >> 24) & 0xff;
                    header[2] = (timestamp >> 16) & 0xff;
                    header[3] = (timestamp >> 8) & 0xff;
                    header[4] = timestamp & 0xff;
                    header[5] = (data.length >> 24) & 0xff;
                    header[6] = (data.length >> 16) & 0xff;
                    header[7] = (data.length >> 8) & 0xff;
                    header[8] = data.length & 0xff;

                    if (UI.recordingWebSocket && UI.recordingWebSocket.readyState === WebSocket.OPEN) {
                        // Stream to external server
                        const frame = new Uint8Array(9 + data.length);
                        frame.set(header, 0);
                        frame.set(data, 9);
                        UI.recordingWebSocket.send(frame);
                        UI.recordingFrameCount++;
                        UI.recordingBytesWritten += frame.length;
                    } else if (UI.recordingWritable) {
                        // Write to OPFS
                        UI.recordingWriteQueue = UI.recordingWriteQueue.then(async () => {
                            try {
                                await UI.recordingWritable.write(header);
                                await UI.recordingWritable.write(data);
                                UI.recordingFrameCount++;
                                UI.recordingBytesWritten += 9 + data.length;
                            } catch (e) {
                                Log.Error("Error writing frame: " + e);
                            }
                        });
                    }
                };

                // Wrap WebSocket constructor temporarily
                OriginalWebSocket = window.WebSocket;
                window.WebSocket = function(wsUrl, protocols) {
                    const ws = new OriginalWebSocket(wsUrl, protocols);

                    // Capture server-to-client messages
                    ws.addEventListener('message', function(e) {
                        if (UI.recording) {
                            const timestamp = Date.now() - UI.recordingStartTime;
                            const data = new Uint8Array(e.data);
                            writeFrame(false, timestamp, data);
                        }
                    });

                    // Wrap send for client-to-server messages
                    const originalSend = ws.send.bind(ws);
                    ws.send = function(data) {
                        if (UI.recording) {
                            const timestamp = Date.now() - UI.recordingStartTime;
                            let u8data;
                            if (data instanceof ArrayBuffer) {
                                u8data = new Uint8Array(data);
                            } else if (data instanceof Uint8Array) {
                                u8data = data;
                            } else {
                                u8data = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
                            }
                            writeFrame(true, timestamp, u8data);
                        }
                        originalSend(data);
                    };

                    return ws;
                };
                // Copy static properties
                window.WebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
                window.WebSocket.OPEN = OriginalWebSocket.OPEN;
                window.WebSocket.CLOSING = OriginalWebSocket.CLOSING;
                window.WebSocket.CLOSED = OriginalWebSocket.CLOSED;

            } catch (e) {
                Log.Error("Failed to set up recording: " + e);
                UI.showStatus(_("Recording setup failed: ") + e.message, 'error');
                UI.recordingPending = false;
                if (UI.recordingWebSocket) {
                    UI.recordingWebSocket.close();
                    UI.recordingWebSocket = null;
                }
            }
        }

        try {
            UI.rfb = new RFB(document.getElementById('noVNC_container'),
                             url.href,
                             { shared: UI.getSetting('shared'),
                               repeaterID: UI.getSetting('repeaterID'),
                               credentials: { password: password } });
        } catch (exc) {
            Log.Error("Failed to connect to server: " + exc);
            UI.updateVisualState('disconnected');
            UI.showStatus(_("Failed to connect to server: ") + exc, 'error');
            return;
        }

        // Restore original WebSocket if we wrapped it
        if (OriginalWebSocket) {
            window.WebSocket = OriginalWebSocket;
            // Update recording UI
            document.getElementById('noVNC_record_button').classList.add('noVNC_selected');
            document.getElementById('noVNC_record_button').classList.add('noVNC_recording');
            document.getElementById('noVNC_record_start_button').disabled = true;
            document.getElementById('noVNC_record_stop_button').disabled = false;
            document.getElementById('noVNC_record_download_button').disabled = true;

            UI.updateRecordingStats();

            // Start periodic stats update
            UI.recordingStatsInterval = setInterval(() => {
                if (document.getElementById('noVNC_record').classList.contains('noVNC_open')) {
                    UI.updateRecordingStats();
                }
            }, 1000);

            UI.showStatus(_("Recording started (OPFS)"), 'normal');

            // Show floating stop button
            UI.showFloatingRecordButton();
        }

        UI.rfb.addEventListener("connect", UI.connectFinished);
        UI.rfb.addEventListener("disconnect", UI.disconnectFinished);
        UI.rfb.addEventListener("serververification", UI.serverVerify);
        UI.rfb.addEventListener("credentialsrequired", UI.credentials);
        UI.rfb.addEventListener("securityfailure", UI.securityFailed);
        UI.rfb.addEventListener("clippingviewport", UI.updateViewDrag);
        UI.rfb.addEventListener("capabilities", UI.updatePowerButton);
        UI.rfb.addEventListener("clipboard", UI.clipboardReceive);
        UI.rfb.addEventListener("bell", UI.bell);
        UI.rfb.addEventListener("desktopname", UI.updateDesktopName);

        // Set up input event capture for MP4 recording format
        const recordFormat = UI.getSetting('record_format');
        Log.Info("Post-RFB setup: recording=" + UI.recording + ", format=" + recordFormat);
        if (UI.recording && recordFormat === 'mp4') {
            Log.Info("Setting up input event capture for MP4 format");
            UI.setupInputEventCapture();
        }
        UI.rfb.clipViewport = UI.getSetting('view_clip');
        UI.rfb.scaleViewport = UI.getSetting('resize') === 'scale';
        UI.rfb.resizeSession = UI.getSetting('resize') === 'remote';
        UI.rfb.qualityLevel = parseInt(UI.getSetting('quality'));
        UI.rfb.compressionLevel = parseInt(UI.getSetting('compression'));
        UI.rfb.showDotCursor = UI.getSetting('show_dot');

        UI.updateViewOnly(); // requires UI.rfb
    },

    disconnect() {
        // Stop recording if active or pending
        if (UI.recording || UI.recordingPending) {
            UI.stopRecording();
        }

        UI.rfb.disconnect();

        UI.connected = false;

        // Disable automatic reconnecting
        UI.inhibitReconnect = true;

        UI.updateVisualState('disconnecting');

        // Don't display the connection settings until we're actually disconnected
    },

    reconnect() {
        UI.reconnectCallback = null;

        // if reconnect has been disabled in the meantime, do nothing.
        if (UI.inhibitReconnect) {
            return;
        }

        UI.connect(null, UI.reconnectPassword);
    },

    cancelReconnect() {
        if (UI.reconnectCallback !== null) {
            clearTimeout(UI.reconnectCallback);
            UI.reconnectCallback = null;
        }

        UI.updateVisualState('disconnected');

        UI.openControlbar();
        UI.openConnectPanel();
    },

    connectFinished(e) {
        UI.connected = true;
        UI.inhibitReconnect = false;

        let msg;
        if (UI.getSetting('encrypt')) {
            msg = _("Connected (encrypted) to ") + UI.desktopName;
        } else {
            msg = _("Connected (unencrypted) to ") + UI.desktopName;
        }
        UI.showStatus(msg);
        UI.updateVisualState('connected');

        // Do this last because it can only be used on rendered elements
        UI.rfb.focus();
    },

    disconnectFinished(e) {
        const wasConnected = UI.connected;

        // Stop recording if active or pending (handles unexpected disconnects)
        if (UI.recording || UI.recordingPending) {
            UI.stopRecording();
        }

        // This variable is ideally set when disconnection starts, but
        // when the disconnection isn't clean or if it is initiated by
        // the server, we need to do it here as well since
        // UI.disconnect() won't be used in those cases.
        UI.connected = false;

        UI.rfb = undefined;

        if (!e.detail.clean) {
            UI.updateVisualState('disconnected');
            if (wasConnected) {
                UI.showStatus(_("Something went wrong, connection is closed"),
                              'error');
            } else {
                UI.showStatus(_("Failed to connect to server"), 'error');
            }
        }
        // If reconnecting is allowed process it now
        if (UI.getSetting('reconnect', false) === true && !UI.inhibitReconnect) {
            UI.updateVisualState('reconnecting');

            const delay = parseInt(UI.getSetting('reconnect_delay'));
            UI.reconnectCallback = setTimeout(UI.reconnect, delay);
            return;
        } else {
            UI.updateVisualState('disconnected');
            UI.showStatus(_("Disconnected"), 'normal');
        }

        document.title = PAGE_TITLE;

        UI.openControlbar();
        UI.openConnectPanel();
    },

    securityFailed(e) {
        let msg = "";
        // On security failures we might get a string with a reason
        // directly from the server. Note that we can't control if
        // this string is translated or not.
        if ('reason' in e.detail) {
            msg = _("New connection has been rejected with reason: ") +
                e.detail.reason;
        } else {
            msg = _("New connection has been rejected");
        }
        UI.showStatus(msg, 'error');
    },

/* ------^-------
 *  /CONNECTION
 * ==============
 * SERVER VERIFY
 * ------v------*/

    async serverVerify(e) {
        const type = e.detail.type;
        if (type === 'RSA') {
            const publickey = e.detail.publickey;
            let fingerprint = await window.crypto.subtle.digest("SHA-1", publickey);
            // The same fingerprint format as RealVNC
            fingerprint = Array.from(new Uint8Array(fingerprint).slice(0, 8)).map(
                x => x.toString(16).padStart(2, '0')).join('-');
            document.getElementById('noVNC_verify_server_dlg').classList.add('noVNC_open');
            document.getElementById('noVNC_fingerprint').innerHTML = fingerprint;
        }
    },

    approveServer(e) {
        e.preventDefault();
        document.getElementById('noVNC_verify_server_dlg').classList.remove('noVNC_open');
        UI.rfb.approveServer();
    },

    rejectServer(e) {
        e.preventDefault();
        document.getElementById('noVNC_verify_server_dlg').classList.remove('noVNC_open');
        UI.disconnect();
    },

/* ------^-------
 * /SERVER VERIFY
 * ==============
 *   PASSWORD
 * ------v------*/

    credentials(e) {
        // FIXME: handle more types

        document.getElementById("noVNC_username_block").classList.remove("noVNC_hidden");
        document.getElementById("noVNC_password_block").classList.remove("noVNC_hidden");

        let inputFocus = "none";
        if (e.detail.types.indexOf("username") === -1) {
            document.getElementById("noVNC_username_block").classList.add("noVNC_hidden");
        } else {
            inputFocus = inputFocus === "none" ? "noVNC_username_input" : inputFocus;
        }
        if (e.detail.types.indexOf("password") === -1) {
            document.getElementById("noVNC_password_block").classList.add("noVNC_hidden");
        } else {
            inputFocus = inputFocus === "none" ? "noVNC_password_input" : inputFocus;
        }
        document.getElementById('noVNC_credentials_dlg')
            .classList.add('noVNC_open');

        setTimeout(() => document
            .getElementById(inputFocus).focus(), 100);

        Log.Warn("Server asked for credentials");
        UI.showStatus(_("Credentials are required"), "warning");
    },

    setCredentials(e) {
        // Prevent actually submitting the form
        e.preventDefault();

        let inputElemUsername = document.getElementById('noVNC_username_input');
        const username = inputElemUsername.value;

        let inputElemPassword = document.getElementById('noVNC_password_input');
        const password = inputElemPassword.value;
        // Clear the input after reading the password
        inputElemPassword.value = "";

        UI.rfb.sendCredentials({ username: username, password: password });
        UI.reconnectPassword = password;
        document.getElementById('noVNC_credentials_dlg')
            .classList.remove('noVNC_open');
    },

/* ------^-------
 *  /PASSWORD
 * ==============
 *   FULLSCREEN
 * ------v------*/

    toggleFullscreen() {
        if (document.fullscreenElement || // alternative standard method
            document.mozFullScreenElement || // currently working methods
            document.webkitFullscreenElement ||
            document.msFullscreenElement) {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.mozCancelFullScreen) {
                document.mozCancelFullScreen();
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            } else if (document.msExitFullscreen) {
                document.msExitFullscreen();
            }
        } else {
            if (document.documentElement.requestFullscreen) {
                document.documentElement.requestFullscreen();
            } else if (document.documentElement.mozRequestFullScreen) {
                document.documentElement.mozRequestFullScreen();
            } else if (document.documentElement.webkitRequestFullscreen) {
                document.documentElement.webkitRequestFullscreen(Element.ALLOW_KEYBOARD_INPUT);
            } else if (document.body.msRequestFullscreen) {
                document.body.msRequestFullscreen();
            }
        }
        UI.updateFullscreenButton();
    },

    updateFullscreenButton() {
        if (document.fullscreenElement || // alternative standard method
            document.mozFullScreenElement || // currently working methods
            document.webkitFullscreenElement ||
            document.msFullscreenElement ) {
            document.getElementById('noVNC_fullscreen_button')
                .classList.add("noVNC_selected");
        } else {
            document.getElementById('noVNC_fullscreen_button')
                .classList.remove("noVNC_selected");
        }
    },

/* ------^-------
 *  /FULLSCREEN
 * ==============
 *     RESIZE
 * ------v------*/

    // Apply remote resizing or local scaling
    applyResizeMode() {
        if (!UI.rfb) return;

        UI.rfb.scaleViewport = UI.getSetting('resize') === 'scale';
        UI.rfb.resizeSession = UI.getSetting('resize') === 'remote';
    },

/* ------^-------
 *    /RESIZE
 * ==============
 * VIEW CLIPPING
 * ------v------*/

    // Update viewport clipping property for the connection. The normal
    // case is to get the value from the setting. There are special cases
    // for when the viewport is scaled or when a touch device is used.
    updateViewClip() {
        if (!UI.rfb) return;

        const scaling = UI.getSetting('resize') === 'scale';

        // Some platforms have overlay scrollbars that are difficult
        // to use in our case, which means we have to force panning
        // FIXME: Working scrollbars can still be annoying to use with
        //        touch, so we should ideally be able to have both
        //        panning and scrollbars at the same time

        let brokenScrollbars = false;

        if (!hasScrollbarGutter) {
            if (isIOS() || isAndroid() || isMac() || isChromeOS()) {
                brokenScrollbars = true;
            }
        }

        if (scaling) {
            // Can't be clipping if viewport is scaled to fit
            UI.forceSetting('view_clip', false);
            UI.rfb.clipViewport  = false;
        } else if (brokenScrollbars) {
            UI.forceSetting('view_clip', true);
            UI.rfb.clipViewport = true;
        } else {
            UI.enableSetting('view_clip');
            UI.rfb.clipViewport = UI.getSetting('view_clip');
        }

        // Changing the viewport may change the state of
        // the dragging button
        UI.updateViewDrag();
    },

/* ------^-------
 * /VIEW CLIPPING
 * ==============
 *    VIEWDRAG
 * ------v------*/

    toggleViewDrag() {
        if (!UI.rfb) return;

        UI.rfb.dragViewport = !UI.rfb.dragViewport;
        UI.updateViewDrag();
    },

    updateViewDrag() {
        if (!UI.connected) return;

        const viewDragButton = document.getElementById('noVNC_view_drag_button');

        if ((!UI.rfb.clipViewport || !UI.rfb.clippingViewport) &&
            UI.rfb.dragViewport) {
            // We are no longer clipping the viewport. Make sure
            // viewport drag isn't active when it can't be used.
            UI.rfb.dragViewport = false;
        }

        if (UI.rfb.dragViewport) {
            viewDragButton.classList.add("noVNC_selected");
        } else {
            viewDragButton.classList.remove("noVNC_selected");
        }

        if (UI.rfb.clipViewport) {
            viewDragButton.classList.remove("noVNC_hidden");
        } else {
            viewDragButton.classList.add("noVNC_hidden");
        }

        viewDragButton.disabled = !UI.rfb.clippingViewport;
    },

/* ------^-------
 *   /VIEWDRAG
 * ==============
 *    QUALITY
 * ------v------*/

    updateQuality() {
        if (!UI.rfb) return;

        UI.rfb.qualityLevel = parseInt(UI.getSetting('quality'));
    },

/* ------^-------
 *   /QUALITY
 * ==============
 *  COMPRESSION
 * ------v------*/

    updateCompression() {
        if (!UI.rfb) return;

        UI.rfb.compressionLevel = parseInt(UI.getSetting('compression'));
    },

/* ------^-------
 *  /COMPRESSION
 * ==============
 *    KEYBOARD
 * ------v------*/

    showVirtualKeyboard() {
        if (!isTouchDevice) return;

        const input = document.getElementById('noVNC_keyboardinput');

        if (document.activeElement == input) return;

        input.focus();

        try {
            const l = input.value.length;
            // Move the caret to the end
            input.setSelectionRange(l, l);
        } catch (err) {
            // setSelectionRange is undefined in Google Chrome
        }
    },

    hideVirtualKeyboard() {
        if (!isTouchDevice) return;

        const input = document.getElementById('noVNC_keyboardinput');

        if (document.activeElement != input) return;

        input.blur();
    },

    toggleVirtualKeyboard() {
        if (document.getElementById('noVNC_keyboard_button')
            .classList.contains("noVNC_selected")) {
            UI.hideVirtualKeyboard();
        } else {
            UI.showVirtualKeyboard();
        }
    },

    onfocusVirtualKeyboard(event) {
        document.getElementById('noVNC_keyboard_button')
            .classList.add("noVNC_selected");
        if (UI.rfb) {
            UI.rfb.focusOnClick = false;
        }
    },

    onblurVirtualKeyboard(event) {
        document.getElementById('noVNC_keyboard_button')
            .classList.remove("noVNC_selected");
        if (UI.rfb) {
            UI.rfb.focusOnClick = true;
        }
    },

    keepVirtualKeyboard(event) {
        const input = document.getElementById('noVNC_keyboardinput');

        // Only prevent focus change if the virtual keyboard is active
        if (document.activeElement != input) {
            return;
        }

        // Only allow focus to move to other elements that need
        // focus to function properly
        if (event.target.form !== undefined) {
            switch (event.target.type) {
                case 'text':
                case 'email':
                case 'search':
                case 'password':
                case 'tel':
                case 'url':
                case 'textarea':
                case 'select-one':
                case 'select-multiple':
                    return;
            }
        }

        event.preventDefault();
    },

    keyboardinputReset() {
        const kbi = document.getElementById('noVNC_keyboardinput');
        kbi.value = new Array(UI.defaultKeyboardinputLen).join("_");
        UI.lastKeyboardinput = kbi.value;
    },

    keyEvent(keysym, code, down) {
        if (!UI.rfb) return;

        UI.rfb.sendKey(keysym, code, down);
    },

    // When normal keyboard events are left uncought, use the input events from
    // the keyboardinput element instead and generate the corresponding key events.
    // This code is required since some browsers on Android are inconsistent in
    // sending keyCodes in the normal keyboard events when using on screen keyboards.
    keyInput(event) {

        if (!UI.rfb) return;

        const newValue = event.target.value;

        if (!UI.lastKeyboardinput) {
            UI.keyboardinputReset();
        }
        const oldValue = UI.lastKeyboardinput;

        let newLen;
        try {
            // Try to check caret position since whitespace at the end
            // will not be considered by value.length in some browsers
            newLen = Math.max(event.target.selectionStart, newValue.length);
        } catch (err) {
            // selectionStart is undefined in Google Chrome
            newLen = newValue.length;
        }
        const oldLen = oldValue.length;

        let inputs = newLen - oldLen;
        let backspaces = inputs < 0 ? -inputs : 0;

        // Compare the old string with the new to account for
        // text-corrections or other input that modify existing text
        for (let i = 0; i < Math.min(oldLen, newLen); i++) {
            if (newValue.charAt(i) != oldValue.charAt(i)) {
                inputs = newLen - i;
                backspaces = oldLen - i;
                break;
            }
        }

        // Send the key events
        for (let i = 0; i < backspaces; i++) {
            UI.rfb.sendKey(KeyTable.XK_BackSpace, "Backspace");
        }
        for (let i = newLen - inputs; i < newLen; i++) {
            UI.rfb.sendKey(keysyms.lookup(newValue.charCodeAt(i)));
        }

        // Control the text content length in the keyboardinput element
        if (newLen > 2 * UI.defaultKeyboardinputLen) {
            UI.keyboardinputReset();
        } else if (newLen < 1) {
            // There always have to be some text in the keyboardinput
            // element with which backspace can interact.
            UI.keyboardinputReset();
            // This sometimes causes the keyboard to disappear for a second
            // but it is required for the android keyboard to recognize that
            // text has been added to the field
            event.target.blur();
            // This has to be ran outside of the input handler in order to work
            setTimeout(event.target.focus.bind(event.target), 0);
        } else {
            UI.lastKeyboardinput = newValue;
        }
    },

/* ------^-------
 *   /KEYBOARD
 * ==============
 *   EXTRA KEYS
 * ------v------*/

    openExtraKeys() {
        UI.closeAllPanels();
        UI.openControlbar();

        document.getElementById('noVNC_modifiers')
            .classList.add("noVNC_open");
        document.getElementById('noVNC_toggle_extra_keys_button')
            .classList.add("noVNC_selected");
    },

    closeExtraKeys() {
        document.getElementById('noVNC_modifiers')
            .classList.remove("noVNC_open");
        document.getElementById('noVNC_toggle_extra_keys_button')
            .classList.remove("noVNC_selected");
    },

    toggleExtraKeys() {
        if (document.getElementById('noVNC_modifiers')
            .classList.contains("noVNC_open")) {
            UI.closeExtraKeys();
        } else  {
            UI.openExtraKeys();
        }
    },

    sendEsc() {
        UI.sendKey(KeyTable.XK_Escape, "Escape");
    },

    sendTab() {
        UI.sendKey(KeyTable.XK_Tab, "Tab");
    },

    toggleCtrl() {
        const btn = document.getElementById('noVNC_toggle_ctrl_button');
        if (btn.classList.contains("noVNC_selected")) {
            UI.sendKey(KeyTable.XK_Control_L, "ControlLeft", false);
            btn.classList.remove("noVNC_selected");
        } else {
            UI.sendKey(KeyTable.XK_Control_L, "ControlLeft", true);
            btn.classList.add("noVNC_selected");
        }
    },

    toggleWindows() {
        const btn = document.getElementById('noVNC_toggle_windows_button');
        if (btn.classList.contains("noVNC_selected")) {
            UI.sendKey(KeyTable.XK_Super_L, "MetaLeft", false);
            btn.classList.remove("noVNC_selected");
        } else {
            UI.sendKey(KeyTable.XK_Super_L, "MetaLeft", true);
            btn.classList.add("noVNC_selected");
        }
    },

    toggleAlt() {
        const btn = document.getElementById('noVNC_toggle_alt_button');
        if (btn.classList.contains("noVNC_selected")) {
            UI.sendKey(KeyTable.XK_Alt_L, "AltLeft", false);
            btn.classList.remove("noVNC_selected");
        } else {
            UI.sendKey(KeyTable.XK_Alt_L, "AltLeft", true);
            btn.classList.add("noVNC_selected");
        }
    },

    sendCtrlAltDel() {
        UI.rfb.sendCtrlAltDel();
        // See below
        UI.rfb.focus();
        UI.idleControlbar();
    },

    sendKey(keysym, code, down) {
        UI.rfb.sendKey(keysym, code, down);

        // Move focus to the screen in order to be able to use the
        // keyboard right after these extra keys.
        // The exception is when a virtual keyboard is used, because
        // if we focus the screen the virtual keyboard would be closed.
        // In this case we focus our special virtual keyboard input
        // element instead.
        if (document.getElementById('noVNC_keyboard_button')
            .classList.contains("noVNC_selected")) {
            document.getElementById('noVNC_keyboardinput').focus();
        } else {
            UI.rfb.focus();
        }
        // fade out the controlbar to highlight that
        // the focus has been moved to the screen
        UI.idleControlbar();
    },

/* ------^-------
 *   /EXTRA KEYS
 * ==============
 *     MISC
 * ------v------*/

    updateViewOnly() {
        if (!UI.rfb) return;
        UI.rfb.viewOnly = UI.getSetting('view_only');

        // Hide input related buttons in view only mode
        if (UI.rfb.viewOnly) {
            document.getElementById('noVNC_keyboard_button')
                .classList.add('noVNC_hidden');
            document.getElementById('noVNC_toggle_extra_keys_button')
                .classList.add('noVNC_hidden');
            document.getElementById('noVNC_clipboard_button')
                .classList.add('noVNC_hidden');
        } else {
            document.getElementById('noVNC_keyboard_button')
                .classList.remove('noVNC_hidden');
            document.getElementById('noVNC_toggle_extra_keys_button')
                .classList.remove('noVNC_hidden');
            document.getElementById('noVNC_clipboard_button')
                .classList.remove('noVNC_hidden');
        }
    },

    updateShowDotCursor() {
        if (!UI.rfb) return;
        UI.rfb.showDotCursor = UI.getSetting('show_dot');
    },

    updateLogging() {
        WebUtil.initLogging(UI.getSetting('logging'));
    },

    updateDesktopName(e) {
        UI.desktopName = e.detail.name;
        // Display the desktop name in the document title
        document.title = e.detail.name + " - " + PAGE_TITLE;
    },

    bell(e) {
        if (UI.getSetting('bell') === 'on') {
            const promise = document.getElementById('noVNC_bell').play();
            // The standards disagree on the return value here
            if (promise) {
                promise.catch((e) => {
                    if (e.name === "NotAllowedError") {
                        // Ignore when the browser doesn't let us play audio.
                        // It is common that the browsers require audio to be
                        // initiated from a user action.
                    } else {
                        Log.Error("Unable to play bell: " + e);
                    }
                });
            }
        }
    },

    //Helper to add options to dropdown.
    addOption(selectbox, text, value) {
        const optn = document.createElement("OPTION");
        optn.text = text;
        optn.value = value;
        selectbox.options.add(optn);
    },

/* ------^-------
 *    /MISC
 * ==============
 */
};

export default UI;
