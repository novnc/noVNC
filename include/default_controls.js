DefaultControls = {

load: function(target) {
    var url;

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
    html += '  <div id="VNC_status">Loading</div>';
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
},

updateState: function(state, msg) {
    var s, c, klass;
    s = $('VNC_status');
    c = $('VNC_connect_button');
    switch (state) {
        case 'failed':
            c.disabled = true;
            klass = "VNC_status_error";
            break;
        case 'normal':
            c.value = "Disconnect";
            c.onclick = DefaultControls.disconnect;
            c.disabled = false;
            klass = "VNC_status_normal";
            break;
        case 'disconnected':
            c.value = "Connect";
            c.onclick = DefaultControls.connect;

            c.disabled = false;
            klass = "VNC_status_normal";
            break;
        default:
            c.disabled = true;
            klass = "VNC_status_warn";
            break;
    }

    if (typeof(msg) !== 'undefined') {
        s.setAttribute("class", klass);
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
        alert("Must set host and port");
        return;
    }

    RFB.connect(host, port, password, encrypt, true_color);
},

disconnect: function() {
    RFB.disconnect();
},

clipFocus: function() {
    RFB.clipboardFocus = true;
},

clipBlur: function() {
    RFB.clipboardFocus = false;
},

clipClear: function() {
    $('VNC_clipboard_text').value = "";
    RFB.clipboardPasteFrom("");
},

clipReceive: function(text) {
    console.log(">> DefaultControls.clipReceive: " + text.substr(0,40) + "...");
    $('VNC_clipboard_text').value = text;
    console.log("<< DefaultControls.clipReceive");
},

clipSend: function() {
    var text = $('VNC_clipboard_text').value;
    console.log(">> DefaultControls.clipSend: " + text.substr(0,40) + "...");
    RFB.clipboardPasteFrom(text);
    console.log("<< DefaultControls.clipSend");
}

}
