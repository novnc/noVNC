/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2019 The noVNC Authors
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 */

import * as Log from '../core/util/logging.js';
import _, { l10n } from './localization.js';
import { isTouchDevice, isSafari, hasScrollbarGutter, dragThreshold }
    from '../core/util/browser.js';
import { setCapture, getPointerEvent } from '../core/util/events.js';
import KeyTable from "../core/input/keysym.js";
import keysyms from "../core/input/keysymdef.js";
import Keyboard from "../core/input/keyboard.js";
import RFB, {
    BellEventDetails,
    ClipboardEventDetails, CredentialsRequiredEventDetails, DesktopEventDetails,
    DisconnectEventDetails,
    RfbConnectionState,
    SecurityFailedEventDetails
} from "../core/rfb.js";
import * as WebUtil from "./webutil.js";
import {StatisticsDisplay} from "../core/util/stats/StatisticsDisplay.js";

const PAGE_TITLE = "noVNC";

export class UI {

    static connected:boolean = false;
    static desktopName:string = "";

    static statusTimeout : number = null;
    static hideKeyboardTimeout : number = null;
    static idleControlbarTimeout : number = null;
    static closeControlbarTimeout : number = null;

    static controlbarGrabbed:boolean = false;
    static controlbarDrag:boolean =  false;
    static controlbarMouseDownClientY:number = 0;
    static controlbarMouseDownOffsetY:number = 0;

    static lastKeyboardinput:any = null;
    static defaultKeyboardinputLen:number = 100;

    static inhibitReconnect:boolean = true;
    static reconnectCallback:number = null;
    static reconnectPassword:string = null;

    static rfb : RFB|undefined;
    static touchKeyboard : Keyboard;


    static prime() {
        return WebUtil.initSettings().then(() => {
            if (document.readyState === "interactive" || document.readyState === "complete") {
                return UI.start();
            }

            return new Promise((resolve, reject) => {
                document.addEventListener('DOMContentLoaded', () => UI.start().then(resolve).catch(reject));
            });
        });
    }

    // Render default UI and initialize settings menu
    static start() {

        new StatisticsDisplay();

        UI.initSettings();

        // Translate the DOM
        l10n.translateDOM();

        fetch('./package.json')
            .then((response) => {
                if (!response.ok) {
                    throw Error("" + response.status + " " + response.statusText);
                }
                return response.json();
            })
            .then((packageInfo) => {
                Array.from(document.getElementsByClassName('noVNC_version')).forEach((el:HTMLElement) => el.innerText = packageInfo.version);
            })
            .catch((err) => {
                Log.Error("Couldn't fetch package.json: " + err);
                Array.from(document.getElementsByClassName('noVNC_version_wrapper'))
                    .concat(Array.from(document.getElementsByClassName('noVNC_version_separator')))
                    .forEach((el:HTMLElement) => el.style.display = 'none');
            });

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
        UI.addControlbarHandlers();
        UI.addTouchSpecificHandlers();
        UI.addExtraKeysHandlers();
        UI.addMachineHandlers();
        UI.addConnectionControlHandlers();
        UI.addClipboardHandlers();
        UI.addSettingsHandlers();
        document.getElementById("noVNC_status")
            .addEventListener('click', UI.hideStatus);

        // Bootstrap fallback input handler
        UI.keyboardinputReset();

        UI.openControlbar();

        UI.updateVisualState('init');

        document.documentElement.classList.remove("noVNC_loading");

        let autoconnect:string|boolean = WebUtil.getConfigVar('autoconnect', false);
        if (autoconnect === 'true' || autoconnect == '1') {
            autoconnect = true;
            UI.connect();
        } else {
            autoconnect = false;
            // Show the connect panel on first load unless autoconnecting
            UI.openConnectPanel();
        }

        return Promise.resolve(UI.rfb);
    }

    static initFullscreen() {
        // Only show the button if fullscreen is properly supported
        // * Safari doesn't support alphanumerical input while in fullscreen
        if (!isSafari() &&
            (document.documentElement.requestFullscreen ||
              (document.documentElement as any).mozRequestFullScreen ||
              (document.documentElement as any).webkitRequestFullscreen ||
              (document.body as any).msRequestFullscreen)) {
            document.getElementById('noVNC_fullscreen_button')
                .classList.remove("noVNC_hidden");
            UI.addFullscreenHandlers();
        }
    }

    static initSettings() {
        // Logging selection dropdown
        const llevels = ['error', 'warn', 'info', 'debug'];
        for (let i = 0; i < llevels.length; i += 1) {
            UI.addOption(document.getElementById('noVNC_setting_logging') as HTMLSelectElement, llevels[i], llevels[i]);
        }

        // Settings with immediate effects
        UI.initSetting('logging', 'warn');
        UI.updateLogging();

        // if port == 80 (or 443) then it won't be present and should be
        // set manually
        let port:string|number = window.location.port;
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
        UI.initSetting('resize', 'off');
        UI.initSetting('quality', 2);
        UI.initSetting('compression', 2);
        UI.initSetting('shared', true);
        UI.initSetting('view_only', false);
        UI.initSetting('show_dot', true);
        UI.initSetting('path', 'websockify');
        UI.initSetting('repeaterID', '');
        UI.initSetting('reconnect', false);
        UI.initSetting('reconnect_delay', 5000);

        UI.setupSettingLabels();
    }
    // Adds a link to the label elements on the corresponding input elements
    static setupSettingLabels() {
        const labels = document.getElementsByTagName('LABEL') as HTMLCollectionOf<HTMLLabelElement>;
        for (let i = 0; i < labels.length; i++) {
            const htmlFor = labels[i].htmlFor;
            if (htmlFor != '') {
                const elem = document.getElementById(htmlFor) as HTMLElement;
                if (elem) (elem as any).label = labels[i];
            } else {
                // If 'for' isn't set, use the first input element child
                const children = labels[i].children;
                for (let j = 0; j < children.length; j++) {
                    if ((children[j] as any).form !== undefined) {
                        (children[j] as any).label = labels[i];
                        break;
                    }
                }
            }
        }
    }

/* ------^-------
*     /INIT
* ==============
* EVENT HANDLERS
* ------v------*/

    static addControlbarHandlers() {
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
    }

    static addTouchSpecificHandlers() {
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
    }

    static addExtraKeysHandlers() {
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
    }

    static addMachineHandlers() {
        document.getElementById("noVNC_shutdown_button")
            .addEventListener('click', () => UI.rfb.machineShutdown());
        document.getElementById("noVNC_reboot_button")
            .addEventListener('click', () => UI.rfb.machineReboot());
        document.getElementById("noVNC_reset_button")
            .addEventListener('click', () => UI.rfb.machineReset());
        document.getElementById("noVNC_power_button")
            .addEventListener('click', UI.togglePowerPanel);
    }

    static addConnectionControlHandlers() {
        document.getElementById("noVNC_disconnect_button")
            .addEventListener('click', UI.disconnect);
        document.getElementById("noVNC_connect_button")
            .addEventListener('click', UI.connect);
        document.getElementById("noVNC_cancel_reconnect_button")
            .addEventListener('click', UI.cancelReconnect);

        document.getElementById("noVNC_credentials_button")
            .addEventListener('click', UI.setCredentials);
    }

    static addClipboardHandlers() {
        document.getElementById("noVNC_clipboard_button")
            .addEventListener('click', UI.toggleClipboardPanel);
        document.getElementById("noVNC_clipboard_text")
            .addEventListener('change', UI.clipboardSend);
        document.getElementById("noVNC_clipboard_clear_button")
            .addEventListener('click', UI.clipboardClear);
    }

    // Add a call to save settings when the element changes,
    // unless the optional parameter changeFunc is used instead.
    static addSettingChangeHandler(name:string, changeFunc?:()=>void) {
        const settingElem = document.getElementById("noVNC_setting_" + name);
        if (changeFunc === undefined) {
            changeFunc = () => UI.saveSetting(name);
        }
        settingElem.addEventListener('change', changeFunc);
    }

    static addSettingsHandlers() {
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
    }

    static addFullscreenHandlers() {
        document.getElementById("noVNC_fullscreen_button")
            .addEventListener('click', UI.toggleFullscreen);

        window.addEventListener('fullscreenchange', UI.updateFullscreenButton);
        window.addEventListener('mozfullscreenchange', UI.updateFullscreenButton);
        window.addEventListener('webkitfullscreenchange', UI.updateFullscreenButton);
        window.addEventListener('msfullscreenchange', UI.updateFullscreenButton);
    }

/* ------^-------
 * /EVENT HANDLERS
 * ==============
 *     VISUAL
 * ------v------*/

    // Disable/enable controls depending on connection state
    static updateVisualState(state:RfbConnectionState|"init"|"reconnecting") {

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
            UI.closeControlbarTimeout = window.setTimeout(UI.closeControlbar, 2000);
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
        document.getElementById('noVNC_credentials_dlg')
            .classList.remove('noVNC_open');
    }

    static showStatus(text:string, statusType?:'error'|'warning'|'warn'|'normal'|'info', time?:number) {
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
    }

    static hideStatus() {
        clearTimeout(UI.statusTimeout);
        document.getElementById('noVNC_status').classList.remove("noVNC_open");
    }

    static activateControlbar() {
        clearTimeout(UI.idleControlbarTimeout);
        // We manipulate the anchor instead of the actual control
        // bar in order to avoid creating new a stacking group
        document.getElementById('noVNC_control_bar_anchor')
            .classList.remove("noVNC_idle");
        UI.idleControlbarTimeout = window.setTimeout(UI.idleControlbar, 2000);
    }

    static idleControlbar() {
        // Don't fade if a child of the control bar has focus
        if (document.getElementById('noVNC_control_bar')
            .contains(document.activeElement) && document.hasFocus()) {
            UI.activateControlbar();
            return;
        }

        document.getElementById('noVNC_control_bar_anchor')
            .classList.add("noVNC_idle");
    }

    static keepControlbar() {
        clearTimeout(UI.closeControlbarTimeout);
    }

    static openControlbar() {
        document.getElementById('noVNC_control_bar')
            .classList.add("noVNC_open");
    }

    static closeControlbar() {
        UI.closeAllPanels();
        document.getElementById('noVNC_control_bar')
            .classList.remove("noVNC_open");
        UI.rfb.focus();
    }

    static toggleControlbar() {
        if (document.getElementById('noVNC_control_bar')
            .classList.contains("noVNC_open")) {
            UI.closeControlbar();
        } else {
            UI.openControlbar();
        }
    }

    static toggleControlbarSide() {
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
    }

    static showControlbarHint(show:boolean) {
        const hint = document.getElementById('noVNC_control_bar_hint');
        if (show) {
            hint.classList.add("noVNC_active");
        } else {
            hint.classList.remove("noVNC_active");
        }
    }

    static dragControlbarHandle(e:TouchEvent) {
        if (!UI.controlbarGrabbed) return;

        const ptr = getPointerEvent(e) as unknown as PointerEvent;

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
    }

    // Move the handle but don't allow any position outside the bounds
    static moveControlbarHandle(viewportRelativeY:number) {
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
    }

    static updateControlbarHandle() {
        // Since the control bar is fixed on the viewport and not the page,
        // the move function expects coordinates relative the the viewport.
        const handle = document.getElementById("noVNC_control_bar_handle");
        const handleBounds = handle.getBoundingClientRect();
        UI.moveControlbarHandle(handleBounds.top);
    }

    static controlbarHandleMouseUp(e:MouseEvent) {
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
    }

    static controlbarHandleMouseDown(e:MouseEvent) {
        if ((e.type == "mousedown") && (e.button != 0)) return;

        const ptr = getPointerEvent(e as unknown as TouchEvent) as unknown as PointerEvent;

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
    }

    static toggleExpander(this:HTMLElement) {
        if (this.classList.contains("noVNC_open")) {
            this.classList.remove("noVNC_open");
        } else {
            this.classList.add("noVNC_open");
        }
    }

/* ------^-------
 *    /VISUAL
 * ==============
 *    SETTINGS
 * ------v------*/

    // Initial page load read/initialization of settings
    static initSetting(name:string, defVal:any) {
        // Check Query string followed by cookie
        let val = WebUtil.getConfigVar(name);
        if (val === null) {
            val = WebUtil.readSetting(name, defVal);
        }
        WebUtil.setSetting(name, val);
        UI.updateSetting(name);
        return val;
    }

    // Set the new value, update and disable form control setting
    static forceSetting(name:string, val:any) {
        WebUtil.setSetting(name, val);
        UI.updateSetting(name);
        UI.disableSetting(name);
    }

    // Update cookie and form control setting. If value is not set, then
    // updates from control to current cookie setting.
    static updateSetting(name:string) {

        // Update the settings control
        let value = UI.getSetting(name);

        const ctrl = document.getElementById('noVNC_setting_' + name) as HTMLInputElement&HTMLSelectElement;
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
    }

    // Save control setting to cookie
    static saveSetting(name:string) {
        const ctrl = document.getElementById('noVNC_setting_' + name) as HTMLInputElement&HTMLSelectElement;
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
    }

    // Read form control compatible setting from cookie
    static getSetting(name:string) {
        const ctrl = document.getElementById('noVNC_setting_' + name) as HTMLInputElement&HTMLSelectElement;
        let val = WebUtil.readSetting(name);
        if (typeof val !== 'undefined' && val !== null && ctrl.type === 'checkbox') {
            if (val.toString().toLowerCase() in {'0': 1, 'no': 1, 'false': 1}) {
                val = false;
            } else {
                val = true;
            }
        }
        return val;
    }

    // These helpers compensate for the lack of parent-selectors and
    // previous-sibling-selectors in CSS which are needed when we want to
    // disable the labels that belong to disabled input elements.
    static disableSetting(name:string) {
        const ctrl = document.getElementById('noVNC_setting_' + name) as HTMLInputElement&HTMLSelectElement;
        ctrl.disabled = true;
        (ctrl as any).label.classList.add('noVNC_disabled');
    }

    static enableSetting(name:string) {
        const ctrl = document.getElementById('noVNC_setting_' + name) as HTMLInputElement&HTMLSelectElement;
        ctrl.disabled = false;
        (ctrl as any).label.classList.remove('noVNC_disabled');
    }

/* ------^-------
 *   /SETTINGS
 * ==============
 *    PANELS
 * ------v------*/

    static closeAllPanels() {
        UI.closeSettingsPanel();
        UI.closePowerPanel();
        UI.closeClipboardPanel();
        UI.closeExtraKeys();
    }

/* ------^-------
 *   /PANELS
 * ==============
 * SETTINGS (panel)
 * ------v------*/

    static openSettingsPanel() {
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
    }

    static closeSettingsPanel() {
        document.getElementById('noVNC_settings')
            .classList.remove("noVNC_open");
        document.getElementById('noVNC_settings_button')
            .classList.remove("noVNC_selected");
    }

    static toggleSettingsPanel() {
        if (document.getElementById('noVNC_settings')
            .classList.contains("noVNC_open")) {
            UI.closeSettingsPanel();
        } else {
            UI.openSettingsPanel();
        }
    }

/* ------^-------
 *   /SETTINGS
 * ==============
 *     POWER
 * ------v------*/

    static openPowerPanel() {
        UI.closeAllPanels();
        UI.openControlbar();

        document.getElementById('noVNC_power')
            .classList.add("noVNC_open");
        document.getElementById('noVNC_power_button')
            .classList.add("noVNC_selected");
    }

    static closePowerPanel() {
        document.getElementById('noVNC_power')
            .classList.remove("noVNC_open");
        document.getElementById('noVNC_power_button')
            .classList.remove("noVNC_selected");
    }

    static togglePowerPanel() {
        if (document.getElementById('noVNC_power')
            .classList.contains("noVNC_open")) {
            UI.closePowerPanel();
        } else {
            UI.openPowerPanel();
        }
    }

    // Disable/enable power button
    static updatePowerButton() {
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
    }

/* ------^-------
 *    /POWER
 * ==============
 *   CLIPBOARD
 * ------v------*/

    static openClipboardPanel() {
        UI.closeAllPanels();
        UI.openControlbar();

        document.getElementById('noVNC_clipboard')
            .classList.add("noVNC_open");
        document.getElementById('noVNC_clipboard_button')
            .classList.add("noVNC_selected");
    }

    static closeClipboardPanel() {
        document.getElementById('noVNC_clipboard')
            .classList.remove("noVNC_open");
        document.getElementById('noVNC_clipboard_button')
            .classList.remove("noVNC_selected");
    }

    static toggleClipboardPanel() {
        if (document.getElementById('noVNC_clipboard')
            .classList.contains("noVNC_open")) {
            UI.closeClipboardPanel();
        } else {
            UI.openClipboardPanel();
        }
    }

    static clipboardReceive(e:CustomEvent<ClipboardEventDetails>) {
        Log.Debug(">> UI.clipboardReceive: " + e.detail.text.substr(0, 40) + "...");
        (document.getElementById('noVNC_clipboard_text') as HTMLInputElement).value = e.detail.text;
        Log.Debug("<< UI.clipboardReceive");
    }

    static clipboardClear() {
        (document.getElementById('noVNC_clipboard_text') as HTMLInputElement).value = "";
        UI.rfb.clipboardPasteFrom("");
    }

    static clipboardSend() {
        const text = (document.getElementById('noVNC_clipboard_text') as HTMLInputElement).value;
        Log.Debug(">> UI.clipboardSend: " + text.substr(0, 40) + "...");
        UI.rfb.clipboardPasteFrom(text);
        Log.Debug("<< UI.clipboardSend");
    }

    /* ------^-------
     *  /CLIPBOARD
     * ==============
     *  CONNECTION
     * ------v------*/

    static openConnectPanel() {
        document.getElementById('noVNC_connect_dlg')
            .classList.add("noVNC_open");
    }

    static closeConnectPanel() {
        document.getElementById('noVNC_connect_dlg')
            .classList.remove("noVNC_open");
    }

    static connect(event?:Event, password?:string) {

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

        if (!host) {
            Log.Error("Can't connect when host is: " + host);
            UI.showStatus(_("Must set host"), 'error');
            return;
        }

        UI.closeConnectPanel();

        UI.updateVisualState('connecting');

        let url;

        url = UI.getSetting('encrypt') ? 'wss' : 'ws';

        url += '://' + host;
        if (port) {
            url += ':' + port;
        }
        url += '/' + path;

        UI.rfb = new RFB(document.getElementById('noVNC_container') as HTMLDivElement, url,
                         { shared: UI.getSetting('shared'),
                           repeaterID: UI.getSetting('repeaterID'),
                           credentials: { password: password } });
        UI.rfb.initDecoders(); //TODO: await this!
        UI.rfb.addEventListener("connect", UI.connectFinished);
        UI.rfb.addEventListener("disconnect", UI.disconnectFinished);
        UI.rfb.addEventListener("credentialsrequired", UI.credentials);
        UI.rfb.addEventListener("securityfailure", UI.securityFailed);
        UI.rfb.addEventListener("capabilities", UI.updatePowerButton);
        UI.rfb.addEventListener("clipboard", UI.clipboardReceive);
        UI.rfb.addEventListener("bell", UI.bell);
        UI.rfb.addEventListener("desktopname", UI.updateDesktopName);
        UI.rfb.clipViewport = UI.getSetting('view_clip');
        UI.rfb.scaleViewport = UI.getSetting('resize') === 'scale';
        UI.rfb.resizeSession = UI.getSetting('resize') === 'remote';
        UI.rfb.qualityLevel = parseInt(UI.getSetting('quality'));
        UI.rfb.compressionLevel = parseInt(UI.getSetting('compression'));
        UI.rfb.showDotCursor = UI.getSetting('show_dot');

        UI.updateViewOnly(); // requires UI.rfb
    }

    static disconnect() {
        UI.rfb.disconnect();

        UI.connected = false;

        // Disable automatic reconnecting
        UI.inhibitReconnect = true;

        UI.updateVisualState('disconnecting');

        // Don't display the connection settings until we're actually disconnected
    }

    static reconnect() {
        UI.reconnectCallback = null;

        // if reconnect has been disabled in the meantime, do nothing.
        if (UI.inhibitReconnect) {
            return;
        }

        UI.connect(null, UI.reconnectPassword);
    }

    static cancelReconnect() {
        if (UI.reconnectCallback !== null) {
            window.clearTimeout(UI.reconnectCallback);
            UI.reconnectCallback = null;
        }

        UI.updateVisualState('disconnected');

        UI.openControlbar();
        UI.openConnectPanel();
    }

    static connectFinished() {
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
    }

    static disconnectFinished(e:CustomEvent<DisconnectEventDetails>) {
        const wasConnected = UI.connected;

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
        } else if (UI.getSetting('reconnect') === true && !UI.inhibitReconnect) {
            UI.updateVisualState('reconnecting');

            const delay = parseInt(UI.getSetting('reconnect_delay'));
            UI.reconnectCallback = window.setTimeout(UI.reconnect, delay);
            return;
        } else {
            UI.updateVisualState('disconnected');
            UI.showStatus(_("Disconnected"), 'normal');
        }

        document.title = PAGE_TITLE;

        UI.openControlbar();
        UI.openConnectPanel();
    }

    static securityFailed(e:CustomEvent<SecurityFailedEventDetails>) {
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
    }

/* ------^-------
 *  /CONNECTION
 * ==============
 *   PASSWORD
 * ------v------*/

    static credentials(e:CustomEvent<CredentialsRequiredEventDetails>) {
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
    }

    static setCredentials(e:MouseEvent) {
        // Prevent actually submitting the form
        e.preventDefault();

        let inputElemUsername = document.getElementById('noVNC_username_input') as HTMLInputElement;
        const username = inputElemUsername.value;

        let inputElemPassword = document.getElementById('noVNC_password_input') as HTMLInputElement;
        const password = inputElemPassword.value;
        // Clear the input after reading the password
        inputElemPassword.value = "";

        UI.rfb.sendCredentials({ username: username, password: password });
        UI.reconnectPassword = password;
        document.getElementById('noVNC_credentials_dlg')
            .classList.remove('noVNC_open');
    }

/* ------^-------
 *  /PASSWORD
 * ==============
 *   FULLSCREEN
 * ------v------*/

    static toggleFullscreen() {
        if (document.fullscreenElement || // alternative standard method
          (document as any).mozFullScreenElement || // currently working methods
          (document as any).webkitFullscreenElement ||
          (document as any).msFullscreenElement) {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if ((document as any).mozCancelFullScreen) {
                (document as any).mozCancelFullScreen();
            } else if ((document as any).webkitExitFullscreen) {
                (document as any).webkitExitFullscreen();
            } else if ((document as any).msExitFullscreen) {
                (document as any).msExitFullscreen();
            }
        } else {
            if (document.documentElement.requestFullscreen) {
                document.documentElement.requestFullscreen();
            } else if ((document.documentElement as any).mozRequestFullScreen) {
                (document.documentElement as any).mozRequestFullScreen();
            } else if ((document.documentElement as any).webkitRequestFullscreen) {
                (document.documentElement as any).webkitRequestFullscreen((Element as any).ALLOW_KEYBOARD_INPUT);
            } else if ((document.body as any).msRequestFullscreen) {
                (document.body as any).msRequestFullscreen();
            }
        }
        UI.updateFullscreenButton();
    }

    static updateFullscreenButton() {
        if (document.fullscreenElement || // alternative standard method
          (document as any).mozFullScreenElement || // currently working methods
          (document as any).webkitFullscreenElement ||
          (document as any).msFullscreenElement ) {
            document.getElementById('noVNC_fullscreen_button')
                .classList.add("noVNC_selected");
        } else {
            document.getElementById('noVNC_fullscreen_button')
                .classList.remove("noVNC_selected");
        }
    }

/* ------^-------
 *  /FULLSCREEN
 * ==============
 *     RESIZE
 * ------v------*/

    // Apply remote resizing or local scaling
    static applyResizeMode() {
        if (!UI.rfb) return;

        UI.rfb.scaleViewport = UI.getSetting('resize') === 'scale';
        UI.rfb.resizeSession = UI.getSetting('resize') === 'remote';
    }

/* ------^-------
 *    /RESIZE
 * ==============
 * VIEW CLIPPING
 * ------v------*/

    // Update viewport clipping property for the connection. The normal
    // case is to get the value from the setting. There are special cases
    // for when the viewport is scaled or when a touch device is used.
    static updateViewClip() {
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
    }

/* ------^-------
 * /VIEW CLIPPING
 * ==============
 *    VIEWDRAG
 * ------v------*/

    static toggleViewDrag() {
        if (!UI.rfb) return;

        UI.rfb.dragViewport = !UI.rfb.dragViewport;
        UI.updateViewDrag();
    }

    static updateViewDrag() {
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
            viewDragButton.classList.remove("noVNC_hidden");
        } else {
            viewDragButton.classList.add("noVNC_hidden");
        }
    }

/* ------^-------
 *   /VIEWDRAG
 * ==============
 *    QUALITY
 * ------v------*/

    static updateQuality() {
        if (!UI.rfb) return;

        UI.rfb.qualityLevel = parseInt(UI.getSetting('quality'));
    }

/* ------^-------
 *   /QUALITY
 * ==============
 *  COMPRESSION
 * ------v------*/

    static updateCompression() {
        if (!UI.rfb) return;

        UI.rfb.compressionLevel = parseInt(UI.getSetting('compression'));
    }

/* ------^-------
 *  /COMPRESSION
 * ==============
 *    KEYBOARD
 * ------v------*/

    static showVirtualKeyboard() {
        if (!isTouchDevice) return;

        const input = document.getElementById('noVNC_keyboardinput') as HTMLInputElement;

        if (document.activeElement == input) return;

        input.focus();

        try {
            const l = input.value.length;
            // Move the caret to the end
            input.setSelectionRange(l, l);
        } catch (err) {
            // setSelectionRange is undefined in Google Chrome
        }
    }

    static hideVirtualKeyboard() {
        if (!isTouchDevice) return;

        const input = document.getElementById('noVNC_keyboardinput');

        if (document.activeElement != input) return;

        input.blur();
    }

    static toggleVirtualKeyboard() {
        if (document.getElementById('noVNC_keyboard_button')
            .classList.contains("noVNC_selected")) {
            UI.hideVirtualKeyboard();
        } else {
            UI.showVirtualKeyboard();
        }
    }

    static onfocusVirtualKeyboard() {
        document.getElementById('noVNC_keyboard_button')
            .classList.add("noVNC_selected");
        if (UI.rfb) {
            UI.rfb.focusOnClick = false;
        }
    }

    static onblurVirtualKeyboard() {
        document.getElementById('noVNC_keyboard_button')
            .classList.remove("noVNC_selected");
        if (UI.rfb) {
            UI.rfb.focusOnClick = true;
        }
    }

    static keepVirtualKeyboard(event:MouseEvent) {
        const input = document.getElementById('noVNC_keyboardinput');

        // Only prevent focus change if the virtual keyboard is active
        if (document.activeElement != input) {
            return;
        }

        // Only allow focus to move to other elements that need
        // focus to function properly
        if ((event.target as any).form !== undefined) {
            switch ((event.target as any).type) {
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
    }

    static keyboardinputReset() {
        const kbi = document.getElementById('noVNC_keyboardinput') as HTMLInputElement;
        kbi.value = new Array(UI.defaultKeyboardinputLen).join("_");
        UI.lastKeyboardinput = kbi.value;
    }

    static keyEvent(keysym:number, code:string, down?:boolean) {
        if (!UI.rfb) return;

        UI.rfb.sendKey(keysym, code, down);
    }

    // When normal keyboard events are left uncought, use the input events from
    // the keyboardinput element instead and generate the corresponding key events.
    // This code is required since some browsers on Android are inconsistent in
    // sending keyCodes in the normal keyboard events when using on screen keyboards.
    static keyInput(event:KeyboardEvent) {

        if (!UI.rfb) return;

        const newValue = (event.target as HTMLInputElement).value;

        if (!UI.lastKeyboardinput) {
            UI.keyboardinputReset();
        }
        const oldValue = UI.lastKeyboardinput;

        let newLen;
        try {
            // Try to check caret position since whitespace at the end
            // will not be considered by value.length in some browsers
            newLen = Math.max((event.target as HTMLInputElement).selectionStart, newValue.length);
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
            (event.target as HTMLInputElement).blur();
            // This has to be ran outside of the input handler in order to work
            setTimeout((event.target as HTMLInputElement).focus.bind(event.target), 0);
        } else {
            UI.lastKeyboardinput = newValue;
        }
    }

/* ------^-------
 *   /KEYBOARD
 * ==============
 *   EXTRA KEYS
 * ------v------*/

    static openExtraKeys() {
        UI.closeAllPanels();
        UI.openControlbar();

        document.getElementById('noVNC_modifiers')
            .classList.add("noVNC_open");
        document.getElementById('noVNC_toggle_extra_keys_button')
            .classList.add("noVNC_selected");
    }

    static closeExtraKeys() {
        document.getElementById('noVNC_modifiers')
            .classList.remove("noVNC_open");
        document.getElementById('noVNC_toggle_extra_keys_button')
            .classList.remove("noVNC_selected");
    }

    static toggleExtraKeys() {
        if (document.getElementById('noVNC_modifiers')
            .classList.contains("noVNC_open")) {
            UI.closeExtraKeys();
        } else  {
            UI.openExtraKeys();
        }
    }

    static sendEsc() {
        UI.sendKey(KeyTable.XK_Escape, "Escape");
    }

    static sendTab() {
        UI.sendKey(KeyTable.XK_Tab, "Tab");
    }

    static toggleCtrl() {
        const btn = document.getElementById('noVNC_toggle_ctrl_button');
        if (btn.classList.contains("noVNC_selected")) {
            UI.sendKey(KeyTable.XK_Control_L, "ControlLeft", false);
            btn.classList.remove("noVNC_selected");
        } else {
            UI.sendKey(KeyTable.XK_Control_L, "ControlLeft", true);
            btn.classList.add("noVNC_selected");
        }
    }

    static toggleWindows() {
        const btn = document.getElementById('noVNC_toggle_windows_button');
        if (btn.classList.contains("noVNC_selected")) {
            UI.sendKey(KeyTable.XK_Super_L, "MetaLeft", false);
            btn.classList.remove("noVNC_selected");
        } else {
            UI.sendKey(KeyTable.XK_Super_L, "MetaLeft", true);
            btn.classList.add("noVNC_selected");
        }
    }

    static toggleAlt() {
        const btn = document.getElementById('noVNC_toggle_alt_button');
        if (btn.classList.contains("noVNC_selected")) {
            UI.sendKey(KeyTable.XK_Alt_L, "AltLeft", false);
            btn.classList.remove("noVNC_selected");
        } else {
            UI.sendKey(KeyTable.XK_Alt_L, "AltLeft", true);
            btn.classList.add("noVNC_selected");
        }
    }

    static sendCtrlAltDel() {
        UI.rfb.sendCtrlAltDel();
        // See below
        UI.rfb.focus();
        UI.idleControlbar();
    }

    static sendKey(keysym:number, code:string, down?:boolean) {
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
    }

/* ------^-------
 *   /EXTRA KEYS
 * ==============
 *     MISC
 * ------v------*/

    static updateViewOnly() {
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
    }

    static updateShowDotCursor() {
        if (!UI.rfb) return;
        UI.rfb.showDotCursor = UI.getSetting('show_dot');
    }

    static updateLogging() {
        WebUtil.initLogging(UI.getSetting('logging'));
    }

    static updateDesktopName(e:CustomEvent<DesktopEventDetails>) {
        UI.desktopName = e.detail.name;
        // Display the desktop name in the document title
        document.title = e.detail.name + " - " + PAGE_TITLE;
    }

    static bell(e:CustomEvent<BellEventDetails>) {
        if (WebUtil.getConfigVar('bell', 'on') === 'on') {
            const promise = (document.getElementById('noVNC_bell') as HTMLAudioElement).play();
            // The standards disagree on the return value here
            if (promise) {
                promise.catch((e:Error) => {
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
    }

    //Helper to add options to dropdown.
    static addOption(selectbox:HTMLSelectElement, text:string, value:string) {
        const optn = document.createElement("OPTION") as HTMLOptionElement;
        optn.text = text;
        optn.value = value;
        selectbox.options.add(optn);
    }

/* ------^-------
 *    /MISC
 * ==============
 */
}

// Set up translations
const LINGUAS = ["cs", "de", "el", "es", "ja", "ko", "nl", "pl", "pt_BR", "ru", "sv", "tr", "zh_CN", "zh_TW"];
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
