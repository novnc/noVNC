/*
 * KasmVNC: HTML5 VNC client
 * Copyright (C) 2020 Kasm Technologies
 * Copyright (C) 2019 The noVNC Authors
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 */

import {showNotification} from "../core/util/notifications";

window._noVNC_has_module_support = true;
window.addEventListener("load", function() {
    if (window._noVNC_has_module_support) return;
    var loader = document.createElement("script");
    loader.src = "vendor/browser-es-module-loader/dist/browser-es-module-loader.js";
    document.head.appendChild(loader);
});


window.updateSetting = (name, value) => {
    WebUtil.writeSetting(name, value);

    switch (name) {
        case "translate_shortcuts":
            UI.updateShortcutTranslation();
        break;
    }
}

import '@interactjs/pointer-events'
import '@interactjs/actions/drag'
import interact from '@interactjs/interact';
import "core-js/stable";
import "regenerator-runtime/runtime";
import * as Log from '../core/util/logging.js';
import _, { l10n } from './localization.js';
import { isTouchDevice, isSafari, hasScrollbarGutter, dragThreshold, supportsBinaryClipboard, isFirefox, isWindows, isIOS, supportsPointerLock, supportsKeyboardLock }
    from '../core/util/browser.js';
import { setCapture, getPointerEvent } from '../core/util/events.js';
import KeyTable from "../core/input/keysym.js";
import RFB from "../core/rfb.js";
import { MouseButtonMapper, XVNC_BUTTONS } from "../core/mousebuttonmapper.js";
import * as WebUtil from "./webutil.js";
import { uuidv4 } from '../core/util/strings.js';
import BasicChart from '../core/chart.js';
import {
    UI_SETTINGS_STREAM_MODE_QUALITY_SETTINGS_GROUPS,
    UI_SETTINGS_CONTROL_ID as UI_SETTINGS,
    FPS,
    QUALITY_LEVEL_DEFAULT,
    COMPRESSION_LEVEL_DEFAULT
} from './constants.js';
import {encodings} from "../core/encodings.js";
import { normalizeFrameRate } from "../core/util/frame-rate.js";
import CodecDetector, {CODEC_VARIANT_NAMES, preferredCodecs} from "../core/codecs";
import { perfLogger } from '../core/util/performance-logger.js';

// Enable performance logging
// perfLogger.enable(5000);

const PAGE_TITLE = "KasmVNC";

var currentEventCount = -1;
var idleCounter = 0;

const UI = {

    connected: false,
    desktopName: "",

    statusTimeout: null,
    hideKeyboardTimeout: null,
    textInputFocusHideTimeout: null,
    textInputCaret: null,
    textInputPanY: 0,
    textInputViewportHandler: null,
    textInputSuppressed: false,
    idleControlbarTimeout: null,
    closeControlbarTimeout: null,

    controlbarGrabbed: false,
    controlbarDrag: false,
    controlbarMouseDownClientY: 0,
    controlbarMouseDownOffsetY: 0,

    inhibitReconnect: true,
    reconnectCallback: null,
    reconnectPassword: null,
    reconnectAttempts: 0,
    suppressDisconnectRx: false,
    kasmSessionLastActiveAt: null,
    kasmIdleDisconnectInS: null,
    kasmIdleTimeoutSent: false,
    _sessionTimeoutInterval: null,
    monitors: [],
    sortedMonitors: [],
    selectedMonitor: null,
    refreshRotation: 0,
    currentDisplay: null,
    displayWindows: new Map([['primary', 'primary']]),
    registeredWindows: new Map([['primary', 'primary']]),
    STATS_INTERVAL_MS: 5000,
    fpsChart: null,
    enhancedMetrics: false,
    bandwidthChart: null,
    capacityChart: null,
    lastRxSample: null,
    jitterChart: null,
    rttChart: null,

    monitorDragOk: false,
    monitorStartX: 0,
    monitorStartY: 0,

    multiMonitorSupport: (typeof MessageChannel !== "undefined"),
    get supportsMultiMonitor() {
        return this.multiMonitorSupport;
    },
    codecDetector: null,
    forcedCodecs: [],
    controlPanelAssetsModule: null,

    getControlPanelAssetsModule() {
        if (!UI.controlPanelAssetsModule) {
            UI.controlPanelAssetsModule = import('./control-panel-assets.js');
        }
        return UI.controlPanelAssetsModule;
    },

    loadControlPanelAssets() {
        return UI.getControlPanelAssetsModule()
            .then(module => module.applyControlPanelAssets());
    },

    loadKeyboardControlAssets() {
        return UI.getControlPanelAssetsModule()
            .then(module => module.applyKeyboardControlAssets());
    },

    prime: async () => {
        await WebUtil.initSettings();
        try {
            const detector = await (new CodecDetector()).detect();
            UI.codecDetector = detector;

            Log.Debug('Supported Codecs: ', detector.getSupportedCodecs());
        } catch (e) {
            Log.Warn('Failed to detect codecs: ', e);
        }

        if (document.readyState === "interactive" || document.readyState === "complete") {
            return UI.start();
        }

        return new Promise((resolve, reject) => {
            document.addEventListener('DOMContentLoaded', () => UI.start().then(resolve).catch(reject));
        });
    },

    // Render default UI and initialize settings menu
    start() {

        // If secondary monitor skip init
        if (window.location.href.includes("screen.html")) {
            return;
        }

        if (!WebUtil.isInsideKasmVDI() || WebUtil.getConfigVar('show_control_bar')) {
            UI.loadControlPanelAssets()
                .catch(err => Log.Error(`Couldn't load control panel assets: ${err}`));
        } else {
            document.getElementById('noVNC_control_bar_anchor').style.display = 'none';
        }

        // Initialize settings then apply quality presents
        UI.initSettings();
        UI.updateQuality();

        // Translate the DOM
        l10n.translateDOM();

        // Adapt the interface for touch screen devices
        if (isTouchDevice) {
            document.documentElement.classList.add("noVNC_touch");
            // Remove the address bar
            setTimeout(() => window.scrollTo(0, 1), 100);
        }

        // Restore control bar position
        if (WebUtil.readSetting('controlbar_pos') === 'right') {
            UI.toggleControlbarSide();
        }

        UI.initFullscreen();

        // Setup event handlers
        UI.addKeyboardControlsPanelHandlers();
        UI.addControlbarHandlers();
        UI.addTouchSpecificHandlers();
        UI.addExtraKeysHandlers();
        UI.addGamingHandlers();
        UI.addMachineHandlers();
        UI.addConnectionControlHandlers();
        UI.addClipboardHandlers();
        UI.addSettingsHandlers();
        UI.addDisplaysHandler();
        // UI.addMultiMonitorAddHandler();
        document.getElementById("noVNC_status").addEventListener('click', UI.hideStatus);
        UI.openControlbar();

        UI.updateVisualState('init');

        document.documentElement.classList.remove("noVNC_loading");

        let autoconnect = WebUtil.getConfigVar('autoconnect', true);
        if (autoconnect === 'true' || autoconnect == '1') {
            autoconnect = true;
            UI.connect();
        } else {
            autoconnect = false;
        }

        window.parent.postMessage({
            action: "noVNC_initialized",
            value: null
        }, "*");

        window.addEventListener("message", (e) => {
            if (e.source !== window.parent) {
                return;
            }

            if (typeof e.data !== "object" || !e.data.action) {
                return;
            }

            if (e.data.action === "show_keyboard_controls") {
                UI.showKeyboardControls();
            } else if (e.data.action === "hide_keyboard_controls") {
                UI.hideKeyboardControls();
            }
        });

        window.addEventListener("beforeunload", (e) => {
            // Clean up secondary display connection before window closes
            const urlParams = new URLSearchParams(window.location.search);
            const windowId = urlParams.get('windowId');

            if (UI.rfb && windowId) {
                // This is a secondary display - unregister it without disconnecting main session
                UI.rfb._unregisterSecondaryDisplay();
            }
        });

        window.addEventListener("unload", (e) => {
            // Only disconnect main window (without windowId parameter)
            const urlParams = new URLSearchParams(window.location.search);
            const windowId = urlParams.get('windowId');

            if (UI.rfb && !windowId) {
                UI.disconnect();
            }
        });

        return Promise.resolve(UI.rfb);
    },

    initFullscreen() {
        // Only show the button if fullscreen is properly supported
        // * Safari doesn't support alphanumerical input while in fullscreen
        if (!isSafari() &&
            (document.documentElement.requestFullscreen ||
             document.documentElement.mozRequestFullScreen ||
             document.documentElement.webkitRequestFullscreen ||
             document.body.msRequestFullscreen)) {
                UI.showControlInput("noVNC_fullscreen_button")
                UI.addFullscreenHandlers();
            }
    },

    initSettings() {
        // Logging selection dropdown
        const llevels = ['error', 'warn', 'info', 'debug'];
        for (let i = 0; i < llevels.length; i += 1) {
            UI.addOption(document.getElementById('noVNC_setting_logging'), llevels[i], llevels[i]);
        }

        if ('getScreenDetails' in window) {
            document.getElementById('noVNC_auto_placement_option').classList.add("show");
        }

        const initialAutoPlacementValue = window.localStorage.getItem('autoPlacement')
        if (initialAutoPlacementValue === null) {
            document.getElementById("noVNC_auto_placement").checked = true
        }

        // Settings with immediate effects
        UI.initSetting('logging', 'warn');
        UI.updateLogging();

        // Stream Quality Presets
        let qualityDropdown = document.getElementById("noVNC_setting_video_quality");
        qualityDropdown.appendChild(Object.assign(document.createElement("option"),{value:0,label:"Static"}))
        qualityDropdown.appendChild(Object.assign(document.createElement("option"),{value:1,label:"Low"}))
        qualityDropdown.appendChild(Object.assign(document.createElement("option"),{value:2,label:"Medium"}))
        qualityDropdown.appendChild(Object.assign(document.createElement("option"),{value:3,label:"High"}))
        qualityDropdown.appendChild(Object.assign(document.createElement("option"),{value:4,label:"Extreme"}))
        qualityDropdown.appendChild(Object.assign(document.createElement("option"),{value:5,label:"Lossless"}))
        qualityDropdown.appendChild(Object.assign(document.createElement("option"),{value:10,label:"Custom"}))

        // if port == 80 (or 443) then it won't be present and should be
        // set manually
        let port = window.location.port;
        if (!port) {
            if (window.location.protocol.substring(0, 5) == 'https') {
                port = 443;
            } else if (window.location.protocol.substring(0, 4) == 'http') {
                port = 80;
            }
        }

        /* Populate the controls if defaults are provided in the URL */
        UI.initSetting('host', window.location.hostname);
        UI.initSetting('port', port);
        UI.initSetting('encrypt', (window.location.protocol === "https:"));
        UI.initSetting('view_clip', false);
        /* UI.initSetting('resize', 'off'); */
        UI.initSetting('quality', QUALITY_LEVEL_DEFAULT);
        UI.initSetting('dynamic_quality_min', 3);
        UI.initSetting('dynamic_quality_max', 9);
        UI.initSetting('translate_shortcuts', true);
        UI.initSetting('treat_lossless', 7);
        UI.initSetting('jpeg_video_quality', 5);
        UI.initSetting('webp_video_quality', 5);
        UI.initSetting('video_quality', 2);
        UI.initSetting('anti_aliasing', 0);
        UI.initSetting('video_rendering_mode', 'canvas2d');
        UI.initSetting('video_area', 65);
        UI.initSetting('video_time', 5);
        UI.initSetting('video_out_time', 3);
        UI.initSetting('video_scaling', 2);
        UI.initSetting('max_video_resolution_x', 960);
        UI.initSetting('max_video_resolution_y', 540);
        UI.initSetting('framerate', FPS.MIN);
        UI.initSetting('framerate_image_mode', FPS.MIN);
        UI.initSetting('framerate_streaming_mode', FPS.MIN);
        UI.initSetting('compression', COMPRESSION_LEVEL_DEFAULT);
        UI.initSetting('shared', true);
        UI.initSetting('view_only', false);
        UI.initSetting('show_dot', false);
        UI.initSetting('path', 'websockify');
        UI.initSetting('repeaterID', '');
        UI.initSetting('reconnect', WebUtil.isInsideKasmVDI());
        UI.initSetting('reconnect_delay', 5000);
        UI.initSetting('reconnect_retries', 5);
        UI.initSetting('idle_disconnect', 20);
        UI.initSetting('prefer_local_cursor', true);
        UI.initSetting('toggle_control_panel', false);
        UI.initSetting('enable_perf_stats', false);
        UI.initSetting('enable_latency_stats', false);
        UI.initSetting('enable_threading', true);
        UI.initSetting('virtual_keyboard_visible', false);
        UI.initSetting('enable_ime', false);
        UI.initSetting('touch_mode', 'native');
        UI.initSetting('auto_keyboard', true);
        UI.initSetting('enable_webrtc', false);
        UI.initSetting('enable_hidpi', false);
        UI.initSetting('fallback_image_mode', false);

        UI.initSetting(UI_SETTINGS.STREAM_MODE, encodings.pseudoEncodingStreamingModeJpegWebp);
        // UI.initSetting(UI_SETTINGS.HW_PROFILE, UI_SETTING_PROFILE_OPTIONS.BASELINE);
        UI.initSetting(UI_SETTINGS.GOP, this.getSetting('framerate'));
        UI.initSetting(UI_SETTINGS.VIDEO_STREAM_QUALITY, 43);
        // UI.initSetting(UI_SETTINGS.PRESET, 3);

        UI.toggleKeyboardControls();

        if ((WebUtil.isInsideKasmVDI()) && (! WebUtil.getConfigVar('show_control_bar'))) {
            UI.initSetting('clipboard_up', false);
            UI.initSetting('clipboard_down', false);
            // Get the value sent in via URL parameter, default to off
            UI.initSetting('clipboard_seamless', false);
            // Kasm workspaces sets to true if it is allowed, but that does not mean it is supported
            let clip_s = UI.getSetting('clipboard_seamless');
            // Its enabled in Kasm Workspaces, but is it supported by the client
            if (clip_s) {
                if (isFirefox() || isSafari()) {
                    UI.forceSetting('clipboard_seamless', false);
                }
            }
            UI.initSetting('enable_webp', false);
            UI.initSetting('resize', 'off');
        } else {
            UI.initSetting('clipboard_up', true);
            UI.initSetting('clipboard_down', true);
            if (isFirefox() || isSafari()) {
                UI.initSetting('clipboard_seamless', false);
            } else {
                UI.initSetting('clipboard_seamless', true);
            }
            UI.initSetting('enable_webp', true);
            UI.initSetting('resize', 'remote');
        }

        if (WebUtil.isInsideKasmVDI()) {
            UI.initSetting('video_quality', WebUtil.getConfigVar('video_quality', 2));
        }

        UI.setupSettingLabels();
        UI.updateQuality();

        // VDI setting
        let val = WebUtil.getConfigVar('kasmvnc_mode_preference');
        if (val === 'image') {
            UI.forcedCodecs = [encodings.pseudoEncodingStreamingModeJpegWebp];
            Log.Debug('VDI setting: image');
            return;
        }

        if (val != null) {
            UI.forcedCodecs = val.split('|').map(Number);
            Log.Debug('VDI setting: ' + UI.forcedCodecs);
        }
    },
    initMouseButtonMapper() {
        const mouseButtonMapper = new MouseButtonMapper();

        const settings = WebUtil.readSetting("mouseButtonMapper");
        if (settings) {
            mouseButtonMapper.load(settings);
            return mouseButtonMapper;
        }

        mouseButtonMapper.set(0, XVNC_BUTTONS.LEFT_BUTTON);
        mouseButtonMapper.set(1, XVNC_BUTTONS.MIDDLE_BUTTON);
        mouseButtonMapper.set(2, XVNC_BUTTONS.RIGHT_BUTTON);
        mouseButtonMapper.set(3, XVNC_BUTTONS.BACK_BUTTON);
        mouseButtonMapper.set(4, XVNC_BUTTONS.FORWARD_BUTTON);
        WebUtil.writeSetting("mouseButtonMapper", mouseButtonMapper.dump());

        return mouseButtonMapper;
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

    addKeyboardControlsPanelHandlers() {
        // panel dragging
        interact(".keyboard-controls").draggable({
            allowFrom: ".handle",
            listeners: {
                move: (e) => {
                    const target = e.target;
                    const x = (parseFloat(target.getAttribute("data-x")) || 0) + e.dx;
                    const y = (parseFloat(target.getAttribute("data-y")) || 0) + e.dy;
                    target.style.transform = `translate(${x}px, ${y}px)`;
                    target.setAttribute("data-x", x);
                    target.setAttribute("data-y", y);
                },
            },
        });

        // panel expanding
        interact(".keyboard-controls .handle")
        .pointerEvents({ holdDuration: 350 })
        .on("hold", (e) => {
            const buttonsEl = document.querySelector(".keyboard-controls");

            const isOpen = buttonsEl.classList.contains("is-open");
            buttonsEl.classList.toggle("was-open", isOpen);
            buttonsEl.classList.toggle("is-open", !isOpen);

            setTimeout(() => buttonsEl.classList.remove("was-open"), 500);
        });

        // keyboard showing
        interact(".keyboard-controls .handle").on("tap", (e) => {
            if (e.dt < 150) {
                UI.toggleVirtualKeyboard();
            }
        });

        // panel buttons
        interact(".keyboard-controls .button.ctrl").on("tap", UI.toggleCtrl);
        interact(".keyboard-controls .button.alt").on("tap", UI.toggleAlt);
        interact(".keyboard-controls .button.windows").on("tap", UI.toggleWindows);
        interact(".keyboard-controls .button.tab").on("tap", UI.sendTab);
        interact(".keyboard-controls .button.escape").on("tap", UI.sendEsc);
        interact(".keyboard-controls .button.ctrlaltdel").on("tap", UI.sendCtrlAltDel);
    },

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

        UI.addClickHandle('noVNC_view_drag_button', UI.toggleViewDrag);

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

    addConnectionControlHandlers() {
        UI.addClickHandle('noVNC_disconnect_button', UI.disconnect);

        var connect_btn_el = document.getElementById("noVNC_connect_button_2");
        if (typeof(connect_btn_el) != 'undefined' && connect_btn_el != null)
        {
            connect_btn_el.addEventListener('click', UI.connect);
        }

    },

    addTouchSpecificHandlers() {
        document.getElementById("noVNC_keyboard_button")
            .addEventListener('click', UI.toggleVirtualKeyboard);
        document.getElementById("noVNC_keyboard_button")
            .addEventListener('touch', UI.toggleVirtualKeyboard);
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
        UI.addClickHandle('noVNC_toggle_extra_keys_button', UI.toggleExtraKeys);

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

    addGamingHandlers() {
        UI.addClickHandle('noVNC_game_mode_button', UI.toggleRelativePointer);
        document
            .getElementById("noVNC_setting_pointer_lock")
            .addEventListener("click", UI.togglePointerLock);
    },

    addMachineHandlers() {
        UI.addClickHandle('noVNC_power_button', UI.togglePowerPanel);

        document.getElementById("noVNC_shutdown_button")
            .addEventListener('click', () => UI.rfb.machineShutdown());
        document.getElementById("noVNC_reboot_button")
            .addEventListener('click', () => UI.rfb.machineReboot());
        document.getElementById("noVNC_reset_button")
            .addEventListener('click', () => UI.rfb.machineReset());
    },

    addClipboardHandlers() {
        UI.addClickHandle('noVNC_clipboard_button', UI.toggleClipboardPanel);

        document.getElementById("noVNC_clipboard_text")
            .addEventListener('change', UI.clipboardSend);
        document.getElementById("noVNC_clipboard_clear_button")
            .addEventListener('click', UI.clipboardClear);
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

    addSettingChangeHandlerByName(name) {
        this.addSettingChangeHandler(name, UI.updatePropertyName(name));
    },

    addSettingsHandlers() {
        UI.addClickHandle('noVNC_settings_button', UI.toggleSettingsPanel);

        document.getElementById("noVNC_setting_enable_perf_stats").addEventListener('click', UI.showStats);
        document.getElementById("noVNC_setting_enable_latency_stats").addEventListener('click', UI.toggleLatencyStats);
        document.getElementById("noVNC_setting_enable_threading").addEventListener('click', UI.threading);
        document.getElementById("noVNC_auto_placement").addEventListener('change', UI.setAutoPlacement);

        UI.addSettingChangeHandler('encrypt');
        UI.addSettingChangeHandler('resize');
        UI.addSettingChangeHandler('resize', UI.applyResizeMode);
        UI.addSettingChangeHandler('resize', UI.updateViewClip);
        UI.addSettingChangeHandler('quality');
        UI.addSettingChangeHandler('quality', UI.updateQuality);
        UI.addSettingChangeHandler('dynamic_quality_min');
        UI.addSettingChangeHandler('dynamic_quality_min', UI.updateQuality);
        UI.addSettingChangeHandler('dynamic_quality_max');
        UI.addSettingChangeHandler('dynamic_quality_max', UI.updateQuality);
        UI.addSettingChangeHandler('translate_shortcuts');
        UI.addSettingChangeHandler('translate_shortcuts', UI.updateShortcutTranslation);
        UI.addSettingChangeHandler('treat_lossless');
        UI.addSettingChangeHandler('treat_lossless', UI.updateQuality);
        UI.addSettingChangeHandler('anti_aliasing');
        UI.addSettingChangeHandler('anti_aliasing', UI.updateQuality);
        UI.addSettingChangeHandler('video_rendering_mode');
        UI.addSettingChangeHandler('video_rendering_mode', UI.updateVideoRenderingMode);
        UI.addSettingChangeHandler('video_quality');
        UI.addSettingChangeHandler('video_quality', UI.updateQuality);
        UI.addSettingChangeHandler('jpeg_video_quality');
        UI.addSettingChangeHandler('jpeg_video_quality', UI.updateQuality);
        UI.addSettingChangeHandler('webp_video_quality');
        UI.addSettingChangeHandler('webp_video_quality', UI.updateQuality);
        UI.addSettingChangeHandler('video_area');
        UI.addSettingChangeHandler('video_area', UI.updateQuality);
        UI.addSettingChangeHandler('video_time');
        UI.addSettingChangeHandler('video_time', UI.updateQuality);
        UI.addSettingChangeHandler('video_out_time');
        UI.addSettingChangeHandler('video_out_time', UI.updateQuality);
        UI.addSettingChangeHandler('video_scaling');
        UI.addSettingChangeHandler('video_scaling', UI.updateQuality);
        UI.addSettingChangeHandler('max_video_resolution_x');
        UI.addSettingChangeHandler('max_video_resolution_x', UI.updateQuality);
        UI.addSettingChangeHandler('max_video_resolution_y');
        UI.addSettingChangeHandler('max_video_resolution_y', UI.updateQuality);
        UI.addSettingChangeHandler('framerate_image_mode', () => {
            const value = UI.getSettingElement('framerate_image_mode').value;
            UI.getSettingElement('framerate_streaming_mode').value = value;
            WebUtil.writeSetting('framerate_image_mode', value);
            WebUtil.writeSetting('framerate_streaming_mode', value);
            UI.updateQuality();
        });
        UI.addSettingChangeHandler('framerate_streaming_mode', () => {
            const value = UI.getSettingElement('framerate_streaming_mode').value;
            WebUtil.writeSetting('framerate_streaming_mode', value);
            UI.updateQuality();
        });
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
        UI.addSettingChangeHandler('reconnect_retries');
        UI.addSettingChangeHandler('enable_webp');
        UI.addSettingChangeHandler('clipboard_seamless');
        UI.addSettingChangeHandler('clipboard_up');
        UI.addSettingChangeHandler('clipboard_down');
        UI.addSettingChangeHandler('toggle_control_panel');
        UI.addSettingChangeHandler('virtual_keyboard_visible');
        UI.addSettingChangeHandler('virtual_keyboard_visible', UI.toggleKeyboardControls);
        UI.addSettingChangeHandler('enable_ime');
        UI.addSettingChangeHandler('enable_ime', UI.toggleIMEMode);
        UI.addSettingChangeHandler('auto_keyboard');
        UI.addSettingChangeHandler('auto_keyboard', UI.updateAutoKeyboard);
        UI.addSettingChangeHandler('touch_mode');
        UI.addSettingChangeHandler('touch_mode', UI.updateTouchMode);
        UI.addSettingChangeHandler('enable_webrtc');
        UI.addSettingChangeHandler('enable_webrtc', UI.toggleWebRTC);
        UI.addSettingChangeHandler('enable_hidpi');
        UI.addSettingChangeHandler('enable_hidpi', UI.enableHiDpi);
        UI.addSettingChangeHandler('enable_threading');
        UI.addSettingChangeHandler('enable_threading', UI.threading);

        UI.addSettingChangeHandler(UI_SETTINGS.STREAM_MODE, UI.streamMode);
        // UI.addSettingChangeHandlerByName(UI_SETTINGS.HW_PROFILE);
        UI.addSettingChangeHandlerByName(UI_SETTINGS.GOP);
        UI.addSettingChangeHandlerByName(UI_SETTINGS.VIDEO_STREAM_QUALITY);
        // UI.addSettingChangeHandlerByName(UI_SETTINGS.PRESET);
    },

    addFullscreenHandlers() {
        UI.addClickHandle('noVNC_fullscreen_button', UI.toggleFullscreen);

        window.addEventListener('fullscreenchange', UI.updateFullscreenButton);
        window.addEventListener('mozfullscreenchange', UI.updateFullscreenButton);
        window.addEventListener('webkitfullscreenchange', UI.updateFullscreenButton);
        window.addEventListener('msfullscreenchange', UI.updateFullscreenButton);
    },

    addDisplaysHandler() {
        if (UI.supportsMultiMonitor) {
            UI.showControlInput("noVNC_displays_button");
            UI.addClickHandle('noVNC_displays_button', UI.openDisplays);
            UI.addClickHandle('noVNC_close_displays', UI.closeDisplays);
            UI.addClickHandle('noVNC_identify_monitors_button', UI._identify);
            UI.addClickHandle('noVNC_addMonitor', UI.addSecondaryMonitor);
            UI.addClickHandle('noVNC_refreshMonitors', UI.displaysRefresh);

        }
    },

    setAutoPlacement(e) {
        if (e.target.checked === false) {
            window.localStorage.setItem('autoPlacement', false)
        } else {
            window.localStorage.removeItem('autoPlacement')
        }
    },

    /*addMultiMonitorAddHandler() {
        if (UI.supportsBroadcastChannel) {
            UI.addClickHandle('noVNC_addmonitor_button', UI.addSecondaryMonitor);
        }
    },*/

/* ------^-------
 * /EVENT HANDLERS
 * ==============
 *     VISUAL
 * ------v------*/
    // Ignore clicks that are propogated from child elements in sub panels
    isControlPanelItemClick(e) {
        if (!e?.target?.classList || !e?.target?.parentNode)
            return false;

        return e.target.classList.contains('noVNC_button') && e.target.parentNode?.id !== 'noVNC_modifiers' ||
                e.target.classList.contains('noVNC_button_div') ||
                e.target.classList.contains('noVNC_heading');
    },

    // Disable/enable controls depending on connection state
    updateVisualState(state) {
        document.documentElement.classList.remove("noVNC_connecting");
        document.documentElement.classList.remove("noVNC_connected");
        document.documentElement.classList.remove("noVNC_disconnecting");
        document.documentElement.classList.remove("noVNC_reconnecting");
        document.documentElement.classList.remove("noVNC_disconnected");

        const transitionElem = document.getElementById("noVNC_transition_text");
        UI.sendMessage('connection_state', state);

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
                document.documentElement.classList.add("noVNC_disconnected");
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
        //UI.updatePointerLockButton();

        // State change closes dialogs as they may not be relevant
        // anymore
        UI.closeAllPanels();
    },

    showStats() {
        // Read checkbox state directly and save it
        const perfStatsToggle = document.getElementById('noVNC_setting_enable_perf_stats');
        const enableStats = perfStatsToggle ? perfStatsToggle.checked : false;
        UI.saveSetting('enable_perf_stats');

        if (!enableStats)
            UI.lastRxSample = null;

        const showPanel = enableStats && !UI.enhancedMetrics;
        document.getElementById("noVNC_connection_stats")?.style.setProperty("visibility", showPanel ? "visible" : "hidden");
        document.getElementById("noVNC_charts_container")?.classList.toggle('visible', showPanel);

        ["noVNC_fps_chart", "noVNC_rtt_chart", "noVNC_jitter_chart", "noVNC_bandwidth_chart"].forEach((id) => {
            document.getElementById(id)?.style.setProperty("display", showPanel ? "flex" : "none");
        });

        UI.updateStatsPolling();
    },

    updateStatsPolling() {
        if (UI.statsInterval) {
            clearInterval(UI.statsInterval);
            UI.statsInterval = null;
        }

        if (UI.getSetting('enable_perf_stats') || UI.enhancedMetrics) {
            UI.statsInterval = setInterval(function () {
                if (UI.rfb) {
                    UI.rfb.requestBottleneckStats();
                }
            }, UI.STATS_INTERVAL_MS);
        }
    },

    updateEnhancedMetrics() {
        if (UI.enhancedMetrics)
            UI.forceSetting('enable_latency_stats', false, false);

        UI.showStats();
        if (UI.rfb) {
            UI.rfb.enableInputLatencyMeasurement(UI.getSetting('enable_latency_stats') || UI.enhancedMetrics);
        }
    },

    toggleLatencyStats() {
        UI.saveSetting('enable_latency_stats');
        if (!UI.rfb)
            return;

        const enabled = document.getElementById('noVNC_setting_enable_latency_stats').checked;
        UI.rfb.enableInputLatencyMeasurement(enabled || UI.enhancedMetrics);
    },

    threading() {
        if (UI.rfb) {
            if (UI.getSetting('enable_threading')) {
                UI.rfb.threading = true;
            } else {
                UI.rfb.threading = false;
            }
        }
        UI.saveSetting('enable_threading');
    },

    updatePropertyName(propertyName) {
        return UI.updateRfbProperty(propertyName, propertyName);
    },

    updateRfbProperty(propertyName, settingId) {
        return (event) => {
            if (UI.rfb) {
                UI.rfb  [propertyName] = Number(event.target.value);
            }
            UI.saveSetting(settingId);

            UI.updateQuality();
        }
    },

    gop(event) {
        if (UI.rfb) {
            UI.rfb.gop = Number(event.target.value);
        }
        UI.saveSetting(UI_SETTINGS.GOP);
    },

    videoStreamQuality(event) {
        if (UI.rfb) {
            UI.rfb.videoStreamQuality = Number(event.target.value);
        }
        Log.Debug('Saving quality:', event.target.value, 'Stream mode:', UI.getSetting(UI_SETTINGS.STREAM_MODE));
        Log.Debug('Codec configs:', UI.rfb?.videoCodecConfigurations);
        UI.saveSetting(UI_SETTINGS.VIDEO_STREAM_QUALITY);
    },

    qualityPreset(event) {
        if (UI.rfb) {
            UI.rfb.qualityPreset = Number(event.target.value);
        }
        UI.saveSetting(UI_SETTINGS.PRESET);
    },

    streamMode(event) {
        const value = Number(event.target.value);
        UI.saveSetting(UI_SETTINGS.STREAM_MODE);
        UI.applyStreamMode(value, event.configuration);
    },

    applyStreamMode(mode, configuration) {
        UI.toggleStreamModeGroupVisibility(mode);

        const isImageMode = mode === encodings.pseudoEncodingStreamingModeJpegWebp;
        if (!isImageMode) {
            const videoCodecConfigurations = UI.rfb?.videoCodecConfigurations;
            const config = configuration || videoCodecConfigurations?.[mode];

            if (WebUtil.isInsideKasmVDI()) {
                const settingValue = videoCodecConfigurations?.[mode]?.presets;
                if (settingValue) {
                    const quality = parseInt(WebUtil.readSetting('video_quality'));
                    const curQualityValue = parseInt(UI.getSetting(UI_SETTINGS.VIDEO_STREAM_QUALITY));
                    if (settingValue[quality] !== undefined && curQualityValue !== settingValue[quality]) {
                        UI.forceSetting(UI_SETTINGS.VIDEO_STREAM_QUALITY, settingValue[quality], false);
                    }
                }
            }

            UI.updateQualitySliderRange(mode, config);
        }

        const framerateSettingName = isImageMode ? 'framerate_image_mode' : 'framerate_streaming_mode';
        const frameRate = parseInt(UI.getSetting(framerateSettingName));
        UI.updateQuality(frameRate);
        UI.rfb?._requestFullRefresh();

        const streamModeElem = UI.getSettingElement(UI_SETTINGS.STREAM_MODE);
        const modeName = [...streamModeElem.options]
            .find(option => Number(option.value) === mode)?.text;

        Log.Info('Switching to mode: ', modeName ? modeName : 'Unknown Mode ', 'value:', mode);

        if (!WebUtil.isInsideKasmVDI() || UI.getSettingElement(UI_SETTINGS.SHOW_NOTIFICATIONS) || WebUtil.getConfigVar(UI_SETTINGS.SHOW_NOTIFICATIONS))
            showNotification(modeName || 'Mode Changed');
    },

    initStreamModeSetting(codecs, configurations) {
        const streamModeElem = UI.getSettingElement(UI_SETTINGS.STREAM_MODE);
        if (!streamModeElem)
            return;

        streamModeElem.innerHTML = "";

        // Always include the JPEG/WEBP image mode (fallback)
        const fallbackOption = {
            id: encodings.pseudoEncodingStreamingModeJpegWebp,
            label: "JPEG/WEBP (Images)"
        };
        const availableModes = [fallbackOption];

        const codecsAvailable = this.getAvailableStreamingModes(codecs);
        availableModes.push(...codecsAvailable);

        const previousValue = Number(UI.getSetting(UI_SETTINGS.STREAM_MODE));
        const selectedValue = this.getBestStreamingMode(availableModes, fallbackOption, previousValue);

        availableModes.sort((a, b) => b.id - a.id).forEach(option => {
            UI.addOption(streamModeElem, option.label, option.id);
        });

        streamModeElem.value = selectedValue;

        const config = configurations?.[selectedValue];
        UI.streamMode({target: streamModeElem, configuration: config});
        Log.Debug('Selected streaming mode: ', selectedValue);
        Log.Debug('Codec configuration:',  config);
        UI.sendMessage("update_codecs", {current: streamModeElem.value, codecs: availableModes});
    },

    updateQualitySliderRange(codecId, config) {
        const qualitySlider = UI.getSettingElement(UI_SETTINGS.VIDEO_STREAM_QUALITY);
        if (!qualitySlider) return;

        if (!config) {
            qualitySlider.min = 1;
            qualitySlider.max = 50;

            return;
        }

        qualitySlider.min = config.minQuality;
        qualitySlider.max = config.maxQuality;

        const currentValue = parseInt(qualitySlider.value);
        if (currentValue < config.minQuality) {
            qualitySlider.value = config.minQuality;
        } else if (currentValue > config.maxQuality) {
            qualitySlider.value = config.maxQuality;
        }

        const output = document.getElementById('noVNC_setting_video_stream_quality_output');
        if (output) {
            output.value = qualitySlider.value;
        }

        UI.saveSetting(UI_SETTINGS.VIDEO_STREAM_QUALITY);
    },

    getAvailableStreamingModes(codecs) {
        let result = [];
        if (!Array.isArray(codecs) || codecs.length === 0)
            return result;

        const forcedCodecs = UI.forcedCodecs;
        codecs = forcedCodecs.length > 0
            ? forcedCodecs.filter(id => codecs.includes(id))
            : codecs;

        const codecTuples = codecs.map((id) => {
            const label = CODEC_VARIANT_NAMES[id] ? CODEC_VARIANT_NAMES[id] : `Codec ${id}`;
            return {id, label};
        });

        result.push(...codecTuples);

        return result;
    },

    getBestStreamingMode(availableModes, fallbackOption, previousValue) {
        let result = fallbackOption.id;
        if (UI.forcedCodecs.length > 0) {
            const forcedMode = UI.forcedCodecs.find(id => availableModes.some(option => option.id === id));
            return forcedMode !== undefined ? forcedMode : fallbackOption.id;
        }

        // If we had a bad encoding event, force image mode
        if (UI.getSetting('fallback_image_mode')) {
            UI.forceSetting('fallback_image_mode', false, false);
            Log.Info('Defaulting to image mode due to previous encoding error');
            return encodings.pseudoEncodingStreamingModeJpegWebp;
        }

        // Restore selection if possible; otherwise default to JPEG/WEBP
        const hasPrevious = availableModes.some(option => option.id === previousValue);

        const availableIds = availableModes.map(option => option.id);
        const preferredMatch = preferredCodecs.filter(c => availableIds.includes(c));
        result = hasPrevious ? previousValue : encodings.pseudoEncodingStreamingModeJpegWebp;

        if (preferredMatch.length > 0) {
            if (result === encodings.pseudoEncodingStreamingModeJpegWebp) {
                result = preferredMatch[0];
            }
        }

        return result;
    },

    showStatus(text, statusType, time, kasm = false) {
        // If inside the full Kasm CDI framework, don't show messages unless explicitly told to
        if (WebUtil.isInsideKasmVDI() && !kasm) {
            return;
        }

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
        UI.sendMessage('control_open', 'Control bar opened');
    },

    closeControlbar() {
        UI.closeAllPanels();
        document.getElementById('noVNC_control_bar')
            .classList.remove("noVNC_open");
        if (UI.rfb) {
            UI.rfb.focus();
        }
        UI.sendMessage('control_close', 'Control bar closed');
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
    },

    toggleStreamModeGroupVisibility(streamModeValue) {
        const isImageGroupVisible = streamModeValue === encodings.pseudoEncodingStreamingModeJpegWebp;
        const imageGroup = document.getElementById(UI_SETTINGS_STREAM_MODE_QUALITY_SETTINGS_GROUPS.IMAGE_GROUP);
        const videoGroup = document.getElementById(UI_SETTINGS_STREAM_MODE_QUALITY_SETTINGS_GROUPS.VIDEO_GROUP);
        if (imageGroup) {
            imageGroup.style.display = isImageGroupVisible ? 'block' : 'none';
        }
        if (videoGroup) {
            videoGroup.style.display = !isImageGroupVisible ? 'block' : 'none';
        }
    },

    showControlbarHint(show) {
        const hint = document.getElementById('noVNC_control_bar_hint');
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

    addClickHandle(domElementName, funcToCall) {
        /* Add click handler, will attach to parent if appropriate */
        var control = document.getElementById(domElementName);
        if (control.parentNode.classList.contains('noVNC_button_div')) {
            control.parentNode.addEventListener('click', funcToCall);
        } else {
            control.addEventListener('click', funcToCall);
        }
    },

    showControlInput(name) {
        var control = document.getElementById(name);
        /*var control_label = document.getElementById(name + '_label');
        if (control) {
            control.classList.remove("noVNC_hidden");
        }
        if (control_label) {
            control_label.classList.remove("noVNC_hidden");
        } */
        if (control.parentNode.classList.contains('noVNC_button_div')) {
            control.parentNode.classList.remove("noVNC_hidden")
        } else {
            control.classList.remove("noVNC_hidden")
        }
    },

    hideControlInput(name) {
        var control = document.getElementById(name);
        /*var control_label = document.getElementById(name + '_label');
        if (control) {
            control.classList.add("noVNC_hidden");
        }
        if (control_label) {
            control_label.classList.add("noVNC_hidden");
        }*/
        if (control.parentNode.classList.contains('noVNC_button_div')) {
            control.parentNode.classList.add("noVNC_hidden")
        } else {
            control.classList.add("noVNC_hidden")
        }
    },

/* ------^-------
 *    /VISUAL
 * ==============
 *    SETTINGS
 * ------v------*/

    // Initial page load read/initialization of settings
    initSetting(name, defVal) {
        // Check Query string followed by cookie
        let val = WebUtil.getConfigVar(name);
        if (val === null) {
            val = WebUtil.readSetting(name, defVal);
        }
        val = UI.sanitizeSetting(name, val);
        WebUtil.setSetting(name, val);
        UI.updateSetting(name);
        return val;
    },

    // Set the new value, update and disable form control setting
    forceSetting(name, val, disable=true) {
        val = UI.sanitizeSetting(name, val);
        WebUtil.setSetting(name, val);
        UI.updateSetting(name);
        if (disable) {
            UI.disableSetting(name);
        } else {
            UI.enableSetting(name);
        }
        UI.saveSetting(name);
    },

    // Update cookie and form control setting. If value is not set, then
    // updates from control to current cookie setting.
    updateSetting(name) {
        // Update the settings control
        let value = UI.getSetting(name);

        const ctrl = document.getElementById('noVNC_setting_' + name);
        if (!ctrl) return;

        if (ctrl.type === 'checkbox') {
            ctrl.checked = value;

        } else if (typeof ctrl.options !== 'undefined') {
            value = String(value);
            for (let i = 0; i < ctrl.options.length; i += 1) {
                if (ctrl.options[i].value === value) {
                    ctrl.selectedIndex = i;
                    break;
                }
            }
        } else {
            let value_label = document.getElementById('noVNC_setting_' + name + '_output');
            ctrl.value = value;
            if (value_label) {
                value_label.value = value;
            }
        }
    },

    // Ensure settings stay within supported bounds
    sanitizeSetting(name, value) {
        switch (name) {
            case 'framerate':
            case 'framerate_image_mode':
            case 'framerate_streaming_mode':
                return String(normalizeFrameRate(value, FPS.MIN));
            default:
                return value;
        }
    },

    // Save control setting to cookie
    saveSetting(name) {
        const ctrl = document.getElementById('noVNC_setting_' + name);
        if (!ctrl) return;
        let val;
        if (ctrl.type === 'checkbox') {
            val = ctrl.checked;
        } else if (typeof ctrl.options !== 'undefined') {
            val = ctrl.options[ctrl.selectedIndex].value;
        } else {
            val = ctrl.value;
        }
        const sanitized = UI.sanitizeSetting(name, val);
        if (sanitized !== val) {
            if (ctrl && typeof ctrl.value !== 'undefined') {
                ctrl.value = sanitized;
            }
            val = sanitized;
        }
        WebUtil.writeSetting(name, val);
        Log.Debug("Setting saved '" + name + "=" + val + "'");
        return val;
    },

    // Read form control compatible setting from cookie
    getSetting(name) {
        const ctrl = document.getElementById('noVNC_setting_' + name);
        let val = WebUtil.readSetting(name);

        if (val != null && ctrl?.type === 'checkbox') {
            const str = String(val).toLowerCase();
            const falseStrings = [ '0', 'no', 'false'];
            if (falseStrings.includes(str)) {
                val = false;
            } else {
                val = true;
            }
        }
        const sanitized = UI.sanitizeSetting(name, val);
        const currentStr = (val === null || typeof val === 'undefined') ? null : String(val);
        if (sanitized !== val && sanitized !== currentStr) {
            WebUtil.writeSetting(name, sanitized);
        }
        return sanitized;
    },

    getSettingElement(name) {
        return document.getElementById('noVNC_setting_' + name);
    },

    // These helpers compensate for the lack of parent-selectors and
    // previous-sibling-selectors in CSS which are needed when we want to
    // disable the labels that belong to disabled input elements.
    disableSetting(name) {
        const ctrl = document.getElementById('noVNC_setting_' + name);
        if (ctrl) {
            ctrl.disabled = true;
            if (ctrl.label) {
                ctrl.label.classList.add('noVNC_disabled');
            }
        }
    },

    enableSetting(name) {
        const ctrl = document.getElementById('noVNC_setting_' + name);
        if (ctrl) {
            ctrl.disabled = false;
            if (ctrl.label) {
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
        UI.updateSetting('dynamic_quality_min', 3);
        UI.updateSetting('dynamic_quality_max', 9);
        UI.updateSetting('treat_lossless', 7);
        UI.updateSetting('anti_aliasing', 0);
        UI.updateSetting('jpeg_video_quality', 5);
        UI.updateSetting('webp_video_quality', 5);
        UI.updateSetting('video_quality', 2);
        UI.updateSetting('video_area', 65);
        UI.updateSetting('video_time', 5);
        UI.updateSetting('video_out_time', 3);
        UI.updateSetting('video_scaling', 2);
        UI.updateSetting('max_video_resolution_x', 960);
        UI.updateSetting('max_video_resolution_y', 540);
        UI.updateSetting('framerate', FPS.MIN);
        UI.updateSetting('compression');
        UI.updateSetting('shared');
        UI.updateSetting('view_only');
        UI.updateSetting('path');
        UI.updateSetting('repeaterID');
        UI.updateSetting('logging');
        UI.updateSetting('reconnect');
        UI.updateSetting('reconnect_delay');
        UI.updateSetting('reconnect_retries');

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

    toggleSettingsPanel(e) {
        if (!UI.isControlPanelItemClick(e)) {
            return false;
        }

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

    togglePowerPanel(e) {
        if (!UI.isControlPanelItemClick(e)) {
            return false;
        }

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
            UI.showControlInput('noVNC_power_button')
        } else {
            UI.hideControlInput('noVNC_power_button');
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

    toggleClipboardPanel(e) {
        if (!UI.isControlPanelItemClick(e)) {
            return false;
        }

        if (document.getElementById('noVNC_clipboard')
            .classList.contains("noVNC_open")) {
            UI.closeClipboardPanel();
        } else {
            UI.openClipboardPanel();
        }
    },

    clipboardReceive(e) {
        if (UI.rfb.clipboardDown) {
           var curvalue = document.getElementById('noVNC_clipboard_text').value;
           if (curvalue !== e.detail.text) {
               Log.Debug(">> UI.clipboardReceive: " + e.detail.text.substr(0, 40) + "...");
               document.getElementById('noVNC_clipboard_text').value = e.detail.text;
               Log.Debug("<< UI.clipboardReceive");
           }
       }
    },

    //received bottleneck stats
    bottleneckStatsReceive(e) {
        if (!UI.rfb)
            return;

        try {
            Log.Debug(e.detail.text);
            let obj = JSON.parse(e.detail.text);
            let fps = UI.rfb.statsFps;
            const bottleneckStats = UI.getSetting('enable_perf_stats');
            if (bottleneckStats) {
                document.getElementById("noVNC_connection_stats").textContent = "CPU: " + obj[0] + "/" + obj[1] + " | Network: " + obj[2] + "/" + obj[3] + " | FPS: " + UI.rfb.statsFps + " Dropped FPS: " + UI.rfb.statsDroppedFps;
                if (UI.fpsChart) {
                    UI.fpsChart.update(Number(fps));
                }
            }

            if (bottleneckStats || UI.enhancedMetrics)
                UI.sendMessage("bottleneck_stats", {stats: obj, fps: fps, droppedFps: UI.rfb.statsDroppedFps});

        } catch (err) {
            console.log('Invalid bottleneck stats received from server.')
        }
    },

    inputLatencyReceive(e) {
        const d = e.detail;

        if (UI.enhancedMetrics) {
            UI.sendMessage('input_latency', {
                latest: d.latest,
                average: d.average,
                min: d.min,
                max: d.max,
                p50: d.p50,
                p95: d.p95,
                p99: d.p99,
                networkAvg: d.networkAvg,
                networkP95: d.networkP95,
                renderAvg: d.renderAvg,
                renderP95: d.renderP95
            });
        }

        if (UI.getSetting('enable_latency_stats')) {
            const stats = document.getElementById("noVNC_connection_stats");
            if (stats) {
                const tag = " | Latency: " + d.latest.toFixed(1) + "ms (min " + d.min.toFixed(1) + "ms, p95 " + d.p95.toFixed(1) + "ms)";
                if (stats.style.visibility === "visible") {
                    stats.innerHTML = stats.innerHTML.replace(/ \| Latency:.*$/, '') + tag;
                }
            }
        }
    },

    networkStatsReceive(e) {
        if (!UI.rfb)
            return;

        try {
            const [jitter, rtt, bandwidth] = JSON.parse(e.detail.text);

            if (UI.getSetting('enable_perf_stats')) {

                const updateChart = (chart, value) => {
                    if (chart && value !== undefined) {
                        chart.update(Number(value));
                    }
                };

                updateChart(UI.jitterChart, jitter);
                updateChart(UI.rttChart, rtt);

                const now = performance.now();
                const rxBytes = UI.rfb.statsRxBytes;
                const tcpRxBytes = UI.rfb.statsTcpRxBytes;
                if (UI.bandwidthChart && UI.capacityChart && UI.lastRxSample) {
                    const elapsed = (now - UI.lastRxSample.time) / 1000;
                    const capacity = Number(bandwidth);
                    const measured = (rxBytes - UI.lastRxSample.bytes) / elapsed;
                    const measuredTcp = (tcpRxBytes - UI.lastRxSample.tcpBytes) / elapsed;
                    const valid = (v) => Number.isFinite(v) && v >= 0;
                    if (elapsed > 0 && valid(measured)) {
                        const headroom = UI.rfb.statsTcpTransit && bandwidth != null && valid(capacity) && capacity > 0 && valid(measuredTcp)
                            ? Math.max(0, Math.min(100, 100 * (1 - measuredTcp / capacity)))
                            : null;
                        UI.capacityChart.update(headroom);
                        UI.bandwidthChart.labelSuffix = ` | Estimated Headroom: ${headroom === null ? 'N/A' : `${Number(headroom.toFixed(2))}%`}`;
                        UI.bandwidthChart.update(measured);
                    }
                }
                UI.lastRxSample = {time: now, bytes: rxBytes, tcpBytes: tcpRxBytes};
            }

            if (UI.enhancedMetrics)
                UI.sendMessage('network_stats', {jitter, rtt, bandwidth});

            Log.Debug(e.detail.text);
        } catch (err) {
            console.log('Invalid network stats received from server.')
        }
    },

    systemStatsReceive(e) {
        if (!UI.rfb)
            return;

        try {
            if (UI.enhancedMetrics) {
                const systemStats = JSON.parse(e.detail.text);
                UI.sendMessage('system_stats', systemStats);
            }
        } catch (err) {
            console.log('Invalid system stats received from server.')
        }
    },

    popupMessage: function (msg, secs) {
        if (!secs) {
            secs = 500;
        }
        // Quick popup to give feedback that selection was copied
        setTimeout(UI.showOverlay.bind(this, msg, secs), 200);
    },

    clipboardClear() {
        document.getElementById('noVNC_clipboard_text').value = "";
        UI.rfb.clipboardPasteFrom("");
    },

    clipboardSend() {
        const text = document.getElementById('noVNC_clipboard_text').value;
        Log.Debug(">> UI.clipboardSend: " + text.substr(0, 40) + "...");
        UI.rfb.clipboardPasteFrom(text);
        Log.Debug("<< UI.clipboardSend");
    },

    setConnectionQualityValues() {
        UI.rfb.qualityLevel = parseInt(UI.getSetting('quality'));
        UI.rfb.antiAliasing = parseInt(UI.getSetting('anti_aliasing'));
        UI.rfb.dynamicQualityMin = parseInt(UI.getSetting('dynamic_quality_min'));
        UI.rfb.dynamicQualityMax = parseInt(UI.getSetting('dynamic_quality_max'));
        UI.rfb.jpegVideoQuality = parseInt(UI.getSetting('jpeg_video_quality'));
        UI.rfb.webpVideoQuality = parseInt(UI.getSetting('webp_video_quality'));
        UI.rfb.videoArea = parseInt(UI.getSetting('video_area'));
        UI.rfb.videoTime = parseInt(UI.getSetting('video_time'));
        UI.rfb.videoOutTime = parseInt(UI.getSetting('video_out_time'));
        UI.rfb.videoScaling = parseInt(UI.getSetting('video_scaling'));
        UI.rfb.treatLossless = parseInt(UI.getSetting('treat_lossless'));
        UI.rfb.maxVideoResolutionX = parseInt(UI.getSetting('max_video_resolution_x'));
        UI.rfb.maxVideoResolutionY = parseInt(UI.getSetting('max_video_resolution_y'));

        // Read streamMode first so we can use it to determine which framerate setting to read
        UI.rfb.streamMode = parseInt(UI.getSetting(UI_SETTINGS.STREAM_MODE));
        const isImageMode = UI.rfb.streamMode === encodings.pseudoEncodingStreamingModeJpegWebp;
        const framerateSettingName = isImageMode ? 'framerate_image_mode' : 'framerate_streaming_mode';
        UI.rfb.frameRate = parseInt(UI.getSetting(framerateSettingName));
        Log.Info(`setConnectionQualityValues: streamMode=${UI.rfb.streamMode}, isImageMode=${isImageMode}, reading from '${framerateSettingName}', frameRate=${UI.rfb.frameRate}`);

        UI.rfb.enableWebP = UI.getSetting('enable_webp');
        UI.rfb.videoQuality = parseInt(UI.getSetting('video_quality'));
        UI.rfb.enableHiDpi = UI.getSetting('enable_hidpi');
        UI.rfb.threading = UI.getSetting('enable_threading');
        if (UI.getSetting('enable_latency_stats') || UI.enhancedMetrics) {
            UI.rfb.enableInputLatencyMeasurement(true);
        }

        if (UI.enhancedMetrics)
            UI.updateStatsPolling();
        // UI.rfb.hwEncoderProfile = parseInt(UI.getSetting(UI_SETTINGS.HW_PROFILE));
        UI.rfb.gop = parseInt(UI.getSetting(UI_SETTINGS.GOP));
        UI.rfb.videoStreamQuality = parseInt(UI.getSetting(UI_SETTINGS.VIDEO_STREAM_QUALITY));
        Log.Info('Loaded from localStorage - Quality: ', UI.rfb.videoStreamQuality, ' Stream mode: ', UI.rfb.streamMode, ' GOP:', UI.rfb.gop);
    },

/* ------^-------
 *  /CLIPBOARD
 * ==============
 *  CONNECTION
 * ------v------*/

    connect(event, password) {
        Log.Debug("UI.connect");

        // Ignore when rfb already exists
        if (typeof UI.rfb !== 'undefined') {
            return;
        }

        const host = UI.getSetting('host');
        const port = UI.getSetting('port');
        const path = UI.getSetting('path');

        if (typeof password === 'undefined') {
            password = WebUtil.getConfigVar('password');
            UI.reconnectPassword = password;
        }

        if (password === null) {
            password = undefined;
        }

        UI.hideStatus();

        window.name = 'primaryDisplay'

        if (!host) {
            Log.Error("Can't connect when host is: " + host);
            UI.showStatus(_("Must set host"), 'error');
            return;
        }

        UI.updateVisualState('connecting');

        let url;

        url = UI.getSetting('encrypt') ? 'wss' : 'ws';

        url += '://' + host;
        if (port) {
            url += ':' + port;
        }
        url += '/' + path;

        UI.monitors = [];
        UI.sortedMonitors = [];
        UI.showControlInput('noVNC_displays_button')
        UI.rfb = new RFB(document.getElementById('noVNC_container'),
                        document.getElementById('noVNC_keyboardinput'),
                        url,
                        {
                            shared: UI.getSetting('shared'),
                            repeaterID: UI.getSetting('repeaterID'),
                            credentials: { password: password },
                            videoRenderingMode: UI.getSetting('video_rendering_mode'),
                            lastActiveAt: UI.kasmSessionLastActiveAt,
                            preserveLastActiveAtOnConnect: UI.kasmSessionLastActiveAt !== null,
                        },
                        UI.codecDetector?.getSupportedCodecIds(),
                        true );
        UI.rfb.addEventListener("connect", UI.connectFinished);
        UI.rfb.addEventListener("badencoding", (e) => {
            Log.Warn("Reconnecting due to encoding error or corrupted frame...");

            // Switch to image mode and mark that we had a bad encoding event
            UI.forceSetting('fallback_image_mode', true, false);
            UI.forceReconnect = true;
            UI.disconnect();
        });
        UI.rfb.addEventListener("disconnect", UI.disconnectFinished);
        UI.rfb.addEventListener("credentialsrequired", UI.credentials);
        UI.rfb.addEventListener("securityfailure", UI.securityFailed);
        UI.rfb.addEventListener("capabilities", UI.updatePowerButton);
        UI.rfb.addEventListener("clipboard", UI.clipboardReceive);
        UI.rfb.addEventListener("bottleneck_stats", UI.bottleneckStatsReceive);
        UI.rfb.addEventListener("network_stats", UI.networkStatsReceive);
        UI.rfb.addEventListener("system_stats", UI.systemStatsReceive);
        UI.rfb.addEventListener("inputlatency", UI.inputLatencyReceive);
        UI.rfb.addEventListener("bell", UI.bell);
        UI.rfb.addEventListener("desktopname", UI.updateDesktopName);
        UI.rfb.addEventListener("inputlock", UI.inputLockChanged);
        UI.rfb.addEventListener("inputlockerror", UI.inputLockError);
        UI.rfb.addEventListener("gamemodeforced", UI.onGameModeForced);
        UI.rfb.addEventListener("screenregistered", UI.screenRegistered);
        UI.rfb.addEventListener("sharedSessionUserJoin", UI.sharedSessionUserJoin);
        UI.rfb.addEventListener("sharedSessionUserLeft", UI.sharedSessionUserLeft);
        UI.rfb.addEventListener("imagemode", UI.switchToImageMode);
        UI.rfb.addEventListener("textinputfocus", UI.onTextInputFocus);
        UI.rfb.addEventListener("videocodecschange", (e) => {
            Log.Info('Codec configurations received:', e.detail?.configurations);
            UI.initStreamModeSetting(e.detail?.codecs, e.detail?.configurations);
        });

        UI.rfb.translateShortcuts = UI.getSetting('translate_shortcuts');
        UI.rfb.clipViewport = UI.getSetting('view_clip');
        UI.rfb.scaleViewport = UI.getSetting('resize') === 'scale';
        UI.rfb.resizeSession = UI.getSetting('resize') === 'remote';

        UI.setConnectionQualityValues();

        UI.rfb.compressionLevel = parseInt(UI.getSetting('compression'));
        UI.rfb.showDotCursor = UI.getSetting('show_dot');
        UI.rfb.idleDisconnect = UI.getSetting('idle_disconnect');
        UI.rfb.pointerRelative = UI.getSetting('pointer_relative');
        UI.rfb.clipboardUp = UI.getSetting('clipboard_up');
        UI.rfb.clipboardDown = UI.getSetting('clipboard_down');
        UI.rfb.clipboardSeamless = UI.getSetting('clipboard_seamless');
        UI.rfb.keyboard.enableIME = UI.getSetting('enable_ime');
        UI.rfb.touchMode = UI.getSetting('touch_mode');
        UI.rfb.autoKeyboard = UI.getSetting('auto_keyboard');
        UI.rfb.clipboardBinary = supportsBinaryClipboard() && UI.rfb.clipboardSeamless;
        UI.rfb.enableWebRTC = UI.getSetting('enable_webrtc');
        UI.rfb.mouseButtonMapper = UI.initMouseButtonMapper();
        // UI.rfb.qualityPreset = UI.getSetting(UI_SETTINGS.PRESET);
        if (UI.rfb.videoQuality === 5) {
            UI.rfb.enableQOI = true;
        }

        //Only explicitly request permission to clipboard on browsers that support binary clipboard access
        if (supportsBinaryClipboard()) {
            // explicitly request permission to the clipboard
            navigator.permissions.query({ name: "clipboard-read" })
                .then((result) => { Log.Debug('binary clipboard enabled') })
                .catch(() => {});
        }
        // KASM-960 workaround, disable seamless on Safari
        if (/^((?!chrome|android).)*safari/i.test(navigator.userAgent))
        {
            UI.rfb.clipboardSeamless = false;
        }
        UI.rfb.preferLocalCursor = UI.getSetting('prefer_local_cursor');
        UI.updateViewOnly(); // requires UI.rfb

        /****
        *    Kasm VDI specific
        *****/
        if (WebUtil.isInsideKasmVDI()) {
            if (window.addEventListener) { // Mozilla, Netscape, Firefox
                //window.addEventListener('load', WindowLoad, false);
                window.addEventListener('message', UI.receiveMessage, false);
            } else if (window.attachEvent) { //IE
                window.attachEvent('onload', WindowLoad);
                window.attachEvent('message', UI.receiveMessage);
            }
            if (UI.rfb.clipboardDown){
                UI.rfb.addEventListener("clipboard", UI.clipboardRx);
            }
            UI.rfb.addEventListener("activity", UI.kasmActivity);
            UI.rfb.addEventListener("disconnect", UI.disconnectedRx);
            if (! WebUtil.getConfigVar('show_control_bar')) {
                document.getElementById('noVNC_control_bar_anchor').setAttribute('style', 'display: none');
            }

            //keep alive for websocket connection to stay open, since we may not control reverse proxies
            //send a keep alive within a window that we control
            UI.startKasmSessionTimeoutInterval();
        } else {
            document.getElementById('noVNC_status').style.visibility = "visible";
        }

        const chartOptions = { sampleSeconds: UI.STATS_INTERVAL_MS / 1000, gridSeconds: 60 };
        UI.fpsChart = new BasicChart('noVNC_fps_chart_path', 'FPS', 60, 120, '', chartOptions);
        UI.bandwidthChart = new BasicChart('noVNC_bandwidth_path', 'Bandwidth', 60, 0, 'bytes/s', chartOptions);
        UI.capacityChart = new BasicChart('noVNC_bandwidth_capacity_path', '', 60, 100, '%', { ...chartOptions, style: BasicChart.Style.LINE, grid: false });
        UI.bandwidthChart.labelSuffix = ' | Estimated Headroom: N/A';
        UI.bandwidthChart.updateLabel();
        UI.rttChart = new BasicChart('noVNC_rtt_path', 'RTT', 60, 0, 'ms', chartOptions);
        UI.jitterChart = new BasicChart('noVNC_jitter_path', 'Jitter', 60, 0, 'ms', chartOptions);

        // The same function each time, so connecting again does not add a second listener.
        document.addEventListener('keyup', UI.onShortcutKeyup, true);
    },

    //key events for KasmVNC control
    onShortcutKeyup(event) {
        if (event.ctrlKey && event.shiftKey) {
            switch (event.keyCode) {
                case 49:
                    UI.toggleNav();
                    break;
                case 50:
                    UI.toggleRelativePointer();
                    break;
                case 51:
                    UI.togglePointerLock();
                    break;
            }
        }
    },

    disconnect() {
        UI.rfb.disconnect();

        UI.fpsChart = null;
        UI.bandwidthChart = null;
        UI.capacityChart = null;
        UI.lastRxSample = null;
        UI.rttChart = null;
        UI.jitterChart = null;

        UI.connected = false;

        // Disable automatic reconnecting
        UI.inhibitReconnect = true;
        UI.reconnectAttempts = 0;
        UI.suppressDisconnectRx = false;

        UI.updateVisualState('disconnecting');

        UI.stopKasmSessionTimeoutInterval(true);
        UI.hideControlInput('noVNC_displays_button');
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
    },

    connectFinished(e) {
        UI.connected = true;
        UI.inhibitReconnect = false;
        UI.reconnectAttempts = 0;
        UI.suppressDisconnectRx = false;

        let msg;
        if (UI.getSetting('encrypt')) {
            msg = _("Connected (encrypted) to ") + UI.desktopName;
        } else {
            msg = _("Connected (unencrypted) to ") + UI.desktopName;
        }
        UI.showStatus(msg);
        UI.showStats();
        UI.updateVisualState('connected');

        // Do this last because it can only be used on rendered elements
        UI.rfb.focus();
    },

    kasmActivity(event) {
        UI.kasmSessionLastActiveAt = event.detail.lastActiveAt;
        UI.kasmIdleTimeoutSent = false;
    },

    notifyKasmSessionTimeout() {
        if (UI.kasmIdleTimeoutSent) {
            return;
        }

        UI.kasmIdleTimeoutSent = true;
        UI.sendMessage('idle_session_timeout', 'Idle session timeout exceeded');

        // in some cases the intra-frame message could be blocked, fall back to navigating to a disconnect page.
        setTimeout(function() {
            window.location.replace('disconnected.html');
        }, 10000);
    },

    startKasmSessionTimeoutInterval() {
        if (UI.kasmSessionLastActiveAt === null && UI.rfb) {
            UI.kasmSessionLastActiveAt = UI.rfb.lastActiveAt;
        }

        if (UI.kasmIdleDisconnectInS === null && UI.rfb && Number.isFinite(parseFloat(UI.rfb.idleDisconnect))) {
            UI.kasmIdleDisconnectInS = parseFloat(UI.rfb.idleDisconnect) * 60;
        }

        if (UI._sessionTimeoutInterval !== null) {
            return;
        }

        UI._sessionTimeoutInterval = setInterval(function() {
            if (UI.kasmSessionLastActiveAt === null) {
                return;
            }

            const timeSinceLastActivityInS = (Date.now() - UI.kasmSessionLastActiveAt) / 1000;
            const idleDisconnectInS = UI.kasmIdleDisconnectInS || 1200; //20 minute default

            if (timeSinceLastActivityInS > idleDisconnectInS) {
                if (!UI.kasmIdleTimeoutSent) {
                    Log.Warn("Idle Disconnect reached, disconnecting rfb session...");
                    UI.notifyKasmSessionTimeout();
                }
            } else if (UI.rfb) {
                //send keep-alive
                UI.rfb.sendKeepAlive();
            }
        }, 5000);
    },

    stopKasmSessionTimeoutInterval(resetLastActiveAt=false) {
        if (UI._sessionTimeoutInterval !== null) {
            clearInterval(UI._sessionTimeoutInterval);
            UI._sessionTimeoutInterval = null;
        }

        if (resetLastActiveAt) {
            UI.kasmSessionLastActiveAt = null;
            UI.kasmIdleDisconnectInS = null;
            UI.kasmIdleTimeoutSent = false;
        }
    },

    shouldAutoReconnectDisconnect(e) {
        const detail = e.detail || {};
        return UI.getSetting('reconnect', false) === true &&
               !UI.inhibitReconnect &&
               !detail.serverNotice?.graceful;
    },

    getReconnectRetries() {
        const reconnectRetries = parseInt(UI.getSetting('reconnect_retries'), 10);
        if (!Number.isFinite(reconnectRetries) || reconnectRetries < 0) {
            return 5;
        }

        return reconnectRetries;
    },

    hasReconnectRetriesRemaining() {
        const reconnectRetries = UI.getReconnectRetries();
        return reconnectRetries === 0 || UI.reconnectAttempts < reconnectRetries;
    },

    reconnectRetriesExceeded() {
        UI.inhibitReconnect = true;
        UI.reconnectCallback = null;
        UI.updateVisualState('disconnected');
        UI.stopKasmSessionTimeoutInterval(true);

        if (WebUtil.isInsideKasmVDI()) {
            Log.Warn("Reconnect retries exhausted, notifying parent session timed out.");
            UI.notifyKasmSessionTimeout();
        } else {
            Log.Warn("Reconnect retries exhausted, automatic reconnect stopped.");
            UI.openControlbar();
        }
    },

    disconnectFinished(e) {
        const wasConnected = UI.connected;

        // This variable is ideally set when disconnection starts, but
        // when the disconnection isn't clean or if it is initiated by
        // the server, we need to do it here as well since
        // UI.disconnect() won't be used in those cases.
        UI.connected = false;

        UI.rfb = undefined;
        UI.monitors = [];
        UI.sortedMonitors = [];

        if (UI.shouldAutoReconnectDisconnect(e)) {
            UI.suppressDisconnectRx = true;

            if (!UI.hasReconnectRetriesRemaining()) {
                UI.reconnectRetriesExceeded();
                return;
            }

            UI.reconnectAttempts++;
            UI.updateVisualState('reconnecting');

            const delay = parseInt(UI.getSetting('reconnect_delay'));
            UI.reconnectCallback = setTimeout(UI.reconnect, delay);
            return;
        } else if (!e.detail.clean) {
            UI.updateVisualState('disconnected');
            if (wasConnected) {
                UI.showStatus(_("Something went wrong, connection is closed"),
                              'error');
            } else {
                UI.showStatus(_("Failed to connect to server"), 'error');
            }
        } else {
            UI.updateVisualState('disconnected');
            UI.showStatus(_("Disconnected"), 'normal');
        }

        UI.stopKasmSessionTimeoutInterval(true);
        document.title = PAGE_TITLE;

        UI.openControlbar();

        if (UI.forceReconnect) {
            UI.forceReconnect = false;
            UI.connect(null, UI.reconnectPassword);
        }
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

    switchToImageMode(e) {
        Log.Warn('Switching to image mode due to decoder error or incompatibility');

        const streamModeElem = UI.getSettingElement(UI_SETTINGS.STREAM_MODE);
        const mode = encodings.pseudoEncodingStreamingModeJpegWebp;
        streamModeElem.value = mode;
        UI.forceSetting(UI_SETTINGS.STREAM_MODE, mode, false);
        UI.applyStreamMode(mode);

        const availableModes = [...streamModeElem.options].map(option => ({
            id: Number(option.value),
            label: option.text
        }));

        UI.sendMessage("update_codecs", {current: mode, codecs: availableModes});
    },

    //send message to parent window
    sendMessage(name, value) {
        if (WebUtil.isInsideKasmVDI()) {
            parent.postMessage({ action: name, value: value }, '*' );
        }
    },

    //receive message from parent window
    receiveMessage(event) {
        if (event.source !== window.parent) {
            return;
        }

        if (event.data && event.data.action) {
            Log.Debug("Received message from parent window: " + event.data.action);
            switch (event.data.action) {
                case 'clipboardsnd':
                    if (UI.rfb && UI.rfb.clipboardUp) {
                        UI.rfb.clipboardPasteFrom(event.data.value);
                    }
                    break;
                case 'setvideoquality':
                    let value;

                    if (event.data.qualityLevel !== undefined) {
                        value = parseInt(event.data.qualityLevel);
                    } else if (event.data.value !== undefined) {
                        value = parseInt(event.data.value);
                    } else {
                        Log.Error("Invalid message received from parent window: " + event.data.action);
                        break;
                    }

                    const streamMode = parseInt(UI.getSetting(UI_SETTINGS.STREAM_MODE));
                    const isJpegWebp = streamMode === encodings.pseudoEncodingStreamingModeJpegWebp;
                    const settingKey = isJpegWebp ? 'video_quality' : UI_SETTINGS.VIDEO_STREAM_QUALITY;
                    const presets = UI.rfb?.videoCodecConfigurations?.[streamMode]?.presets;
                    const settingValue = isJpegWebp ? value : presets?.[value];

                    if (settingValue !== undefined) {
                        UI.forceSetting(settingKey, settingValue, false);
                    }

                    if (event.data.frameRate !== undefined) {
                        //apply preset mode values, but don't apply to connection
                        // apply quality preset quality level and override some settings (fps)
                        WebUtil.writeSetting('framerate', event.data.frameRate);
                        UI.updateQuality(event.data.frameRate);
                    } else {
                        UI.updateQuality();
                    }
                    break;
                case 'enable_game_mode':
                    if (UI.rfb && !UI.rfb.pointerRelative) {
                        UI.toggleRelativePointer();
                    }
                    break;
                case 'disable_game_mode':
                    if (UI.rfb && UI.rfb.pointerRelative) {
                        UI.toggleRelativePointer();
                    }
                    break;
                case 'enable_pointer_lock':
                    if (UI.rfb && !UI.rfb.pointerLock) {
                        UI.togglePointerLock();
                    }
                    break;
                case 'disable_pointer_lock':
                    if (UI.rfb && UI.rfb.pointerLock) {
                        UI.togglePointerLock();
                    }
                    break;
                case 'show_keyboard_controls':
                    if (!UI.getSetting('virtual_keyboard_visible')) {
                        UI.forceSetting('virtual_keyboard_visible', true, false);
                        UI.showKeyboardControls();
                    }
                    break;
                case 'hide_keyboard_controls':
                    if (UI.getSetting('virtual_keyboard_visible')) {
                        UI.forceSetting('virtual_keyboard_visible', true, false);
                        UI.hideKeyboardControls();
                    }
                    break;
                case 'enable_auto_keyboard':
                    UI.forceSetting('auto_keyboard', true, false);
                    UI.updateAutoKeyboard();

                    break;
                case 'disable_auto_keyboard':
                    UI.forceSetting('auto_keyboard', false, false);
                    UI.updateAutoKeyboard();

                    if (UI.textInputCaret) {
                        UI.clearTextInputPan();
                        UI.hideVirtualKeyboard();
                    }

                    break;
                case 'enable_ime_mode':
                    UI.forceSetting('enable_ime', true, false);
                    UI.toggleIMEMode();
                    break;
                case 'disable_ime_mode':
                    UI.forceSetting('enable_ime', false, false);
                    UI.toggleIMEMode();
                    break;
                case 'open_displays_mode':
                    if (UI.rfb) {
                        UI.openDisplays()
                    }
                    break;
                case 'close_displays_mode':
                    UI.closeDisplays()
                    break;
                case 'enable_webrtc':
                    if (!UI.getSetting('enable_webrtc')) {
                        UI.forceSetting('enable_webrtc', true, false);
                        UI.toggleWebRTC();
                    }
                    break;
                case 'disable_webrtc':
                    if (UI.getSetting('enable_webrtc')) {
                        UI.forceSetting('enable_webrtc', false, false);
                        UI.toggleWebRTC();
                    }
                    break;
                case 'resize':
                    UI.forceSetting('resize', event.data.value, false);
                    UI.applyResizeMode();
                    break;
                case 'set_resolution':
                    if (UI.rfb) {
                        UI.rfb.forcedResolutionX = event.data.value_x;
                        UI.rfb.forcedResolutionY = event.data.value_y;
                        UI.forceSetting('forced_resolution_x', event.data.value_x, false);
                        UI.forceSetting('forced_resolution_y', event.data.value_y, false);
                        UI.applyResizeMode();
                    }
                    break;
                case 'set_perf_stats':
                    UI.forceSetting('enable_perf_stats', event.data.value, false);
                    UI.showStats();
                    break;
                case 'set_latency_stats':
                    UI.forceSetting('enable_latency_stats', event.data.value, false);
                    UI.toggleLatencyStats();
                    break;
                case 'set_enhanced_metrics':
                    UI.enhancedMetrics = !!event.data.value;
                    UI.updateEnhancedMetrics();
                    break;
                case 'set_idle_timeout':
                    //message value in seconds
                    const idle_timeout_min = Math.ceil(event.data.value / 60);
                    UI.forceSetting('idle_disconnect', idle_timeout_min, false);
                    UI.kasmIdleDisconnectInS = event.data.value;
                    if (UI.rfb) {
                        UI.rfb.idleDisconnect = idle_timeout_min;
                    }
                    console.log(`Updated the idle timeout to ${event.data.value}s`);
                    break;
                case 'enable_hidpi':
                    UI.forceSetting('enable_hidpi', event.data.value, false);
                    UI.enableHiDpi();
                    break;
                case 'control_displays':
                    UI.sendMessage('can_control_displays', true);
                    break;
                case 'enable_threading':
                    UI.forceSetting('enable_threading', event.data.value, false);
                    UI.threading();
                    break;
                case 'terminate':
                    //terminate a session, different then disconnect in that it is assumed KasmVNC will be shutdown
                    if (UI.rfb) {
                        UI.rfb.terminate();
                    }
                    break;
                case 'set_streaming_mode':
                    let mode = encodings.pseudoEncodingStreamingModeJpegWebp;
                    if (event.data.value !== 'image') {
                        mode = parseInt(event.data.value);
                    }

                    UI.forceSetting(UI_SETTINGS.STREAM_MODE, mode, false);
                    if (mode !== encodings.pseudoEncodingStreamingModeJpegWebp) {
                        const imageQuality = parseInt(UI.getSetting('video_quality'));
                        const presets = UI.rfb?.videoCodecConfigurations?.[mode]?.presets;
                        if (Array.isArray(presets) && presets.length > 0) {
                            const index = Number.isFinite(imageQuality)
                                ? Math.max(0, Math.min(presets.length - 1, imageQuality))
                                : 0;
                            const streamQuality = presets[index];
                            if (streamQuality !== undefined) {
                                UI.forceSetting(UI_SETTINGS.VIDEO_STREAM_QUALITY, streamQuality, false);
                            }
                        }
                    }
                    UI.applyStreamMode(mode);
                    break;
                case 'set_gop':
                    UI.forceSetting(UI_SETTINGS.GOP, parseInt(event.data.value), false);
                    UI.updateQuality();
                    break;

            }
        }
    },

    disconnectedRx(event) {
        if (UI.suppressDisconnectRx) {
            UI.suppressDisconnectRx = false;
            Log.Info("Suppressing disconnectrx while automatic reconnect handles the disconnect");
            return;
        }

        if (UI.shouldAutoReconnectDisconnect(event)) {
            Log.Info("Suppressing disconnectrx while automatic reconnect is pending");
            return;
        }

        const detail = event.detail || {};
        UI.sendMessage('disconnectrx', detail.reason);
        if (detail.serverNotice && detail.serverNotice.graceful) {
            setTimeout(() => window.location.replace('disconnected.html'), 3000);
        }
    },

    toggleNav(){
        if (WebUtil.isInsideKasmVDI()) {
            UI.sendMessage('togglenav', null);
        } else {
            UI.toggleControlbar();
            UI.keepControlbar();
            UI.activateControlbar();
            UI.controlbarGrabbed = false;
            UI.showControlbarHint(false);
        }
    },

    clipboardRx(event) {
        UI.sendMessage('clipboardrx', event.detail.text);
    },

/* ------^-------
 *  /PASSWORD
 * ==============
 *   FULLSCREEN
 * ------v------*/

    toggleFullscreen() {
        if (WebUtil.isInsideKasmVDI()) {
             UI.sendMessage('fullscreen', 'Fullscreen clicked');
             return;
        }
        if (document.fullscreenElement || // alternative standard method
            document.mozFullScreenElement || // currently working methods
            document.webkitFullscreenElement ||
            document.msFullscreenElement) {
            if (supportsKeyboardLock) {
                navigator.keyboard.unlock();
            }
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
            // No need to explicitly ask for permission,
            // but it's expected that user grant it since Chromium 131.
            // See https://developer.chrome.com/blog/keyboard-lock-pointer-lock-permission
            if (supportsKeyboardLock) {
                navigator.keyboard.lock();
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
        UI.updatePointerLockButton();
    },

/* ------^-------
 *  /FULLSCREEN
 * ==============
 *     RESIZE
 * ------v------*/

    // Apply remote resizing or local scaling
    applyResizeMode() {
        if (!UI.rfb) return;
        const resize_setting = UI.getSetting('resize');
        UI.rfb.clipViewport = resize_setting !== 'off';
        UI.rfb.scaleViewport = resize_setting === 'scale';
        UI.rfb.resizeSession = resize_setting === 'remote';
        UI.rfb.idleDisconnect = UI.getSetting('idle_disconnect');
        UI.rfb.videoQuality = UI.getSetting('video_quality');
        UI.rfb.enableWebP = UI.getSetting('enable_webp');
        UI.rfb.enableHiDpi = UI.getSetting('enable_hidpi');
        UI.rfb.threading = UI.getSetting('enable_threading');
        if (UI.getSetting('enable_latency_stats')) {
            UI.rfb.enableInputLatencyMeasurement(true);
        }

        if (UI.rfb.resizeSession) {
            UI.rfb.forcedResolutionX = null;
            UI.rfb.forcedResolutionY = null;
        } else {
            UI.rfb.forcedResolutionX = UI.getSetting('forced_resolution_x', false);
            UI.rfb.forcedResolutionY = UI.getSetting('forced_resolution_y', false);
        }

        UI.rfb.updateConnectionSettings();
    },

/* ------^-------
 *  /MULTI-MONITOR SUPPORT
 * ==============*/

    _identify(e) {
        UI.identify()
        UI.rfb.identify(UI.monitors)
    },

    identify(data) {
        showNotification('1');
    },

    openDisplays() {
        document.getElementById('noVNC_displays').classList.add("noVNC_open");
        if (UI.monitors.length < 1  && UI.rfb) {
            let screenPlan = UI.rfb.getScreenPlan();
            UI.initMonitors(screenPlan);
        }
        if (UI.monitors.length > 0) {
            UI.displayMonitors()
        }
    },

    closeDisplays() {
        document.getElementById('noVNC_displays').classList.remove("noVNC_open");
    },

    displaysRefresh() {
        const rotation = UI.refreshRotation + 180;
        let screenPlan = UI.rfb.getScreenPlan();
        document.getElementById('noVNC_refreshMonitors_icon').style.transform = "rotate(" + rotation + "deg)"
        UI.refreshRotation = rotation
        UI.updateMonitors(screenPlan)
        UI.recenter()
        UI.draw()
    },

    normalizePlacementValues(details) {

    },

    increaseCurrentDisplay(details) {
        const max = details.screens.length
        const thisIndex = details.screens.findIndex(el => el === details.currentScreen)
        if (max === 1) {
            return 0
        }
        if (UI.currentDisplay === null) {
            UI.currentDisplay = thisIndex
        }
        UI.currentDisplay += 1
        if (UI.currentDisplay === thisIndex) {
            UI.currentDisplay += 1
        }
        if (UI.currentDisplay >= max) {
            UI.currentDisplay = 0
        }
        return UI.currentDisplay
    },

    async addSecondaryMonitor() {
        let new_display_path = window.location.pathname.replace(/[^/]*$/, '');
        const windowId = uuidv4();
        const new_display_url = `${window.location.protocol}//${window.location.host}${new_display_path}screen.html?windowId=${windowId}`;

        const openDisplay = (features) => {
            const relayToken = UI.rfb.reserveSecondaryToken(windowId);
            let win = null;
            try {
                win = window.open(new_display_url + (relayToken ? '#' + relayToken : ''), '_blank', features);
            } finally {
                if (!win) { UI.rfb.releaseSecondaryToken(windowId); }
            }
            if (!win) { return null; }
            UI.displayWindows.set(windowId, win);
            UI.rfb.registerSecondaryWindow(windowId, win);
            return win;
        };

        const auto_placement = document.getElementById('noVNC_auto_placement').checked
        if (auto_placement && 'getScreenDetails' in window) {
            let permission = false;
            try {
                const { state } = await navigator.permissions.query({ name: 'window-management' });
                permission = (state === 'granted' || state === 'prompt');
                if (permission && window.screen.isExtended) {
                    const details = await window.getScreenDetails()
                    const current = UI.increaseCurrentDisplay(details)
                    let screen = details.screens[current]
                    const options = 'left='+screen.availLeft+',top='+screen.availTop+',width='+screen.availWidth+',height='+screen.availHeight+',fullscreen'
                    openDisplay(options);
                    return;
                }
            } catch (e) {
                console.log(e)
            // Nothing.
            }
        }

        Log.Debug(`Opening a secondary display ${new_display_url}`)
        openDisplay('toolbar=0,location=0,menubar=0');
    },

    initMonitors(screenPlan) {
        const { scale } = UI.multiMonitorSettings()
        let monitors = []
        let showNativeResolution = false
        let num = 1;
        screenPlan.screens.forEach(screen => {
            if (parseFloat(screen.pixelRatio) != 1) {
                showNativeResolution = true
            }
            monitors.push({
                id: screen.screenID,
                x: screen.x / scale,
                y: screen.y / scale,
                w: screen.serverWidth / scale,
                h: screen.serverHeight / scale,
                pixelRatio: screen.pixelRatio,
                scale: 1,
                fill: '#eeeeeecc',
                isDragging: false,
                num
            })
            num++
        })
        if (showNativeResolution) {
            document.getElementById('noVNC_setting_enable_hidpi_option').classList.add("show");
        } else {
            document.getElementById('noVNC_setting_enable_hidpi_option').classList.remove("show");
        }
        UI.monitors = monitors
        let deepCopyMonitors = JSON.parse(JSON.stringify(monitors))
        UI.sortedMonitors = deepCopyMonitors.sort((a, b) => {
            if (a.y >= b.y + (b.h / 2)) {
                return 1
            }
            return  a.x - b.x
        })

    },

    updateMonitors(screenPlan) {
        UI.initMonitors(screenPlan)
        UI.recenter()
        UI.draw()
    },

    multiMonitorSettings() {
        const canvas = document.getElementById("noVNC_multiMonitorWidget")
        return {
            canvas,
            ctx: canvas.getContext("2d"),
            bb: canvas.getBoundingClientRect(),
            scale: 12,
            canvasWidth: canvas.width,
            canvasHeight: canvas.height,
        }
    },

    getMonitorEventCoords(e) {
        const { bb, canvas } = UI.multiMonitorSettings()

        const clientX = e.clientX || (e.touches && e.touches[0].clientX)
        const clientY = e.clientY || (e.touches && e.touches[0].clientY)
        const scaleX = canvas.width / bb.width;
        const scaleY = canvas.height / bb.height;

        return {
            mx: parseInt((clientX - bb.left) * scaleX),
            my: parseInt((clientY - bb.top) * scaleY)
        }
    },

    monitorMouseDown(e) {
        const monitors = UI.sortedMonitors
        e.preventDefault()
        e.stopPropagation()

        const { mx, my } = UI.getMonitorEventCoords(e)

        for (var i = 0; i < monitors.length; i++) {
            var mon = monitors[i]
            var monw = mon.w / mon.scale
            var monh = mon.h / mon.scale
            let monx = mon.x
            let mony = mon.y
            // Find the closest rect to drag
            if (mx > monx && mx < (monx + monw) && my > mony && my < (mony + monh)) {
                UI.monitorDragOk = true
                mon.isDragging = true
                UI.selectedMonitor = mon
                break // get out of the loop rather than dragging multiple
            }
        }
        UI.monitorStartX = mx
        UI.monitorStartY = my
        UI.draw()
    },

    monitorMouseUp(e) {
        const monitors = UI.sortedMonitors
        e.preventDefault()
        e.stopPropagation()

        // clear all the dragging flags
        UI.monitorDragOk = false
        for (var i = 0; i < monitors.length; i++) {
            monitors[i].isDragging = false
        }
        monitors.sort((a, b) => {
            if (a.y >= b.y + (b.h / 2)) {
                return 1
            }
            return a.x - b.x
        })
        UI.recenter()
        UI.draw()
    },

    monitorMouseMove(e) {
        const monitors = UI.sortedMonitors
        if (UI.monitorDragOk) {
            e.preventDefault()
            e.stopPropagation()

            const { mx, my } = UI.getMonitorEventCoords(e)

            // calculate the distance the mouse has moved
            // since the last mousemove
            var dx = mx - UI.monitorStartX
            var dy = my - UI.monitorStartY

            // move each rect that isDragging
            // by the distance the mouse has moved
            // since the last mousemove
            for (var i = 0; i < monitors.length; i++) {
                var m = monitors[i]
                if (m.isDragging) {
                    m.x += dx
                    m.y += dy
                }
            }

            // redraw the scene with the new rect positions
            UI.draw()

            // reset the starting mouse position for the next mousemove
            UI.monitorStartX = mx
            UI.monitorStartY = my
        }
    },

    recenter() {
        const monitors = UI.sortedMonitors
        UI.removeSpaces()
        if (!monitors.length) {
            return;
        }
        const { startLeft, startTop } = UI.getSizes(monitors)

        for (var i = 0; i < monitors.length; i++) {
            var m = monitors[i];
            m.x += startLeft
            m.y += startTop
        }
        UI.setScreenPlan()
    },

    removeSpaces() {
        const monitors = UI.sortedMonitors
        let prev = monitors[0]
        if (monitors.length > 1) {
            for (var i = 1; i < monitors.length; i++) {
                var a = monitors[i];
                let prevStart = prev.x + prev.w
                let prevStartTop = prev.y + prev.h
                if (a.x > prevStart) {
                    a.x = prevStart
                }
                if (a.x < prevStart) {
                    if (a.y < prevStartTop) {
                        a.x = prevStart
                    }
                }
                if (a.y > prevStartTop) {
                    if (a.x <= prevStart) {
                        a.y = prevStartTop
                    }
                }
                prev = monitors[i]
            }
        }
    },

    rect(ctx, x, y, w, h) {
        ctx.beginPath();
        if (typeof ctx.roundRect !== 'undefined') {
            ctx.roundRect(x, y, w, h, 5);
        } else {
            // fallback for old browsers
            ctx.rect(x, y, w, h);
        }
        ctx.stroke();
        ctx.closePath();
        ctx.fill();
    },

    draw() {
        const { ctx, canvasWidth, canvasHeight, scale } = UI.multiMonitorSettings()
        const monitors = UI.sortedMonitors
        ctx.clearRect(0, 0, canvasWidth, canvasHeight);

        ctx.rect(0, 0, canvasWidth, canvasHeight);

        for (var i = 0; i < monitors.length; i++) {
            var m = monitors[i];
            ctx.fillStyle = m.fill;
            ctx.lineWidth = 1;
            ctx.lineJoin = "round";
            ctx.strokeStyle = m === UI.selectedMonitor ? "#2196F3" : "#aaa";
            UI.rect(ctx, m.x, m.y, (m.w / m.scale), (m.h / m.scale));
            ctx.font = "13px sans-serif";
            ctx.textAlign = "right";
            ctx.textBaseline = "top";
            ctx.fillStyle = "#000";
            ctx.fillText((m.num), (m.x + m.w) - 4, m.y + 4);
            ctx.font = "200 11px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(UI.toFixed(m.w * scale, 2) + ' x ' + UI.toFixed(m.h * scale, 2), m.x + (m.w / 2), m.y + (m.h / 2));
        }
    },

    toFixed(num, maxDecimals = 2) {
        return parseFloat(num.toFixed(maxDecimals));
    },

    getSizes(monitors) {
        const { canvasWidth, canvasHeight } = UI.multiMonitorSettings();

        let top = monitors[0].y;
        let left = monitors[0].x;
        let width = monitors[0].w;
        let height = monitors[0].h;
        for (var i = 0; i < monitors.length; i++) {
            var m = monitors[i];
            if (m.x < left) {
                left = m.x
            }
            if (m.y < top) {
                top = m.y
            }
            if(m.x + m.w > width) {
                width = m.x + m.w
            }
            if(m.y + m.h > height) {
                height = m.y + m.h
            }
        }
        const startLeft = ((canvasWidth - width - left) / 2);
        const startTop = ((canvasHeight - height - top) / 2);

        return { top, left, width, height, startLeft, startTop }
    },

    setScreenPlan() {
        let monitors = UI.monitors
        let sortedMonitors = UI.sortedMonitors
        const { scale } = UI.multiMonitorSettings()
        const { top, left, width, height } = UI.getSizes(sortedMonitors)
        const screens = []
        for (var i = 0; i < monitors.length; i++) {
            var monitor = monitors[i];
            var a = sortedMonitors.find(el => el.id === monitor.id)
            screens.push({
                screenID: a.id,
                serverHeight: Math.round(a.h * scale),
                serverWidth: Math.round(a.w * scale),
                x: Math.round((a.x - left) * scale),
                y: Math.round((a.y - top) * scale)
            })
        }
        const screenPlan = {
            serverHeight: Math.round(height * scale),
            serverWidth: Math.round(width * scale),
            screens
        }
        if (UI.rfb) {
            UI.rfb.applyScreenPlan(screenPlan);
        }
    },

    displayMonitors() {
        const { canvas } = UI.multiMonitorSettings()

        // Remove any existing event listeners to avoid duplicates
        canvas.removeEventListener("mousedown", UI.monitorMouseDown, false)
        canvas.removeEventListener("mouseup", UI.monitorMouseUp, false)
        canvas.removeEventListener("mousemove", UI.monitorMouseMove, false)
        canvas.removeEventListener("touchstart", UI.monitorMouseDown, false)
        canvas.removeEventListener("touchend", UI.monitorMouseUp, false)
        canvas.removeEventListener("touchmove", UI.monitorMouseMove, false)

        canvas.addEventListener("mousedown", UI.monitorMouseDown, false)
        canvas.addEventListener("mouseup", UI.monitorMouseUp, false)
        canvas.addEventListener("mousemove", UI.monitorMouseMove, false)
        canvas.addEventListener("touchstart", UI.monitorMouseDown, false)
        canvas.addEventListener("touchend", UI.monitorMouseUp, false)
        canvas.addEventListener("touchmove", UI.monitorMouseMove, false)

        UI.recenter()
        UI.draw()
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

        if (scaling) {
            // Can't be clipping if viewport is scaled to fit
            UI.forceSetting('view_clip', false);
            UI.rfb.clipViewport  = false;
        } else if (!hasScrollbarGutter) {
            // Some platforms have scrollbars that are difficult
            // to use in our case, so we always use our own panning
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
    *  POINTER LOCK
    * ------v------*/

    updatePointerLockButton() {
        // Only show the button if the pointer lock API is properly supported
        // AND in fullscreen.
        if (
            UI.connected &&
            (document.pointerLockElement !== undefined ||
                document.mozPointerLockElement !== undefined)
        ) {
            UI.showControlInput("noVNC_setting_pointer_lock");
            UI.showControlInput("noVNC_game_mode_button");
        } else {
            UI.hideControlInput("noVNC_setting_pointer_lock");
            UI.hideControlInput("noVNC_game_mode_button");
        }
    },

    togglePointerLock() {
        if (!supportsPointerLock()) {
            UI.showStatus('Your browser does not support pointer lock.', 'info', 1500, true);
            //force pointer lock in UI to false and disable control
            UI.forceSetting('pointer_lock', false, true);
        } else {
            UI.rfb.pointerLock = !UI.rfb.pointerLock;
            if (UI.getSetting('pointer_lock') !== UI.rfb.pointerLock) {
                UI.forceSetting('pointer_lock', UI.rfb.pointerLock, false);
            }
        }
    },

    toggleRelativePointer(event=null, forcedToggleValue=null) {
        if (!supportsPointerLock()) {
            UI.showStatus('Your browser does not support pointer lock.', 'info', 1500, true);
            return;
        }

        var togglePosition = !UI.rfb.pointerRelative;

        if (UI.rfb.pointerLock !== togglePosition) {
            UI.rfb.pointerLock = togglePosition;
        }
        if (UI.rfb.pointerRelative !== togglePosition) {
            UI.rfb.pointerRelative = togglePosition;
        }

        if (togglePosition) {
            document.getElementById('noVNC_game_mode_button').classList.add("noVNC_selected");
        } else {
            document.getElementById('noVNC_game_mode_button').classList.remove("noVNC_selected");
            UI.forceSetting('pointer_lock', false, false);
        }

        UI.sendMessage('enable_game_mode', togglePosition);
        UI.sendMessage('enable_pointer_lock', togglePosition);

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

        if (!UI.rfb.clipViewport && UI.rfb.dragViewport) {
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
            UI.showControlInput('noVNC_view_drag_button');
        } else {
            UI.hideControlInput('noVNC_view_drag_button');
        }
    },

/* ------^-------
 *   /VIEWDRAG
 * ==============
 *    QUALITY
 * ------v------*/

    updateQuality(fps) {
        let present_mode = parseInt(UI.getSetting('video_quality'));
        let enable_qoi = false;
        const imageMode = parseInt(UI.getSetting(UI_SETTINGS.STREAM_MODE)) === encodings.pseudoEncodingStreamingModeJpegWebp;

        const forceFramerate = (fps) => {
            UI.forceSetting('framerate_image_mode', fps);
            UI.forceSetting('framerate_streaming_mode', fps, false);
            WebUtil.writeSetting('framerate', fps);
        };

        // video_quality preset values
        switch (present_mode) {
            case 10: //custom
                UI.enableSetting('dynamic_quality_min');
                UI.enableSetting('dynamic_quality_max');
                UI.enableSetting('treat_lossless');
                UI.enableSetting('video_time');
                UI.enableSetting('video_area');
                UI.enableSetting('max_video_resolution_x');
                UI.enableSetting('max_video_resolution_y');
                UI.enableSetting('jpeg_video_quality');
                UI.enableSetting('webp_video_quality');
                UI.enableSetting('framerate_image_mode');
                UI.enableSetting('video_scaling');
                UI.enableSetting('video_out_time');
                break;
            case 5: //lossless
                enable_qoi = true;
                fps = (fps && Number.isFinite(fps)) ? fps : FPS.MAX;
                UI.forceSetting('dynamic_quality_min', 9);
                UI.forceSetting('dynamic_quality_max', 9);
                forceFramerate(fps);
                UI.forceSetting('treat_lossless', 9);
                UI.forceSetting('video_time', 100);
                UI.forceSetting('video_area', 100);
                UI.forceSetting('max_video_resolution_x', 1920);
                UI.forceSetting('max_video_resolution_y', 1080);
                UI.forceSetting('jpeg_video_quality', 9);
                UI.forceSetting('webp_video_quality', 9);
                UI.forceSetting('video_scaling', 0);
                UI.forceSetting('video_out_time', 3);
                break;
            case 4: //extreme
                fps = (fps && Number.isFinite(fps)) ? fps : FPS.MAX;
                UI.forceSetting('dynamic_quality_min', 8);
                UI.forceSetting('dynamic_quality_max', 9);
                forceFramerate(fps);
                UI.forceSetting('treat_lossless', 9);
                UI.forceSetting('video_time', 100);
                UI.forceSetting('video_area', 100);
                UI.forceSetting('max_video_resolution_x', 1920);
                UI.forceSetting('max_video_resolution_y', 1080);
                UI.forceSetting('jpeg_video_quality', 9);
                UI.forceSetting('webp_video_quality', 9);
                UI.forceSetting('video_scaling', 0);
                UI.forceSetting('video_out_time', 3);
                break;
            case 3: // high
                fps = (fps && Number.isFinite(fps)) ? fps : FPS.MAX;
                UI.forceSetting('jpeg_video_quality', 8);
                UI.forceSetting('webp_video_quality', 8);
                UI.forceSetting('dynamic_quality_min', 7);
                UI.forceSetting('dynamic_quality_max', 9);
                UI.forceSetting('max_video_resolution_x', 1920);
                UI.forceSetting('max_video_resolution_y', 1080);
                forceFramerate(fps);
                UI.forceSetting('treat_lossless', 8);
                UI.forceSetting('video_time', 5);
                UI.forceSetting('video_area', 65);
                UI.forceSetting('video_scaling', 0);
                UI.forceSetting('video_out_time', 3);
                break;
            case 1: // low, resolution capped at 720p keeping aspect ratio
                fps = (fps && Number.isFinite(fps)) ? fps : FPS.MIN;
                UI.forceSetting('jpeg_video_quality', 5);
                UI.forceSetting('webp_video_quality', 4);
                UI.forceSetting('dynamic_quality_min', 3);
                UI.forceSetting('dynamic_quality_max', 7);
                UI.forceSetting('max_video_resolution_x', 960);
                UI.forceSetting('max_video_resolution_y', 540);
                forceFramerate(fps);
                UI.forceSetting('treat_lossless', 7);
                UI.forceSetting('video_time', 5);
                UI.forceSetting('video_area', 65);
                UI.forceSetting('video_scaling', 0);
                UI.forceSetting('video_out_time', 3);
                break;
            case 2: // medium
            case 0: // static resolution, but same settings as medium
            default:
                fps = (fps && Number.isFinite(fps)) ? fps : FPS.MIN;
                forceFramerate(fps);
                UI.forceSetting('jpeg_video_quality', 7);
                UI.forceSetting('webp_video_quality', 7);
                UI.forceSetting('dynamic_quality_min', 4);
                UI.forceSetting('dynamic_quality_max', 9);
                UI.forceSetting('max_video_resolution_x', 960);
                UI.forceSetting('max_video_resolution_y', 540);
                UI.forceSetting('treat_lossless', 7);
                UI.forceSetting('video_time', 5);
                UI.forceSetting('video_area', 65);
                UI.forceSetting('video_scaling', 0);
                UI.forceSetting('video_out_time', 3);
                break;
        }

        if (UI.rfb) {
            UI.setConnectionQualityValues();

            UI.rfb.enableQOI = enable_qoi;

            // Gracefully update settings server side
            UI.rfb.updateConnectionSettings();
        }
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

    updateVideoRenderingMode() {
        const mode = UI.getSetting('video_rendering_mode');
        Log.Info('Video rendering mode changed to: ', mode);
        UI.saveSetting('video_rendering_mode');
        // Reconnect to apply the new rendering mode
        if (UI.connected) {
            UI.forceReconnect = true;
            UI.disconnect();
        }
    },



/* ------^-------
 *  /COMPRESSION
 * ==============
 *  MOUSE AND KEYBOARD
 * ------v------*/

    updateShortcutTranslation() {
        UI.rfb.translateShortcuts = UI.getSetting('translate_shortcuts');
    },

    toggleKeyboardControls() {
        if (UI.getSetting('virtual_keyboard_visible')) {
            UI.showKeyboardControls();
        } else {
            UI.hideKeyboardControls();
        }
    },

    toggleIMEMode() {
        if (UI.rfb) {
            if (UI.getSetting('enable_ime')) {
                UI.rfb.keyboard.enableIME = true;
            } else {
                UI.rfb.keyboard.enableIME = false;
            }
        }
    },

    updateTouchMode() {
        if (UI.rfb) {
            UI.rfb.touchMode = UI.getSetting('touch_mode');
        }
    },

    updateAutoKeyboard() {
        if (UI.rfb)
            UI.rfb.autoKeyboard = UI.getSetting('auto_keyboard');
    },

    toggleWebRTC() {
        if (UI.rfb) {
            if (typeof RTCPeerConnection === 'undefined') {
                UI.showStatus('This browser does not support WebRTC UDP Data Channels.', 'warn', 5000, true);
                return;
            }

            if (UI.getSetting('enable_webrtc')) {
                UI.rfb.enableWebRTC = true;
            } else {
                UI.rfb.enableWebRTC = false;
            }
            UI.updateQuality();
        }
    },

    enableHiDpi() {
        if (UI.rfb) {
            if (UI.getSetting('enable_hidpi')) {
                UI.rfb.enableHiDpi = true;
            } else {
                UI.rfb.enableHiDpi = false;
            }
            UI.applyResizeMode();
        }
    },

    showKeyboardControls() {
        UI.loadKeyboardControlAssets()
            .catch(err => Log.Error(`Couldn't load keyboard control assets: ${err}`));
        document.getElementById('noVNC_keyboard_control').classList.add("is-visible");
    },

    hideKeyboardControls() {
        document.getElementById('noVNC_keyboard_control').classList.remove("is-visible");
    },

    showVirtualKeyboard() {
        const input = document.getElementById('noVNC_keyboardinput');

        if (document.activeElement == input || !UI.rfb) return;

        if (UI.getSetting('virtual_keyboard_visible')) {
            document.getElementById('noVNC_keyboard_control_handle')
                .classList.add("noVNC_selected");
        }

        input.focus();

        try {
            const l = input.value.length;
            // Move the caret to the end
            input.setSelectionRange(l, l);
        } catch (err) {
            // setSelectionRange is undefined in Google Chrome
        }

        // ensure that the hidden input used for showing the virutal keyboard
        // does not steal focus if the user has closed it manually
        document.querySelector("canvas").addEventListener("touchstart", () => {
            if (document.activeElement === input) {
                input.blur();
            }
        }, { once: true });
    },

    hideVirtualKeyboard() {
        const input = document.getElementById('noVNC_keyboardinput');

        if (document.activeElement != input || !UI.rfb) return;

        if (UI.getSetting('virtual_keyboard_visible')) {
            document.getElementById('noVNC_keyboard_control_handle')
                .classList.remove("noVNC_selected");
        }

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

    onTextInputFocus(event) {
        const autoKeyboardPopUp = UI.getSetting('auto_keyboard');

        Log.Debug("Server text input focus: " + (event.detail.focused ? "gained" : "lost") +
            (isTouchDevice ? "" : " (ignored: not a touch device)") +
            (autoKeyboardPopUp ? "" : " (disabled)") +
            (UI.textInputSuppressed ? " (suppressed)" : ""));

        if (!isTouchDevice)
            return;

        clearTimeout(UI.textInputFocusHideTimeout);
        UI.textInputFocusHideTimeout = null;

        if (event.detail.focused) {
            if (event.detail.tapped)
                UI.textInputSuppressed = false;

            if (UI.textInputSuppressed || !autoKeyboardPopUp)
                return;

            UI.textInputCaret = event.detail.caret;

            if (!(isIOS() && UI.rfb.nativeTouchActive))
                UI.showVirtualKeyboard();

            UI.updateTextInputPan();

            if (window.visualViewport && !UI.textInputViewportHandler) {
                UI.textInputViewportHandler = () => UI.updateTextInputPan();
                window.visualViewport.addEventListener('resize', UI.textInputViewportHandler);
            }
        } else {
            UI.textInputSuppressed = false;

            UI.textInputFocusHideTimeout = setTimeout(() => {
                UI.textInputFocusHideTimeout = null;
                UI.clearTextInputPan();
                UI.hideVirtualKeyboard();
            }, 400);
        }
    },

    updateTextInputPan() {
        if (!UI.rfb || !UI.textInputCaret)
            return;

        const caret = UI.textInputCaret;
        const pos = UI.rfb.remoteToClientPos(caret.x, caret.y + caret.h);
        if (!pos) return;

        const visibleHeight = window.visualViewport ? window.visualViewport.height : document.documentElement.clientHeight;
        const margin = 40;
        const caretBottom = pos.y + UI.textInputPanY;
        let pan = caretBottom + margin - visibleHeight;
        if (pan < 0)
            pan = 0;

        UI.setTextInputPan(pan);
    },

    setTextInputPan(pan) {
        UI.textInputPanY = pan;
        const container = document.getElementById('noVNC_container');
        container.style.transition = 'transform 0.2s ease-out';
        container.style.transform = pan ? 'translateY(' + (-pan) + 'px)' : '';
    },

    clearTextInputPan() {
        UI.textInputCaret = null;
        if (UI.textInputPanY !== 0)
            UI.setTextInputPan(0);

        if (UI.textInputViewportHandler) {
            window.visualViewport.removeEventListener('resize', UI.textInputViewportHandler);
            UI.textInputViewportHandler = null;
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

        if (UI.getSetting('virtual_keyboard_visible')) {
            document.getElementById('noVNC_keyboard_control_handle')
                .classList.remove("noVNC_selected");
        }

        if (UI.rfb) {
            UI.rfb.focusOnClick = true;
        }

        if (UI.textInputCaret !== null)
            UI.textInputSuppressed = true;

        UI.clearTextInputPan();
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

    disableSoftwareKeyboard() {
        document.querySelector("#noVNC_keyboard_button").disabled = true;
    },

    enableSoftwareKeyboard() {
        document.querySelector("#noVNC_keyboard_button").disabled = false;
    },

    closeExtraKeys() {
        document.getElementById('noVNC_modifiers')
            .classList.remove("noVNC_open");
        document.getElementById('noVNC_toggle_extra_keys_button')
            .classList.remove("noVNC_selected");
    },

    toggleExtraKeys(e) {
        if (!UI.isControlPanelItemClick(e)) {
            return false;
        }

        if (document.getElementById('noVNC_modifiers').classList.contains("noVNC_open")) {
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

        document.querySelector(".keyboard-controls .button.ctrl").classList.toggle("selected");
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

        document.querySelector(".keyboard-controls .button.windows").classList.toggle("selected");
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

        document.querySelector(".keyboard-controls .button.alt").classList.toggle("selected");
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
            UI.hideControlInput("noVNC_keyboard_button");
            UI.hideControlInput("noVNC_toggle_extra_keys_button");
            UI.hideControlInput("noVNC_clipboard_button");
            UI.hideControlInput("noVNC_game_mode_button");
        } else {
            UI.showControlInput("noVNC_keyboard_button");
            UI.showControlInput("noVNC_toggle_extra_keys_button");
            UI.showControlInput("noVNC_clipboard_button");
            UI.showControlInput("noVNC_game_mode_button");
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

    inputLockChanged(e) {
        var pointer_lock_el = document.getElementById("noVNC_setting_pointer_lock");
        var pointer_rel_el = document.getElementById("noVNC_game_mode_button");

        if (e.detail.pointer) {
            pointer_lock_el.checked = true;
            UI.sendMessage('enable_pointer_lock', true);
            UI.closeControlbar();
            UI.showStatus('Press Esc Key to Exit Pointer Lock Mode', 'warn', 5000, true);
        } else {
            //If in game mode
            if (UI.rfb.pointerRelative) {
                UI.showStatus('Game Mode paused, click on screen to resume Game Mode.', 'warn', 5000, true);
            } else {
                UI.forceSetting('pointer_lock', false, false);
                document.getElementById('noVNC_game_mode_button')
                .classList.remove("noVNC_selected");
                UI.sendMessage('enable_pointer_lock', false);
            }
        }
    },

    onGameModeForced() {
        if (!UI.rfb.pointerRelative) {
            // Set the mode but do NOT call requestPointerLock() — browsers require a
            // user gesture for that. Setting pointerRelative=true is enough: rfb.js
            // will re-request pointer lock on the next click via _setLastActive().
            UI.rfb.pointerRelative = true;
            document.getElementById('noVNC_game_mode_button').classList.add("noVNC_selected");
            UI.showStatus('Game Mode required by this session. Click anywhere to engage.', 'warn', 5000, true);
        }
    },

    inputLockError(e) {
        UI.showStatus('Unable to enter pointer lock mode.', 'warn', 5000, true);
        UI.rfb.pointerRelative = false;

        document.getElementById('noVNC_game_mode_button').classList.remove("noVNC_selected");
        UI.forceSetting('pointer_lock', false, false);

        UI.sendMessage('enable_game_mode', false);
        UI.sendMessage('enable_pointer_lock', false);
    },

    bell(e) {
        if (WebUtil.getConfigVar('bell', 'on') === 'on') {
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

    screenRegistered(e) {
        console.log('screen registered')

        // Get the current screen plan
        // When a new display is added, it is defaulted to be placed to the far right relative to existing displays and to the top
        if (UI.rfb) {
            let screenPlan = UI.rfb.getScreenPlan();
            if (e && e.detail) {
                const { left, top, screenID } = e.detail
                const current = screenPlan.screens.findIndex(el => el.screenID === screenID)
                if (current > -1) {
                    screenPlan.screens[current].x = left
                    screenPlan.screens[current].y = top
                }
            }

            UI.updateMonitors(screenPlan)
            UI._identify(UI.monitors)
        }

    },

    sharedSessionUserJoin(e) {
        Log.Info('shared session user joined: ' + e.detail)
        UI.sendMessage('sharedSessionUserJoin', e.detail)

    },

    sharedSessionUserLeft(e) {
        Log.Info('shared session user left: ' + e.detail)
        UI.sendMessage('sharedSessionUserLeft', e.detail)
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

// Set up translations
const LINGUAS = ["af", "af_ZA", "am_ET", "am", "ar_AE", "ar_BH", "ar_DZ", "ar_EG", "ar_IN", "ar_IQ", "ar_JO", "ar_KW", "ar_LB", "ar_LY", "ar_MA", "ar_OM", "ar", "ar_QA", "ar_SA", "ar_SD", "ar_SY", "ar_TN", "ar_YE", "az_AZ", "az", "be_BY", "be", "bg_BG", "bg", "bn_BD", "bn_IN", "bn", "bs_BA", "bs", "ca_AD", "ca_ES", "ca_FR", "ca_IT", "ca", "cs_CZ", "cs", "cy_GB", "cy", "da_DK", "da", "de_AT", "de_BE", "de_CH", "de_DE", "de_LU", "de", "el", "es_AR", "es_BO", "es_CL", "es_CO", "es_CR", "es_CU", "es_DO", "es_EC", "es_ES", "es_GT", "es_HN", "es_MX", "es_NI", "es_PA", "es_PE", "es", "es_PR", "es_PY", "es_SV", "es_US", "es_UY", "es_VE", "et_EE", "et", "eu_ES", "eu", "fa_IR", "fa", "fi_FI", "fi", "fr_BE", "fr_CA", "fr_CH", "fr_FR", "fr_LU", "fr", "fy_DE", "fy_NL", "fy", "ga_IE", "ga", "gd_GB", "gd", "gl_ES", "gl", "gu_IN", "gu", "ha_NG", "ha", "he_IL", "he", "hi_IN", "hi", "hr_HR", "hr", "ht_HT", "ht", "hu_HU", "hu", "hy_AM", "hy", "id_ID", "id", "ig_NG", "ig", "is_IS", "is", "it_CH", "it_IT", "it", "ja_JP", "ja", "ka_GE", "ka", "kk_KZ", "kk", "km_KH", "km", "kn_IN", "kn", "ko_KR", "ko", "ku", "ku_TR", "ky_KG", "ky", "lb_LU", "lb", "lo_LA", "lo", "lt_LT", "lt", "lv_LV", "lv", "mg_MG", "mg", "mi_NZ", "mi", "mk_MK", "mk", "ml_IN", "ml", "mn_MN", "mn", "mr_IN", "mr", "ms_MY", "ms", "mt_MT", "mt", "my_MM", "my", "ne_NP", "ne", "nl_AW", "nl_BE", "nl_NL", "nl", "pa_IN", "pa_PK", "pa", "pl_PL", "pl", "ps_AF", "ps", "pt_BR", "pt", "pt_PT", "ro", "ro_RO", "ru", "ru_RU", "ru_UA", "sd_IN", "sd", "si_LK", "si", "sk", "sk_SK", "sl", "sl_SI", "so_DJ", "so_ET", "so_KE", "so", "so_SO", "sq_AL", "sq_MK", "sq", "st", "st_ZA", "sv_FI", "sv", "sv_SE", "sw_KE", "sw", "ta_IN", "ta_LK", "ta", "te_IN", "te", "tg", "tg_TJ", "th", "th_TH", "tl_PH", "tl", "tr_CY", "tr", "tr_TR", "tt", "tt_RU", "uk", "uk_UA", "ur_IN", "ur_PK", "ur", "uz", "uz_UZ", "vi", "vi_VN", "xh", "xh_ZA", "yi", "yi_US", "yo_NG", "yo", "zh_CN", "zh_TW", "zu", "zu_ZA"];
l10n.setup(LINGUAS);
if (l10n.language === "en" || l10n.dictionary !== undefined) {
    UI.prime();
} else {
    fetch('app/locale/' + l10n.language + '.json')
        .then((response) => {
            if (!response.ok) {
                throw Error("" + response.status + " " + response.statusText);
            }
            return response.json();
        })
        .then((translations) => { l10n.dictionary = translations; })
        .catch(err => Log.Error("Failed to load translations: " + err))
        .then(UI.prime);
}

export default UI;
