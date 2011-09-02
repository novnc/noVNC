/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2011 Joel Martin
 * Licensed under LGPL-3 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 */

"use strict";
/*jslint white: false, browser: true */
/*global window, $D, Util, WebUtil, RFB, Display */

var msg_cnt = 0, iterations,
            //fb_width = 800,
            //fb_height = 768,
            fb_width=1920,
            fb_height=900,
            viewport = {'x': 0, 'y': 0, 'w' : 0, 'h' : 0 },
            cleanRect = {},
            penDown = false, doMove = false,
            inMove = false, lastPos = {},
            canvas, ctx, keyboard, mouse;
            
var newline = "\n";

var UI = {

settingsOpen : false,

// Render default UI and initialize settings menu
load: function(target) {
    if (Util.Engine.trident) {
        var newline = "<br>\n";
    }
    
    var html = '', i, val, sheet, sheets, llevels;

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
    
    html+='<table border="0"><tr>';
    html+='   <td width="150pt">Host: <input id="VNC_host"/></td>';
    html+='   <td width="100pt">Port: <input id="VNC_port"/></td>';
    html+='   <td><div id="VNC_passwdField">';
    html+='	<form onsubmit="return UI.connect();">';
    html+='		Password: <input id="VNC_password" type="password"/>';
    html+='	</form>';
    html+='	<input id="VNC_connect_button" type="button"/>';
    html+='   </div></td>';
    html+='</tr></table>';
    
    html += '<div id="VNC_screen">';
    html += '  <div id="VNC_status_bar" class="VNC_status_bar" style="margin-top: 0px;">';
    html += '    <table border=0 width=100%><tr>';
    html += '      <td><div id="VNC_status">Loading</div></td>';

    // Mouse button selectors for touch devices
    html += '      <td width=1%><div class="VNC_buttons_right">';
    html += '        <nobr><span id="VNC_mouse_buttons" style="display: none;">';
    html += '          <input type="button" class="VNC_status_button"';
    html += '            id="VNC_mouse_button1" value="L" onclick="UI.setMouseButton(1);"';
    html += '            ><input type="button" class="VNC_status_button"';
    html += '            id="VNC_mouse_button2" value="M" onclick="UI.setMouseButton(2);"';
    html += '            ><input type="button" class="VNC_status_button"';
    html += '            id="VNC_mouse_button4" value="R" onclick="UI.setMouseButton(4);">';
    html += '        </span></nobr></div></td>';

    // Settings drop-down menu
    html += '      <td width=1%><div class="VNC_buttons_right">';
    html += '        <input type=button class="VNC_status_button" value="Settings"';
    html += '          id="menuButton"';
    html += '          onclick="UI.clickSettingsMenu();">';
    html += '        <span id="VNC_settings_menu"';
    html += '          onmouseover="UI.displayBlur();"';
    html += '          onmouseout="UI.displayFocus();">';
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
    
    // Scale selection dropdown
    html += '            <li><select id="VNC_scale">';
    for (i = 10; i >= 1; i -= 1) {
        val = (i/10).toFixed(1);    
        html += '<option value="' + val + '">' + val + '</option>';
    }
    html += '              </select> Scale</li>';
    
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

    // CtrlAltDel Button
    html += '      <td width=1%><div class="VNC_buttons_right">';
    html += '        <input type=button class="VNC_status_button" value="CtrlAltDel"';
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
    html += '    onfocus="UI.displayBlur();"';
    html += '    onblur="UI.displayFocus();"';
    html += '    onchange="UI.clipSend();"></textarea>';
    html += '</div>';
    target.innerHTML = html;

    // Settings with immediate effects
    UI.initSetting('logging', 'warn');
    WebUtil.init_logging(UI.getSetting('logging'));
    UI.initSetting('scale', 1.0);
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
                  'onUpdateState': UI.updateState,
                  'onClipboard': UI.clipReceive});
                  
    // Unfocus clipboard when over the VNC area
    $D('VNC_screen').onmousemove = function () {
            var keyboard = UI.rfb.get_keyboard();
            if ((! keyboard) || (! keyboard.get_focused())) {
                $D('VNC_clipboard_text').blur();
            }
        };

    // Show mouse selector buttons on touch screen devices
    if ('ontouchstart' in document.documentElement) {
        $D('VNC_mouse_buttons').style.display = "inline";
        UI.setMouseButton();
    }
    
    ctx=UI.rfb.get_display().get_context();
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
        if (UI.rfb.get_display().get_cursor_uri()) {
            UI.updateSetting('cursor');
        } else {
            UI.updateSetting('cursor', false);
            $D('VNC_cursor').disabled = true;
        }
        UI.updateSetting('shared');
        UI.updateSetting('connectTimeout');
        UI.updateSetting('stylesheet');
        UI.updateSetting('scale');
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
    if (rfb && rfb.get_display() && rfb.get_display().get_cursor_uri()) {
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
    var scale = UI.getSetting('scale');
    //Util.Debug(">> settingsApply");
    UI.saveSetting('encrypt');
    UI.saveSetting('true_color');
    if (UI.rfb.get_display().get_cursor_uri()) {
        UI.saveSetting('cursor');
    }
    UI.saveSetting('shared');
    UI.saveSetting('connectTimeout');
    UI.saveSetting('scale');
    UI.saveSetting('stylesheet');
    UI.saveSetting('logging');

    // Settings with immediate (non-connected related) effect
    if (UI.rfb) {
        //Util.Debug("scale: " + scale);
        //UI.rfb.get_display().set_scale(UI.getSetting('scale'));
        //UI.rfb.get_mouse().set_scale(UI.getSetting('scale'));
        UI.resize();
    }
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

setMouseButton: function(num) {
    var b, blist = [1,2,4], button,
        mouse = UI.rfb.get_mouse();

    if (typeof num === 'undefined') {
        // Show the default
        num = mouse.get_touchButton();
    } else if (num === mouse.get_touchButton()) {
        // Set all buttons off (no clicks)
        mouse.set_touchButton(0);
        num = 0;
    } else {
        // Turn on one button
        mouse.set_touchButton(num);
    }

    for (b = 0; b < blist.length; b++) {
        button = $D('VNC_mouse_button' + blist[b]);
        if (blist[b] === num) {
            button.style.backgroundColor = "black";
            button.style.color = "lightgray";
        } else {
            button.style.backgroundColor = "";
            button.style.color = "";
        }
    }

},

updateState: function(rfb, state, oldstate, msg) {
    var link, host, port, password, html;
    var s, sb, cad, klass;
    s = $D('VNC_status');
    sb = $D('VNC_status_bar');
    cad = $D('sendCtrlAltDelButton');
    
    switch (state) {
        case 'failed':
        case 'fatal':
            cad.disabled = true;
            UI.settingsDisabled(true, rfb);
            klass = "VNC_status_error";
            break;
        case 'normal':
            $D('VNC_passwdField').innerHTML='<input id="VNC_connect_button" type="button"/>';
            var c=$D('VNC_connect_button');
            
            c.value="Disconnect";
            c.onclick=UI.disconnect;
            c.disabled = false;
            cad.disabled = false;
            UI.settingsDisabled(true, rfb);
            klass = "VNC_status_normal";
            break;
        case 'disconnected':
        case 'loaded':
	    html='<form onsubmit="return UI.connect();">';
	    html+='	Password: <input id="VNC_password" type="password"/>';
	    html+='</form>';
	    $D('VNC_passwdField').innerHTML=html;
	    
            cad.disabled = true;
            UI.settingsDisabled(false, rfb);
            klass = "VNC_status_normal";
            break;
        case 'password':
            cad.disabled = true;
            UI.settingsDisabled(true, rfb);
            klass = "VNC_status_warn";
            break;
        default:
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

/* updateState: function(rfb, state, oldstate, msg) {
            var link, s, sb, cad, level;
            s = $D('VNC_status');
            sb = $D('VNC_status_bar');
            cad = $D('sendCtrlAltDelButton');
            switch (state) {
                case 'failed':       level = "error";  break;
                case 'fatal':        level = "error";  break;
                case 'normal':       level = "normal"; break;
                case 'disconnected': level = "normal"; break;
                case 'loaded':       level = "normal"; break;
                default:             level = "warn";   break;
            }

            if (state === "normal") { cad.disabled = false; }
            else                    { cad.disabled = true; }

            if (typeof(msg) !== 'undefined') {
                sb.setAttribute("class", "VNC_status_" + level);
                s.innerHTML = msg;
            }
}, */

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
    
    UI.message("resizing...");
    UI.resize();
    
    return false;
},

disconnect: function() {
    UI.closeSettingsMenu();
    UI.rfb.disconnect();
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
    $D('VNC_clipboard_text').value = "";
    UI.rfb.clipboardPasteFrom("");
},

clipSend: function() {
    var text = $D('VNC_clipboard_text').value;
    Util.Debug(">> UI.clipSend: " + text.substr(0,40) + "...");
    UI.rfb.clipboardPasteFrom(text);
    Util.Debug("<< UI.clipSend");
},


        
message: function(str) {
            console.log(str);
            var cell = $D('messages');
            cell.innerHTML += msg_cnt + ": " + str + newline;
            cell.scrollTop = cell.scrollHeight;
            msg_cnt++;
        },
        
/* Test graphics (repeating pattern). */
drawArea: function(x, y, w, h) {
            this.message("draw "+x+","+y+" ("+w+","+h+")");
            var imgData = ctx.createImageData(w, h),
                data = imgData.data, pixel, realX, realY;

            for (var i = 0; i < w; i++) {
                realX = viewport.x + x + i;
                for (var j = 0; j < h; j++) {
                    realY = viewport.y + y + j;
                    pixel = (j * w * 4 + i * 4);
                    data[pixel + 0] = ((realX * realY) / 13) % 256;
                    data[pixel + 1] = ((realX * realY) + 392) % 256;
                    data[pixel + 2] = ((realX + realY) + 256) % 256;
                    data[pixel + 3] = 255;
                }
            }
            //message("i: " + i + ", j: " + j + ", pixel: " + pixel);
            ctx.putImageData(imgData, x, y);
        },
        
resize: function() {
            var v = viewport,
                cw = $D('vnc').offsetWidth,
                ch = $D('vnc').offsetHeight;
                //cw = target.offsetWidth,
                //ch = target.offsetHeight;
                
            this.message("container: " + cw + "," + ch);
            
            if (cw > fb_width) {
                cw = fb_width;
            }
            if (ch > fb_height) {
                ch = fb_height;
            }
            if ((cw !== v.w) || (ch !== v.h)) {
                v.w = cw;
                v.h = ch;
                this.message("new viewport: " + v.w + "," + v.h);
                //$D('VNC_canvas').resize(v.w, v.h);
                //UI.canvas.resize(v.w, v.h);
                UI.rfb.get_display().resize(v.w, v.h);
                //UI.rfb.get_display().get_context().updateState
                //UI.updateState("loaded");
                //UI.drawArea(0, 0, v.w, v.h);
            }
            this.message("framebuffer: "+fb_width+","+fb_height+"; viewport: "+v.w+","+v.h);
        }
};
