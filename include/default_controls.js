/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2010 Joel Martin
 * Licensed under LGPL-3 (see LICENSE.LGPL-3)
 *
 * See README.md for usage and integration instructions.
 */
"use strict";
/*global $, RFB, Canvas, VNC_uri_prefix, Element, Fx */

// Load mootools
(function () {
    var pre = (typeof VNC_uri_prefix !== "undefined") ?
                           VNC_uri_prefix : "include/";
    document.write("<script src='" + pre + "mootools.js'><\/script>");
}());


var DefaultControls = {

load: function(target) {
    var url, html;

    /* Handle state updates */
    RFB.setUpdateState(DefaultControls.updateState);
    RFB.setClipboardReceive(DefaultControls.clipReceive);

    /* Populate the 'target' DOM element with default controls */
    if (!target) { target = 'vnc'; }

    html = "";
    html += '<div id="VNC_controls">';
    html += '  <ul>';
    html += '    <li>Host: <input id="VNC_host"></li>';
    html += '    <li>Port: <input id="VNC_port"></li>';
    html += '    <li>Password: <input id="VNC_password"';
    html += '        type="password"></li>';
    html += '    <li>Encrypt: <input id="VNC_encrypt"';
    html += '        type="checkbox"></li>';
    html += '    <li>True Color: <input id="VNC_true_color"';
    html += '        type="checkbox" checked></li>';
    html += '    <li><input id="VNC_connect_button" type="button"';
    html += '        value="Loading" disabled></li>';
    html += '  </ul>';
    html += '</div>';
    html += '<div id="VNC_screen">';
    html += '  <div id="VNC_status_bar" class="VNC_status_bar" style="margin-top: 0px;">';
    html += '    <table border=0 width=100%><tr>';
    html += '      <td><div id="VNC_status">Loading</div></td>';
    html += '      <td width=10%><div id="VNC_buttons">';
    html += '        <input type=button value="Send CtrlAltDel"';
    html += '          id="sendCtrlAltDelButton"';
    html += '          onclick="DefaultControls.sendCtrlAltDel();"></div></td>';
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
    html += '      onclick="DefaultControls.clipClear();">';
    html += '  <br>';
    html += '  <textarea id="VNC_clipboard_text" cols=80 rows=5';
    html += '    onfocus="DefaultControls.clipFocus();"';
    html += '    onblur="DefaultControls.clipBlur();"';
    html += '    onchange="DefaultControls.clipSend();"></textarea>';
    html += '</div>';
    $(target).innerHTML = html;

    /* Populate the controls if defaults are provided in the URL */
    url = document.location.href;
    $('VNC_host').value = (url.match(/host=([A-Za-z0-9.\-]*)/) ||
            ['',''])[1];
    $('VNC_port').value = (url.match(/port=([0-9]*)/) ||
            ['',''])[1];
    $('VNC_password').value = (url.match(/password=([^&#]*)/) ||
            ['',''])[1];
    $('VNC_encrypt').checked = (url.match(/encrypt=([A-Za-z0-9]*)/) ||
            ['',''])[1];

    $('VNC_screen').onmousemove = function () {
            // Unfocus clipboard when over the VNC area
            if (! Canvas.focused) {
                $('VNC_clipboard_text').blur();
            }
        };
},

sendCtrlAltDel: function() {
    RFB.sendCtrlAltDel();
},

updateState: function(state, msg) {
    var s, c, klass;
    s = $('VNC_status');
    sb = $('VNC_status_bar');
    c = $('VNC_connect_button');
    cad = $('sendCtrlAltDelButton');
    switch (state) {
        case 'failed':
            c.disabled = true;
            cad.disabled = true;
            klass = "VNC_status_error";
            break;
        case 'normal':
            c.value = "Disconnect";
            c.onclick = DefaultControls.disconnect;
            c.disabled = false;
            cad.disabled = false;
            klass = "VNC_status_normal";
            break;
        case 'disconnected':
            c.value = "Connect";
            c.onclick = DefaultControls.connect;

            c.disabled = false;
            cad.disabled = true;
            klass = "VNC_status_normal";
            break;
        default:
            c.disabled = true;
            cad.disabled = true;
            klass = "VNC_status_warn";
            break;
    }

    if (typeof(msg) !== 'undefined') {
        s.setAttribute("class", klass);
        sb.setAttribute("class", klass);
        s.innerHTML = msg;
    }

},

connect: function() {
    var host, port, password, encrypt, true_color;
    host = $('VNC_host').value;
    port = $('VNC_port').value;
    password = $('VNC_password').value;
    encrypt = $('VNC_encrypt').checked;
    true_color = $('VNC_true_color').checked;
    if ((!host) || (!port)) {
        throw("Must set host and port");
    }

    RFB.connect(host, port, password, encrypt, true_color);
},

disconnect: function() {
    RFB.disconnect();
},

clipFocus: function() {
    Canvas.focused = false;
},

clipBlur: function() {
    Canvas.focused = true;
},

clipClear: function() {
    $('VNC_clipboard_text').value = "";
    RFB.clipboardPasteFrom("");
},

clipReceive: function(text) {
    Util.Debug(">> DefaultControls.clipReceive: " + text.substr(0,40) + "...");
    $('VNC_clipboard_text').value = text;
    Util.Debug("<< DefaultControls.clipReceive");
},

clipSend: function() {
    var text = $('VNC_clipboard_text').value;
    Util.Debug(">> DefaultControls.clipSend: " + text.substr(0,40) + "...");
    RFB.clipboardPasteFrom(text);
    Util.Debug("<< DefaultControls.clipSend");
}

};
