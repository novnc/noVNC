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
 * import keysyms from "./keysymdef";
 * import RFB from "../core/rfb";
 * import Display from "../core/display";
 * import WebUtil from "./webutil";
 */

var UI;

(function () {
    "use strict";

    // Fallback for all uncought errors
    window.addEventListener('error', function(event) {
        try {
            var msg, div, text;

            msg = document.getElementById('noVNC_fallback_errormsg');

            // Only show the initial error
            if (msg.hasChildNodes()) {
                return false;
            }

            div = document.createElement("div");
            div.appendChild(document.createTextNode(event.message));
            msg.appendChild(div);

            div = document.createElement("div");
            div.className = 'noVNC_location';
            text = event.filename + ":" + event.lineno + ":" + event.colno;
            div.appendChild(document.createTextNode(text));
            msg.appendChild(div);

            if ((event.error !== undefined) &&
                (event.error.stack !== undefined)) {
                div = document.createElement("div");
                div.className = 'noVNC_stack';
                div.appendChild(document.createTextNode(event.error.stack));
                msg.appendChild(div);
            }

            document.getElementById('noVNC_fallback_error')
                .classList.add("noVNC_open");
        } catch (exc) {
            document.write("noVNC encountered an error.");
        }
        // Don't return true since this would prevent the error
        // from being printed to the browser console.
        return false;
    });

    // Set up translations
    var LINGUAS = ["de", "el", "nl", "sv"];
    Util.Localisation.setup(LINGUAS);
    if (Util.Localisation.language !== "en") {
        WebUtil.load_scripts(
            {'app': ["locale/" + Util.Localisation.language + ".js"]});
    }

    /* [begin skip-as-module] */
    // Load supporting scripts
    WebUtil.load_scripts(
        {'core': ["base64.js", "websock.js", "des.js", "input/keysymdef.js",
                  "input/xtscancodes.js", "input/util.js", "input/devices.js",
                  "display.js", "inflator.js", "rfb.js", "input/keysym.js"]});

    window.onscriptsload = function () { UI.load(); };
    /* [end skip-as-module] */

    var _ = Util.Localisation.get;

    UI = {

        connected: false,
        desktopName: "",

        resizeTimeout: null,
        statusTimeout: null,
        hideKeyboardTimeout: null,
        idleControlbarTimeout: null,
        closeControlbarTimeout: null,

        controlbarGrabbed: false,
        controlbarDrag: false,
        controlbarMouseDownClientY: 0,
        controlbarMouseDownOffsetY: 0,

        isSafari: false,
        rememberedClipSetting: null,
        lastKeyboardinput: null,
        defaultKeyboardinputLen: 100,

        inhibit_reconnect: true,
        reconnect_callback: null,
        reconnect_password: null,

        // Setup rfb object, load settings from browser storage, then call
        // UI.init to setup the UI/menus
        load: function(callback) {
            WebUtil.initSettings(UI.start, callback);
        },

        // Render default UI and initialize settings menu
        start: function(callback) {

            // Setup global variables first
            UI.isSafari = (navigator.userAgent.indexOf('Safari') !== -1 &&
                           navigator.userAgent.indexOf('Chrome') === -1);

            UI.initSettings();

            // Translate the DOM
            Util.Localisation.translateDOM();

            // Adapt the interface for touch screen devices
            if (Util.isTouchDevice) {
                document.documentElement.classList.add("noVNC_touch");
                // Remove the address bar
                setTimeout(function() { window.scrollTo(0, 1); }, 100);
            }

            // Restore control bar position
            if (WebUtil.readSetting('controlbar_pos') === 'right') {
                UI.toggleControlbarSide();
            }

            UI.initFullscreen();

            // Setup event handlers
            UI.addResizeHandlers();
            UI.addControlbarHandlers();
            UI.addTouchSpecificHandlers();
            UI.addExtraKeysHandlers();
            UI.addXvpHandlers();
            UI.addConnectionControlHandlers();
            UI.addClipboardHandlers();
            UI.addSettingsHandlers();
            document.getElementById("noVNC_status")
                .addEventListener('click', UI.hideStatus);

            UI.openControlbar();

            // Show the connect panel on first load unless autoconnecting
            if (!autoconnect) {
                UI.openConnectPanel();
            }

            UI.updateViewClip();

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

        initFullscreen: function() {
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

        initSettings: function() {
            var i;

            // Logging selection dropdown
            var llevels = ['error', 'warn', 'info', 'debug'];
            for (i = 0; i < llevels.length; i += 1) {
                UI.addOption(document.getElementById('noVNC_setting_logging'),llevels[i], llevels[i]);
            }

            // Settings with immediate effects
            UI.initSetting('logging', 'warn');
            UI.updateLogging();

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
            UI.initSetting('encrypt', (window.location.protocol === "https:"));
            UI.initSetting('true_color', true);
            UI.initSetting('cursor', !Util.isTouchDevice);
            UI.initSetting('clip', false);
            UI.initSetting('resize', 'off');
            UI.initSetting('shared', true);
            UI.initSetting('view_only', false);
            UI.initSetting('path', 'websockify');
            UI.initSetting('repeaterID', '');
            UI.initSetting('reconnect', false);
            UI.initSetting('reconnect_delay', 5000);

            UI.setupSettingLabels();
        },

        // Adds a link to the label elements on the corresponding input elements
        setupSettingLabels: function() {
            var labels = document.getElementsByTagName('LABEL');
            for (var i = 0; i < labels.length; i++) {
                var htmlFor = labels[i].htmlFor;
                if (htmlFor != '') {
                    var elem = document.getElementById(htmlFor);
                    if (elem) elem.label = labels[i];
                } else {
                    // If 'for' isn't set, use the first input element child
                    var children = labels[i].children;
                    for (var j = 0; j < children.length; j++) {
                        if (children[j].form !== undefined) {
                            children[j].label = labels[i];
                            break;
                        }
                    }
                }
            }
        },

        initRFB: function() {
            try {
                UI.rfb = new RFB({'target': document.getElementById('noVNC_canvas'),
                                  'onNotification': UI.notification,
                                  'onUpdateState': UI.updateState,
                                  'onDisconnected': UI.disconnectFinished,
                                  'onPasswordRequired': UI.passwordRequired,
                                  'onXvpInit': UI.updateXvpButton,
                                  'onClipboard': UI.clipboardReceive,
                                  'onBell': UI.bell,
                                  'onFBUComplete': UI.initialResize,
                                  'onFBResize': UI.updateSessionSize,
                                  'onDesktopName': UI.updateDesktopName});
                return true;
            } catch (exc) {
                var msg = "Unable to create RFB client -- " + exc;
                Util.Error(msg);
                UI.showStatus(msg, 'error');
                return false;
            }
        },

/* ------^-------
 *     /INIT
 * ==============
 * EVENT HANDLERS
 * ------v------*/

        addResizeHandlers: function() {
            window.addEventListener('resize', UI.applyResizeMode);
            window.addEventListener('resize', UI.updateViewClip);
        },

        addControlbarHandlers: function() {
            document.getElementById("noVNC_control_bar")
                .addEventListener('mousemove', UI.activateControlbar);
            document.getElementById("noVNC_control_bar")
                .addEventListener('mouseup', UI.activateControlbar);
            document.getElementById("noVNC_control_bar")
                .addEventListener('mousedown', UI.activateControlbar);
            document.getElementById("noVNC_control_bar")
                .addEventListener('keypress', UI.activateControlbar);

            document.getElementById("noVNC_control_bar")
                .addEventListener('mousedown', UI.keepControlbar);
            document.getElementById("noVNC_control_bar")
                .addEventListener('keypress', UI.keepControlbar);

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

            var exps = document.getElementsByClassName("noVNC_expander");
            for (var i = 0;i < exps.length;i++) {
                exps[i].addEventListener('click', UI.toggleExpander);
            }
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
                .addEventListener('click', UI.toggleVirtualKeyboard);

            document.getElementById("noVNC_keyboardinput")
                .addEventListener('input', UI.keyInput);
            document.getElementById("noVNC_keyboardinput")
                .addEventListener('focus', UI.onfocusVirtualKeyboard);
            document.getElementById("noVNC_keyboardinput")
                .addEventListener('blur', UI.onblurVirtualKeyboard);
            document.getElementById("noVNC_keyboardinput")
                .addEventListener('submit', function () { return false; });

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

            window.addEventListener('load', UI.keyboardinputReset);
        },

        addExtraKeysHandlers: function() {
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
            document.getElementById("noVNC_send_ctrl_alt_del_button")
                .addEventListener('click', UI.sendCtrlAltDel);
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
            document.getElementById("noVNC_disconnect_button")
                .addEventListener('click', UI.disconnect);
            document.getElementById("noVNC_connect_button")
                .addEventListener('click', UI.connect);
            document.getElementById("noVNC_cancel_reconnect_button")
                .addEventListener('click', UI.cancelReconnect);

            document.getElementById("noVNC_password_button")
                .addEventListener('click', UI.setPassword);
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

        // Add a call to save settings when the element changes,
        // unless the optional parameter changeFunc is used instead.
        addSettingChangeHandler: function(name, changeFunc) {
            var settingElem = document.getElementById("noVNC_setting_" + name);
            if (changeFunc === undefined) {
                changeFunc = function () { UI.saveSetting(name); };
            }
            settingElem.addEventListener('change', changeFunc);
        },

        addSettingsHandlers: function() {
            document.getElementById("noVNC_settings_button")
                .addEventListener('click', UI.toggleSettingsPanel);

            UI.addSettingChangeHandler('encrypt');
            UI.addSettingChangeHandler('true_color');
            UI.addSettingChangeHandler('cursor');
            UI.addSettingChangeHandler('cursor', UI.updateLocalCursor);
            UI.addSettingChangeHandler('resize');
            UI.addSettingChangeHandler('resize', UI.enableDisableViewClip);
            UI.addSettingChangeHandler('resize', UI.applyResizeMode);
            UI.addSettingChangeHandler('clip');
            UI.addSettingChangeHandler('clip', UI.updateViewClip);
            UI.addSettingChangeHandler('shared');
            UI.addSettingChangeHandler('view_only');
            UI.addSettingChangeHandler('view_only', UI.updateViewOnly);
            UI.addSettingChangeHandler('host');
            UI.addSettingChangeHandler('port');
            UI.addSettingChangeHandler('path');
            UI.addSettingChangeHandler('repeaterID');
            UI.addSettingChangeHandler('logging');
            UI.addSettingChangeHandler('logging', UI.updateLogging);
            UI.addSettingChangeHandler('reconnect');
            UI.addSettingChangeHandler('reconnect_delay');
        },

        addFullscreenHandlers: function() {
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

        updateState: function(rfb, state, oldstate) {
            var msg;

            document.documentElement.classList.remove("noVNC_connecting");
            document.documentElement.classList.remove("noVNC_connected");
            document.documentElement.classList.remove("noVNC_disconnecting");
            document.documentElement.classList.remove("noVNC_reconnecting");

            switch (state) {
                case 'connecting':
                    document.getElementById("noVNC_transition_text").textContent = _("Connecting...");
                    document.documentElement.classList.add("noVNC_connecting");
                    break;
                case 'connected':
                    UI.connected = true;
                    UI.inhibit_reconnect = false;
                    document.documentElement.classList.add("noVNC_connected");
                    if (rfb && rfb.get_encrypt()) {
                        msg = _("Connected (encrypted) to ") + UI.desktopName;
                    } else {
                        msg = _("Connected (unencrypted) to ") + UI.desktopName;
                    }
                    UI.showStatus(msg);
                    break;
                case 'disconnecting':
                    UI.connected = false;
                    document.getElementById("noVNC_transition_text").textContent = _("Disconnecting...");
                    document.documentElement.classList.add("noVNC_disconnecting");
                    break;
                case 'disconnected':
                    UI.showStatus(_("Disconnected"));
                    break;
                default:
                    msg = "Invalid UI state";
                    Util.Error(msg);
                    UI.showStatus(msg, 'error');
                    break;
            }

            UI.updateVisualState();
        },

        // Disable/enable controls depending on connection state
        updateVisualState: function() {
            //Util.Debug(">> updateVisualState");

            UI.enableDisableViewClip();

            if (Util.browserSupportsCursorURIs() && !Util.isTouchDevice) {
                UI.enableSetting('cursor');
            } else {
                UI.disableSetting('cursor');
            }

            if (UI.connected) {
                UI.disableSetting('encrypt');
                UI.disableSetting('true_color');
                UI.disableSetting('shared');
                UI.disableSetting('host');
                UI.disableSetting('port');
                UI.disableSetting('path');
                UI.disableSetting('repeaterID');
                UI.updateViewClip();
                UI.setMouseButton(1);

                // Hide the controlbar after 2 seconds
                UI.closeControlbarTimeout = setTimeout(UI.closeControlbar, 2000);
            } else {
                UI.enableSetting('encrypt');
                UI.enableSetting('true_color');
                UI.enableSetting('shared');
                UI.enableSetting('host');
                UI.enableSetting('port');
                UI.enableSetting('path');
                UI.enableSetting('repeaterID');
                UI.updateXvpButton(0);
                UI.keepControlbar();
            }

            // Hide input related buttons in view only mode
            if (UI.rfb && UI.rfb.get_view_only()) {
                document.getElementById('noVNC_keyboard_button')
                    .classList.add('noVNC_hidden');
                document.getElementById('noVNC_toggle_extra_keys_button')
                    .classList.add('noVNC_hidden');
            } else {
                document.getElementById('noVNC_keyboard_button')
                    .classList.remove('noVNC_hidden');
                document.getElementById('noVNC_toggle_extra_keys_button')
                    .classList.remove('noVNC_hidden');
            }

            // State change disables viewport dragging.
            // It is enabled (toggled) by direct click on the button
            UI.setViewDrag(false);

            // State change also closes the password dialog
            document.getElementById('noVNC_password_dlg')
                .classList.remove('noVNC_open');

            //Util.Debug("<< updateVisualState");
        },

        showStatus: function(text, status_type, time) {
            var statusElem = document.getElementById('noVNC_status');

            clearTimeout(UI.statusTimeout);

            if (typeof status_type === 'undefined') {
                status_type = 'normal';
            }

            statusElem.classList.remove("noVNC_status_normal");
            statusElem.classList.remove("noVNC_status_warn");
            statusElem.classList.remove("noVNC_status_error");

            switch (status_type) {
                case 'warning':
                case 'warn':
                    statusElem.classList.add("noVNC_status_warn");
                    break;
                case 'error':
                    statusElem.classList.add("noVNC_status_error");
                    break;
                case 'normal':
                case 'info':
                default:
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
            if (status_type !== 'error') {
                UI.statusTimeout = window.setTimeout(UI.hideStatus, time);
            }
        },

        hideStatus: function() {
            clearTimeout(UI.statusTimeout);
            document.getElementById('noVNC_status').classList.remove("noVNC_open");
        },

        notification: function (rfb, msg, level, options) {
            UI.showStatus(msg, level);
        },

        activateControlbar: function(event) {
            clearTimeout(UI.idleControlbarTimeout);
            // We manipulate the anchor instead of the actual control
            // bar in order to avoid creating new a stacking group
            document.getElementById('noVNC_control_bar_anchor')
                .classList.remove("noVNC_idle");
            UI.idleControlbarTimeout = window.setTimeout(UI.idleControlbar, 2000);
        },

        idleControlbar: function() {
            document.getElementById('noVNC_control_bar_anchor')
                .classList.add("noVNC_idle");
        },

        keepControlbar: function() {
            clearTimeout(UI.closeControlbarTimeout);
        },

        openControlbar: function() {
            document.getElementById('noVNC_control_bar')
                .classList.add("noVNC_open");
        },

        closeControlbar: function() {
            UI.closeAllPanels();
            document.getElementById('noVNC_control_bar')
                .classList.remove("noVNC_open");
        },

        toggleControlbar: function() {
            if (document.getElementById('noVNC_control_bar')
                .classList.contains("noVNC_open")) {
                UI.closeControlbar();
            } else {
                UI.openControlbar();
            }
        },

        toggleControlbarSide: function () {
            // Temporarily disable animation to avoid weird movement
            var bar = document.getElementById('noVNC_control_bar');
            bar.style.transitionDuration = '0s';
            bar.addEventListener('transitionend', function () { this.style.transitionDuration = ""; });

            var anchor = document.getElementById('noVNC_control_bar_anchor');
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

        dragControlbarHandle: function (e) {
            if (!UI.controlbarGrabbed) return;

            var ptr = Util.getPointerEvent(e);

            var anchor = document.getElementById('noVNC_control_bar_anchor');
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
                // The goal is to trigger on a certain physical width, the
                // devicePixelRatio brings us a bit closer but is not optimal.
                var dragThreshold = 10 * (window.devicePixelRatio || 1);
                var dragDistance = Math.abs(ptr.clientY - UI.controlbarMouseDownClientY);

                if (dragDistance < dragThreshold) return;

                UI.controlbarDrag = true;
            }

            var eventY = ptr.clientY - UI.controlbarMouseDownOffsetY;

            UI.moveControlbarHandle(eventY);

            e.preventDefault();
            e.stopPropagation();
            UI.keepControlbar();
            UI.activateControlbar();
        },

        // Move the handle but don't allow any position outside the bounds
        moveControlbarHandle: function (viewportRelativeY) {
            var handle = document.getElementById("noVNC_control_bar_handle");
            var handleHeight = handle.getBoundingClientRect().height;
            var controlbarBounds = document.getElementById("noVNC_control_bar")
                .getBoundingClientRect();
            var margin = 10;

            // These heights need to be non-zero for the below logic to work
            if (handleHeight === 0 || controlbarBounds.height === 0) {
                return;
            }

            var newY = viewportRelativeY;

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
            var parentRelativeY = newY - controlbarBounds.top;
            handle.style.transform = "translateY(" + parentRelativeY + "px)";
        },

        updateControlbarHandle: function () {
            // Since the control bar is fixed on the viewport and not the page,
            // the move function expects coordinates relative the the viewport.
            var handle = document.getElementById("noVNC_control_bar_handle");
            var handleBounds = handle.getBoundingClientRect();
            UI.moveControlbarHandle(handleBounds.top);
        },

        controlbarHandleMouseUp: function(e) {
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
        },

        controlbarHandleMouseDown: function(e) {
            if ((e.type == "mousedown") && (e.button != 0)) return;

            var ptr = Util.getPointerEvent(e);

            var handle = document.getElementById("noVNC_control_bar_handle");
            var bounds = handle.getBoundingClientRect();

            Util.setCapture(handle);
            UI.controlbarGrabbed = true;
            UI.controlbarDrag = false;

            UI.controlbarMouseDownClientY = ptr.clientY;
            UI.controlbarMouseDownOffsetY = ptr.clientY - bounds.top;
            e.preventDefault();
            e.stopPropagation();
            UI.keepControlbar();
            UI.activateControlbar();
        },

        toggleExpander: function(e) {
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

        // These helpers compensate for the lack of parent-selectors and
        // previous-sibling-selectors in CSS which are needed when we want to
        // disable the labels that belong to disabled input elements.
        disableSetting: function(name) {
            var ctrl = document.getElementById('noVNC_setting_' + name);
            ctrl.disabled = true;
            ctrl.label.classList.add('noVNC_disabled');
        },

        enableSetting: function(name) {
            var ctrl = document.getElementById('noVNC_setting_' + name);
            ctrl.disabled = false;
            ctrl.label.classList.remove('noVNC_disabled');
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
            UI.closeExtraKeys();
        },

/* ------^-------
 *   /PANELS
 * ==============
 * SETTINGS (panel)
 * ------v------*/

        openSettingsPanel: function() {
            UI.closeAllPanels();
            UI.openControlbar();

            // Refresh UI elements from saved cookies
            UI.updateSetting('encrypt');
            UI.updateSetting('true_color');
            if (Util.browserSupportsCursorURIs()) {
                UI.updateSetting('cursor');
            } else {
                UI.updateSetting('cursor', !Util.isTouchDevice);
                UI.disableSetting('cursor');
            }
            UI.updateSetting('clip');
            UI.updateSetting('resize');
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

        closeSettingsPanel: function() {
            document.getElementById('noVNC_settings')
                .classList.remove("noVNC_open");
            document.getElementById('noVNC_settings_button')
                .classList.remove("noVNC_selected");
        },

        toggleSettingsPanel: function() {
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
 *      XVP
 * ------v------*/

        openXvpPanel: function() {
            UI.closeAllPanels();
            UI.openControlbar();

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
            if (ver >= 1 && !UI.rfb.get_view_only()) {
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
            UI.openControlbar();

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
            document.getElementById('noVNC_connect_dlg')
                .classList.add("noVNC_open");
        },

        closeConnectPanel: function() {
            document.getElementById('noVNC_connect_dlg')
                .classList.remove("noVNC_open");
        },

        connect: function(event, password) {
            var host = UI.getSetting('host');
            var port = UI.getSetting('port');
            var path = UI.getSetting('path');

            if (typeof password === 'undefined') {
                password = WebUtil.getConfigVar('password');
            }

            if (password === null) {
                password = undefined;
            }

            if ((!host) || (!port)) {
                var msg = _("Must set host and port");
                Util.Error(msg);
                UI.showStatus(msg, 'error');
                return;
            }

            if (!UI.initRFB()) return;

            UI.closeAllPanels();
            UI.closeConnectPanel();

            UI.rfb.set_encrypt(UI.getSetting('encrypt'));
            UI.rfb.set_true_color(UI.getSetting('true_color'));
            UI.rfb.set_shared(UI.getSetting('shared'));
            UI.rfb.set_repeaterID(UI.getSetting('repeaterID'));

            UI.updateLocalCursor();
            UI.updateViewOnly();

            UI.rfb.connect(host, port, password, path);
        },

        disconnect: function() {
            UI.closeAllPanels();
            UI.rfb.disconnect();

            // Disable automatic reconnecting
            UI.inhibit_reconnect = true;

            // Restore the callback used for initial resize
            UI.rfb.set_onFBUComplete(UI.initialResize);

            // Don't display the connection settings until we're actually disconnected
        },

        reconnect: function() {
            UI.reconnect_callback = null;

            // if reconnect has been disabled in the meantime, do nothing.
            if (UI.inhibit_reconnect) {
                return;
            }

            UI.connect(null, UI.reconnect_password);
        },

        disconnectFinished: function (rfb, reason) {
            if (typeof reason !== 'undefined') {
                UI.showStatus(reason, 'error');
            } else if (UI.getSetting('reconnect', false) === true && !UI.inhibit_reconnect) {
                document.getElementById("noVNC_transition_text").textContent = _("Reconnecting...");
                document.documentElement.classList.add("noVNC_reconnecting");

                var delay = parseInt(UI.getSetting('reconnect_delay'));
                UI.reconnect_callback = setTimeout(UI.reconnect, delay);
                return;
            }

            UI.openControlbar();
            UI.openConnectPanel();
        },

        cancelReconnect: function() {
            if (UI.reconnect_callback !== null) {
                clearTimeout(UI.reconnect_callback);
                UI.reconnect_callback = null;
            }

            document.documentElement.classList.remove("noVNC_reconnecting");
            UI.openControlbar();
            UI.openConnectPanel();
        },

/* ------^-------
 *  /CONNECTION
 * ==============
 *   PASSWORD
 * ------v------*/

        passwordRequired: function(rfb, msg) {

            document.getElementById('noVNC_password_dlg')
                .classList.add('noVNC_open');

            setTimeout(function () {
                    document.getElementById('noVNC_password_input').focus();
                }, 100);

            if (typeof msg === 'undefined') {
                msg = _("Password is required");
            }
            Util.Warn(msg);
            UI.showStatus(msg, "warning");
        },

        setPassword: function(e) {
            var password = document.getElementById('noVNC_password_input').value;
            UI.rfb.sendPassword(password);
            UI.reconnect_password = password;
            document.getElementById('noVNC_password_dlg')
                .classList.remove('noVNC_open');
            // Prevent actually submitting the form
            e.preventDefault();
        },

/* ------^-------
 *  /PASSWORD
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

            if (screen && UI.connected && UI.rfb.get_display()) {

                var display = UI.rfb.get_display();
                var resizeMode = UI.getSetting('resize');
                display.set_scale(1);

                // Make sure the viewport is adjusted first
                UI.updateViewClip();

                if (resizeMode === 'remote') {

                    // Request changing the resolution of the remote display to
                    // the size of the local browser viewport.

                    // In order to not send multiple requests before the browser-resize
                    // is finished we wait 0.5 seconds before sending the request.
                    clearTimeout(UI.resizeTimeout);
                    UI.resizeTimeout = setTimeout(function(){
                        // Request a remote size covering the viewport
                        if (UI.rfb.requestDesktopSize(screen.w, screen.h)) {
                            Util.Debug('Requested new desktop size: ' +
                                       screen.w + 'x' + screen.h);
                        }
                    }, 500);

                } else if (resizeMode === 'scale' || resizeMode === 'downscale') {
                    var downscaleOnly = resizeMode === 'downscale';
                    display.autoscale(screen.w, screen.h, downscaleOnly);
                    UI.fixScrollbars();
                }
            }
        },

        // Gets the the size of the available viewport in the browser window
        screenSize: function() {
            var screen = document.getElementById('noVNC_screen');
            return {w: screen.offsetWidth, h: screen.offsetHeight};
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
            if (!UI.rfb) return;

            var display = UI.rfb.get_display();
            var cur_clip = display.get_viewport();
            var new_clip = UI.getSetting('clip');

            var resizeSetting = UI.getSetting('resize');
            if (resizeSetting === 'downscale' || resizeSetting === 'scale') {
                // Disable clipping if we are scaling
                new_clip = false;
            } else if (Util.isTouchDevice) {
                // Touch devices usually have shit scrollbars
                new_clip = true;
            }

            if (cur_clip !== new_clip) {
                display.set_viewport(new_clip);
            }

            var size = UI.screenSize();

            if (new_clip && size) {
                // When clipping is enabled, the screen is limited to
                // the size of the browser window.
                display.viewportChangeSize(size.w, size.h);
                UI.fixScrollbars();
            }

            // Changing the viewport may change the state of
            // the dragging button
            UI.updateViewDrag();
        },

        // Handle special cases where clipping is forced on/off or locked
        enableDisableViewClip: function() {
            var resizeSetting = UI.getSetting('resize');
            // Disable clipping if we are scaling, connected or on touch
            if (resizeSetting === 'downscale' || resizeSetting === 'scale' ||
                Util.isTouchDevice) {
                UI.disableSetting('clip');
            } else {
                UI.enableSetting('clip');
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

            if (!UI.connected) return;

            // Check if viewport drag is possible. It is only possible
            // if the remote display is clipping the client display.
            if (UI.rfb.get_display().get_viewport() &&
                UI.rfb.get_display().clippingDisplay()) {
                clipping = true;
            }

            var viewDragButton = document.getElementById('noVNC_view_drag_button');

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
            if (Util.isTouchDevice) {
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
        },

/* ------^-------
 *   /VIEWDRAG
 * ==============
 *    KEYBOARD
 * ------v------*/

        showVirtualKeyboard: function() {
            if (!Util.isTouchDevice) return;

            var input = document.getElementById('noVNC_keyboardinput');

            if (document.activeElement == input) return;

            input.focus();

            try {
                var l = input.value.length;
                // Move the caret to the end
                input.setSelectionRange(l, l);
            } catch (err) {} // setSelectionRange is undefined in Google Chrome
        },

        hideVirtualKeyboard: function() {
            if (!Util.isTouchDevice) return;

            var input = document.getElementById('noVNC_keyboardinput');

            if (document.activeElement != input) return;

            input.blur();
        },

        toggleVirtualKeyboard: function () {
            if (document.getElementById('noVNC_keyboard_button')
                .classList.contains("noVNC_selected")) {
                UI.hideVirtualKeyboard();
            } else {
                UI.showVirtualKeyboard();
            }
        },

        onfocusVirtualKeyboard: function(event) {
            document.getElementById('noVNC_keyboard_button')
                .classList.add("noVNC_selected");
        },

        onblurVirtualKeyboard: function(event) {
            document.getElementById('noVNC_keyboard_button')
                .classList.remove("noVNC_selected");
        },

        keepVirtualKeyboard: function(event) {
            var input = document.getElementById('noVNC_keyboardinput');

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
                UI.rfb.sendKey(keysyms.fromUnicode(newValue.charCodeAt(i)).keysym);
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

        openExtraKeys: function() {
            UI.closeAllPanels();
            UI.openControlbar();

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
            if(document.getElementById('noVNC_modifiers')
                .classList.contains("noVNC_open")) {
                UI.closeExtraKeys();
            } else  {
                UI.openExtraKeys();
            }
        },

        sendEsc: function() {
            UI.rfb.sendKey(KeyTable.XK_Escape);
        },

        sendTab: function() {
            UI.rfb.sendKey(KeyTable.XK_Tab);
        },

        toggleCtrl: function() {
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
 *   /EXTRA KEYS
 * ==============
 *     MISC
 * ------v------*/

        setMouseButton: function(num) {
            var view_only = UI.rfb.get_view_only();
            if (UI.rfb && !view_only) {
                UI.rfb.get_mouse().set_touchButton(num);
            }

            var blist = [0, 1,2,4];
            for (var b = 0; b < blist.length; b++) {
                var button = document.getElementById('noVNC_mouse_button' +
                                                     blist[b]);
                if (blist[b] === num && !view_only) {
                    button.classList.remove("noVNC_hidden");
                } else {
                    button.classList.add("noVNC_hidden");
                }
            }
        },

        displayBlur: function() {
            if (UI.rfb && !UI.rfb.get_view_only()) {
                UI.rfb.get_keyboard().set_focused(false);
                UI.rfb.get_mouse().set_focused(false);
            }
        },

        displayFocus: function() {
            if (UI.rfb && !UI.rfb.get_view_only()) {
                UI.rfb.get_keyboard().set_focused(true);
                UI.rfb.get_mouse().set_focused(true);
            }
        },

        updateLocalCursor: function() {
            UI.rfb.set_local_cursor(UI.getSetting('cursor'));
        },

        updateViewOnly: function() {
            UI.rfb.set_view_only(UI.getSetting('view_only'));
        },

        updateLogging: function() {
            WebUtil.init_logging(UI.getSetting('logging'));
        },

        updateSessionSize: function(rfb, width, height) {
            UI.updateViewClip();
            UI.fixScrollbars();
        },

        fixScrollbars: function() {
            // This is a hack because Chrome screws up the calculation
            // for when scrollbars are needed. So to fix it we temporarily
            // toggle them off and on.
            var screen = document.getElementById('noVNC_screen');
            screen.style.overflow = 'hidden';
            // Force Chrome to recalculate the layout by asking for
            // an element's dimensions
            screen.getBoundingClientRect();
            screen.style.overflow = null;
        },

        updateDesktopName: function(rfb, name) {
            UI.desktopName = name;
            // Display the desktop name in the document title
            document.title = name + " - noVNC";
        },

        bell: function(rfb) {
            if (WebUtil.getConfigVar('bell', 'on') === 'on') {
                document.getElementById('noVNC_bell').play();
            }
        },

        //Helper to add options to dropdown.
        addOption: function(selectbox, text, value) {
            var optn = document.createElement("OPTION");
            optn.text = text;
            optn.value = value;
            selectbox.options.add(optn);
        },

/* ------^-------
 *    /MISC
 * ==============
 */
    };

    /* [module] UI.load(); */
})();

/* [module] export default UI; */
