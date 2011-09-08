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

var UI = {

settingsOpen : false,
connSettingsOpen : true,
clipboardOpen: false,

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
    UI.initSetting('host', ''); 
    UI.initSetting('port', '');
    UI.initSetting('password', '');
    UI.initSetting('encrypt', false);
    UI.initSetting('true_color', true);
    UI.initSetting('cursor', false);
    UI.initSetting('shared', true); 
    UI.initSetting('connectTimeout', 2);

    UI.rfb = RFB({'target': $D('noVNC_canvas'),
                  'onUpdateState': UI.updateState,
                  'onClipboard': UI.clipReceive});
 
    // Unfocus clipboard when over the VNC area
    //$D('VNC_screen').onmousemove = function () {
    //         var keyboard = UI.rfb.get_keyboard();
    //        if ((! keyboard) || (! keyboard.get_focused())) {
    //            $D('VNC_clipboard_text').blur();
    //         }
    //    };
		
    // Show mouse selector buttons on touch screen devices
    if ('ontouchstart' in document.documentElement) {
        $D('noVNC_mobile_buttons').style.display = "inline";
        UI.setMouseButton();
		window.scrollTo(0, 1); 
    }

	//iOS Safari does not support CSS position:fixed. 
	//This detects iOS devices and enables javascript workaround.  
	if((navigator.userAgent.match(/iPhone/i)) 
	||(navigator.userAgent.match(/iPod/i)) 
	|| (navigator.userAgent.match(/iPad/i))) {	
		UI.setOnscroll();
		UI.setResize(); 
	}
	
	$D('noVNC_host').focus();
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
	if(name === 'host')
	{
		
		
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
		if(value === null)
		{
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
            $D('noVNC_cursor').disabled = true;
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
	if(UI.clipboardOpen == true)
	{	
		UI.showClipboard(); 
	} 
	//Close connection settings if open
	if(UI.connSettingsOpen == true) {
		UI.connectPanelbutton();
	}
	$D('noVNC_Settings').style.display = "block";
    UI.settingsOpen = true;
},

// Close menu (without applying settings)
closeSettingsMenu: function() {
    $D('noVNC_Settings').style.display = "none";
    UI.settingsOpen = false;
},

// Disable/enable controls depending on connection state
settingsDisabled: function(disabled, rfb) {
    //Util.Debug(">> settingsDisabled");
    $D('noVNC_encrypt').disabled = disabled;
    $D('noVNC_true_color').disabled = disabled;
    if (rfb && rfb.get_display() && rfb.get_display().get_cursor_uri()) {
        $D('noVNC_cursor').disabled = disabled;
    } else {
        UI.updateSetting('cursor', false);
        $D('noVNC_cursor').disabled = true;
    }
    $D('noVNC_shared').disabled = disabled;
    $D('noVNC_connectTimeout').disabled = disabled;
    //Util.Debug("<< settingsDisabled");
},

// Save/apply settings when 'Apply' button is pressed
settingsApply: function() {
    //Util.Debug(">> settingsApply");
    UI.saveSetting('encrypt');
    UI.saveSetting('true_color');
    if (UI.rfb.get_display().get_cursor_uri()) {
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
    UI.rfb.sendPassword($D('noVNC_password').value);
	//Reset connect button.
	$D('noVNC_connect_button').value = "Connect";
    $D('noVNC_connect_button').onclick = UI.Connect;
	//Hide connection panel.
	UI.connectPanelbutton();
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
        button = $D('noVNC_mouse_button' + blist[b]);
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
    var s, sb, c, cad, klass;
    s = $D('noVNC_status');
    sb = $D('noVNC_status_bar');
    c = $D('connectPanelbutton');
    cad = $D('sendCtrlAltDelButton');
    switch (state) {
        case 'failed':
        case 'fatal':
            c.disabled = true;
            cad.style.display = "none";
            UI.settingsDisabled(true, rfb);
            klass = "noVNC_status_error";
            break;
        case 'normal':	
            c.value = "Disconnect";
            c.onclick = UI.disconnect;
            c.disabled = false;
            cad.style.display = "block";
            UI.settingsDisabled(true, rfb);
            klass = "noVNC_status_normal";
            break;
        case 'disconnected':
			$D('noVNC_defaultScreen').style.display = "block";
			c.value = "Connection";
            c.onclick = UI.connectPanelbutton;
        case 'loaded':
            c.value = "Connection";
            c.onclick = UI.connectPanelbutton;
            c.disabled = false;
            cad.style.display = "none";
            UI.settingsDisabled(false, rfb);
            klass = "noVNC_status_normal";
            break;
        case 'password':
			UI.connectPanelbutton();

            $D('noVNC_connect_button').value = "Send Password";
            $D('noVNC_connect_button').onclick = UI.setPassword;
			$D('noVNC_password').focus();
			
            c.disabled = false;
            cad.style.display = "none";
            UI.settingsDisabled(true, rfb);
            klass = "noVNC_status_warn";
            break;
        default:
            c.disabled = true;
            cad.style.display = "none";
            UI.settingsDisabled(true, rfb);
            klass = "noVNC_status_warn";
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
    $D('noVNC_clipboard_text').value = text;
    Util.Debug("<< UI.clipReceive");
},


connect: function() {
    var host, port, password;

    UI.closeSettingsMenu();
	UI.connectPanelbutton();

    host = $D('noVNC_host').value;
    port = $D('noVNC_port').value;
    password = $D('noVNC_password').value;
    if ((!host) || (!port)) {
        throw("Must set host and port");
    }

    UI.rfb.set_encrypt(UI.getSetting('encrypt'));
    UI.rfb.set_true_color(UI.getSetting('true_color'));
    UI.rfb.set_local_cursor(UI.getSetting('cursor'));
    UI.rfb.set_shared(UI.getSetting('shared'));
    UI.rfb.set_connectTimeout(UI.getSetting('connectTimeout'));

    UI.rfb.connect(host, port, password);
	//Close dialog.
	setTimeout("setBarPosition()",100);
	$D('noVNC_defaultScreen').style.display = "none";
},

disconnect: function() {
    UI.closeSettingsMenu();
    UI.rfb.disconnect();
	
	$D('noVNC_defaultScreen').style.display = "block";
	UI.connSettingsOpen = false;
	UI.connectPanelbutton();
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

showClipboard: function() {
	//Close settings if open
	if(UI.settingsOpen == true) {
		UI.closeSettingsMenu();
	}
	//Close connection settings if open
	if(UI.connSettingsOpen == true) {
		UI.connectPanelbutton();
	}
	//Toggle Connection Panel
	if(UI.clipboardOpen == true)
	{	$D('noVNC_clipboard').style.display = "none";
		UI.clipboardOpen = false;
	} else {
		$D('noVNC_clipboard').style.display = "block";
		UI.clipboardOpen = true;
	}
},


showKeyboard: function() {
	//Get Current Scroll Position
	var scrollx = 
	(document.all)?document.body.scrollLeft:window.pageXOffset;   
	var scrolly = 
	(document.all)?document.body.scrollTop:window.pageYOffset; 

	//Stop browser zooming on textbox.
	UI.zoomDisable();
			$D('keyboardinput').focus();
			scroll(scrollx,scrolly);
	//Renable user zoom.
	UI.zoomEnable();
},

zoomDisable: function() {
  //Change viewport meta data to disable zooming.
  UI.changeViewportMeta("user-scalable=0");
},

zoomEnable: function(){
  //Change viewport meta data to enable user zooming.
  UI.changeViewportMeta("user-scalable=1");
},

changeViewportMeta: function (newattributes) {

	// First, get the array of meta-tag elements
    var metatags = document.getElementsByTagName("meta");

    // Update only the Viewport meta tag
    for (var cnt = 0; cnt < metatags.length; cnt++)
    {
	
        var name = metatags[cnt].getAttribute("name");
        var content = metatags[cnt].getAttribute("content");

        // Update the Viewport meta tag
        if (metatags[cnt].getAttribute("name") == "viewport")
              metatags[cnt].setAttribute("content", newattributes);
    }
},

//iOS < Version 5 does not support position fixed. Javascript workaround:
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
  $D('noVNC_mobile_buttons_right').style.right = 0 + 'px'; 
  
   var vncwidth = $('#noVNC_screen').width();
   $D('noVNC-control-bar').style.width = vncwidth + 'px';
},

connectPanelbutton: function() {
	//Close connection settings if open
	if(UI.settingsOpen == true) {
		UI.closeSettingsMenu();
	}
	if(UI.clipboardOpen == true)
	{	
		UI.showClipboard(); 
	} 

	//Toggle Connection Panel
	if(UI.connSettingsOpen == true)
	{	
		$D('noVNC_controls').style.display = "none";
		UI.connSettingsOpen = false;
	} else {
		$D('noVNC_controls').style.display = "block";
		UI.connSettingsOpen = true;
		$D('noVNC_host').focus();
	}
}

};




