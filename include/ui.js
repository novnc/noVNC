/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2011 Joel Martin
 * Licensed under LGPL-3 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 */

"use strict";
/*jslint white: false, browser: true */
/*global window, $D, Util, WebUtil, RFB, Canvas, Element, Fx */

var UI = {

settingsOpen : false,

// Render default UI and initialize settings menu
load: function(target) {
    var html = '', i, sheet, sheets, llevels;

    /* Populate the 'target' DOM element with default UI */
    if (!target) {
        target = $D('vnc');
    } else if (typeof target === 'string') {
        target = $D(target);
    }

    if ((!document.createElement('canvas').getContext) &&
        window.ActiveXObject) {
        // Suggest Chrome frame for Internet Explorer users
        html += '<center><div style="text-align: left; width: 400px">';
        html += '  You are using a version of Internet Explorer ';
        html += '  that does not have HTML5 Canvas support. ';
        html += '  To use noVNC you must use a browser with HTML5 ';
        html += '  Canvas support or install ';
        html += '  <a href="http://google.com/chromeframe" target="cframe">';
        html += '  Google Chrome Frame.</a>';
        html += '</div></center>';
        target.innerHTML = html;
        return;
    }

    html += '<div id="VNC_controls">';
    html += '  <ul>';
    html += '    <li>Host: <input id="VNC_host"></li>';
    html += '    <li>Port: <input id="VNC_port"></li>';
    html += '    <li>Password: <input id="VNC_password"';
    html += '        type="password"></li>';
    html += '    <li><input id="VNC_connect_button" type="button"';
    html += '        value="Loading" disabled></li>';
    html += '  </ul>';
    html += '</div>';
    html += '<div id="VNC_screen">';
    html += '  <div id="VNC_status_bar" class="VNC_status_bar" style="margin-top: 0px;">';
    html += '    <table border=0 width=100%><tr>';
    html += '      <td><div id="VNC_status">Loading</div></td>';
    html += '      <td width=1%><div class="VNC_buttons_right">';
    html += '        <input type=button class="VNC_status_button" value="Settings"';
    html += '          id="menuButton"';
    html += '          onclick="UI.clickSettingsMenu();">';
    html += '        <span id="VNC_settings_menu"';
    html += '          onmouseover="UI.canvasBlur();"';
    html += '          onmouseout="UI.canvasFocus();">';
    html += '          <ul>';
    html += '            <li><input id="VNC_encrypt"';
    html += '                type="checkbox"> Encrypt</li>';
    html += '            <li><input id="VNC_true_color"';
    html += '                type="checkbox" checked> True Color</li>';
    html += '            <li><input id="VNC_cursor"';
    html += '                type="checkbox"> Local Cursor</li>';
    html += '            <li><input id="VNC_shared"';
    html += '                type="checkbox"> Shared Mode</li>';
    html += '            <li><input id="VNC_connectTimeout"';
    html += '                type="input"> Connect Timeout (s)</li>';
    html += '            <hr>';

    // Stylesheet selection dropdown
    html += '            <li><select id="VNC_stylesheet" name="vncStyle">';
    html += '              <option value="default">default</option>';
    sheet = WebUtil.selectStylesheet();
    sheets = WebUtil.getStylesheets();
    for (i = 0; i < sheets.length; i += 1) {
        html += '<option value="' + sheets[i].title + '">' + sheets[i].title + '</option>';
    }
    html += '              </select> Style</li>';

    // Logging selection dropdown
    html += '            <li><select id="VNC_logging" name="vncLogging">';
    llevels = ['error', 'warn', 'info', 'debug'];
    for (i = 0; i < llevels.length; i += 1) {
        html += '<option value="' + llevels[i] + '">' + llevels[i] + '</option>';
    }
    html += '              </select> Logging</li>';

    html += '            <hr>';
    html += '            <li><input type="button" id="VNC_apply" value="Apply"';
    html += '                onclick="UI.settingsApply()"></li>';
    html += '          </ul>';
    html += '        </span></div></td>';
    html += '      <td width=1%><div class="VNC_buttons_right">';
    html += '        <input type=button class="VNC_status_button" value="Send CtrlAltDel"';
    html += '          id="sendCtrlAltDelButton"';
    html += '          onclick="UI.sendCtrlAltDel();"></div></td>';
    html += '    </tr></table>';
    html += '  </div>';
    html += '  <canvas id="VNC_canvas" width="640px" height="20px">';
    html += '      Canvas not supported.';
    html += '  </canvas>';
    html += '</div>';
    html += '<br><br>';
    html += '<div id="VNC_clipboard">';
    html += '  VNC Clipboard:';
    html += '  <input id="VNC_clipboard_clear_button"';
    html += '      type="button" value="Clear"';
    html += '      onclick="UI.clipClear();">';
    html += '  <br>';
    html += '  <textarea id="VNC_clipboard_text" cols=80 rows=5';
    html += '    onfocus="UI.canvasBlur();"';
    html += '    onblur="UI.canvasFocus();"';
    html += '    onchange="UI.clipSend();"></textarea>';
    html += '</div>';
    target.innerHTML = html;

    // Settings with immediate effects
    UI.initSetting('logging', 'warn');
    WebUtil.init_logging(UI.getSetting('logging'));
    UI.initSetting('stylesheet', 'default');

    WebUtil.selectStylesheet(null); // call twice to get around webkit bug
    WebUtil.selectStylesheet(UI.getSetting('stylesheet'));

    /* Populate the controls if defaults are provided in the URL */
    UI.initSetting('host', '');
    UI.initSetting('port', '');
    UI.initSetting('password', '');
    UI.initSetting('encrypt', false);
    UI.initSetting('true_color', true);
    UI.initSetting('cursor', false);
    UI.initSetting('shared', true);
    UI.initSetting('connectTimeout', 2);

    UI.rfb = RFB({'target': $D('VNC_canvas'),
                  'updateState': UI.updateState,
                  'clipboardReceive': UI.clipReceive});

    // Unfocus clipboard when over the VNC area
    $D('VNC_screen').onmousemove = function () {
            var keyboard = UI.rfb.get_keyboard();
            if ((! keyboard) || (! keyboard.get_focused())) {
                $D('VNC_clipboard_text').blur();
            }
        };

},

// Read form control compatible setting from cookie
getSetting: function(name) {
    var val, ctrl = $D('VNC_' + name);
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
    var i, ctrl = $D('VNC_' + name);
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
        ctrl.value = value;
    }
},

// Save control setting to cookie
saveSetting: function(name) {
    var val, ctrl = $D('VNC_' + name);
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


// Toggle the settings menu:
//   On open, settings are refreshed from saved cookies.
//   On close, settings are applied
clickSettingsMenu: function() {
    if (UI.settingsOpen) {
        UI.settingsApply();

        UI.closeSettingsMenu();
    } else {
        UI.updateSetting('encrypt');
        UI.updateSetting('true_color');
        if (UI.rfb.get_canvas().get_cursor_uri()) {
            UI.updateSetting('cursor');
        } else {
            UI.updateSetting('cursor', false);
            $D('VNC_cursor').disabled = true;
        }
        UI.updateSetting('shared');
        UI.updateSetting('connectTimeout');
        UI.updateSetting('stylesheet');
        UI.updateSetting('logging');

        UI.openSettingsMenu();
    }
},

// Open menu
openSettingsMenu: function() {
    $D('VNC_settings_menu').style.display = "block";
    UI.settingsOpen = true;
},

// Close menu (without applying settings)
closeSettingsMenu: function() {
    $D('VNC_settings_menu').style.display = "none";
    UI.settingsOpen = false;
},

// Disable/enable controls depending on connection state
settingsDisabled: function(disabled, rfb) {
    //Util.Debug(">> settingsDisabled");
    $D('VNC_encrypt').disabled = disabled;
    $D('VNC_true_color').disabled = disabled;
    if (rfb && rfb.get_canvas() && rfb.get_canvas().get_cursor_uri()) {
        $D('VNC_cursor').disabled = disabled;
    } else {
        UI.updateSetting('cursor', false);
        $D('VNC_cursor').disabled = true;
    }
    $D('VNC_shared').disabled = disabled;
    $D('VNC_connectTimeout').disabled = disabled;
    //Util.Debug("<< settingsDisabled");
},

// Save/apply settings when 'Apply' button is pressed
settingsApply: function() {
    //Util.Debug(">> settingsApply");
    UI.saveSetting('encrypt');
    UI.saveSetting('true_color');
    if (UI.rfb.get_canvas().get_cursor_uri()) {
        UI.saveSetting('cursor');
    }
    UI.saveSetting('shared');
    UI.saveSetting('connectTimeout');
    UI.saveSetting('stylesheet');
    UI.saveSetting('logging');

    // Settings with immediate (non-connected related) effect
    WebUtil.selectStylesheet(UI.getSetting('stylesheet'));
    WebUtil.init_logging(UI.getSetting('logging'));

    //Util.Debug("<< settingsApply");
},



setPassword: function() {
    UI.rfb.sendPassword($D('VNC_password').value);
    return false;
},

sendCtrlAltDel: function() {
    UI.rfb.sendCtrlAltDel();
},

updateState: function(rfb, state, oldstate, msg) {
    var s, sb, c, cad, klass;
    s = $D('VNC_status');
    sb = $D('VNC_status_bar');
    c = $D('VNC_connect_button');
    cad = $D('sendCtrlAltDelButton');
    switch (state) {
        case 'failed':
        case 'fatal':
            c.disabled = true;
            cad.disabled = true;
            UI.settingsDisabled(true, rfb);
            klass = "VNC_status_error";
            break;
        case 'normal':
            c.value = "Disconnect";
            c.onclick = UI.disconnect;
            c.disabled = false;
            cad.disabled = false;
            UI.settingsDisabled(true, rfb);
            klass = "VNC_status_normal";
            break;
        case 'disconnected':
        case 'loaded':
            c.value = "Connect";
            c.onclick = UI.connect;

            c.disabled = false;
            cad.disabled = true;
            UI.settingsDisabled(false, rfb);
            klass = "VNC_status_normal";
            break;
        case 'password':
            c.value = "Send Password";
            c.onclick = UI.setPassword;

            c.disabled = false;
            cad.disabled = true;
            UI.settingsDisabled(true, rfb);
            klass = "VNC_status_warn";
            break;
        default:
            c.disabled = true;
            cad.disabled = true;
            UI.settingsDisabled(true, rfb);
            klass = "VNC_status_warn";
            break;
    }

    if (typeof(msg) !== 'undefined') {
        s.setAttribute("class", klass);
        sb.setAttribute("class", klass);
        s.innerHTML = msg;
    }

},

clipReceive: function(rfb, text) {
    Util.Debug(">> UI.clipReceive: " + text.substr(0,40) + "...");
    $D('VNC_clipboard_text').value = text;
    Util.Debug("<< UI.clipReceive");
},


connect: function() {
    var host, port, password;

    UI.closeSettingsMenu();

    host = $D('VNC_host').value;
    port = $D('VNC_port').value;
    password = $D('VNC_password').value;
    if ((!host) || (!port)) {
        throw("Must set host and port");
    }

    UI.rfb.set_encrypt(UI.getSetting('encrypt'));
    UI.rfb.set_true_color(UI.getSetting('true_color'));
    UI.rfb.set_local_cursor(UI.getSetting('cursor'));
    UI.rfb.set_shared(UI.getSetting('shared'));
    UI.rfb.set_connectTimeout(UI.getSetting('connectTimeout'));

    UI.rfb.connect(host, port, password);
},

disconnect: function() {
    UI.closeSettingsMenu();

    UI.rfb.disconnect();
},

canvasBlur: function() {
    UI.rfb.get_keyboard().set_focused(false);
    UI.rfb.get_mouse().set_focused(false);
},

canvasFocus: function() {
    UI.rfb.get_keyboard().set_focused(true);
    UI.rfb.get_mouse().set_focused(true);
},

clipClear: function() {
    $D('VNC_clipboard_text').value = "";
    UI.rfb.clipboardPasteFrom("");
},

clipSend: function() {
    var text = $D('VNC_clipboard_text').value;
    Util.Debug(">> UI.clipSend: " + text.substr(0,40) + "...");
    UI.rfb.clipboardPasteFrom(text);
    Util.Debug("<< UI.clipSend");
}

};
