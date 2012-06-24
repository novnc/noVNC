/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2012 Joel Martin
 * Licensed under LGPL-3 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 */

"use strict";
/*jslint white: false, browser: true */
/*global window, $D, Util, WebUtil, RFB, Display */

var UI = {

rfb_state : 'loaded',
settingsOpen : false,
connSettingsOpen : false,
clipboardOpen: false,
keyboardVisible: false,

// Render default UI and initialize settings menu
load: function() {
    var html = '', i, sheet, sheets, llevels;

    // Stylesheet selection dropdown
    sheet = WebUtil.selectStylesheet();
    sheets = WebUtil.getStylesheets();
    for (i = 0; i < sheets.length; i += 1) {
        UI.addOption($D('noVNC_stylesheet'),sheets[i].title, sheets[i].title);
    }

    // Logging selection dropdown
    llevels = ['error', 'warn', 'info', 'debug'];
    for (i = 0; i < llevels.length; i += 1) {
        UI.addOption($D('noVNC_logging'),llevels[i], llevels[i]);
    }

    // Settings with immediate effects
    UI.initSetting('logging', 'warn');
    WebUtil.init_logging(UI.getSetting('logging'));

    UI.initSetting('stylesheet', 'default');
    WebUtil.selectStylesheet(null);
    // call twice to get around webkit bug
    WebUtil.selectStylesheet(UI.getSetting('stylesheet'));

    /* Populate the controls if defaults are provided in the URL */
    UI.initSetting('host', window.location.hostname);
    UI.initSetting('port', window.location.port);
    UI.initSetting('password', '');
    UI.initSetting('encrypt', (window.location.protocol === "https:"));
    UI.initSetting('true_color', true);
    UI.initSetting('cursor', false);
    UI.initSetting('shared', true);
    UI.initSetting('view_only', false);
    UI.initSetting('connectTimeout', 2);
    UI.initSetting('path', 'websockify');
    UI.initSetting('repeaterID', '');

    UI.rfb = RFB({'target': $D('noVNC_canvas'),
                  'onUpdateState': UI.updateState,
                  'onClipboard': UI.clipReceive});
    UI.updateVisualState();

    // Unfocus clipboard when over the VNC area
    //$D('VNC_screen').onmousemove = function () {
    //         var keyboard = UI.rfb.get_keyboard();
    //        if ((! keyboard) || (! keyboard.get_focused())) {
    //            $D('VNC_clipboard_text').blur();
    //         }
    //    };

    // Show mouse selector buttons on touch screen devices
    if ('ontouchstart' in document.documentElement) {
        // Show mobile buttons
        $D('noVNC_mobile_buttons').style.display = "inline";
        UI.setMouseButton();
        // Remove the address bar
        setTimeout(function() { window.scrollTo(0, 1); }, 100);
        UI.forceSetting('clip', true);
        $D('noVNC_clip').disabled = true;
    } else {
        UI.initSetting('clip', false);
    }

    //iOS Safari does not support CSS position:fixed.
    //This detects iOS devices and enables javascript workaround.
    if ((navigator.userAgent.match(/iPhone/i)) ||
        (navigator.userAgent.match(/iPod/i)) ||
        (navigator.userAgent.match(/iPad/i))) {
        //UI.setOnscroll();
        //UI.setResize();
    }

    $D('noVNC_host').focus();

    UI.setViewClip();
    Util.addEvent(window, 'resize', UI.setViewClip);

    Util.addEvent(window, 'beforeunload', function () {
        if (UI.rfb_state === 'normal') {
            return "You are currently connected.";
        }
    } );

    // Show description by default when hosted at for kanaka.github.com
    if (location.host === "kanaka.github.com") {
        // Open the description dialog
        $D('noVNC_description').style.display = "block";
    } else {
        // Open the connect panel on first load
        UI.toggleConnectPanel();
    }
},

// Read form control compatible setting from cookie
getSetting: function(name) {
    var val, ctrl = $D('noVNC_' + name);
    val = WebUtil.readCookie(name);
    if (ctrl.type === 'checkbox') {
        if (val.toLowerCase() in {'0':1, 'no':1, 'false':1}) {
            val = false;
        } else {
            val = true;
        }
    }
    return val;
},

// Update cookie and form control setting. If value is not set, then
// updates from control to current cookie setting.
updateSetting: function(name, value) {

    var i, ctrl = $D('noVNC_' + name);
    // Save the cookie for this session
    if (typeof value !== 'undefined') {
        WebUtil.createCookie(name, value);
    }

    // Update the settings control
    value = UI.getSetting(name);

    if (ctrl.type === 'checkbox') {
        ctrl.checked = value;

    } else if (typeof ctrl.options !== 'undefined') {
        for (i = 0; i < ctrl.options.length; i += 1) {
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
    var val, ctrl = $D('noVNC_' + name);
    if (ctrl.type === 'checkbox') {
        val = ctrl.checked;
    } else if (typeof ctrl.options !== 'undefined') {
        val = ctrl.options[ctrl.selectedIndex].value;
    } else {
        val = ctrl.value;
    }
    WebUtil.createCookie(name, val);
    //Util.Debug("Setting saved '" + name + "=" + val + "'");
    return val;
},

// Initial page load read/initialization of settings
initSetting: function(name, defVal) {
    var val;

    // Check Query string followed by cookie
    val = WebUtil.getQueryVar(name);
    if (val === null) {
        val = WebUtil.readCookie(name, defVal);
    }
    UI.updateSetting(name, val);
 //Util.Debug("Setting '" + name + "' initialized to '" + val + "'");
    return val;
},

// Force a setting to be a certain value
forceSetting: function(name, val) {
    UI.updateSetting(name, val);
    return val;
},


// Show the clipboard panel
toggleClipboardPanel: function() {
    // Close the description panel
    $D('noVNC_description').style.display = "none";
    //Close settings if open
    if (UI.settingsOpen === true) {
        UI.settingsApply();
        UI.closeSettingsMenu();
    }
    //Close connection settings if open
    if (UI.connSettingsOpen === true) {
        UI.toggleConnectPanel();
    }
    //Toggle Clipboard Panel
    if (UI.clipboardOpen === true) {
        $D('noVNC_clipboard').style.display = "none";
        $D('clipboardButton').className = "noVNC_status_button";
        UI.clipboardOpen = false;
    } else {
        $D('noVNC_clipboard').style.display = "block";
        $D('clipboardButton').className = "noVNC_status_button_selected";
        UI.clipboardOpen = true;
    }
},

// Show the connection settings panel/menu
toggleConnectPanel: function() {
    // Close the description panel
    $D('noVNC_description').style.display = "none";
    //Close connection settings if open
    if (UI.settingsOpen === true) {
        UI.settingsApply();
        UI.closeSettingsMenu();
        $D('connectButton').className = "noVNC_status_button";
    }
    if (UI.clipboardOpen === true) {
        UI.toggleClipboardPanel();
    }

    //Toggle Connection Panel
    if (UI.connSettingsOpen === true) {
        $D('noVNC_controls').style.display = "none";
        $D('connectButton').className = "noVNC_status_button";
        UI.connSettingsOpen = false;
    } else {
        $D('noVNC_controls').style.display = "block";
        $D('connectButton').className = "noVNC_status_button_selected";
        UI.connSettingsOpen = true;
        $D('noVNC_host').focus();
    }
},

// Toggle the settings menu:
//   On open, settings are refreshed from saved cookies.
//   On close, settings are applied
toggleSettingsPanel: function() {
    // Close the description panel
    $D('noVNC_description').style.display = "none";
    if (UI.settingsOpen) {
        UI.settingsApply();
        UI.closeSettingsMenu();
    } else {
        UI.updateSetting('encrypt');
        UI.updateSetting('true_color');
        if (UI.rfb.get_display().get_cursor_uri()) {
            UI.updateSetting('cursor');
        } else {
            UI.updateSetting('cursor', false);
            $D('noVNC_cursor').disabled = true;
        }
        UI.updateSetting('clip');
        UI.updateSetting('shared');
        UI.updateSetting('view_only');
        UI.updateSetting('connectTimeout');
        UI.updateSetting('path');
        UI.updateSetting('repeaterID');
        UI.updateSetting('stylesheet');
        UI.updateSetting('logging');

        UI.openSettingsMenu();
    }
},

// Open menu
openSettingsMenu: function() {
    // Close the description panel
    $D('noVNC_description').style.display = "none";
    if (UI.clipboardOpen === true) {
        UI.toggleClipboardPanel();
    }
    //Close connection settings if open
    if (UI.connSettingsOpen === true) {
        UI.toggleConnectPanel();
    }
    $D('noVNC_settings').style.display = "block";
    $D('settingsButton').className = "noVNC_status_button_selected";
    UI.settingsOpen = true;
},

// Close menu (without applying settings)
closeSettingsMenu: function() {
    $D('noVNC_settings').style.display = "none";
    $D('settingsButton').className = "noVNC_status_button";
    UI.settingsOpen = false;
},

// Save/apply settings when 'Apply' button is pressed
settingsApply: function() {
    //Util.Debug(">> settingsApply");
    UI.saveSetting('encrypt');
    UI.saveSetting('true_color');
    if (UI.rfb.get_display().get_cursor_uri()) {
        UI.saveSetting('cursor');
    }
    UI.saveSetting('clip');
    UI.saveSetting('shared');
    UI.saveSetting('view_only');
    UI.saveSetting('connectTimeout');
    UI.saveSetting('path');
    UI.saveSetting('repeaterID');
    UI.saveSetting('stylesheet');
    UI.saveSetting('logging');

    // Settings with immediate (non-connected related) effect
    WebUtil.selectStylesheet(UI.getSetting('stylesheet'));
    WebUtil.init_logging(UI.getSetting('logging'));
    UI.setViewClip();
    UI.setViewDrag(UI.rfb.get_viewportDrag());
    //Util.Debug("<< settingsApply");
},



setPassword: function() {
    UI.rfb.sendPassword($D('noVNC_password').value);
    //Reset connect button.
    $D('noVNC_connect_button').value = "Connect";
    $D('noVNC_connect_button').onclick = UI.Connect;
    //Hide connection panel.
    UI.toggleConnectPanel();
    return false;
},

sendCtrlAltDel: function() {
    UI.rfb.sendCtrlAltDel();
},

setMouseButton: function(num) {
    var b, blist = [0, 1,2,4], button;

    if (typeof num === 'undefined') {
        // Disable mouse buttons
        num = -1;
    }
    if (UI.rfb) {
        UI.rfb.get_mouse().set_touchButton(num);
    }

    for (b = 0; b < blist.length; b++) {
        button = $D('noVNC_mouse_button' + blist[b]);
        if (blist[b] === num) {
            button.style.display = "";
        } else {
            button.style.display = "none";
            /*
            button.style.backgroundColor = "black";
            button.style.color = "lightgray";
            button.style.backgroundColor = "";
            button.style.color = "";
            */
        }
    }
},

updateState: function(rfb, state, oldstate, msg) {
    var s, sb, c, d, cad, vd, klass;
    UI.rfb_state = state;
    s = $D('noVNC_status');
    sb = $D('noVNC_status_bar');
    switch (state) {
        case 'failed':
        case 'fatal':
            klass = "noVNC_status_error";
            break;
        case 'normal':
            klass = "noVNC_status_normal";
            break;
        case 'disconnected':
            $D('noVNC_logo').style.display = "block";
            // Fall through
        case 'loaded':
            klass = "noVNC_status_normal";
            break;
        case 'password':
            UI.toggleConnectPanel();

            $D('noVNC_connect_button').value = "Send Password";
            $D('noVNC_connect_button').onclick = UI.setPassword;
            $D('noVNC_password').focus();

            klass = "noVNC_status_warn";
            break;
        default:
            klass = "noVNC_status_warn";
            break;
    }

    if (typeof(msg) !== 'undefined') {
        s.setAttribute("class", klass);
        sb.setAttribute("class", klass);
        s.innerHTML = msg;
    }

    UI.updateVisualState();
},

// Disable/enable controls depending on connection state
updateVisualState: function() {
    var connected = UI.rfb_state === 'normal' ? true : false;

    //Util.Debug(">> updateVisualState");
    $D('noVNC_encrypt').disabled = connected;
    $D('noVNC_true_color').disabled = connected;
    if (UI.rfb && UI.rfb.get_display() &&
        UI.rfb.get_display().get_cursor_uri()) {
        $D('noVNC_cursor').disabled = connected;
    } else {
        UI.updateSetting('cursor', false);
        $D('noVNC_cursor').disabled = true;
    }
    $D('noVNC_shared').disabled = connected;
    $D('noVNC_view_only').disabled = connected;
    $D('noVNC_connectTimeout').disabled = connected;
    $D('noVNC_path').disabled = connected;
    $D('noVNC_repeaterID').disabled = connected;

    if (connected) {
        UI.setViewClip();
        UI.setMouseButton(1);
        $D('clipboardButton').style.display = "inline";
        $D('showKeyboard').style.display = "inline";
        $D('sendCtrlAltDelButton').style.display = "inline";
    } else {
        UI.setMouseButton();
        $D('clipboardButton').style.display = "none";
        $D('showKeyboard').style.display = "none";
        $D('sendCtrlAltDelButton').style.display = "none";
    }
    // State change disables viewport dragging.
    // It is enabled (toggled) by direct click on the button
    UI.setViewDrag(false);

    switch (UI.rfb_state) {
        case 'fatal':
        case 'failed':
        case 'loaded':
        case 'disconnected':
            $D('connectButton').style.display = "";
            $D('disconnectButton').style.display = "none";
            break;
        default:
            $D('connectButton').style.display = "none";
            $D('disconnectButton').style.display = "";
            break;
    }

    //Util.Debug("<< updateVisualState");
},


clipReceive: function(rfb, text) {
    Util.Debug(">> UI.clipReceive: " + text.substr(0,40) + "...");
    $D('noVNC_clipboard_text').value = text;
    Util.Debug("<< UI.clipReceive");
},


connect: function() {
    var host, port, password, path;

    UI.closeSettingsMenu();
    UI.toggleConnectPanel();

    host = $D('noVNC_host').value;
    port = $D('noVNC_port').value;
    password = $D('noVNC_password').value;
    path = $D('noVNC_path').value;
    if ((!host) || (!port)) {
        throw("Must set host and port");
    }

    UI.rfb.set_encrypt(UI.getSetting('encrypt'));
    UI.rfb.set_true_color(UI.getSetting('true_color'));
    UI.rfb.set_local_cursor(UI.getSetting('cursor'));
    UI.rfb.set_shared(UI.getSetting('shared'));
    UI.rfb.set_view_only(UI.getSetting('view_only'));
    UI.rfb.set_connectTimeout(UI.getSetting('connectTimeout'));
    UI.rfb.set_repeaterID(UI.getSetting('repeaterID'));

    UI.rfb.connect(host, port, password, path);

    //Close dialog.
    setTimeout(UI.setBarPosition, 100);
    $D('noVNC_logo').style.display = "none";
},

disconnect: function() {
    UI.closeSettingsMenu();
    UI.rfb.disconnect();

    $D('noVNC_logo').style.display = "block";
    UI.connSettingsOpen = false;
    UI.toggleConnectPanel();
},

displayBlur: function() {
    UI.rfb.get_keyboard().set_focused(false);
    UI.rfb.get_mouse().set_focused(false);
},

displayFocus: function() {
    UI.rfb.get_keyboard().set_focused(true);
    UI.rfb.get_mouse().set_focused(true);
},

clipClear: function() {
    $D('noVNC_clipboard_text').value = "";
    UI.rfb.clipboardPasteFrom("");
},

clipSend: function() {
    var text = $D('noVNC_clipboard_text').value;
    Util.Debug(">> UI.clipSend: " + text.substr(0,40) + "...");
    UI.rfb.clipboardPasteFrom(text);
    Util.Debug("<< UI.clipSend");
},


// Enable/disable and configure viewport clipping
setViewClip: function(clip) {
    var display, cur_clip, pos, new_w, new_h;

    if (UI.rfb) {
        display = UI.rfb.get_display();
    } else {
        return;
    }

    cur_clip = display.get_viewport();

    if (typeof(clip) !== 'boolean') {
        // Use current setting
        clip = UI.getSetting('clip');
    }

    if (clip && !cur_clip) {
        // Turn clipping on
        UI.updateSetting('clip', true);
    } else if (!clip && cur_clip) {
        // Turn clipping off
        UI.updateSetting('clip', false);
        display.set_viewport(false);
        $D('noVNC_canvas').style.position = 'static';
        display.viewportChange();
    }
    if (UI.getSetting('clip')) {
        // If clipping, update clipping settings
        $D('noVNC_canvas').style.position = 'absolute';
        pos = Util.getPosition($D('noVNC_canvas'));
        new_w = window.innerWidth - pos.x;
        new_h = window.innerHeight - pos.y;
        display.set_viewport(true);
        display.viewportChange(0, 0, new_w, new_h);
    }
},

// Toggle/set/unset the viewport drag/move button
setViewDrag: function(drag) {
    var vmb = $D('noVNC_view_drag_button');
    if (!UI.rfb) { return; }

    if (UI.rfb_state === 'normal' &&
        UI.rfb.get_display().get_viewport()) {
        vmb.style.display = "inline";
    } else {
        vmb.style.display = "none";
    }

    if (typeof(drag) === "undefined") {
        // If not specified, then toggle
        drag = !UI.rfb.get_viewportDrag();
    }
    if (drag) {
        vmb.className = "noVNC_status_button_selected";
        UI.rfb.set_viewportDrag(true);
    } else {
        vmb.className = "noVNC_status_button";
        UI.rfb.set_viewportDrag(false);
    }
},

// On touch devices, show the OS keyboard
showKeyboard: function() {
    if(UI.keyboardVisible === false) {
        $D('keyboardinput').focus();
        UI.keyboardVisible = true;
        $D('showKeyboard').className = "noVNC_status_button_selected";
    } else if(UI.keyboardVisible === true) {
        $D('keyboardinput').blur();
        $D('showKeyboard').className = "noVNC_status_button";
        UI.keyboardVisible = false;
    }
},

keyInputBlur: function() {
    $D('showKeyboard').className = "noVNC_status_button";
    //Weird bug in iOS if you change keyboardVisible
    //here it does not actually occur so next time
    //you click keyboard icon it doesnt work.
    setTimeout(function() { UI.setKeyboard(); },100);
},

setKeyboard: function() {
    UI.keyboardVisible = false;
},

// iOS < Version 5 does not support position fixed. Javascript workaround:
setOnscroll: function() {
    window.onscroll = function() {
        UI.setBarPosition();
    };
},

setResize: function () {
    window.onResize = function() {
        UI.setBarPosition();
    };
},

//Helper to add options to dropdown.
addOption: function(selectbox,text,value )
{
    var optn = document.createElement("OPTION");
    optn.text = text;
    optn.value = value;
    selectbox.options.add(optn);
},

setBarPosition: function() {
    $D('noVNC-control-bar').style.top = (window.pageYOffset) + 'px';
    $D('noVNC_mobile_buttons').style.left = (window.pageXOffset) + 'px';

    var vncwidth = $D('noVNC_screen').style.offsetWidth;
    $D('noVNC-control-bar').style.width = vncwidth + 'px';
}

};




