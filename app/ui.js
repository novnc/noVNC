/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2012 Joel Martin
 * Copyright (C) 2016 Samuel Mannehed for Cendio AB
 * Copyright (C) 2016 Pierre Ossman for Cendio AB
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 */

/* jslint white: false, browser: true */
/* global window, document.getElementById, Util, WebUtil, RFB, Display */

/* [module]
 * import Util from "../core/util";
 * import KeyTable from "../core/input/keysym";
 * import RFB from "../core/rfb";
 * import Display from "../core/display";
 * import WebUtil from "./webutil";
 */

var UI;

(function () {
    "use strict";

    /* [begin skip-as-module] */
    // Load supporting scripts
    WebUtil.load_scripts(
        {'core': ["base64.js", "websock.js", "des.js", "input/keysymdef.js",
                  "input/xtscancodes.js", "input/util.js", "input/devices.js",
                  "display.js", "inflator.js", "rfb.js", "input/keysym.js"]});

    window.onscriptsload = function () { UI.load(); };
    /* [end skip-as-module] */

    UI = {

        rfb_state: 'loaded',

        resizeTimeout: null,
        statusTimeout: null,
        hideKeyboardTimeout: null,

        keyboardVisible: false,

        isTouchDevice: false,
        isSafari: false,
        rememberedClipSetting: null,
        lastKeyboardinput: null,
        defaultKeyboardinputLen: 100,

        // Setup rfb object, load settings from browser storage, then call
        // UI.init to setup the UI/menus
        load: function(callback) {
            WebUtil.initSettings(UI.start, callback);
        },

        // Render default UI and initialize settings menu
        start: function(callback) {

            // Setup global variables first
            UI.isTouchDevice = 'ontouchstart' in document.documentElement;
            UI.isSafari = (navigator.userAgent.indexOf('Safari') !== -1 &&
                           navigator.userAgent.indexOf('Chrome') === -1);

            UI.initSettings();

            // Show mouse selector buttons on touch screen devices
            if (UI.isTouchDevice) {
                // Show mobile buttons
                document.getElementById('noVNC_mobile_buttons')
                    .classList.remove("noVNC_hidden");
                UI.hideMouseButton();
                // Remove the address bar
                setTimeout(function() { window.scrollTo(0, 1); }, 100);
                UI.forceSetting('clip', true);
            } else {
                UI.initSetting('clip', false);
            }

            // Setup and initialize event handlers
            UI.setupWindowEvents();
            UI.setupFullscreen();
            UI.addControlbarHandlers();
            UI.addTouchSpecificHandlers();
            UI.addXvpHandlers();
            UI.addConnectionControlHandlers();
            UI.addClipboardHandlers();
            UI.addSettingsHandlers();

            // Show the connect panel on first load unless autoconnecting
            if (!autoconnect) {
                UI.openConnectPanel();
            }

            UI.updateViewClip();
            UI.setBarPosition();

            UI.updateVisualState();

            document.getElementById('noVNC_setting_host').focus();

            var autoconnect = WebUtil.getConfigVar('autoconnect', false);
            if (autoconnect === 'true' || autoconnect == '1') {
                autoconnect = true;
                UI.connect();
            } else {
                autoconnect = false;
            }

            if (typeof callback === "function") {
                callback(UI.rfb);
            }
        },

        initSettings: function() {
            // Stylesheet selection dropdown
            var sheet = WebUtil.selectStylesheet();
            var sheets = WebUtil.getStylesheets();
            var i;
            for (i = 0; i < sheets.length; i += 1) {
                UI.addOption(document.getElementById('noVNC_setting_stylesheet'),sheets[i].title, sheets[i].title);
            }

            // Logging selection dropdown
            var llevels = ['error', 'warn', 'info', 'debug'];
            for (i = 0; i < llevels.length; i += 1) {
                UI.addOption(document.getElementById('noVNC_setting_logging'),llevels[i], llevels[i]);
            }

            // Settings with immediate effects
            UI.initSetting('logging', 'warn');
            WebUtil.init_logging(UI.getSetting('logging'));

            UI.initSetting('stylesheet', 'default');
            WebUtil.selectStylesheet(null);
            // call twice to get around webkit bug
            WebUtil.selectStylesheet(UI.getSetting('stylesheet'));

            // if port == 80 (or 443) then it won't be present and should be
            // set manually
            var port = window.location.port;
            if (!port) {
                if (window.location.protocol.substring(0,5) == 'https') {
                    port = 443;
                }
                else if (window.location.protocol.substring(0,4) == 'http') {
                    port = 80;
                }
            }

            /* Populate the controls if defaults are provided in the URL */
            UI.initSetting('host', window.location.hostname);
            UI.initSetting('port', port);
            UI.initSetting('password', '');
            UI.initSetting('encrypt', (window.location.protocol === "https:"));
            UI.initSetting('true_color', true);
            UI.initSetting('cursor', !UI.isTouchDevice);
            UI.initSetting('resize', 'off');
            UI.initSetting('shared', true);
            UI.initSetting('view_only', false);
            UI.initSetting('path', 'websockify');
            UI.initSetting('repeaterID', '');
            UI.initSetting('token', '');
        },

        setupWindowEvents: function() {
            window.addEventListener( 'resize', function () {
                UI.applyResizeMode();
                UI.updateViewClip();
                UI.updateViewDrag();
                UI.setBarPosition();
            } );

            document.getElementById("noVNC_status")
                .addEventListener('click', UI.hideStatus);
        },

        setupFullscreen: function() {
            // Only show the button if fullscreen is properly supported
            // * Safari doesn't support alphanumerical input while in fullscreen
            if (!UI.isSafari &&
                (document.documentElement.requestFullscreen ||
                 document.documentElement.mozRequestFullScreen ||
                 document.documentElement.webkitRequestFullscreen ||
                 document.body.msRequestFullscreen)) {
                document.getElementById('noVNC_fullscreen_button')
                    .classList.remove("noVNC_hidden");
                UI.addFullscreenHandlers();
            }
        },

        addControlbarHandlers: function() {
            document.getElementById("noVNC_view_drag_button")
                .addEventListener('click', UI.toggleViewDrag);
            document.getElementById("noVNC_send_ctrl_alt_del_button")
                .addEventListener('click', UI.sendCtrlAltDel);
        },

        addTouchSpecificHandlers: function() {
            document.getElementById("noVNC_mouse_button0")
                .addEventListener('click', function () { UI.setMouseButton(1); });
            document.getElementById("noVNC_mouse_button1")
                .addEventListener('click', function () { UI.setMouseButton(2); });
            document.getElementById("noVNC_mouse_button2")
                .addEventListener('click', function () { UI.setMouseButton(4); });
            document.getElementById("noVNC_mouse_button4")
                .addEventListener('click', function () { UI.setMouseButton(0); });
            document.getElementById("noVNC_keyboard_button")
                .addEventListener('click', UI.showKeyboard);

            document.getElementById("noVNC_keyboardinput")
                .addEventListener('input', UI.keyInput);
            document.getElementById("noVNC_keyboardinput")
                .addEventListener('blur', UI.hideKeyboard);
            document.getElementById("noVNC_keyboardinput")
                .addEventListener('submit', function () { return false; });

            window.addEventListener('load', UI.keyboardinputReset);

            document.getElementById("noVNC_toggle_extra_keys_button")
                .addEventListener('click', UI.toggleExtraKeys);
            document.getElementById("noVNC_toggle_ctrl_button")
                .addEventListener('click', UI.toggleCtrl);
            document.getElementById("noVNC_toggle_alt_button")
                .addEventListener('click', UI.toggleAlt);
            document.getElementById("noVNC_send_tab_button")
                .addEventListener('click', UI.sendTab);
            document.getElementById("noVNC_send_esc_button")
                .addEventListener('click', UI.sendEsc);
        },

        addXvpHandlers: function() {
            document.getElementById("noVNC_xvp_shutdown_button")
                .addEventListener('click', function() { UI.rfb.xvpShutdown(); });
            document.getElementById("noVNC_xvp_reboot_button")
                .addEventListener('click', function() { UI.rfb.xvpReboot(); });
            document.getElementById("noVNC_xvp_reset_button")
                .addEventListener('click', function() { UI.rfb.xvpReset(); });
            document.getElementById("noVNC_xvp_button")
                .addEventListener('click', UI.toggleXvpPanel);
        },

        addConnectionControlHandlers: function() {
            document.getElementById("noVNC_connect_controls_button")
                .addEventListener('click', UI.toggleConnectPanel);
            document.getElementById("noVNC_disconnect_button")
                .addEventListener('click', UI.disconnect);
            document.getElementById("noVNC_connect_button")
                .addEventListener('click', UI.connect);
        },

        addClipboardHandlers: function() {
            document.getElementById("noVNC_clipboard_button")
                .addEventListener('click', UI.toggleClipboardPanel);
            document.getElementById("noVNC_clipboard_text")
                .addEventListener('focus', UI.displayBlur);
            document.getElementById("noVNC_clipboard_text")
                .addEventListener('blur', UI.displayFocus);
            document.getElementById("noVNC_clipboard_text")
                .addEventListener('change', UI.clipboardSend);
            document.getElementById("noVNC_clipboard_clear_button")
                .addEventListener('click', UI.clipboardClear);
        },

        addSettingsHandlers: function() {
            document.getElementById("noVNC_settings_button")
                .addEventListener('click', UI.toggleSettingsPanel);
            document.getElementById("noVNC_settings_apply")
                .addEventListener('click', UI.settingsApply);

            document.getElementById("noVNC_setting_resize")
                .addEventListener('change', UI.enableDisableViewClip);
        },

        addFullscreenHandlers: function() {
            document.getElementById("noVNC_fullscreen_button")
                .addEventListener('click', UI.toggleFullscreen);

            window.addEventListener('fullscreenchange', UI.updateFullscreenButton);
            window.addEventListener('mozfullscreenchange', UI.updateFullscreenButton);
            window.addEventListener('webkitfullscreenchange', UI.updateFullscreenButton);
            window.addEventListener('msfullscreenchange', UI.updateFullscreenButton);
        },

        initRFB: function() {
            try {
                UI.rfb = new RFB({'target': document.getElementById('noVNC_canvas'),
                                  'onUpdateState': UI.updateState,
                                  'onXvpInit': UI.updateXvpButton,
                                  'onClipboard': UI.clipboardReceive,
                                  'onFBUComplete': UI.initialResize,
                                  'onFBResize': UI.updateViewDrag,
                                  'onDesktopName': UI.updateDocumentTitle});
                return true;
            } catch (exc) {
                UI.updateState(null, 'fatal', null, 'Unable to create RFB client -- ' + exc);
                return false;
            }
        },

/* ------^-------
 *     /INIT
 * ==============
 *     VISUAL
 * ------v------*/

        updateState: function(rfb, state, oldstate, msg) {
            UI.rfb_state = state;
            var klass;
            var timeout;
            switch (state) {
                case 'failed':
                case 'fatal':
                    klass = "noVNC_status_error";
                    timeout = 0; // zero means no timeout
                    break;
                case 'normal':
                    klass = "noVNC_status_normal";
                    break;
                case 'disconnected':
                    /* falls through */
                case 'loaded':
                    klass = "noVNC_status_normal";
                    break;
                case 'password':
                    UI.toggleConnectPanel();

                    document.getElementById('noVNC_connect_button').value = "Send Password";
                    document.getElementById('noVNC_connect_button').onclick = UI.setPassword;
                    document.getElementById('noVNC_setting_password').focus();

                    klass = "noVNC_status_warn";
                    break;
                default:
                    klass = "noVNC_status_warn";
                    break;
            }

            if (typeof(msg) !== 'undefined') {
                document.getElementById('noVNC_status')
                    .classList.remove("noVNC_status_normal",
                                      "noVNC_status_warn",
                                      "noVNC_status_error");
                document.getElementById('noVNC_status').classList.add(klass);
                UI.showStatus(msg, timeout);
            }

            UI.updateVisualState();
        },

        // Disable/enable controls depending on connection state
        updateVisualState: function() {
            var connected = UI.rfb && UI.rfb_state === 'normal';

            //Util.Debug(">> updateVisualState");
            document.getElementById('noVNC_setting_encrypt').disabled = connected;
            document.getElementById('noVNC_setting_true_color').disabled = connected;
            if (Util.browserSupportsCursorURIs()) {
                document.getElementById('noVNC_setting_cursor').disabled = connected;
            } else {
                UI.updateSetting('cursor', !UI.isTouchDevice);
                document.getElementById('noVNC_setting_cursor').disabled = true;
            }

            UI.enableDisableViewClip();
            document.getElementById('noVNC_setting_resize').disabled = connected;
            document.getElementById('noVNC_setting_shared').disabled = connected;
            document.getElementById('noVNC_setting_view_only').disabled = connected;
            document.getElementById('noVNC_setting_path').disabled = connected;
            document.getElementById('noVNC_setting_repeaterID').disabled = connected;

            if (connected) {
                document.getElementById('noVNC_logo')
                    .classList.add("noVNC_hidden");
                document.getElementById('noVNC_screen')
                    .classList.remove("noVNC_hidden");
                UI.updateViewClip();
                UI.setMouseButton(1);
                document.getElementById('noVNC_clipboard_button')
                    .classList.remove("noVNC_hidden");
                document.getElementById('noVNC_keyboard_button')
                    .classList.remove("noVNC_hidden");
                document.getElementById('noVNC_extra_keys')
                    .classList.remove("noVNC_hidden");
                document.getElementById('noVNC_send_ctrl_alt_del_button')
                    .classList.remove("noVNC_hidden");
            } else {
                document.getElementById('noVNC_logo')
                    .classList.remove("noVNC_hidden");
                document.getElementById('noVNC_screen')
                    .classList.add("noVNC_hidden");
                UI.hideMouseButton();
                document.getElementById('noVNC_clipboard_button')
                    .classList.add("noVNC_hidden");
                document.getElementById('noVNC_keyboard_button')
                    .classList.add("noVNC_hidden");
                document.getElementById('noVNC_extra_keys')
                    .classList.add("noVNC_hidden");
                document.getElementById('noVNC_send_ctrl_alt_del_button')
                    .classList.add("noVNC_hidden");
                UI.updateXvpButton(0);
            }

            // State change disables viewport dragging.
            // It is enabled (toggled) by direct click on the button
            UI.setViewDrag(false);

            switch (UI.rfb_state) {
                case 'fatal':
                case 'failed':
                case 'disconnected':
                    document.getElementById('noVNC_connect_controls_button')
                        .classList.remove("noVNC_hidden");
                    document.getElementById('noVNC_disconnect_button')
                        .classList.add("noVNC_hidden");
                    UI.openConnectPanel();
                    break;
                case 'loaded':
                    document.getElementById('noVNC_connect_controls_button')
                        .classList.remove("noVNC_hidden");
                    document.getElementById('noVNC_disconnect_button')
                        .classList.add("noVNC_hidden");
                    break;
                default:
                    document.getElementById('noVNC_connect_controls_button')
                        .classList.add("noVNC_hidden");
                    document.getElementById('noVNC_disconnect_button')
                        .classList.remove("noVNC_hidden");
                    break;
            }

            //Util.Debug("<< updateVisualState");
        },

        showStatus: function(text, time) {
            var statusElem = document.getElementById('noVNC_status');

            clearTimeout(UI.statusTimeout);

            statusElem.innerHTML = text;
            statusElem.classList.add("noVNC_open");

            // If no time was specified, show the status for 1.5 seconds
            if (typeof time === 'undefined') {
                time = 1500;
            }

            // A specified time of zero means no timeout
            if (time != 0) {
                UI.statusTimeout = window.setTimeout(UI.hideStatus, time);
            }
        },

        hideStatus: function() {
            clearTimeout(UI.statusTimeout);
            document.getElementById('noVNC_status').classList.remove("noVNC_open");
        },

/* ------^-------
 *    /VISUAL
 * ==============
 *    SETTINGS
 * ------v------*/

        // Initial page load read/initialization of settings
        initSetting: function(name, defVal) {
            // Check Query string followed by cookie
            var val = WebUtil.getConfigVar(name);
            if (val === null) {
                val = WebUtil.readSetting(name, defVal);
            }
            UI.updateSetting(name, val);
            return val;
        },

        // Update cookie and form control setting. If value is not set, then
        // updates from control to current cookie setting.
        updateSetting: function(name, value) {

            // Save the cookie for this session
            if (typeof value !== 'undefined') {
                WebUtil.writeSetting(name, value);
            }

            // Update the settings control
            value = UI.getSetting(name);

            var ctrl = document.getElementById('noVNC_setting_' + name);
            if (ctrl.type === 'checkbox') {
                ctrl.checked = value;

            } else if (typeof ctrl.options !== 'undefined') {
                for (var i = 0; i < ctrl.options.length; i += 1) {
                    if (ctrl.options[i].value === value) {
                        ctrl.selectedIndex = i;
                        break;
                    }
                }
            } else {
                /*Weird IE9 error leads to 'null' appearring
                in textboxes instead of ''.*/
                if (value === null) {
                    value = "";
                }
                ctrl.value = value;
            }
        },

        // Save control setting to cookie
        saveSetting: function(name) {
            var val, ctrl = document.getElementById('noVNC_setting_' + name);
            if (ctrl.type === 'checkbox') {
                val = ctrl.checked;
            } else if (typeof ctrl.options !== 'undefined') {
                val = ctrl.options[ctrl.selectedIndex].value;
            } else {
                val = ctrl.value;
            }
            WebUtil.writeSetting(name, val);
            //Util.Debug("Setting saved '" + name + "=" + val + "'");
            return val;
        },

        // Force a setting to be a certain value
        forceSetting: function(name, val) {
            UI.updateSetting(name, val);
            return val;
        },

        // Read form control compatible setting from cookie
        getSetting: function(name) {
            var ctrl = document.getElementById('noVNC_setting_' + name);
            var val = WebUtil.readSetting(name);
            if (typeof val !== 'undefined' && val !== null && ctrl.type === 'checkbox') {
                if (val.toString().toLowerCase() in {'0':1, 'no':1, 'false':1}) {
                    val = false;
                } else {
                    val = true;
                }
            }
            return val;
        },

        // Save/apply settings when 'Apply' button is pressed
        settingsApply: function() {
            //Util.Debug(">> settingsApply");
            UI.saveSetting('encrypt');
            UI.saveSetting('true_color');
            if (Util.browserSupportsCursorURIs()) {
                UI.saveSetting('cursor');
            }

            UI.saveSetting('resize');

            if (UI.getSetting('resize') === 'downscale' || UI.getSetting('resize') === 'scale') {
                UI.forceSetting('clip', false);
            }

            UI.saveSetting('clip');
            UI.saveSetting('shared');
            UI.saveSetting('view_only');
            UI.saveSetting('path');
            UI.saveSetting('repeaterID');
            UI.saveSetting('stylesheet');
            UI.saveSetting('logging');

            // Settings with immediate (non-connected related) effect
            WebUtil.selectStylesheet(UI.getSetting('stylesheet'));
            WebUtil.init_logging(UI.getSetting('logging'));
            UI.updateViewClip();
            UI.updateViewDrag();
            //Util.Debug("<< settingsApply");
        },

/* ------^-------
 *   /SETTINGS
 * ==============
 *    PANELS
 * ------v------*/

        closeAllPanels: function() {
            UI.closeSettingsPanel();
            UI.closeXvpPanel();
            UI.closeClipboardPanel();
            UI.closeConnectPanel();
        },

/* ------^-------
 *   /PANELS
 * ==============
 * SETTINGS (panel)
 * ------v------*/

        openSettingsPanel: function() {
            UI.closeAllPanels();

            UI.updateSetting('encrypt');
            UI.updateSetting('true_color');
            if (Util.browserSupportsCursorURIs()) {
                UI.updateSetting('cursor');
            } else {
                UI.updateSetting('cursor', !UI.isTouchDevice);
                document.getElementById('noVNC_setting_cursor').disabled = true;
            }
            UI.updateSetting('clip');
            UI.updateSetting('resize');
            UI.updateSetting('shared');
            UI.updateSetting('view_only');
            UI.updateSetting('path');
            UI.updateSetting('repeaterID');
            UI.updateSetting('stylesheet');
            UI.updateSetting('logging');

            document.getElementById('noVNC_settings')
                .classList.add("noVNC_open");
            document.getElementById('noVNC_settings_button')
                .classList.add("noVNC_selected");
        },

        closeSettingsPanel: function() {
            document.getElementById('noVNC_settings')
                .classList.remove("noVNC_open");
            document.getElementById('noVNC_settings_button')
                .classList.remove("noVNC_selected");
        },

        // Toggle the settings menu:
        //   On open, settings are refreshed from saved cookies.
        //   On close, settings are applied
        toggleSettingsPanel: function() {
            if (document.getElementById('noVNC_settings')
                .classList.contains("noVNC_open")) {
                UI.settingsApply();
                UI.closeSettingsPanel();
            } else {
                UI.openSettingsPanel();
            }
        },

/* ------^-------
 *   /SETTINGS
 * ==============
 *      XVP
 * ------v------*/

        openXvpPanel: function() {
            UI.closeAllPanels();

            document.getElementById('noVNC_xvp')
                .classList.add("noVNC_open");
            document.getElementById('noVNC_xvp_button')
                .classList.add("noVNC_selected");
        },

        closeXvpPanel: function() {
            document.getElementById('noVNC_xvp')
                .classList.remove("noVNC_open");
            document.getElementById('noVNC_xvp_button')
                .classList.remove("noVNC_selected");
        },

        toggleXvpPanel: function() {
            if (document.getElementById('noVNC_xvp')
                .classList.contains("noVNC_open")) {
                UI.closeXvpPanel();
            } else {
                UI.openXvpPanel();
            }
        },

        // Disable/enable XVP button
        updateXvpButton: function(ver) {
            if (ver >= 1) {
                document.getElementById('noVNC_xvp_button')
                    .classList.remove("noVNC_hidden");
            } else {
                document.getElementById('noVNC_xvp_button')
                    .classList.add("noVNC_hidden");
                // Close XVP panel if open
                UI.closeXvpPanel();
            }
        },

/* ------^-------
 *     /XVP
 * ==============
 *   CLIPBOARD
 * ------v------*/

        openClipboardPanel: function() {
            UI.closeAllPanels();

            document.getElementById('noVNC_clipboard')
                .classList.add("noVNC_open");
            document.getElementById('noVNC_clipboard_button')
                .classList.add("noVNC_selected");
        },

        closeClipboardPanel: function() {
            document.getElementById('noVNC_clipboard')
                .classList.remove("noVNC_open");
            document.getElementById('noVNC_clipboard_button')
                .classList.remove("noVNC_selected");
        },

        toggleClipboardPanel: function() {
            if (document.getElementById('noVNC_clipboard')
                .classList.contains("noVNC_open")) {
                UI.closeClipboardPanel();
            } else {
                UI.openClipboardPanel();
            }
        },

        clipboardReceive: function(rfb, text) {
            Util.Debug(">> UI.clipboardReceive: " + text.substr(0,40) + "...");
            document.getElementById('noVNC_clipboard_text').value = text;
            Util.Debug("<< UI.clipboardReceive");
        },

        clipboardClear: function() {
            document.getElementById('noVNC_clipboard_text').value = "";
            UI.rfb.clipboardPasteFrom("");
        },

        clipboardSend: function() {
            var text = document.getElementById('noVNC_clipboard_text').value;
            Util.Debug(">> UI.clipboardSend: " + text.substr(0,40) + "...");
            UI.rfb.clipboardPasteFrom(text);
            Util.Debug("<< UI.clipboardSend");
        },

/* ------^-------
 *  /CLIPBOARD
 * ==============
 *  CONNECTION
 * ------v------*/

        openConnectPanel: function() {
            UI.closeAllPanels();

            document.getElementById('noVNC_connect_controls')
                .classList.add("noVNC_open");
            document.getElementById('noVNC_connect_controls_button')
                .classList.add("noVNC_selected");

            document.getElementById('noVNC_setting_host').focus();
        },

        closeConnectPanel: function() {
            document.getElementById('noVNC_connect_controls')
                .classList.remove("noVNC_open");
            document.getElementById('noVNC_connect_controls_button')
                .classList.remove("noVNC_selected");

            UI.saveSetting('host');
            UI.saveSetting('port');
            UI.saveSetting('token');
            //UI.saveSetting('password');
        },

        toggleConnectPanel: function() {
            if (document.getElementById('noVNC_connect_controls')
                .classList.contains("noVNC_open")) {
                UI.closeConnectPanel();
            } else {
                UI.openConnectPanel();
            }
        },

        connect: function() {
            UI.closeAllPanels();

            var host = document.getElementById('noVNC_setting_host').value;
            var port = document.getElementById('noVNC_setting_port').value;
            var password = document.getElementById('noVNC_setting_password').value;
            var token = document.getElementById('noVNC_setting_token').value;
            var path = document.getElementById('noVNC_setting_path').value;

            //if token is in path then ignore the new token variable
            if (token) {
                path = WebUtil.injectParamIfMissing(path, "token", token);
            }

            if ((!host) || (!port)) {
                throw new Error("Must set host and port");
            }

            if (!UI.initRFB()) return;

            UI.rfb.set_encrypt(UI.getSetting('encrypt'));
            UI.rfb.set_true_color(UI.getSetting('true_color'));
            UI.rfb.set_local_cursor(UI.getSetting('cursor'));
            UI.rfb.set_shared(UI.getSetting('shared'));
            UI.rfb.set_view_only(UI.getSetting('view_only'));
            UI.rfb.set_repeaterID(UI.getSetting('repeaterID'));

            UI.rfb.connect(host, port, password, path);

            //Close dialog.
            setTimeout(UI.setBarPosition, 100);
        },

        disconnect: function() {
            UI.closeAllPanels();
            UI.rfb.disconnect();

            // Restore the callback used for initial resize
            UI.rfb.set_onFBUComplete(UI.initialResize);

            // Don't display the connection settings until we're actually disconnected
        },

        setPassword: function() {
            UI.rfb.sendPassword(document.getElementById('noVNC_setting_password').value);
            //Reset connect button.
            document.getElementById('noVNC_connect_button').value = "Connect";
            document.getElementById('noVNC_connect_button').onclick = UI.connect;
            //Hide connection panel.
            UI.toggleConnectPanel();
            return false;
        },

/* ------^-------
 *  /CONNECTION
 * ==============
 *   FULLSCREEN
 * ------v------*/

        toggleFullscreen: function() {
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
            UI.enableDisableViewClip();
            UI.updateFullscreenButton();
        },

        updateFullscreenButton: function() {
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
        applyResizeMode: function() {
            if (!UI.rfb) return;

            var screen = UI.screenSize();

            if (screen && UI.rfb_state === 'normal' && UI.rfb.get_display()) {

                var display = UI.rfb.get_display();
                var resizeMode = UI.getSetting('resize');

                if (resizeMode === 'remote') {

                    // Request changing the resolution of the remote display to
                    // the size of the local browser viewport.

                    // In order to not send multiple requests before the browser-resize
                    // is finished we wait 0.5 seconds before sending the request.
                    clearTimeout(UI.resizeTimeout);
                    UI.resizeTimeout = setTimeout(function(){

                        // Limit the viewport to the size of the browser window
                        display.set_maxWidth(screen.w);
                        display.set_maxHeight(screen.h);

                        Util.Debug('Attempting requestDesktopSize(' +
                                   screen.w + ', ' + screen.h + ')');

                        // Request a remote size covering the viewport
                        UI.rfb.requestDesktopSize(screen.w, screen.h);
                    }, 500);

                } else if (resizeMode === 'scale' || resizeMode === 'downscale') {
                    var downscaleOnly = resizeMode === 'downscale';
                    var scaleRatio = display.autoscale(screen.w, screen.h, downscaleOnly);
                    UI.rfb.get_mouse().set_scale(scaleRatio);
                    Util.Debug('Scaling by ' + UI.rfb.get_mouse().get_scale());
                }
            }
        },

        // The screen is always the same size as the available viewport
        // in the browser window minus the height of the control bar
        screenSize: function() {
            var screen = document.getElementById('noVNC_screen');

            // Hide the scrollbars until the size is calculated
            screen.style.overflow = "hidden";

            var pos = Util.getPosition(screen);
            var w = pos.width;
            var h = pos.height;

            screen.style.overflow = "visible";

            if (isNaN(w) || isNaN(h)) {
                return false;
            } else {
                return {w: w, h: h};
            }
        },

        // Normally we only apply the current resize mode after a window resize
        // event. This means that when a new connection is opened, there is no
        // resize mode active.
        // We have to wait until the first FBU because this is where the client
        // will find the supported encodings of the server. Some calls later in
        // the chain is dependant on knowing the server-capabilities.
        initialResize: function(rfb, fbu) {
            UI.applyResizeMode();
            // After doing this once, we remove the callback.
            UI.rfb.set_onFBUComplete(function() { });
        },

/* ------^-------
 *    /RESIZE
 * ==============
 *    CLIPPING
 * ------v------*/

        // Set and configure viewport clipping
        setViewClip: function(clip) {
            UI.updateSetting('clip', clip);
            UI.updateViewClip();
        },

        // Update parameters that depend on the clip setting
        updateViewClip: function() {
            var display;
            if (!UI.rfb) {
                return;
            }

            var display = UI.rfb.get_display();
            var cur_clip = display.get_viewport();
            var new_clip = UI.getSetting('clip');

            if (cur_clip !== new_clip) {
                display.set_viewport(new_clip);
            }

            var size = UI.screenSize();

            if (new_clip && size) {
                // When clipping is enabled, the screen is limited to
                // the size of the browser window.
                display.set_maxWidth(size.w);
                display.set_maxHeight(size.h);

                var screen = document.getElementById('noVNC_screen');
                var canvas = document.getElementById('noVNC_canvas');

                // Hide potential scrollbars that can skew the position
                screen.style.overflow = "hidden";

                // The x position marks the left margin of the canvas,
                // remove the margin from both sides to keep it centered.
                var new_w = size.w - (2 * Util.getPosition(canvas).x);

                screen.style.overflow = "visible";

                display.viewportChangeSize(new_w, size.h);
            } else {
                // Disable max dimensions
                display.set_maxWidth(0);
                display.set_maxHeight(0);
                display.viewportChangeSize();
            }
        },

        // Handle special cases where clipping is forced on/off or locked
        enableDisableViewClip: function() {
            var resizeSetting = document.getElementById('noVNC_setting_resize');
            var connected = UI.rfb && UI.rfb_state === 'normal';

            if (UI.isSafari) {
                // Safari auto-hides the scrollbars which makes them
                // impossible to use in most cases
                UI.setViewClip(true);
                document.getElementById('noVNC_setting_clip').disabled = true;
            } else if (resizeSetting.value === 'downscale' || resizeSetting.value === 'scale') {
                // Disable clipping if we are scaling
                UI.setViewClip(false);
                document.getElementById('noVNC_setting_clip').disabled = true;
            } else if (document.msFullscreenElement) {
                // The browser is IE and we are in fullscreen mode.
                // - We need to force clipping while in fullscreen since
                //   scrollbars doesn't work.
                UI.showStatus("Forcing clipping mode since scrollbars aren't supported by IE in fullscreen");
                UI.rememberedClipSetting = UI.getSetting('clip');
                UI.setViewClip(true);
                document.getElementById('noVNC_setting_clip').disabled = true;
            } else if (document.body.msRequestFullscreen && UI.rememberedClip !== null) {
                // Restore view clip to what it was before fullscreen on IE
                UI.setViewClip(UI.rememberedClipSetting);
                document.getElementById('noVNC_setting_clip').disabled = connected || UI.isTouchDevice;
            } else {
                document.getElementById('noVNC_setting_clip').disabled = connected || UI.isTouchDevice;
                if (UI.isTouchDevice) {
                    UI.setViewClip(true);
                }
            }
        },

/* ------^-------
 *   /CLIPPING
 * ==============
 *    VIEWDRAG
 * ------v------*/

        toggleViewDrag: function() {
            if (!UI.rfb) return;

            var drag = UI.rfb.get_viewportDrag();
            UI.setViewDrag(!drag);
         },

        // Set the view drag mode which moves the viewport on mouse drags
        setViewDrag: function(drag) {
            if (!UI.rfb) return;

            UI.rfb.set_viewportDrag(drag);

            UI.updateViewDrag();
        },

        updateViewDrag: function() {
            var clipping = false;

            // Check if viewport drag is possible. It is only possible
            // if the remote display is clipping the client display.
            if (UI.rfb_state === 'normal' &&
                UI.rfb.get_display().get_viewport() &&
                UI.rfb.get_display().clippingDisplay()) {
                clipping = true;
            }

            var viewDragButton = document.getElementById('noVNC_view_drag_button');

            if (UI.rfb_state !== 'normal') {
                // Always hide when not connected
                viewDragButton.classList.add("noVNC_hidden");
            } else {
                if (!clipping &&
                    UI.rfb.get_viewportDrag()) {
                    // The size of the remote display is the same or smaller
                    // than the client display. Make sure viewport drag isn't
                    // active when it can't be used.
                    UI.rfb.set_viewportDrag(false);
                }

                if (UI.rfb.get_viewportDrag()) {
                    viewDragButton.classList.add("noVNC_selected");
                } else {
                    viewDragButton.classList.remove("noVNC_selected");
                }

                // Different behaviour for touch vs non-touch
                // The button is disabled instead of hidden on touch devices
                if (UI.isTouchDevice) {
                    viewDragButton.classList.remove("noVNC_hidden");

                    if (clipping) {
                        viewDragButton.disabled = false;
                    } else {
                        viewDragButton.disabled = true;
                    }
                } else {
                    viewDragButton.disabled = false;

                    if (clipping) {
                        viewDragButton.classList.remove("noVNC_hidden");
                    } else {
                        viewDragButton.classList.add("noVNC_hidden");
                    }
                }
            }
        },

/* ------^-------
 *   /VIEWDRAG
 * ==============
 *    KEYBOARD
 * ------v------*/

        // On touch devices, show the OS keyboard
        showKeyboard: function() {
            var kbi = document.getElementById('noVNC_keyboardinput');
            var skb = document.getElementById('noVNC_keyboard_button');
            var l = kbi.value.length;
            if(UI.keyboardVisible === false) {
                kbi.focus();
                try { kbi.setSelectionRange(l, l); } // Move the caret to the end
                catch (err) {} // setSelectionRange is undefined in Google Chrome
                UI.keyboardVisible = true;
                skb.classList.add("noVNC_selected");
            } else if(UI.keyboardVisible === true) {
                kbi.blur();
                skb.classList.remove("noVNC_selected");
                UI.keyboardVisible = false;
            }
        },

        hideKeyboard: function() {
            document.getElementById('noVNC_keyboard_button')
                .classList.remove("noVNC_selected");
            //Weird bug in iOS if you change keyboardVisible
            //here it does not actually occur so next time
            //you click keyboard icon it doesnt work.
            UI.hideKeyboardTimeout = setTimeout(function() {
                UI.keyboardVisible = false;
            },100);
        },

        keepKeyboard: function() {
            clearTimeout(UI.hideKeyboardTimeout);
            if(UI.keyboardVisible === true) {
                document.getElementById('noVNC_keyboardinput').focus();
                document.getElementById('noVNC_keyboard_button')
                    .classList.add("noVNC_selected");
            } else if(UI.keyboardVisible === false) {
                document.getElementById('noVNC_keyboardinput').blur();
                document.getElementById('noVNC_keyboard_button')
                    .classList.remove("noVNC_selected");
            }
        },

        keyboardinputReset: function() {
            var kbi = document.getElementById('noVNC_keyboardinput');
            kbi.value = new Array(UI.defaultKeyboardinputLen).join("_");
            UI.lastKeyboardinput = kbi.value;
        },

        // When normal keyboard events are left uncought, use the input events from
        // the keyboardinput element instead and generate the corresponding key events.
        // This code is required since some browsers on Android are inconsistent in
        // sending keyCodes in the normal keyboard events when using on screen keyboards.
        keyInput: function(event) {

            if (!UI.rfb) return;

            var newValue = event.target.value;

            if (!UI.lastKeyboardinput) {
                UI.keyboardinputReset();
            }
            var oldValue = UI.lastKeyboardinput;

            var newLen;
            try {
                // Try to check caret position since whitespace at the end
                // will not be considered by value.length in some browsers
                newLen = Math.max(event.target.selectionStart, newValue.length);
            } catch (err) {
                // selectionStart is undefined in Google Chrome
                newLen = newValue.length;
            }
            var oldLen = oldValue.length;

            var backspaces;
            var inputs = newLen - oldLen;
            if (inputs < 0) {
                backspaces = -inputs;
            } else {
                backspaces = 0;
            }

            // Compare the old string with the new to account for
            // text-corrections or other input that modify existing text
            var i;
            for (i = 0; i < Math.min(oldLen, newLen); i++) {
                if (newValue.charAt(i) != oldValue.charAt(i)) {
                    inputs = newLen - i;
                    backspaces = oldLen - i;
                    break;
                }
            }

            // Send the key events
            for (i = 0; i < backspaces; i++) {
                UI.rfb.sendKey(KeyTable.XK_BackSpace);
            }
            for (i = newLen - inputs; i < newLen; i++) {
                UI.rfb.sendKey(newValue.charCodeAt(i));
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
                setTimeout(UI.keepKeyboard, 0);
            } else {
                UI.lastKeyboardinput = newValue;
            }
        },

        openExtraKeys: function() {
            document.getElementById('noVNC_modifiers')
                .classList.add("noVNC_open");
            document.getElementById('noVNC_toggle_extra_keys_button')
                .classList.add("noVNC_selected");
        },

        closeExtraKeys: function() {
            document.getElementById('noVNC_modifiers')
                .classList.remove("noVNC_open");
            document.getElementById('noVNC_toggle_extra_keys_button')
                .classList.remove("noVNC_selected");
        },

        toggleExtraKeys: function() {
            UI.keepKeyboard();
            if(document.getElementById('noVNC_modifiers')
                .classList.contains("noVNC_open")) {
                UI.closeExtraKeys();
            } else  {
                UI.openExtraKeys();
            }
        },

        sendEsc: function() {
            UI.keepKeyboard();
            UI.rfb.sendKey(KeyTable.XK_Escape);
        },

        sendTab: function() {
            UI.keepKeyboard();
            UI.rfb.sendKey(KeyTable.XK_Tab);
        },

        toggleCtrl: function() {
            UI.keepKeyboard();
            var btn = document.getElementById('noVNC_toggle_ctrl_button');
            if (btn.classList.contains("noVNC_selected")) {
                UI.rfb.sendKey(KeyTable.XK_Control_L, false);
                btn.classList.remove("noVNC_selected");
            } else {
                UI.rfb.sendKey(KeyTable.XK_Control_L, true);
                btn.classList.add("noVNC_selected");
            }
        },

        toggleAlt: function() {
            UI.keepKeyboard();
            var btn = document.getElementById('noVNC_toggle_alt_button');
            if (btn.classList.contains("noVNC_selected")) {
                UI.rfb.sendKey(KeyTable.XK_Alt_L, false);
                btn.classList.remove("noVNC_selected");
            } else {
                UI.rfb.sendKey(KeyTable.XK_Alt_L, true);
                btn.classList.add("noVNC_selected");
            }
        },

        sendCtrlAltDel: function() {
            UI.rfb.sendCtrlAltDel();
        },

/* ------^-------
 *   /KEYBOARD
 * ==============
 *     MISC
 * ------v------*/

        hideMouseButton: function() {
            UI.setMouseButton(-1);
        },

        setMouseButton: function(num) {
            if (UI.rfb) {
                UI.rfb.get_mouse().set_touchButton(num);
            }

            var blist = [0, 1,2,4];
            for (var b = 0; b < blist.length; b++) {
                var button = document.getElementById('noVNC_mouse_button' + blist[b]);
                if (blist[b] === num) {
                    button.classList.remove("noVNC_hidden");
                } else {
                    button.classList.add("noVNC_hidden");
                }
            }
        },

        displayBlur: function() {
            if (!UI.rfb) return;

            UI.rfb.get_keyboard().set_focused(false);
            UI.rfb.get_mouse().set_focused(false);
        },

        displayFocus: function() {
            if (!UI.rfb) return;

            UI.rfb.get_keyboard().set_focused(true);
            UI.rfb.get_mouse().set_focused(true);
        },

        // Display the desktop name in the document title
        updateDocumentTitle: function(rfb, name) {
            document.title = name + " - noVNC";
        },

        //Helper to add options to dropdown.
        addOption: function(selectbox, text, value) {
            var optn = document.createElement("OPTION");
            optn.text = text;
            optn.value = value;
            selectbox.options.add(optn);
        },

        setBarPosition: function() {
            document.getElementById('noVNC_control_bar').style.top = (window.pageYOffset) + 'px';
            document.getElementById('noVNC_mobile_buttons').style.left = (window.pageXOffset) + 'px';

            var vncwidth = document.getElementById('noVNC_container').style.offsetWidth;
            document.getElementById('noVNC_control_bar').style.width = vncwidth + 'px';
        }

/* ------^-------
 *    /MISC
 * ==============
 */
    };

    /* [module] UI.load(); */
})();

/* [module] export default UI; */
