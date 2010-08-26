/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2010 Joel Martin
 * Licensed under LGPL-3 (see LICENSE.LGPL-3)
 *
 * See README.md for usage and integration instructions.
 */

"use strict";
/*jslint bitwise: false, white: false */
/*global window, console, document, navigator, ActiveXObject*/

// Globals defined here
var Util = {}, $;


/*
 * Simple DOM selector by ID
 */
if (!window.$) {
    $ = function (id) {
        if (document.getElementById) {
            return document.getElementById(id);
        } else if (document.all) {
            return document.all[id];
        } else if (document.layers) {
            return document.layers[id];
        }
        return undefined;
    };
}

/*
 * Make arrays quack
 */

Array.prototype.push8 = function (num) {
    this.push(num & 0xFF);
};

Array.prototype.push16 = function (num) {
    this.push((num >> 8) & 0xFF,
              (num     ) & 0xFF  );
};
Array.prototype.push32 = function (num) {
    this.push((num >> 24) & 0xFF,
              (num >> 16) & 0xFF,
              (num >>  8) & 0xFF,
              (num      ) & 0xFF  );
};

/* 
 * ------------------------------------------------------
 * Namespaced in Util
 * ------------------------------------------------------
 */

/*
 * Logging/debug routines
 */

Util.init_logging = function (level) {
    if (typeof window.console === "undefined") {
        if (typeof window.opera !== "undefined") {
            window.console = {
                'log'  : window.opera.postError,
                'warn' : window.opera.postError,
                'error': window.opera.postError };
        } else {
            window.console = {
                'log'  : function(m) {},
                'warn' : function(m) {},
                'error': function(m) {}};
        }
    }

    Util.Debug = Util.Info = Util.Warn = Util.Error = function (msg) {};
    switch (level) {
        case 'debug': Util.Debug = function (msg) { console.log(msg); };
        case 'info':  Util.Info  = function (msg) { console.log(msg); };
        case 'warn':  Util.Warn  = function (msg) { console.warn(msg); };
        case 'error': Util.Error = function (msg) { console.error(msg); };
        case 'none':
            break;
        default:
            throw("invalid logging type '" + level + "'");
    }
};
// Initialize logging level
Util.init_logging( (document.location.href.match(
                    /logging=([A-Za-z0-9\._\-]*)/) ||
                    ['', 'warn'])[1] );

Util.dirObj = function (obj, depth, parent) {
    var i, msg = "", val = "";
    if (! depth) { depth=2; }
    if (! parent) { parent= ""; }

    // Print the properties of the passed-in object 
    for (i in obj) {
        if ((depth > 1) && (typeof obj[i] === "object")) { 
            // Recurse attributes that are objects
            msg += Util.dirObj(obj[i], depth-1, parent + "." + i);
        } else {
            //val = new String(obj[i]).replace("\n", " ");
            val = obj[i].toString().replace("\n", " ");
            if (val.length > 30) {
                val = val.substr(0,30) + "...";
            } 
            msg += parent + "." + i + ": " + val + "\n";
        }
    }
    return msg;
};

// Read a query string variable
Util.getQueryVar = function(name, defVal) {
    var re = new RegExp('[?][^#]*' + name + '=([^&#]*)');
    if (typeof defVal === 'undefined') { defVal = null; }
    return (document.location.href.match(re) || ['',defVal])[1];
};

// Set defaults for Crockford style function namespaces
Util.conf_default = function(cfg, api, v, val, force_bool) {
    if (typeof cfg[v] === 'undefined') {
        cfg[v] = val;
    }
    // Default getter
    if (typeof api['get_' + v] === 'undefined') {
        api['get_' + v] = function () {
                return cfg[v];
            };
    }
    // Default setter
    if (typeof api['set_' + v] === 'undefined') {
        api['set_' + v] = function (val) {
                if (force_bool) {
                    if ((!val) || (val in {'0':1, 'no':1, 'false':1})) {
                        val = false;
                    } else {
                        val = true;
                    }
                }
                cfg[v] = val;
            };
    }
};



/*
 * Cross-browser routines
 */

// Get DOM element position on page
Util.getPosition = function (obj) {
    var x = 0, y = 0;
    if (obj.offsetParent) {
        do {
            x += obj.offsetLeft;
            y += obj.offsetTop;
            obj = obj.offsetParent;
        } while (obj);
    }
    return {'x': x, 'y': y};
};

// Get mouse event position in DOM element
Util.getEventPosition = function (e, obj, scale) {
    var evt, docX, docY, pos;
    //if (!e) evt = window.event;
    evt = (e ? e : window.event);
    if (evt.pageX || evt.pageY) {
        docX = evt.pageX;
        docY = evt.pageY;
    } else if (evt.clientX || evt.clientY) {
        docX = evt.clientX + document.body.scrollLeft +
            document.documentElement.scrollLeft;
        docY = evt.clientY + document.body.scrollTop +
            document.documentElement.scrollTop;
    }
    pos = Util.getPosition(obj);
    if (typeof scale === "undefined") {
        scale = 1;
    }
    return {'x': (docX - pos.x) / scale, 'y': (docY - pos.y) / scale};
};


// Event registration. Based on: http://www.scottandrew.com/weblog/articles/cbs-events
Util.addEvent = function (obj, evType, fn){
    if (obj.attachEvent){
        var r = obj.attachEvent("on"+evType, fn);
        return r;
    } else if (obj.addEventListener){
        obj.addEventListener(evType, fn, false); 
        return true;
    } else {
        throw("Handler could not be attached");
    }
};

Util.removeEvent = function(obj, evType, fn){
    if (obj.detachEvent){
        var r = obj.detachEvent("on"+evType, fn);
        return r;
    } else if (obj.removeEventListener){
        obj.removeEventListener(evType, fn, false);
        return true;
    } else {
        throw("Handler could not be removed");
    }
};

Util.stopEvent = function(e) {
    if (e.stopPropagation) { e.stopPropagation(); }
    else                   { e.cancelBubble = true; }

    if (e.preventDefault)  { e.preventDefault(); }
    else                   { e.returnValue = false; }
};


// Set browser engine versions. Based on mootools.
Util.Features = {xpath: !!(document.evaluate), air: !!(window.runtime), query: !!(document.querySelector)};

Util.Engine = {
    'presto': (function() {
            return (!window.opera) ? false : ((arguments.callee.caller) ? 960 : ((document.getElementsByClassName) ? 950 : 925)); }()),
    'trident': (function() {
            return (!window.ActiveXObject) ? false : ((window.XMLHttpRequest) ? ((document.querySelectorAll) ? 6 : 5) : 4); }()),
    'webkit': (function() {
            try { return (navigator.taintEnabled) ? false : ((Util.Features.xpath) ? ((Util.Features.query) ? 525 : 420) : 419); } catch (e) { return false; } }()),
    //'webkit': (function() {
    //        return ((typeof navigator.taintEnabled !== "unknown") && navigator.taintEnabled) ? false : ((Util.Features.xpath) ? ((Util.Features.query) ? 525 : 420) : 419); }()),
    'gecko': (function() {
            return (!document.getBoxObjectFor && !window.mozInnerScreenX) ? false : ((document.getElementsByClassName) ? 19 : 18); }())
};

Util.Flash = (function(){
    var v, version;
    try {
        v = navigator.plugins['Shockwave Flash'].description;
    } catch(err1) {
        try {
            v = new ActiveXObject('ShockwaveFlash.ShockwaveFlash').GetVariable('$version');
        } catch(err2) {
            v = '0 r0';
        }
    }
    version = v.match(/\d+/g);
    return {version: parseInt(version[0] || 0 + '.' + version[1], 10) || 0, build: parseInt(version[2], 10) || 0};
}()); 

/*
 * Cookie handling. Dervied from: http://www.quirksmode.org/js/cookies.html
 */

// No days means only for this browser session
Util.createCookie = function(name,value,days) {
    var date, expires;
    if (days) {
        date = new Date();
        date.setTime(date.getTime()+(days*24*60*60*1000));
        expires = "; expires="+date.toGMTString();
    }
    else {
        expires = "";
    }
    document.cookie = name+"="+value+expires+"; path=/";
};

Util.readCookie = function(name, defaultValue) {
    var i, c, nameEQ = name + "=", ca = document.cookie.split(';');
    for(i=0; i < ca.length; i += 1) {
        c = ca[i];
        while (c.charAt(0) === ' ') { c = c.substring(1,c.length); }
        if (c.indexOf(nameEQ) === 0) { return c.substring(nameEQ.length,c.length); }
    }
    return (typeof defaultValue !== 'undefined') ? defaultValue : null;
};

Util.eraseCookie = function(name) {
    Util.createCookie(name,"",-1);
};

/*
 * Alternate stylesheet selection
 */
Util.getStylesheets = function() { var i, links, sheets = [];
    links = document.getElementsByTagName("link");
    for (i = 0; i < links.length; i += 1) {
        if (links[i].title &&
            links[i].rel.toUpperCase().indexOf("STYLESHEET") > -1) {
            sheets.push(links[i]);
        }
    }
    return sheets;
};

// No sheet means try and use value from cookie, null sheet used to
// clear all alternates.
Util.selectStylesheet = function(sheet) {
    var i, link, sheets = Util.getStylesheets();
    if (typeof sheet === 'undefined') {
        sheet = 'default';
    }
    for (i=0; i < sheets.length; i += 1) {
        link = sheets[i];
        if (link.title === sheet) {    
            Util.Debug("Using stylesheet " + sheet);
            link.disabled = false;
        } else {
            //Util.Debug("Skipping stylesheet " + link.title);
            link.disabled = true;
        }
    }
    return sheet;
};
