/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2010 Joel Martin
 * Licensed under LGPL-3 (see LICENSE.LGPL-3)
 *
 * See README.md for usage and integration instructions.
 */

"use strict";
/*jslint bitwise: false, white: false */
/*global window, document, navigator, ActiveXObject*/

// Globals defined here
var Util = {}, $;

// Debug routines
if (typeof window.console === "undefined") {
    window.console = {
        'log': function(m) {},
        'warn': function(m) {},
        'error': function(m) {}};
}
if (/__debug__$/i.test(document.location.href)) {
    if (typeof window.opera !== "undefined") {
        window.console.log = window.opera.postError;
        window.console.warn = window.opera.postError;
        window.console.error = window.opera.postError;
    }
} else {
    /*
    // non-debug mode, an empty function  
    window.console.log = function (message) {}; 
    window.console.warn = function (message) {}; 
    window.console.error = function (message) {}; 
    */
}

// Simple DOM selector by ID
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

Array.prototype.shift8 = function () {
    return this.shift();
};
Array.prototype.push8 = function (num) {
    this.push(num & 0xFF);
};

Array.prototype.shift16 = function () {
    return (this.shift() << 8) +
           (this.shift()     );
};
Array.prototype.push16 = function (num) {
    this.push((num >> 8) & 0xFF,
              (num     ) & 0xFF  );
};


Array.prototype.shift32 = function () {
    return (this.shift() << 24) +
           (this.shift() << 16) +
           (this.shift() <<  8) +
           (this.shift()      );
};
Array.prototype.get32 = function (off) {
    return (this[off    ] << 24) +
           (this[off + 1] << 16) +
           (this[off + 2] <<  8) +
           (this[off + 3]      );
};
Array.prototype.push32 = function (num) {
    this.push((num >> 24) & 0xFF,
              (num >> 16) & 0xFF,
              (num >>  8) & 0xFF,
              (num      ) & 0xFF  );
};

Array.prototype.shiftStr = function (len) {
    var arr = this.splice(0, len);
    return arr.map(function (num) {
            return String.fromCharCode(num); } ).join('');
};
Array.prototype.pushStr = function (str) {
    var i, n = str.length;
    for (i=0; i < n; i+=1) {
        this.push(str.charCodeAt(i));
    }
};

Array.prototype.shiftBytes = function (len) {
    return this.splice(0, len);
};

/* 
 * ------------------------------------------------------
 * Namespaced in Util
 * ------------------------------------------------------
 */

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
Util.getEventPosition = function (e, obj) {
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
    return {'x': docX - pos.x, 'y': docY - pos.y};
};


// Event registration. Based on: http://www.scottandrew.com/weblog/articles/cbs-events
Util.addEvent = function (obj, evType, fn){
    if (obj.addEventListener){
        obj.addEventListener(evType, fn, false); 
        return true;
    } else if (obj.attachEvent){
        var r = obj.attachEvent("on"+evType, fn);
        return r;
    } else {
        throw("Handler could not be attached");
    }
};

Util.removeEvent = function(obj, evType, fn){
    if (obj.removeEventListener){
        obj.removeEventListener(evType, fn, false);
        return true;
    } else if (obj.detachEvent){
        var r = obj.detachEvent("on"+evType, fn);
        return r;
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

