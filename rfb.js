/******/ (function(modules) { // webpackBootstrap
/******/ 	// The module cache
/******/ 	var installedModules = {};

/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {

/******/ 		// Check if module is in cache
/******/ 		if(installedModules[moduleId])
/******/ 			return installedModules[moduleId].exports;

/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = installedModules[moduleId] = {
/******/ 			exports: {},
/******/ 			id: moduleId,
/******/ 			loaded: false
/******/ 		};

/******/ 		// Execute the module function
/******/ 		modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);

/******/ 		// Flag the module as loaded
/******/ 		module.loaded = true;

/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}


/******/ 	// expose the modules object (__webpack_modules__)
/******/ 	__webpack_require__.m = modules;

/******/ 	// expose the module cache
/******/ 	__webpack_require__.c = installedModules;

/******/ 	// __webpack_public_path__
/******/ 	__webpack_require__.p = "";

/******/ 	// Load entry module and return exports
/******/ 	return __webpack_require__(0);
/******/ })
/************************************************************************/
/******/ ([
/* 0 */
/***/ function(module, exports, __webpack_require__) {

	/*
	 * noVNC: HTML5 VNC client
	 * Copyright (C) 2012 Joel Martin
	 * Copyright (C) 2013 Samuel Mannehed for Cendio AB
	 * Licensed under MPL 2.0 (see LICENSE.txt)
	 *
	 * See README.md for usage and integration instructions.
	 *
	 * TIGHT decoder portion:
	 * (c) 2012 Michael Tinglof, Joe Balaz, Les Piech (Mercuri.ca)
	 */

	/*jslint white: false, browser: true */
	/*global window, Util, Display, Keyboard, Mouse, Websock, Websock_native, Base64, DES */

	var Util = __webpack_require__(1);
	var Display = __webpack_require__(2);
	var Keyboard = __webpack_require__(3).Keyboard;
	var Mouse = __webpack_require__(3).Mouse;
	var Websock = __webpack_require__(23).Websock;
	var Websock_native = __webpack_require__(23).Websock_native;
	var Base64 = __webpack_require__(24);
	var DES = __webpack_require__(25);

	var RFB;

	(function () {
	    "use strict";
	    RFB = function (defaults) {
	        if (!defaults) {
	            defaults = {};
	        }

	        this._rfb_host = '';
	        this._rfb_port = 5900;
	        this._rfb_password = '';
	        this._rfb_path = '';

	        this._rfb_state = 'disconnected';
	        this._rfb_version = 0;
	        this._rfb_max_version = 3.8;
	        this._rfb_auth_scheme = '';

	        this._rfb_tightvnc = false;
	        this._rfb_xvp_ver = 0;

	        // In preference order
	        this._encodings = [
	            ['COPYRECT',            0x01 ],
	            ['TIGHT',               0x07 ],
	            ['TIGHT_PNG',           -260 ],
	            ['HEXTILE',             0x05 ],
	            ['RRE',                 0x02 ],
	            ['RAW',                 0x00 ],
	            ['DesktopSize',         -223 ],
	            ['Cursor',              -239 ],

	            // Psuedo-encoding settings
	            //['JPEG_quality_lo',    -32 ],
	            ['JPEG_quality_med',     -26 ],
	            //['JPEG_quality_hi',    -23 ],
	            //['compress_lo',       -255 ],
	            ['compress_hi',         -247 ],
	            ['last_rect',           -224 ],
	            ['xvp',                 -309 ],
	            ['ExtendedDesktopSize', -308 ]
	        ];

	        this._encHandlers = {};
	        this._encNames = {};
	        this._encStats = {};

	        this._sock = null;              // Websock object
	        this._display = null;           // Display object
	        this._keyboard = null;          // Keyboard input handler object
	        this._mouse = null;             // Mouse input handler object
	        this._sendTimer = null;         // Send Queue check timer
	        this._disconnTimer = null;      // disconnection timer
	        this._msgTimer = null;          // queued handle_msg timer

	        // Frame buffer update state
	        this._FBU = {
	            rects: 0,
	            subrects: 0,            // RRE
	            lines: 0,               // RAW
	            tiles: 0,               // HEXTILE
	            bytes: 0,
	            x: 0,
	            y: 0,
	            width: 0,
	            height: 0,
	            encoding: 0,
	            subencoding: -1,
	            background: null,
	            zlib: []                // TIGHT zlib streams
	        };

	        this._fb_Bpp = 4;
	        this._fb_depth = 3;
	        this._fb_width = 0;
	        this._fb_height = 0;
	        this._fb_name = "";

	        this._destBuff = null;
	        this._paletteBuff = new Uint8Array(1024);  // 256 * 4 (max palette size * max bytes-per-pixel)

	        this._rre_chunk_sz = 100;

	        this._timing = {
	            last_fbu: 0,
	            fbu_total: 0,
	            fbu_total_cnt: 0,
	            full_fbu_total: 0,
	            full_fbu_cnt: 0,

	            fbu_rt_start: 0,
	            fbu_rt_total: 0,
	            fbu_rt_cnt: 0,
	            pixels: 0
	        };

	        this._supportsSetDesktopSize = false;
	        this._screen_id = 0;
	        this._screen_flags = 0;

	        // Mouse state
	        this._mouse_buttonMask = 0;
	        this._mouse_arr = [];
	        this._viewportDragging = false;
	        this._viewportDragPos = {};
	        this._viewportHasMoved = false;

	        // set the default value on user-facing properties
	        Util.set_defaults(this, defaults, {
	            'target': 'null',                       // VNC display rendering Canvas object
	            'focusContainer': document,             // DOM element that captures keyboard input
	            'encrypt': false,                       // Use TLS/SSL/wss encryption
	            'true_color': true,                     // Request true color pixel data
	            'local_cursor': false,                  // Request locally rendered cursor
	            'shared': true,                         // Request shared mode
	            'view_only': false,                     // Disable client mouse/keyboard
	            'xvp_password_sep': '@',                // Separator for XVP password fields
	            'disconnectTimeout': 3,                 // Time (s) to wait for disconnection
	            'wsProtocols': ['binary'],              // Protocols to use in the WebSocket connection
	            'repeaterID': '',                       // [UltraVNC] RepeaterID to connect to
	            'viewportDrag': false,                  // Move the viewport on mouse drags

	            // Callback functions
	            'onUpdateState': function () { },       // onUpdateState(rfb, state, oldstate, statusMsg): state update/change
	            'onPasswordRequired': function () { },  // onPasswordRequired(rfb): VNC password is required
	            'onClipboard': function () { },         // onClipboard(rfb, text): RFB clipboard contents received
	            'onBell': function () { },              // onBell(rfb): RFB Bell message received
	            'onFBUReceive': function () { },        // onFBUReceive(rfb, fbu): RFB FBU received but not yet processed
	            'onFBUComplete': function () { },       // onFBUComplete(rfb, fbu): RFB FBU received and processed
	            'onFBResize': function () { },          // onFBResize(rfb, width, height): frame buffer resized
	            'onDesktopName': function () { },       // onDesktopName(rfb, name): desktop name received
	            'onXvpInit': function () { },           // onXvpInit(version): XVP extensions active for this connection
	        });

	        // main setup
	        Util.Debug(">> RFB.constructor");

	        // populate encHandlers with bound versions
	        Object.keys(RFB.encodingHandlers).forEach(function (encName) {
	            this._encHandlers[encName] = RFB.encodingHandlers[encName].bind(this);
	        }.bind(this));

	        // Create lookup tables based on encoding number
	        for (var i = 0; i < this._encodings.length; i++) {
	            this._encHandlers[this._encodings[i][1]] = this._encHandlers[this._encodings[i][0]];
	            this._encNames[this._encodings[i][1]] = this._encodings[i][0];
	            this._encStats[this._encodings[i][1]] = [0, 0];
	        }

	        // NB: nothing that needs explicit teardown should be done
	        // before this point, since this can throw an exception
	        try {
	            this._display = new Display({target: this._target});
	        } catch (exc) {
	            Util.Error("Display exception: " + exc);
	            throw exc;
	        }

	        this._keyboard = new Keyboard({target: this._focusContainer,
	                                       onKeyPress: this._handleKeyPress.bind(this)});

	        this._mouse = new Mouse({target: this._target,
	                                 onMouseButton: this._handleMouseButton.bind(this),
	                                 onMouseMove: this._handleMouseMove.bind(this),
	                                 notify: this._keyboard.sync.bind(this._keyboard)});

	        this._sock = new Websock();
	        this._sock.on('message', this._handle_message.bind(this));
	        this._sock.on('open', function () {
	            if (this._rfb_state === 'connect') {
	                this._updateState('ProtocolVersion', "Starting VNC handshake");
	            } else {
	                this._fail("Got unexpected WebSocket connection");
	            }
	        }.bind(this));
	        this._sock.on('close', function (e) {
	            Util.Warn("WebSocket on-close event");
	            var msg = "";
	            if (e.code) {
	                msg = " (code: " + e.code;
	                if (e.reason) {
	                    msg += ", reason: " + e.reason;
	                }
	                msg += ")";
	            }
	            if (this._rfb_state === 'disconnect') {
	                this._updateState('disconnected', 'VNC disconnected' + msg);
	            } else if (this._rfb_state === 'ProtocolVersion') {
	                this._fail('Failed to connect to server' + msg);
	            } else if (this._rfb_state in {'failed': 1, 'disconnected': 1}) {
	                Util.Error("Received onclose while disconnected" + msg);
	            } else {
	                this._fail("Server disconnected" + msg);
	            }
	            this._sock.off('close');
	        }.bind(this));
	        this._sock.on('error', function (e) {
	            Util.Warn("WebSocket on-error event");
	        });

	        this._init_vars();

	        var rmode = this._display.get_render_mode();
	        if (Websock_native) {
	            Util.Info("Using native WebSockets");
	            this._updateState('loaded', 'noVNC ready: native WebSockets, ' + rmode);
	        } else {
	            this._cleanupSocket('fatal');
	            throw new Error("WebSocket support is required to use noVNC");
	        }

	        Util.Debug("<< RFB.constructor");
	    };

	    RFB.prototype = {
	        // Public methods
	        connect: function (host, port, password, path) {
	            this._rfb_host = host;
	            this._rfb_port = port;
	            this._rfb_password = (password !== undefined) ? password : "";
	            this._rfb_path = (path !== undefined) ? path : "";

	            if (!this._rfb_host || !this._rfb_port) {
	                return this._fail("Must set host and port");
	            }

	            this._updateState('connect');
	        },

	        disconnect: function () {
	            this._updateState('disconnect', 'Disconnecting');
	            this._sock.off('error');
	            this._sock.off('message');
	            this._sock.off('open');
	        },

	        sendPassword: function (passwd) {
	            this._rfb_password = passwd;
	            this._rfb_state = 'Authentication';
	            setTimeout(this._init_msg.bind(this), 1);
	        },

	        sendCtrlAltDel: function () {
	            if (this._rfb_state !== 'normal' || this._view_only) { return false; }
	            Util.Info("Sending Ctrl-Alt-Del");

	            RFB.messages.keyEvent(this._sock, XK_Control_L, 1);
	            RFB.messages.keyEvent(this._sock, XK_Alt_L, 1);
	            RFB.messages.keyEvent(this._sock, XK_Delete, 1);
	            RFB.messages.keyEvent(this._sock, XK_Delete, 0);
	            RFB.messages.keyEvent(this._sock, XK_Alt_L, 0);
	            RFB.messages.keyEvent(this._sock, XK_Control_L, 0);

	            this._sock.flush();
	        },

	        xvpOp: function (ver, op) {
	            if (this._rfb_xvp_ver < ver) { return false; }
	            Util.Info("Sending XVP operation " + op + " (version " + ver + ")");
	            this._sock.send_string("\xFA\x00" + String.fromCharCode(ver) + String.fromCharCode(op));
	            return true;
	        },

	        xvpShutdown: function () {
	            return this.xvpOp(1, 2);
	        },

	        xvpReboot: function () {
	            return this.xvpOp(1, 3);
	        },

	        xvpReset: function () {
	            return this.xvpOp(1, 4);
	        },

	        // Send a key press. If 'down' is not specified then send a down key
	        // followed by an up key.
	        sendKey: function (code, down) {
	            if (this._rfb_state !== "normal" || this._view_only) { return false; }
	            if (typeof down !== 'undefined') {
	                Util.Info("Sending key code (" + (down ? "down" : "up") + "): " + code);
	                RFB.messages.keyEvent(this._sock, code, down ? 1 : 0);
	            } else {
	                Util.Info("Sending key code (down + up): " + code);
	                RFB.messages.keyEvent(this._sock, code, 1);
	                RFB.messages.keyEvent(this._sock, code, 0);
	            }

	            this._sock.flush();
	        },

	        clipboardPasteFrom: function (text) {
	            if (this._rfb_state !== 'normal') { return; }
	            RFB.messages.clientCutText(this._sock, text);
	            this._sock.flush();
	        },

	        // Requests a change of remote desktop size. This message is an extension
	        // and may only be sent if we have received an ExtendedDesktopSize message
	        requestDesktopSize: function (width, height) {
	            if (this._rfb_state !== "normal") { return; }

	            if (this._supportsSetDesktopSize) {
	                RFB.messages.setDesktopSize(this._sock, width, height,
	                                            this._screen_id, this._screen_flags);
	                this._sock.flush();
	            }
	        },


	        // Private methods

	        _connect: function () {
	            Util.Debug(">> RFB.connect");

	            var uri;
	            if (typeof UsingSocketIO !== 'undefined') {
	                uri = 'http';
	            } else {
	                uri = this._encrypt ? 'wss' : 'ws';
	            }

	            uri += '://' + this._rfb_host + ':' + this._rfb_port + '/' + this._rfb_path;
	            Util.Info("connecting to " + uri);

	            this._sock.open(uri, this._wsProtocols);

	            Util.Debug("<< RFB.connect");
	        },

	        _init_vars: function () {
	            // reset state
	            this._FBU.rects        = 0;
	            this._FBU.subrects     = 0;  // RRE and HEXTILE
	            this._FBU.lines        = 0;  // RAW
	            this._FBU.tiles        = 0;  // HEXTILE
	            this._FBU.zlibs        = []; // TIGHT zlib encoders
	            this._mouse_buttonMask = 0;
	            this._mouse_arr        = [];
	            this._rfb_tightvnc     = false;

	            // Clear the per connection encoding stats
	            var i;
	            for (i = 0; i < this._encodings.length; i++) {
	                this._encStats[this._encodings[i][1]][0] = 0;
	            }

	            for (i = 0; i < 4; i++) {
	                this._FBU.zlibs[i] = new inflator.Inflate();
	            }
	        },

	        _print_stats: function () {
	            Util.Info("Encoding stats for this connection:");
	            var i, s;
	            for (i = 0; i < this._encodings.length; i++) {
	                s = this._encStats[this._encodings[i][1]];
	                if (s[0] + s[1] > 0) {
	                    Util.Info("    " + this._encodings[i][0] + ": " + s[0] + " rects");
	                }
	            }

	            Util.Info("Encoding stats since page load:");
	            for (i = 0; i < this._encodings.length; i++) {
	                s = this._encStats[this._encodings[i][1]];
	                Util.Info("    " + this._encodings[i][0] + ": " + s[1] + " rects");
	            }
	        },

	        _cleanupSocket: function (state) {
	            if (this._sendTimer) {
	                clearInterval(this._sendTimer);
	                this._sendTimer = null;
	            }

	            if (this._msgTimer) {
	                clearInterval(this._msgTimer);
	                this._msgTimer = null;
	            }

	            if (this._display && this._display.get_context()) {
	                this._keyboard.ungrab();
	                this._mouse.ungrab();
	                if (state !== 'connect' && state !== 'loaded') {
	                    this._display.defaultCursor();
	                }
	                if (Util.get_logging() !== 'debug' || state === 'loaded') {
	                    // Show noVNC logo on load and when disconnected, unless in
	                    // debug mode
	                    this._display.clear();
	                }
	            }

	            this._sock.close();
	        },

	        /*
	         * Page states:
	         *   loaded       - page load, equivalent to disconnected
	         *   disconnected - idle state
	         *   connect      - starting to connect (to ProtocolVersion)
	         *   normal       - connected
	         *   disconnect   - starting to disconnect
	         *   failed       - abnormal disconnect
	         *   fatal        - failed to load page, or fatal error
	         *
	         * RFB protocol initialization states:
	         *   ProtocolVersion
	         *   Security
	         *   Authentication
	         *   password     - waiting for password, not part of RFB
	         *   SecurityResult
	         *   ClientInitialization - not triggered by server message
	         *   ServerInitialization (to normal)
	         */
	        _updateState: function (state, statusMsg) {
	            var oldstate = this._rfb_state;

	            if (state === oldstate) {
	                // Already here, ignore
	                Util.Debug("Already in state '" + state + "', ignoring");
	            }

	            /*
	             * These are disconnected states. A previous connect may
	             * asynchronously cause a connection so make sure we are closed.
	             */
	            if (state in {'disconnected': 1, 'loaded': 1, 'connect': 1,
	                          'disconnect': 1, 'failed': 1, 'fatal': 1}) {
	                this._cleanupSocket(state);
	            }

	            if (oldstate === 'fatal') {
	                Util.Error('Fatal error, cannot continue');
	            }

	            var cmsg = typeof(statusMsg) !== 'undefined' ? (" Msg: " + statusMsg) : "";
	            var fullmsg = "New state '" + state + "', was '" + oldstate + "'." + cmsg;
	            if (state === 'failed' || state === 'fatal') {
	                Util.Error(cmsg);
	            } else {
	                Util.Warn(cmsg);
	            }

	            if (oldstate === 'failed' && state === 'disconnected') {
	                // do disconnect action, but stay in failed state
	                this._rfb_state = 'failed';
	            } else {
	                this._rfb_state = state;
	            }

	            if (this._disconnTimer && this._rfb_state !== 'disconnect') {
	                Util.Debug("Clearing disconnect timer");
	                clearTimeout(this._disconnTimer);
	                this._disconnTimer = null;
	                this._sock.off('close');  // make sure we don't get a double event
	            }

	            switch (state) {
	                case 'normal':
	                    if (oldstate === 'disconnected' || oldstate === 'failed') {
	                        Util.Error("Invalid transition from 'disconnected' or 'failed' to 'normal'");
	                    }
	                    break;

	                case 'connect':
	                    this._init_vars();
	                    this._connect();
	                    // WebSocket.onopen transitions to 'ProtocolVersion'
	                    break;

	                case 'disconnect':
	                    this._disconnTimer = setTimeout(function () {
	                        this._fail("Disconnect timeout");
	                    }.bind(this), this._disconnectTimeout * 1000);

	                    this._print_stats();

	                    // WebSocket.onclose transitions to 'disconnected'
	                    break;

	                case 'failed':
	                    if (oldstate === 'disconnected') {
	                        Util.Error("Invalid transition from 'disconnected' to 'failed'");
	                    } else if (oldstate === 'normal') {
	                        Util.Error("Error while connected.");
	                    } else if (oldstate === 'init') {
	                        Util.Error("Error while initializing.");
	                    }

	                    // Make sure we transition to disconnected
	                    setTimeout(function () {
	                        this._updateState('disconnected');
	                    }.bind(this), 50);

	                    break;

	                default:
	                    // No state change action to take
	            }

	            if (oldstate === 'failed' && state === 'disconnected') {
	                this._onUpdateState(this, state, oldstate);
	            } else {
	                this._onUpdateState(this, state, oldstate, statusMsg);
	            }
	        },

	        _fail: function (msg) {
	            this._updateState('failed', msg);
	            return false;
	        },

	        _handle_message: function () {
	            if (this._sock.rQlen() === 0) {
	                Util.Warn("handle_message called on an empty receive queue");
	                return;
	            }

	            switch (this._rfb_state) {
	                case 'disconnected':
	                case 'failed':
	                    Util.Error("Got data while disconnected");
	                    break;
	                case 'normal':
	                    if (this._normal_msg() && this._sock.rQlen() > 0) {
	                        // true means we can continue processing
	                        // Give other events a chance to run
	                        if (this._msgTimer === null) {
	                            Util.Debug("More data to process, creating timer");
	                            this._msgTimer = setTimeout(function () {
	                                this._msgTimer = null;
	                                this._handle_message();
	                            }.bind(this), 10);
	                        } else {
	                            Util.Debug("More data to process, existing timer");
	                        }
	                    }
	                    break;
	                default:
	                    this._init_msg();
	                    break;
	            }
	        },

	        _handleKeyPress: function (keysym, down) {
	            if (this._view_only) { return; } // View only, skip keyboard, events
	            RFB.messages.keyEvent(this._sock, keysym, down);
	            this._sock.flush();
	        },

	        _handleMouseButton: function (x, y, down, bmask) {
	            if (down) {
	                this._mouse_buttonMask |= bmask;
	            } else {
	                this._mouse_buttonMask ^= bmask;
	            }

	            if (this._viewportDrag) {
	                if (down && !this._viewportDragging) {
	                    this._viewportDragging = true;
	                    this._viewportDragPos = {'x': x, 'y': y};

	                    // Skip sending mouse events
	                    return;
	                } else {
	                    this._viewportDragging = false;

	                    // If the viewport didn't actually move, then treat as a mouse click event
	                    // Send the button down event here, as the button up event is sent at the end of this function
	                    if (!this._viewportHasMoved && !this._view_only) {
	                        RFB.messages.pointerEvent(this._sock, this._display.absX(x), this._display.absY(y), bmask);
	                    }
	                    this._viewportHasMoved = false;
	                }
	            }

	            if (this._view_only) { return; } // View only, skip mouse events

	            if (this._rfb_state !== "normal") { return; }
	            RFB.messages.pointerEvent(this._sock, this._display.absX(x), this._display.absY(y), this._mouse_buttonMask);
	        },

	        _handleMouseMove: function (x, y) {
	            if (this._viewportDragging) {
	                var deltaX = this._viewportDragPos.x - x;
	                var deltaY = this._viewportDragPos.y - y;

	                // The goal is to trigger on a certain physical width, the
	                // devicePixelRatio brings us a bit closer but is not optimal.
	                var dragThreshold = 10 * (window.devicePixelRatio || 1);

	                if (this._viewportHasMoved || (Math.abs(deltaX) > dragThreshold ||
	                                               Math.abs(deltaY) > dragThreshold)) {
	                    this._viewportHasMoved = true;

	                    this._viewportDragPos = {'x': x, 'y': y};
	                    this._display.viewportChangePos(deltaX, deltaY);
	                }

	                // Skip sending mouse events
	                return;
	            }

	            if (this._view_only) { return; } // View only, skip mouse events

	            if (this._rfb_state !== "normal") { return; }
	            RFB.messages.pointerEvent(this._sock, this._display.absX(x), this._display.absY(y), this._mouse_buttonMask);
	        },

	        // Message Handlers

	        _negotiate_protocol_version: function () {
	            if (this._sock.rQlen() < 12) {
	                return this._fail("Incomplete protocol version");
	            }

	            var sversion = this._sock.rQshiftStr(12).substr(4, 7);
	            Util.Info("Server ProtocolVersion: " + sversion);
	            var is_repeater = 0;
	            switch (sversion) {
	                case "000.000":  // UltraVNC repeater
	                    is_repeater = 1;
	                    break;
	                case "003.003":
	                case "003.006":  // UltraVNC
	                case "003.889":  // Apple Remote Desktop
	                    this._rfb_version = 3.3;
	                    break;
	                case "003.007":
	                    this._rfb_version = 3.7;
	                    break;
	                case "003.008":
	                case "004.000":  // Intel AMT KVM
	                case "004.001":  // RealVNC 4.6
	                    this._rfb_version = 3.8;
	                    break;
	                default:
	                    return this._fail("Invalid server version " + sversion);
	            }

	            if (is_repeater) {
	                var repeaterID = this._repeaterID;
	                while (repeaterID.length < 250) {
	                    repeaterID += "\0";
	                }
	                this._sock.send_string(repeaterID);
	                return true;
	            }

	            if (this._rfb_version > this._rfb_max_version) {
	                this._rfb_version = this._rfb_max_version;
	            }

	            // Send updates either at a rate of 1 update per 50ms, or
	            // whatever slower rate the network can handle
	            this._sendTimer = setInterval(this._sock.flush.bind(this._sock), 50);

	            var cversion = "00" + parseInt(this._rfb_version, 10) +
	                           ".00" + ((this._rfb_version * 10) % 10);
	            this._sock.send_string("RFB " + cversion + "\n");
	            this._updateState('Security', 'Sent ProtocolVersion: ' + cversion);
	        },

	        _negotiate_security: function () {
	            if (this._rfb_version >= 3.7) {
	                // Server sends supported list, client decides
	                var num_types = this._sock.rQshift8();
	                if (this._sock.rQwait("security type", num_types, 1)) { return false; }

	                if (num_types === 0) {
	                    var strlen = this._sock.rQshift32();
	                    var reason = this._sock.rQshiftStr(strlen);
	                    return this._fail("Security failure: " + reason);
	                }

	                this._rfb_auth_scheme = 0;
	                var types = this._sock.rQshiftBytes(num_types);
	                Util.Debug("Server security types: " + types);
	                for (var i = 0; i < types.length; i++) {
	                    if (types[i] > this._rfb_auth_scheme && (types[i] <= 16 || types[i] == 22)) {
	                        this._rfb_auth_scheme = types[i];
	                    }
	                }

	                if (this._rfb_auth_scheme === 0) {
	                    return this._fail("Unsupported security types: " + types);
	                }

	                this._sock.send([this._rfb_auth_scheme]);
	            } else {
	                // Server decides
	                if (this._sock.rQwait("security scheme", 4)) { return false; }
	                this._rfb_auth_scheme = this._sock.rQshift32();
	            }

	            this._updateState('Authentication', 'Authenticating using scheme: ' + this._rfb_auth_scheme);
	            return this._init_msg(); // jump to authentication
	        },

	        // authentication
	        _negotiate_xvp_auth: function () {
	            var xvp_sep = this._xvp_password_sep;
	            var xvp_auth = this._rfb_password.split(xvp_sep);
	            if (xvp_auth.length < 3) {
	                this._updateState('password', 'XVP credentials required (user' + xvp_sep +
	                                  'target' + xvp_sep + 'password) -- got only ' + this._rfb_password);
	                this._onPasswordRequired(this);
	                return false;
	            }

	            var xvp_auth_str = String.fromCharCode(xvp_auth[0].length) +
	                               String.fromCharCode(xvp_auth[1].length) +
	                               xvp_auth[0] +
	                               xvp_auth[1];
	            this._sock.send_string(xvp_auth_str);
	            this._rfb_password = xvp_auth.slice(2).join(xvp_sep);
	            this._rfb_auth_scheme = 2;
	            return this._negotiate_authentication();
	        },

	        _negotiate_std_vnc_auth: function () {
	            if (this._rfb_password.length === 0) {
	                // Notify via both callbacks since it's kind of
	                // an RFB state change and a UI interface issue
	                this._updateState('password', "Password Required");
	                this._onPasswordRequired(this);
	                return false;
	            }

	            if (this._sock.rQwait("auth challenge", 16)) { return false; }

	            // TODO(directxman12): make genDES not require an Array
	            var challenge = Array.prototype.slice.call(this._sock.rQshiftBytes(16));
	            var response = RFB.genDES(this._rfb_password, challenge);
	            this._sock.send(response);
	            this._updateState("SecurityResult");
	            return true;
	        },

	        _negotiate_tight_tunnels: function (numTunnels) {
	            var clientSupportedTunnelTypes = {
	                0: { vendor: 'TGHT', signature: 'NOTUNNEL' }
	            };
	            var serverSupportedTunnelTypes = {};
	            // receive tunnel capabilities
	            for (var i = 0; i < numTunnels; i++) {
	                var cap_code = this._sock.rQshift32();
	                var cap_vendor = this._sock.rQshiftStr(4);
	                var cap_signature = this._sock.rQshiftStr(8);
	                serverSupportedTunnelTypes[cap_code] = { vendor: cap_vendor, signature: cap_signature };
	            }

	            // choose the notunnel type
	            if (serverSupportedTunnelTypes[0]) {
	                if (serverSupportedTunnelTypes[0].vendor != clientSupportedTunnelTypes[0].vendor ||
	                    serverSupportedTunnelTypes[0].signature != clientSupportedTunnelTypes[0].signature) {
	                    return this._fail("Client's tunnel type had the incorrect vendor or signature");
	                }
	                this._sock.send([0, 0, 0, 0]);  // use NOTUNNEL
	                return false; // wait until we receive the sub auth count to continue
	            } else {
	                return this._fail("Server wanted tunnels, but doesn't support the notunnel type");
	            }
	        },

	        _negotiate_tight_auth: function () {
	            if (!this._rfb_tightvnc) {  // first pass, do the tunnel negotiation
	                if (this._sock.rQwait("num tunnels", 4)) { return false; }
	                var numTunnels = this._sock.rQshift32();
	                if (numTunnels > 0 && this._sock.rQwait("tunnel capabilities", 16 * numTunnels, 4)) { return false; }

	                this._rfb_tightvnc = true;

	                if (numTunnels > 0) {
	                    this._negotiate_tight_tunnels(numTunnels);
	                    return false;  // wait until we receive the sub auth to continue
	                }
	            }

	            // second pass, do the sub-auth negotiation
	            if (this._sock.rQwait("sub auth count", 4)) { return false; }
	            var subAuthCount = this._sock.rQshift32();
	            if (this._sock.rQwait("sub auth capabilities", 16 * subAuthCount, 4)) { return false; }

	            var clientSupportedTypes = {
	                'STDVNOAUTH__': 1,
	                'STDVVNCAUTH_': 2
	            };

	            var serverSupportedTypes = [];

	            for (var i = 0; i < subAuthCount; i++) {
	                var capNum = this._sock.rQshift32();
	                var capabilities = this._sock.rQshiftStr(12);
	                serverSupportedTypes.push(capabilities);
	            }

	            for (var authType in clientSupportedTypes) {
	                if (serverSupportedTypes.indexOf(authType) != -1) {
	                    this._sock.send([0, 0, 0, clientSupportedTypes[authType]]);

	                    switch (authType) {
	                        case 'STDVNOAUTH__':  // no auth
	                            this._updateState('SecurityResult');
	                            return true;
	                        case 'STDVVNCAUTH_': // VNC auth
	                            this._rfb_auth_scheme = 2;
	                            return this._init_msg();
	                        default:
	                            return this._fail("Unsupported tiny auth scheme: " + authType);
	                    }
	                }
	            }

	            this._fail("No supported sub-auth types!");
	        },

	        _negotiate_authentication: function () {
	            switch (this._rfb_auth_scheme) {
	                case 0:  // connection failed
	                    if (this._sock.rQwait("auth reason", 4)) { return false; }
	                    var strlen = this._sock.rQshift32();
	                    var reason = this._sock.rQshiftStr(strlen);
	                    return this._fail("Auth failure: " + reason);

	                case 1:  // no auth
	                    if (this._rfb_version >= 3.8) {
	                        this._updateState('SecurityResult');
	                        return true;
	                    }
	                    this._updateState('ClientInitialisation', "No auth required");
	                    return this._init_msg();

	                case 22:  // XVP auth
	                    return this._negotiate_xvp_auth();

	                case 2:  // VNC authentication
	                    return this._negotiate_std_vnc_auth();

	                case 16:  // TightVNC Security Type
	                    return this._negotiate_tight_auth();

	                default:
	                    return this._fail("Unsupported auth scheme: " + this._rfb_auth_scheme);
	            }
	        },

	        _handle_security_result: function () {
	            if (this._sock.rQwait('VNC auth response ', 4)) { return false; }
	            switch (this._sock.rQshift32()) {
	                case 0:  // OK
	                    this._updateState('ClientInitialisation', 'Authentication OK');
	                    return this._init_msg();
	                case 1:  // failed
	                    if (this._rfb_version >= 3.8) {
	                        var length = this._sock.rQshift32();
	                        if (this._sock.rQwait("SecurityResult reason", length, 8)) { return false; }
	                        var reason = this._sock.rQshiftStr(length);
	                        return this._fail(reason);
	                    } else {
	                        return this._fail("Authentication failure");
	                    }
	                    return false;
	                case 2:
	                    return this._fail("Too many auth attempts");
	            }
	        },

	        _negotiate_server_init: function () {
	            if (this._sock.rQwait("server initialization", 24)) { return false; }

	            /* Screen size */
	            this._fb_width  = this._sock.rQshift16();
	            this._fb_height = this._sock.rQshift16();
	            this._destBuff = new Uint8Array(this._fb_width * this._fb_height * 4);

	            /* PIXEL_FORMAT */
	            var bpp         = this._sock.rQshift8();
	            var depth       = this._sock.rQshift8();
	            var big_endian  = this._sock.rQshift8();
	            var true_color  = this._sock.rQshift8();

	            var red_max     = this._sock.rQshift16();
	            var green_max   = this._sock.rQshift16();
	            var blue_max    = this._sock.rQshift16();
	            var red_shift   = this._sock.rQshift8();
	            var green_shift = this._sock.rQshift8();
	            var blue_shift  = this._sock.rQshift8();
	            this._sock.rQskipBytes(3);  // padding

	            // NB(directxman12): we don't want to call any callbacks or print messages until
	            //                   *after* we're past the point where we could backtrack

	            /* Connection name/title */
	            var name_length = this._sock.rQshift32();
	            if (this._sock.rQwait('server init name', name_length, 24)) { return false; }
	            this._fb_name = Util.decodeUTF8(this._sock.rQshiftStr(name_length));

	            if (this._rfb_tightvnc) {
	                if (this._sock.rQwait('TightVNC extended server init header', 8, 24 + name_length)) { return false; }
	                // In TightVNC mode, ServerInit message is extended
	                var numServerMessages = this._sock.rQshift16();
	                var numClientMessages = this._sock.rQshift16();
	                var numEncodings = this._sock.rQshift16();
	                this._sock.rQskipBytes(2);  // padding

	                var totalMessagesLength = (numServerMessages + numClientMessages + numEncodings) * 16;
	                if (this._sock.rQwait('TightVNC extended server init header', totalMessagesLength, 32 + name_length)) { return false; }

	                // we don't actually do anything with the capability information that TIGHT sends,
	                // so we just skip the all of this.

	                // TIGHT server message capabilities
	                this._sock.rQskipBytes(16 * numServerMessages);

	                // TIGHT client message capabilities
	                this._sock.rQskipBytes(16 * numClientMessages);

	                // TIGHT encoding capabilities
	                this._sock.rQskipBytes(16 * numEncodings);
	            }

	            // NB(directxman12): these are down here so that we don't run them multiple times
	            //                   if we backtrack
	            Util.Info("Screen: " + this._fb_width + "x" + this._fb_height +
	                      ", bpp: " + bpp + ", depth: " + depth +
	                      ", big_endian: " + big_endian +
	                      ", true_color: " + true_color +
	                      ", red_max: " + red_max +
	                      ", green_max: " + green_max +
	                      ", blue_max: " + blue_max +
	                      ", red_shift: " + red_shift +
	                      ", green_shift: " + green_shift +
	                      ", blue_shift: " + blue_shift);

	            if (big_endian !== 0) {
	                Util.Warn("Server native endian is not little endian");
	            }

	            if (red_shift !== 16) {
	                Util.Warn("Server native red-shift is not 16");
	            }

	            if (blue_shift !== 0) {
	                Util.Warn("Server native blue-shift is not 0");
	            }

	            // we're past the point where we could backtrack, so it's safe to call this
	            this._onDesktopName(this, this._fb_name);

	            if (this._true_color && this._fb_name === "Intel(r) AMT KVM") {
	                Util.Warn("Intel AMT KVM only supports 8/16 bit depths.  Disabling true color");
	                this._true_color = false;
	            }

	            this._display.set_true_color(this._true_color);
	            this._display.resize(this._fb_width, this._fb_height);
	            this._onFBResize(this, this._fb_width, this._fb_height);
	            this._keyboard.grab();
	            this._mouse.grab();

	            if (this._true_color) {
	                this._fb_Bpp = 4;
	                this._fb_depth = 3;
	            } else {
	                this._fb_Bpp = 1;
	                this._fb_depth = 1;
	            }

	            RFB.messages.pixelFormat(this._sock, this._fb_Bpp, this._fb_depth, this._true_color);
	            RFB.messages.clientEncodings(this._sock, this._encodings, this._local_cursor, this._true_color);
	            RFB.messages.fbUpdateRequests(this._sock, this._display.getCleanDirtyReset(), this._fb_width, this._fb_height);

	            this._timing.fbu_rt_start = (new Date()).getTime();
	            this._timing.pixels = 0;
	            this._sock.flush();

	            if (this._encrypt) {
	                this._updateState('normal', 'Connected (encrypted) to: ' + this._fb_name);
	            } else {
	                this._updateState('normal', 'Connected (unencrypted) to: ' + this._fb_name);
	            }
	        },

	        _init_msg: function () {
	            switch (this._rfb_state) {
	                case 'ProtocolVersion':
	                    return this._negotiate_protocol_version();

	                case 'Security':
	                    return this._negotiate_security();

	                case 'Authentication':
	                    return this._negotiate_authentication();

	                case 'SecurityResult':
	                    return this._handle_security_result();

	                case 'ClientInitialisation':
	                    this._sock.send([this._shared ? 1 : 0]); // ClientInitialisation
	                    this._updateState('ServerInitialisation', "Authentication OK");
	                    return true;

	                case 'ServerInitialisation':
	                    return this._negotiate_server_init();
	            }
	        },

	        _handle_set_colour_map_msg: function () {
	            Util.Debug("SetColorMapEntries");
	            this._sock.rQskip8();  // Padding

	            var first_colour = this._sock.rQshift16();
	            var num_colours = this._sock.rQshift16();
	            if (this._sock.rQwait('SetColorMapEntries', num_colours * 6, 6)) { return false; }

	            for (var c = 0; c < num_colours; c++) {
	                var red = parseInt(this._sock.rQshift16() / 256, 10);
	                var green = parseInt(this._sock.rQshift16() / 256, 10);
	                var blue = parseInt(this._sock.rQshift16() / 256, 10);
	                this._display.set_colourMap([blue, green, red], first_colour + c);
	            }
	            Util.Debug("colourMap: " + this._display.get_colourMap());
	            Util.Info("Registered " + num_colours + " colourMap entries");

	            return true;
	        },

	        _handle_server_cut_text: function () {
	            Util.Debug("ServerCutText");
	            if (this._sock.rQwait("ServerCutText header", 7, 1)) { return false; }
	            this._sock.rQskipBytes(3);  // Padding
	            var length = this._sock.rQshift32();
	            if (this._sock.rQwait("ServerCutText", length, 8)) { return false; }

	            var text = this._sock.rQshiftStr(length);
	            this._onClipboard(this, text);

	            return true;
	        },

	        _handle_xvp_msg: function () {
	            if (this._sock.rQwait("XVP version and message", 3, 1)) { return false; }
	            this._sock.rQskip8();  // Padding
	            var xvp_ver = this._sock.rQshift8();
	            var xvp_msg = this._sock.rQshift8();

	            switch (xvp_msg) {
	                case 0:  // XVP_FAIL
	                    this._updateState(this._rfb_state, "Operation Failed");
	                    break;
	                case 1:  // XVP_INIT
	                    this._rfb_xvp_ver = xvp_ver;
	                    Util.Info("XVP extensions enabled (version " + this._rfb_xvp_ver + ")");
	                    this._onXvpInit(this._rfb_xvp_ver);
	                    break;
	                default:
	                    this._fail("Disconnected: illegal server XVP message " + xvp_msg);
	                    break;
	            }

	            return true;
	        },

	        _normal_msg: function () {
	            var msg_type;

	            if (this._FBU.rects > 0) {
	                msg_type = 0;
	            } else {
	                msg_type = this._sock.rQshift8();
	            }

	            switch (msg_type) {
	                case 0:  // FramebufferUpdate
	                    var ret = this._framebufferUpdate();
	                    if (ret) {
	                        RFB.messages.fbUpdateRequests(this._sock, this._display.getCleanDirtyReset(), this._fb_width, this._fb_height);
	                        this._sock.flush();
	                    }
	                    return ret;

	                case 1:  // SetColorMapEntries
	                    return this._handle_set_colour_map_msg();

	                case 2:  // Bell
	                    Util.Debug("Bell");
	                    this._onBell(this);
	                    return true;

	                case 3:  // ServerCutText
	                    return this._handle_server_cut_text();

	                case 250:  // XVP
	                    return this._handle_xvp_msg();

	                default:
	                    this._fail("Disconnected: illegal server message type " + msg_type);
	                    Util.Debug("sock.rQslice(0, 30): " + this._sock.rQslice(0, 30));
	                    return true;
	            }
	        },

	        _framebufferUpdate: function () {
	            var ret = true;
	            var now;

	            if (this._FBU.rects === 0) {
	                if (this._sock.rQwait("FBU header", 3, 1)) { return false; }
	                this._sock.rQskip8();  // Padding
	                this._FBU.rects = this._sock.rQshift16();
	                this._FBU.bytes = 0;
	                this._timing.cur_fbu = 0;
	                if (this._timing.fbu_rt_start > 0) {
	                    now = (new Date()).getTime();
	                    Util.Info("First FBU latency: " + (now - this._timing.fbu_rt_start));
	                }
	            }

	            while (this._FBU.rects > 0) {
	                if (this._rfb_state !== "normal") { return false; }

	                if (this._sock.rQwait("FBU", this._FBU.bytes)) { return false; }
	                if (this._FBU.bytes === 0) {
	                    if (this._sock.rQwait("rect header", 12)) { return false; }
	                    /* New FramebufferUpdate */

	                    var hdr = this._sock.rQshiftBytes(12);
	                    this._FBU.x        = (hdr[0] << 8) + hdr[1];
	                    this._FBU.y        = (hdr[2] << 8) + hdr[3];
	                    this._FBU.width    = (hdr[4] << 8) + hdr[5];
	                    this._FBU.height   = (hdr[6] << 8) + hdr[7];
	                    this._FBU.encoding = parseInt((hdr[8] << 24) + (hdr[9] << 16) +
	                                                  (hdr[10] << 8) + hdr[11], 10);

	                    this._onFBUReceive(this,
	                        {'x': this._FBU.x, 'y': this._FBU.y,
	                         'width': this._FBU.width, 'height': this._FBU.height,
	                         'encoding': this._FBU.encoding,
	                         'encodingName': this._encNames[this._FBU.encoding]});

	                    if (!this._encNames[this._FBU.encoding]) {
	                        this._fail("Disconnected: unsupported encoding " +
	                                   this._FBU.encoding);
	                        return false;
	                    }
	                }

	                this._timing.last_fbu = (new Date()).getTime();

	                var handler = this._encHandlers[this._FBU.encoding];
	                try {
	                    //ret = this._encHandlers[this._FBU.encoding]();
	                    ret = handler();
	                } catch (ex)  {
	                    console.log("missed " + this._FBU.encoding + ": " + handler);
	                    ret = this._encHandlers[this._FBU.encoding]();
	                }

	                now = (new Date()).getTime();
	                this._timing.cur_fbu += (now - this._timing.last_fbu);

	                if (ret) {
	                    this._encStats[this._FBU.encoding][0]++;
	                    this._encStats[this._FBU.encoding][1]++;
	                    this._timing.pixels += this._FBU.width * this._FBU.height;
	                }

	                if (this._timing.pixels >= (this._fb_width * this._fb_height)) {
	                    if ((this._FBU.width === this._fb_width && this._FBU.height === this._fb_height) ||
	                        this._timing.fbu_rt_start > 0) {
	                        this._timing.full_fbu_total += this._timing.cur_fbu;
	                        this._timing.full_fbu_cnt++;
	                        Util.Info("Timing of full FBU, curr: " +
	                                  this._timing.cur_fbu + ", total: " +
	                                  this._timing.full_fbu_total + ", cnt: " +
	                                  this._timing.full_fbu_cnt + ", avg: " +
	                                  (this._timing.full_fbu_total / this._timing.full_fbu_cnt));
	                    }

	                    if (this._timing.fbu_rt_start > 0) {
	                        var fbu_rt_diff = now - this._timing.fbu_rt_start;
	                        this._timing.fbu_rt_total += fbu_rt_diff;
	                        this._timing.fbu_rt_cnt++;
	                        Util.Info("full FBU round-trip, cur: " +
	                                  fbu_rt_diff + ", total: " +
	                                  this._timing.fbu_rt_total + ", cnt: " +
	                                  this._timing.fbu_rt_cnt + ", avg: " +
	                                  (this._timing.fbu_rt_total / this._timing.fbu_rt_cnt));
	                        this._timing.fbu_rt_start = 0;
	                    }
	                }

	                if (!ret) { return ret; }  // need more data
	            }

	            this._onFBUComplete(this,
	                    {'x': this._FBU.x, 'y': this._FBU.y,
	                     'width': this._FBU.width, 'height': this._FBU.height,
	                     'encoding': this._FBU.encoding,
	                     'encodingName': this._encNames[this._FBU.encoding]});

	            return true;  // We finished this FBU
	        },
	    };

	    Util.make_properties(RFB, [
	        ['target', 'wo', 'dom'],                // VNC display rendering Canvas object
	        ['focusContainer', 'wo', 'dom'],        // DOM element that captures keyboard input
	        ['encrypt', 'rw', 'bool'],              // Use TLS/SSL/wss encryption
	        ['true_color', 'rw', 'bool'],           // Request true color pixel data
	        ['local_cursor', 'rw', 'bool'],         // Request locally rendered cursor
	        ['shared', 'rw', 'bool'],               // Request shared mode
	        ['view_only', 'rw', 'bool'],            // Disable client mouse/keyboard
	        ['xvp_password_sep', 'rw', 'str'],      // Separator for XVP password fields
	        ['disconnectTimeout', 'rw', 'int'],     // Time (s) to wait for disconnection
	        ['wsProtocols', 'rw', 'arr'],           // Protocols to use in the WebSocket connection
	        ['repeaterID', 'rw', 'str'],            // [UltraVNC] RepeaterID to connect to
	        ['viewportDrag', 'rw', 'bool'],         // Move the viewport on mouse drags

	        // Callback functions
	        ['onUpdateState', 'rw', 'func'],        // onUpdateState(rfb, state, oldstate, statusMsg): RFB state update/change
	        ['onPasswordRequired', 'rw', 'func'],   // onPasswordRequired(rfb): VNC password is required
	        ['onClipboard', 'rw', 'func'],          // onClipboard(rfb, text): RFB clipboard contents received
	        ['onBell', 'rw', 'func'],               // onBell(rfb): RFB Bell message received
	        ['onFBUReceive', 'rw', 'func'],         // onFBUReceive(rfb, fbu): RFB FBU received but not yet processed
	        ['onFBUComplete', 'rw', 'func'],        // onFBUComplete(rfb, fbu): RFB FBU received and processed
	        ['onFBResize', 'rw', 'func'],           // onFBResize(rfb, width, height): frame buffer resized
	        ['onDesktopName', 'rw', 'func'],        // onDesktopName(rfb, name): desktop name received
	        ['onXvpInit', 'rw', 'func'],            // onXvpInit(version): XVP extensions active for this connection
	    ]);

	    RFB.prototype.set_local_cursor = function (cursor) {
	        if (!cursor || (cursor in {'0': 1, 'no': 1, 'false': 1})) {
	            this._local_cursor = false;
	            this._display.disableLocalCursor(); //Only show server-side cursor
	        } else {
	            if (this._display.get_cursor_uri()) {
	                this._local_cursor = true;
	            } else {
	                Util.Warn("Browser does not support local cursor");
	                this._display.disableLocalCursor();
	            }
	        }
	    };

	    RFB.prototype.get_display = function () { return this._display; };
	    RFB.prototype.get_keyboard = function () { return this._keyboard; };
	    RFB.prototype.get_mouse = function () { return this._mouse; };

	    // Class Methods
	    RFB.messages = {
	        keyEvent: function (sock, keysym, down) {
	            var buff = sock._sQ;
	            var offset = sock._sQlen;

	            buff[offset] = 4;  // msg-type
	            buff[offset + 1] = down;

	            buff[offset + 2] = 0;
	            buff[offset + 3] = 0;

	            buff[offset + 4] = (keysym >> 24);
	            buff[offset + 5] = (keysym >> 16);
	            buff[offset + 6] = (keysym >> 8);
	            buff[offset + 7] = keysym;

	            sock._sQlen += 8;
	        },

	        pointerEvent: function (sock, x, y, mask) {
	            var buff = sock._sQ;
	            var offset = sock._sQlen;

	            buff[offset] = 5; // msg-type

	            buff[offset + 1] = mask;

	            buff[offset + 2] = x >> 8;
	            buff[offset + 3] = x;

	            buff[offset + 4] = y >> 8;
	            buff[offset + 5] = y;

	            sock._sQlen += 6;
	        },

	        // TODO(directxman12): make this unicode compatible?
	        clientCutText: function (sock, text) {
	            var buff = sock._sQ;
	            var offset = sock._sQlen;

	            buff[offset] = 6; // msg-type

	            buff[offset + 1] = 0; // padding
	            buff[offset + 2] = 0; // padding
	            buff[offset + 3] = 0; // padding

	            var n = text.length;

	            buff[offset + 4] = n >> 24;
	            buff[offset + 5] = n >> 16;
	            buff[offset + 6] = n >> 8;
	            buff[offset + 7] = n;

	            for (var i = 0; i < n; i++) {
	                buff[offset + 8 + i] =  text.charCodeAt(i);
	            }

	            sock._sQlen += 8 + n;
	        },

	        setDesktopSize: function (sock, width, height, id, flags) {
	            var buff = sock._sQ;
	            var offset = sock._sQlen;

	            buff[offset] = 251;              // msg-type
	            buff[offset + 1] = 0;            // padding
	            buff[offset + 2] = width >> 8;   // width
	            buff[offset + 3] = width;
	            buff[offset + 4] = height >> 8;  // height
	            buff[offset + 5] = height;

	            buff[offset + 6] = 1;            // number-of-screens
	            buff[offset + 7] = 0;            // padding

	            // screen array
	            buff[offset + 8] = id >> 24;     // id
	            buff[offset + 9] = id >> 16;
	            buff[offset + 10] = id >> 8;
	            buff[offset + 11] = id;
	            buff[offset + 12] = 0;           // x-position
	            buff[offset + 13] = 0;
	            buff[offset + 14] = 0;           // y-position
	            buff[offset + 15] = 0;
	            buff[offset + 16] = width >> 8;  // width
	            buff[offset + 17] = width;
	            buff[offset + 18] = height >> 8; // height
	            buff[offset + 19] = height;
	            buff[offset + 20] = flags >> 24; // flags
	            buff[offset + 21] = flags >> 16;
	            buff[offset + 22] = flags >> 8;
	            buff[offset + 23] = flags;

	            sock._sQlen += 24;
	        },

	        pixelFormat: function (sock, bpp, depth, true_color) {
	            var buff = sock._sQ;
	            var offset = sock._sQlen;

	            buff[offset] = 0;  // msg-type

	            buff[offset + 1] = 0; // padding
	            buff[offset + 2] = 0; // padding
	            buff[offset + 3] = 0; // padding

	            buff[offset + 4] = bpp * 8;             // bits-per-pixel
	            buff[offset + 5] = depth * 8;           // depth
	            buff[offset + 6] = 0;                   // little-endian
	            buff[offset + 7] = true_color ? 1 : 0;  // true-color

	            buff[offset + 8] = 0;    // red-max
	            buff[offset + 9] = 255;  // red-max

	            buff[offset + 10] = 0;   // green-max
	            buff[offset + 11] = 255; // green-max

	            buff[offset + 12] = 0;   // blue-max
	            buff[offset + 13] = 255; // blue-max

	            buff[offset + 14] = 16;  // red-shift
	            buff[offset + 15] = 8;   // green-shift
	            buff[offset + 16] = 0;   // blue-shift

	            buff[offset + 17] = 0;   // padding
	            buff[offset + 18] = 0;   // padding
	            buff[offset + 19] = 0;   // padding

	            sock._sQlen += 20;
	        },

	        clientEncodings: function (sock, encodings, local_cursor, true_color) {
	            var buff = sock._sQ;
	            var offset = sock._sQlen;

	            buff[offset] = 2; // msg-type
	            buff[offset + 1] = 0; // padding

	            // offset + 2 and offset + 3 are encoding count

	            var i, j = offset + 4, cnt = 0;
	            for (i = 0; i < encodings.length; i++) {
	                if (encodings[i][0] === "Cursor" && !local_cursor) {
	                    Util.Debug("Skipping Cursor pseudo-encoding");
	                } else if (encodings[i][0] === "TIGHT" && !true_color) {
	                    // TODO: remove this when we have tight+non-true-color
	                    Util.Warn("Skipping tight as it is only supported with true color");
	                } else {
	                    var enc = encodings[i][1];
	                    buff[j] = enc >> 24;
	                    buff[j + 1] = enc >> 16;
	                    buff[j + 2] = enc >> 8;
	                    buff[j + 3] = enc;

	                    j += 4;
	                    cnt++;
	                }
	            }

	            buff[offset + 2] = cnt >> 8;
	            buff[offset + 3] = cnt;

	            sock._sQlen += j - offset;
	        },

	        fbUpdateRequests: function (sock, cleanDirty, fb_width, fb_height) {
	            var offsetIncrement = 0;

	            var cb = cleanDirty.cleanBox;
	            var w, h;
	            if (cb.w > 0 && cb.h > 0) {
	                w = typeof cb.w === "undefined" ? fb_width : cb.w;
	                h = typeof cb.h === "undefined" ? fb_height : cb.h;
	                // Request incremental for clean box
	                RFB.messages.fbUpdateRequest(sock, 1, cb.x, cb.y, w, h);
	            }

	            for (var i = 0; i < cleanDirty.dirtyBoxes.length; i++) {
	                var db = cleanDirty.dirtyBoxes[i];
	                // Force all (non-incremental) for dirty box
	                w = typeof db.w === "undefined" ? fb_width : db.w;
	                h = typeof db.h === "undefined" ? fb_height : db.h;
	                RFB.messages.fbUpdateRequest(sock, 0, db.x, db.y, w, h);
	            }
	        },

	        fbUpdateRequest: function (sock, incremental, x, y, w, h) {
	            var buff = sock._sQ;
	            var offset = sock._sQlen;

	            if (typeof(x) === "undefined") { x = 0; }
	            if (typeof(y) === "undefined") { y = 0; }

	            buff[offset] = 3;  // msg-type
	            buff[offset + 1] = incremental;

	            buff[offset + 2] = (x >> 8) & 0xFF;
	            buff[offset + 3] = x & 0xFF;

	            buff[offset + 4] = (y >> 8) & 0xFF;
	            buff[offset + 5] = y & 0xFF;

	            buff[offset + 6] = (w >> 8) & 0xFF;
	            buff[offset + 7] = w & 0xFF;

	            buff[offset + 8] = (h >> 8) & 0xFF;
	            buff[offset + 9] = h & 0xFF;

	            sock._sQlen += 10;
	        }
	    };

	    RFB.genDES = function (password, challenge) {
	        var passwd = [];
	        for (var i = 0; i < password.length; i++) {
	            passwd.push(password.charCodeAt(i));
	        }
	        return (new DES(passwd)).encrypt(challenge);
	    };

	    RFB.extract_data_uri = function (arr) {
	        return ";base64," + Base64.encode(arr);
	    };

	    RFB.encodingHandlers = {
	        RAW: function () {
	            if (this._FBU.lines === 0) {
	                this._FBU.lines = this._FBU.height;
	            }

	            this._FBU.bytes = this._FBU.width * this._fb_Bpp;  // at least a line
	            if (this._sock.rQwait("RAW", this._FBU.bytes)) { return false; }
	            var cur_y = this._FBU.y + (this._FBU.height - this._FBU.lines);
	            var curr_height = Math.min(this._FBU.lines,
	                                       Math.floor(this._sock.rQlen() / (this._FBU.width * this._fb_Bpp)));
	            this._display.blitImage(this._FBU.x, cur_y, this._FBU.width,
	                                    curr_height, this._sock.get_rQ(),
	                                    this._sock.get_rQi());
	            this._sock.rQskipBytes(this._FBU.width * curr_height * this._fb_Bpp);
	            this._FBU.lines -= curr_height;

	            if (this._FBU.lines > 0) {
	                this._FBU.bytes = this._FBU.width * this._fb_Bpp;  // At least another line
	            } else {
	                this._FBU.rects--;
	                this._FBU.bytes = 0;
	            }

	            return true;
	        },

	        COPYRECT: function () {
	            this._FBU.bytes = 4;
	            if (this._sock.rQwait("COPYRECT", 4)) { return false; }
	            this._display.copyImage(this._sock.rQshift16(), this._sock.rQshift16(),
	                                    this._FBU.x, this._FBU.y, this._FBU.width,
	                                    this._FBU.height);

	            this._FBU.rects--;
	            this._FBU.bytes = 0;
	            return true;
	        },

	        RRE: function () {
	            var color;
	            if (this._FBU.subrects === 0) {
	                this._FBU.bytes = 4 + this._fb_Bpp;
	                if (this._sock.rQwait("RRE", 4 + this._fb_Bpp)) { return false; }
	                this._FBU.subrects = this._sock.rQshift32();
	                color = this._sock.rQshiftBytes(this._fb_Bpp);  // Background
	                this._display.fillRect(this._FBU.x, this._FBU.y, this._FBU.width, this._FBU.height, color);
	            }

	            while (this._FBU.subrects > 0 && this._sock.rQlen() >= (this._fb_Bpp + 8)) {
	                color = this._sock.rQshiftBytes(this._fb_Bpp);
	                var x = this._sock.rQshift16();
	                var y = this._sock.rQshift16();
	                var width = this._sock.rQshift16();
	                var height = this._sock.rQshift16();
	                this._display.fillRect(this._FBU.x + x, this._FBU.y + y, width, height, color);
	                this._FBU.subrects--;
	            }

	            if (this._FBU.subrects > 0) {
	                var chunk = Math.min(this._rre_chunk_sz, this._FBU.subrects);
	                this._FBU.bytes = (this._fb_Bpp + 8) * chunk;
	            } else {
	                this._FBU.rects--;
	                this._FBU.bytes = 0;
	            }

	            return true;
	        },

	        HEXTILE: function () {
	            var rQ = this._sock.get_rQ();
	            var rQi = this._sock.get_rQi();

	            if (this._FBU.tiles === 0) {
	                this._FBU.tiles_x = Math.ceil(this._FBU.width / 16);
	                this._FBU.tiles_y = Math.ceil(this._FBU.height / 16);
	                this._FBU.total_tiles = this._FBU.tiles_x * this._FBU.tiles_y;
	                this._FBU.tiles = this._FBU.total_tiles;
	            }

	            while (this._FBU.tiles > 0) {
	                this._FBU.bytes = 1;
	                if (this._sock.rQwait("HEXTILE subencoding", this._FBU.bytes)) { return false; }
	                var subencoding = rQ[rQi];  // Peek
	                if (subencoding > 30) {  // Raw
	                    this._fail("Disconnected: illegal hextile subencoding " + subencoding);
	                    return false;
	                }

	                var subrects = 0;
	                var curr_tile = this._FBU.total_tiles - this._FBU.tiles;
	                var tile_x = curr_tile % this._FBU.tiles_x;
	                var tile_y = Math.floor(curr_tile / this._FBU.tiles_x);
	                var x = this._FBU.x + tile_x * 16;
	                var y = this._FBU.y + tile_y * 16;
	                var w = Math.min(16, (this._FBU.x + this._FBU.width) - x);
	                var h = Math.min(16, (this._FBU.y + this._FBU.height) - y);

	                // Figure out how much we are expecting
	                if (subencoding & 0x01) {  // Raw
	                    this._FBU.bytes += w * h * this._fb_Bpp;
	                } else {
	                    if (subencoding & 0x02) {  // Background
	                        this._FBU.bytes += this._fb_Bpp;
	                    }
	                    if (subencoding & 0x04) {  // Foreground
	                        this._FBU.bytes += this._fb_Bpp;
	                    }
	                    if (subencoding & 0x08) {  // AnySubrects
	                        this._FBU.bytes++;  // Since we aren't shifting it off
	                        if (this._sock.rQwait("hextile subrects header", this._FBU.bytes)) { return false; }
	                        subrects = rQ[rQi + this._FBU.bytes - 1];  // Peek
	                        if (subencoding & 0x10) {  // SubrectsColoured
	                            this._FBU.bytes += subrects * (this._fb_Bpp + 2);
	                        } else {
	                            this._FBU.bytes += subrects * 2;
	                        }
	                    }
	                }

	                if (this._sock.rQwait("hextile", this._FBU.bytes)) { return false; }

	                // We know the encoding and have a whole tile
	                this._FBU.subencoding = rQ[rQi];
	                rQi++;
	                if (this._FBU.subencoding === 0) {
	                    if (this._FBU.lastsubencoding & 0x01) {
	                        // Weird: ignore blanks are RAW
	                        Util.Debug("     Ignoring blank after RAW");
	                    } else {
	                        this._display.fillRect(x, y, w, h, this._FBU.background);
	                    }
	                } else if (this._FBU.subencoding & 0x01) {  // Raw
	                    this._display.blitImage(x, y, w, h, rQ, rQi);
	                    rQi += this._FBU.bytes - 1;
	                } else {
	                    if (this._FBU.subencoding & 0x02) {  // Background
	                        if (this._fb_Bpp == 1) {
	                            this._FBU.background = rQ[rQi];
	                        } else {
	                            // fb_Bpp is 4
	                            this._FBU.background = [rQ[rQi], rQ[rQi + 1], rQ[rQi + 2], rQ[rQi + 3]];
	                        }
	                        rQi += this._fb_Bpp;
	                    }
	                    if (this._FBU.subencoding & 0x04) {  // Foreground
	                        if (this._fb_Bpp == 1) {
	                            this._FBU.foreground = rQ[rQi];
	                        } else {
	                            // this._fb_Bpp is 4
	                            this._FBU.foreground = [rQ[rQi], rQ[rQi + 1], rQ[rQi + 2], rQ[rQi + 3]];
	                        }
	                        rQi += this._fb_Bpp;
	                    }

	                    this._display.startTile(x, y, w, h, this._FBU.background);
	                    if (this._FBU.subencoding & 0x08) {  // AnySubrects
	                        subrects = rQ[rQi];
	                        rQi++;

	                        for (var s = 0; s < subrects; s++) {
	                            var color;
	                            if (this._FBU.subencoding & 0x10) {  // SubrectsColoured
	                                if (this._fb_Bpp === 1) {
	                                    color = rQ[rQi];
	                                } else {
	                                    // _fb_Bpp is 4
	                                    color = [rQ[rQi], rQ[rQi + 1], rQ[rQi + 2], rQ[rQi + 3]];
	                                }
	                                rQi += this._fb_Bpp;
	                            } else {
	                                color = this._FBU.foreground;
	                            }
	                            var xy = rQ[rQi];
	                            rQi++;
	                            var sx = (xy >> 4);
	                            var sy = (xy & 0x0f);

	                            var wh = rQ[rQi];
	                            rQi++;
	                            var sw = (wh >> 4) + 1;
	                            var sh = (wh & 0x0f) + 1;

	                            this._display.subTile(sx, sy, sw, sh, color);
	                        }
	                    }
	                    this._display.finishTile();
	                }
	                this._sock.set_rQi(rQi);
	                this._FBU.lastsubencoding = this._FBU.subencoding;
	                this._FBU.bytes = 0;
	                this._FBU.tiles--;
	            }

	            if (this._FBU.tiles === 0) {
	                this._FBU.rects--;
	            }

	            return true;
	        },

	        getTightCLength: function (arr) {
	            var header = 1, data = 0;
	            data += arr[0] & 0x7f;
	            if (arr[0] & 0x80) {
	                header++;
	                data += (arr[1] & 0x7f) << 7;
	                if (arr[1] & 0x80) {
	                    header++;
	                    data += arr[2] << 14;
	                }
	            }
	            return [header, data];
	        },

	        display_tight: function (isTightPNG) {
	            if (this._fb_depth === 1) {
	                this._fail("Tight protocol handler only implements true color mode");
	            }

	            this._FBU.bytes = 1;  // compression-control byte
	            if (this._sock.rQwait("TIGHT compression-control", this._FBU.bytes)) { return false; }

	            var checksum = function (data) {
	                var sum = 0;
	                for (var i = 0; i < data.length; i++) {
	                    sum += data[i];
	                    if (sum > 65536) sum -= 65536;
	                }
	                return sum;
	            };

	            var resetStreams = 0;
	            var streamId = -1;
	            var decompress = function (data, expected) {
	                for (var i = 0; i < 4; i++) {
	                    if ((resetStreams >> i) & 1) {
	                        this._FBU.zlibs[i].reset();
	                        console.debug('RESET!');
	                        Util.Info("Reset zlib stream " + i);
	                    }
	                }

	                //var uncompressed = this._FBU.zlibs[streamId].uncompress(data, 0);
	                var uncompressed = this._FBU.zlibs[streamId].inflate(data, true, expected);
	                /*if (uncompressed.status !== 0) {
	                    Util.Error("Invalid data in zlib stream");
	                }*/

	                //return uncompressed.data;
	                return uncompressed;
	            }.bind(this);

	            var indexedToRGBX2Color = function (data, palette, width, height) {
	                // Convert indexed (palette based) image data to RGB
	                // TODO: reduce number of calculations inside loop
	                var dest = this._destBuff;
	                var w = Math.floor((width + 7) / 8);
	                var w1 = Math.floor(width / 8);

	                /*for (var y = 0; y < height; y++) {
	                    var b, x, dp, sp;
	                    var yoffset = y * width;
	                    var ybitoffset = y * w;
	                    var xoffset, targetbyte;
	                    for (x = 0; x < w1; x++) {
	                        xoffset = yoffset + x * 8;
	                        targetbyte = data[ybitoffset + x];
	                        for (b = 7; b >= 0; b--) {
	                            dp = (xoffset + 7 - b) * 3;
	                            sp = (targetbyte >> b & 1) * 3;
	                            dest[dp] = palette[sp];
	                            dest[dp + 1] = palette[sp + 1];
	                            dest[dp + 2] = palette[sp + 2];
	                        }
	                    }

	                    xoffset = yoffset + x * 8;
	                    targetbyte = data[ybitoffset + x];
	                    for (b = 7; b >= 8 - width % 8; b--) {
	                        dp = (xoffset + 7 - b) * 3;
	                        sp = (targetbyte >> b & 1) * 3;
	                        dest[dp] = palette[sp];
	                        dest[dp + 1] = palette[sp + 1];
	                        dest[dp + 2] = palette[sp + 2];
	                    }
	                }*/

	                for (var y = 0; y < height; y++) {
	                    var b, x, dp, sp;
	                    for (x = 0; x < w1; x++) {
	                        for (b = 7; b >= 0; b--) {
	                            dp = (y * width + x * 8 + 7 - b) * 4;
	                            sp = (data[y * w + x] >> b & 1) * 3;
	                            dest[dp] = palette[sp];
	                            dest[dp + 1] = palette[sp + 1];
	                            dest[dp + 2] = palette[sp + 2];
	                            dest[dp + 3] = 255;
	                        }
	                    }

	                    for (b = 7; b >= 8 - width % 8; b--) {
	                        dp = (y * width + x * 8 + 7 - b) * 4;
	                        sp = (data[y * w + x] >> b & 1) * 3;
	                        dest[dp] = palette[sp];
	                        dest[dp + 1] = palette[sp + 1];
	                        dest[dp + 2] = palette[sp + 2];
	                        dest[dp + 3] = 255;
	                    }
	                }

	                return dest;
	            }.bind(this);

	            var indexedToRGBX = function (data, palette, width, height) {
	                // Convert indexed (palette based) image data to RGB
	                var dest = this._destBuff;
	                var total = width * height * 4;
	                for (var i = 0, j = 0; i < total; i += 4, j++) {
	                    var sp = data[j] * 3;
	                    dest[i] = palette[sp];
	                    dest[i + 1] = palette[sp + 1];
	                    dest[i + 2] = palette[sp + 2];
	                    dest[i + 3] = 255;
	                }

	                return dest;
	            }.bind(this);

	            var rQi = this._sock.get_rQi();
	            var rQ = this._sock.rQwhole();
	            var cmode, data;
	            var cl_header, cl_data;

	            var handlePalette = function () {
	                var numColors = rQ[rQi + 2] + 1;
	                var paletteSize = numColors * this._fb_depth;
	                this._FBU.bytes += paletteSize;
	                if (this._sock.rQwait("TIGHT palette " + cmode, this._FBU.bytes)) { return false; }

	                var bpp = (numColors <= 2) ? 1 : 8;
	                var rowSize = Math.floor((this._FBU.width * bpp + 7) / 8);
	                var raw = false;
	                if (rowSize * this._FBU.height < 12) {
	                    raw = true;
	                    cl_header = 0;
	                    cl_data = rowSize * this._FBU.height;
	                    //clength = [0, rowSize * this._FBU.height];
	                } else {
	                    // begin inline getTightCLength (returning two-item arrays is bad for performance with GC)
	                    var cl_offset = rQi + 3 + paletteSize;
	                    cl_header = 1;
	                    cl_data = 0;
	                    cl_data += rQ[cl_offset] & 0x7f;
	                    if (rQ[cl_offset] & 0x80) {
	                        cl_header++;
	                        cl_data += (rQ[cl_offset + 1] & 0x7f) << 7;
	                        if (rQ[cl_offset + 1] & 0x80) {
	                            cl_header++;
	                            cl_data += rQ[cl_offset + 2] << 14;
	                        }
	                    }
	                    // end inline getTightCLength
	                }

	                this._FBU.bytes += cl_header + cl_data;
	                if (this._sock.rQwait("TIGHT " + cmode, this._FBU.bytes)) { return false; }

	                // Shift ctl, filter id, num colors, palette entries, and clength off
	                this._sock.rQskipBytes(3);
	                //var palette = this._sock.rQshiftBytes(paletteSize);
	                this._sock.rQshiftTo(this._paletteBuff, paletteSize);
	                this._sock.rQskipBytes(cl_header);

	                if (raw) {
	                    data = this._sock.rQshiftBytes(cl_data);
	                } else {
	                    data = decompress(this._sock.rQshiftBytes(cl_data), rowSize * this._FBU.height);
	                }

	                // Convert indexed (palette based) image data to RGB
	                var rgbx;
	                if (numColors == 2) {
	                    rgbx = indexedToRGBX2Color(data, this._paletteBuff, this._FBU.width, this._FBU.height);
	                    this._display.blitRgbxImage(this._FBU.x, this._FBU.y, this._FBU.width, this._FBU.height, rgbx, 0, false);
	                } else {
	                    rgbx = indexedToRGBX(data, this._paletteBuff, this._FBU.width, this._FBU.height);
	                    this._display.blitRgbxImage(this._FBU.x, this._FBU.y, this._FBU.width, this._FBU.height, rgbx, 0, false);
	                }


	                return true;
	            }.bind(this);

	            var handleCopy = function () {
	                var raw = false;
	                var uncompressedSize = this._FBU.width * this._FBU.height * this._fb_depth;
	                if (uncompressedSize < 12) {
	                    raw = true;
	                    cl_header = 0;
	                    cl_data = uncompressedSize;
	                } else {
	                    // begin inline getTightCLength (returning two-item arrays is for peformance with GC)
	                    var cl_offset = rQi + 1;
	                    cl_header = 1;
	                    cl_data = 0;
	                    cl_data += rQ[cl_offset] & 0x7f;
	                    if (rQ[cl_offset] & 0x80) {
	                        cl_header++;
	                        cl_data += (rQ[cl_offset + 1] & 0x7f) << 7;
	                        if (rQ[cl_offset + 1] & 0x80) {
	                            cl_header++;
	                            cl_data += rQ[cl_offset + 2] << 14;
	                        }
	                    }
	                    // end inline getTightCLength
	                }
	                this._FBU.bytes = 1 + cl_header + cl_data;
	                if (this._sock.rQwait("TIGHT " + cmode, this._FBU.bytes)) { return false; }

	                // Shift ctl, clength off
	                this._sock.rQshiftBytes(1 + cl_header);

	                if (raw) {
	                    data = this._sock.rQshiftBytes(cl_data);
	                } else {
	                    data = decompress(this._sock.rQshiftBytes(cl_data), uncompressedSize);
	                }

	                this._display.blitRgbImage(this._FBU.x, this._FBU.y, this._FBU.width, this._FBU.height, data, 0, false);

	                return true;
	            }.bind(this);

	            var ctl = this._sock.rQpeek8();

	            // Keep tight reset bits
	            resetStreams = ctl & 0xF;

	            // Figure out filter
	            ctl = ctl >> 4;
	            streamId = ctl & 0x3;

	            if (ctl === 0x08)       cmode = "fill";
	            else if (ctl === 0x09)  cmode = "jpeg";
	            else if (ctl === 0x0A)  cmode = "png";
	            else if (ctl & 0x04)    cmode = "filter";
	            else if (ctl < 0x04)    cmode = "copy";
	            else return this._fail("Illegal tight compression received, ctl: " + ctl);

	            if (isTightPNG && (cmode === "filter" || cmode === "copy")) {
	                return this._fail("filter/copy received in tightPNG mode");
	            }

	            switch (cmode) {
	                // fill use fb_depth because TPIXELs drop the padding byte
	                case "fill":  // TPIXEL
	                    this._FBU.bytes += this._fb_depth;
	                    break;
	                case "jpeg":  // max clength
	                    this._FBU.bytes += 3;
	                    break;
	                case "png":  // max clength
	                    this._FBU.bytes += 3;
	                    break;
	                case "filter":  // filter id + num colors if palette
	                    this._FBU.bytes += 2;
	                    break;
	                case "copy":
	                    break;
	            }

	            if (this._sock.rQwait("TIGHT " + cmode, this._FBU.bytes)) { return false; }

	            // Determine FBU.bytes
	            switch (cmode) {
	                case "fill":
	                    // skip ctl byte
	                    this._display.fillRect(this._FBU.x, this._FBU.y, this._FBU.width, this._FBU.height, [rQ[rQi + 3], rQ[rQi + 2], rQ[rQi + 1]], false);
	                    this._sock.rQskipBytes(4);
	                    break;
	                case "png":
	                case "jpeg":
	                    // begin inline getTightCLength (returning two-item arrays is for peformance with GC)
	                    var cl_offset = rQi + 1;
	                    cl_header = 1;
	                    cl_data = 0;
	                    cl_data += rQ[cl_offset] & 0x7f;
	                    if (rQ[cl_offset] & 0x80) {
	                        cl_header++;
	                        cl_data += (rQ[cl_offset + 1] & 0x7f) << 7;
	                        if (rQ[cl_offset + 1] & 0x80) {
	                            cl_header++;
	                            cl_data += rQ[cl_offset + 2] << 14;
	                        }
	                    }
	                    // end inline getTightCLength
	                    this._FBU.bytes = 1 + cl_header + cl_data;  // ctl + clength size + jpeg-data
	                    if (this._sock.rQwait("TIGHT " + cmode, this._FBU.bytes)) { return false; }

	                    // We have everything, render it
	                    this._sock.rQskipBytes(1 + cl_header);  // shift off clt + compact length
	                    var img = new Image();
	                    img.src = "data: image/" + cmode +
	                        RFB.extract_data_uri(this._sock.rQshiftBytes(cl_data));
	                    this._display.renderQ_push({
	                        'type': 'img',
	                        'img': img,
	                        'x': this._FBU.x,
	                        'y': this._FBU.y
	                    });
	                    img = null;
	                    break;
	                case "filter":
	                    var filterId = rQ[rQi + 1];
	                    if (filterId === 1) {
	                        if (!handlePalette()) { return false; }
	                    } else {
	                        // Filter 0, Copy could be valid here, but servers don't send it as an explicit filter
	                        // Filter 2, Gradient is valid but not use if jpeg is enabled
	                        this._fail("Unsupported tight subencoding received, filter: " + filterId);
	                    }
	                    break;
	                case "copy":
	                    if (!handleCopy()) { return false; }
	                    break;
	            }


	            this._FBU.bytes = 0;
	            this._FBU.rects--;

	            return true;
	        },

	        TIGHT: function () { return this._encHandlers.display_tight(false); },
	        TIGHT_PNG: function () { return this._encHandlers.display_tight(true); },

	        last_rect: function () {
	            this._FBU.rects = 0;
	            return true;
	        },

	        handle_FB_resize: function () {
	            this._fb_width = this._FBU.width;
	            this._fb_height = this._FBU.height;
	            this._destBuff = new Uint8Array(this._fb_width * this._fb_height * 4);
	            this._display.resize(this._fb_width, this._fb_height);
	            this._onFBResize(this, this._fb_width, this._fb_height);
	            this._timing.fbu_rt_start = (new Date()).getTime();

	            this._FBU.bytes = 0;
	            this._FBU.rects -= 1;
	            return true;
	        },

	        ExtendedDesktopSize: function () {
	            this._FBU.bytes = 1;
	            if (this._sock.rQwait("ExtendedDesktopSize", this._FBU.bytes)) { return false; }

	            this._supportsSetDesktopSize = true;
	            var number_of_screens = this._sock.rQpeek8();

	            this._FBU.bytes = 4 + (number_of_screens * 16);
	            if (this._sock.rQwait("ExtendedDesktopSize", this._FBU.bytes)) { return false; }

	            this._sock.rQskipBytes(1);  // number-of-screens
	            this._sock.rQskipBytes(3);  // padding

	            for (var i = 0; i < number_of_screens; i += 1) {
	                // Save the id and flags of the first screen
	                if (i === 0) {
	                    this._screen_id = this._sock.rQshiftBytes(4);    // id
	                    this._sock.rQskipBytes(2);                       // x-position
	                    this._sock.rQskipBytes(2);                       // y-position
	                    this._sock.rQskipBytes(2);                       // width
	                    this._sock.rQskipBytes(2);                       // height
	                    this._screen_flags = this._sock.rQshiftBytes(4); // flags
	                } else {
	                    this._sock.rQskipBytes(16);
	                }
	            }

	            /*
	             * The x-position indicates the reason for the change:
	             *
	             *  0 - server resized on its own
	             *  1 - this client requested the resize
	             *  2 - another client requested the resize
	             */

	            // We need to handle errors when we requested the resize.
	            if (this._FBU.x === 1 && this._FBU.y !== 0) {
	                var msg = "";
	                // The y-position indicates the status code from the server
	                switch (this._FBU.y) {
	                case 1:
	                    msg = "Resize is administratively prohibited";
	                    break;
	                case 2:
	                    msg = "Out of resources";
	                    break;
	                case 3:
	                    msg = "Invalid screen layout";
	                    break;
	                default:
	                    msg = "Unknown reason";
	                    break;
	                }
	                Util.Info("Server did not accept the resize request: " + msg);
	                return true;
	            }

	            this._encHandlers.handle_FB_resize();
	            return true;
	        },

	        DesktopSize: function () {
	            this._encHandlers.handle_FB_resize();
	            return true;
	        },

	        Cursor: function () {
	            Util.Debug(">> set_cursor");
	            var x = this._FBU.x;  // hotspot-x
	            var y = this._FBU.y;  // hotspot-y
	            var w = this._FBU.width;
	            var h = this._FBU.height;

	            var pixelslength = w * h * this._fb_Bpp;
	            var masklength = Math.floor((w + 7) / 8) * h;

	            this._FBU.bytes = pixelslength + masklength;
	            if (this._sock.rQwait("cursor encoding", this._FBU.bytes)) { return false; }

	            this._display.changeCursor(this._sock.rQshiftBytes(pixelslength),
	                                       this._sock.rQshiftBytes(masklength),
	                                       x, y, w, h);

	            this._FBU.bytes = 0;
	            this._FBU.rects--;

	            Util.Debug("<< set_cursor");
	            return true;
	        },

	        JPEG_quality_lo: function () {
	            Util.Error("Server sent jpeg_quality pseudo-encoding");
	        },

	        compress_lo: function () {
	            Util.Error("Server sent compress level pseudo-encoding");
	        }
	    };
	})();

	module.exports = RFB;


/***/ },
/* 1 */
/***/ function(module, exports) {

	/*
	 * noVNC: HTML5 VNC client
	 * Copyright (C) 2012 Joel Martin
	 * Licensed under MPL 2.0 (see LICENSE.txt)
	 *
	 * See README.md for usage and integration instructions.
	 */

	/* jshint white: false, nonstandard: true */
	/*global window, console, document, navigator, ActiveXObject, INCLUDE_URI */

	// Globals defined here
	var Util = {};


	/*
	 * Make arrays quack
	 */

	var addFunc = function (cl, name, func) {
	    if (!cl.prototype[name]) {
	        Object.defineProperty(cl.prototype, name, { enumerable: false, value: func });
	    }
	};

	addFunc(Array, 'push8', function (num) {
	    "use strict";
	    this.push(num & 0xFF);
	});

	addFunc(Array, 'push16', function (num) {
	    "use strict";
	    this.push((num >> 8) & 0xFF,
	              num & 0xFF);
	});

	addFunc(Array, 'push32', function (num) {
	    "use strict";
	    this.push((num >> 24) & 0xFF,
	              (num >> 16) & 0xFF,
	              (num >>  8) & 0xFF,
	              num & 0xFF);
	});

	// IE does not support map (even in IE9)
	//This prototype is provided by the Mozilla foundation and
	//is distributed under the MIT license.
	//http://www.ibiblio.org/pub/Linux/LICENSES/mit.license
	addFunc(Array, 'map', function (fun /*, thisp*/) {
	    "use strict";
	    var len = this.length;
	    if (typeof fun != "function") {
	        throw new TypeError();
	    }

	    var res = new Array(len);
	    var thisp = arguments[1];
	    for (var i = 0; i < len; i++) {
	        if (i in this) {
	            res[i] = fun.call(thisp, this[i], i, this);
	        }
	    }

	    return res;
	});

	// IE <9 does not support indexOf
	//This prototype is provided by the Mozilla foundation and
	//is distributed under the MIT license.
	//http://www.ibiblio.org/pub/Linux/LICENSES/mit.license
	addFunc(Array, 'indexOf', function (elt /*, from*/) {
	    "use strict";
	    var len = this.length >>> 0;

	    var from = Number(arguments[1]) || 0;
	    from = (from < 0) ? Math.ceil(from) : Math.floor(from);
	    if (from < 0) {
	        from += len;
	    }

	    for (; from < len; from++) {
	        if (from in this &&
	                this[from] === elt) {
	            return from;
	        }
	    }
	    return -1;
	});

	// From https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/keys
	if (!Object.keys) {
	    Object.keys = (function () {
	        'use strict';
	        var hasOwnProperty = Object.prototype.hasOwnProperty,
	            hasDontEnumBug = !({toString: null}).propertyIsEnumerable('toString'),
	            dontEnums = [
	                'toString',
	                'toLocaleString',
	                'valueOf',
	                'hasOwnProperty',
	                'isPrototypeOf',
	                'propertyIsEnumerable',
	                'constructor'
	            ],
	            dontEnumsLength = dontEnums.length;

	        return function (obj) {
	            if (typeof obj !== 'object' && (typeof obj !== 'function' || obj === null)) {
	                throw new TypeError('Object.keys called on non-object');
	            }

	            var result = [], prop, i;

	            for (prop in obj) {
	                if (hasOwnProperty.call(obj, prop)) {
	                    result.push(prop);
	                }
	            }

	            if (hasDontEnumBug) {
	                for (i = 0; i < dontEnumsLength; i++) {
	                    if (hasOwnProperty.call(obj, dontEnums[i])) {
	                        result.push(dontEnums[i]);
	                    }
	                }
	            }
	            return result;
	        };
	    })();
	}

	// PhantomJS 1.x doesn't support bind,
	// so leave this in until PhantomJS 2.0 is released
	//This prototype is provided by the Mozilla foundation and
	//is distributed under the MIT license.
	//http://www.ibiblio.org/pub/Linux/LICENSES/mit.license
	addFunc(Function, 'bind', function (oThis) {
	    if (typeof this !== "function") {
	        // closest thing possible to the ECMAScript 5
	        // internal IsCallable function
	        throw new TypeError("Function.prototype.bind - " +
	                            "what is trying to be bound is not callable");
	    }

	    var aArgs = Array.prototype.slice.call(arguments, 1),
	            fToBind = this,
	            fNOP = function () {},
	            fBound = function () {
	                return fToBind.apply(this instanceof fNOP && oThis ? this
	                                                                   : oThis,
	                                     aArgs.concat(Array.prototype.slice.call(arguments)));
	            };

	    fNOP.prototype = this.prototype;
	    fBound.prototype = new fNOP();

	    return fBound;
	});

	//
	// requestAnimationFrame shim with setTimeout fallback
	//

	window.requestAnimFrame = (function () {
	    "use strict";
	    return  window.requestAnimationFrame       ||
	            window.webkitRequestAnimationFrame ||
	            window.mozRequestAnimationFrame    ||
	            window.oRequestAnimationFrame      ||
	            window.msRequestAnimationFrame     ||
	            function (callback) {
	                window.setTimeout(callback, 1000 / 60);
	            };
	})();

	/*
	 * ------------------------------------------------------
	 * Namespaced in Util
	 * ------------------------------------------------------
	 */

	/*
	 * Logging/debug routines
	 */

	Util._log_level = 'warn';
	Util.init_logging = function (level) {
	    "use strict";
	    if (typeof level === 'undefined') {
	        level = Util._log_level;
	    } else {
	        Util._log_level = level;
	    }
	    if (typeof window.console === "undefined") {
	        if (typeof window.opera !== "undefined") {
	            window.console = {
	                'log'  : window.opera.postError,
	                'warn' : window.opera.postError,
	                'error': window.opera.postError
	            };
	        } else {
	            window.console = {
	                'log'  : function (m) {},
	                'warn' : function (m) {},
	                'error': function (m) {}
	            };
	        }
	    }

	    Util.Debug = Util.Info = Util.Warn = Util.Error = function (msg) {};
	    /* jshint -W086 */
	    switch (level) {
	        case 'debug':
	            Util.Debug = function (msg) { console.log(msg); };
	        case 'info':
	            Util.Info  = function (msg) { console.log(msg); };
	        case 'warn':
	            Util.Warn  = function (msg) { console.warn(msg); };
	        case 'error':
	            Util.Error = function (msg) { console.error(msg); };
	        case 'none':
	            break;
	        default:
	            throw new Error("invalid logging type '" + level + "'");
	    }
	    /* jshint +W086 */
	};
	Util.get_logging = function () {
	    return Util._log_level;
	};
	// Initialize logging level
	Util.init_logging();

	Util.make_property = function (proto, name, mode, type) {
	    "use strict";

	    var getter;
	    if (type === 'arr') {
	        getter = function (idx) {
	            if (typeof idx !== 'undefined') {
	                return this['_' + name][idx];
	            } else {
	                return this['_' + name];
	            }
	        };
	    } else {
	        getter = function () {
	            return this['_' + name];
	        };
	    }

	    var make_setter = function (process_val) {
	        if (process_val) {
	            return function (val, idx) {
	                if (typeof idx !== 'undefined') {
	                    this['_' + name][idx] = process_val(val);
	                } else {
	                    this['_' + name] = process_val(val);
	                }
	            };
	        } else {
	            return function (val, idx) {
	                if (typeof idx !== 'undefined') {
	                    this['_' + name][idx] = val;
	                } else {
	                    this['_' + name] = val;
	                }
	            };
	        }
	    };

	    var setter;
	    if (type === 'bool') {
	        setter = make_setter(function (val) {
	            if (!val || (val in {'0': 1, 'no': 1, 'false': 1})) {
	                return false;
	            } else {
	                return true;
	            }
	        });
	    } else if (type === 'int') {
	        setter = make_setter(function (val) { return parseInt(val, 10); });
	    } else if (type === 'float') {
	        setter = make_setter(parseFloat);
	    } else if (type === 'str') {
	        setter = make_setter(String);
	    } else if (type === 'func') {
	        setter = make_setter(function (val) {
	            if (!val) {
	                return function () {};
	            } else {
	                return val;
	            }
	        });
	    } else if (type === 'arr' || type === 'dom' || type == 'raw') {
	        setter = make_setter();
	    } else {
	        throw new Error('Unknown property type ' + type);  // some sanity checking
	    }

	    // set the getter
	    if (typeof proto['get_' + name] === 'undefined') {
	        proto['get_' + name] = getter;
	    }

	    // set the setter if needed
	    if (typeof proto['set_' + name] === 'undefined') {
	        if (mode === 'rw') {
	            proto['set_' + name] = setter;
	        } else if (mode === 'wo') {
	            proto['set_' + name] = function (val, idx) {
	                if (typeof this['_' + name] !== 'undefined') {
	                    throw new Error(name + " can only be set once");
	                }
	                setter.call(this, val, idx);
	            };
	        }
	    }

	    // make a special setter that we can use in set defaults
	    proto['_raw_set_' + name] = function (val, idx) {
	        setter.call(this, val, idx);
	        //delete this['_init_set_' + name];  // remove it after use
	    };
	};

	Util.make_properties = function (constructor, arr) {
	    "use strict";
	    for (var i = 0; i < arr.length; i++) {
	        Util.make_property(constructor.prototype, arr[i][0], arr[i][1], arr[i][2]);
	    }
	};

	Util.set_defaults = function (obj, conf, defaults) {
	    var defaults_keys = Object.keys(defaults);
	    var conf_keys = Object.keys(conf);
	    var keys_obj = {};
	    var i;
	    for (i = 0; i < defaults_keys.length; i++) { keys_obj[defaults_keys[i]] = 1; }
	    for (i = 0; i < conf_keys.length; i++) { keys_obj[conf_keys[i]] = 1; }
	    var keys = Object.keys(keys_obj);

	    for (i = 0; i < keys.length; i++) {
	        var setter = obj['_raw_set_' + keys[i]];
	        if (!setter) {
	          Util.Warn('Invalid property ' + keys[i]);
	          continue;
	        }

	        if (keys[i] in conf) {
	            setter.call(obj, conf[keys[i]]);
	        } else {
	            setter.call(obj, defaults[keys[i]]);
	        }
	    }
	};

	/*
	 * Decode from UTF-8
	 */
	Util.decodeUTF8 = function (utf8string) {
	    "use strict";
	    return decodeURIComponent(escape(utf8string));
	};



	/*
	 * Cross-browser routines
	 */


	// Dynamically load scripts without using document.write()
	// Reference: http://unixpapa.com/js/dyna.html
	//
	// Handles the case where load_scripts is invoked from a script that
	// itself is loaded via load_scripts. Once all scripts are loaded the
	// window.onscriptsloaded handler is called (if set).
	Util.get_include_uri = function () {
	    return (typeof INCLUDE_URI !== "undefined") ? INCLUDE_URI : "include/";
	};
	Util._loading_scripts = [];
	Util._pending_scripts = [];
	Util.load_scripts = function (files) {
	    "use strict";
	    var head = document.getElementsByTagName('head')[0], script,
	        ls = Util._loading_scripts, ps = Util._pending_scripts;

	    var loadFunc = function (e) {
	        while (ls.length > 0 && (ls[0].readyState === 'loaded' ||
	                                 ls[0].readyState === 'complete')) {
	            // For IE, append the script to trigger execution
	            var s = ls.shift();
	            //console.log("loaded script: " + s.src);
	            head.appendChild(s);
	        }
	        if (!this.readyState ||
	            (Util.Engine.presto && this.readyState === 'loaded') ||
	            this.readyState === 'complete') {
	            if (ps.indexOf(this) >= 0) {
	                this.onload = this.onreadystatechange = null;
	                //console.log("completed script: " + this.src);
	                ps.splice(ps.indexOf(this), 1);

	                // Call window.onscriptsload after last script loads
	                if (ps.length === 0 && window.onscriptsload) {
	                    window.onscriptsload();
	                }
	            }
	        }
	    };

	    for (var f = 0; f < files.length; f++) {
	        script = document.createElement('script');
	        script.type = 'text/javascript';
	        script.src = Util.get_include_uri() + files[f];
	        //console.log("loading script: " + script.src);
	        script.onload = script.onreadystatechange = loadFunc;
	        // In-order script execution tricks
	        if (Util.Engine.trident) {
	            // For IE wait until readyState is 'loaded' before
	            // appending it which will trigger execution
	            // http://wiki.whatwg.org/wiki/Dynamic_Script_Execution_Order
	            ls.push(script);
	        } else {
	            // For webkit and firefox set async=false and append now
	            // https://developer.mozilla.org/en-US/docs/HTML/Element/script
	            script.async = false;
	            head.appendChild(script);
	        }
	        ps.push(script);
	    }
	};


	Util.getPosition = function(obj) {
	    "use strict";
	    // NB(sross): the Mozilla developer reference seems to indicate that
	    // getBoundingClientRect includes border and padding, so the canvas
	    // style should NOT include either.
	    var objPosition = obj.getBoundingClientRect();
	    return {'x': objPosition.left + window.pageXOffset, 'y': objPosition.top + window.pageYOffset,
	            'width': objPosition.width, 'height': objPosition.height};
	};


	// Get mouse event position in DOM element
	Util.getEventPosition = function (e, obj, scale) {
	    "use strict";
	    var evt, docX, docY, pos;
	    //if (!e) evt = window.event;
	    evt = (e ? e : window.event);
	    evt = (evt.changedTouches ? evt.changedTouches[0] : evt.touches ? evt.touches[0] : evt);
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
	    var realx = docX - pos.x;
	    var realy = docY - pos.y;
	    var x = Math.max(Math.min(realx, pos.width - 1), 0);
	    var y = Math.max(Math.min(realy, pos.height - 1), 0);
	    return {'x': x / scale, 'y': y / scale, 'realx': realx / scale, 'realy': realy / scale};
	};


	// Event registration. Based on: http://www.scottandrew.com/weblog/articles/cbs-events
	Util.addEvent = function (obj, evType, fn) {
	    "use strict";
	    if (obj.attachEvent) {
	        var r = obj.attachEvent("on" + evType, fn);
	        return r;
	    } else if (obj.addEventListener) {
	        obj.addEventListener(evType, fn, false);
	        return true;
	    } else {
	        throw new Error("Handler could not be attached");
	    }
	};

	Util.removeEvent = function (obj, evType, fn) {
	    "use strict";
	    if (obj.detachEvent) {
	        var r = obj.detachEvent("on" + evType, fn);
	        return r;
	    } else if (obj.removeEventListener) {
	        obj.removeEventListener(evType, fn, false);
	        return true;
	    } else {
	        throw new Error("Handler could not be removed");
	    }
	};

	Util.stopEvent = function (e) {
	    "use strict";
	    if (e.stopPropagation) { e.stopPropagation(); }
	    else                   { e.cancelBubble = true; }

	    if (e.preventDefault)  { e.preventDefault(); }
	    else                   { e.returnValue = false; }
	};

	Util._cursor_uris_supported = null;

	Util.browserSupportsCursorURIs = function () {
	    if (Util._cursor_uris_supported === null) {
	        try {
	            var target = document.createElement('canvas');
	            target.style.cursor = 'url("data:image/x-icon;base64,AAACAAEACAgAAAIAAgA4AQAAFgAAACgAAAAIAAAAEAAAAAEAIAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAD/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////AAAAAAAAAAAAAAAAAAAAAA==") 2 2, default';

	            if (target.style.cursor) {
	                Util.Info("Data URI scheme cursor supported");
	                Util._cursor_uris_supported = true;
	            } else {
	                Util.Warn("Data URI scheme cursor not supported");
	                Util._cursor_uris_supported = false;
	            }
	        } catch (exc) {
	            Util.Error("Data URI scheme cursor test exception: " + exc);
	            Util._cursor_uris_supported = false;
	        }
	    }

	    return Util._cursor_uris_supported;
	};

	// Set browser engine versions. Based on mootools.
	Util.Features = {xpath: !!(document.evaluate), air: !!(window.runtime), query: !!(document.querySelector)};

	(function () {
	    "use strict";
	    // 'presto': (function () { return (!window.opera) ? false : true; }()),
	    var detectPresto = function () {
	        return !!window.opera;
	    };

	    // 'trident': (function () { return (!window.ActiveXObject) ? false : ((window.XMLHttpRequest) ? ((document.querySelectorAll) ? 6 : 5) : 4);
	    var detectTrident = function () {
	        if (!window.ActiveXObject) {
	            return false;
	        } else {
	            if (window.XMLHttpRequest) {
	                return (document.querySelectorAll) ? 6 : 5;
	            } else {
	                return 4;
	            }
	        }
	    };

	    // 'webkit': (function () { try { return (navigator.taintEnabled) ? false : ((Util.Features.xpath) ? ((Util.Features.query) ? 525 : 420) : 419); } catch (e) { return false; } }()),
	    var detectInitialWebkit = function () {
	        try {
	            if (navigator.taintEnabled) {
	                return false;
	            } else {
	                if (Util.Features.xpath) {
	                    return (Util.Features.query) ? 525 : 420;
	                } else {
	                    return 419;
	                }
	            }
	        } catch (e) {
	            return false;
	        }
	    };

	    var detectActualWebkit = function (initial_ver) {
	        var re = /WebKit\/([0-9\.]*) /;
	        var str_ver = (navigator.userAgent.match(re) || ['', initial_ver])[1];
	        return parseFloat(str_ver, 10);
	    };

	    // 'gecko': (function () { return (!document.getBoxObjectFor && window.mozInnerScreenX == null) ? false : ((document.getElementsByClassName) ? 19ssName) ? 19 : 18 : 18); }())
	    var detectGecko = function () {
	        /* jshint -W041 */
	        if (!document.getBoxObjectFor && window.mozInnerScreenX == null) {
	            return false;
	        } else {
	            return (document.getElementsByClassName) ? 19 : 18;
	        }
	        /* jshint +W041 */
	    };

	    Util.Engine = {
	        // Version detection break in Opera 11.60 (errors on arguments.callee.caller reference)
	        //'presto': (function() {
	        //         return (!window.opera) ? false : ((arguments.callee.caller) ? 960 : ((document.getElementsByClassName) ? 950 : 925)); }()),
	        'presto': detectPresto(),
	        'trident': detectTrident(),
	        'webkit': detectInitialWebkit(),
	        'gecko': detectGecko(),
	    };

	    if (Util.Engine.webkit) {
	        // Extract actual webkit version if available
	        Util.Engine.webkit = detectActualWebkit(Util.Engine.webkit);
	    }
	})();

	Util.Flash = (function () {
	    "use strict";
	    var v, version;
	    try {
	        v = navigator.plugins['Shockwave Flash'].description;
	    } catch (err1) {
	        try {
	            v = new ActiveXObject('ShockwaveFlash.ShockwaveFlash').GetVariable('$version');
	        } catch (err2) {
	            v = '0 r0';
	        }
	    }
	    version = v.match(/\d+/g);
	    return {version: parseInt(version[0] || 0 + '.' + version[1], 10) || 0, build: parseInt(version[2], 10) || 0};
	}());


/***/ },
/* 2 */
/***/ function(module, exports, __webpack_require__) {

	/*
	 * noVNC: HTML5 VNC client
	 * Copyright (C) 2012 Joel Martin
	 * Copyright (C) 2015 Samuel Mannehed for Cendio AB
	 * Licensed under MPL 2.0 (see LICENSE.txt)
	 *
	 * See README.md for usage and integration instructions.
	 */

	/*jslint browser: true, white: false */
	/*global Util, Base64, changeCursor */

	var Util = __webpack_require__(1);

	var Display;

	(function () {
	    "use strict";

	    var SUPPORTS_IMAGEDATA_CONSTRUCTOR = false;
	    try {
	        new ImageData(new Uint8ClampedArray(1), 1, 1);
	        SUPPORTS_IMAGEDATA_CONSTRUCTOR = true;
	    } catch (ex) {
	        // ignore failure
	    }

	    Display = function (defaults) {
	        this._drawCtx = null;
	        this._c_forceCanvas = false;

	        this._renderQ = [];  // queue drawing actions for in-oder rendering

	        // the full frame buffer (logical canvas) size
	        this._fb_width = 0;
	        this._fb_height = 0;

	        // the size limit of the viewport (start disabled)
	        this._maxWidth = 0;
	        this._maxHeight = 0;

	        // the visible "physical canvas" viewport
	        this._viewportLoc = { 'x': 0, 'y': 0, 'w': 0, 'h': 0 };
	        this._cleanRect = { 'x1': 0, 'y1': 0, 'x2': -1, 'y2': -1 };

	        this._prevDrawStyle = "";
	        this._tile = null;
	        this._tile16x16 = null;
	        this._tile_x = 0;
	        this._tile_y = 0;

	        Util.set_defaults(this, defaults, {
	            'true_color': true,
	            'colourMap': [],
	            'scale': 1.0,
	            'viewport': false,
	            'render_mode': ''
	        });

	        Util.Debug(">> Display.constructor");

	        if (!this._target) {
	            throw new Error("Target must be set");
	        }

	        if (typeof this._target === 'string') {
	            throw new Error('target must be a DOM element');
	        }

	        if (!this._target.getContext) {
	            throw new Error("no getContext method");
	        }

	        if (!this._drawCtx) {
	            this._drawCtx = this._target.getContext('2d');
	        }

	        Util.Debug("User Agent: " + navigator.userAgent);
	        if (Util.Engine.gecko) { Util.Debug("Browser: gecko " + Util.Engine.gecko); }
	        if (Util.Engine.webkit) { Util.Debug("Browser: webkit " + Util.Engine.webkit); }
	        if (Util.Engine.trident) { Util.Debug("Browser: trident " + Util.Engine.trident); }
	        if (Util.Engine.presto) { Util.Debug("Browser: presto " + Util.Engine.presto); }

	        this.clear();

	        // Check canvas features
	        if ('createImageData' in this._drawCtx) {
	            this._render_mode = 'canvas rendering';
	        } else {
	            throw new Error("Canvas does not support createImageData");
	        }

	        if (this._prefer_js === null) {
	            Util.Info("Prefering javascript operations");
	            this._prefer_js = true;
	        }

	        // Determine browser support for setting the cursor via data URI scheme
	        if (this._cursor_uri || this._cursor_uri === null ||
	                this._cursor_uri === undefined) {
	            this._cursor_uri = Util.browserSupportsCursorURIs();
	        }

	        Util.Debug("<< Display.constructor");
	    };

	    Display.prototype = {
	        // Public methods
	        viewportChangePos: function (deltaX, deltaY) {
	            var vp = this._viewportLoc;
	            deltaX = Math.floor(deltaX);
	            deltaY = Math.floor(deltaY);

	            if (!this._viewport) {
	                deltaX = -vp.w;  // clamped later of out of bounds
	                deltaY = -vp.h;
	            }

	            var vx2 = vp.x + vp.w - 1;
	            var vy2 = vp.y + vp.h - 1;

	            // Position change

	            if (deltaX < 0 && vp.x + deltaX < 0) {
	                deltaX = -vp.x;
	            }
	            if (vx2 + deltaX >= this._fb_width) {
	                deltaX -= vx2 + deltaX - this._fb_width + 1;
	            }

	            if (vp.y + deltaY < 0) {
	                deltaY = -vp.y;
	            }
	            if (vy2 + deltaY >= this._fb_height) {
	                deltaY -= (vy2 + deltaY - this._fb_height + 1);
	            }

	            if (deltaX === 0 && deltaY === 0) {
	                return;
	            }
	            Util.Debug("viewportChange deltaX: " + deltaX + ", deltaY: " + deltaY);

	            vp.x += deltaX;
	            vx2 += deltaX;
	            vp.y += deltaY;
	            vy2 += deltaY;

	            // Update the clean rectangle
	            var cr = this._cleanRect;
	            if (vp.x > cr.x1) {
	                cr.x1 = vp.x;
	            }
	            if (vx2 < cr.x2) {
	                cr.x2 = vx2;
	            }
	            if (vp.y > cr.y1) {
	                cr.y1 = vp.y;
	            }
	            if (vy2 < cr.y2) {
	                cr.y2 = vy2;
	            }

	            var x1, w;
	            if (deltaX < 0) {
	                // Shift viewport left, redraw left section
	                x1 = 0;
	                w = -deltaX;
	            } else {
	                // Shift viewport right, redraw right section
	                x1 = vp.w - deltaX;
	                w = deltaX;
	            }

	            var y1, h;
	            if (deltaY < 0) {
	                // Shift viewport up, redraw top section
	                y1 = 0;
	                h = -deltaY;
	            } else {
	                // Shift viewport down, redraw bottom section
	                y1 = vp.h - deltaY;
	                h = deltaY;
	            }

	            var saveStyle = this._drawCtx.fillStyle;
	            var canvas = this._target;
	            this._drawCtx.fillStyle = "rgb(255,255,255)";

	            // Due to this bug among others [1] we need to disable the image-smoothing to
	            // avoid getting a blur effect when panning.
	            //
	            // 1. https://bugzilla.mozilla.org/show_bug.cgi?id=1194719
	            //
	            // We need to set these every time since all properties are reset
	            // when the the size is changed
	            if (this._drawCtx.mozImageSmoothingEnabled) {
	                this._drawCtx.mozImageSmoothingEnabled = false;
	            } else if (this._drawCtx.webkitImageSmoothingEnabled) {
	                this._drawCtx.webkitImageSmoothingEnabled = false;
	            } else if (this._drawCtx.msImageSmoothingEnabled) {
	                this._drawCtx.msImageSmoothingEnabled = false;
	            } else if (this._drawCtx.imageSmoothingEnabled) {
	                this._drawCtx.imageSmoothingEnabled = false;
	            }

	            // Copy the valid part of the viewport to the shifted location
	            this._drawCtx.drawImage(canvas, 0, 0, vp.w, vp.h, -deltaX, -deltaY, vp.w, vp.h);

	            if (deltaX !== 0) {
	                this._drawCtx.fillRect(x1, 0, w, vp.h);
	            }
	            if (deltaY !== 0) {
	                this._drawCtx.fillRect(0, y1, vp.w, h);
	            }
	            this._drawCtx.fillStyle = saveStyle;
	        },

	        viewportChangeSize: function(width, height) {

	            if (typeof(width) === "undefined" || typeof(height) === "undefined") {

	                Util.Debug("Setting viewport to full display region");
	                width = this._fb_width;
	                height = this._fb_height;
	            }

	            var vp = this._viewportLoc;
	            if (vp.w !== width || vp.h !== height) {

	                if (this._viewport) {
	                    if (this._maxWidth !== 0 && width > this._maxWidth) {
	                        width = this._maxWidth;
	                    }
	                    if (this._maxHeight !== 0 && height > this._maxHeight) {
	                        height = this._maxHeight;
	                    }
	                }

	                var cr = this._cleanRect;

	                if (width < vp.w &&  cr.x2 > vp.x + width - 1) {
	                    cr.x2 = vp.x + width - 1;
	                }
	                if (height < vp.h &&  cr.y2 > vp.y + height - 1) {
	                    cr.y2 = vp.y + height - 1;
	                }

	                vp.w = width;
	                vp.h = height;

	                var canvas = this._target;
	                if (canvas.width !== width || canvas.height !== height) {

	                    // We have to save the canvas data since changing the size will clear it
	                    var saveImg = null;
	                    if (vp.w > 0 && vp.h > 0 && canvas.width > 0 && canvas.height > 0) {
	                        var img_width = canvas.width < vp.w ? canvas.width : vp.w;
	                        var img_height = canvas.height < vp.h ? canvas.height : vp.h;
	                        saveImg = this._drawCtx.getImageData(0, 0, img_width, img_height);
	                    }

	                    if (canvas.width !== width) {
	                        canvas.width = width;
	                        canvas.style.width = width + 'px';
	                    }
	                    if (canvas.height !== height) {
	                        canvas.height = height;
	                        canvas.style.height = height + 'px';
	                    }

	                    if (saveImg) {
	                        this._drawCtx.putImageData(saveImg, 0, 0);
	                    }
	                }
	            }
	        },

	        // Return a map of clean and dirty areas of the viewport and reset the
	        // tracking of clean and dirty areas
	        //
	        // Returns: { 'cleanBox': { 'x': x, 'y': y, 'w': w, 'h': h},
	        //            'dirtyBoxes': [{ 'x': x, 'y': y, 'w': w, 'h': h }, ...] }
	        getCleanDirtyReset: function () {
	            var vp = this._viewportLoc;
	            var cr = this._cleanRect;

	            var cleanBox = { 'x': cr.x1, 'y': cr.y1,
	                             'w': cr.x2 - cr.x1 + 1, 'h': cr.y2 - cr.y1 + 1 };

	            var dirtyBoxes = [];
	            if (cr.x1 >= cr.x2 || cr.y1 >= cr.y2) {
	                // Whole viewport is dirty
	                dirtyBoxes.push({ 'x': vp.x, 'y': vp.y, 'w': vp.w, 'h': vp.h });
	            } else {
	                // Redraw dirty regions
	                var vx2 = vp.x + vp.w - 1;
	                var vy2 = vp.y + vp.h - 1;

	                if (vp.x < cr.x1) {
	                    // left side dirty region
	                    dirtyBoxes.push({'x': vp.x, 'y': vp.y,
	                                     'w': cr.x1 - vp.x + 1, 'h': vp.h});
	                }
	                if (vx2 > cr.x2) {
	                    // right side dirty region
	                    dirtyBoxes.push({'x': cr.x2 + 1, 'y': vp.y,
	                                     'w': vx2 - cr.x2, 'h': vp.h});
	                }
	                if(vp.y < cr.y1) {
	                    // top/middle dirty region
	                    dirtyBoxes.push({'x': cr.x1, 'y': vp.y,
	                                     'w': cr.x2 - cr.x1 + 1, 'h': cr.y1 - vp.y});
	                }
	                if (vy2 > cr.y2) {
	                    // bottom/middle dirty region
	                    dirtyBoxes.push({'x': cr.x1, 'y': cr.y2 + 1,
	                                     'w': cr.x2 - cr.x1 + 1, 'h': vy2 - cr.y2});
	                }
	            }

	            this._cleanRect = {'x1': vp.x, 'y1': vp.y,
	                               'x2': vp.x + vp.w - 1, 'y2': vp.y + vp.h - 1};

	            return {'cleanBox': cleanBox, 'dirtyBoxes': dirtyBoxes};
	        },

	        absX: function (x) {
	            return x + this._viewportLoc.x;
	        },

	        absY: function (y) {
	            return y + this._viewportLoc.y;
	        },

	        resize: function (width, height) {
	            this._prevDrawStyle = "";

	            this._fb_width = width;
	            this._fb_height = height;

	            this._rescale(this._scale);

	            this.viewportChangeSize();
	        },

	        clear: function () {
	            if (this._logo) {
	                this.resize(this._logo.width, this._logo.height);
	                this.blitStringImage(this._logo.data, 0, 0);
	            } else {
	                if (Util.Engine.trident === 6) {
	                    // NB(directxman12): there's a bug in IE10 where we can fail to actually
	                    //                   clear the canvas here because of the resize.
	                    //                   Clearing the current viewport first fixes the issue
	                    this._drawCtx.clearRect(0, 0, this._viewportLoc.w, this._viewportLoc.h);
	                }
	                this.resize(240, 20);
	                this._drawCtx.clearRect(0, 0, this._viewportLoc.w, this._viewportLoc.h);
	            }

	            this._renderQ = [];
	        },

	        fillRect: function (x, y, width, height, color, from_queue) {
	            if (this._renderQ.length !== 0 && !from_queue) {
	                this.renderQ_push({
	                    'type': 'fill',
	                    'x': x,
	                    'y': y,
	                    'width': width,
	                    'height': height,
	                    'color': color
	                });
	            } else {
	                this._setFillColor(color);
	                this._drawCtx.fillRect(x - this._viewportLoc.x, y - this._viewportLoc.y, width, height);
	            }
	        },

	        copyImage: function (old_x, old_y, new_x, new_y, w, h, from_queue) {
	            if (this._renderQ.length !== 0 && !from_queue) {
	                this.renderQ_push({
	                    'type': 'copy',
	                    'old_x': old_x,
	                    'old_y': old_y,
	                    'x': new_x,
	                    'y': new_y,
	                    'width': w,
	                    'height': h,
	                });
	            } else {
	                var x1 = old_x - this._viewportLoc.x;
	                var y1 = old_y - this._viewportLoc.y;
	                var x2 = new_x - this._viewportLoc.x;
	                var y2 = new_y - this._viewportLoc.y;

	                this._drawCtx.drawImage(this._target, x1, y1, w, h, x2, y2, w, h);
	            }
	        },

	        // start updating a tile
	        startTile: function (x, y, width, height, color) {
	            this._tile_x = x;
	            this._tile_y = y;
	            if (width === 16 && height === 16) {
	                this._tile = this._tile16x16;
	            } else {
	                this._tile = this._drawCtx.createImageData(width, height);
	            }

	            if (this._prefer_js) {
	                var bgr;
	                if (this._true_color) {
	                    bgr = color;
	                } else {
	                    bgr = this._colourMap[color[0]];
	                }
	                var red = bgr[2];
	                var green = bgr[1];
	                var blue = bgr[0];

	                var data = this._tile.data;
	                for (var i = 0; i < width * height * 4; i += 4) {
	                    data[i] = red;
	                    data[i + 1] = green;
	                    data[i + 2] = blue;
	                    data[i + 3] = 255;
	                }
	            } else {
	                this.fillRect(x, y, width, height, color, true);
	            }
	        },

	        // update sub-rectangle of the current tile
	        subTile: function (x, y, w, h, color) {
	            if (this._prefer_js) {
	                var bgr;
	                if (this._true_color) {
	                    bgr = color;
	                } else {
	                    bgr = this._colourMap[color[0]];
	                }
	                var red = bgr[2];
	                var green = bgr[1];
	                var blue = bgr[0];
	                var xend = x + w;
	                var yend = y + h;

	                var data = this._tile.data;
	                var width = this._tile.width;
	                for (var j = y; j < yend; j++) {
	                    for (var i = x; i < xend; i++) {
	                        var p = (i + (j * width)) * 4;
	                        data[p] = red;
	                        data[p + 1] = green;
	                        data[p + 2] = blue;
	                        data[p + 3] = 255;
	                    }
	                }
	            } else {
	                this.fillRect(this._tile_x + x, this._tile_y + y, w, h, color, true);
	            }
	        },

	        // draw the current tile to the screen
	        finishTile: function () {
	            if (this._prefer_js) {
	                this._drawCtx.putImageData(this._tile, this._tile_x - this._viewportLoc.x,
	                                           this._tile_y - this._viewportLoc.y);
	            }
	            // else: No-op -- already done by setSubTile
	        },

	        blitImage: function (x, y, width, height, arr, offset, from_queue) {
	            if (this._renderQ.length !== 0 && !from_queue) {
	                // NB(directxman12): it's technically more performant here to use preallocated arrays,
	                // but it's a lot of extra work for not a lot of payoff -- if we're using the render queue,
	                // this probably isn't getting called *nearly* as much
	                var new_arr = new Uint8Array(width * height * 4);
	                new_arr.set(new Uint8Array(arr.buffer, 0, new_arr.length));
	                this.renderQ_push({
	                    'type': 'blit',
	                    'data': new_arr,
	                    'x': x,
	                    'y': y,
	                    'width': width,
	                    'height': height,
	                });
	            } else if (this._true_color) {
	                this._bgrxImageData(x, y, this._viewportLoc.x, this._viewportLoc.y, width, height, arr, offset);
	            } else {
	                this._cmapImageData(x, y, this._viewportLoc.x, this._viewportLoc.y, width, height, arr, offset);
	            }
	        },

	        blitRgbImage: function (x, y , width, height, arr, offset, from_queue) {
	            if (this._renderQ.length !== 0 && !from_queue) {
	                // NB(directxman12): it's technically more performant here to use preallocated arrays,
	                // but it's a lot of extra work for not a lot of payoff -- if we're using the render queue,
	                // this probably isn't getting called *nearly* as much
	                var new_arr = new Uint8Array(width * height * 4);
	                new_arr.set(new Uint8Array(arr.buffer, 0, new_arr.length));
	                this.renderQ_push({
	                    'type': 'blitRgb',
	                    'data': new_arr,
	                    'x': x,
	                    'y': y,
	                    'width': width,
	                    'height': height,
	                });
	            } else if (this._true_color) {
	                this._rgbImageData(x, y, this._viewportLoc.x, this._viewportLoc.y, width, height, arr, offset);
	            } else {
	                // probably wrong?
	                this._cmapImageData(x, y, this._viewportLoc.x, this._viewportLoc.y, width, height, arr, offset);
	            }
	        },

	        blitRgbxImage: function (x, y, width, height, arr, offset, from_queue) {
	            if (this._renderQ.length !== 0 && !from_queue) {
	                // NB(directxman12): it's technically more performant here to use preallocated arrays,
	                // but it's a lot of extra work for not a lot of payoff -- if we're using the render queue,
	                // this probably isn't getting called *nearly* as much
	                var new_arr = new Uint8Array(width * height * 4);
	                new_arr.set(new Uint8Array(arr.buffer, 0, new_arr.length));
	                this.renderQ_push({
	                    'type': 'blitRgbx',
	                    'data': new_arr,
	                    'x': x,
	                    'y': y,
	                    'width': width,
	                    'height': height,
	                });
	            } else {
	                this._rgbxImageData(x, y, this._viewportLoc.x, this._viewportLoc.y, width, height, arr, offset);
	            }
	        },

	        blitStringImage: function (str, x, y) {
	            var img = new Image();
	            img.onload = function () {
	                this._drawCtx.drawImage(img, x - this._viewportLoc.x, y - this._viewportLoc.y);
	            }.bind(this);
	            img.src = str;
	            return img; // for debugging purposes
	        },

	        // wrap ctx.drawImage but relative to viewport
	        drawImage: function (img, x, y) {
	            this._drawCtx.drawImage(img, x - this._viewportLoc.x, y - this._viewportLoc.y);
	        },

	        renderQ_push: function (action) {
	            this._renderQ.push(action);
	            if (this._renderQ.length === 1) {
	                // If this can be rendered immediately it will be, otherwise
	                // the scanner will start polling the queue (every
	                // requestAnimationFrame interval)
	                this._scan_renderQ();
	            }
	        },

	        changeCursor: function (pixels, mask, hotx, hoty, w, h) {
	            if (this._cursor_uri === false) {
	                Util.Warn("changeCursor called but no cursor data URI support");
	                return;
	            }

	            if (this._true_color) {
	                Display.changeCursor(this._target, pixels, mask, hotx, hoty, w, h);
	            } else {
	                Display.changeCursor(this._target, pixels, mask, hotx, hoty, w, h, this._colourMap);
	            }
	        },

	        defaultCursor: function () {
	            this._target.style.cursor = "default";
	        },

	        disableLocalCursor: function () {
	            this._target.style.cursor = "none";
	        },

	        clippingDisplay: function () {
	            var vp = this._viewportLoc;

	            var fbClip = this._fb_width > vp.w || this._fb_height > vp.h;
	            var limitedVp = this._maxWidth !== 0 && this._maxHeight !== 0;
	            var clipping = false;

	            if (limitedVp) {
	                clipping = vp.w > this._maxWidth || vp.h > this._maxHeight;
	            }

	            return fbClip || (limitedVp && clipping);
	        },

	        // Overridden getters/setters
	        get_context: function () {
	            return this._drawCtx;
	        },

	        set_scale: function (scale) {
	            this._rescale(scale);
	        },

	        set_width: function (w) {
	            this._fb_width = w;
	        },
	        get_width: function () {
	            return this._fb_width;
	        },

	        set_height: function (h) {
	            this._fb_height =  h;
	        },
	        get_height: function () {
	            return this._fb_height;
	        },

	        autoscale: function (containerWidth, containerHeight, downscaleOnly) {
	            var targetAspectRatio = containerWidth / containerHeight;
	            var fbAspectRatio = this._fb_width / this._fb_height;

	            var scaleRatio;
	            if (fbAspectRatio >= targetAspectRatio) {
	                scaleRatio = containerWidth / this._fb_width;
	            } else {
	                scaleRatio = containerHeight / this._fb_height;
	            }

	            var targetW, targetH;
	            if (scaleRatio > 1.0 && downscaleOnly) {
	                targetW = this._fb_width;
	                targetH = this._fb_height;
	                scaleRatio = 1.0;
	            } else if (fbAspectRatio >= targetAspectRatio) {
	                targetW = containerWidth;
	                targetH = Math.round(containerWidth / fbAspectRatio);
	            } else {
	                targetW = Math.round(containerHeight * fbAspectRatio);
	                targetH = containerHeight;
	            }

	            // NB(directxman12): If you set the width directly, or set the
	            //                   style width to a number, the canvas is cleared.
	            //                   However, if you set the style width to a string
	            //                   ('NNNpx'), the canvas is scaled without clearing.
	            this._target.style.width = targetW + 'px';
	            this._target.style.height = targetH + 'px';

	            this._scale = scaleRatio;

	            return scaleRatio;  // so that the mouse, etc scale can be set
	        },

	        // Private Methods
	        _rescale: function (factor) {
	            this._scale = factor;

	            var w;
	            var h;

	            if (this._viewport &&
	                this._maxWidth !== 0 && this._maxHeight !== 0) {
	                w = Math.min(this._fb_width, this._maxWidth);
	                h = Math.min(this._fb_height, this._maxHeight);
	            } else {
	                w = this._fb_width;
	                h = this._fb_height;
	            }

	            this._target.style.width = Math.round(factor * w) + 'px';
	            this._target.style.height = Math.round(factor * h) + 'px';
	        },

	        _setFillColor: function (color) {
	            var bgr;
	            if (this._true_color) {
	                bgr = color;
	            } else {
	                bgr = this._colourMap[color];
	            }

	            var newStyle = 'rgb(' + bgr[2] + ',' + bgr[1] + ',' + bgr[0] + ')';
	            if (newStyle !== this._prevDrawStyle) {
	                this._drawCtx.fillStyle = newStyle;
	                this._prevDrawStyle = newStyle;
	            }
	        },

	        _rgbImageData: function (x, y, vx, vy, width, height, arr, offset) {
	            var img = this._drawCtx.createImageData(width, height);
	            var data = img.data;
	            for (var i = 0, j = offset; i < width * height * 4; i += 4, j += 3) {
	                data[i]     = arr[j];
	                data[i + 1] = arr[j + 1];
	                data[i + 2] = arr[j + 2];
	                data[i + 3] = 255;  // Alpha
	            }
	            this._drawCtx.putImageData(img, x - vx, y - vy);
	        },

	        _bgrxImageData: function (x, y, vx, vy, width, height, arr, offset) {
	            var img = this._drawCtx.createImageData(width, height);
	            var data = img.data;
	            for (var i = 0, j = offset; i < width * height * 4; i += 4, j += 4) {
	                data[i]     = arr[j + 2];
	                data[i + 1] = arr[j + 1];
	                data[i + 2] = arr[j];
	                data[i + 3] = 255;  // Alpha
	            }
	            this._drawCtx.putImageData(img, x - vx, y - vy);
	        },

	        _rgbxImageData: function (x, y, vx, vy, width, height, arr, offset) {
	            // NB(directxman12): arr must be an Type Array view
	            var img;
	            if (SUPPORTS_IMAGEDATA_CONSTRUCTOR) {
	                img = new ImageData(new Uint8ClampedArray(arr.buffer, arr.byteOffset, width * height * 4), width, height);
	            } else {
	                img = this._drawCtx.createImageData(width, height);
	                img.data.set(new Uint8ClampedArray(arr.buffer, arr.byteOffset, width * height * 4));
	            }
	            this._drawCtx.putImageData(img, x - vx, y - vy);
	        },

	        _cmapImageData: function (x, y, vx, vy, width, height, arr, offset) {
	            var img = this._drawCtx.createImageData(width, height);
	            var data = img.data;
	            var cmap = this._colourMap;
	            for (var i = 0, j = offset; i < width * height * 4; i += 4, j++) {
	                var bgr = cmap[arr[j]];
	                data[i]     = bgr[2];
	                data[i + 1] = bgr[1];
	                data[i + 2] = bgr[0];
	                data[i + 3] = 255;  // Alpha
	            }
	            this._drawCtx.putImageData(img, x - vx, y - vy);
	        },

	        _scan_renderQ: function () {
	            var ready = true;
	            while (ready && this._renderQ.length > 0) {
	                var a = this._renderQ[0];
	                switch (a.type) {
	                    case 'copy':
	                        this.copyImage(a.old_x, a.old_y, a.x, a.y, a.width, a.height, true);
	                        break;
	                    case 'fill':
	                        this.fillRect(a.x, a.y, a.width, a.height, a.color, true);
	                        break;
	                    case 'blit':
	                        this.blitImage(a.x, a.y, a.width, a.height, a.data, 0, true);
	                        break;
	                    case 'blitRgb':
	                        this.blitRgbImage(a.x, a.y, a.width, a.height, a.data, 0, true);
	                        break;
	                    case 'blitRgbx':
	                        this.blitRgbxImage(a.x, a.y, a.width, a.height, a.data, 0, true);
	                        break;
	                    case 'img':
	                        if (a.img.complete) {
	                            this.drawImage(a.img, a.x, a.y);
	                        } else {
	                            // We need to wait for this image to 'load'
	                            // to keep things in-order
	                            ready = false;
	                        }
	                        break;
	                }

	                if (ready) {
	                    this._renderQ.shift();
	                }
	            }

	            if (this._renderQ.length > 0) {
	                requestAnimFrame(this._scan_renderQ.bind(this));
	            }
	        },
	    };

	    Util.make_properties(Display, [
	        ['target', 'wo', 'dom'],       // Canvas element for rendering
	        ['context', 'ro', 'raw'],      // Canvas 2D context for rendering (read-only)
	        ['logo', 'rw', 'raw'],         // Logo to display when cleared: {"width": w, "height": h, "data": data}
	        ['true_color', 'rw', 'bool'],  // Use true-color pixel data
	        ['colourMap', 'rw', 'arr'],    // Colour map array (when not true-color)
	        ['scale', 'rw', 'float'],      // Display area scale factor 0.0 - 1.0
	        ['viewport', 'rw', 'bool'],    // Use viewport clipping
	        ['width', 'rw', 'int'],        // Display area width
	        ['height', 'rw', 'int'],       // Display area height
	        ['maxWidth', 'rw', 'int'],     // Viewport max width (0 if disabled)
	        ['maxHeight', 'rw', 'int'],    // Viewport max height (0 if disabled)

	        ['render_mode', 'ro', 'str'],  // Canvas rendering mode (read-only)

	        ['prefer_js', 'rw', 'str'],    // Prefer Javascript over canvas methods
	        ['cursor_uri', 'rw', 'raw']    // Can we render cursor using data URI
	    ]);

	    // Class Methods
	    Display.changeCursor = function (target, pixels, mask, hotx, hoty, w0, h0, cmap) {
	        var w = w0;
	        var h = h0;
	        if (h < w) {
	            h = w;  // increase h to make it square
	        } else {
	            w = h;  // increase w to make it square
	        }

	        var cur = [];

	        // Push multi-byte little-endian values
	        cur.push16le = function (num) {
	            this.push(num & 0xFF, (num >> 8) & 0xFF);
	        };
	        cur.push32le = function (num) {
	            this.push(num & 0xFF,
	                      (num >> 8) & 0xFF,
	                      (num >> 16) & 0xFF,
	                      (num >> 24) & 0xFF);
	        };

	        var IHDRsz = 40;
	        var RGBsz = w * h * 4;
	        var XORsz = Math.ceil((w * h) / 8.0);
	        var ANDsz = Math.ceil((w * h) / 8.0);

	        cur.push16le(0);        // 0: Reserved
	        cur.push16le(2);        // 2: .CUR type
	        cur.push16le(1);        // 4: Number of images, 1 for non-animated ico

	        // Cursor #1 header (ICONDIRENTRY)
	        cur.push(w);            // 6: width
	        cur.push(h);            // 7: height
	        cur.push(0);            // 8: colors, 0 -> true-color
	        cur.push(0);            // 9: reserved
	        cur.push16le(hotx);     // 10: hotspot x coordinate
	        cur.push16le(hoty);     // 12: hotspot y coordinate
	        cur.push32le(IHDRsz + RGBsz + XORsz + ANDsz);
	                                // 14: cursor data byte size
	        cur.push32le(22);       // 18: offset of cursor data in the file

	        // Cursor #1 InfoHeader (ICONIMAGE/BITMAPINFO)
	        cur.push32le(IHDRsz);   // 22: InfoHeader size
	        cur.push32le(w);        // 26: Cursor width
	        cur.push32le(h * 2);    // 30: XOR+AND height
	        cur.push16le(1);        // 34: number of planes
	        cur.push16le(32);       // 36: bits per pixel
	        cur.push32le(0);        // 38: Type of compression

	        cur.push32le(XORsz + ANDsz);
	                                // 42: Size of Image
	        cur.push32le(0);        // 46: reserved
	        cur.push32le(0);        // 50: reserved
	        cur.push32le(0);        // 54: reserved
	        cur.push32le(0);        // 58: reserved

	        // 62: color data (RGBQUAD icColors[])
	        var y, x;
	        for (y = h - 1; y >= 0; y--) {
	            for (x = 0; x < w; x++) {
	                if (x >= w0 || y >= h0) {
	                    cur.push(0);  // blue
	                    cur.push(0);  // green
	                    cur.push(0);  // red
	                    cur.push(0);  // alpha
	                } else {
	                    var idx = y * Math.ceil(w0 / 8) + Math.floor(x / 8);
	                    var alpha = (mask[idx] << (x % 8)) & 0x80 ? 255 : 0;
	                    if (cmap) {
	                        idx = (w0 * y) + x;
	                        var rgb = cmap[pixels[idx]];
	                        cur.push(rgb[2]);  // blue
	                        cur.push(rgb[1]);  // green
	                        cur.push(rgb[0]);  // red
	                        cur.push(alpha);   // alpha
	                    } else {
	                        idx = ((w0 * y) + x) * 4;
	                        cur.push(pixels[idx + 2]); // blue
	                        cur.push(pixels[idx + 1]); // green
	                        cur.push(pixels[idx]);     // red
	                        cur.push(alpha);           // alpha
	                    }
	                }
	            }
	        }

	        // XOR/bitmask data (BYTE icXOR[])
	        // (ignored, just needs to be the right size)
	        for (y = 0; y < h; y++) {
	            for (x = 0; x < Math.ceil(w / 8); x++) {
	                cur.push(0);
	            }
	        }

	        // AND/bitmask data (BYTE icAND[])
	        // (ignored, just needs to be the right size)
	        for (y = 0; y < h; y++) {
	            for (x = 0; x < Math.ceil(w / 8); x++) {
	                cur.push(0);
	            }
	        }

	        var url = 'data:image/x-icon;base64,' + Base64.encode(cur);
	        target.style.cursor = 'url(' + url + ')' + hotx + ' ' + hoty + ', default';
	    };
	})();

	module.exports = Display;


/***/ },
/* 3 */
/***/ function(module, exports, __webpack_require__) {

	/*
	 * noVNC: HTML5 VNC client
	 * Copyright (C) 2012 Joel Martin
	 * Copyright (C) 2013 Samuel Mannehed for Cendio AB
	 * Licensed under MPL 2.0 or any later version (see LICENSE.txt)
	 */

	/*jslint browser: true, white: false */
	/*global window, Util */

	var Util = __webpack_require__(1);
	var kbdUtil = __webpack_require__(4).kbdUtil;
	var KeyEventDecoder = __webpack_require__(4).KeyEventDecoder;
	var VerifyCharModifier = __webpack_require__(4).VerifyCharModifier;
	var TrackKeyState = __webpack_require__(4).TrackKeyState;
	var EscapeModifiers = __webpack_require__(4).EscapeModifiers;
	var inflator = __webpack_require__(7);

	var Keyboard, Mouse;

	(function () {
	    "use strict";

	    //
	    // Keyboard event handler
	    //

	    Keyboard = function (defaults) {
	        this._keyDownList = [];         // List of depressed keys
	                                        // (even if they are happy)

	        Util.set_defaults(this, defaults, {
	            'target': document,
	            'focused': true
	        });

	        // create the keyboard handler
	        this._handler = new KeyEventDecoder(kbdUtil.ModifierSync(),
	            VerifyCharModifier( /* jshint newcap: false */
	                TrackKeyState(
	                    EscapeModifiers(this._handleRfbEvent.bind(this))
	                )
	            )
	        ); /* jshint newcap: true */

	        // keep these here so we can refer to them later
	        this._eventHandlers = {
	            'keyup': this._handleKeyUp.bind(this),
	            'keydown': this._handleKeyDown.bind(this),
	            'keypress': this._handleKeyPress.bind(this),
	            'blur': this._allKeysUp.bind(this)
	        };
	    };

	    Keyboard.prototype = {
	        // private methods

	        _handleRfbEvent: function (e) {
	            if (this._onKeyPress) {
	                Util.Debug("onKeyPress " + (e.type == 'keydown' ? "down" : "up") +
	                           ", keysym: " + e.keysym.keysym + "(" + e.keysym.keyname + ")");
	                this._onKeyPress(e.keysym.keysym, e.type == 'keydown');
	            }
	        },

	        _handleKeyDown: function (e) {
	            if (!this._focused) { return true; }

	            if (this._handler.keydown(e)) {
	                // Suppress bubbling/default actions
	                Util.stopEvent(e);
	                return false;
	            } else {
	                // Allow the event to bubble and become a keyPress event which
	                // will have the character code translated
	                return true;
	            }
	        },

	        _handleKeyPress: function (e) {
	            if (!this._focused) { return true; }

	            if (this._handler.keypress(e)) {
	                // Suppress bubbling/default actions
	                Util.stopEvent(e);
	                return false;
	            } else {
	                // Allow the event to bubble and become a keyPress event which
	                // will have the character code translated
	                return true;
	            }
	        },

	        _handleKeyUp: function (e) {
	            if (!this._focused) { return true; }

	            if (this._handler.keyup(e)) {
	                // Suppress bubbling/default actions
	                Util.stopEvent(e);
	                return false;
	            } else {
	                // Allow the event to bubble and become a keyPress event which
	                // will have the character code translated
	                return true;
	            }
	        },

	        _allKeysUp: function () {
	            Util.Debug(">> Keyboard.allKeysUp");
	            this._handler.releaseAll();
	            Util.Debug("<< Keyboard.allKeysUp");
	        },

	        // Public methods

	        grab: function () {
	            //Util.Debug(">> Keyboard.grab");
	            var c = this._target;

	            Util.addEvent(c, 'keydown', this._eventHandlers.keydown);
	            Util.addEvent(c, 'keyup', this._eventHandlers.keyup);
	            Util.addEvent(c, 'keypress', this._eventHandlers.keypress);

	            // Release (key up) if window loses focus
	            Util.addEvent(window, 'blur', this._eventHandlers.blur);

	            //Util.Debug("<< Keyboard.grab");
	        },

	        ungrab: function () {
	            //Util.Debug(">> Keyboard.ungrab");
	            var c = this._target;

	            Util.removeEvent(c, 'keydown', this._eventHandlers.keydown);
	            Util.removeEvent(c, 'keyup', this._eventHandlers.keyup);
	            Util.removeEvent(c, 'keypress', this._eventHandlers.keypress);
	            Util.removeEvent(window, 'blur', this._eventHandlers.blur);

	            // Release (key up) all keys that are in a down state
	            this._allKeysUp();

	            //Util.Debug(">> Keyboard.ungrab");
	        },

	        sync: function (e) {
	            this._handler.syncModifiers(e);
	        }
	    };

	    Util.make_properties(Keyboard, [
	        ['target',     'wo', 'dom'],  // DOM element that captures keyboard input
	        ['focused',    'rw', 'bool'], // Capture and send key events

	        ['onKeyPress', 'rw', 'func'] // Handler for key press/release
	    ]);

	    //
	    // Mouse event handler
	    //

	    Mouse = function (defaults) {
	        this._mouseCaptured  = false;

	        this._doubleClickTimer = null;
	        this._lastTouchPos = null;

	        // Configuration attributes
	        Util.set_defaults(this, defaults, {
	            'target': document,
	            'focused': true,
	            'scale': 1.0,
	            'touchButton': 1
	        });

	        this._eventHandlers = {
	            'mousedown': this._handleMouseDown.bind(this),
	            'mouseup': this._handleMouseUp.bind(this),
	            'mousemove': this._handleMouseMove.bind(this),
	            'mousewheel': this._handleMouseWheel.bind(this),
	            'mousedisable': this._handleMouseDisable.bind(this)
	        };
	    };

	    Mouse.prototype = {
	        // private methods
	        _captureMouse: function () {
	            // capturing the mouse ensures we get the mouseup event
	            if (this._target.setCapture) {
	                this._target.setCapture();
	            }

	            // some browsers give us mouseup events regardless,
	            // so if we never captured the mouse, we can disregard the event
	            this._mouseCaptured = true;
	        },

	        _releaseMouse: function () {
	            if (this._target.releaseCapture) {
	                this._target.releaseCapture();
	            }
	            this._mouseCaptured = false;
	        },

	        _resetDoubleClickTimer: function () {
	            this._doubleClickTimer = null;
	        },

	        _handleMouseButton: function (e, down) {
	            if (!this._focused) { return true; }

	            if (this._notify) {
	                this._notify(e);
	            }

	            var evt = (e ? e : window.event);
	            var pos = Util.getEventPosition(e, this._target, this._scale);

	            var bmask;
	            if (e.touches || e.changedTouches) {
	                // Touch device

	                // When two touches occur within 500 ms of each other and are
	                // close enough together a double click is triggered.
	                if (down == 1) {
	                    if (this._doubleClickTimer === null) {
	                        this._lastTouchPos = pos;
	                    } else {
	                        clearTimeout(this._doubleClickTimer);

	                        // When the distance between the two touches is small enough
	                        // force the position of the latter touch to the position of
	                        // the first.

	                        var xs = this._lastTouchPos.x - pos.x;
	                        var ys = this._lastTouchPos.y - pos.y;
	                        var d = Math.sqrt((xs * xs) + (ys * ys));

	                        // The goal is to trigger on a certain physical width, the
	                        // devicePixelRatio brings us a bit closer but is not optimal.
	                        var threshold = 20 * (window.devicePixelRatio || 1);
	                        if (d < threshold) {
	                            pos = this._lastTouchPos;
	                        }
	                    }
	                    this._doubleClickTimer = setTimeout(this._resetDoubleClickTimer.bind(this), 500);
	                }
	                bmask = this._touchButton;
	                // If bmask is set
	            } else if (evt.which) {
	                /* everything except IE */
	                bmask = 1 << evt.button;
	            } else {
	                /* IE including 9 */
	                bmask = (evt.button & 0x1) +      // Left
	                        (evt.button & 0x2) * 2 +  // Right
	                        (evt.button & 0x4) / 2;   // Middle
	            }

	            if (this._onMouseButton) {
	                Util.Debug("onMouseButton " + (down ? "down" : "up") +
	                           ", x: " + pos.x + ", y: " + pos.y + ", bmask: " + bmask);
	                this._onMouseButton(pos.x, pos.y, down, bmask);
	            }
	            Util.stopEvent(e);
	            return false;
	        },

	        _handleMouseDown: function (e) {
	            this._captureMouse();
	            this._handleMouseButton(e, 1);
	        },

	        _handleMouseUp: function (e) {
	            if (!this._mouseCaptured) { return; }

	            this._handleMouseButton(e, 0);
	            this._releaseMouse();
	        },

	        _handleMouseWheel: function (e) {
	            if (!this._focused) { return true; }

	            if (this._notify) {
	                this._notify(e);
	            }

	            var evt = (e ? e : window.event);
	            var pos = Util.getEventPosition(e, this._target, this._scale);
	            var wheelData = evt.detail ? evt.detail * -1 : evt.wheelDelta / 40;
	            var bmask;
	            if (wheelData > 0) {
	                bmask = 1 << 3;
	            } else {
	                bmask = 1 << 4;
	            }

	            if (this._onMouseButton) {
	                this._onMouseButton(pos.x, pos.y, 1, bmask);
	                this._onMouseButton(pos.x, pos.y, 0, bmask);
	            }
	            Util.stopEvent(e);
	            return false;
	        },

	        _handleMouseMove: function (e) {
	            if (! this._focused) { return true; }

	            if (this._notify) {
	                this._notify(e);
	            }

	            var evt = (e ? e : window.event);
	            var pos = Util.getEventPosition(e, this._target, this._scale);
	            if (this._onMouseMove) {
	                this._onMouseMove(pos.x, pos.y);
	            }
	            Util.stopEvent(e);
	            return false;
	        },

	        _handleMouseDisable: function (e) {
	            if (!this._focused) { return true; }

	            var evt = (e ? e : window.event);
	            var pos = Util.getEventPosition(e, this._target, this._scale);

	            /* Stop propagation if inside canvas area */
	            if ((pos.realx >= 0) && (pos.realy >= 0) &&
	                (pos.realx < this._target.offsetWidth) &&
	                (pos.realy < this._target.offsetHeight)) {
	                //Util.Debug("mouse event disabled");
	                Util.stopEvent(e);
	                return false;
	            }

	            return true;
	        },


	        // Public methods
	        grab: function () {
	            var c = this._target;

	            if ('ontouchstart' in document.documentElement) {
	                Util.addEvent(c, 'touchstart', this._eventHandlers.mousedown);
	                Util.addEvent(window, 'touchend', this._eventHandlers.mouseup);
	                Util.addEvent(c, 'touchend', this._eventHandlers.mouseup);
	                Util.addEvent(c, 'touchmove', this._eventHandlers.mousemove);
	            } else {
	                Util.addEvent(c, 'mousedown', this._eventHandlers.mousedown);
	                Util.addEvent(window, 'mouseup', this._eventHandlers.mouseup);
	                Util.addEvent(c, 'mouseup', this._eventHandlers.mouseup);
	                Util.addEvent(c, 'mousemove', this._eventHandlers.mousemove);
	                Util.addEvent(c, (Util.Engine.gecko) ? 'DOMMouseScroll' : 'mousewheel',
	                              this._eventHandlers.mousewheel);
	            }

	            /* Work around right and middle click browser behaviors */
	            Util.addEvent(document, 'click', this._eventHandlers.mousedisable);
	            Util.addEvent(document.body, 'contextmenu', this._eventHandlers.mousedisable);
	        },

	        ungrab: function () {
	            var c = this._target;

	            if ('ontouchstart' in document.documentElement) {
	                Util.removeEvent(c, 'touchstart', this._eventHandlers.mousedown);
	                Util.removeEvent(window, 'touchend', this._eventHandlers.mouseup);
	                Util.removeEvent(c, 'touchend', this._eventHandlers.mouseup);
	                Util.removeEvent(c, 'touchmove', this._eventHandlers.mousemove);
	            } else {
	                Util.removeEvent(c, 'mousedown', this._eventHandlers.mousedown);
	                Util.removeEvent(window, 'mouseup', this._eventHandlers.mouseup);
	                Util.removeEvent(c, 'mouseup', this._eventHandlers.mouseup);
	                Util.removeEvent(c, 'mousemove', this._eventHandlers.mousemove);
	                Util.removeEvent(c, (Util.Engine.gecko) ? 'DOMMouseScroll' : 'mousewheel',
	                                 this._eventHandlers.mousewheel);
	            }

	            /* Work around right and middle click browser behaviors */
	            Util.removeEvent(document, 'click', this._eventHandlers.mousedisable);
	            Util.removeEvent(document.body, 'contextmenu', this._eventHandlers.mousedisable);

	        }
	    };

	    Util.make_properties(Mouse, [
	        ['target',         'ro', 'dom'],   // DOM element that captures mouse input
	        ['notify',         'ro', 'func'],  // Function to call to notify whenever a mouse event is received
	        ['focused',        'rw', 'bool'],  // Capture and send mouse clicks/movement
	        ['scale',          'rw', 'float'], // Viewport scale factor 0.0 - 1.0

	        ['onMouseButton',  'rw', 'func'],  // Handler for mouse button click/release
	        ['onMouseMove',    'rw', 'func'],  // Handler for mouse movement
	        ['touchButton',    'rw', 'int']    // Button mask (1, 2, 4) for touch devices (0 means ignore clicks)
	    ]);
	})();

	module.exports = { Keyboard: Keyboard, Mouse: Mouse };


/***/ },
/* 4 */
/***/ function(module, exports, __webpack_require__) {

	var keysyms = __webpack_require__(5);
	var Keys = __webpack_require__(6)

	var kbdUtil = (function() {
	    "use strict";

	    function substituteCodepoint(cp) {
	        // Any Unicode code points which do not have corresponding keysym entries
	        // can be swapped out for another code point by adding them to this table
	        var substitutions = {
	            // {S,s} with comma below -> {S,s} with cedilla
	            0x218 : 0x15e,
	            0x219 : 0x15f,
	            // {T,t} with comma below -> {T,t} with cedilla
	            0x21a : 0x162,
	            0x21b : 0x163
	        };

	        var sub = substitutions[cp];
	        return sub ? sub : cp;
	    }

	    function isMac() {
	        return navigator && !!(/mac/i).exec(navigator.platform);
	    }
	    function isWindows() {
	        return navigator && !!(/win/i).exec(navigator.platform);
	    }
	    function isLinux() {
	        return navigator && !!(/linux/i).exec(navigator.platform);
	    }

	    // Return true if a modifier which is not the specified char modifier (and is not shift) is down
	    function hasShortcutModifier(charModifier, currentModifiers) {
	        var mods = {};
	        for (var key in currentModifiers) {
	            if (parseInt(key) !== Keys.XK_Shift_L) {
	                mods[key] = currentModifiers[key];
	            }
	        }

	        var sum = 0;
	        for (var k in currentModifiers) {
	            if (mods[k]) {
	                ++sum;
	            }
	        }
	        if (hasCharModifier(charModifier, mods)) {
	            return sum > charModifier.length;
	        }
	        else {
	            return sum > 0;
	        }
	    }

	    // Return true if the specified char modifier is currently down
	    function hasCharModifier(charModifier, currentModifiers) {
	        if (charModifier.length === 0) { return false; }

	        for (var i = 0; i < charModifier.length; ++i) {
	            if (!currentModifiers[charModifier[i]]) {
	                return false;
	            }
	        }
	        return true;
	    }

	    // Helper object tracking modifier key state
	    // and generates fake key events to compensate if it gets out of sync
	    function ModifierSync(charModifier) {
	        if (!charModifier) {
	            if (isMac()) {
	                // on Mac, Option (AKA Alt) is used as a char modifier
	                charModifier = [Keys.XK_Alt_L];
	            }
	            else if (isWindows()) {
	                // on Windows, Ctrl+Alt is used as a char modifier
	                charModifier = [Keys.XK_Alt_L, XK_Control_L];
	            }
	            else if (isLinux()) {
	                // on Linux, ISO Level 3 Shift (AltGr) is used as a char modifier
	                charModifier = [Keys.XK_ISO_Level3_Shift];
	            }
	            else {
	                charModifier = [];
	            }
	        }

	        var state = {};
	        state[Keys.XK_Control_L] = false;
	        state[Keys.XK_Alt_L] = false;
	        state[Keys.XK_ISO_Level3_Shift] = false;
	        state[Keys.XK_Shift_L] = false;
	        state[Keys.XK_Meta_L] = false;

	        function sync(evt, keysym) {
	            var result = [];
	            function syncKey(keysym) {
	                return {keysym: keysyms.lookup(keysym), type: state[keysym] ? 'keydown' : 'keyup'};
	            }

	            if (evt.ctrlKey !== undefined &&
	                evt.ctrlKey !== state[Keys.XK_Control_L] && keysym !== XK_Control_L) {
	                state[Keys.XK_Control_L] = evt.ctrlKey;
	                result.push(syncKey(Keys.XK_Control_L));
	            }
	            if (evt.altKey !== undefined &&
	                evt.altKey !== state[Keys.XK_Alt_L] && keysym !== XK_Alt_L) {
	                state[Keys.XK_Alt_L] = evt.altKey;
	                result.push(syncKey(Keys.XK_Alt_L));
	            }
	            if (evt.altGraphKey !== undefined &&
	                evt.altGraphKey !== state[Keys.XK_ISO_Level3_Shift] && keysym !== XK_ISO_Level3_Shift) {
	                state[Keys.XK_ISO_Level3_Shift] = evt.altGraphKey;
	                result.push(syncKey(Keys.XK_ISO_Level3_Shift));
	            }
	            if (evt.shiftKey !== undefined &&
	                evt.shiftKey !== state[Keys.XK_Shift_L] && keysym !== XK_Shift_L) {
	                state[Keys.XK_Shift_L] = evt.shiftKey;
	                result.push(syncKey(Keys.XK_Shift_L));
	            }
	            if (evt.metaKey !== undefined &&
	                evt.metaKey !== state[Keys.XK_Meta_L] && keysym !== XK_Meta_L) {
	                state[Keys.XK_Meta_L] = evt.metaKey;
	                result.push(syncKey(Keys.XK_Meta_L));
	            }
	            return result;
	        }
	        function syncKeyEvent(evt, down) {
	            var obj = getKeysym(evt);
	            var keysym = obj ? obj.keysym : null;

	            // first, apply the event itself, if relevant
	            if (keysym !== null && state[keysym] !== undefined) {
	                state[keysym] = down;
	            }
	            return sync(evt, keysym);
	        }

	        return {
	            // sync on the appropriate keyboard event
	            keydown: function(evt) { return syncKeyEvent(evt, true);},
	            keyup: function(evt) { return syncKeyEvent(evt, false);},
	            // Call this with a non-keyboard event (such as mouse events) to use its modifier state to synchronize anyway
	            syncAny: function(evt) { return sync(evt);},

	            // is a shortcut modifier down?
	            hasShortcutModifier: function() { return hasShortcutModifier(charModifier, state); },
	            // if a char modifier is down, return the keys it consists of, otherwise return null
	            activeCharModifier: function() { return hasCharModifier(charModifier, state) ? charModifier : null; }
	        };
	    }

	    // Get a key ID from a keyboard event
	    // May be a string or an integer depending on the available properties
	    function getKey(evt){
	        if ('keyCode' in evt && 'key' in evt) {
	            return evt.key + ':' + evt.keyCode;
	        }
	        else if ('keyCode' in evt) {
	            return evt.keyCode;
	        }
	        else {
	            return evt.key;
	        }
	    }

	    // Get the most reliable keysym value we can get from a key event
	    // if char/charCode is available, prefer those, otherwise fall back to key/keyCode/which
	    function getKeysym(evt){
	        var codepoint;
	        if (evt.char && evt.char.length === 1) {
	            codepoint = evt.char.charCodeAt();
	        }
	        else if (evt.charCode) {
	            codepoint = evt.charCode;
	        }
	        else if (evt.keyCode && evt.type === 'keypress') {
	            // IE10 stores the char code as keyCode, and has no other useful properties
	            codepoint = evt.keyCode;
	        }
	        if (codepoint) {
	            var res = keysyms.fromUnicode(substituteCodepoint(codepoint));
	            if (res) {
	                return res;
	            }
	        }
	        // we could check evt.key here.
	        // Legal values are defined in http://www.w3.org/TR/DOM-Level-3-Events/#key-values-list,
	        // so we "just" need to map them to keysym, but AFAIK this is only available in IE10, which also provides evt.key
	        // so we don't *need* it yet
	        if (evt.keyCode) {
	            return keysyms.lookup(keysymFromKeyCode(evt.keyCode, evt.shiftKey));
	        }
	        if (evt.which) {
	            return keysyms.lookup(keysymFromKeyCode(evt.which, evt.shiftKey));
	        }
	        return null;
	    }

	    // Given a keycode, try to predict which keysym it might be.
	    // If the keycode is unknown, null is returned.
	    function keysymFromKeyCode(keycode, shiftPressed) {
	        if (typeof(keycode) !== 'number') {
	            return null;
	        }
	        // won't be accurate for azerty
	        if (keycode >= 0x30 && keycode <= 0x39) {
	            return keycode; // digit
	        }
	        if (keycode >= 0x41 && keycode <= 0x5a) {
	            // remap to lowercase unless shift is down
	            return shiftPressed ? keycode : keycode + 32; // A-Z
	        }
	        if (keycode >= 0x60 && keycode <= 0x69) {
	            return Keys.XK_KP_0 + (keycode - 0x60); // numpad 0-9
	        }

	        switch(keycode) {
	            case 0x20: return Keys.XK_space;
	            case 0x6a: return Keys.XK_KP_Multiply;
	            case 0x6b: return Keys.XK_KP_Add;
	            case 0x6c: return Keys.XK_KP_Separator;
	            case 0x6d: return Keys.XK_KP_Subtract;
	            case 0x6e: return Keys.XK_KP_Decimal;
	            case 0x6f: return Keys.XK_KP_Divide;
	            case 0xbb: return Keys.XK_plus;
	            case 0xbc: return Keys.XK_comma;
	            case 0xbd: return Keys.XK_minus;
	            case 0xbe: return Keys.XK_period;
	        }

	        return nonCharacterKey({keyCode: keycode});
	    }

	    // if the key is a known non-character key (any key which doesn't generate character data)
	    // return its keysym value. Otherwise return null
	    function nonCharacterKey(evt) {
	        // evt.key not implemented yet
	        if (!evt.keyCode) { return null; }
	        var keycode = evt.keyCode;

	        if (keycode >= 0x70 && keycode <= 0x87) {
	            return Keys.XK_F1 + keycode - 0x70; // F1-F24
	        }
	        switch (keycode) {

	            case 8 : return Keys.XK_BackSpace;
	            case 13 : return Keys.XK_Return;

	            case 9 : return Keys.XK_Tab;

	            case 27 : return Keys.XK_Escape;
	            case 46 : return Keys.XK_Delete;

	            case 36 : return Keys.XK_Home;
	            case 35 : return Keys.XK_End;
	            case 33 : return Keys.XK_Page_Up;
	            case 34 : return Keys.XK_Page_Down;
	            case 45 : return Keys.XK_Insert;

	            case 37 : return Keys.XK_Left;
	            case 38 : return Keys.XK_Up;
	            case 39 : return Keys.XK_Right;
	            case 40 : return Keys.XK_Down;

	            case 16 : return Keys.XK_Shift_L;
	            case 17 : return Keys.XK_Control_L;
	            case 18 : return Keys.XK_Alt_L; // also: Option-key on Mac

	            case 224 : return Keys.XK_Meta_L;
	            case 225 : return Keys.XK_ISO_Level3_Shift; // AltGr
	            case 91 : return Keys.XK_Super_L; // also: Windows-key
	            case 92 : return Keys.XK_Super_R; // also: Windows-key
	            case 93 : return Keys.XK_Menu; // also: Windows-Menu, Command on Mac
	            default: return null;
	        }
	    }
	    return {
	        hasShortcutModifier : hasShortcutModifier,
	        hasCharModifier : hasCharModifier,
	        ModifierSync : ModifierSync,
	        getKey : getKey,
	        getKeysym : getKeysym,
	        keysymFromKeyCode : keysymFromKeyCode,
	        nonCharacterKey : nonCharacterKey,
	        substituteCodepoint : substituteCodepoint
	    };
	})();

	// Takes a DOM keyboard event and:
	// - determines which keysym it represents
	// - determines a keyId  identifying the key that was pressed (corresponding to the key/keyCode properties on the DOM event)
	// - synthesizes events to synchronize modifier key state between which modifiers are actually down, and which we thought were down
	// - marks each event with an 'escape' property if a modifier was down which should be "escaped"
	// - generates a "stall" event in cases where it might be necessary to wait and see if a keypress event follows a keydown
	// This information is collected into an object which is passed to the next() function. (one call per event)
	function KeyEventDecoder(modifierState, next) {
	    "use strict";
	    function sendAll(evts) {
	        for (var i = 0; i < evts.length; ++i) {
	            next(evts[i]);
	        }
	    }
	    function process(evt, type) {
	        var result = {type: type};
	        var keyId = kbdUtil.getKey(evt);
	        if (keyId) {
	            result.keyId = keyId;
	        }

	        var keysym = kbdUtil.getKeysym(evt);

	        var hasModifier = modifierState.hasShortcutModifier() || !!modifierState.activeCharModifier();
	        // Is this a case where we have to decide on the keysym right away, rather than waiting for the keypress?
	        // "special" keys like enter, tab or backspace don't send keypress events,
	        // and some browsers don't send keypresses at all if a modifier is down
	        if (keysym && (type !== 'keydown' || kbdUtil.nonCharacterKey(evt) || hasModifier)) {
	            result.keysym = keysym;
	        }

	        var isShift = evt.keyCode === 0x10 || evt.key === 'Shift';

	        // Should we prevent the browser from handling the event?
	        // Doing so on a keydown (in most browsers) prevents keypress from being generated
	        // so only do that if we have to.
	        var suppress = !isShift && (type !== 'keydown' || modifierState.hasShortcutModifier() || !!kbdUtil.nonCharacterKey(evt));

	        // If a char modifier is down on a keydown, we need to insert a stall,
	        // so VerifyCharModifier knows to wait and see if a keypress is comnig
	        var stall = type === 'keydown' && modifierState.activeCharModifier() && !kbdUtil.nonCharacterKey(evt);

	        // if a char modifier is pressed, get the keys it consists of (on Windows, AltGr is equivalent to Ctrl+Alt)
	        var active = modifierState.activeCharModifier();

	        // If we have a char modifier down, and we're able to determine a keysym reliably
	        // then (a) we know to treat the modifier as a char modifier,
	        // and (b) we'll have to "escape" the modifier to undo the modifier when sending the char.
	        if (active && keysym) {
	            var isCharModifier = false;
	            for (var i  = 0; i < active.length; ++i) {
	                if (active[i] === keysym.keysym) {
	                    isCharModifier = true;
	                }
	            }
	            if (type === 'keypress' && !isCharModifier) {
	                result.escape = modifierState.activeCharModifier();
	            }
	        }

	        if (stall) {
	            // insert a fake "stall" event
	            next({type: 'stall'});
	        }
	        next(result);

	        return suppress;
	    }

	    return {
	        keydown: function(evt) {
	            sendAll(modifierState.keydown(evt));
	            return process(evt, 'keydown');
	        },
	        keypress: function(evt) {
	            return process(evt, 'keypress');
	        },
	        keyup: function(evt) {
	            sendAll(modifierState.keyup(evt));
	            return process(evt, 'keyup');
	        },
	        syncModifiers: function(evt) {
	            sendAll(modifierState.syncAny(evt));
	        },
	        releaseAll: function() { next({type: 'releaseall'}); }
	    };
	}

	// Combines keydown and keypress events where necessary to handle char modifiers.
	// On some OS'es, a char modifier is sometimes used as a shortcut modifier.
	// For example, on Windows, AltGr is synonymous with Ctrl-Alt. On a Danish keyboard layout, AltGr-2 yields a @, but Ctrl-Alt-D does nothing
	// so when used with the '2' key, Ctrl-Alt counts as a char modifier (and should be escaped), but when used with 'D', it does not.
	// The only way we can distinguish these cases is to wait and see if a keypress event arrives
	// When we receive a "stall" event, wait a few ms before processing the next keydown. If a keypress has also arrived, merge the two
	function VerifyCharModifier(next) {
	    "use strict";
	    var queue = [];
	    var timer = null;
	    function process() {
	        if (timer) {
	            return;
	        }

	        var delayProcess = function () {
	            clearTimeout(timer);
	            timer = null;
	            process();
	        };

	        while (queue.length !== 0) {
	            var cur = queue[0];
	            queue = queue.splice(1);
	            switch (cur.type) {
	            case 'stall':
	                // insert a delay before processing available events.
	                /* jshint loopfunc: true */
	                timer = setTimeout(delayProcess, 5);
	                /* jshint loopfunc: false */
	                return;
	            case 'keydown':
	                // is the next element a keypress? Then we should merge the two
	                if (queue.length !== 0 && queue[0].type === 'keypress') {
	                    // Firefox sends keypress even when no char is generated.
	                    // so, if keypress keysym is the same as we'd have guessed from keydown,
	                    // the modifier didn't have any effect, and should not be escaped
	                    if (queue[0].escape && (!cur.keysym || cur.keysym.keysym !== queue[0].keysym.keysym)) {
	                        cur.escape = queue[0].escape;
	                    }
	                    cur.keysym = queue[0].keysym;
	                    queue = queue.splice(1);
	                }
	                break;
	            }

	            // swallow stall events, and pass all others to the next stage
	            if (cur.type !== 'stall') {
	                next(cur);
	            }
	        }
	    }
	    return function(evt) {
	        queue.push(evt);
	        process();
	    };
	}

	// Keeps track of which keys we (and the server) believe are down
	// When a keyup is received, match it against this list, to determine the corresponding keysym(s)
	// in some cases, a single key may produce multiple keysyms, so the corresponding keyup event must release all of these chars
	// key repeat events should be merged into a single entry.
	// Because we can't always identify which entry a keydown or keyup event corresponds to, we sometimes have to guess
	function TrackKeyState(next) {
	    "use strict";
	    var state = [];

	    return function (evt) {
	        var last = state.length !== 0 ? state[state.length-1] : null;

	        switch (evt.type) {
	        case 'keydown':
	            // insert a new entry if last seen key was different.
	            if (!last || !evt.keyId || last.keyId !== evt.keyId) {
	                last = {keyId: evt.keyId, keysyms: {}};
	                state.push(last);
	            }
	            if (evt.keysym) {
	                // make sure last event contains this keysym (a single "logical" keyevent
	                // can cause multiple key events to be sent to the VNC server)
	                last.keysyms[evt.keysym.keysym] = evt.keysym;
	                last.ignoreKeyPress = true;
	                next(evt);
	            }
	            break;
	        case 'keypress':
	            if (!last) {
	                last = {keyId: evt.keyId, keysyms: {}};
	                state.push(last);
	            }
	            if (!evt.keysym) {
	                console.log('keypress with no keysym:', evt);
	            }

	            // If we didn't expect a keypress, and already sent a keydown to the VNC server
	            // based on the keydown, make sure to skip this event.
	            if (evt.keysym && !last.ignoreKeyPress) {
	                last.keysyms[evt.keysym.keysym] = evt.keysym;
	                evt.type = 'keydown';
	                next(evt);
	            }
	            break;
	        case 'keyup':
	            if (state.length === 0) {
	                return;
	            }
	            var idx = null;
	            // do we have a matching key tracked as being down?
	            for (var i = 0; i !== state.length; ++i) {
	                if (state[i].keyId === evt.keyId) {
	                    idx = i;
	                    break;
	                }
	            }
	            // if we couldn't find a match (it happens), assume it was the last key pressed
	            if (idx === null) {
	                idx = state.length - 1;
	            }

	            var item = state.splice(idx, 1)[0];
	            // for each keysym tracked by this key entry, clone the current event and override the keysym
	            var clone = (function(){
	                function Clone(){}
	                return function (obj) { Clone.prototype=obj; return new Clone(); };
	            }());
	            for (var key in item.keysyms) {
	                var out = clone(evt);
	                out.keysym = item.keysyms[key];
	                next(out);
	            }
	            break;
	        case 'releaseall':
	            /* jshint shadow: true */
	            for (var i = 0; i < state.length; ++i) {
	                for (var key in state[i].keysyms) {
	                    var keysym = state[i].keysyms[key];
	                    next({keyId: 0, keysym: keysym, type: 'keyup'});
	                }
	            }
	            /* jshint shadow: false */
	            state = [];
	        }
	    };
	}

	// Handles "escaping" of modifiers: if a char modifier is used to produce a keysym (such as AltGr-2 to generate an @),
	// then the modifier must be "undone" before sending the @, and "redone" afterwards.
	function EscapeModifiers(next) {
	    "use strict";
	    return function(evt) {
	        if (evt.type !== 'keydown' || evt.escape === undefined) {
	            next(evt);
	            return;
	        }
	        // undo modifiers
	        for (var i = 0; i < evt.escape.length; ++i) {
	            next({type: 'keyup', keyId: 0, keysym: keysyms.lookup(evt.escape[i])});
	        }
	        // send the character event
	        next(evt);
	        // redo modifiers
	        /* jshint shadow: true */
	        for (var i = 0; i < evt.escape.length; ++i) {
	            next({type: 'keydown', keyId: 0, keysym: keysyms.lookup(evt.escape[i])});
	        }
	        /* jshint shadow: false */
	    };
	}

	module.exports = {
	  kbdUtil: kbdUtil,
	  KeyEventDecoder: KeyEventDecoder,
	  VerifyCharModifier: VerifyCharModifier,
	  TrackKeyState: TrackKeyState,
	  EscapeModifiers: EscapeModifiers
	}


/***/ },
/* 5 */
/***/ function(module, exports) {

	// This file describes mappings from Unicode codepoints to the keysym values
	// (and optionally, key names) expected by the RFB protocol
	// How this file was generated:
	// node /Users/jalf/dev/mi/novnc/utils/parse.js /opt/X11/include/X11/keysymdef.h
	var keysyms = (function(){
	    "use strict";
	    var keynames = null;
	    var codepoints = {"32":32,"33":33,"34":34,"35":35,"36":36,"37":37,"38":38,"39":39,"40":40,"41":41,"42":42,"43":43,"44":44,"45":45,"46":46,"47":47,"48":48,"49":49,"50":50,"51":51,"52":52,"53":53,"54":54,"55":55,"56":56,"57":57,"58":58,"59":59,"60":60,"61":61,"62":62,"63":63,"64":64,"65":65,"66":66,"67":67,"68":68,"69":69,"70":70,"71":71,"72":72,"73":73,"74":74,"75":75,"76":76,"77":77,"78":78,"79":79,"80":80,"81":81,"82":82,"83":83,"84":84,"85":85,"86":86,"87":87,"88":88,"89":89,"90":90,"91":91,"92":92,"93":93,"94":94,"95":95,"96":96,"97":97,"98":98,"99":99,"100":100,"101":101,"102":102,"103":103,"104":104,"105":105,"106":106,"107":107,"108":108,"109":109,"110":110,"111":111,"112":112,"113":113,"114":114,"115":115,"116":116,"117":117,"118":118,"119":119,"120":120,"121":121,"122":122,"123":123,"124":124,"125":125,"126":126,"160":160,"161":161,"162":162,"163":163,"164":164,"165":165,"166":166,"167":167,"168":168,"169":169,"170":170,"171":171,"172":172,"173":173,"174":174,"175":175,"176":176,"177":177,"178":178,"179":179,"180":180,"181":181,"182":182,"183":183,"184":184,"185":185,"186":186,"187":187,"188":188,"189":189,"190":190,"191":191,"192":192,"193":193,"194":194,"195":195,"196":196,"197":197,"198":198,"199":199,"200":200,"201":201,"202":202,"203":203,"204":204,"205":205,"206":206,"207":207,"208":208,"209":209,"210":210,"211":211,"212":212,"213":213,"214":214,"215":215,"216":216,"217":217,"218":218,"219":219,"220":220,"221":221,"222":222,"223":223,"224":224,"225":225,"226":226,"227":227,"228":228,"229":229,"230":230,"231":231,"232":232,"233":233,"234":234,"235":235,"236":236,"237":237,"238":238,"239":239,"240":240,"241":241,"242":242,"243":243,"244":244,"245":245,"246":246,"247":247,"248":248,"249":249,"250":250,"251":251,"252":252,"253":253,"254":254,"255":255,"256":960,"257":992,"258":451,"259":483,"260":417,"261":433,"262":454,"263":486,"264":710,"265":742,"266":709,"267":741,"268":456,"269":488,"270":463,"271":495,"272":464,"273":496,"274":938,"275":954,"278":972,"279":1004,"280":458,"281":490,"282":460,"283":492,"284":728,"285":760,"286":683,"287":699,"288":725,"289":757,"290":939,"291":955,"292":678,"293":694,"294":673,"295":689,"296":933,"297":949,"298":975,"299":1007,"300":16777516,"301":16777517,"302":967,"303":999,"304":681,"305":697,"308":684,"309":700,"310":979,"311":1011,"312":930,"313":453,"314":485,"315":934,"316":950,"317":421,"318":437,"321":419,"322":435,"323":465,"324":497,"325":977,"326":1009,"327":466,"328":498,"330":957,"331":959,"332":978,"333":1010,"336":469,"337":501,"338":5052,"339":5053,"340":448,"341":480,"342":931,"343":947,"344":472,"345":504,"346":422,"347":438,"348":734,"349":766,"350":426,"351":442,"352":425,"353":441,"354":478,"355":510,"356":427,"357":443,"358":940,"359":956,"360":989,"361":1021,"362":990,"363":1022,"364":733,"365":765,"366":473,"367":505,"368":475,"369":507,"370":985,"371":1017,"372":16777588,"373":16777589,"374":16777590,"375":16777591,"376":5054,"377":428,"378":444,"379":431,"380":447,"381":430,"382":446,"399":16777615,"402":2294,"415":16777631,"416":16777632,"417":16777633,"431":16777647,"432":16777648,"437":16777653,"438":16777654,"439":16777655,"466":16777681,"486":16777702,"487":16777703,"601":16777817,"629":16777845,"658":16777874,"711":439,"728":418,"729":511,"731":434,"733":445,"901":1966,"902":1953,"904":1954,"905":1955,"906":1956,"908":1959,"910":1960,"911":1963,"912":1974,"913":1985,"914":1986,"915":1987,"916":1988,"917":1989,"918":1990,"919":1991,"920":1992,"921":1993,"922":1994,"923":1995,"924":1996,"925":1997,"926":1998,"927":1999,"928":2000,"929":2001,"931":2002,"932":2004,"933":2005,"934":2006,"935":2007,"936":2008,"937":2009,"938":1957,"939":1961,"940":1969,"941":1970,"942":1971,"943":1972,"944":1978,"945":2017,"946":2018,"947":2019,"948":2020,"949":2021,"950":2022,"951":2023,"952":2024,"953":2025,"954":2026,"955":2027,"956":2028,"957":2029,"958":2030,"959":2031,"960":2032,"961":2033,"962":2035,"963":2034,"964":2036,"965":2037,"966":2038,"967":2039,"968":2040,"969":2041,"970":1973,"971":1977,"972":1975,"973":1976,"974":1979,"1025":1715,"1026":1713,"1027":1714,"1028":1716,"1029":1717,"1030":1718,"1031":1719,"1032":1720,"1033":1721,"1034":1722,"1035":1723,"1036":1724,"1038":1726,"1039":1727,"1040":1761,"1041":1762,"1042":1783,"1043":1767,"1044":1764,"1045":1765,"1046":1782,"1047":1786,"1048":1769,"1049":1770,"1050":1771,"1051":1772,"1052":1773,"1053":1774,"1054":1775,"1055":1776,"1056":1778,"1057":1779,"1058":1780,"1059":1781,"1060":1766,"1061":1768,"1062":1763,"1063":1790,"1064":1787,"1065":1789,"1066":1791,"1067":1785,"1068":1784,"1069":1788,"1070":1760,"1071":1777,"1072":1729,"1073":1730,"1074":1751,"1075":1735,"1076":1732,"1077":1733,"1078":1750,"1079":1754,"1080":1737,"1081":1738,"1082":1739,"1083":1740,"1084":1741,"1085":1742,"1086":1743,"1087":1744,"1088":1746,"1089":1747,"1090":1748,"1091":1749,"1092":1734,"1093":1736,"1094":1731,"1095":1758,"1096":1755,"1097":1757,"1098":1759,"1099":1753,"1100":1752,"1101":1756,"1102":1728,"1103":1745,"1105":1699,"1106":1697,"1107":1698,"1108":1700,"1109":1701,"1110":1702,"1111":1703,"1112":1704,"1113":1705,"1114":1706,"1115":1707,"1116":1708,"1118":1710,"1119":1711,"1168":1725,"1169":1709,"1170":16778386,"1171":16778387,"1174":16778390,"1175":16778391,"1178":16778394,"1179":16778395,"1180":16778396,"1181":16778397,"1186":16778402,"1187":16778403,"1198":16778414,"1199":16778415,"1200":16778416,"1201":16778417,"1202":16778418,"1203":16778419,"1206":16778422,"1207":16778423,"1208":16778424,"1209":16778425,"1210":16778426,"1211":16778427,"1240":16778456,"1241":16778457,"1250":16778466,"1251":16778467,"1256":16778472,"1257":16778473,"1262":16778478,"1263":16778479,"1329":16778545,"1330":16778546,"1331":16778547,"1332":16778548,"1333":16778549,"1334":16778550,"1335":16778551,"1336":16778552,"1337":16778553,"1338":16778554,"1339":16778555,"1340":16778556,"1341":16778557,"1342":16778558,"1343":16778559,"1344":16778560,"1345":16778561,"1346":16778562,"1347":16778563,"1348":16778564,"1349":16778565,"1350":16778566,"1351":16778567,"1352":16778568,"1353":16778569,"1354":16778570,"1355":16778571,"1356":16778572,"1357":16778573,"1358":16778574,"1359":16778575,"1360":16778576,"1361":16778577,"1362":16778578,"1363":16778579,"1364":16778580,"1365":16778581,"1366":16778582,"1370":16778586,"1371":16778587,"1372":16778588,"1373":16778589,"1374":16778590,"1377":16778593,"1378":16778594,"1379":16778595,"1380":16778596,"1381":16778597,"1382":16778598,"1383":16778599,"1384":16778600,"1385":16778601,"1386":16778602,"1387":16778603,"1388":16778604,"1389":16778605,"1390":16778606,"1391":16778607,"1392":16778608,"1393":16778609,"1394":16778610,"1395":16778611,"1396":16778612,"1397":16778613,"1398":16778614,"1399":16778615,"1400":16778616,"1401":16778617,"1402":16778618,"1403":16778619,"1404":16778620,"1405":16778621,"1406":16778622,"1407":16778623,"1408":16778624,"1409":16778625,"1410":16778626,"1411":16778627,"1412":16778628,"1413":16778629,"1414":16778630,"1415":16778631,"1417":16778633,"1418":16778634,"1488":3296,"1489":3297,"1490":3298,"1491":3299,"1492":3300,"1493":3301,"1494":3302,"1495":3303,"1496":3304,"1497":3305,"1498":3306,"1499":3307,"1500":3308,"1501":3309,"1502":3310,"1503":3311,"1504":3312,"1505":3313,"1506":3314,"1507":3315,"1508":3316,"1509":3317,"1510":3318,"1511":3319,"1512":3320,"1513":3321,"1514":3322,"1548":1452,"1563":1467,"1567":1471,"1569":1473,"1570":1474,"1571":1475,"1572":1476,"1573":1477,"1574":1478,"1575":1479,"1576":1480,"1577":1481,"1578":1482,"1579":1483,"1580":1484,"1581":1485,"1582":1486,"1583":1487,"1584":1488,"1585":1489,"1586":1490,"1587":1491,"1588":1492,"1589":1493,"1590":1494,"1591":1495,"1592":1496,"1593":1497,"1594":1498,"1600":1504,"1601":1505,"1602":1506,"1603":1507,"1604":1508,"1605":1509,"1606":1510,"1607":1511,"1608":1512,"1609":1513,"1610":1514,"1611":1515,"1612":1516,"1613":1517,"1614":1518,"1615":1519,"1616":1520,"1617":1521,"1618":1522,"1619":16778835,"1620":16778836,"1621":16778837,"1632":16778848,"1633":16778849,"1634":16778850,"1635":16778851,"1636":16778852,"1637":16778853,"1638":16778854,"1639":16778855,"1640":16778856,"1641":16778857,"1642":16778858,"1648":16778864,"1657":16778873,"1662":16778878,"1670":16778886,"1672":16778888,"1681":16778897,"1688":16778904,"1700":16778916,"1705":16778921,"1711":16778927,"1722":16778938,"1726":16778942,"1729":16778945,"1740":16778956,"1746":16778962,"1748":16778964,"1776":16778992,"1777":16778993,"1778":16778994,"1779":16778995,"1780":16778996,"1781":16778997,"1782":16778998,"1783":16778999,"1784":16779000,"1785":16779001,"3458":16780674,"3459":16780675,"3461":16780677,"3462":16780678,"3463":16780679,"3464":16780680,"3465":16780681,"3466":16780682,"3467":16780683,"3468":16780684,"3469":16780685,"3470":16780686,"3471":16780687,"3472":16780688,"3473":16780689,"3474":16780690,"3475":16780691,"3476":16780692,"3477":16780693,"3478":16780694,"3482":16780698,"3483":16780699,"3484":16780700,"3485":16780701,"3486":16780702,"3487":16780703,"3488":16780704,"3489":16780705,"3490":16780706,"3491":16780707,"3492":16780708,"3493":16780709,"3494":16780710,"3495":16780711,"3496":16780712,"3497":16780713,"3498":16780714,"3499":16780715,"3500":16780716,"3501":16780717,"3502":16780718,"3503":16780719,"3504":16780720,"3505":16780721,"3507":16780723,"3508":16780724,"3509":16780725,"3510":16780726,"3511":16780727,"3512":16780728,"3513":16780729,"3514":16780730,"3515":16780731,"3517":16780733,"3520":16780736,"3521":16780737,"3522":16780738,"3523":16780739,"3524":16780740,"3525":16780741,"3526":16780742,"3530":16780746,"3535":16780751,"3536":16780752,"3537":16780753,"3538":16780754,"3539":16780755,"3540":16780756,"3542":16780758,"3544":16780760,"3545":16780761,"3546":16780762,"3547":16780763,"3548":16780764,"3549":16780765,"3550":16780766,"3551":16780767,"3570":16780786,"3571":16780787,"3572":16780788,"3585":3489,"3586":3490,"3587":3491,"3588":3492,"3589":3493,"3590":3494,"3591":3495,"3592":3496,"3593":3497,"3594":3498,"3595":3499,"3596":3500,"3597":3501,"3598":3502,"3599":3503,"3600":3504,"3601":3505,"3602":3506,"3603":3507,"3604":3508,"3605":3509,"3606":3510,"3607":3511,"3608":3512,"3609":3513,"3610":3514,"3611":3515,"3612":3516,"3613":3517,"3614":3518,"3615":3519,"3616":3520,"3617":3521,"3618":3522,"3619":3523,"3620":3524,"3621":3525,"3622":3526,"3623":3527,"3624":3528,"3625":3529,"3626":3530,"3627":3531,"3628":3532,"3629":3533,"3630":3534,"3631":3535,"3632":3536,"3633":3537,"3634":3538,"3635":3539,"3636":3540,"3637":3541,"3638":3542,"3639":3543,"3640":3544,"3641":3545,"3642":3546,"3647":3551,"3648":3552,"3649":3553,"3650":3554,"3651":3555,"3652":3556,"3653":3557,"3654":3558,"3655":3559,"3656":3560,"3657":3561,"3658":3562,"3659":3563,"3660":3564,"3661":3565,"3664":3568,"3665":3569,"3666":3570,"3667":3571,"3668":3572,"3669":3573,"3670":3574,"3671":3575,"3672":3576,"3673":3577,"4304":16781520,"4305":16781521,"4306":16781522,"4307":16781523,"4308":16781524,"4309":16781525,"4310":16781526,"4311":16781527,"4312":16781528,"4313":16781529,"4314":16781530,"4315":16781531,"4316":16781532,"4317":16781533,"4318":16781534,"4319":16781535,"4320":16781536,"4321":16781537,"4322":16781538,"4323":16781539,"4324":16781540,"4325":16781541,"4326":16781542,"4327":16781543,"4328":16781544,"4329":16781545,"4330":16781546,"4331":16781547,"4332":16781548,"4333":16781549,"4334":16781550,"4335":16781551,"4336":16781552,"4337":16781553,"4338":16781554,"4339":16781555,"4340":16781556,"4341":16781557,"4342":16781558,"7682":16784898,"7683":16784899,"7690":16784906,"7691":16784907,"7710":16784926,"7711":16784927,"7734":16784950,"7735":16784951,"7744":16784960,"7745":16784961,"7766":16784982,"7767":16784983,"7776":16784992,"7777":16784993,"7786":16785002,"7787":16785003,"7808":16785024,"7809":16785025,"7810":16785026,"7811":16785027,"7812":16785028,"7813":16785029,"7818":16785034,"7819":16785035,"7840":16785056,"7841":16785057,"7842":16785058,"7843":16785059,"7844":16785060,"7845":16785061,"7846":16785062,"7847":16785063,"7848":16785064,"7849":16785065,"7850":16785066,"7851":16785067,"7852":16785068,"7853":16785069,"7854":16785070,"7855":16785071,"7856":16785072,"7857":16785073,"7858":16785074,"7859":16785075,"7860":16785076,"7861":16785077,"7862":16785078,"7863":16785079,"7864":16785080,"7865":16785081,"7866":16785082,"7867":16785083,"7868":16785084,"7869":16785085,"7870":16785086,"7871":16785087,"7872":16785088,"7873":16785089,"7874":16785090,"7875":16785091,"7876":16785092,"7877":16785093,"7878":16785094,"7879":16785095,"7880":16785096,"7881":16785097,"7882":16785098,"7883":16785099,"7884":16785100,"7885":16785101,"7886":16785102,"7887":16785103,"7888":16785104,"7889":16785105,"7890":16785106,"7891":16785107,"7892":16785108,"7893":16785109,"7894":16785110,"7895":16785111,"7896":16785112,"7897":16785113,"7898":16785114,"7899":16785115,"7900":16785116,"7901":16785117,"7902":16785118,"7903":16785119,"7904":16785120,"7905":16785121,"7906":16785122,"7907":16785123,"7908":16785124,"7909":16785125,"7910":16785126,"7911":16785127,"7912":16785128,"7913":16785129,"7914":16785130,"7915":16785131,"7916":16785132,"7917":16785133,"7918":16785134,"7919":16785135,"7920":16785136,"7921":16785137,"7922":16785138,"7923":16785139,"7924":16785140,"7925":16785141,"7926":16785142,"7927":16785143,"7928":16785144,"7929":16785145,"8194":2722,"8195":2721,"8196":2723,"8197":2724,"8199":2725,"8200":2726,"8201":2727,"8202":2728,"8210":2747,"8211":2730,"8212":2729,"8213":1967,"8215":3295,"8216":2768,"8217":2769,"8218":2813,"8220":2770,"8221":2771,"8222":2814,"8224":2801,"8225":2802,"8226":2790,"8229":2735,"8230":2734,"8240":2773,"8242":2774,"8243":2775,"8248":2812,"8254":1150,"8304":16785520,"8308":16785524,"8309":16785525,"8310":16785526,"8311":16785527,"8312":16785528,"8313":16785529,"8320":16785536,"8321":16785537,"8322":16785538,"8323":16785539,"8324":16785540,"8325":16785541,"8326":16785542,"8327":16785543,"8328":16785544,"8329":16785545,"8352":16785568,"8353":16785569,"8354":16785570,"8355":16785571,"8356":16785572,"8357":16785573,"8358":16785574,"8359":16785575,"8360":16785576,"8361":3839,"8362":16785578,"8363":16785579,"8364":8364,"8453":2744,"8470":1712,"8471":2811,"8478":2772,"8482":2761,"8531":2736,"8532":2737,"8533":2738,"8534":2739,"8535":2740,"8536":2741,"8537":2742,"8538":2743,"8539":2755,"8540":2756,"8541":2757,"8542":2758,"8592":2299,"8593":2300,"8594":2301,"8595":2302,"8658":2254,"8660":2253,"8706":2287,"8709":16785925,"8711":2245,"8712":16785928,"8713":16785929,"8715":16785931,"8728":3018,"8730":2262,"8731":16785947,"8732":16785948,"8733":2241,"8734":2242,"8743":2270,"8744":2271,"8745":2268,"8746":2269,"8747":2239,"8748":16785964,"8749":16785965,"8756":2240,"8757":16785973,"8764":2248,"8771":2249,"8773":16785992,"8775":16785991,"8800":2237,"8801":2255,"8802":16786018,"8803":16786019,"8804":2236,"8805":2238,"8834":2266,"8835":2267,"8866":3068,"8867":3036,"8868":3010,"8869":3022,"8968":3027,"8970":3012,"8981":2810,"8992":2212,"8993":2213,"9109":3020,"9115":2219,"9117":2220,"9118":2221,"9120":2222,"9121":2215,"9123":2216,"9124":2217,"9126":2218,"9128":2223,"9132":2224,"9143":2209,"9146":2543,"9147":2544,"9148":2546,"9149":2547,"9225":2530,"9226":2533,"9227":2537,"9228":2531,"9229":2532,"9251":2732,"9252":2536,"9472":2211,"9474":2214,"9484":2210,"9488":2539,"9492":2541,"9496":2538,"9500":2548,"9508":2549,"9516":2551,"9524":2550,"9532":2542,"9618":2529,"9642":2791,"9643":2785,"9644":2779,"9645":2786,"9646":2783,"9647":2767,"9650":2792,"9651":2787,"9654":2781,"9655":2765,"9660":2793,"9661":2788,"9664":2780,"9665":2764,"9670":2528,"9675":2766,"9679":2782,"9702":2784,"9734":2789,"9742":2809,"9747":2762,"9756":2794,"9758":2795,"9792":2808,"9794":2807,"9827":2796,"9829":2798,"9830":2797,"9837":2806,"9839":2805,"10003":2803,"10007":2804,"10013":2777,"10016":2800,"10216":2748,"10217":2750,"10240":16787456,"10241":16787457,"10242":16787458,"10243":16787459,"10244":16787460,"10245":16787461,"10246":16787462,"10247":16787463,"10248":16787464,"10249":16787465,"10250":16787466,"10251":16787467,"10252":16787468,"10253":16787469,"10254":16787470,"10255":16787471,"10256":16787472,"10257":16787473,"10258":16787474,"10259":16787475,"10260":16787476,"10261":16787477,"10262":16787478,"10263":16787479,"10264":16787480,"10265":16787481,"10266":16787482,"10267":16787483,"10268":16787484,"10269":16787485,"10270":16787486,"10271":16787487,"10272":16787488,"10273":16787489,"10274":16787490,"10275":16787491,"10276":16787492,"10277":16787493,"10278":16787494,"10279":16787495,"10280":16787496,"10281":16787497,"10282":16787498,"10283":16787499,"10284":16787500,"10285":16787501,"10286":16787502,"10287":16787503,"10288":16787504,"10289":16787505,"10290":16787506,"10291":16787507,"10292":16787508,"10293":16787509,"10294":16787510,"10295":16787511,"10296":16787512,"10297":16787513,"10298":16787514,"10299":16787515,"10300":16787516,"10301":16787517,"10302":16787518,"10303":16787519,"10304":16787520,"10305":16787521,"10306":16787522,"10307":16787523,"10308":16787524,"10309":16787525,"10310":16787526,"10311":16787527,"10312":16787528,"10313":16787529,"10314":16787530,"10315":16787531,"10316":16787532,"10317":16787533,"10318":16787534,"10319":16787535,"10320":16787536,"10321":16787537,"10322":16787538,"10323":16787539,"10324":16787540,"10325":16787541,"10326":16787542,"10327":16787543,"10328":16787544,"10329":16787545,"10330":16787546,"10331":16787547,"10332":16787548,"10333":16787549,"10334":16787550,"10335":16787551,"10336":16787552,"10337":16787553,"10338":16787554,"10339":16787555,"10340":16787556,"10341":16787557,"10342":16787558,"10343":16787559,"10344":16787560,"10345":16787561,"10346":16787562,"10347":16787563,"10348":16787564,"10349":16787565,"10350":16787566,"10351":16787567,"10352":16787568,"10353":16787569,"10354":16787570,"10355":16787571,"10356":16787572,"10357":16787573,"10358":16787574,"10359":16787575,"10360":16787576,"10361":16787577,"10362":16787578,"10363":16787579,"10364":16787580,"10365":16787581,"10366":16787582,"10367":16787583,"10368":16787584,"10369":16787585,"10370":16787586,"10371":16787587,"10372":16787588,"10373":16787589,"10374":16787590,"10375":16787591,"10376":16787592,"10377":16787593,"10378":16787594,"10379":16787595,"10380":16787596,"10381":16787597,"10382":16787598,"10383":16787599,"10384":16787600,"10385":16787601,"10386":16787602,"10387":16787603,"10388":16787604,"10389":16787605,"10390":16787606,"10391":16787607,"10392":16787608,"10393":16787609,"10394":16787610,"10395":16787611,"10396":16787612,"10397":16787613,"10398":16787614,"10399":16787615,"10400":16787616,"10401":16787617,"10402":16787618,"10403":16787619,"10404":16787620,"10405":16787621,"10406":16787622,"10407":16787623,"10408":16787624,"10409":16787625,"10410":16787626,"10411":16787627,"10412":16787628,"10413":16787629,"10414":16787630,"10415":16787631,"10416":16787632,"10417":16787633,"10418":16787634,"10419":16787635,"10420":16787636,"10421":16787637,"10422":16787638,"10423":16787639,"10424":16787640,"10425":16787641,"10426":16787642,"10427":16787643,"10428":16787644,"10429":16787645,"10430":16787646,"10431":16787647,"10432":16787648,"10433":16787649,"10434":16787650,"10435":16787651,"10436":16787652,"10437":16787653,"10438":16787654,"10439":16787655,"10440":16787656,"10441":16787657,"10442":16787658,"10443":16787659,"10444":16787660,"10445":16787661,"10446":16787662,"10447":16787663,"10448":16787664,"10449":16787665,"10450":16787666,"10451":16787667,"10452":16787668,"10453":16787669,"10454":16787670,"10455":16787671,"10456":16787672,"10457":16787673,"10458":16787674,"10459":16787675,"10460":16787676,"10461":16787677,"10462":16787678,"10463":16787679,"10464":16787680,"10465":16787681,"10466":16787682,"10467":16787683,"10468":16787684,"10469":16787685,"10470":16787686,"10471":16787687,"10472":16787688,"10473":16787689,"10474":16787690,"10475":16787691,"10476":16787692,"10477":16787693,"10478":16787694,"10479":16787695,"10480":16787696,"10481":16787697,"10482":16787698,"10483":16787699,"10484":16787700,"10485":16787701,"10486":16787702,"10487":16787703,"10488":16787704,"10489":16787705,"10490":16787706,"10491":16787707,"10492":16787708,"10493":16787709,"10494":16787710,"10495":16787711,"12289":1188,"12290":1185,"12300":1186,"12301":1187,"12443":1246,"12444":1247,"12449":1191,"12450":1201,"12451":1192,"12452":1202,"12453":1193,"12454":1203,"12455":1194,"12456":1204,"12457":1195,"12458":1205,"12459":1206,"12461":1207,"12463":1208,"12465":1209,"12467":1210,"12469":1211,"12471":1212,"12473":1213,"12475":1214,"12477":1215,"12479":1216,"12481":1217,"12483":1199,"12484":1218,"12486":1219,"12488":1220,"12490":1221,"12491":1222,"12492":1223,"12493":1224,"12494":1225,"12495":1226,"12498":1227,"12501":1228,"12504":1229,"12507":1230,"12510":1231,"12511":1232,"12512":1233,"12513":1234,"12514":1235,"12515":1196,"12516":1236,"12517":1197,"12518":1237,"12519":1198,"12520":1238,"12521":1239,"12522":1240,"12523":1241,"12524":1242,"12525":1243,"12527":1244,"12530":1190,"12531":1245,"12539":1189,"12540":1200};

	    function lookup(k) { return k ? {keysym: k, keyname: keynames ? keynames[k] : k} : undefined; }
	    return {
	        fromUnicode : function(u) { return lookup(codepoints[u]); },
	        lookup : lookup
	    };
	})();

	module.exports = keysyms;


/***/ },
/* 6 */
/***/ function(module, exports) {

	module.exports = {
	  XK_VoidSymbol:                0xffffff, /* Void symbol */

	  XK_BackSpace:                   0xff08, /* Back space, back char */
	  XK_Tab:                         0xff09,
	  XK_Linefeed:                    0xff0a, /* Linefeed, LF */
	  XK_Clear:                       0xff0b,
	  XK_Return:                      0xff0d, /* Return, enter */
	  XK_Pause:                       0xff13, /* Pause, hold */
	  XK_Scroll_Lock:                 0xff14,
	  XK_Sys_Req:                     0xff15,
	  XK_Escape:                      0xff1b,
	  XK_Delete:                      0xffff, /* Delete, rubout */

	  /* Cursor control & motion */

	  XK_Home:                        0xff50,
	  XK_Left:                        0xff51, /* Move left, left arrow */
	  XK_Up:                          0xff52, /* Move up, up arrow */
	  XK_Right:                       0xff53, /* Move right, right arrow */
	  XK_Down:                        0xff54, /* Move down, down arrow */
	  XK_Prior:                       0xff55, /* Prior, previous */
	  XK_Page_Up:                     0xff55,
	  XK_Next:                        0xff56, /* Next */
	  XK_Page_Down:                   0xff56,
	  XK_End:                         0xff57, /* EOL */
	  XK_Begin:                       0xff58, /* BOL */


	  /* Misc functions */

	  XK_Select:                      0xff60, /* Select, mark */
	  XK_Print:                       0xff61,
	  XK_Execute:                     0xff62, /* Execute, run, do */
	  XK_Insert:                      0xff63, /* Insert, insert here */
	  XK_Undo:                        0xff65,
	  XK_Redo:                        0xff66, /* Redo, again */
	  XK_Menu:                        0xff67,
	  XK_Find:                        0xff68, /* Find, search */
	  XK_Cancel:                      0xff69, /* Cancel, stop, abort, exit */
	  XK_Help:                        0xff6a, /* Help */
	  XK_Break:                       0xff6b,
	  XK_Mode_switch:                 0xff7e, /* Character set switch */
	  XK_script_switch:               0xff7e, /* Alias for mode_switch */
	  XK_Num_Lock:                    0xff7f,

	  /* Keypad functions, keypad numbers cleverly chosen to map to ASCII */

	  XK_KP_Space:                    0xff80, /* Space */
	  XK_KP_Tab:                      0xff89,
	  XK_KP_Enter:                    0xff8d, /* Enter */
	  XK_KP_F1:                       0xff91, /* PF1, KP_A, ... */
	  XK_KP_F2:                       0xff92,
	  XK_KP_F3:                       0xff93,
	  XK_KP_F4:                       0xff94,
	  XK_KP_Home:                     0xff95,
	  XK_KP_Left:                     0xff96,
	  XK_KP_Up:                       0xff97,
	  XK_KP_Right:                    0xff98,
	  XK_KP_Down:                     0xff99,
	  XK_KP_Prior:                    0xff9a,
	  XK_KP_Page_Up:                  0xff9a,
	  XK_KP_Next:                     0xff9b,
	  XK_KP_Page_Down:                0xff9b,
	  XK_KP_End:                      0xff9c,
	  XK_KP_Begin:                    0xff9d,
	  XK_KP_Insert:                   0xff9e,
	  XK_KP_Delete:                   0xff9f,
	  XK_KP_Equal:                    0xffbd, /* Equals */
	  XK_KP_Multiply:                 0xffaa,
	  XK_KP_Add:                      0xffab,
	  XK_KP_Separator:                0xffac, /* Separator, often comma */
	  XK_KP_Subtract:                 0xffad,
	  XK_KP_Decimal:                  0xffae,
	  XK_KP_Divide:                   0xffaf,

	  XK_KP_0:                        0xffb0,
	  XK_KP_1:                        0xffb1,
	  XK_KP_2:                        0xffb2,
	  XK_KP_3:                        0xffb3,
	  XK_KP_4:                        0xffb4,
	  XK_KP_5:                        0xffb5,
	  XK_KP_6:                        0xffb6,
	  XK_KP_7:                        0xffb7,
	  XK_KP_8:                        0xffb8,
	  XK_KP_9:                        0xffb9,

	  /*
	   * Auxiliary functions; note the duplicate definitions for left and right
	   * function keys;  Sun keyboards and a few other manufacturers have such
	   * function key groups on the left and/or right sides of the keyboard.
	   * We've not found a keyboard with more than 35 function keys total.
	   */

	  XK_F1:                          0xffbe,
	  XK_F2:                          0xffbf,
	  XK_F3:                          0xffc0,
	  XK_F4:                          0xffc1,
	  XK_F5:                          0xffc2,
	  XK_F6:                          0xffc3,
	  XK_F7:                          0xffc4,
	  XK_F8:                          0xffc5,
	  XK_F9:                          0xffc6,
	  XK_F10:                         0xffc7,
	  XK_F11:                         0xffc8,
	  XK_L1:                          0xffc8,
	  XK_F12:                         0xffc9,
	  XK_L2:                          0xffc9,
	  XK_F13:                         0xffca,
	  XK_L3:                          0xffca,
	  XK_F14:                         0xffcb,
	  XK_L4:                          0xffcb,
	  XK_F15:                         0xffcc,
	  XK_L5:                          0xffcc,
	  XK_F16:                         0xffcd,
	  XK_L6:                          0xffcd,
	  XK_F17:                         0xffce,
	  XK_L7:                          0xffce,
	  XK_F18:                         0xffcf,
	  XK_L8:                          0xffcf,
	  XK_F19:                         0xffd0,
	  XK_L9:                          0xffd0,
	  XK_F20:                         0xffd1,
	  XK_L10:                         0xffd1,
	  XK_F21:                         0xffd2,
	  XK_R1:                          0xffd2,
	  XK_F22:                         0xffd3,
	  XK_R2:                          0xffd3,
	  XK_F23:                         0xffd4,
	  XK_R3:                          0xffd4,
	  XK_F24:                         0xffd5,
	  XK_R4:                          0xffd5,
	  XK_F25:                         0xffd6,
	  XK_R5:                          0xffd6,
	  XK_F26:                         0xffd7,
	  XK_R6:                          0xffd7,
	  XK_F27:                         0xffd8,
	  XK_R7:                          0xffd8,
	  XK_F28:                         0xffd9,
	  XK_R8:                          0xffd9,
	  XK_F29:                         0xffda,
	  XK_R9:                          0xffda,
	  XK_F30:                         0xffdb,
	  XK_R10:                         0xffdb,
	  XK_F31:                         0xffdc,
	  XK_R11:                         0xffdc,
	  XK_F32:                         0xffdd,
	  XK_R12:                         0xffdd,
	  XK_F33:                         0xffde,
	  XK_R13:                         0xffde,
	  XK_F34:                         0xffdf,
	  XK_R14:                         0xffdf,
	  XK_F35:                         0xffe0,
	  XK_R15:                         0xffe0,

	  /* Modifiers */

	  XK_Shift_L:                     0xffe1, /* Left shift */
	  XK_Shift_R:                     0xffe2, /* Right shift */
	  XK_Control_L:                   0xffe3, /* Left control */
	  XK_Control_R:                   0xffe4, /* Right control */
	  XK_Caps_Lock:                   0xffe5, /* Caps lock */
	  XK_Shift_Lock:                  0xffe6, /* Shift lock */

	  XK_Meta_L:                      0xffe7, /* Left meta */
	  XK_Meta_R:                      0xffe8, /* Right meta */
	  XK_Alt_L:                       0xffe9, /* Left alt */
	  XK_Alt_R:                       0xffea, /* Right alt */
	  XK_Super_L:                     0xffeb, /* Left super */
	  XK_Super_R:                     0xffec, /* Right super */
	  XK_Hyper_L:                     0xffed, /* Left hyper */
	  XK_Hyper_R:                     0xffee, /* Right hyper */

	  XK_ISO_Level3_Shift:            0xfe03, /* AltGr */

	  /*
	   * Latin 1
	   * (ISO/IEC 8859-1: Unicode U+0020..U+00FF)
	   * Byte 3: 0
	   */

	  XK_space:                       0x0020, /* U+0020 SPACE */
	  XK_exclam:                      0x0021, /* U+0021 EXCLAMATION MARK */
	  XK_quotedbl:                    0x0022, /* U+0022 QUOTATION MARK */
	  XK_numbersign:                  0x0023, /* U+0023 NUMBER SIGN */
	  XK_dollar:                      0x0024, /* U+0024 DOLLAR SIGN */
	  XK_percent:                     0x0025, /* U+0025 PERCENT SIGN */
	  XK_ampersand:                   0x0026, /* U+0026 AMPERSAND */
	  XK_apostrophe:                  0x0027, /* U+0027 APOSTROPHE */
	  XK_quoteright:                  0x0027, /* deprecated */
	  XK_parenleft:                   0x0028, /* U+0028 LEFT PARENTHESIS */
	  XK_parenright:                  0x0029, /* U+0029 RIGHT PARENTHESIS */
	  XK_asterisk:                    0x002a, /* U+002A ASTERISK */
	  XK_plus:                        0x002b, /* U+002B PLUS SIGN */
	  XK_comma:                       0x002c, /* U+002C COMMA */
	  XK_minus:                       0x002d, /* U+002D HYPHEN-MINUS */
	  XK_period:                      0x002e, /* U+002E FULL STOP */
	  XK_slash:                       0x002f, /* U+002F SOLIDUS */
	  XK_0:                           0x0030, /* U+0030 DIGIT ZERO */
	  XK_1:                           0x0031, /* U+0031 DIGIT ONE */
	  XK_2:                           0x0032, /* U+0032 DIGIT TWO */
	  XK_3:                           0x0033, /* U+0033 DIGIT THREE */
	  XK_4:                           0x0034, /* U+0034 DIGIT FOUR */
	  XK_5:                           0x0035, /* U+0035 DIGIT FIVE */
	  XK_6:                           0x0036, /* U+0036 DIGIT SIX */
	  XK_7:                           0x0037, /* U+0037 DIGIT SEVEN */
	  XK_8:                           0x0038, /* U+0038 DIGIT EIGHT */
	  XK_9:                           0x0039, /* U+0039 DIGIT NINE */
	  XK_colon:                       0x003a, /* U+003A COLON */
	  XK_semicolon:                   0x003b, /* U+003B SEMICOLON */
	  XK_less:                        0x003c, /* U+003C LESS-THAN SIGN */
	  XK_equal:                       0x003d, /* U+003D EQUALS SIGN */
	  XK_greater:                     0x003e, /* U+003E GREATER-THAN SIGN */
	  XK_question:                    0x003f, /* U+003F QUESTION MARK */
	  XK_at:                          0x0040, /* U+0040 COMMERCIAL AT */
	  XK_A:                           0x0041, /* U+0041 LATIN CAPITAL LETTER A */
	  XK_B:                           0x0042, /* U+0042 LATIN CAPITAL LETTER B */
	  XK_C:                           0x0043, /* U+0043 LATIN CAPITAL LETTER C */
	  XK_D:                           0x0044, /* U+0044 LATIN CAPITAL LETTER D */
	  XK_E:                           0x0045, /* U+0045 LATIN CAPITAL LETTER E */
	  XK_F:                           0x0046, /* U+0046 LATIN CAPITAL LETTER F */
	  XK_G:                           0x0047, /* U+0047 LATIN CAPITAL LETTER G */
	  XK_H:                           0x0048, /* U+0048 LATIN CAPITAL LETTER H */
	  XK_I:                           0x0049, /* U+0049 LATIN CAPITAL LETTER I */
	  XK_J:                           0x004a, /* U+004A LATIN CAPITAL LETTER J */
	  XK_K:                           0x004b, /* U+004B LATIN CAPITAL LETTER K */
	  XK_L:                           0x004c, /* U+004C LATIN CAPITAL LETTER L */
	  XK_M:                           0x004d, /* U+004D LATIN CAPITAL LETTER M */
	  XK_N:                           0x004e, /* U+004E LATIN CAPITAL LETTER N */
	  XK_O:                           0x004f, /* U+004F LATIN CAPITAL LETTER O */
	  XK_P:                           0x0050, /* U+0050 LATIN CAPITAL LETTER P */
	  XK_Q:                           0x0051, /* U+0051 LATIN CAPITAL LETTER Q */
	  XK_R:                           0x0052, /* U+0052 LATIN CAPITAL LETTER R */
	  XK_S:                           0x0053, /* U+0053 LATIN CAPITAL LETTER S */
	  XK_T:                           0x0054, /* U+0054 LATIN CAPITAL LETTER T */
	  XK_U:                           0x0055, /* U+0055 LATIN CAPITAL LETTER U */
	  XK_V:                           0x0056, /* U+0056 LATIN CAPITAL LETTER V */
	  XK_W:                           0x0057, /* U+0057 LATIN CAPITAL LETTER W */
	  XK_X:                           0x0058, /* U+0058 LATIN CAPITAL LETTER X */
	  XK_Y:                           0x0059, /* U+0059 LATIN CAPITAL LETTER Y */
	  XK_Z:                           0x005a, /* U+005A LATIN CAPITAL LETTER Z */
	  XK_bracketleft:                 0x005b, /* U+005B LEFT SQUARE BRACKET */
	  XK_backslash:                   0x005c, /* U+005C REVERSE SOLIDUS */
	  XK_bracketright:                0x005d, /* U+005D RIGHT SQUARE BRACKET */
	  XK_asciicircum:                 0x005e, /* U+005E CIRCUMFLEX ACCENT */
	  XK_underscore:                  0x005f, /* U+005F LOW LINE */
	  XK_grave:                       0x0060, /* U+0060 GRAVE ACCENT */
	  XK_quoteleft:                   0x0060, /* deprecated */
	  XK_a:                           0x0061, /* U+0061 LATIN SMALL LETTER A */
	  XK_b:                           0x0062, /* U+0062 LATIN SMALL LETTER B */
	  XK_c:                           0x0063, /* U+0063 LATIN SMALL LETTER C */
	  XK_d:                           0x0064, /* U+0064 LATIN SMALL LETTER D */
	  XK_e:                           0x0065, /* U+0065 LATIN SMALL LETTER E */
	  XK_f:                           0x0066, /* U+0066 LATIN SMALL LETTER F */
	  XK_g:                           0x0067, /* U+0067 LATIN SMALL LETTER G */
	  XK_h:                           0x0068, /* U+0068 LATIN SMALL LETTER H */
	  XK_i:                           0x0069, /* U+0069 LATIN SMALL LETTER I */
	  XK_j:                           0x006a, /* U+006A LATIN SMALL LETTER J */
	  XK_k:                           0x006b, /* U+006B LATIN SMALL LETTER K */
	  XK_l:                           0x006c, /* U+006C LATIN SMALL LETTER L */
	  XK_m:                           0x006d, /* U+006D LATIN SMALL LETTER M */
	  XK_n:                           0x006e, /* U+006E LATIN SMALL LETTER N */
	  XK_o:                           0x006f, /* U+006F LATIN SMALL LETTER O */
	  XK_p:                           0x0070, /* U+0070 LATIN SMALL LETTER P */
	  XK_q:                           0x0071, /* U+0071 LATIN SMALL LETTER Q */
	  XK_r:                           0x0072, /* U+0072 LATIN SMALL LETTER R */
	  XK_s:                           0x0073, /* U+0073 LATIN SMALL LETTER S */
	  XK_t:                           0x0074, /* U+0074 LATIN SMALL LETTER T */
	  XK_u:                           0x0075, /* U+0075 LATIN SMALL LETTER U */
	  XK_v:                           0x0076, /* U+0076 LATIN SMALL LETTER V */
	  XK_w:                           0x0077, /* U+0077 LATIN SMALL LETTER W */
	  XK_x:                           0x0078, /* U+0078 LATIN SMALL LETTER X */
	  XK_y:                           0x0079, /* U+0079 LATIN SMALL LETTER Y */
	  XK_z:                           0x007a, /* U+007A LATIN SMALL LETTER Z */
	  XK_braceleft:                   0x007b, /* U+007B LEFT CURLY BRACKET */
	  XK_bar:                         0x007c, /* U+007C VERTICAL LINE */
	  XK_braceright:                  0x007d, /* U+007D RIGHT CURLY BRACKET */
	  XK_asciitilde:                  0x007e, /* U+007E TILDE */

	  XK_nobreakspace:                0x00a0, /* U+00A0 NO-BREAK SPACE */
	  XK_exclamdown:                  0x00a1, /* U+00A1 INVERTED EXCLAMATION MARK */
	  XK_cent:                        0x00a2, /* U+00A2 CENT SIGN */
	  XK_sterling:                    0x00a3, /* U+00A3 POUND SIGN */
	  XK_currency:                    0x00a4, /* U+00A4 CURRENCY SIGN */
	  XK_yen:                         0x00a5, /* U+00A5 YEN SIGN */
	  XK_brokenbar:                   0x00a6, /* U+00A6 BROKEN BAR */
	  XK_section:                     0x00a7, /* U+00A7 SECTION SIGN */
	  XK_diaeresis:                   0x00a8, /* U+00A8 DIAERESIS */
	  XK_copyright:                   0x00a9, /* U+00A9 COPYRIGHT SIGN */
	  XK_ordfeminine:                 0x00aa, /* U+00AA FEMININE ORDINAL INDICATOR */
	  XK_guillemotleft:               0x00ab, /* U+00AB LEFT-POINTING DOUBLE ANGLE QUOTATION MARK */
	  XK_notsign:                     0x00ac, /* U+00AC NOT SIGN */
	  XK_hyphen:                      0x00ad, /* U+00AD SOFT HYPHEN */
	  XK_registered:                  0x00ae, /* U+00AE REGISTERED SIGN */
	  XK_macron:                      0x00af, /* U+00AF MACRON */
	  XK_degree:                      0x00b0, /* U+00B0 DEGREE SIGN */
	  XK_plusminus:                   0x00b1, /* U+00B1 PLUS-MINUS SIGN */
	  XK_twosuperior:                 0x00b2, /* U+00B2 SUPERSCRIPT TWO */
	  XK_threesuperior:               0x00b3, /* U+00B3 SUPERSCRIPT THREE */
	  XK_acute:                       0x00b4, /* U+00B4 ACUTE ACCENT */
	  XK_mu:                          0x00b5, /* U+00B5 MICRO SIGN */
	  XK_paragraph:                   0x00b6, /* U+00B6 PILCROW SIGN */
	  XK_periodcentered:              0x00b7, /* U+00B7 MIDDLE DOT */
	  XK_cedilla:                     0x00b8, /* U+00B8 CEDILLA */
	  XK_onesuperior:                 0x00b9, /* U+00B9 SUPERSCRIPT ONE */
	  XK_masculine:                   0x00ba, /* U+00BA MASCULINE ORDINAL INDICATOR */
	  XK_guillemotright:              0x00bb, /* U+00BB RIGHT-POINTING DOUBLE ANGLE QUOTATION MARK */
	  XK_onequarter:                  0x00bc, /* U+00BC VULGAR FRACTION ONE QUARTER */
	  XK_onehalf:                     0x00bd, /* U+00BD VULGAR FRACTION ONE HALF */
	  XK_threequarters:               0x00be, /* U+00BE VULGAR FRACTION THREE QUARTERS */
	  XK_questiondown:                0x00bf, /* U+00BF INVERTED QUESTION MARK */
	  XK_Agrave:                      0x00c0, /* U+00C0 LATIN CAPITAL LETTER A WITH GRAVE */
	  XK_Aacute:                      0x00c1, /* U+00C1 LATIN CAPITAL LETTER A WITH ACUTE */
	  XK_Acircumflex:                 0x00c2, /* U+00C2 LATIN CAPITAL LETTER A WITH CIRCUMFLEX */
	  XK_Atilde:                      0x00c3, /* U+00C3 LATIN CAPITAL LETTER A WITH TILDE */
	  XK_Adiaeresis:                  0x00c4, /* U+00C4 LATIN CAPITAL LETTER A WITH DIAERESIS */
	  XK_Aring:                       0x00c5, /* U+00C5 LATIN CAPITAL LETTER A WITH RING ABOVE */
	  XK_AE:                          0x00c6, /* U+00C6 LATIN CAPITAL LETTER AE */
	  XK_Ccedilla:                    0x00c7, /* U+00C7 LATIN CAPITAL LETTER C WITH CEDILLA */
	  XK_Egrave:                      0x00c8, /* U+00C8 LATIN CAPITAL LETTER E WITH GRAVE */
	  XK_Eacute:                      0x00c9, /* U+00C9 LATIN CAPITAL LETTER E WITH ACUTE */
	  XK_Ecircumflex:                 0x00ca, /* U+00CA LATIN CAPITAL LETTER E WITH CIRCUMFLEX */
	  XK_Ediaeresis:                  0x00cb, /* U+00CB LATIN CAPITAL LETTER E WITH DIAERESIS */
	  XK_Igrave:                      0x00cc, /* U+00CC LATIN CAPITAL LETTER I WITH GRAVE */
	  XK_Iacute:                      0x00cd, /* U+00CD LATIN CAPITAL LETTER I WITH ACUTE */
	  XK_Icircumflex:                 0x00ce, /* U+00CE LATIN CAPITAL LETTER I WITH CIRCUMFLEX */
	  XK_Idiaeresis:                  0x00cf, /* U+00CF LATIN CAPITAL LETTER I WITH DIAERESIS */
	  XK_ETH:                         0x00d0, /* U+00D0 LATIN CAPITAL LETTER ETH */
	  XK_Eth:                         0x00d0, /* deprecated */
	  XK_Ntilde:                      0x00d1, /* U+00D1 LATIN CAPITAL LETTER N WITH TILDE */
	  XK_Ograve:                      0x00d2, /* U+00D2 LATIN CAPITAL LETTER O WITH GRAVE */
	  XK_Oacute:                      0x00d3, /* U+00D3 LATIN CAPITAL LETTER O WITH ACUTE */
	  XK_Ocircumflex:                 0x00d4, /* U+00D4 LATIN CAPITAL LETTER O WITH CIRCUMFLEX */
	  XK_Otilde:                      0x00d5, /* U+00D5 LATIN CAPITAL LETTER O WITH TILDE */
	  XK_Odiaeresis:                  0x00d6, /* U+00D6 LATIN CAPITAL LETTER O WITH DIAERESIS */
	  XK_multiply:                    0x00d7, /* U+00D7 MULTIPLICATION SIGN */
	  XK_Oslash:                      0x00d8, /* U+00D8 LATIN CAPITAL LETTER O WITH STROKE */
	  XK_Ooblique:                    0x00d8, /* U+00D8 LATIN CAPITAL LETTER O WITH STROKE */
	  XK_Ugrave:                      0x00d9, /* U+00D9 LATIN CAPITAL LETTER U WITH GRAVE */
	  XK_Uacute:                      0x00da, /* U+00DA LATIN CAPITAL LETTER U WITH ACUTE */
	  XK_Ucircumflex:                 0x00db, /* U+00DB LATIN CAPITAL LETTER U WITH CIRCUMFLEX */
	  XK_Udiaeresis:                  0x00dc, /* U+00DC LATIN CAPITAL LETTER U WITH DIAERESIS */
	  XK_Yacute:                      0x00dd, /* U+00DD LATIN CAPITAL LETTER Y WITH ACUTE */
	  XK_THORN:                       0x00de, /* U+00DE LATIN CAPITAL LETTER THORN */
	  XK_Thorn:                       0x00de, /* deprecated */
	  XK_ssharp:                      0x00df, /* U+00DF LATIN SMALL LETTER SHARP S */
	  XK_agrave:                      0x00e0, /* U+00E0 LATIN SMALL LETTER A WITH GRAVE */
	  XK_aacute:                      0x00e1, /* U+00E1 LATIN SMALL LETTER A WITH ACUTE */
	  XK_acircumflex:                 0x00e2, /* U+00E2 LATIN SMALL LETTER A WITH CIRCUMFLEX */
	  XK_atilde:                      0x00e3, /* U+00E3 LATIN SMALL LETTER A WITH TILDE */
	  XK_adiaeresis:                  0x00e4, /* U+00E4 LATIN SMALL LETTER A WITH DIAERESIS */
	  XK_aring:                       0x00e5, /* U+00E5 LATIN SMALL LETTER A WITH RING ABOVE */
	  XK_ae:                          0x00e6, /* U+00E6 LATIN SMALL LETTER AE */
	  XK_ccedilla:                    0x00e7, /* U+00E7 LATIN SMALL LETTER C WITH CEDILLA */
	  XK_egrave:                      0x00e8, /* U+00E8 LATIN SMALL LETTER E WITH GRAVE */
	  XK_eacute:                      0x00e9, /* U+00E9 LATIN SMALL LETTER E WITH ACUTE */
	  XK_ecircumflex:                 0x00ea, /* U+00EA LATIN SMALL LETTER E WITH CIRCUMFLEX */
	  XK_ediaeresis:                  0x00eb, /* U+00EB LATIN SMALL LETTER E WITH DIAERESIS */
	  XK_igrave:                      0x00ec, /* U+00EC LATIN SMALL LETTER I WITH GRAVE */
	  XK_iacute:                      0x00ed, /* U+00ED LATIN SMALL LETTER I WITH ACUTE */
	  XK_icircumflex:                 0x00ee, /* U+00EE LATIN SMALL LETTER I WITH CIRCUMFLEX */
	  XK_idiaeresis:                  0x00ef, /* U+00EF LATIN SMALL LETTER I WITH DIAERESIS */
	  XK_eth:                         0x00f0, /* U+00F0 LATIN SMALL LETTER ETH */
	  XK_ntilde:                      0x00f1, /* U+00F1 LATIN SMALL LETTER N WITH TILDE */
	  XK_ograve:                      0x00f2, /* U+00F2 LATIN SMALL LETTER O WITH GRAVE */
	  XK_oacute:                      0x00f3, /* U+00F3 LATIN SMALL LETTER O WITH ACUTE */
	  XK_ocircumflex:                 0x00f4, /* U+00F4 LATIN SMALL LETTER O WITH CIRCUMFLEX */
	  XK_otilde:                      0x00f5, /* U+00F5 LATIN SMALL LETTER O WITH TILDE */
	  XK_odiaeresis:                  0x00f6, /* U+00F6 LATIN SMALL LETTER O WITH DIAERESIS */
	  XK_division:                    0x00f7, /* U+00F7 DIVISION SIGN */
	  XK_oslash:                      0x00f8, /* U+00F8 LATIN SMALL LETTER O WITH STROKE */
	  XK_ooblique:                    0x00f8, /* U+00F8 LATIN SMALL LETTER O WITH STROKE */
	  XK_ugrave:                      0x00f9, /* U+00F9 LATIN SMALL LETTER U WITH GRAVE */
	  XK_uacute:                      0x00fa, /* U+00FA LATIN SMALL LETTER U WITH ACUTE */
	  XK_ucircumflex:                 0x00fb, /* U+00FB LATIN SMALL LETTER U WITH CIRCUMFLEX */
	  XK_udiaeresis:                  0x00fc, /* U+00FC LATIN SMALL LETTER U WITH DIAERESIS */
	  XK_yacute:                      0x00fd, /* U+00FD LATIN SMALL LETTER Y WITH ACUTE */
	  XK_thorn:                       0x00fe, /* U+00FE LATIN SMALL LETTER THORN */
	  XK_ydiaeresis:                  0x00ff  /* U+00FF LATIN SMALL LETTER Y WITH DIAERESIS */
	}


/***/ },
/* 7 */
/***/ function(module, exports, __webpack_require__) {

	// Top level file is just a mixin of submodules & constants
	'use strict';

	var assign    = __webpack_require__(8).assign;

	var deflate   = __webpack_require__(9);
	var inflate   = __webpack_require__(17);
	var constants = __webpack_require__(21);

	var pako = {};

	assign(pako, deflate, inflate, constants);

	module.exports = pako;

/***/ },
/* 8 */
/***/ function(module, exports) {

	'use strict';


	var TYPED_OK =  (typeof Uint8Array !== 'undefined') &&
	                (typeof Uint16Array !== 'undefined') &&
	                (typeof Int32Array !== 'undefined');


	exports.assign = function (obj /*from1, from2, from3, ...*/) {
	  var sources = Array.prototype.slice.call(arguments, 1);
	  while (sources.length) {
	    var source = sources.shift();
	    if (!source) { continue; }

	    if (typeof(source) !== 'object') {
	      throw new TypeError(source + 'must be non-object');
	    }

	    for (var p in source) {
	      if (source.hasOwnProperty(p)) {
	        obj[p] = source[p];
	      }
	    }
	  }

	  return obj;
	};


	// reduce buffer size, avoiding mem copy
	exports.shrinkBuf = function (buf, size) {
	  if (buf.length === size) { return buf; }
	  if (buf.subarray) { return buf.subarray(0, size); }
	  buf.length = size;
	  return buf;
	};


	var fnTyped = {
	  arraySet: function (dest, src, src_offs, len, dest_offs) {
	    if (src.subarray && dest.subarray) {
	      dest.set(src.subarray(src_offs, src_offs+len), dest_offs);
	      return;
	    }
	    // Fallback to ordinary array
	    for(var i=0; i<len; i++) {
	      dest[dest_offs + i] = src[src_offs + i];
	    }
	  },
	  // Join array of chunks to single array.
	  flattenChunks: function(chunks) {
	    var i, l, len, pos, chunk, result;

	    // calculate data length
	    len = 0;
	    for (i=0, l=chunks.length; i<l; i++) {
	      len += chunks[i].length;
	    }

	    // join chunks
	    result = new Uint8Array(len);
	    pos = 0;
	    for (i=0, l=chunks.length; i<l; i++) {
	      chunk = chunks[i];
	      result.set(chunk, pos);
	      pos += chunk.length;
	    }

	    return result;
	  }
	};

	var fnUntyped = {
	  arraySet: function (dest, src, src_offs, len, dest_offs) {
	    for(var i=0; i<len; i++) {
	      dest[dest_offs + i] = src[src_offs + i];
	    }
	  },
	  // Join array of chunks to single array.
	  flattenChunks: function(chunks) {
	    return [].concat.apply([], chunks);
	  }
	};


	// Enable/Disable typed arrays use, for testing
	//
	exports.setTyped = function (on) {
	  if (on) {
	    exports.Buf8  = Uint8Array;
	    exports.Buf16 = Uint16Array;
	    exports.Buf32 = Int32Array;
	    exports.assign(exports, fnTyped);
	  } else {
	    exports.Buf8  = Array;
	    exports.Buf16 = Array;
	    exports.Buf32 = Array;
	    exports.assign(exports, fnUntyped);
	  }
	};

	exports.setTyped(TYPED_OK);

/***/ },
/* 9 */
/***/ function(module, exports, __webpack_require__) {

	'use strict';


	var zlib_deflate = __webpack_require__(10);
	var utils = __webpack_require__(8);
	var strings = __webpack_require__(15);
	var msg = __webpack_require__(14);
	var zstream = __webpack_require__(16);

	var toString = Object.prototype.toString;

	/* Public constants ==========================================================*/
	/* ===========================================================================*/

	var Z_NO_FLUSH      = 0;
	var Z_FINISH        = 4;

	var Z_OK            = 0;
	var Z_STREAM_END    = 1;

	var Z_DEFAULT_COMPRESSION = -1;

	var Z_DEFAULT_STRATEGY    = 0;

	var Z_DEFLATED  = 8;

	/* ===========================================================================*/


	/**
	 * class Deflate
	 *
	 * Generic JS-style wrapper for zlib calls. If you don't need
	 * streaming behaviour - use more simple functions: [[deflate]],
	 * [[deflateRaw]] and [[gzip]].
	 **/

	/* internal
	 * Deflate.chunks -> Array
	 *
	 * Chunks of output data, if [[Deflate#onData]] not overriden.
	 **/

	/**
	 * Deflate.result -> Uint8Array|Array
	 *
	 * Compressed result, generated by default [[Deflate#onData]]
	 * and [[Deflate#onEnd]] handlers. Filled after you push last chunk
	 * (call [[Deflate#push]] with `Z_FINISH` / `true` param).
	 **/

	/**
	 * Deflate.err -> Number
	 *
	 * Error code after deflate finished. 0 (Z_OK) on success.
	 * You will not need it in real life, because deflate errors
	 * are possible only on wrong options or bad `onData` / `onEnd`
	 * custom handlers.
	 **/

	/**
	 * Deflate.msg -> String
	 *
	 * Error message, if [[Deflate.err]] != 0
	 **/


	/**
	 * new Deflate(options)
	 * - options (Object): zlib deflate options.
	 *
	 * Creates new deflator instance with specified params. Throws exception
	 * on bad params. Supported options:
	 *
	 * - `level`
	 * - `windowBits`
	 * - `memLevel`
	 * - `strategy`
	 *
	 * [http://zlib.net/manual.html#Advanced](http://zlib.net/manual.html#Advanced)
	 * for more information on these.
	 *
	 * Additional options, for internal needs:
	 *
	 * - `chunkSize` - size of generated data chunks (16K by default)
	 * - `raw` (Boolean) - do raw deflate
	 * - `gzip` (Boolean) - create gzip wrapper
	 * - `to` (String) - if equal to 'string', then result will be "binary string"
	 *    (each char code [0..255])
	 * - `header` (Object) - custom header for gzip
	 *   - `text` (Boolean) - true if compressed data believed to be text
	 *   - `time` (Number) - modification time, unix timestamp
	 *   - `os` (Number) - operation system code
	 *   - `extra` (Array) - array of bytes with extra data (max 65536)
	 *   - `name` (String) - file name (binary string)
	 *   - `comment` (String) - comment (binary string)
	 *   - `hcrc` (Boolean) - true if header crc should be added
	 *
	 * ##### Example:
	 *
	 * ```javascript
	 * var pako = require('pako')
	 *   , chunk1 = Uint8Array([1,2,3,4,5,6,7,8,9])
	 *   , chunk2 = Uint8Array([10,11,12,13,14,15,16,17,18,19]);
	 *
	 * var deflate = new pako.Deflate({ level: 3});
	 *
	 * deflate.push(chunk1, false);
	 * deflate.push(chunk2, true);  // true -> last chunk
	 *
	 * if (deflate.err) { throw new Error(deflate.err); }
	 *
	 * console.log(deflate.result);
	 * ```
	 **/
	var Deflate = function(options) {

	  this.options = utils.assign({
	    level: Z_DEFAULT_COMPRESSION,
	    method: Z_DEFLATED,
	    chunkSize: 16384,
	    windowBits: 15,
	    memLevel: 8,
	    strategy: Z_DEFAULT_STRATEGY,
	    to: ''
	  }, options || {});

	  var opt = this.options;

	  if (opt.raw && (opt.windowBits > 0)) {
	    opt.windowBits = -opt.windowBits;
	  }

	  else if (opt.gzip && (opt.windowBits > 0) && (opt.windowBits < 16)) {
	    opt.windowBits += 16;
	  }

	  this.err    = 0;      // error code, if happens (0 = Z_OK)
	  this.msg    = '';     // error message
	  this.ended  = false;  // used to avoid multiple onEnd() calls
	  this.chunks = [];     // chunks of compressed data

	  this.strm = new zstream();
	  this.strm.avail_out = 0;

	  var status = zlib_deflate.deflateInit2(
	    this.strm,
	    opt.level,
	    opt.method,
	    opt.windowBits,
	    opt.memLevel,
	    opt.strategy
	  );

	  if (status !== Z_OK) {
	    throw new Error(msg[status]);
	  }

	  if (opt.header) {
	    zlib_deflate.deflateSetHeader(this.strm, opt.header);
	  }
	};

	/**
	 * Deflate#push(data[, mode]) -> Boolean
	 * - data (Uint8Array|Array|ArrayBuffer|String): input data. Strings will be
	 *   converted to utf8 byte sequence.
	 * - mode (Number|Boolean): 0..6 for corresponding Z_NO_FLUSH..Z_TREE modes.
	 *   See constants. Skipped or `false` means Z_NO_FLUSH, `true` meansh Z_FINISH.
	 *
	 * Sends input data to deflate pipe, generating [[Deflate#onData]] calls with
	 * new compressed chunks. Returns `true` on success. The last data block must have
	 * mode Z_FINISH (or `true`). That flush internal pending buffers and call
	 * [[Deflate#onEnd]].
	 *
	 * On fail call [[Deflate#onEnd]] with error code and return false.
	 *
	 * We strongly recommend to use `Uint8Array` on input for best speed (output
	 * array format is detected automatically). Also, don't skip last param and always
	 * use the same type in your code (boolean or number). That will improve JS speed.
	 *
	 * For regular `Array`-s make sure all elements are [0..255].
	 *
	 * ##### Example
	 *
	 * ```javascript
	 * push(chunk, false); // push one of data chunks
	 * ...
	 * push(chunk, true);  // push last chunk
	 * ```
	 **/
	Deflate.prototype.push = function(data, mode) {
	  var strm = this.strm;
	  var chunkSize = this.options.chunkSize;
	  var status, _mode;

	  if (this.ended) { return false; }

	  _mode = (mode === ~~mode) ? mode : ((mode === true) ? Z_FINISH : Z_NO_FLUSH);

	  // Convert data if needed
	  if (typeof data === 'string') {
	    // If we need to compress text, change encoding to utf8.
	    strm.input = strings.string2buf(data);
	  } else if (toString.call(data) === '[object ArrayBuffer]') {
	    strm.input = new Uint8Array(data);
	  } else {
	    strm.input = data;
	  }

	  strm.next_in = 0;
	  strm.avail_in = strm.input.length;

	  do {
	    if (strm.avail_out === 0) {
	      strm.output = new utils.Buf8(chunkSize);
	      strm.next_out = 0;
	      strm.avail_out = chunkSize;
	    }
	    status = zlib_deflate.deflate(strm, _mode);    /* no bad return value */

	    if (status !== Z_STREAM_END && status !== Z_OK) {
	      this.onEnd(status);
	      this.ended = true;
	      return false;
	    }
	    if (strm.avail_out === 0 || (strm.avail_in === 0 && _mode === Z_FINISH)) {
	      if (this.options.to === 'string') {
	        this.onData(strings.buf2binstring(utils.shrinkBuf(strm.output, strm.next_out)));
	      } else {
	        this.onData(utils.shrinkBuf(strm.output, strm.next_out));
	      }
	    }
	  } while ((strm.avail_in > 0 || strm.avail_out === 0) && status !== Z_STREAM_END);

	  // Finalize on the last chunk.
	  if (_mode === Z_FINISH) {
	    status = zlib_deflate.deflateEnd(this.strm);
	    this.onEnd(status);
	    this.ended = true;
	    return status === Z_OK;
	  }

	  return true;
	};


	/**
	 * Deflate#onData(chunk) -> Void
	 * - chunk (Uint8Array|Array|String): ouput data. Type of array depends
	 *   on js engine support. When string output requested, each chunk
	 *   will be string.
	 *
	 * By default, stores data blocks in `chunks[]` property and glue
	 * those in `onEnd`. Override this handler, if you need another behaviour.
	 **/
	Deflate.prototype.onData = function(chunk) {
	  this.chunks.push(chunk);
	};


	/**
	 * Deflate#onEnd(status) -> Void
	 * - status (Number): deflate status. 0 (Z_OK) on success,
	 *   other if not.
	 *
	 * Called once after you tell deflate that input stream complete
	 * or error happenned. By default - join collected chunks,
	 * free memory and fill `results` / `err` properties.
	 **/
	Deflate.prototype.onEnd = function(status) {
	  // On success - join
	  if (status === Z_OK) {
	    if (this.options.to === 'string') {
	      this.result = this.chunks.join('');
	    } else {
	      this.result = utils.flattenChunks(this.chunks);
	    }
	  }
	  this.chunks = [];
	  this.err = status;
	  this.msg = this.strm.msg;
	};


	/**
	 * deflate(data[, options]) -> Uint8Array|Array|String
	 * - data (Uint8Array|Array|String): input data to compress.
	 * - options (Object): zlib deflate options.
	 *
	 * Compress `data` with deflate alrorythm and `options`.
	 *
	 * Supported options are:
	 *
	 * - level
	 * - windowBits
	 * - memLevel
	 * - strategy
	 *
	 * [http://zlib.net/manual.html#Advanced](http://zlib.net/manual.html#Advanced)
	 * for more information on these.
	 *
	 * Sugar (options):
	 *
	 * - `raw` (Boolean) - say that we work with raw stream, if you don't wish to specify
	 *   negative windowBits implicitly.
	 * - `to` (String) - if equal to 'string', then result will be "binary string"
	 *    (each char code [0..255])
	 *
	 * ##### Example:
	 *
	 * ```javascript
	 * var pako = require('pako')
	 *   , data = Uint8Array([1,2,3,4,5,6,7,8,9]);
	 *
	 * console.log(pako.deflate(data));
	 * ```
	 **/
	function deflate(input, options) {
	  var deflator = new Deflate(options);

	  deflator.push(input, true);

	  // That will never happens, if you don't cheat with options :)
	  if (deflator.err) { throw deflator.msg; }

	  return deflator.result;
	}


	/**
	 * deflateRaw(data[, options]) -> Uint8Array|Array|String
	 * - data (Uint8Array|Array|String): input data to compress.
	 * - options (Object): zlib deflate options.
	 *
	 * The same as [[deflate]], but creates raw data, without wrapper
	 * (header and adler32 crc).
	 **/
	function deflateRaw(input, options) {
	  options = options || {};
	  options.raw = true;
	  return deflate(input, options);
	}


	/**
	 * gzip(data[, options]) -> Uint8Array|Array|String
	 * - data (Uint8Array|Array|String): input data to compress.
	 * - options (Object): zlib deflate options.
	 *
	 * The same as [[deflate]], but create gzip wrapper instead of
	 * deflate one.
	 **/
	function gzip(input, options) {
	  options = options || {};
	  options.gzip = true;
	  return deflate(input, options);
	}


	exports.Deflate = Deflate;
	exports.deflate = deflate;
	exports.deflateRaw = deflateRaw;
	exports.gzip = gzip;

/***/ },
/* 10 */
/***/ function(module, exports, __webpack_require__) {

	'use strict';

	var utils   = __webpack_require__(8);
	var trees   = __webpack_require__(11);
	var adler32 = __webpack_require__(12);
	var crc32   = __webpack_require__(13);
	var msg   = __webpack_require__(14);

	/* Public constants ==========================================================*/
	/* ===========================================================================*/


	/* Allowed flush values; see deflate() and inflate() below for details */
	var Z_NO_FLUSH      = 0;
	var Z_PARTIAL_FLUSH = 1;
	//var Z_SYNC_FLUSH    = 2;
	var Z_FULL_FLUSH    = 3;
	var Z_FINISH        = 4;
	var Z_BLOCK         = 5;
	//var Z_TREES         = 6;


	/* Return codes for the compression/decompression functions. Negative values
	 * are errors, positive values are used for special but normal events.
	 */
	var Z_OK            = 0;
	var Z_STREAM_END    = 1;
	//var Z_NEED_DICT     = 2;
	//var Z_ERRNO         = -1;
	var Z_STREAM_ERROR  = -2;
	var Z_DATA_ERROR    = -3;
	//var Z_MEM_ERROR     = -4;
	var Z_BUF_ERROR     = -5;
	//var Z_VERSION_ERROR = -6;


	/* compression levels */
	//var Z_NO_COMPRESSION      = 0;
	//var Z_BEST_SPEED          = 1;
	//var Z_BEST_COMPRESSION    = 9;
	var Z_DEFAULT_COMPRESSION = -1;


	var Z_FILTERED            = 1;
	var Z_HUFFMAN_ONLY        = 2;
	var Z_RLE                 = 3;
	var Z_FIXED               = 4;
	var Z_DEFAULT_STRATEGY    = 0;

	/* Possible values of the data_type field (though see inflate()) */
	//var Z_BINARY              = 0;
	//var Z_TEXT                = 1;
	//var Z_ASCII               = 1; // = Z_TEXT
	var Z_UNKNOWN             = 2;


	/* The deflate compression method */
	var Z_DEFLATED  = 8;

	/*============================================================================*/


	var MAX_MEM_LEVEL = 9;
	/* Maximum value for memLevel in deflateInit2 */
	var MAX_WBITS = 15;
	/* 32K LZ77 window */
	var DEF_MEM_LEVEL = 8;


	var LENGTH_CODES  = 29;
	/* number of length codes, not counting the special END_BLOCK code */
	var LITERALS      = 256;
	/* number of literal bytes 0..255 */
	var L_CODES       = LITERALS + 1 + LENGTH_CODES;
	/* number of Literal or Length codes, including the END_BLOCK code */
	var D_CODES       = 30;
	/* number of distance codes */
	var BL_CODES      = 19;
	/* number of codes used to transfer the bit lengths */
	var HEAP_SIZE     = 2*L_CODES + 1;
	/* maximum heap size */
	var MAX_BITS  = 15;
	/* All codes must not exceed MAX_BITS bits */

	var MIN_MATCH = 3;
	var MAX_MATCH = 258;
	var MIN_LOOKAHEAD = (MAX_MATCH + MIN_MATCH + 1);

	var PRESET_DICT = 0x20;

	var INIT_STATE = 42;
	var EXTRA_STATE = 69;
	var NAME_STATE = 73;
	var COMMENT_STATE = 91;
	var HCRC_STATE = 103;
	var BUSY_STATE = 113;
	var FINISH_STATE = 666;

	var BS_NEED_MORE      = 1; /* block not completed, need more input or more output */
	var BS_BLOCK_DONE     = 2; /* block flush performed */
	var BS_FINISH_STARTED = 3; /* finish started, need only more output at next deflate */
	var BS_FINISH_DONE    = 4; /* finish done, accept no more input or output */

	var OS_CODE = 0x03; // Unix :) . Don't detect, use this default.

	function err(strm, errorCode) {
	  strm.msg = msg[errorCode];
	  return errorCode;
	}

	function rank(f) {
	  return ((f) << 1) - ((f) > 4 ? 9 : 0);
	}

	function zero(buf) { var len = buf.length; while (--len >= 0) { buf[len] = 0; } }


	/* =========================================================================
	 * Flush as much pending output as possible. All deflate() output goes
	 * through this function so some applications may wish to modify it
	 * to avoid allocating a large strm->output buffer and copying into it.
	 * (See also read_buf()).
	 */
	function flush_pending(strm) {
	  var s = strm.state;

	  //_tr_flush_bits(s);
	  var len = s.pending;
	  if (len > strm.avail_out) {
	    len = strm.avail_out;
	  }
	  if (len === 0) { return; }

	  utils.arraySet(strm.output, s.pending_buf, s.pending_out, len, strm.next_out);
	  strm.next_out += len;
	  s.pending_out += len;
	  strm.total_out += len;
	  strm.avail_out -= len;
	  s.pending -= len;
	  if (s.pending === 0) {
	    s.pending_out = 0;
	  }
	}


	function flush_block_only (s, last) {
	  trees._tr_flush_block(s, (s.block_start >= 0 ? s.block_start : -1), s.strstart - s.block_start, last);
	  s.block_start = s.strstart;
	  flush_pending(s.strm);
	}


	function put_byte(s, b) {
	  s.pending_buf[s.pending++] = b;
	}


	/* =========================================================================
	 * Put a short in the pending buffer. The 16-bit value is put in MSB order.
	 * IN assertion: the stream state is correct and there is enough room in
	 * pending_buf.
	 */
	function putShortMSB(s, b) {
	//  put_byte(s, (Byte)(b >> 8));
	//  put_byte(s, (Byte)(b & 0xff));
	  s.pending_buf[s.pending++] = (b >>> 8) & 0xff;
	  s.pending_buf[s.pending++] = b & 0xff;
	}


	/* ===========================================================================
	 * Read a new buffer from the current input stream, update the adler32
	 * and total number of bytes read.  All deflate() input goes through
	 * this function so some applications may wish to modify it to avoid
	 * allocating a large strm->input buffer and copying from it.
	 * (See also flush_pending()).
	 */
	function read_buf(strm, buf, start, size) {
	  var len = strm.avail_in;

	  if (len > size) { len = size; }
	  if (len === 0) { return 0; }

	  strm.avail_in -= len;

	  utils.arraySet(buf, strm.input, strm.next_in, len, start);
	  if (strm.state.wrap === 1) {
	    strm.adler = adler32(strm.adler, buf, len, start);
	  }

	  else if (strm.state.wrap === 2) {
	    strm.adler = crc32(strm.adler, buf, len, start);
	  }

	  strm.next_in += len;
	  strm.total_in += len;

	  return len;
	}


	/* ===========================================================================
	 * Set match_start to the longest match starting at the given string and
	 * return its length. Matches shorter or equal to prev_length are discarded,
	 * in which case the result is equal to prev_length and match_start is
	 * garbage.
	 * IN assertions: cur_match is the head of the hash chain for the current
	 *   string (strstart) and its distance is <= MAX_DIST, and prev_length >= 1
	 * OUT assertion: the match length is not greater than s->lookahead.
	 */
	function longest_match(s, cur_match) {
	  var chain_length = s.max_chain_length;      /* max hash chain length */
	  var scan = s.strstart; /* current string */
	  var match;                       /* matched string */
	  var len;                           /* length of current match */
	  var best_len = s.prev_length;              /* best match length so far */
	  var nice_match = s.nice_match;             /* stop if match long enough */
	  var limit = (s.strstart > (s.w_size - MIN_LOOKAHEAD)) ?
	      s.strstart - (s.w_size - MIN_LOOKAHEAD) : 0/*NIL*/;

	  var _win = s.window; // shortcut

	  var wmask = s.w_mask;
	  var prev  = s.prev;

	  /* Stop when cur_match becomes <= limit. To simplify the code,
	   * we prevent matches with the string of window index 0.
	   */

	  var strend = s.strstart + MAX_MATCH;
	  var scan_end1  = _win[scan + best_len - 1];
	  var scan_end   = _win[scan + best_len];

	  /* The code is optimized for HASH_BITS >= 8 and MAX_MATCH-2 multiple of 16.
	   * It is easy to get rid of this optimization if necessary.
	   */
	  // Assert(s->hash_bits >= 8 && MAX_MATCH == 258, "Code too clever");

	  /* Do not waste too much time if we already have a good match: */
	  if (s.prev_length >= s.good_match) {
	    chain_length >>= 2;
	  }
	  /* Do not look for matches beyond the end of the input. This is necessary
	   * to make deflate deterministic.
	   */
	  if (nice_match > s.lookahead) { nice_match = s.lookahead; }

	  // Assert((ulg)s->strstart <= s->window_size-MIN_LOOKAHEAD, "need lookahead");

	  do {
	    // Assert(cur_match < s->strstart, "no future");
	    match = cur_match;

	    /* Skip to next match if the match length cannot increase
	     * or if the match length is less than 2.  Note that the checks below
	     * for insufficient lookahead only occur occasionally for performance
	     * reasons.  Therefore uninitialized memory will be accessed, and
	     * conditional jumps will be made that depend on those values.
	     * However the length of the match is limited to the lookahead, so
	     * the output of deflate is not affected by the uninitialized values.
	     */

	    if (_win[match + best_len]     !== scan_end  ||
	        _win[match + best_len - 1] !== scan_end1 ||
	        _win[match]                !== _win[scan] ||
	        _win[++match]              !== _win[scan + 1]) {
	      continue;
	    }

	    /* The check at best_len-1 can be removed because it will be made
	     * again later. (This heuristic is not always a win.)
	     * It is not necessary to compare scan[2] and match[2] since they
	     * are always equal when the other bytes match, given that
	     * the hash keys are equal and that HASH_BITS >= 8.
	     */
	    scan += 2;
	    match++;
	    // Assert(*scan == *match, "match[2]?");

	    /* We check for insufficient lookahead only every 8th comparison;
	     * the 256th check will be made at strstart+258.
	     */
	    do {
	      /*jshint noempty:false*/
	    } while (_win[++scan] === _win[++match] && _win[++scan] === _win[++match] &&
	             _win[++scan] === _win[++match] && _win[++scan] === _win[++match] &&
	             _win[++scan] === _win[++match] && _win[++scan] === _win[++match] &&
	             _win[++scan] === _win[++match] && _win[++scan] === _win[++match] &&
	             scan < strend);

	    // Assert(scan <= s->window+(unsigned)(s->window_size-1), "wild scan");

	    len = MAX_MATCH - (strend - scan);
	    scan = strend - MAX_MATCH;

	    if (len > best_len) {
	      s.match_start = cur_match;
	      best_len = len;
	      if (len >= nice_match) {
	        break;
	      }
	      scan_end1  = _win[scan + best_len - 1];
	      scan_end   = _win[scan + best_len];
	    }
	  } while ((cur_match = prev[cur_match & wmask]) > limit && --chain_length !== 0);

	  if (best_len <= s.lookahead) {
	    return best_len;
	  }
	  return s.lookahead;
	}


	/* ===========================================================================
	 * Fill the window when the lookahead becomes insufficient.
	 * Updates strstart and lookahead.
	 *
	 * IN assertion: lookahead < MIN_LOOKAHEAD
	 * OUT assertions: strstart <= window_size-MIN_LOOKAHEAD
	 *    At least one byte has been read, or avail_in == 0; reads are
	 *    performed for at least two bytes (required for the zip translate_eol
	 *    option -- not supported here).
	 */
	function fill_window(s) {
	  var _w_size = s.w_size;
	  var p, n, m, more, str;

	  //Assert(s->lookahead < MIN_LOOKAHEAD, "already enough lookahead");

	  do {
	    more = s.window_size - s.lookahead - s.strstart;

	    // JS ints have 32 bit, block below not needed
	    /* Deal with !@#$% 64K limit: */
	    //if (sizeof(int) <= 2) {
	    //    if (more == 0 && s->strstart == 0 && s->lookahead == 0) {
	    //        more = wsize;
	    //
	    //  } else if (more == (unsigned)(-1)) {
	    //        /* Very unlikely, but possible on 16 bit machine if
	    //         * strstart == 0 && lookahead == 1 (input done a byte at time)
	    //         */
	    //        more--;
	    //    }
	    //}


	    /* If the window is almost full and there is insufficient lookahead,
	     * move the upper half to the lower one to make room in the upper half.
	     */
	    if (s.strstart >= _w_size + (_w_size - MIN_LOOKAHEAD)) {

	      utils.arraySet(s.window, s.window, _w_size, _w_size, 0);
	      s.match_start -= _w_size;
	      s.strstart -= _w_size;
	      /* we now have strstart >= MAX_DIST */
	      s.block_start -= _w_size;

	      /* Slide the hash table (could be avoided with 32 bit values
	       at the expense of memory usage). We slide even when level == 0
	       to keep the hash table consistent if we switch back to level > 0
	       later. (Using level 0 permanently is not an optimal usage of
	       zlib, so we don't care about this pathological case.)
	       */

	      n = s.hash_size;
	      p = n;
	      do {
	        m = s.head[--p];
	        s.head[p] = (m >= _w_size ? m - _w_size : 0);
	      } while (--n);

	      n = _w_size;
	      p = n;
	      do {
	        m = s.prev[--p];
	        s.prev[p] = (m >= _w_size ? m - _w_size : 0);
	        /* If n is not on any hash chain, prev[n] is garbage but
	         * its value will never be used.
	         */
	      } while (--n);

	      more += _w_size;
	    }
	    if (s.strm.avail_in === 0) {
	      break;
	    }

	    /* If there was no sliding:
	     *    strstart <= WSIZE+MAX_DIST-1 && lookahead <= MIN_LOOKAHEAD - 1 &&
	     *    more == window_size - lookahead - strstart
	     * => more >= window_size - (MIN_LOOKAHEAD-1 + WSIZE + MAX_DIST-1)
	     * => more >= window_size - 2*WSIZE + 2
	     * In the BIG_MEM or MMAP case (not yet supported),
	     *   window_size == input_size + MIN_LOOKAHEAD  &&
	     *   strstart + s->lookahead <= input_size => more >= MIN_LOOKAHEAD.
	     * Otherwise, window_size == 2*WSIZE so more >= 2.
	     * If there was sliding, more >= WSIZE. So in all cases, more >= 2.
	     */
	    //Assert(more >= 2, "more < 2");
	    n = read_buf(s.strm, s.window, s.strstart + s.lookahead, more);
	    s.lookahead += n;

	    /* Initialize the hash value now that we have some input: */
	    if (s.lookahead + s.insert >= MIN_MATCH) {
	      str = s.strstart - s.insert;
	      s.ins_h = s.window[str];

	      /* UPDATE_HASH(s, s->ins_h, s->window[str + 1]); */
	      s.ins_h = ((s.ins_h << s.hash_shift) ^ s.window[str + 1]) & s.hash_mask;
	//#if MIN_MATCH != 3
	//        Call update_hash() MIN_MATCH-3 more times
	//#endif
	      while (s.insert) {
	        /* UPDATE_HASH(s, s->ins_h, s->window[str + MIN_MATCH-1]); */
	        s.ins_h = ((s.ins_h << s.hash_shift) ^ s.window[str + MIN_MATCH-1]) & s.hash_mask;

	        s.prev[str & s.w_mask] = s.head[s.ins_h];
	        s.head[s.ins_h] = str;
	        str++;
	        s.insert--;
	        if (s.lookahead + s.insert < MIN_MATCH) {
	          break;
	        }
	      }
	    }
	    /* If the whole input has less than MIN_MATCH bytes, ins_h is garbage,
	     * but this is not important since only literal bytes will be emitted.
	     */

	  } while (s.lookahead < MIN_LOOKAHEAD && s.strm.avail_in !== 0);

	  /* If the WIN_INIT bytes after the end of the current data have never been
	   * written, then zero those bytes in order to avoid memory check reports of
	   * the use of uninitialized (or uninitialised as Julian writes) bytes by
	   * the longest match routines.  Update the high water mark for the next
	   * time through here.  WIN_INIT is set to MAX_MATCH since the longest match
	   * routines allow scanning to strstart + MAX_MATCH, ignoring lookahead.
	   */
	//  if (s.high_water < s.window_size) {
	//    var curr = s.strstart + s.lookahead;
	//    var init = 0;
	//
	//    if (s.high_water < curr) {
	//      /* Previous high water mark below current data -- zero WIN_INIT
	//       * bytes or up to end of window, whichever is less.
	//       */
	//      init = s.window_size - curr;
	//      if (init > WIN_INIT)
	//        init = WIN_INIT;
	//      zmemzero(s->window + curr, (unsigned)init);
	//      s->high_water = curr + init;
	//    }
	//    else if (s->high_water < (ulg)curr + WIN_INIT) {
	//      /* High water mark at or above current data, but below current data
	//       * plus WIN_INIT -- zero out to current data plus WIN_INIT, or up
	//       * to end of window, whichever is less.
	//       */
	//      init = (ulg)curr + WIN_INIT - s->high_water;
	//      if (init > s->window_size - s->high_water)
	//        init = s->window_size - s->high_water;
	//      zmemzero(s->window + s->high_water, (unsigned)init);
	//      s->high_water += init;
	//    }
	//  }
	//
	//  Assert((ulg)s->strstart <= s->window_size - MIN_LOOKAHEAD,
	//    "not enough room for search");
	}

	/* ===========================================================================
	 * Copy without compression as much as possible from the input stream, return
	 * the current block state.
	 * This function does not insert new strings in the dictionary since
	 * uncompressible data is probably not useful. This function is used
	 * only for the level=0 compression option.
	 * NOTE: this function should be optimized to avoid extra copying from
	 * window to pending_buf.
	 */
	function deflate_stored(s, flush) {
	  /* Stored blocks are limited to 0xffff bytes, pending_buf is limited
	   * to pending_buf_size, and each stored block has a 5 byte header:
	   */
	  var max_block_size = 0xffff;

	  if (max_block_size > s.pending_buf_size - 5) {
	    max_block_size = s.pending_buf_size - 5;
	  }

	  /* Copy as much as possible from input to output: */
	  for (;;) {
	    /* Fill the window as much as possible: */
	    if (s.lookahead <= 1) {

	      //Assert(s->strstart < s->w_size+MAX_DIST(s) ||
	      //  s->block_start >= (long)s->w_size, "slide too late");
	//      if (!(s.strstart < s.w_size + (s.w_size - MIN_LOOKAHEAD) ||
	//        s.block_start >= s.w_size)) {
	//        throw  new Error("slide too late");
	//      }

	      fill_window(s);
	      if (s.lookahead === 0 && flush === Z_NO_FLUSH) {
	        return BS_NEED_MORE;
	      }

	      if (s.lookahead === 0) {
	        break;
	      }
	      /* flush the current block */
	    }
	    //Assert(s->block_start >= 0L, "block gone");
	//    if (s.block_start < 0) throw new Error("block gone");

	    s.strstart += s.lookahead;
	    s.lookahead = 0;

	    /* Emit a stored block if pending_buf will be full: */
	    var max_start = s.block_start + max_block_size;

	    if (s.strstart === 0 || s.strstart >= max_start) {
	      /* strstart == 0 is possible when wraparound on 16-bit machine */
	      s.lookahead = s.strstart - max_start;
	      s.strstart = max_start;
	      /*** FLUSH_BLOCK(s, 0); ***/
	      flush_block_only(s, false);
	      if (s.strm.avail_out === 0) {
	        return BS_NEED_MORE;
	      }
	      /***/


	    }
	    /* Flush if we may have to slide, otherwise block_start may become
	     * negative and the data will be gone:
	     */
	    if (s.strstart - s.block_start >= (s.w_size - MIN_LOOKAHEAD)) {
	      /*** FLUSH_BLOCK(s, 0); ***/
	      flush_block_only(s, false);
	      if (s.strm.avail_out === 0) {
	        return BS_NEED_MORE;
	      }
	      /***/
	    }
	  }

	  s.insert = 0;

	  if (flush === Z_FINISH) {
	    /*** FLUSH_BLOCK(s, 1); ***/
	    flush_block_only(s, true);
	    if (s.strm.avail_out === 0) {
	      return BS_FINISH_STARTED;
	    }
	    /***/
	    return BS_FINISH_DONE;
	  }

	  if (s.strstart > s.block_start) {
	    /*** FLUSH_BLOCK(s, 0); ***/
	    flush_block_only(s, false);
	    if (s.strm.avail_out === 0) {
	      return BS_NEED_MORE;
	    }
	    /***/
	  }

	  return BS_NEED_MORE;
	}

	/* ===========================================================================
	 * Compress as much as possible from the input stream, return the current
	 * block state.
	 * This function does not perform lazy evaluation of matches and inserts
	 * new strings in the dictionary only for unmatched strings or for short
	 * matches. It is used only for the fast compression options.
	 */
	function deflate_fast(s, flush) {
	  var hash_head;        /* head of the hash chain */
	  var bflush;           /* set if current block must be flushed */

	  for (;;) {
	    /* Make sure that we always have enough lookahead, except
	     * at the end of the input file. We need MAX_MATCH bytes
	     * for the next match, plus MIN_MATCH bytes to insert the
	     * string following the next match.
	     */
	    if (s.lookahead < MIN_LOOKAHEAD) {
	      fill_window(s);
	      if (s.lookahead < MIN_LOOKAHEAD && flush === Z_NO_FLUSH) {
	        return BS_NEED_MORE;
	      }
	      if (s.lookahead === 0) {
	        break; /* flush the current block */
	      }
	    }

	    /* Insert the string window[strstart .. strstart+2] in the
	     * dictionary, and set hash_head to the head of the hash chain:
	     */
	    hash_head = 0/*NIL*/;
	    if (s.lookahead >= MIN_MATCH) {
	      /*** INSERT_STRING(s, s.strstart, hash_head); ***/
	      s.ins_h = ((s.ins_h << s.hash_shift) ^ s.window[s.strstart + MIN_MATCH - 1]) & s.hash_mask;
	      hash_head = s.prev[s.strstart & s.w_mask] = s.head[s.ins_h];
	      s.head[s.ins_h] = s.strstart;
	      /***/
	    }

	    /* Find the longest match, discarding those <= prev_length.
	     * At this point we have always match_length < MIN_MATCH
	     */
	    if (hash_head !== 0/*NIL*/ && ((s.strstart - hash_head) <= (s.w_size - MIN_LOOKAHEAD))) {
	      /* To simplify the code, we prevent matches with the string
	       * of window index 0 (in particular we have to avoid a match
	       * of the string with itself at the start of the input file).
	       */
	      s.match_length = longest_match(s, hash_head);
	      /* longest_match() sets match_start */
	    }
	    if (s.match_length >= MIN_MATCH) {
	      // check_match(s, s.strstart, s.match_start, s.match_length); // for debug only

	      /*** _tr_tally_dist(s, s.strstart - s.match_start,
	                     s.match_length - MIN_MATCH, bflush); ***/
	      bflush = trees._tr_tally(s, s.strstart - s.match_start, s.match_length - MIN_MATCH);

	      s.lookahead -= s.match_length;

	      /* Insert new strings in the hash table only if the match length
	       * is not too large. This saves time but degrades compression.
	       */
	      if (s.match_length <= s.max_lazy_match/*max_insert_length*/ && s.lookahead >= MIN_MATCH) {
	        s.match_length--; /* string at strstart already in table */
	        do {
	          s.strstart++;
	          /*** INSERT_STRING(s, s.strstart, hash_head); ***/
	          s.ins_h = ((s.ins_h << s.hash_shift) ^ s.window[s.strstart + MIN_MATCH - 1]) & s.hash_mask;
	          hash_head = s.prev[s.strstart & s.w_mask] = s.head[s.ins_h];
	          s.head[s.ins_h] = s.strstart;
	          /***/
	          /* strstart never exceeds WSIZE-MAX_MATCH, so there are
	           * always MIN_MATCH bytes ahead.
	           */
	        } while (--s.match_length !== 0);
	        s.strstart++;
	      } else
	      {
	        s.strstart += s.match_length;
	        s.match_length = 0;
	        s.ins_h = s.window[s.strstart];
	        /* UPDATE_HASH(s, s.ins_h, s.window[s.strstart+1]); */
	        s.ins_h = ((s.ins_h << s.hash_shift) ^ s.window[s.strstart + 1]) & s.hash_mask;

	//#if MIN_MATCH != 3
	//                Call UPDATE_HASH() MIN_MATCH-3 more times
	//#endif
	        /* If lookahead < MIN_MATCH, ins_h is garbage, but it does not
	         * matter since it will be recomputed at next deflate call.
	         */
	      }
	    } else {
	      /* No match, output a literal byte */
	      //Tracevv((stderr,"%c", s.window[s.strstart]));
	      /*** _tr_tally_lit(s, s.window[s.strstart], bflush); ***/
	      bflush = trees._tr_tally(s, 0, s.window[s.strstart]);

	      s.lookahead--;
	      s.strstart++;
	    }
	    if (bflush) {
	      /*** FLUSH_BLOCK(s, 0); ***/
	      flush_block_only(s, false);
	      if (s.strm.avail_out === 0) {
	        return BS_NEED_MORE;
	      }
	      /***/
	    }
	  }
	  s.insert = ((s.strstart < (MIN_MATCH-1)) ? s.strstart : MIN_MATCH-1);
	  if (flush === Z_FINISH) {
	    /*** FLUSH_BLOCK(s, 1); ***/
	    flush_block_only(s, true);
	    if (s.strm.avail_out === 0) {
	      return BS_FINISH_STARTED;
	    }
	    /***/
	    return BS_FINISH_DONE;
	  }
	  if (s.last_lit) {
	    /*** FLUSH_BLOCK(s, 0); ***/
	    flush_block_only(s, false);
	    if (s.strm.avail_out === 0) {
	      return BS_NEED_MORE;
	    }
	    /***/
	  }
	  return BS_BLOCK_DONE;
	}

	/* ===========================================================================
	 * Same as above, but achieves better compression. We use a lazy
	 * evaluation for matches: a match is finally adopted only if there is
	 * no better match at the next window position.
	 */
	function deflate_slow(s, flush) {
	  var hash_head;          /* head of hash chain */
	  var bflush;              /* set if current block must be flushed */

	  var max_insert;

	  /* Process the input block. */
	  for (;;) {
	    /* Make sure that we always have enough lookahead, except
	     * at the end of the input file. We need MAX_MATCH bytes
	     * for the next match, plus MIN_MATCH bytes to insert the
	     * string following the next match.
	     */
	    if (s.lookahead < MIN_LOOKAHEAD) {
	      fill_window(s);
	      if (s.lookahead < MIN_LOOKAHEAD && flush === Z_NO_FLUSH) {
	        return BS_NEED_MORE;
	      }
	      if (s.lookahead === 0) { break; } /* flush the current block */
	    }

	    /* Insert the string window[strstart .. strstart+2] in the
	     * dictionary, and set hash_head to the head of the hash chain:
	     */
	    hash_head = 0/*NIL*/;
	    if (s.lookahead >= MIN_MATCH) {
	      /*** INSERT_STRING(s, s.strstart, hash_head); ***/
	      s.ins_h = ((s.ins_h << s.hash_shift) ^ s.window[s.strstart + MIN_MATCH - 1]) & s.hash_mask;
	      hash_head = s.prev[s.strstart & s.w_mask] = s.head[s.ins_h];
	      s.head[s.ins_h] = s.strstart;
	      /***/
	    }

	    /* Find the longest match, discarding those <= prev_length.
	     */
	    s.prev_length = s.match_length;
	    s.prev_match = s.match_start;
	    s.match_length = MIN_MATCH-1;

	    if (hash_head !== 0/*NIL*/ && s.prev_length < s.max_lazy_match &&
	        s.strstart - hash_head <= (s.w_size-MIN_LOOKAHEAD)/*MAX_DIST(s)*/) {
	      /* To simplify the code, we prevent matches with the string
	       * of window index 0 (in particular we have to avoid a match
	       * of the string with itself at the start of the input file).
	       */
	      s.match_length = longest_match(s, hash_head);
	      /* longest_match() sets match_start */

	      if (s.match_length <= 5 &&
	         (s.strategy === Z_FILTERED || (s.match_length === MIN_MATCH && s.strstart - s.match_start > 4096/*TOO_FAR*/))) {

	        /* If prev_match is also MIN_MATCH, match_start is garbage
	         * but we will ignore the current match anyway.
	         */
	        s.match_length = MIN_MATCH-1;
	      }
	    }
	    /* If there was a match at the previous step and the current
	     * match is not better, output the previous match:
	     */
	    if (s.prev_length >= MIN_MATCH && s.match_length <= s.prev_length) {
	      max_insert = s.strstart + s.lookahead - MIN_MATCH;
	      /* Do not insert strings in hash table beyond this. */

	      //check_match(s, s.strstart-1, s.prev_match, s.prev_length);

	      /***_tr_tally_dist(s, s.strstart - 1 - s.prev_match,
	                     s.prev_length - MIN_MATCH, bflush);***/
	      bflush = trees._tr_tally(s, s.strstart - 1- s.prev_match, s.prev_length - MIN_MATCH);
	      /* Insert in hash table all strings up to the end of the match.
	       * strstart-1 and strstart are already inserted. If there is not
	       * enough lookahead, the last two strings are not inserted in
	       * the hash table.
	       */
	      s.lookahead -= s.prev_length-1;
	      s.prev_length -= 2;
	      do {
	        if (++s.strstart <= max_insert) {
	          /*** INSERT_STRING(s, s.strstart, hash_head); ***/
	          s.ins_h = ((s.ins_h << s.hash_shift) ^ s.window[s.strstart + MIN_MATCH - 1]) & s.hash_mask;
	          hash_head = s.prev[s.strstart & s.w_mask] = s.head[s.ins_h];
	          s.head[s.ins_h] = s.strstart;
	          /***/
	        }
	      } while (--s.prev_length !== 0);
	      s.match_available = 0;
	      s.match_length = MIN_MATCH-1;
	      s.strstart++;

	      if (bflush) {
	        /*** FLUSH_BLOCK(s, 0); ***/
	        flush_block_only(s, false);
	        if (s.strm.avail_out === 0) {
	          return BS_NEED_MORE;
	        }
	        /***/
	      }

	    } else if (s.match_available) {
	      /* If there was no match at the previous position, output a
	       * single literal. If there was a match but the current match
	       * is longer, truncate the previous match to a single literal.
	       */
	      //Tracevv((stderr,"%c", s->window[s->strstart-1]));
	      /*** _tr_tally_lit(s, s.window[s.strstart-1], bflush); ***/
	      bflush = trees._tr_tally(s, 0, s.window[s.strstart-1]);

	      if (bflush) {
	        /*** FLUSH_BLOCK_ONLY(s, 0) ***/
	        flush_block_only(s, false);
	        /***/
	      }
	      s.strstart++;
	      s.lookahead--;
	      if (s.strm.avail_out === 0) {
	        return BS_NEED_MORE;
	      }
	    } else {
	      /* There is no previous match to compare with, wait for
	       * the next step to decide.
	       */
	      s.match_available = 1;
	      s.strstart++;
	      s.lookahead--;
	    }
	  }
	  //Assert (flush != Z_NO_FLUSH, "no flush?");
	  if (s.match_available) {
	    //Tracevv((stderr,"%c", s->window[s->strstart-1]));
	    /*** _tr_tally_lit(s, s.window[s.strstart-1], bflush); ***/
	    bflush = trees._tr_tally(s, 0, s.window[s.strstart-1]);

	    s.match_available = 0;
	  }
	  s.insert = s.strstart < MIN_MATCH-1 ? s.strstart : MIN_MATCH-1;
	  if (flush === Z_FINISH) {
	    /*** FLUSH_BLOCK(s, 1); ***/
	    flush_block_only(s, true);
	    if (s.strm.avail_out === 0) {
	      return BS_FINISH_STARTED;
	    }
	    /***/
	    return BS_FINISH_DONE;
	  }
	  if (s.last_lit) {
	    /*** FLUSH_BLOCK(s, 0); ***/
	    flush_block_only(s, false);
	    if (s.strm.avail_out === 0) {
	      return BS_NEED_MORE;
	    }
	    /***/
	  }

	  return BS_BLOCK_DONE;
	}


	/* ===========================================================================
	 * For Z_RLE, simply look for runs of bytes, generate matches only of distance
	 * one.  Do not maintain a hash table.  (It will be regenerated if this run of
	 * deflate switches away from Z_RLE.)
	 */
	function deflate_rle(s, flush) {
	  var bflush;            /* set if current block must be flushed */
	  var prev;              /* byte at distance one to match */
	  var scan, strend;      /* scan goes up to strend for length of run */

	  var _win = s.window;

	  for (;;) {
	    /* Make sure that we always have enough lookahead, except
	     * at the end of the input file. We need MAX_MATCH bytes
	     * for the longest run, plus one for the unrolled loop.
	     */
	    if (s.lookahead <= MAX_MATCH) {
	      fill_window(s);
	      if (s.lookahead <= MAX_MATCH && flush === Z_NO_FLUSH) {
	        return BS_NEED_MORE;
	      }
	      if (s.lookahead === 0) { break; } /* flush the current block */
	    }

	    /* See how many times the previous byte repeats */
	    s.match_length = 0;
	    if (s.lookahead >= MIN_MATCH && s.strstart > 0) {
	      scan = s.strstart - 1;
	      prev = _win[scan];
	      if (prev === _win[++scan] && prev === _win[++scan] && prev === _win[++scan]) {
	        strend = s.strstart + MAX_MATCH;
	        do {
	          /*jshint noempty:false*/
	        } while (prev === _win[++scan] && prev === _win[++scan] &&
	                 prev === _win[++scan] && prev === _win[++scan] &&
	                 prev === _win[++scan] && prev === _win[++scan] &&
	                 prev === _win[++scan] && prev === _win[++scan] &&
	                 scan < strend);
	        s.match_length = MAX_MATCH - (strend - scan);
	        if (s.match_length > s.lookahead) {
	          s.match_length = s.lookahead;
	        }
	      }
	      //Assert(scan <= s->window+(uInt)(s->window_size-1), "wild scan");
	    }

	    /* Emit match if have run of MIN_MATCH or longer, else emit literal */
	    if (s.match_length >= MIN_MATCH) {
	      //check_match(s, s.strstart, s.strstart - 1, s.match_length);

	      /*** _tr_tally_dist(s, 1, s.match_length - MIN_MATCH, bflush); ***/
	      bflush = trees._tr_tally(s, 1, s.match_length - MIN_MATCH);

	      s.lookahead -= s.match_length;
	      s.strstart += s.match_length;
	      s.match_length = 0;
	    } else {
	      /* No match, output a literal byte */
	      //Tracevv((stderr,"%c", s->window[s->strstart]));
	      /*** _tr_tally_lit(s, s.window[s.strstart], bflush); ***/
	      bflush = trees._tr_tally(s, 0, s.window[s.strstart]);

	      s.lookahead--;
	      s.strstart++;
	    }
	    if (bflush) {
	      /*** FLUSH_BLOCK(s, 0); ***/
	      flush_block_only(s, false);
	      if (s.strm.avail_out === 0) {
	        return BS_NEED_MORE;
	      }
	      /***/
	    }
	  }
	  s.insert = 0;
	  if (flush === Z_FINISH) {
	    /*** FLUSH_BLOCK(s, 1); ***/
	    flush_block_only(s, true);
	    if (s.strm.avail_out === 0) {
	      return BS_FINISH_STARTED;
	    }
	    /***/
	    return BS_FINISH_DONE;
	  }
	  if (s.last_lit) {
	    /*** FLUSH_BLOCK(s, 0); ***/
	    flush_block_only(s, false);
	    if (s.strm.avail_out === 0) {
	      return BS_NEED_MORE;
	    }
	    /***/
	  }
	  return BS_BLOCK_DONE;
	}

	/* ===========================================================================
	 * For Z_HUFFMAN_ONLY, do not look for matches.  Do not maintain a hash table.
	 * (It will be regenerated if this run of deflate switches away from Huffman.)
	 */
	function deflate_huff(s, flush) {
	  var bflush;             /* set if current block must be flushed */

	  for (;;) {
	    /* Make sure that we have a literal to write. */
	    if (s.lookahead === 0) {
	      fill_window(s);
	      if (s.lookahead === 0) {
	        if (flush === Z_NO_FLUSH) {
	          return BS_NEED_MORE;
	        }
	        break;      /* flush the current block */
	      }
	    }

	    /* Output a literal byte */
	    s.match_length = 0;
	    //Tracevv((stderr,"%c", s->window[s->strstart]));
	    /*** _tr_tally_lit(s, s.window[s.strstart], bflush); ***/
	    bflush = trees._tr_tally(s, 0, s.window[s.strstart]);
	    s.lookahead--;
	    s.strstart++;
	    if (bflush) {
	      /*** FLUSH_BLOCK(s, 0); ***/
	      flush_block_only(s, false);
	      if (s.strm.avail_out === 0) {
	        return BS_NEED_MORE;
	      }
	      /***/
	    }
	  }
	  s.insert = 0;
	  if (flush === Z_FINISH) {
	    /*** FLUSH_BLOCK(s, 1); ***/
	    flush_block_only(s, true);
	    if (s.strm.avail_out === 0) {
	      return BS_FINISH_STARTED;
	    }
	    /***/
	    return BS_FINISH_DONE;
	  }
	  if (s.last_lit) {
	    /*** FLUSH_BLOCK(s, 0); ***/
	    flush_block_only(s, false);
	    if (s.strm.avail_out === 0) {
	      return BS_NEED_MORE;
	    }
	    /***/
	  }
	  return BS_BLOCK_DONE;
	}

	/* Values for max_lazy_match, good_match and max_chain_length, depending on
	 * the desired pack level (0..9). The values given below have been tuned to
	 * exclude worst case performance for pathological files. Better values may be
	 * found for specific files.
	 */
	var Config = function (good_length, max_lazy, nice_length, max_chain, func) {
	  this.good_length = good_length;
	  this.max_lazy = max_lazy;
	  this.nice_length = nice_length;
	  this.max_chain = max_chain;
	  this.func = func;
	};

	var configuration_table;

	configuration_table = [
	  /*      good lazy nice chain */
	  new Config(0, 0, 0, 0, deflate_stored),          /* 0 store only */
	  new Config(4, 4, 8, 4, deflate_fast),            /* 1 max speed, no lazy matches */
	  new Config(4, 5, 16, 8, deflate_fast),           /* 2 */
	  new Config(4, 6, 32, 32, deflate_fast),          /* 3 */

	  new Config(4, 4, 16, 16, deflate_slow),          /* 4 lazy matches */
	  new Config(8, 16, 32, 32, deflate_slow),         /* 5 */
	  new Config(8, 16, 128, 128, deflate_slow),       /* 6 */
	  new Config(8, 32, 128, 256, deflate_slow),       /* 7 */
	  new Config(32, 128, 258, 1024, deflate_slow),    /* 8 */
	  new Config(32, 258, 258, 4096, deflate_slow)     /* 9 max compression */
	];


	/* ===========================================================================
	 * Initialize the "longest match" routines for a new zlib stream
	 */
	function lm_init(s) {
	  s.window_size = 2 * s.w_size;

	  /*** CLEAR_HASH(s); ***/
	  zero(s.head); // Fill with NIL (= 0);

	  /* Set the default configuration parameters:
	   */
	  s.max_lazy_match = configuration_table[s.level].max_lazy;
	  s.good_match = configuration_table[s.level].good_length;
	  s.nice_match = configuration_table[s.level].nice_length;
	  s.max_chain_length = configuration_table[s.level].max_chain;

	  s.strstart = 0;
	  s.block_start = 0;
	  s.lookahead = 0;
	  s.insert = 0;
	  s.match_length = s.prev_length = MIN_MATCH - 1;
	  s.match_available = 0;
	  s.ins_h = 0;
	}


	function DeflateState() {
	  this.strm = null;            /* pointer back to this zlib stream */
	  this.status = 0;            /* as the name implies */
	  this.pending_buf = null;      /* output still pending */
	  this.pending_buf_size = 0;  /* size of pending_buf */
	  this.pending_out = 0;       /* next pending byte to output to the stream */
	  this.pending = 0;           /* nb of bytes in the pending buffer */
	  this.wrap = 0;              /* bit 0 true for zlib, bit 1 true for gzip */
	  this.gzhead = null;         /* gzip header information to write */
	  this.gzindex = 0;           /* where in extra, name, or comment */
	  this.method = Z_DEFLATED; /* can only be DEFLATED */
	  this.last_flush = -1;   /* value of flush param for previous deflate call */

	  this.w_size = 0;  /* LZ77 window size (32K by default) */
	  this.w_bits = 0;  /* log2(w_size)  (8..16) */
	  this.w_mask = 0;  /* w_size - 1 */

	  this.window = null;
	  /* Sliding window. Input bytes are read into the second half of the window,
	   * and move to the first half later to keep a dictionary of at least wSize
	   * bytes. With this organization, matches are limited to a distance of
	   * wSize-MAX_MATCH bytes, but this ensures that IO is always
	   * performed with a length multiple of the block size.
	   */

	  this.window_size = 0;
	  /* Actual size of window: 2*wSize, except when the user input buffer
	   * is directly used as sliding window.
	   */

	  this.prev = null;
	  /* Link to older string with same hash index. To limit the size of this
	   * array to 64K, this link is maintained only for the last 32K strings.
	   * An index in this array is thus a window index modulo 32K.
	   */

	  this.head = null;   /* Heads of the hash chains or NIL. */

	  this.ins_h = 0;       /* hash index of string to be inserted */
	  this.hash_size = 0;   /* number of elements in hash table */
	  this.hash_bits = 0;   /* log2(hash_size) */
	  this.hash_mask = 0;   /* hash_size-1 */

	  this.hash_shift = 0;
	  /* Number of bits by which ins_h must be shifted at each input
	   * step. It must be such that after MIN_MATCH steps, the oldest
	   * byte no longer takes part in the hash key, that is:
	   *   hash_shift * MIN_MATCH >= hash_bits
	   */

	  this.block_start = 0;
	  /* Window position at the beginning of the current output block. Gets
	   * negative when the window is moved backwards.
	   */

	  this.match_length = 0;      /* length of best match */
	  this.prev_match = 0;        /* previous match */
	  this.match_available = 0;   /* set if previous match exists */
	  this.strstart = 0;          /* start of string to insert */
	  this.match_start = 0;       /* start of matching string */
	  this.lookahead = 0;         /* number of valid bytes ahead in window */

	  this.prev_length = 0;
	  /* Length of the best match at previous step. Matches not greater than this
	   * are discarded. This is used in the lazy match evaluation.
	   */

	  this.max_chain_length = 0;
	  /* To speed up deflation, hash chains are never searched beyond this
	   * length.  A higher limit improves compression ratio but degrades the
	   * speed.
	   */

	  this.max_lazy_match = 0;
	  /* Attempt to find a better match only when the current match is strictly
	   * smaller than this value. This mechanism is used only for compression
	   * levels >= 4.
	   */
	  // That's alias to max_lazy_match, don't use directly
	  //this.max_insert_length = 0;
	  /* Insert new strings in the hash table only if the match length is not
	   * greater than this length. This saves time but degrades compression.
	   * max_insert_length is used only for compression levels <= 3.
	   */

	  this.level = 0;     /* compression level (1..9) */
	  this.strategy = 0;  /* favor or force Huffman coding*/

	  this.good_match = 0;
	  /* Use a faster search when the previous match is longer than this */

	  this.nice_match = 0; /* Stop searching when current match exceeds this */

	              /* used by trees.c: */

	  /* Didn't use ct_data typedef below to suppress compiler warning */

	  // struct ct_data_s dyn_ltree[HEAP_SIZE];   /* literal and length tree */
	  // struct ct_data_s dyn_dtree[2*D_CODES+1]; /* distance tree */
	  // struct ct_data_s bl_tree[2*BL_CODES+1];  /* Huffman tree for bit lengths */

	  // Use flat array of DOUBLE size, with interleaved fata,
	  // because JS does not support effective
	  this.dyn_ltree  = new utils.Buf16(HEAP_SIZE * 2);
	  this.dyn_dtree  = new utils.Buf16((2*D_CODES+1) * 2);
	  this.bl_tree    = new utils.Buf16((2*BL_CODES+1) * 2);
	  zero(this.dyn_ltree);
	  zero(this.dyn_dtree);
	  zero(this.bl_tree);

	  this.l_desc   = null;         /* desc. for literal tree */
	  this.d_desc   = null;         /* desc. for distance tree */
	  this.bl_desc  = null;         /* desc. for bit length tree */

	  //ush bl_count[MAX_BITS+1];
	  this.bl_count = new utils.Buf16(MAX_BITS+1);
	  /* number of codes at each bit length for an optimal tree */

	  //int heap[2*L_CODES+1];      /* heap used to build the Huffman trees */
	  this.heap = new utils.Buf16(2*L_CODES+1);  /* heap used to build the Huffman trees */
	  zero(this.heap);

	  this.heap_len = 0;               /* number of elements in the heap */
	  this.heap_max = 0;               /* element of largest frequency */
	  /* The sons of heap[n] are heap[2*n] and heap[2*n+1]. heap[0] is not used.
	   * The same heap array is used to build all trees.
	   */

	  this.depth = new utils.Buf16(2*L_CODES+1); //uch depth[2*L_CODES+1];
	  zero(this.depth);
	  /* Depth of each subtree used as tie breaker for trees of equal frequency
	   */

	  this.l_buf = 0;          /* buffer index for literals or lengths */

	  this.lit_bufsize = 0;
	  /* Size of match buffer for literals/lengths.  There are 4 reasons for
	   * limiting lit_bufsize to 64K:
	   *   - frequencies can be kept in 16 bit counters
	   *   - if compression is not successful for the first block, all input
	   *     data is still in the window so we can still emit a stored block even
	   *     when input comes from standard input.  (This can also be done for
	   *     all blocks if lit_bufsize is not greater than 32K.)
	   *   - if compression is not successful for a file smaller than 64K, we can
	   *     even emit a stored file instead of a stored block (saving 5 bytes).
	   *     This is applicable only for zip (not gzip or zlib).
	   *   - creating new Huffman trees less frequently may not provide fast
	   *     adaptation to changes in the input data statistics. (Take for
	   *     example a binary file with poorly compressible code followed by
	   *     a highly compressible string table.) Smaller buffer sizes give
	   *     fast adaptation but have of course the overhead of transmitting
	   *     trees more frequently.
	   *   - I can't count above 4
	   */

	  this.last_lit = 0;      /* running index in l_buf */

	  this.d_buf = 0;
	  /* Buffer index for distances. To simplify the code, d_buf and l_buf have
	   * the same number of elements. To use different lengths, an extra flag
	   * array would be necessary.
	   */

	  this.opt_len = 0;       /* bit length of current block with optimal trees */
	  this.static_len = 0;    /* bit length of current block with static trees */
	  this.matches = 0;       /* number of string matches in current block */
	  this.insert = 0;        /* bytes at end of window left to insert */


	  this.bi_buf = 0;
	  /* Output buffer. bits are inserted starting at the bottom (least
	   * significant bits).
	   */
	  this.bi_valid = 0;
	  /* Number of valid bits in bi_buf.  All bits above the last valid bit
	   * are always zero.
	   */

	  // Used for window memory init. We safely ignore it for JS. That makes
	  // sense only for pointers and memory check tools.
	  //this.high_water = 0;
	  /* High water mark offset in window for initialized bytes -- bytes above
	   * this are set to zero in order to avoid memory check warnings when
	   * longest match routines access bytes past the input.  This is then
	   * updated to the new high water mark.
	   */
	}


	function deflateResetKeep(strm) {
	  var s;

	  if (!strm || !strm.state) {
	    return err(strm, Z_STREAM_ERROR);
	  }

	  strm.total_in = strm.total_out = 0;
	  strm.data_type = Z_UNKNOWN;

	  s = strm.state;
	  s.pending = 0;
	  s.pending_out = 0;

	  if (s.wrap < 0) {
	    s.wrap = -s.wrap;
	    /* was made negative by deflate(..., Z_FINISH); */
	  }
	  s.status = (s.wrap ? INIT_STATE : BUSY_STATE);
	  strm.adler = (s.wrap === 2) ?
	    0  // crc32(0, Z_NULL, 0)
	  :
	    1; // adler32(0, Z_NULL, 0)
	  s.last_flush = Z_NO_FLUSH;
	  trees._tr_init(s);
	  return Z_OK;
	}


	function deflateReset(strm) {
	  var ret = deflateResetKeep(strm);
	  if (ret === Z_OK) {
	    lm_init(strm.state);
	  }
	  return ret;
	}


	function deflateSetHeader(strm, head) {
	  if (!strm || !strm.state) { return Z_STREAM_ERROR; }
	  if (strm.state.wrap !== 2) { return Z_STREAM_ERROR; }
	  strm.state.gzhead = head;
	  return Z_OK;
	}


	function deflateInit2(strm, level, method, windowBits, memLevel, strategy) {
	  if (!strm) { // === Z_NULL
	    return Z_STREAM_ERROR;
	  }
	  var wrap = 1;

	  if (level === Z_DEFAULT_COMPRESSION) {
	    level = 6;
	  }

	  if (windowBits < 0) { /* suppress zlib wrapper */
	    wrap = 0;
	    windowBits = -windowBits;
	  }

	  else if (windowBits > 15) {
	    wrap = 2;           /* write gzip wrapper instead */
	    windowBits -= 16;
	  }


	  if (memLevel < 1 || memLevel > MAX_MEM_LEVEL || method !== Z_DEFLATED ||
	    windowBits < 8 || windowBits > 15 || level < 0 || level > 9 ||
	    strategy < 0 || strategy > Z_FIXED) {
	    return err(strm, Z_STREAM_ERROR);
	  }


	  if (windowBits === 8) {
	    windowBits = 9;
	  }
	  /* until 256-byte window bug fixed */

	  var s = new DeflateState();

	  strm.state = s;
	  s.strm = strm;

	  s.wrap = wrap;
	  s.gzhead = null;
	  s.w_bits = windowBits;
	  s.w_size = 1 << s.w_bits;
	  s.w_mask = s.w_size - 1;

	  s.hash_bits = memLevel + 7;
	  s.hash_size = 1 << s.hash_bits;
	  s.hash_mask = s.hash_size - 1;
	  s.hash_shift = ~~((s.hash_bits + MIN_MATCH - 1) / MIN_MATCH);

	  s.window = new utils.Buf8(s.w_size * 2);
	  s.head = new utils.Buf16(s.hash_size);
	  s.prev = new utils.Buf16(s.w_size);

	  // Don't need mem init magic for JS.
	  //s.high_water = 0;  /* nothing written to s->window yet */

	  s.lit_bufsize = 1 << (memLevel + 6); /* 16K elements by default */

	  s.pending_buf_size = s.lit_bufsize * 4;
	  s.pending_buf = new utils.Buf8(s.pending_buf_size);

	  s.d_buf = s.lit_bufsize >> 1;
	  s.l_buf = (1 + 2) * s.lit_bufsize;

	  s.level = level;
	  s.strategy = strategy;
	  s.method = method;

	  return deflateReset(strm);
	}

	function deflateInit(strm, level) {
	  return deflateInit2(strm, level, Z_DEFLATED, MAX_WBITS, DEF_MEM_LEVEL, Z_DEFAULT_STRATEGY);
	}


	function deflate(strm, flush) {
	  var old_flush, s;
	  var beg, val; // for gzip header write only

	  if (!strm || !strm.state ||
	    flush > Z_BLOCK || flush < 0) {
	    return strm ? err(strm, Z_STREAM_ERROR) : Z_STREAM_ERROR;
	  }

	  s = strm.state;

	  if (!strm.output ||
	      (!strm.input && strm.avail_in !== 0) ||
	      (s.status === FINISH_STATE && flush !== Z_FINISH)) {
	    return err(strm, (strm.avail_out === 0) ? Z_BUF_ERROR : Z_STREAM_ERROR);
	  }

	  s.strm = strm; /* just in case */
	  old_flush = s.last_flush;
	  s.last_flush = flush;

	  /* Write the header */
	  if (s.status === INIT_STATE) {

	    if (s.wrap === 2) { // GZIP header
	      strm.adler = 0;  //crc32(0L, Z_NULL, 0);
	      put_byte(s, 31);
	      put_byte(s, 139);
	      put_byte(s, 8);
	      if (!s.gzhead) { // s->gzhead == Z_NULL
	        put_byte(s, 0);
	        put_byte(s, 0);
	        put_byte(s, 0);
	        put_byte(s, 0);
	        put_byte(s, 0);
	        put_byte(s, s.level === 9 ? 2 :
	                    (s.strategy >= Z_HUFFMAN_ONLY || s.level < 2 ?
	                     4 : 0));
	        put_byte(s, OS_CODE);
	        s.status = BUSY_STATE;
	      }
	      else {
	        put_byte(s, (s.gzhead.text ? 1 : 0) +
	                    (s.gzhead.hcrc ? 2 : 0) +
	                    (!s.gzhead.extra ? 0 : 4) +
	                    (!s.gzhead.name ? 0 : 8) +
	                    (!s.gzhead.comment ? 0 : 16)
	                );
	        put_byte(s, s.gzhead.time & 0xff);
	        put_byte(s, (s.gzhead.time >> 8) & 0xff);
	        put_byte(s, (s.gzhead.time >> 16) & 0xff);
	        put_byte(s, (s.gzhead.time >> 24) & 0xff);
	        put_byte(s, s.level === 9 ? 2 :
	                    (s.strategy >= Z_HUFFMAN_ONLY || s.level < 2 ?
	                     4 : 0));
	        put_byte(s, s.gzhead.os & 0xff);
	        if (s.gzhead.extra && s.gzhead.extra.length) {
	          put_byte(s, s.gzhead.extra.length & 0xff);
	          put_byte(s, (s.gzhead.extra.length >> 8) & 0xff);
	        }
	        if (s.gzhead.hcrc) {
	          strm.adler = crc32(strm.adler, s.pending_buf, s.pending, 0);
	        }
	        s.gzindex = 0;
	        s.status = EXTRA_STATE;
	      }
	    }
	    else // DEFLATE header
	    {
	      var header = (Z_DEFLATED + ((s.w_bits - 8) << 4)) << 8;
	      var level_flags = -1;

	      if (s.strategy >= Z_HUFFMAN_ONLY || s.level < 2) {
	        level_flags = 0;
	      } else if (s.level < 6) {
	        level_flags = 1;
	      } else if (s.level === 6) {
	        level_flags = 2;
	      } else {
	        level_flags = 3;
	      }
	      header |= (level_flags << 6);
	      if (s.strstart !== 0) { header |= PRESET_DICT; }
	      header += 31 - (header % 31);

	      s.status = BUSY_STATE;
	      putShortMSB(s, header);

	      /* Save the adler32 of the preset dictionary: */
	      if (s.strstart !== 0) {
	        putShortMSB(s, strm.adler >>> 16);
	        putShortMSB(s, strm.adler & 0xffff);
	      }
	      strm.adler = 1; // adler32(0L, Z_NULL, 0);
	    }
	  }

	//#ifdef GZIP
	  if (s.status === EXTRA_STATE) {
	    if (s.gzhead.extra/* != Z_NULL*/) {
	      beg = s.pending;  /* start of bytes to update crc */

	      while (s.gzindex < (s.gzhead.extra.length & 0xffff)) {
	        if (s.pending === s.pending_buf_size) {
	          if (s.gzhead.hcrc && s.pending > beg) {
	            strm.adler = crc32(strm.adler, s.pending_buf, s.pending - beg, beg);
	          }
	          flush_pending(strm);
	          beg = s.pending;
	          if (s.pending === s.pending_buf_size) {
	            break;
	          }
	        }
	        put_byte(s, s.gzhead.extra[s.gzindex] & 0xff);
	        s.gzindex++;
	      }
	      if (s.gzhead.hcrc && s.pending > beg) {
	        strm.adler = crc32(strm.adler, s.pending_buf, s.pending - beg, beg);
	      }
	      if (s.gzindex === s.gzhead.extra.length) {
	        s.gzindex = 0;
	        s.status = NAME_STATE;
	      }
	    }
	    else {
	      s.status = NAME_STATE;
	    }
	  }
	  if (s.status === NAME_STATE) {
	    if (s.gzhead.name/* != Z_NULL*/) {
	      beg = s.pending;  /* start of bytes to update crc */
	      //int val;

	      do {
	        if (s.pending === s.pending_buf_size) {
	          if (s.gzhead.hcrc && s.pending > beg) {
	            strm.adler = crc32(strm.adler, s.pending_buf, s.pending - beg, beg);
	          }
	          flush_pending(strm);
	          beg = s.pending;
	          if (s.pending === s.pending_buf_size) {
	            val = 1;
	            break;
	          }
	        }
	        // JS specific: little magic to add zero terminator to end of string
	        if (s.gzindex < s.gzhead.name.length) {
	          val = s.gzhead.name.charCodeAt(s.gzindex++) & 0xff;
	        } else {
	          val = 0;
	        }
	        put_byte(s, val);
	      } while (val !== 0);

	      if (s.gzhead.hcrc && s.pending > beg){
	        strm.adler = crc32(strm.adler, s.pending_buf, s.pending - beg, beg);
	      }
	      if (val === 0) {
	        s.gzindex = 0;
	        s.status = COMMENT_STATE;
	      }
	    }
	    else {
	      s.status = COMMENT_STATE;
	    }
	  }
	  if (s.status === COMMENT_STATE) {
	    if (s.gzhead.comment/* != Z_NULL*/) {
	      beg = s.pending;  /* start of bytes to update crc */
	      //int val;

	      do {
	        if (s.pending === s.pending_buf_size) {
	          if (s.gzhead.hcrc && s.pending > beg) {
	            strm.adler = crc32(strm.adler, s.pending_buf, s.pending - beg, beg);
	          }
	          flush_pending(strm);
	          beg = s.pending;
	          if (s.pending === s.pending_buf_size) {
	            val = 1;
	            break;
	          }
	        }
	        // JS specific: little magic to add zero terminator to end of string
	        if (s.gzindex < s.gzhead.comment.length) {
	          val = s.gzhead.comment.charCodeAt(s.gzindex++) & 0xff;
	        } else {
	          val = 0;
	        }
	        put_byte(s, val);
	      } while (val !== 0);

	      if (s.gzhead.hcrc && s.pending > beg) {
	        strm.adler = crc32(strm.adler, s.pending_buf, s.pending - beg, beg);
	      }
	      if (val === 0) {
	        s.status = HCRC_STATE;
	      }
	    }
	    else {
	      s.status = HCRC_STATE;
	    }
	  }
	  if (s.status === HCRC_STATE) {
	    if (s.gzhead.hcrc) {
	      if (s.pending + 2 > s.pending_buf_size) {
	        flush_pending(strm);
	      }
	      if (s.pending + 2 <= s.pending_buf_size) {
	        put_byte(s, strm.adler & 0xff);
	        put_byte(s, (strm.adler >> 8) & 0xff);
	        strm.adler = 0; //crc32(0L, Z_NULL, 0);
	        s.status = BUSY_STATE;
	      }
	    }
	    else {
	      s.status = BUSY_STATE;
	    }
	  }
	//#endif

	  /* Flush as much pending output as possible */
	  if (s.pending !== 0) {
	    flush_pending(strm);
	    if (strm.avail_out === 0) {
	      /* Since avail_out is 0, deflate will be called again with
	       * more output space, but possibly with both pending and
	       * avail_in equal to zero. There won't be anything to do,
	       * but this is not an error situation so make sure we
	       * return OK instead of BUF_ERROR at next call of deflate:
	       */
	      s.last_flush = -1;
	      return Z_OK;
	    }

	    /* Make sure there is something to do and avoid duplicate consecutive
	     * flushes. For repeated and useless calls with Z_FINISH, we keep
	     * returning Z_STREAM_END instead of Z_BUF_ERROR.
	     */
	  } else if (strm.avail_in === 0 && rank(flush) <= rank(old_flush) &&
	    flush !== Z_FINISH) {
	    return err(strm, Z_BUF_ERROR);
	  }

	  /* User must not provide more input after the first FINISH: */
	  if (s.status === FINISH_STATE && strm.avail_in !== 0) {
	    return err(strm, Z_BUF_ERROR);
	  }

	  /* Start a new block or continue the current one.
	   */
	  if (strm.avail_in !== 0 || s.lookahead !== 0 ||
	    (flush !== Z_NO_FLUSH && s.status !== FINISH_STATE)) {
	    var bstate = (s.strategy === Z_HUFFMAN_ONLY) ? deflate_huff(s, flush) :
	      (s.strategy === Z_RLE ? deflate_rle(s, flush) :
	        configuration_table[s.level].func(s, flush));

	    if (bstate === BS_FINISH_STARTED || bstate === BS_FINISH_DONE) {
	      s.status = FINISH_STATE;
	    }
	    if (bstate === BS_NEED_MORE || bstate === BS_FINISH_STARTED) {
	      if (strm.avail_out === 0) {
	        s.last_flush = -1;
	        /* avoid BUF_ERROR next call, see above */
	      }
	      return Z_OK;
	      /* If flush != Z_NO_FLUSH && avail_out == 0, the next call
	       * of deflate should use the same flush parameter to make sure
	       * that the flush is complete. So we don't have to output an
	       * empty block here, this will be done at next call. This also
	       * ensures that for a very small output buffer, we emit at most
	       * one empty block.
	       */
	    }
	    if (bstate === BS_BLOCK_DONE) {
	      if (flush === Z_PARTIAL_FLUSH) {
	        trees._tr_align(s);
	      }
	      else if (flush !== Z_BLOCK) { /* FULL_FLUSH or SYNC_FLUSH */

	        trees._tr_stored_block(s, 0, 0, false);
	        /* For a full flush, this empty block will be recognized
	         * as a special marker by inflate_sync().
	         */
	        if (flush === Z_FULL_FLUSH) {
	          /*** CLEAR_HASH(s); ***/             /* forget history */
	          zero(s.head); // Fill with NIL (= 0);

	          if (s.lookahead === 0) {
	            s.strstart = 0;
	            s.block_start = 0;
	            s.insert = 0;
	          }
	        }
	      }
	      flush_pending(strm);
	      if (strm.avail_out === 0) {
	        s.last_flush = -1; /* avoid BUF_ERROR at next call, see above */
	        return Z_OK;
	      }
	    }
	  }
	  //Assert(strm->avail_out > 0, "bug2");
	  //if (strm.avail_out <= 0) { throw new Error("bug2");}

	  if (flush !== Z_FINISH) { return Z_OK; }
	  if (s.wrap <= 0) { return Z_STREAM_END; }

	  /* Write the trailer */
	  if (s.wrap === 2) {
	    put_byte(s, strm.adler & 0xff);
	    put_byte(s, (strm.adler >> 8) & 0xff);
	    put_byte(s, (strm.adler >> 16) & 0xff);
	    put_byte(s, (strm.adler >> 24) & 0xff);
	    put_byte(s, strm.total_in & 0xff);
	    put_byte(s, (strm.total_in >> 8) & 0xff);
	    put_byte(s, (strm.total_in >> 16) & 0xff);
	    put_byte(s, (strm.total_in >> 24) & 0xff);
	  }
	  else
	  {
	    putShortMSB(s, strm.adler >>> 16);
	    putShortMSB(s, strm.adler & 0xffff);
	  }

	  flush_pending(strm);
	  /* If avail_out is zero, the application will call deflate again
	   * to flush the rest.
	   */
	  if (s.wrap > 0) { s.wrap = -s.wrap; }
	  /* write the trailer only once! */
	  return s.pending !== 0 ? Z_OK : Z_STREAM_END;
	}

	function deflateEnd(strm) {
	  var status;

	  if (!strm/*== Z_NULL*/ || !strm.state/*== Z_NULL*/) {
	    return Z_STREAM_ERROR;
	  }

	  status = strm.state.status;
	  if (status !== INIT_STATE &&
	    status !== EXTRA_STATE &&
	    status !== NAME_STATE &&
	    status !== COMMENT_STATE &&
	    status !== HCRC_STATE &&
	    status !== BUSY_STATE &&
	    status !== FINISH_STATE
	  ) {
	    return err(strm, Z_STREAM_ERROR);
	  }

	  strm.state = null;

	  return status === BUSY_STATE ? err(strm, Z_DATA_ERROR) : Z_OK;
	}

	/* =========================================================================
	 * Copy the source state to the destination state
	 */
	//function deflateCopy(dest, source) {
	//
	//}

	exports.deflateInit = deflateInit;
	exports.deflateInit2 = deflateInit2;
	exports.deflateReset = deflateReset;
	exports.deflateResetKeep = deflateResetKeep;
	exports.deflateSetHeader = deflateSetHeader;
	exports.deflate = deflate;
	exports.deflateEnd = deflateEnd;
	exports.deflateInfo = 'pako deflate (from Nodeca project)';

	/* Not implemented
	exports.deflateBound = deflateBound;
	exports.deflateCopy = deflateCopy;
	exports.deflateSetDictionary = deflateSetDictionary;
	exports.deflateParams = deflateParams;
	exports.deflatePending = deflatePending;
	exports.deflatePrime = deflatePrime;
	exports.deflateTune = deflateTune;
	*/

/***/ },
/* 11 */
/***/ function(module, exports, __webpack_require__) {

	'use strict';


	var utils = __webpack_require__(8);

	/* Public constants ==========================================================*/
	/* ===========================================================================*/


	//var Z_FILTERED          = 1;
	//var Z_HUFFMAN_ONLY      = 2;
	//var Z_RLE               = 3;
	var Z_FIXED               = 4;
	//var Z_DEFAULT_STRATEGY  = 0;

	/* Possible values of the data_type field (though see inflate()) */
	var Z_BINARY              = 0;
	var Z_TEXT                = 1;
	//var Z_ASCII             = 1; // = Z_TEXT
	var Z_UNKNOWN             = 2;

	/*============================================================================*/


	function zero(buf) { var len = buf.length; while (--len >= 0) { buf[len] = 0; } }

	// From zutil.h

	var STORED_BLOCK = 0;
	var STATIC_TREES = 1;
	var DYN_TREES    = 2;
	/* The three kinds of block type */

	var MIN_MATCH    = 3;
	var MAX_MATCH    = 258;
	/* The minimum and maximum match lengths */

	// From deflate.h
	/* ===========================================================================
	 * Internal compression state.
	 */

	var LENGTH_CODES  = 29;
	/* number of length codes, not counting the special END_BLOCK code */

	var LITERALS      = 256;
	/* number of literal bytes 0..255 */

	var L_CODES       = LITERALS + 1 + LENGTH_CODES;
	/* number of Literal or Length codes, including the END_BLOCK code */

	var D_CODES       = 30;
	/* number of distance codes */

	var BL_CODES      = 19;
	/* number of codes used to transfer the bit lengths */

	var HEAP_SIZE     = 2*L_CODES + 1;
	/* maximum heap size */

	var MAX_BITS      = 15;
	/* All codes must not exceed MAX_BITS bits */

	var Buf_size      = 16;
	/* size of bit buffer in bi_buf */


	/* ===========================================================================
	 * Constants
	 */

	var MAX_BL_BITS = 7;
	/* Bit length codes must not exceed MAX_BL_BITS bits */

	var END_BLOCK   = 256;
	/* end of block literal code */

	var REP_3_6     = 16;
	/* repeat previous bit length 3-6 times (2 bits of repeat count) */

	var REPZ_3_10   = 17;
	/* repeat a zero length 3-10 times  (3 bits of repeat count) */

	var REPZ_11_138 = 18;
	/* repeat a zero length 11-138 times  (7 bits of repeat count) */

	var extra_lbits =   /* extra bits for each length code */
	  [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];

	var extra_dbits =   /* extra bits for each distance code */
	  [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];

	var extra_blbits =  /* extra bits for each bit length code */
	  [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,3,7];

	var bl_order =
	  [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];
	/* The lengths of the bit length codes are sent in order of decreasing
	 * probability, to avoid transmitting the lengths for unused bit length codes.
	 */

	/* ===========================================================================
	 * Local data. These are initialized only once.
	 */

	// We pre-fill arrays with 0 to avoid uninitialized gaps

	var DIST_CODE_LEN = 512; /* see definition of array dist_code below */

	// !!!! Use flat array insdead of structure, Freq = i*2, Len = i*2+1
	var static_ltree  = new Array((L_CODES+2) * 2);
	zero(static_ltree);
	/* The static literal tree. Since the bit lengths are imposed, there is no
	 * need for the L_CODES extra codes used during heap construction. However
	 * The codes 286 and 287 are needed to build a canonical tree (see _tr_init
	 * below).
	 */

	var static_dtree  = new Array(D_CODES * 2);
	zero(static_dtree);
	/* The static distance tree. (Actually a trivial tree since all codes use
	 * 5 bits.)
	 */

	var _dist_code    = new Array(DIST_CODE_LEN);
	zero(_dist_code);
	/* Distance codes. The first 256 values correspond to the distances
	 * 3 .. 258, the last 256 values correspond to the top 8 bits of
	 * the 15 bit distances.
	 */

	var _length_code  = new Array(MAX_MATCH-MIN_MATCH+1);
	zero(_length_code);
	/* length code for each normalized match length (0 == MIN_MATCH) */

	var base_length   = new Array(LENGTH_CODES);
	zero(base_length);
	/* First normalized length for each code (0 = MIN_MATCH) */

	var base_dist     = new Array(D_CODES);
	zero(base_dist);
	/* First normalized distance for each code (0 = distance of 1) */


	var StaticTreeDesc = function (static_tree, extra_bits, extra_base, elems, max_length) {

	  this.static_tree  = static_tree;  /* static tree or NULL */
	  this.extra_bits   = extra_bits;   /* extra bits for each code or NULL */
	  this.extra_base   = extra_base;   /* base index for extra_bits */
	  this.elems        = elems;        /* max number of elements in the tree */
	  this.max_length   = max_length;   /* max bit length for the codes */

	  // show if `static_tree` has data or dummy - needed for monomorphic objects
	  this.has_stree    = static_tree && static_tree.length;
	};


	var static_l_desc;
	var static_d_desc;
	var static_bl_desc;


	var TreeDesc = function(dyn_tree, stat_desc) {
	  this.dyn_tree = dyn_tree;     /* the dynamic tree */
	  this.max_code = 0;            /* largest code with non zero frequency */
	  this.stat_desc = stat_desc;   /* the corresponding static tree */
	};



	function d_code(dist) {
	  return dist < 256 ? _dist_code[dist] : _dist_code[256 + (dist >>> 7)];
	}


	/* ===========================================================================
	 * Output a short LSB first on the stream.
	 * IN assertion: there is enough room in pendingBuf.
	 */
	function put_short (s, w) {
	//    put_byte(s, (uch)((w) & 0xff));
	//    put_byte(s, (uch)((ush)(w) >> 8));
	  s.pending_buf[s.pending++] = (w) & 0xff;
	  s.pending_buf[s.pending++] = (w >>> 8) & 0xff;
	}


	/* ===========================================================================
	 * Send a value on a given number of bits.
	 * IN assertion: length <= 16 and value fits in length bits.
	 */
	function send_bits(s, value, length) {
	  if (s.bi_valid > (Buf_size - length)) {
	    s.bi_buf |= (value << s.bi_valid) & 0xffff;
	    put_short(s, s.bi_buf);
	    s.bi_buf = value >> (Buf_size - s.bi_valid);
	    s.bi_valid += length - Buf_size;
	  } else {
	    s.bi_buf |= (value << s.bi_valid) & 0xffff;
	    s.bi_valid += length;
	  }
	}


	function send_code(s, c, tree) {
	  send_bits(s, tree[c*2]/*.Code*/, tree[c*2 + 1]/*.Len*/);
	}


	/* ===========================================================================
	 * Reverse the first len bits of a code, using straightforward code (a faster
	 * method would use a table)
	 * IN assertion: 1 <= len <= 15
	 */
	function bi_reverse(code, len) {
	  var res = 0;
	  do {
	    res |= code & 1;
	    code >>>= 1;
	    res <<= 1;
	  } while (--len > 0);
	  return res >>> 1;
	}


	/* ===========================================================================
	 * Flush the bit buffer, keeping at most 7 bits in it.
	 */
	function bi_flush(s) {
	  if (s.bi_valid === 16) {
	    put_short(s, s.bi_buf);
	    s.bi_buf = 0;
	    s.bi_valid = 0;

	  } else if (s.bi_valid >= 8) {
	    s.pending_buf[s.pending++] = s.bi_buf & 0xff;
	    s.bi_buf >>= 8;
	    s.bi_valid -= 8;
	  }
	}


	/* ===========================================================================
	 * Compute the optimal bit lengths for a tree and update the total bit length
	 * for the current block.
	 * IN assertion: the fields freq and dad are set, heap[heap_max] and
	 *    above are the tree nodes sorted by increasing frequency.
	 * OUT assertions: the field len is set to the optimal bit length, the
	 *     array bl_count contains the frequencies for each bit length.
	 *     The length opt_len is updated; static_len is also updated if stree is
	 *     not null.
	 */
	function gen_bitlen(s, desc)
	//    deflate_state *s;
	//    tree_desc *desc;    /* the tree descriptor */
	{
	  var tree            = desc.dyn_tree;
	  var max_code        = desc.max_code;
	  var stree           = desc.stat_desc.static_tree;
	  var has_stree       = desc.stat_desc.has_stree;
	  var extra           = desc.stat_desc.extra_bits;
	  var base            = desc.stat_desc.extra_base;
	  var max_length      = desc.stat_desc.max_length;
	  var h;              /* heap index */
	  var n, m;           /* iterate over the tree elements */
	  var bits;           /* bit length */
	  var xbits;          /* extra bits */
	  var f;              /* frequency */
	  var overflow = 0;   /* number of elements with bit length too large */

	  for (bits = 0; bits <= MAX_BITS; bits++) {
	    s.bl_count[bits] = 0;
	  }

	  /* In a first pass, compute the optimal bit lengths (which may
	   * overflow in the case of the bit length tree).
	   */
	  tree[s.heap[s.heap_max]*2 + 1]/*.Len*/ = 0; /* root of the heap */

	  for (h = s.heap_max+1; h < HEAP_SIZE; h++) {
	    n = s.heap[h];
	    bits = tree[tree[n*2 +1]/*.Dad*/ * 2 + 1]/*.Len*/ + 1;
	    if (bits > max_length) {
	      bits = max_length;
	      overflow++;
	    }
	    tree[n*2 + 1]/*.Len*/ = bits;
	    /* We overwrite tree[n].Dad which is no longer needed */

	    if (n > max_code) { continue; } /* not a leaf node */

	    s.bl_count[bits]++;
	    xbits = 0;
	    if (n >= base) {
	      xbits = extra[n-base];
	    }
	    f = tree[n * 2]/*.Freq*/;
	    s.opt_len += f * (bits + xbits);
	    if (has_stree) {
	      s.static_len += f * (stree[n*2 + 1]/*.Len*/ + xbits);
	    }
	  }
	  if (overflow === 0) { return; }

	  // Trace((stderr,"\nbit length overflow\n"));
	  /* This happens for example on obj2 and pic of the Calgary corpus */

	  /* Find the first bit length which could increase: */
	  do {
	    bits = max_length-1;
	    while (s.bl_count[bits] === 0) { bits--; }
	    s.bl_count[bits]--;      /* move one leaf down the tree */
	    s.bl_count[bits+1] += 2; /* move one overflow item as its brother */
	    s.bl_count[max_length]--;
	    /* The brother of the overflow item also moves one step up,
	     * but this does not affect bl_count[max_length]
	     */
	    overflow -= 2;
	  } while (overflow > 0);

	  /* Now recompute all bit lengths, scanning in increasing frequency.
	   * h is still equal to HEAP_SIZE. (It is simpler to reconstruct all
	   * lengths instead of fixing only the wrong ones. This idea is taken
	   * from 'ar' written by Haruhiko Okumura.)
	   */
	  for (bits = max_length; bits !== 0; bits--) {
	    n = s.bl_count[bits];
	    while (n !== 0) {
	      m = s.heap[--h];
	      if (m > max_code) { continue; }
	      if (tree[m*2 + 1]/*.Len*/ !== bits) {
	        // Trace((stderr,"code %d bits %d->%d\n", m, tree[m].Len, bits));
	        s.opt_len += (bits - tree[m*2 + 1]/*.Len*/)*tree[m*2]/*.Freq*/;
	        tree[m*2 + 1]/*.Len*/ = bits;
	      }
	      n--;
	    }
	  }
	}


	/* ===========================================================================
	 * Generate the codes for a given tree and bit counts (which need not be
	 * optimal).
	 * IN assertion: the array bl_count contains the bit length statistics for
	 * the given tree and the field len is set for all tree elements.
	 * OUT assertion: the field code is set for all tree elements of non
	 *     zero code length.
	 */
	function gen_codes(tree, max_code, bl_count)
	//    ct_data *tree;             /* the tree to decorate */
	//    int max_code;              /* largest code with non zero frequency */
	//    ushf *bl_count;            /* number of codes at each bit length */
	{
	  var next_code = new Array(MAX_BITS+1); /* next code value for each bit length */
	  var code = 0;              /* running code value */
	  var bits;                  /* bit index */
	  var n;                     /* code index */

	  /* The distribution counts are first used to generate the code values
	   * without bit reversal.
	   */
	  for (bits = 1; bits <= MAX_BITS; bits++) {
	    next_code[bits] = code = (code + bl_count[bits-1]) << 1;
	  }
	  /* Check that the bit counts in bl_count are consistent. The last code
	   * must be all ones.
	   */
	  //Assert (code + bl_count[MAX_BITS]-1 == (1<<MAX_BITS)-1,
	  //        "inconsistent bit counts");
	  //Tracev((stderr,"\ngen_codes: max_code %d ", max_code));

	  for (n = 0;  n <= max_code; n++) {
	    var len = tree[n*2 + 1]/*.Len*/;
	    if (len === 0) { continue; }
	    /* Now reverse the bits */
	    tree[n*2]/*.Code*/ = bi_reverse(next_code[len]++, len);

	    //Tracecv(tree != static_ltree, (stderr,"\nn %3d %c l %2d c %4x (%x) ",
	    //     n, (isgraph(n) ? n : ' '), len, tree[n].Code, next_code[len]-1));
	  }
	}


	/* ===========================================================================
	 * Initialize the various 'constant' tables.
	 */
	function tr_static_init() {
	  var n;        /* iterates over tree elements */
	  var bits;     /* bit counter */
	  var length;   /* length value */
	  var code;     /* code value */
	  var dist;     /* distance index */
	  var bl_count = new Array(MAX_BITS+1);
	  /* number of codes at each bit length for an optimal tree */

	  // do check in _tr_init()
	  //if (static_init_done) return;

	  /* For some embedded targets, global variables are not initialized: */
	/*#ifdef NO_INIT_GLOBAL_POINTERS
	  static_l_desc.static_tree = static_ltree;
	  static_l_desc.extra_bits = extra_lbits;
	  static_d_desc.static_tree = static_dtree;
	  static_d_desc.extra_bits = extra_dbits;
	  static_bl_desc.extra_bits = extra_blbits;
	#endif*/

	  /* Initialize the mapping length (0..255) -> length code (0..28) */
	  length = 0;
	  for (code = 0; code < LENGTH_CODES-1; code++) {
	    base_length[code] = length;
	    for (n = 0; n < (1<<extra_lbits[code]); n++) {
	      _length_code[length++] = code;
	    }
	  }
	  //Assert (length == 256, "tr_static_init: length != 256");
	  /* Note that the length 255 (match length 258) can be represented
	   * in two different ways: code 284 + 5 bits or code 285, so we
	   * overwrite length_code[255] to use the best encoding:
	   */
	  _length_code[length-1] = code;

	  /* Initialize the mapping dist (0..32K) -> dist code (0..29) */
	  dist = 0;
	  for (code = 0 ; code < 16; code++) {
	    base_dist[code] = dist;
	    for (n = 0; n < (1<<extra_dbits[code]); n++) {
	      _dist_code[dist++] = code;
	    }
	  }
	  //Assert (dist == 256, "tr_static_init: dist != 256");
	  dist >>= 7; /* from now on, all distances are divided by 128 */
	  for ( ; code < D_CODES; code++) {
	    base_dist[code] = dist << 7;
	    for (n = 0; n < (1<<(extra_dbits[code]-7)); n++) {
	      _dist_code[256 + dist++] = code;
	    }
	  }
	  //Assert (dist == 256, "tr_static_init: 256+dist != 512");

	  /* Construct the codes of the static literal tree */
	  for (bits = 0; bits <= MAX_BITS; bits++) {
	    bl_count[bits] = 0;
	  }

	  n = 0;
	  while (n <= 143) {
	    static_ltree[n*2 + 1]/*.Len*/ = 8;
	    n++;
	    bl_count[8]++;
	  }
	  while (n <= 255) {
	    static_ltree[n*2 + 1]/*.Len*/ = 9;
	    n++;
	    bl_count[9]++;
	  }
	  while (n <= 279) {
	    static_ltree[n*2 + 1]/*.Len*/ = 7;
	    n++;
	    bl_count[7]++;
	  }
	  while (n <= 287) {
	    static_ltree[n*2 + 1]/*.Len*/ = 8;
	    n++;
	    bl_count[8]++;
	  }
	  /* Codes 286 and 287 do not exist, but we must include them in the
	   * tree construction to get a canonical Huffman tree (longest code
	   * all ones)
	   */
	  gen_codes(static_ltree, L_CODES+1, bl_count);

	  /* The static distance tree is trivial: */
	  for (n = 0; n < D_CODES; n++) {
	    static_dtree[n*2 + 1]/*.Len*/ = 5;
	    static_dtree[n*2]/*.Code*/ = bi_reverse(n, 5);
	  }

	  // Now data ready and we can init static trees
	  static_l_desc = new StaticTreeDesc(static_ltree, extra_lbits, LITERALS+1, L_CODES, MAX_BITS);
	  static_d_desc = new StaticTreeDesc(static_dtree, extra_dbits, 0,          D_CODES, MAX_BITS);
	  static_bl_desc =new StaticTreeDesc(new Array(0), extra_blbits, 0,         BL_CODES, MAX_BL_BITS);

	  //static_init_done = true;
	}


	/* ===========================================================================
	 * Initialize a new block.
	 */
	function init_block(s) {
	  var n; /* iterates over tree elements */

	  /* Initialize the trees. */
	  for (n = 0; n < L_CODES;  n++) { s.dyn_ltree[n*2]/*.Freq*/ = 0; }
	  for (n = 0; n < D_CODES;  n++) { s.dyn_dtree[n*2]/*.Freq*/ = 0; }
	  for (n = 0; n < BL_CODES; n++) { s.bl_tree[n*2]/*.Freq*/ = 0; }

	  s.dyn_ltree[END_BLOCK*2]/*.Freq*/ = 1;
	  s.opt_len = s.static_len = 0;
	  s.last_lit = s.matches = 0;
	}


	/* ===========================================================================
	 * Flush the bit buffer and align the output on a byte boundary
	 */
	function bi_windup(s)
	{
	  if (s.bi_valid > 8) {
	    put_short(s, s.bi_buf);
	  } else if (s.bi_valid > 0) {
	    //put_byte(s, (Byte)s->bi_buf);
	    s.pending_buf[s.pending++] = s.bi_buf;
	  }
	  s.bi_buf = 0;
	  s.bi_valid = 0;
	}

	/* ===========================================================================
	 * Copy a stored block, storing first the length and its
	 * one's complement if requested.
	 */
	function copy_block(s, buf, len, header)
	//DeflateState *s;
	//charf    *buf;    /* the input data */
	//unsigned len;     /* its length */
	//int      header;  /* true if block header must be written */
	{
	  bi_windup(s);        /* align on byte boundary */

	  if (header) {
	    put_short(s, len);
	    put_short(s, ~len);
	  }
	//  while (len--) {
	//    put_byte(s, *buf++);
	//  }
	  utils.arraySet(s.pending_buf, s.window, buf, len, s.pending);
	  s.pending += len;
	}

	/* ===========================================================================
	 * Compares to subtrees, using the tree depth as tie breaker when
	 * the subtrees have equal frequency. This minimizes the worst case length.
	 */
	function smaller(tree, n, m, depth) {
	  var _n2 = n*2;
	  var _m2 = m*2;
	  return (tree[_n2]/*.Freq*/ < tree[_m2]/*.Freq*/ ||
	         (tree[_n2]/*.Freq*/ === tree[_m2]/*.Freq*/ && depth[n] <= depth[m]));
	}

	/* ===========================================================================
	 * Restore the heap property by moving down the tree starting at node k,
	 * exchanging a node with the smallest of its two sons if necessary, stopping
	 * when the heap property is re-established (each father smaller than its
	 * two sons).
	 */
	function pqdownheap(s, tree, k)
	//    deflate_state *s;
	//    ct_data *tree;  /* the tree to restore */
	//    int k;               /* node to move down */
	{
	  var v = s.heap[k];
	  var j = k << 1;  /* left son of k */
	  while (j <= s.heap_len) {
	    /* Set j to the smallest of the two sons: */
	    if (j < s.heap_len &&
	      smaller(tree, s.heap[j+1], s.heap[j], s.depth)) {
	      j++;
	    }
	    /* Exit if v is smaller than both sons */
	    if (smaller(tree, v, s.heap[j], s.depth)) { break; }

	    /* Exchange v with the smallest son */
	    s.heap[k] = s.heap[j];
	    k = j;

	    /* And continue down the tree, setting j to the left son of k */
	    j <<= 1;
	  }
	  s.heap[k] = v;
	}


	// inlined manually
	// var SMALLEST = 1;

	/* ===========================================================================
	 * Send the block data compressed using the given Huffman trees
	 */
	function compress_block(s, ltree, dtree)
	//    deflate_state *s;
	//    const ct_data *ltree; /* literal tree */
	//    const ct_data *dtree; /* distance tree */
	{
	  var dist;           /* distance of matched string */
	  var lc;             /* match length or unmatched char (if dist == 0) */
	  var lx = 0;         /* running index in l_buf */
	  var code;           /* the code to send */
	  var extra;          /* number of extra bits to send */

	  if (s.last_lit !== 0) {
	    do {
	      dist = (s.pending_buf[s.d_buf + lx*2] << 8) | (s.pending_buf[s.d_buf + lx*2 + 1]);
	      lc = s.pending_buf[s.l_buf + lx];
	      lx++;

	      if (dist === 0) {
	        send_code(s, lc, ltree); /* send a literal byte */
	        //Tracecv(isgraph(lc), (stderr," '%c' ", lc));
	      } else {
	        /* Here, lc is the match length - MIN_MATCH */
	        code = _length_code[lc];
	        send_code(s, code+LITERALS+1, ltree); /* send the length code */
	        extra = extra_lbits[code];
	        if (extra !== 0) {
	          lc -= base_length[code];
	          send_bits(s, lc, extra);       /* send the extra length bits */
	        }
	        dist--; /* dist is now the match distance - 1 */
	        code = d_code(dist);
	        //Assert (code < D_CODES, "bad d_code");

	        send_code(s, code, dtree);       /* send the distance code */
	        extra = extra_dbits[code];
	        if (extra !== 0) {
	          dist -= base_dist[code];
	          send_bits(s, dist, extra);   /* send the extra distance bits */
	        }
	      } /* literal or match pair ? */

	      /* Check that the overlay between pending_buf and d_buf+l_buf is ok: */
	      //Assert((uInt)(s->pending) < s->lit_bufsize + 2*lx,
	      //       "pendingBuf overflow");

	    } while (lx < s.last_lit);
	  }

	  send_code(s, END_BLOCK, ltree);
	}


	/* ===========================================================================
	 * Construct one Huffman tree and assigns the code bit strings and lengths.
	 * Update the total bit length for the current block.
	 * IN assertion: the field freq is set for all tree elements.
	 * OUT assertions: the fields len and code are set to the optimal bit length
	 *     and corresponding code. The length opt_len is updated; static_len is
	 *     also updated if stree is not null. The field max_code is set.
	 */
	function build_tree(s, desc)
	//    deflate_state *s;
	//    tree_desc *desc; /* the tree descriptor */
	{
	  var tree     = desc.dyn_tree;
	  var stree    = desc.stat_desc.static_tree;
	  var has_stree = desc.stat_desc.has_stree;
	  var elems    = desc.stat_desc.elems;
	  var n, m;          /* iterate over heap elements */
	  var max_code = -1; /* largest code with non zero frequency */
	  var node;          /* new node being created */

	  /* Construct the initial heap, with least frequent element in
	   * heap[SMALLEST]. The sons of heap[n] are heap[2*n] and heap[2*n+1].
	   * heap[0] is not used.
	   */
	  s.heap_len = 0;
	  s.heap_max = HEAP_SIZE;

	  for (n = 0; n < elems; n++) {
	    if (tree[n * 2]/*.Freq*/ !== 0) {
	      s.heap[++s.heap_len] = max_code = n;
	      s.depth[n] = 0;

	    } else {
	      tree[n*2 + 1]/*.Len*/ = 0;
	    }
	  }

	  /* The pkzip format requires that at least one distance code exists,
	   * and that at least one bit should be sent even if there is only one
	   * possible code. So to avoid special checks later on we force at least
	   * two codes of non zero frequency.
	   */
	  while (s.heap_len < 2) {
	    node = s.heap[++s.heap_len] = (max_code < 2 ? ++max_code : 0);
	    tree[node * 2]/*.Freq*/ = 1;
	    s.depth[node] = 0;
	    s.opt_len--;

	    if (has_stree) {
	      s.static_len -= stree[node*2 + 1]/*.Len*/;
	    }
	    /* node is 0 or 1 so it does not have extra bits */
	  }
	  desc.max_code = max_code;

	  /* The elements heap[heap_len/2+1 .. heap_len] are leaves of the tree,
	   * establish sub-heaps of increasing lengths:
	   */
	  for (n = (s.heap_len >> 1/*int /2*/); n >= 1; n--) { pqdownheap(s, tree, n); }

	  /* Construct the Huffman tree by repeatedly combining the least two
	   * frequent nodes.
	   */
	  node = elems;              /* next internal node of the tree */
	  do {
	    //pqremove(s, tree, n);  /* n = node of least frequency */
	    /*** pqremove ***/
	    n = s.heap[1/*SMALLEST*/];
	    s.heap[1/*SMALLEST*/] = s.heap[s.heap_len--];
	    pqdownheap(s, tree, 1/*SMALLEST*/);
	    /***/

	    m = s.heap[1/*SMALLEST*/]; /* m = node of next least frequency */

	    s.heap[--s.heap_max] = n; /* keep the nodes sorted by frequency */
	    s.heap[--s.heap_max] = m;

	    /* Create a new node father of n and m */
	    tree[node * 2]/*.Freq*/ = tree[n * 2]/*.Freq*/ + tree[m * 2]/*.Freq*/;
	    s.depth[node] = (s.depth[n] >= s.depth[m] ? s.depth[n] : s.depth[m]) + 1;
	    tree[n*2 + 1]/*.Dad*/ = tree[m*2 + 1]/*.Dad*/ = node;

	    /* and insert the new node in the heap */
	    s.heap[1/*SMALLEST*/] = node++;
	    pqdownheap(s, tree, 1/*SMALLEST*/);

	  } while (s.heap_len >= 2);

	  s.heap[--s.heap_max] = s.heap[1/*SMALLEST*/];

	  /* At this point, the fields freq and dad are set. We can now
	   * generate the bit lengths.
	   */
	  gen_bitlen(s, desc);

	  /* The field len is now set, we can generate the bit codes */
	  gen_codes(tree, max_code, s.bl_count);
	}


	/* ===========================================================================
	 * Scan a literal or distance tree to determine the frequencies of the codes
	 * in the bit length tree.
	 */
	function scan_tree(s, tree, max_code)
	//    deflate_state *s;
	//    ct_data *tree;   /* the tree to be scanned */
	//    int max_code;    /* and its largest code of non zero frequency */
	{
	  var n;                     /* iterates over all tree elements */
	  var prevlen = -1;          /* last emitted length */
	  var curlen;                /* length of current code */

	  var nextlen = tree[0*2 + 1]/*.Len*/; /* length of next code */

	  var count = 0;             /* repeat count of the current code */
	  var max_count = 7;         /* max repeat count */
	  var min_count = 4;         /* min repeat count */

	  if (nextlen === 0) {
	    max_count = 138;
	    min_count = 3;
	  }
	  tree[(max_code+1)*2 + 1]/*.Len*/ = 0xffff; /* guard */

	  for (n = 0; n <= max_code; n++) {
	    curlen = nextlen;
	    nextlen = tree[(n+1)*2 + 1]/*.Len*/;

	    if (++count < max_count && curlen === nextlen) {
	      continue;

	    } else if (count < min_count) {
	      s.bl_tree[curlen * 2]/*.Freq*/ += count;

	    } else if (curlen !== 0) {

	      if (curlen !== prevlen) { s.bl_tree[curlen * 2]/*.Freq*/++; }
	      s.bl_tree[REP_3_6*2]/*.Freq*/++;

	    } else if (count <= 10) {
	      s.bl_tree[REPZ_3_10*2]/*.Freq*/++;

	    } else {
	      s.bl_tree[REPZ_11_138*2]/*.Freq*/++;
	    }

	    count = 0;
	    prevlen = curlen;

	    if (nextlen === 0) {
	      max_count = 138;
	      min_count = 3;

	    } else if (curlen === nextlen) {
	      max_count = 6;
	      min_count = 3;

	    } else {
	      max_count = 7;
	      min_count = 4;
	    }
	  }
	}


	/* ===========================================================================
	 * Send a literal or distance tree in compressed form, using the codes in
	 * bl_tree.
	 */
	function send_tree(s, tree, max_code)
	//    deflate_state *s;
	//    ct_data *tree; /* the tree to be scanned */
	//    int max_code;       /* and its largest code of non zero frequency */
	{
	  var n;                     /* iterates over all tree elements */
	  var prevlen = -1;          /* last emitted length */
	  var curlen;                /* length of current code */

	  var nextlen = tree[0*2 + 1]/*.Len*/; /* length of next code */

	  var count = 0;             /* repeat count of the current code */
	  var max_count = 7;         /* max repeat count */
	  var min_count = 4;         /* min repeat count */

	  /* tree[max_code+1].Len = -1; */  /* guard already set */
	  if (nextlen === 0) {
	    max_count = 138;
	    min_count = 3;
	  }

	  for (n = 0; n <= max_code; n++) {
	    curlen = nextlen;
	    nextlen = tree[(n+1)*2 + 1]/*.Len*/;

	    if (++count < max_count && curlen === nextlen) {
	      continue;

	    } else if (count < min_count) {
	      do { send_code(s, curlen, s.bl_tree); } while (--count !== 0);

	    } else if (curlen !== 0) {
	      if (curlen !== prevlen) {
	        send_code(s, curlen, s.bl_tree);
	        count--;
	      }
	      //Assert(count >= 3 && count <= 6, " 3_6?");
	      send_code(s, REP_3_6, s.bl_tree);
	      send_bits(s, count-3, 2);

	    } else if (count <= 10) {
	      send_code(s, REPZ_3_10, s.bl_tree);
	      send_bits(s, count-3, 3);

	    } else {
	      send_code(s, REPZ_11_138, s.bl_tree);
	      send_bits(s, count-11, 7);
	    }

	    count = 0;
	    prevlen = curlen;
	    if (nextlen === 0) {
	      max_count = 138;
	      min_count = 3;

	    } else if (curlen === nextlen) {
	      max_count = 6;
	      min_count = 3;

	    } else {
	      max_count = 7;
	      min_count = 4;
	    }
	  }
	}


	/* ===========================================================================
	 * Construct the Huffman tree for the bit lengths and return the index in
	 * bl_order of the last bit length code to send.
	 */
	function build_bl_tree(s) {
	  var max_blindex;  /* index of last bit length code of non zero freq */

	  /* Determine the bit length frequencies for literal and distance trees */
	  scan_tree(s, s.dyn_ltree, s.l_desc.max_code);
	  scan_tree(s, s.dyn_dtree, s.d_desc.max_code);

	  /* Build the bit length tree: */
	  build_tree(s, s.bl_desc);
	  /* opt_len now includes the length of the tree representations, except
	   * the lengths of the bit lengths codes and the 5+5+4 bits for the counts.
	   */

	  /* Determine the number of bit length codes to send. The pkzip format
	   * requires that at least 4 bit length codes be sent. (appnote.txt says
	   * 3 but the actual value used is 4.)
	   */
	  for (max_blindex = BL_CODES-1; max_blindex >= 3; max_blindex--) {
	    if (s.bl_tree[bl_order[max_blindex]*2 + 1]/*.Len*/ !== 0) {
	      break;
	    }
	  }
	  /* Update opt_len to include the bit length tree and counts */
	  s.opt_len += 3*(max_blindex+1) + 5+5+4;
	  //Tracev((stderr, "\ndyn trees: dyn %ld, stat %ld",
	  //        s->opt_len, s->static_len));

	  return max_blindex;
	}


	/* ===========================================================================
	 * Send the header for a block using dynamic Huffman trees: the counts, the
	 * lengths of the bit length codes, the literal tree and the distance tree.
	 * IN assertion: lcodes >= 257, dcodes >= 1, blcodes >= 4.
	 */
	function send_all_trees(s, lcodes, dcodes, blcodes)
	//    deflate_state *s;
	//    int lcodes, dcodes, blcodes; /* number of codes for each tree */
	{
	  var rank;                    /* index in bl_order */

	  //Assert (lcodes >= 257 && dcodes >= 1 && blcodes >= 4, "not enough codes");
	  //Assert (lcodes <= L_CODES && dcodes <= D_CODES && blcodes <= BL_CODES,
	  //        "too many codes");
	  //Tracev((stderr, "\nbl counts: "));
	  send_bits(s, lcodes-257, 5); /* not +255 as stated in appnote.txt */
	  send_bits(s, dcodes-1,   5);
	  send_bits(s, blcodes-4,  4); /* not -3 as stated in appnote.txt */
	  for (rank = 0; rank < blcodes; rank++) {
	    //Tracev((stderr, "\nbl code %2d ", bl_order[rank]));
	    send_bits(s, s.bl_tree[bl_order[rank]*2 + 1]/*.Len*/, 3);
	  }
	  //Tracev((stderr, "\nbl tree: sent %ld", s->bits_sent));

	  send_tree(s, s.dyn_ltree, lcodes-1); /* literal tree */
	  //Tracev((stderr, "\nlit tree: sent %ld", s->bits_sent));

	  send_tree(s, s.dyn_dtree, dcodes-1); /* distance tree */
	  //Tracev((stderr, "\ndist tree: sent %ld", s->bits_sent));
	}


	/* ===========================================================================
	 * Check if the data type is TEXT or BINARY, using the following algorithm:
	 * - TEXT if the two conditions below are satisfied:
	 *    a) There are no non-portable control characters belonging to the
	 *       "black list" (0..6, 14..25, 28..31).
	 *    b) There is at least one printable character belonging to the
	 *       "white list" (9 {TAB}, 10 {LF}, 13 {CR}, 32..255).
	 * - BINARY otherwise.
	 * - The following partially-portable control characters form a
	 *   "gray list" that is ignored in this detection algorithm:
	 *   (7 {BEL}, 8 {BS}, 11 {VT}, 12 {FF}, 26 {SUB}, 27 {ESC}).
	 * IN assertion: the fields Freq of dyn_ltree are set.
	 */
	function detect_data_type(s) {
	  /* black_mask is the bit mask of black-listed bytes
	   * set bits 0..6, 14..25, and 28..31
	   * 0xf3ffc07f = binary 11110011111111111100000001111111
	   */
	  var black_mask = 0xf3ffc07f;
	  var n;

	  /* Check for non-textual ("black-listed") bytes. */
	  for (n = 0; n <= 31; n++, black_mask >>>= 1) {
	    if ((black_mask & 1) && (s.dyn_ltree[n*2]/*.Freq*/ !== 0)) {
	      return Z_BINARY;
	    }
	  }

	  /* Check for textual ("white-listed") bytes. */
	  if (s.dyn_ltree[9 * 2]/*.Freq*/ !== 0 || s.dyn_ltree[10 * 2]/*.Freq*/ !== 0 ||
	      s.dyn_ltree[13 * 2]/*.Freq*/ !== 0) {
	    return Z_TEXT;
	  }
	  for (n = 32; n < LITERALS; n++) {
	    if (s.dyn_ltree[n * 2]/*.Freq*/ !== 0) {
	      return Z_TEXT;
	    }
	  }

	  /* There are no "black-listed" or "white-listed" bytes:
	   * this stream either is empty or has tolerated ("gray-listed") bytes only.
	   */
	  return Z_BINARY;
	}


	var static_init_done = false;

	/* ===========================================================================
	 * Initialize the tree data structures for a new zlib stream.
	 */
	function _tr_init(s)
	{

	  if (!static_init_done) {
	    tr_static_init();
	    static_init_done = true;
	  }

	  s.l_desc  = new TreeDesc(s.dyn_ltree, static_l_desc);
	  s.d_desc  = new TreeDesc(s.dyn_dtree, static_d_desc);
	  s.bl_desc = new TreeDesc(s.bl_tree, static_bl_desc);

	  s.bi_buf = 0;
	  s.bi_valid = 0;

	  /* Initialize the first block of the first file: */
	  init_block(s);
	}


	/* ===========================================================================
	 * Send a stored block
	 */
	function _tr_stored_block(s, buf, stored_len, last)
	//DeflateState *s;
	//charf *buf;       /* input block */
	//ulg stored_len;   /* length of input block */
	//int last;         /* one if this is the last block for a file */
	{
	  send_bits(s, (STORED_BLOCK<<1)+(last ? 1 : 0), 3);    /* send block type */
	  copy_block(s, buf, stored_len, true); /* with header */
	}


	/* ===========================================================================
	 * Send one empty static block to give enough lookahead for inflate.
	 * This takes 10 bits, of which 7 may remain in the bit buffer.
	 */
	function _tr_align(s) {
	  send_bits(s, STATIC_TREES<<1, 3);
	  send_code(s, END_BLOCK, static_ltree);
	  bi_flush(s);
	}


	/* ===========================================================================
	 * Determine the best encoding for the current block: dynamic trees, static
	 * trees or store, and output the encoded block to the zip file.
	 */
	function _tr_flush_block(s, buf, stored_len, last)
	//DeflateState *s;
	//charf *buf;       /* input block, or NULL if too old */
	//ulg stored_len;   /* length of input block */
	//int last;         /* one if this is the last block for a file */
	{
	  var opt_lenb, static_lenb;  /* opt_len and static_len in bytes */
	  var max_blindex = 0;        /* index of last bit length code of non zero freq */

	  /* Build the Huffman trees unless a stored block is forced */
	  if (s.level > 0) {

	    /* Check if the file is binary or text */
	    if (s.strm.data_type === Z_UNKNOWN) {
	      s.strm.data_type = detect_data_type(s);
	    }

	    /* Construct the literal and distance trees */
	    build_tree(s, s.l_desc);
	    // Tracev((stderr, "\nlit data: dyn %ld, stat %ld", s->opt_len,
	    //        s->static_len));

	    build_tree(s, s.d_desc);
	    // Tracev((stderr, "\ndist data: dyn %ld, stat %ld", s->opt_len,
	    //        s->static_len));
	    /* At this point, opt_len and static_len are the total bit lengths of
	     * the compressed block data, excluding the tree representations.
	     */

	    /* Build the bit length tree for the above two trees, and get the index
	     * in bl_order of the last bit length code to send.
	     */
	    max_blindex = build_bl_tree(s);

	    /* Determine the best encoding. Compute the block lengths in bytes. */
	    opt_lenb = (s.opt_len+3+7) >>> 3;
	    static_lenb = (s.static_len+3+7) >>> 3;

	    // Tracev((stderr, "\nopt %lu(%lu) stat %lu(%lu) stored %lu lit %u ",
	    //        opt_lenb, s->opt_len, static_lenb, s->static_len, stored_len,
	    //        s->last_lit));

	    if (static_lenb <= opt_lenb) { opt_lenb = static_lenb; }

	  } else {
	    // Assert(buf != (char*)0, "lost buf");
	    opt_lenb = static_lenb = stored_len + 5; /* force a stored block */
	  }

	  if ((stored_len+4 <= opt_lenb) && (buf !== -1)) {
	    /* 4: two words for the lengths */

	    /* The test buf != NULL is only necessary if LIT_BUFSIZE > WSIZE.
	     * Otherwise we can't have processed more than WSIZE input bytes since
	     * the last block flush, because compression would have been
	     * successful. If LIT_BUFSIZE <= WSIZE, it is never too late to
	     * transform a block into a stored block.
	     */
	    _tr_stored_block(s, buf, stored_len, last);

	  } else if (s.strategy === Z_FIXED || static_lenb === opt_lenb) {

	    send_bits(s, (STATIC_TREES<<1) + (last ? 1 : 0), 3);
	    compress_block(s, static_ltree, static_dtree);

	  } else {
	    send_bits(s, (DYN_TREES<<1) + (last ? 1 : 0), 3);
	    send_all_trees(s, s.l_desc.max_code+1, s.d_desc.max_code+1, max_blindex+1);
	    compress_block(s, s.dyn_ltree, s.dyn_dtree);
	  }
	  // Assert (s->compressed_len == s->bits_sent, "bad compressed size");
	  /* The above check is made mod 2^32, for files larger than 512 MB
	   * and uLong implemented on 32 bits.
	   */
	  init_block(s);

	  if (last) {
	    bi_windup(s);
	  }
	  // Tracev((stderr,"\ncomprlen %lu(%lu) ", s->compressed_len>>3,
	  //       s->compressed_len-7*last));
	}

	/* ===========================================================================
	 * Save the match info and tally the frequency counts. Return true if
	 * the current block must be flushed.
	 */
	function _tr_tally(s, dist, lc)
	//    deflate_state *s;
	//    unsigned dist;  /* distance of matched string */
	//    unsigned lc;    /* match length-MIN_MATCH or unmatched char (if dist==0) */
	{
	  //var out_length, in_length, dcode;

	  s.pending_buf[s.d_buf + s.last_lit * 2]     = (dist >>> 8) & 0xff;
	  s.pending_buf[s.d_buf + s.last_lit * 2 + 1] = dist & 0xff;

	  s.pending_buf[s.l_buf + s.last_lit] = lc & 0xff;
	  s.last_lit++;

	  if (dist === 0) {
	    /* lc is the unmatched char */
	    s.dyn_ltree[lc*2]/*.Freq*/++;
	  } else {
	    s.matches++;
	    /* Here, lc is the match length - MIN_MATCH */
	    dist--;             /* dist = match distance - 1 */
	    //Assert((ush)dist < (ush)MAX_DIST(s) &&
	    //       (ush)lc <= (ush)(MAX_MATCH-MIN_MATCH) &&
	    //       (ush)d_code(dist) < (ush)D_CODES,  "_tr_tally: bad match");

	    s.dyn_ltree[(_length_code[lc]+LITERALS+1) * 2]/*.Freq*/++;
	    s.dyn_dtree[d_code(dist) * 2]/*.Freq*/++;
	  }

	// (!) This block is disabled in zlib defailts,
	// don't enable it for binary compatibility

	//#ifdef TRUNCATE_BLOCK
	//  /* Try to guess if it is profitable to stop the current block here */
	//  if ((s.last_lit & 0x1fff) === 0 && s.level > 2) {
	//    /* Compute an upper bound for the compressed length */
	//    out_length = s.last_lit*8;
	//    in_length = s.strstart - s.block_start;
	//
	//    for (dcode = 0; dcode < D_CODES; dcode++) {
	//      out_length += s.dyn_dtree[dcode*2]/*.Freq*/ * (5 + extra_dbits[dcode]);
	//    }
	//    out_length >>>= 3;
	//    //Tracev((stderr,"\nlast_lit %u, in %ld, out ~%ld(%ld%%) ",
	//    //       s->last_lit, in_length, out_length,
	//    //       100L - out_length*100L/in_length));
	//    if (s.matches < (s.last_lit>>1)/*int /2*/ && out_length < (in_length>>1)/*int /2*/) {
	//      return true;
	//    }
	//  }
	//#endif

	  return (s.last_lit === s.lit_bufsize-1);
	  /* We avoid equality with lit_bufsize because of wraparound at 64K
	   * on 16 bit machines and because stored blocks are restricted to
	   * 64K-1 bytes.
	   */
	}

	exports._tr_init  = _tr_init;
	exports._tr_stored_block = _tr_stored_block;
	exports._tr_flush_block  = _tr_flush_block;
	exports._tr_tally = _tr_tally;
	exports._tr_align = _tr_align;

/***/ },
/* 12 */
/***/ function(module, exports) {

	'use strict';

	// Note: adler32 takes 12% for level 0 and 2% for level 6.
	// It doesn't worth to make additional optimizationa as in original.
	// Small size is preferable.

	function adler32(adler, buf, len, pos) {
	  var s1 = (adler & 0xffff) |0
	    , s2 = ((adler >>> 16) & 0xffff) |0
	    , n = 0;

	  while (len !== 0) {
	    // Set limit ~ twice less than 5552, to keep
	    // s2 in 31-bits, because we force signed ints.
	    // in other case %= will fail.
	    n = len > 2000 ? 2000 : len;
	    len -= n;

	    do {
	      s1 = (s1 + buf[pos++]) |0;
	      s2 = (s2 + s1) |0;
	    } while (--n);

	    s1 %= 65521;
	    s2 %= 65521;
	  }

	  return (s1 | (s2 << 16)) |0;
	}


	module.exports = adler32;

/***/ },
/* 13 */
/***/ function(module, exports) {

	'use strict';

	// Note: we can't get significant speed boost here.
	// So write code to minimize size - no pregenerated tables
	// and array tools dependencies.


	// Use ordinary array, since untyped makes no boost here
	function makeTable() {
	  var c, table = [];

	  for(var n =0; n < 256; n++){
	    c = n;
	    for(var k =0; k < 8; k++){
	      c = ((c&1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
	    }
	    table[n] = c;
	  }

	  return table;
	}

	// Create table on load. Just 255 signed longs. Not a problem.
	var crcTable = makeTable();


	function crc32(crc, buf, len, pos) {
	  var t = crcTable
	    , end = pos + len;

	  crc = crc ^ (-1);

	  for (var i = pos; i < end; i++ ) {
	    crc = (crc >>> 8) ^ t[(crc ^ buf[i]) & 0xFF];
	  }

	  return (crc ^ (-1)); // >>> 0;
	}


	module.exports = crc32;

/***/ },
/* 14 */
/***/ function(module, exports) {

	'use strict';

	module.exports = {
	  '2':    'need dictionary',     /* Z_NEED_DICT       2  */
	  '1':    'stream end',          /* Z_STREAM_END      1  */
	  '0':    '',                    /* Z_OK              0  */
	  '-1':   'file error',          /* Z_ERRNO         (-1) */
	  '-2':   'stream error',        /* Z_STREAM_ERROR  (-2) */
	  '-3':   'data error',          /* Z_DATA_ERROR    (-3) */
	  '-4':   'insufficient memory', /* Z_MEM_ERROR     (-4) */
	  '-5':   'buffer error',        /* Z_BUF_ERROR     (-5) */
	  '-6':   'incompatible version' /* Z_VERSION_ERROR (-6) */
	};

/***/ },
/* 15 */
/***/ function(module, exports, __webpack_require__) {

	// String encode/decode helpers
	'use strict';


	var utils = __webpack_require__(8);


	// Quick check if we can use fast array to bin string conversion
	//
	// - apply(Array) can fail on Android 2.2
	// - apply(Uint8Array) can fail on iOS 5.1 Safary
	//
	var STR_APPLY_OK = true;
	var STR_APPLY_UIA_OK = true;

	try { String.fromCharCode.apply(null, [0]); } catch(__) { STR_APPLY_OK = false; }
	try { String.fromCharCode.apply(null, new Uint8Array(1)); } catch(__) { STR_APPLY_UIA_OK = false; }


	// Table with utf8 lengths (calculated by first byte of sequence)
	// Note, that 5 & 6-byte values and some 4-byte values can not be represented in JS,
	// because max possible codepoint is 0x10ffff
	var _utf8len = new utils.Buf8(256);
	for (var i=0; i<256; i++) {
	  _utf8len[i] = (i >= 252 ? 6 : i >= 248 ? 5 : i >= 240 ? 4 : i >= 224 ? 3 : i >= 192 ? 2 : 1);
	}
	_utf8len[254]=_utf8len[254]=1; // Invalid sequence start


	// convert string to array (typed, when possible)
	exports.string2buf = function (str) {
	  var buf, c, c2, m_pos, i, str_len = str.length, buf_len = 0;

	  // count binary size
	  for (m_pos = 0; m_pos < str_len; m_pos++) {
	    c = str.charCodeAt(m_pos);
	    if ((c & 0xfc00) === 0xd800 && (m_pos+1 < str_len)) {
	      c2 = str.charCodeAt(m_pos+1);
	      if ((c2 & 0xfc00) === 0xdc00) {
	        c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
	        m_pos++;
	      }
	    }
	    buf_len += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
	  }

	  // allocate buffer
	  buf = new utils.Buf8(buf_len);

	  // convert
	  for (i=0, m_pos = 0; i < buf_len; m_pos++) {
	    c = str.charCodeAt(m_pos);
	    if ((c & 0xfc00) === 0xd800 && (m_pos+1 < str_len)) {
	      c2 = str.charCodeAt(m_pos+1);
	      if ((c2 & 0xfc00) === 0xdc00) {
	        c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
	        m_pos++;
	      }
	    }
	    if (c < 0x80) {
	      /* one byte */
	      buf[i++] = c;
	    } else if (c < 0x800) {
	      /* two bytes */
	      buf[i++] = 0xC0 | (c >>> 6);
	      buf[i++] = 0x80 | (c & 0x3f);
	    } else if (c < 0x10000) {
	      /* three bytes */
	      buf[i++] = 0xE0 | (c >>> 12);
	      buf[i++] = 0x80 | (c >>> 6 & 0x3f);
	      buf[i++] = 0x80 | (c & 0x3f);
	    } else {
	      /* four bytes */
	      buf[i++] = 0xf0 | (c >>> 18);
	      buf[i++] = 0x80 | (c >>> 12 & 0x3f);
	      buf[i++] = 0x80 | (c >>> 6 & 0x3f);
	      buf[i++] = 0x80 | (c & 0x3f);
	    }
	  }

	  return buf;
	};

	// Helper (used in 2 places)
	function buf2binstring(buf, len) {
	  // use fallback for big arrays to avoid stack overflow
	  if (len < 65537) {
	    if ((buf.subarray && STR_APPLY_UIA_OK) || (!buf.subarray && STR_APPLY_OK)) {
	      return String.fromCharCode.apply(null, utils.shrinkBuf(buf, len));
	    }
	  }

	  var result = '';
	  for(var i=0; i < len; i++) {
	    result += String.fromCharCode(buf[i]);
	  }
	  return result;
	}


	// Convert byte array to binary string
	exports.buf2binstring = function(buf) {
	  return buf2binstring(buf, buf.length);
	};


	// Convert binary string (typed, when possible)
	exports.binstring2buf = function(str) {
	  var buf = new utils.Buf8(str.length);
	  for(var i=0, len=buf.length; i < len; i++) {
	    buf[i] = str.charCodeAt(i);
	  }
	  return buf;
	};


	// convert array to string
	exports.buf2string = function (buf, max) {
	  var i, out, c, c_len;
	  var len = max || buf.length;

	  // Reserve max possible length (2 words per char)
	  // NB: by unknown reasons, Array is significantly faster for
	  //     String.fromCharCode.apply than Uint16Array.
	  var utf16buf = new Array(len*2);

	  for (out=0, i=0; i<len;) {
	    c = buf[i++];
	    // quick process ascii
	    if (c < 0x80) { utf16buf[out++] = c; continue; }

	    c_len = _utf8len[c];
	    // skip 5 & 6 byte codes
	    if (c_len > 4) { utf16buf[out++] = 0xfffd; i += c_len-1; continue; }

	    // apply mask on first byte
	    c &= c_len === 2 ? 0x1f : c_len === 3 ? 0x0f : 0x07;
	    // join the rest
	    while (c_len > 1 && i < len) {
	      c = (c << 6) | (buf[i++] & 0x3f);
	      c_len--;
	    }

	    // terminated by end of string?
	    if (c_len > 1) { utf16buf[out++] = 0xfffd; continue; }

	    if (c < 0x10000) {
	      utf16buf[out++] = c;
	    } else {
	      c -= 0x10000;
	      utf16buf[out++] = 0xd800 | ((c >> 10) & 0x3ff);
	      utf16buf[out++] = 0xdc00 | (c & 0x3ff);
	    }
	  }

	  return buf2binstring(utf16buf, out);
	};


	// Calculate max possible position in utf8 buffer,
	// that will not break sequence. If that's not possible
	// - (very small limits) return max size as is.
	//
	// buf[] - utf8 bytes array
	// max   - length limit (mandatory);
	exports.utf8border = function(buf, max) {
	  var pos;

	  max = max || buf.length;
	  if (max > buf.length) { max = buf.length; }

	  // go back from last position, until start of sequence found
	  pos = max-1;
	  while (pos >= 0 && (buf[pos] & 0xC0) === 0x80) { pos--; }

	  // Fuckup - very small and broken sequence,
	  // return max, because we should return something anyway.
	  if (pos < 0) { return max; }

	  // If we came to start of buffer - that means vuffer is too small,
	  // return max too.
	  if (pos === 0) { return max; }

	  return (pos + _utf8len[buf[pos]] > max) ? pos : max;
	};


/***/ },
/* 16 */
/***/ function(module, exports) {

	'use strict';


	function ZStream() {
	  /* next input byte */
	  this.input = null; // JS specific, because we have no pointers
	  this.next_in = 0;
	  /* number of bytes available at input */
	  this.avail_in = 0;
	  /* total number of input bytes read so far */
	  this.total_in = 0;
	  /* next output byte should be put there */
	  this.output = null; // JS specific, because we have no pointers
	  this.next_out = 0;
	  /* remaining free space at output */
	  this.avail_out = 0;
	  /* total number of bytes output so far */
	  this.total_out = 0;
	  /* last error message, NULL if no error */
	  this.msg = ''/*Z_NULL*/;
	  /* not visible by applications */
	  this.state = null;
	  /* best guess about the data type: binary or text */
	  this.data_type = 2/*Z_UNKNOWN*/;
	  /* adler32 value of the uncompressed data */
	  this.adler = 0;
	}

	module.exports = ZStream;

/***/ },
/* 17 */
/***/ function(module, exports, __webpack_require__) {

	'use strict';


	var zlib_inflate = __webpack_require__(18);
	var utils = __webpack_require__(8);
	var strings = __webpack_require__(15);
	var c = __webpack_require__(21);
	var msg = __webpack_require__(14);
	var zstream = __webpack_require__(16);
	var gzheader = __webpack_require__(22);

	var toString = Object.prototype.toString;

	/**
	 * class Inflate
	 *
	 * Generic JS-style wrapper for zlib calls. If you don't need
	 * streaming behaviour - use more simple functions: [[inflate]]
	 * and [[inflateRaw]].
	 **/

	/* internal
	 * inflate.chunks -> Array
	 *
	 * Chunks of output data, if [[Inflate#onData]] not overriden.
	 **/

	/**
	 * Inflate.result -> Uint8Array|Array|String
	 *
	 * Uncompressed result, generated by default [[Inflate#onData]]
	 * and [[Inflate#onEnd]] handlers. Filled after you push last chunk
	 * (call [[Inflate#push]] with `Z_FINISH` / `true` param).
	 **/

	/**
	 * Inflate.err -> Number
	 *
	 * Error code after inflate finished. 0 (Z_OK) on success.
	 * Should be checked if broken data possible.
	 **/

	/**
	 * Inflate.msg -> String
	 *
	 * Error message, if [[Inflate.err]] != 0
	 **/


	/**
	 * new Inflate(options)
	 * - options (Object): zlib inflate options.
	 *
	 * Creates new inflator instance with specified params. Throws exception
	 * on bad params. Supported options:
	 *
	 * - `windowBits`
	 *
	 * [http://zlib.net/manual.html#Advanced](http://zlib.net/manual.html#Advanced)
	 * for more information on these.
	 *
	 * Additional options, for internal needs:
	 *
	 * - `chunkSize` - size of generated data chunks (16K by default)
	 * - `raw` (Boolean) - do raw inflate
	 * - `to` (String) - if equal to 'string', then result will be converted
	 *   from utf8 to utf16 (javascript) string. When string output requested,
	 *   chunk length can differ from `chunkSize`, depending on content.
	 *
	 * By default, when no options set, autodetect deflate/gzip data format via
	 * wrapper header.
	 *
	 * ##### Example:
	 *
	 * ```javascript
	 * var pako = require('pako')
	 *   , chunk1 = Uint8Array([1,2,3,4,5,6,7,8,9])
	 *   , chunk2 = Uint8Array([10,11,12,13,14,15,16,17,18,19]);
	 *
	 * var inflate = new pako.Inflate({ level: 3});
	 *
	 * inflate.push(chunk1, false);
	 * inflate.push(chunk2, true);  // true -> last chunk
	 *
	 * if (inflate.err) { throw new Error(inflate.err); }
	 *
	 * console.log(inflate.result);
	 * ```
	 **/
	var Inflate = function(options) {

	  this.options = utils.assign({
	    chunkSize: 16384,
	    windowBits: 0,
	    to: ''
	  }, options || {});

	  var opt = this.options;

	  // Force window size for `raw` data, if not set directly,
	  // because we have no header for autodetect.
	  if (opt.raw && (opt.windowBits >= 0) && (opt.windowBits < 16)) {
	    opt.windowBits = -opt.windowBits;
	    if (opt.windowBits === 0) { opt.windowBits = -15; }
	  }

	  // If `windowBits` not defined (and mode not raw) - set autodetect flag for gzip/deflate
	  if ((opt.windowBits >= 0) && (opt.windowBits < 16) &&
	      !(options && options.windowBits)) {
	    opt.windowBits += 32;
	  }

	  // Gzip header has no info about windows size, we can do autodetect only
	  // for deflate. So, if window size not set, force it to max when gzip possible
	  if ((opt.windowBits > 15) && (opt.windowBits < 48)) {
	    // bit 3 (16) -> gzipped data
	    // bit 4 (32) -> autodetect gzip/deflate
	    if ((opt.windowBits & 15) === 0) {
	      opt.windowBits |= 15;
	    }
	  }

	  this.err    = 0;      // error code, if happens (0 = Z_OK)
	  this.msg    = '';     // error message
	  this.ended  = false;  // used to avoid multiple onEnd() calls
	  this.chunks = [];     // chunks of compressed data

	  this.strm   = new zstream();
	  this.strm.avail_out = 0;

	  var status  = zlib_inflate.inflateInit2(
	    this.strm,
	    opt.windowBits
	  );

	  if (status !== c.Z_OK) {
	    throw new Error(msg[status]);
	  }

	  this.header = new gzheader();

	  zlib_inflate.inflateGetHeader(this.strm, this.header);
	};

	/**
	 * Inflate#push(data[, mode]) -> Boolean
	 * - data (Uint8Array|Array|ArrayBuffer|String): input data
	 * - mode (Number|Boolean): 0..6 for corresponding Z_NO_FLUSH..Z_TREE modes.
	 *   See constants. Skipped or `false` means Z_NO_FLUSH, `true` meansh Z_FINISH.
	 *
	 * Sends input data to inflate pipe, generating [[Inflate#onData]] calls with
	 * new output chunks. Returns `true` on success. The last data block must have
	 * mode Z_FINISH (or `true`). That flush internal pending buffers and call
	 * [[Inflate#onEnd]].
	 *
	 * On fail call [[Inflate#onEnd]] with error code and return false.
	 *
	 * We strongly recommend to use `Uint8Array` on input for best speed (output
	 * format is detected automatically). Also, don't skip last param and always
	 * use the same type in your code (boolean or number). That will improve JS speed.
	 *
	 * For regular `Array`-s make sure all elements are [0..255].
	 *
	 * ##### Example
	 *
	 * ```javascript
	 * push(chunk, false); // push one of data chunks
	 * ...
	 * push(chunk, true);  // push last chunk
	 * ```
	 **/
	Inflate.prototype.push = function(data, mode) {
	  var strm = this.strm;
	  var chunkSize = this.options.chunkSize;
	  var status, _mode;
	  var next_out_utf8, tail, utf8str;

	  if (this.ended) { return false; }
	  _mode = (mode === ~~mode) ? mode : ((mode === true) ? c.Z_FINISH : c.Z_NO_FLUSH);

	  // Convert data if needed
	  if (typeof data === 'string') {
	    // Only binary strings can be decompressed on practice
	    strm.input = strings.binstring2buf(data);
	  } else if (toString.call(data) === '[object ArrayBuffer]') {
	    strm.input = new Uint8Array(data);
	  } else {
	    strm.input = data;
	  }

	  strm.next_in = 0;
	  strm.avail_in = strm.input.length;

	  do {
	    if (strm.avail_out === 0) {
	      strm.output = new utils.Buf8(chunkSize);
	      strm.next_out = 0;
	      strm.avail_out = chunkSize;
	    }

	    status = zlib_inflate.inflate(strm, c.Z_NO_FLUSH);    /* no bad return value */

	    if (status !== c.Z_STREAM_END && status !== c.Z_OK) {
	      this.onEnd(status);
	      this.ended = true;
	      return false;
	    }

	    if (strm.next_out) {
	      if (strm.avail_out === 0 || status === c.Z_STREAM_END || (strm.avail_in === 0 && _mode === c.Z_FINISH)) {

	        if (this.options.to === 'string') {

	          next_out_utf8 = strings.utf8border(strm.output, strm.next_out);

	          tail = strm.next_out - next_out_utf8;
	          utf8str = strings.buf2string(strm.output, next_out_utf8);

	          // move tail
	          strm.next_out = tail;
	          strm.avail_out = chunkSize - tail;
	          if (tail) { utils.arraySet(strm.output, strm.output, next_out_utf8, tail, 0); }

	          this.onData(utf8str);

	        } else {
	          this.onData(utils.shrinkBuf(strm.output, strm.next_out));
	        }
	      }
	    }
	  } while ((strm.avail_in > 0) && status !== c.Z_STREAM_END);

	  if (status === c.Z_STREAM_END) {
	    _mode = c.Z_FINISH;
	  }
	  // Finalize on the last chunk.
	  if (_mode === c.Z_FINISH) {
	    status = zlib_inflate.inflateEnd(this.strm);
	    this.onEnd(status);
	    this.ended = true;
	    return status === c.Z_OK;
	  }

	  return true;
	};


	/**
	 * Inflate#onData(chunk) -> Void
	 * - chunk (Uint8Array|Array|String): ouput data. Type of array depends
	 *   on js engine support. When string output requested, each chunk
	 *   will be string.
	 *
	 * By default, stores data blocks in `chunks[]` property and glue
	 * those in `onEnd`. Override this handler, if you need another behaviour.
	 **/
	Inflate.prototype.onData = function(chunk) {
	  this.chunks.push(chunk);
	};


	/**
	 * Inflate#onEnd(status) -> Void
	 * - status (Number): inflate status. 0 (Z_OK) on success,
	 *   other if not.
	 *
	 * Called once after you tell inflate that input stream complete
	 * or error happenned. By default - join collected chunks,
	 * free memory and fill `results` / `err` properties.
	 **/
	Inflate.prototype.onEnd = function(status) {
	  // On success - join
	  if (status === c.Z_OK) {
	    if (this.options.to === 'string') {
	      // Glue & convert here, until we teach pako to send
	      // utf8 alligned strings to onData
	      this.result = this.chunks.join('');
	    } else {
	      this.result = utils.flattenChunks(this.chunks);
	    }
	  }
	  this.chunks = [];
	  this.err = status;
	  this.msg = this.strm.msg;
	};


	/**
	 * inflate(data[, options]) -> Uint8Array|Array|String
	 * - data (Uint8Array|Array|String): input data to decompress.
	 * - options (Object): zlib inflate options.
	 *
	 * Decompress `data` with inflate/ungzip and `options`. Autodetect
	 * format via wrapper header by default. That's why we don't provide
	 * separate `ungzip` method.
	 *
	 * Supported options are:
	 *
	 * - windowBits
	 *
	 * [http://zlib.net/manual.html#Advanced](http://zlib.net/manual.html#Advanced)
	 * for more information.
	 *
	 * Sugar (options):
	 *
	 * - `raw` (Boolean) - say that we work with raw stream, if you don't wish to specify
	 *   negative windowBits implicitly.
	 * - `to` (String) - if equal to 'string', then result will be converted
	 *   from utf8 to utf16 (javascript) string. When string output requested,
	 *   chunk length can differ from `chunkSize`, depending on content.
	 *
	 *
	 * ##### Example:
	 *
	 * ```javascript
	 * var pako = require('pako')
	 *   , input = pako.deflate([1,2,3,4,5,6,7,8,9])
	 *   , output;
	 *
	 * try {
	 *   output = pako.inflate(input);
	 * } catch (err)
	 *   console.log(err);
	 * }
	 * ```
	 **/
	function inflate(input, options) {
	  var inflator = new Inflate(options);

	  inflator.push(input, true);

	  // That will never happens, if you don't cheat with options :)
	  if (inflator.err) { throw inflator.msg; }

	  return inflator.result;
	}


	/**
	 * inflateRaw(data[, options]) -> Uint8Array|Array|String
	 * - data (Uint8Array|Array|String): input data to decompress.
	 * - options (Object): zlib inflate options.
	 *
	 * The same as [[inflate]], but creates raw data, without wrapper
	 * (header and adler32 crc).
	 **/
	function inflateRaw(input, options) {
	  options = options || {};
	  options.raw = true;
	  return inflate(input, options);
	}


	/**
	 * ungzip(data[, options]) -> Uint8Array|Array|String
	 * - data (Uint8Array|Array|String): input data to decompress.
	 * - options (Object): zlib inflate options.
	 *
	 * Just shortcut to [[inflate]], because it autodetects format
	 * by header.content. Done for convenience.
	 **/


	exports.Inflate = Inflate;
	exports.inflate = inflate;
	exports.inflateRaw = inflateRaw;
	exports.ungzip  = inflate;


/***/ },
/* 18 */
/***/ function(module, exports, __webpack_require__) {

	'use strict';


	var utils = __webpack_require__(8);
	var adler32 = __webpack_require__(12);
	var crc32   = __webpack_require__(13);
	var inflate_fast = __webpack_require__(19);
	var inflate_table = __webpack_require__(20);

	var CODES = 0;
	var LENS = 1;
	var DISTS = 2;

	/* Public constants ==========================================================*/
	/* ===========================================================================*/


	/* Allowed flush values; see deflate() and inflate() below for details */
	//var Z_NO_FLUSH      = 0;
	//var Z_PARTIAL_FLUSH = 1;
	//var Z_SYNC_FLUSH    = 2;
	//var Z_FULL_FLUSH    = 3;
	var Z_FINISH        = 4;
	var Z_BLOCK         = 5;
	var Z_TREES         = 6;


	/* Return codes for the compression/decompression functions. Negative values
	 * are errors, positive values are used for special but normal events.
	 */
	var Z_OK            = 0;
	var Z_STREAM_END    = 1;
	var Z_NEED_DICT     = 2;
	//var Z_ERRNO         = -1;
	var Z_STREAM_ERROR  = -2;
	var Z_DATA_ERROR    = -3;
	var Z_MEM_ERROR     = -4;
	var Z_BUF_ERROR     = -5;
	//var Z_VERSION_ERROR = -6;

	/* The deflate compression method */
	var Z_DEFLATED  = 8;


	/* STATES ====================================================================*/
	/* ===========================================================================*/


	var    HEAD = 1;       /* i: waiting for magic header */
	var    FLAGS = 2;      /* i: waiting for method and flags (gzip) */
	var    TIME = 3;       /* i: waiting for modification time (gzip) */
	var    OS = 4;         /* i: waiting for extra flags and operating system (gzip) */
	var    EXLEN = 5;      /* i: waiting for extra length (gzip) */
	var    EXTRA = 6;      /* i: waiting for extra bytes (gzip) */
	var    NAME = 7;       /* i: waiting for end of file name (gzip) */
	var    COMMENT = 8;    /* i: waiting for end of comment (gzip) */
	var    HCRC = 9;       /* i: waiting for header crc (gzip) */
	var    DICTID = 10;    /* i: waiting for dictionary check value */
	var    DICT = 11;      /* waiting for inflateSetDictionary() call */
	var        TYPE = 12;      /* i: waiting for type bits, including last-flag bit */
	var        TYPEDO = 13;    /* i: same, but skip check to exit inflate on new block */
	var        STORED = 14;    /* i: waiting for stored size (length and complement) */
	var        COPY_ = 15;     /* i/o: same as COPY below, but only first time in */
	var        COPY = 16;      /* i/o: waiting for input or output to copy stored block */
	var        TABLE = 17;     /* i: waiting for dynamic block table lengths */
	var        LENLENS = 18;   /* i: waiting for code length code lengths */
	var        CODELENS = 19;  /* i: waiting for length/lit and distance code lengths */
	var            LEN_ = 20;      /* i: same as LEN below, but only first time in */
	var            LEN = 21;       /* i: waiting for length/lit/eob code */
	var            LENEXT = 22;    /* i: waiting for length extra bits */
	var            DIST = 23;      /* i: waiting for distance code */
	var            DISTEXT = 24;   /* i: waiting for distance extra bits */
	var            MATCH = 25;     /* o: waiting for output space to copy string */
	var            LIT = 26;       /* o: waiting for output space to write literal */
	var    CHECK = 27;     /* i: waiting for 32-bit check value */
	var    LENGTH = 28;    /* i: waiting for 32-bit length (gzip) */
	var    DONE = 29;      /* finished check, done -- remain here until reset */
	var    BAD = 30;       /* got a data error -- remain here until reset */
	var    MEM = 31;       /* got an inflate() memory error -- remain here until reset */
	var    SYNC = 32;      /* looking for synchronization bytes to restart inflate() */

	/* ===========================================================================*/



	var ENOUGH_LENS = 852;
	var ENOUGH_DISTS = 592;
	//var ENOUGH =  (ENOUGH_LENS+ENOUGH_DISTS);

	var MAX_WBITS = 15;
	/* 32K LZ77 window */
	var DEF_WBITS = MAX_WBITS;


	function ZSWAP32(q) {
	  return  (((q >>> 24) & 0xff) +
	          ((q >>> 8) & 0xff00) +
	          ((q & 0xff00) << 8) +
	          ((q & 0xff) << 24));
	}


	function InflateState() {
	  this.mode = 0;             /* current inflate mode */
	  this.last = false;          /* true if processing last block */
	  this.wrap = 0;              /* bit 0 true for zlib, bit 1 true for gzip */
	  this.havedict = false;      /* true if dictionary provided */
	  this.flags = 0;             /* gzip header method and flags (0 if zlib) */
	  this.dmax = 0;              /* zlib header max distance (INFLATE_STRICT) */
	  this.check = 0;             /* protected copy of check value */
	  this.total = 0;             /* protected copy of output count */
	  // TODO: may be {}
	  this.head = null;           /* where to save gzip header information */

	  /* sliding window */
	  this.wbits = 0;             /* log base 2 of requested window size */
	  this.wsize = 0;             /* window size or zero if not using window */
	  this.whave = 0;             /* valid bytes in the window */
	  this.wnext = 0;             /* window write index */
	  this.window = null;         /* allocated sliding window, if needed */

	  /* bit accumulator */
	  this.hold = 0;              /* input bit accumulator */
	  this.bits = 0;              /* number of bits in "in" */

	  /* for string and stored block copying */
	  this.length = 0;            /* literal or length of data to copy */
	  this.offset = 0;            /* distance back to copy string from */

	  /* for table and code decoding */
	  this.extra = 0;             /* extra bits needed */

	  /* fixed and dynamic code tables */
	  this.lencode = null;          /* starting table for length/literal codes */
	  this.distcode = null;         /* starting table for distance codes */
	  this.lenbits = 0;           /* index bits for lencode */
	  this.distbits = 0;          /* index bits for distcode */

	  /* dynamic table building */
	  this.ncode = 0;             /* number of code length code lengths */
	  this.nlen = 0;              /* number of length code lengths */
	  this.ndist = 0;             /* number of distance code lengths */
	  this.have = 0;              /* number of code lengths in lens[] */
	  this.next = null;              /* next available space in codes[] */

	  this.lens = new utils.Buf16(320); /* temporary storage for code lengths */
	  this.work = new utils.Buf16(288); /* work area for code table building */

	  /*
	   because we don't have pointers in js, we use lencode and distcode directly
	   as buffers so we don't need codes
	  */
	  //this.codes = new utils.Buf32(ENOUGH);       /* space for code tables */
	  this.lendyn = null;              /* dynamic table for length/literal codes (JS specific) */
	  this.distdyn = null;             /* dynamic table for distance codes (JS specific) */
	  this.sane = 0;                   /* if false, allow invalid distance too far */
	  this.back = 0;                   /* bits back of last unprocessed length/lit */
	  this.was = 0;                    /* initial length of match */
	}

	function inflateResetKeep(strm) {
	  var state;

	  if (!strm || !strm.state) { return Z_STREAM_ERROR; }
	  state = strm.state;
	  strm.total_in = strm.total_out = state.total = 0;
	  strm.msg = ''; /*Z_NULL*/
	  if (state.wrap) {       /* to support ill-conceived Java test suite */
	    strm.adler = state.wrap & 1;
	  }
	  state.mode = HEAD;
	  state.last = 0;
	  state.havedict = 0;
	  state.dmax = 32768;
	  state.head = null/*Z_NULL*/;
	  state.hold = 0;
	  state.bits = 0;
	  //state.lencode = state.distcode = state.next = state.codes;
	  state.lencode = state.lendyn = new utils.Buf32(ENOUGH_LENS);
	  state.distcode = state.distdyn = new utils.Buf32(ENOUGH_DISTS);

	  state.sane = 1;
	  state.back = -1;
	  //Tracev((stderr, "inflate: reset\n"));
	  return Z_OK;
	}

	function inflateReset(strm) {
	  var state;

	  if (!strm || !strm.state) { return Z_STREAM_ERROR; }
	  state = strm.state;
	  state.wsize = 0;
	  state.whave = 0;
	  state.wnext = 0;
	  return inflateResetKeep(strm);

	}

	function inflateReset2(strm, windowBits) {
	  var wrap;
	  var state;

	  /* get the state */
	  if (!strm || !strm.state) { return Z_STREAM_ERROR; }
	  state = strm.state;

	  /* extract wrap request from windowBits parameter */
	  if (windowBits < 0) {
	    wrap = 0;
	    windowBits = -windowBits;
	  }
	  else {
	    wrap = (windowBits >> 4) + 1;
	    if (windowBits < 48) {
	      windowBits &= 15;
	    }
	  }

	  /* set number of window bits, free window if different */
	  if (windowBits && (windowBits < 8 || windowBits > 15)) {
	    return Z_STREAM_ERROR;
	  }
	  if (state.window !== null && state.wbits !== windowBits) {
	    state.window = null;
	  }

	  /* update state and reset the rest of it */
	  state.wrap = wrap;
	  state.wbits = windowBits;
	  return inflateReset(strm);
	}

	function inflateInit2(strm, windowBits) {
	  var ret;
	  var state;

	  if (!strm) { return Z_STREAM_ERROR; }
	  //strm.msg = Z_NULL;                 /* in case we return an error */

	  state = new InflateState();

	  //if (state === Z_NULL) return Z_MEM_ERROR;
	  //Tracev((stderr, "inflate: allocated\n"));
	  strm.state = state;
	  state.window = null/*Z_NULL*/;
	  ret = inflateReset2(strm, windowBits);
	  if (ret !== Z_OK) {
	    strm.state = null/*Z_NULL*/;
	  }
	  return ret;
	}

	function inflateInit(strm) {
	  return inflateInit2(strm, DEF_WBITS);
	}


	/*
	 Return state with length and distance decoding tables and index sizes set to
	 fixed code decoding.  Normally this returns fixed tables from inffixed.h.
	 If BUILDFIXED is defined, then instead this routine builds the tables the
	 first time it's called, and returns those tables the first time and
	 thereafter.  This reduces the size of the code by about 2K bytes, in
	 exchange for a little execution time.  However, BUILDFIXED should not be
	 used for threaded applications, since the rewriting of the tables and virgin
	 may not be thread-safe.
	 */
	var virgin = true;

	var lenfix, distfix; // We have no pointers in JS, so keep tables separate

	function fixedtables(state) {
	  /* build fixed huffman tables if first call (may not be thread safe) */
	  if (virgin) {
	    var sym;

	    lenfix = new utils.Buf32(512);
	    distfix = new utils.Buf32(32);

	    /* literal/length table */
	    sym = 0;
	    while (sym < 144) { state.lens[sym++] = 8; }
	    while (sym < 256) { state.lens[sym++] = 9; }
	    while (sym < 280) { state.lens[sym++] = 7; }
	    while (sym < 288) { state.lens[sym++] = 8; }

	    inflate_table(LENS,  state.lens, 0, 288, lenfix,   0, state.work, {bits: 9});

	    /* distance table */
	    sym = 0;
	    while (sym < 32) { state.lens[sym++] = 5; }

	    inflate_table(DISTS, state.lens, 0, 32,   distfix, 0, state.work, {bits: 5});

	    /* do this just once */
	    virgin = false;
	  }

	  state.lencode = lenfix;
	  state.lenbits = 9;
	  state.distcode = distfix;
	  state.distbits = 5;
	}


	/*
	 Update the window with the last wsize (normally 32K) bytes written before
	 returning.  If window does not exist yet, create it.  This is only called
	 when a window is already in use, or when output has been written during this
	 inflate call, but the end of the deflate stream has not been reached yet.
	 It is also called to create a window for dictionary data when a dictionary
	 is loaded.

	 Providing output buffers larger than 32K to inflate() should provide a speed
	 advantage, since only the last 32K of output is copied to the sliding window
	 upon return from inflate(), and since all distances after the first 32K of
	 output will fall in the output data, making match copies simpler and faster.
	 The advantage may be dependent on the size of the processor's data caches.
	 */
	function updatewindow(strm, src, end, copy) {
	  var dist;
	  var state = strm.state;

	  /* if it hasn't been done already, allocate space for the window */
	  if (state.window === null) {
	    state.wsize = 1 << state.wbits;
	    state.wnext = 0;
	    state.whave = 0;

	    state.window = new utils.Buf8(state.wsize);
	  }

	  /* copy state->wsize or less output bytes into the circular window */
	  if (copy >= state.wsize) {
	    utils.arraySet(state.window,src, end - state.wsize, state.wsize, 0);
	    state.wnext = 0;
	    state.whave = state.wsize;
	  }
	  else {
	    dist = state.wsize - state.wnext;
	    if (dist > copy) {
	      dist = copy;
	    }
	    //zmemcpy(state->window + state->wnext, end - copy, dist);
	    utils.arraySet(state.window,src, end - copy, dist, state.wnext);
	    copy -= dist;
	    if (copy) {
	      //zmemcpy(state->window, end - copy, copy);
	      utils.arraySet(state.window,src, end - copy, copy, 0);
	      state.wnext = copy;
	      state.whave = state.wsize;
	    }
	    else {
	      state.wnext += dist;
	      if (state.wnext === state.wsize) { state.wnext = 0; }
	      if (state.whave < state.wsize) { state.whave += dist; }
	    }
	  }
	  return 0;
	}

	function inflate(strm, flush) {
	  var state;
	  var input, output;          // input/output buffers
	  var next;                   /* next input INDEX */
	  var put;                    /* next output INDEX */
	  var have, left;             /* available input and output */
	  var hold;                   /* bit buffer */
	  var bits;                   /* bits in bit buffer */
	  var _in, _out;              /* save starting available input and output */
	  var copy;                   /* number of stored or match bytes to copy */
	  var from;                   /* where to copy match bytes from */
	  var from_source;
	  var here = 0;               /* current decoding table entry */
	  var here_bits, here_op, here_val; // paked "here" denormalized (JS specific)
	  //var last;                   /* parent table entry */
	  var last_bits, last_op, last_val; // paked "last" denormalized (JS specific)
	  var len;                    /* length to copy for repeats, bits to drop */
	  var ret;                    /* return code */
	  var hbuf = new utils.Buf8(4);    /* buffer for gzip header crc calculation */
	  var opts;

	  var n; // temporary var for NEED_BITS

	  var order = /* permutation of code lengths */
	    [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];


	  if (!strm || !strm.state || !strm.output ||
	      (!strm.input && strm.avail_in !== 0)) {
	    return Z_STREAM_ERROR;
	  }

	  state = strm.state;
	  if (state.mode === TYPE) { state.mode = TYPEDO; }    /* skip check */


	  //--- LOAD() ---
	  put = strm.next_out;
	  output = strm.output;
	  left = strm.avail_out;
	  next = strm.next_in;
	  input = strm.input;
	  have = strm.avail_in;
	  hold = state.hold;
	  bits = state.bits;
	  //---

	  _in = have;
	  _out = left;
	  ret = Z_OK;

	  inf_leave: // goto emulation
	  for (;;) {
	    switch (state.mode) {
	    case HEAD:
	      if (state.wrap === 0) {
	        state.mode = TYPEDO;
	        break;
	      }
	      //=== NEEDBITS(16);
	      while (bits < 16) {
	        if (have === 0) { break inf_leave; }
	        have--;
	        hold += input[next++] << bits;
	        bits += 8;
	      }
	      //===//
	      if ((state.wrap & 2) && hold === 0x8b1f) {  /* gzip header */
	        state.check = 0/*crc32(0L, Z_NULL, 0)*/;
	        //=== CRC2(state.check, hold);
	        hbuf[0] = hold & 0xff;
	        hbuf[1] = (hold >>> 8) & 0xff;
	        state.check = crc32(state.check, hbuf, 2, 0);
	        //===//

	        //=== INITBITS();
	        hold = 0;
	        bits = 0;
	        //===//
	        state.mode = FLAGS;
	        break;
	      }
	      state.flags = 0;           /* expect zlib header */
	      if (state.head) {
	        state.head.done = false;
	      }
	      if (!(state.wrap & 1) ||   /* check if zlib header allowed */
	        (((hold & 0xff)/*BITS(8)*/ << 8) + (hold >> 8)) % 31) {
	        strm.msg = 'incorrect header check';
	        state.mode = BAD;
	        break;
	      }
	      if ((hold & 0x0f)/*BITS(4)*/ !== Z_DEFLATED) {
	        strm.msg = 'unknown compression method';
	        state.mode = BAD;
	        break;
	      }
	      //--- DROPBITS(4) ---//
	      hold >>>= 4;
	      bits -= 4;
	      //---//
	      len = (hold & 0x0f)/*BITS(4)*/ + 8;
	      if (state.wbits === 0) {
	        state.wbits = len;
	      }
	      else if (len > state.wbits) {
	        strm.msg = 'invalid window size';
	        state.mode = BAD;
	        break;
	      }
	      state.dmax = 1 << len;
	      //Tracev((stderr, "inflate:   zlib header ok\n"));
	      strm.adler = state.check = 1/*adler32(0L, Z_NULL, 0)*/;
	      state.mode = hold & 0x200 ? DICTID : TYPE;
	      //=== INITBITS();
	      hold = 0;
	      bits = 0;
	      //===//
	      break;
	    case FLAGS:
	      //=== NEEDBITS(16); */
	      while (bits < 16) {
	        if (have === 0) { break inf_leave; }
	        have--;
	        hold += input[next++] << bits;
	        bits += 8;
	      }
	      //===//
	      state.flags = hold;
	      if ((state.flags & 0xff) !== Z_DEFLATED) {
	        strm.msg = 'unknown compression method';
	        state.mode = BAD;
	        break;
	      }
	      if (state.flags & 0xe000) {
	        strm.msg = 'unknown header flags set';
	        state.mode = BAD;
	        break;
	      }
	      if (state.head) {
	        state.head.text = ((hold >> 8) & 1);
	      }
	      if (state.flags & 0x0200) {
	        //=== CRC2(state.check, hold);
	        hbuf[0] = hold & 0xff;
	        hbuf[1] = (hold >>> 8) & 0xff;
	        state.check = crc32(state.check, hbuf, 2, 0);
	        //===//
	      }
	      //=== INITBITS();
	      hold = 0;
	      bits = 0;
	      //===//
	      state.mode = TIME;
	      /* falls through */
	    case TIME:
	      //=== NEEDBITS(32); */
	      while (bits < 32) {
	        if (have === 0) { break inf_leave; }
	        have--;
	        hold += input[next++] << bits;
	        bits += 8;
	      }
	      //===//
	      if (state.head) {
	        state.head.time = hold;
	      }
	      if (state.flags & 0x0200) {
	        //=== CRC4(state.check, hold)
	        hbuf[0] = hold & 0xff;
	        hbuf[1] = (hold >>> 8) & 0xff;
	        hbuf[2] = (hold >>> 16) & 0xff;
	        hbuf[3] = (hold >>> 24) & 0xff;
	        state.check = crc32(state.check, hbuf, 4, 0);
	        //===
	      }
	      //=== INITBITS();
	      hold = 0;
	      bits = 0;
	      //===//
	      state.mode = OS;
	      /* falls through */
	    case OS:
	      //=== NEEDBITS(16); */
	      while (bits < 16) {
	        if (have === 0) { break inf_leave; }
	        have--;
	        hold += input[next++] << bits;
	        bits += 8;
	      }
	      //===//
	      if (state.head) {
	        state.head.xflags = (hold & 0xff);
	        state.head.os = (hold >> 8);
	      }
	      if (state.flags & 0x0200) {
	        //=== CRC2(state.check, hold);
	        hbuf[0] = hold & 0xff;
	        hbuf[1] = (hold >>> 8) & 0xff;
	        state.check = crc32(state.check, hbuf, 2, 0);
	        //===//
	      }
	      //=== INITBITS();
	      hold = 0;
	      bits = 0;
	      //===//
	      state.mode = EXLEN;
	      /* falls through */
	    case EXLEN:
	      if (state.flags & 0x0400) {
	        //=== NEEDBITS(16); */
	        while (bits < 16) {
	          if (have === 0) { break inf_leave; }
	          have--;
	          hold += input[next++] << bits;
	          bits += 8;
	        }
	        //===//
	        state.length = hold;
	        if (state.head) {
	          state.head.extra_len = hold;
	        }
	        if (state.flags & 0x0200) {
	          //=== CRC2(state.check, hold);
	          hbuf[0] = hold & 0xff;
	          hbuf[1] = (hold >>> 8) & 0xff;
	          state.check = crc32(state.check, hbuf, 2, 0);
	          //===//
	        }
	        //=== INITBITS();
	        hold = 0;
	        bits = 0;
	        //===//
	      }
	      else if (state.head) {
	        state.head.extra = null/*Z_NULL*/;
	      }
	      state.mode = EXTRA;
	      /* falls through */
	    case EXTRA:
	      if (state.flags & 0x0400) {
	        copy = state.length;
	        if (copy > have) { copy = have; }
	        if (copy) {
	          if (state.head) {
	            len = state.head.extra_len - state.length;
	            if (!state.head.extra) {
	              // Use untyped array for more conveniend processing later
	              state.head.extra = new Array(state.head.extra_len);
	            }
	            utils.arraySet(
	              state.head.extra,
	              input,
	              next,
	              // extra field is limited to 65536 bytes
	              // - no need for additional size check
	              copy,
	              /*len + copy > state.head.extra_max - len ? state.head.extra_max : copy,*/
	              len
	            );
	            //zmemcpy(state.head.extra + len, next,
	            //        len + copy > state.head.extra_max ?
	            //        state.head.extra_max - len : copy);
	          }
	          if (state.flags & 0x0200) {
	            state.check = crc32(state.check, input, copy, next);
	          }
	          have -= copy;
	          next += copy;
	          state.length -= copy;
	        }
	        if (state.length) { break inf_leave; }
	      }
	      state.length = 0;
	      state.mode = NAME;
	      /* falls through */
	    case NAME:
	      if (state.flags & 0x0800) {
	        if (have === 0) { break inf_leave; }
	        copy = 0;
	        do {
	          // TODO: 2 or 1 bytes?
	          len = input[next + copy++];
	          /* use constant limit because in js we should not preallocate memory */
	          if (state.head && len &&
	              (state.length < 65536 /*state.head.name_max*/)) {
	            state.head.name += String.fromCharCode(len);
	          }
	        } while (len && copy < have);

	        if (state.flags & 0x0200) {
	          state.check = crc32(state.check, input, copy, next);
	        }
	        have -= copy;
	        next += copy;
	        if (len) { break inf_leave; }
	      }
	      else if (state.head) {
	        state.head.name = null;
	      }
	      state.length = 0;
	      state.mode = COMMENT;
	      /* falls through */
	    case COMMENT:
	      if (state.flags & 0x1000) {
	        if (have === 0) { break inf_leave; }
	        copy = 0;
	        do {
	          len = input[next + copy++];
	          /* use constant limit because in js we should not preallocate memory */
	          if (state.head && len &&
	              (state.length < 65536 /*state.head.comm_max*/)) {
	            state.head.comment += String.fromCharCode(len);
	          }
	        } while (len && copy < have);
	        if (state.flags & 0x0200) {
	          state.check = crc32(state.check, input, copy, next);
	        }
	        have -= copy;
	        next += copy;
	        if (len) { break inf_leave; }
	      }
	      else if (state.head) {
	        state.head.comment = null;
	      }
	      state.mode = HCRC;
	      /* falls through */
	    case HCRC:
	      if (state.flags & 0x0200) {
	        //=== NEEDBITS(16); */
	        while (bits < 16) {
	          if (have === 0) { break inf_leave; }
	          have--;
	          hold += input[next++] << bits;
	          bits += 8;
	        }
	        //===//
	        if (hold !== (state.check & 0xffff)) {
	          strm.msg = 'header crc mismatch';
	          state.mode = BAD;
	          break;
	        }
	        //=== INITBITS();
	        hold = 0;
	        bits = 0;
	        //===//
	      }
	      if (state.head) {
	        state.head.hcrc = ((state.flags >> 9) & 1);
	        state.head.done = true;
	      }
	      strm.adler = state.check = 0 /*crc32(0L, Z_NULL, 0)*/;
	      state.mode = TYPE;
	      break;
	    case DICTID:
	      //=== NEEDBITS(32); */
	      while (bits < 32) {
	        if (have === 0) { break inf_leave; }
	        have--;
	        hold += input[next++] << bits;
	        bits += 8;
	      }
	      //===//
	      strm.adler = state.check = ZSWAP32(hold);
	      //=== INITBITS();
	      hold = 0;
	      bits = 0;
	      //===//
	      state.mode = DICT;
	      /* falls through */
	    case DICT:
	      if (state.havedict === 0) {
	        //--- RESTORE() ---
	        strm.next_out = put;
	        strm.avail_out = left;
	        strm.next_in = next;
	        strm.avail_in = have;
	        state.hold = hold;
	        state.bits = bits;
	        //---
	        return Z_NEED_DICT;
	      }
	      strm.adler = state.check = 1/*adler32(0L, Z_NULL, 0)*/;
	      state.mode = TYPE;
	      /* falls through */
	    case TYPE:
	      if (flush === Z_BLOCK || flush === Z_TREES) { break inf_leave; }
	      /* falls through */
	    case TYPEDO:
	      if (state.last) {
	        //--- BYTEBITS() ---//
	        hold >>>= bits & 7;
	        bits -= bits & 7;
	        //---//
	        state.mode = CHECK;
	        break;
	      }
	      //=== NEEDBITS(3); */
	      while (bits < 3) {
	        if (have === 0) { break inf_leave; }
	        have--;
	        hold += input[next++] << bits;
	        bits += 8;
	      }
	      //===//
	      state.last = (hold & 0x01)/*BITS(1)*/;
	      //--- DROPBITS(1) ---//
	      hold >>>= 1;
	      bits -= 1;
	      //---//

	      switch ((hold & 0x03)/*BITS(2)*/) {
	      case 0:                             /* stored block */
	        //Tracev((stderr, "inflate:     stored block%s\n",
	        //        state.last ? " (last)" : ""));
	        state.mode = STORED;
	        break;
	      case 1:                             /* fixed block */
	        fixedtables(state);
	        //Tracev((stderr, "inflate:     fixed codes block%s\n",
	        //        state.last ? " (last)" : ""));
	        state.mode = LEN_;             /* decode codes */
	        if (flush === Z_TREES) {
	          //--- DROPBITS(2) ---//
	          hold >>>= 2;
	          bits -= 2;
	          //---//
	          break inf_leave;
	        }
	        break;
	      case 2:                             /* dynamic block */
	        //Tracev((stderr, "inflate:     dynamic codes block%s\n",
	        //        state.last ? " (last)" : ""));
	        state.mode = TABLE;
	        break;
	      case 3:
	        strm.msg = 'invalid block type';
	        state.mode = BAD;
	      }
	      //--- DROPBITS(2) ---//
	      hold >>>= 2;
	      bits -= 2;
	      //---//
	      break;
	    case STORED:
	      //--- BYTEBITS() ---// /* go to byte boundary */
	      hold >>>= bits & 7;
	      bits -= bits & 7;
	      //---//
	      //=== NEEDBITS(32); */
	      while (bits < 32) {
	        if (have === 0) { break inf_leave; }
	        have--;
	        hold += input[next++] << bits;
	        bits += 8;
	      }
	      //===//
	      if ((hold & 0xffff) !== ((hold >>> 16) ^ 0xffff)) {
	        strm.msg = 'invalid stored block lengths';
	        state.mode = BAD;
	        break;
	      }
	      state.length = hold & 0xffff;
	      //Tracev((stderr, "inflate:       stored length %u\n",
	      //        state.length));
	      //=== INITBITS();
	      hold = 0;
	      bits = 0;
	      //===//
	      state.mode = COPY_;
	      if (flush === Z_TREES) { break inf_leave; }
	      /* falls through */
	    case COPY_:
	      state.mode = COPY;
	      /* falls through */
	    case COPY:
	      copy = state.length;
	      if (copy) {
	        if (copy > have) { copy = have; }
	        if (copy > left) { copy = left; }
	        if (copy === 0) { break inf_leave; }
	        //--- zmemcpy(put, next, copy); ---
	        utils.arraySet(output, input, next, copy, put);
	        //---//
	        have -= copy;
	        next += copy;
	        left -= copy;
	        put += copy;
	        state.length -= copy;
	        break;
	      }
	      //Tracev((stderr, "inflate:       stored end\n"));
	      state.mode = TYPE;
	      break;
	    case TABLE:
	      //=== NEEDBITS(14); */
	      while (bits < 14) {
	        if (have === 0) { break inf_leave; }
	        have--;
	        hold += input[next++] << bits;
	        bits += 8;
	      }
	      //===//
	      state.nlen = (hold & 0x1f)/*BITS(5)*/ + 257;
	      //--- DROPBITS(5) ---//
	      hold >>>= 5;
	      bits -= 5;
	      //---//
	      state.ndist = (hold & 0x1f)/*BITS(5)*/ + 1;
	      //--- DROPBITS(5) ---//
	      hold >>>= 5;
	      bits -= 5;
	      //---//
	      state.ncode = (hold & 0x0f)/*BITS(4)*/ + 4;
	      //--- DROPBITS(4) ---//
	      hold >>>= 4;
	      bits -= 4;
	      //---//
	//#ifndef PKZIP_BUG_WORKAROUND
	      if (state.nlen > 286 || state.ndist > 30) {
	        strm.msg = 'too many length or distance symbols';
	        state.mode = BAD;
	        break;
	      }
	//#endif
	      //Tracev((stderr, "inflate:       table sizes ok\n"));
	      state.have = 0;
	      state.mode = LENLENS;
	      /* falls through */
	    case LENLENS:
	      while (state.have < state.ncode) {
	        //=== NEEDBITS(3);
	        while (bits < 3) {
	          if (have === 0) { break inf_leave; }
	          have--;
	          hold += input[next++] << bits;
	          bits += 8;
	        }
	        //===//
	        state.lens[order[state.have++]] = (hold & 0x07);//BITS(3);
	        //--- DROPBITS(3) ---//
	        hold >>>= 3;
	        bits -= 3;
	        //---//
	      }
	      while (state.have < 19) {
	        state.lens[order[state.have++]] = 0;
	      }
	      // We have separate tables & no pointers. 2 commented lines below not needed.
	      //state.next = state.codes;
	      //state.lencode = state.next;
	      // Switch to use dynamic table
	      state.lencode = state.lendyn;
	      state.lenbits = 7;

	      opts = {bits: state.lenbits};
	      ret = inflate_table(CODES, state.lens, 0, 19, state.lencode, 0, state.work, opts);
	      state.lenbits = opts.bits;

	      if (ret) {
	        strm.msg = 'invalid code lengths set';
	        state.mode = BAD;
	        break;
	      }
	      //Tracev((stderr, "inflate:       code lengths ok\n"));
	      state.have = 0;
	      state.mode = CODELENS;
	      /* falls through */
	    case CODELENS:
	      while (state.have < state.nlen + state.ndist) {
	        for (;;) {
	          here = state.lencode[hold & ((1 << state.lenbits) - 1)];/*BITS(state.lenbits)*/
	          here_bits = here >>> 24;
	          here_op = (here >>> 16) & 0xff;
	          here_val = here & 0xffff;

	          if ((here_bits) <= bits) { break; }
	          //--- PULLBYTE() ---//
	          if (have === 0) { break inf_leave; }
	          have--;
	          hold += input[next++] << bits;
	          bits += 8;
	          //---//
	        }
	        if (here_val < 16) {
	          //--- DROPBITS(here.bits) ---//
	          hold >>>= here_bits;
	          bits -= here_bits;
	          //---//
	          state.lens[state.have++] = here_val;
	        }
	        else {
	          if (here_val === 16) {
	            //=== NEEDBITS(here.bits + 2);
	            n = here_bits + 2;
	            while (bits < n) {
	              if (have === 0) { break inf_leave; }
	              have--;
	              hold += input[next++] << bits;
	              bits += 8;
	            }
	            //===//
	            //--- DROPBITS(here.bits) ---//
	            hold >>>= here_bits;
	            bits -= here_bits;
	            //---//
	            if (state.have === 0) {
	              strm.msg = 'invalid bit length repeat';
	              state.mode = BAD;
	              break;
	            }
	            len = state.lens[state.have - 1];
	            copy = 3 + (hold & 0x03);//BITS(2);
	            //--- DROPBITS(2) ---//
	            hold >>>= 2;
	            bits -= 2;
	            //---//
	          }
	          else if (here_val === 17) {
	            //=== NEEDBITS(here.bits + 3);
	            n = here_bits + 3;
	            while (bits < n) {
	              if (have === 0) { break inf_leave; }
	              have--;
	              hold += input[next++] << bits;
	              bits += 8;
	            }
	            //===//
	            //--- DROPBITS(here.bits) ---//
	            hold >>>= here_bits;
	            bits -= here_bits;
	            //---//
	            len = 0;
	            copy = 3 + (hold & 0x07);//BITS(3);
	            //--- DROPBITS(3) ---//
	            hold >>>= 3;
	            bits -= 3;
	            //---//
	          }
	          else {
	            //=== NEEDBITS(here.bits + 7);
	            n = here_bits + 7;
	            while (bits < n) {
	              if (have === 0) { break inf_leave; }
	              have--;
	              hold += input[next++] << bits;
	              bits += 8;
	            }
	            //===//
	            //--- DROPBITS(here.bits) ---//
	            hold >>>= here_bits;
	            bits -= here_bits;
	            //---//
	            len = 0;
	            copy = 11 + (hold & 0x7f);//BITS(7);
	            //--- DROPBITS(7) ---//
	            hold >>>= 7;
	            bits -= 7;
	            //---//
	          }
	          if (state.have + copy > state.nlen + state.ndist) {
	            strm.msg = 'invalid bit length repeat';
	            state.mode = BAD;
	            break;
	          }
	          while (copy--) {
	            state.lens[state.have++] = len;
	          }
	        }
	      }

	      /* handle error breaks in while */
	      if (state.mode === BAD) { break; }

	      /* check for end-of-block code (better have one) */
	      if (state.lens[256] === 0) {
	        strm.msg = 'invalid code -- missing end-of-block';
	        state.mode = BAD;
	        break;
	      }

	      /* build code tables -- note: do not change the lenbits or distbits
	         values here (9 and 6) without reading the comments in inftrees.h
	         concerning the ENOUGH constants, which depend on those values */
	      state.lenbits = 9;

	      opts = {bits: state.lenbits};
	      ret = inflate_table(LENS, state.lens, 0, state.nlen, state.lencode, 0, state.work, opts);
	      // We have separate tables & no pointers. 2 commented lines below not needed.
	      // state.next_index = opts.table_index;
	      state.lenbits = opts.bits;
	      // state.lencode = state.next;

	      if (ret) {
	        strm.msg = 'invalid literal/lengths set';
	        state.mode = BAD;
	        break;
	      }

	      state.distbits = 6;
	      //state.distcode.copy(state.codes);
	      // Switch to use dynamic table
	      state.distcode = state.distdyn;
	      opts = {bits: state.distbits};
	      ret = inflate_table(DISTS, state.lens, state.nlen, state.ndist, state.distcode, 0, state.work, opts);
	      // We have separate tables & no pointers. 2 commented lines below not needed.
	      // state.next_index = opts.table_index;
	      state.distbits = opts.bits;
	      // state.distcode = state.next;

	      if (ret) {
	        strm.msg = 'invalid distances set';
	        state.mode = BAD;
	        break;
	      }
	      //Tracev((stderr, 'inflate:       codes ok\n'));
	      state.mode = LEN_;
	      if (flush === Z_TREES) { break inf_leave; }
	      /* falls through */
	    case LEN_:
	      state.mode = LEN;
	      /* falls through */
	    case LEN:
	      if (have >= 6 && left >= 258) {
	        //--- RESTORE() ---
	        strm.next_out = put;
	        strm.avail_out = left;
	        strm.next_in = next;
	        strm.avail_in = have;
	        state.hold = hold;
	        state.bits = bits;
	        //---
	        inflate_fast(strm, _out);
	        //--- LOAD() ---
	        put = strm.next_out;
	        output = strm.output;
	        left = strm.avail_out;
	        next = strm.next_in;
	        input = strm.input;
	        have = strm.avail_in;
	        hold = state.hold;
	        bits = state.bits;
	        //---

	        if (state.mode === TYPE) {
	          state.back = -1;
	        }
	        break;
	      }
	      state.back = 0;
	      for (;;) {
	        here = state.lencode[hold & ((1 << state.lenbits) -1)];  /*BITS(state.lenbits)*/
	        here_bits = here >>> 24;
	        here_op = (here >>> 16) & 0xff;
	        here_val = here & 0xffff;

	        if (here_bits <= bits) { break; }
	        //--- PULLBYTE() ---//
	        if (have === 0) { break inf_leave; }
	        have--;
	        hold += input[next++] << bits;
	        bits += 8;
	        //---//
	      }
	      if (here_op && (here_op & 0xf0) === 0) {
	        last_bits = here_bits;
	        last_op = here_op;
	        last_val = here_val;
	        for (;;) {
	          here = state.lencode[last_val +
	                  ((hold & ((1 << (last_bits + last_op)) -1))/*BITS(last.bits + last.op)*/ >> last_bits)];
	          here_bits = here >>> 24;
	          here_op = (here >>> 16) & 0xff;
	          here_val = here & 0xffff;

	          if ((last_bits + here_bits) <= bits) { break; }
	          //--- PULLBYTE() ---//
	          if (have === 0) { break inf_leave; }
	          have--;
	          hold += input[next++] << bits;
	          bits += 8;
	          //---//
	        }
	        //--- DROPBITS(last.bits) ---//
	        hold >>>= last_bits;
	        bits -= last_bits;
	        //---//
	        state.back += last_bits;
	      }
	      //--- DROPBITS(here.bits) ---//
	      hold >>>= here_bits;
	      bits -= here_bits;
	      //---//
	      state.back += here_bits;
	      state.length = here_val;
	      if (here_op === 0) {
	        //Tracevv((stderr, here.val >= 0x20 && here.val < 0x7f ?
	        //        "inflate:         literal '%c'\n" :
	        //        "inflate:         literal 0x%02x\n", here.val));
	        state.mode = LIT;
	        break;
	      }
	      if (here_op & 32) {
	        //Tracevv((stderr, "inflate:         end of block\n"));
	        state.back = -1;
	        state.mode = TYPE;
	        break;
	      }
	      if (here_op & 64) {
	        strm.msg = 'invalid literal/length code';
	        state.mode = BAD;
	        break;
	      }
	      state.extra = here_op & 15;
	      state.mode = LENEXT;
	      /* falls through */
	    case LENEXT:
	      if (state.extra) {
	        //=== NEEDBITS(state.extra);
	        n = state.extra;
	        while (bits < n) {
	          if (have === 0) { break inf_leave; }
	          have--;
	          hold += input[next++] << bits;
	          bits += 8;
	        }
	        //===//
	        state.length += hold & ((1 << state.extra) -1)/*BITS(state.extra)*/;
	        //--- DROPBITS(state.extra) ---//
	        hold >>>= state.extra;
	        bits -= state.extra;
	        //---//
	        state.back += state.extra;
	      }
	      //Tracevv((stderr, "inflate:         length %u\n", state.length));
	      state.was = state.length;
	      state.mode = DIST;
	      /* falls through */
	    case DIST:
	      for (;;) {
	        here = state.distcode[hold & ((1 << state.distbits) -1)];/*BITS(state.distbits)*/
	        here_bits = here >>> 24;
	        here_op = (here >>> 16) & 0xff;
	        here_val = here & 0xffff;

	        if ((here_bits) <= bits) { break; }
	        //--- PULLBYTE() ---//
	        if (have === 0) { break inf_leave; }
	        have--;
	        hold += input[next++] << bits;
	        bits += 8;
	        //---//
	      }
	      if ((here_op & 0xf0) === 0) {
	        last_bits = here_bits;
	        last_op = here_op;
	        last_val = here_val;
	        for (;;) {
	          here = state.distcode[last_val +
	                  ((hold & ((1 << (last_bits + last_op)) -1))/*BITS(last.bits + last.op)*/ >> last_bits)];
	          here_bits = here >>> 24;
	          here_op = (here >>> 16) & 0xff;
	          here_val = here & 0xffff;

	          if ((last_bits + here_bits) <= bits) { break; }
	          //--- PULLBYTE() ---//
	          if (have === 0) { break inf_leave; }
	          have--;
	          hold += input[next++] << bits;
	          bits += 8;
	          //---//
	        }
	        //--- DROPBITS(last.bits) ---//
	        hold >>>= last_bits;
	        bits -= last_bits;
	        //---//
	        state.back += last_bits;
	      }
	      //--- DROPBITS(here.bits) ---//
	      hold >>>= here_bits;
	      bits -= here_bits;
	      //---//
	      state.back += here_bits;
	      if (here_op & 64) {
	        strm.msg = 'invalid distance code';
	        state.mode = BAD;
	        break;
	      }
	      state.offset = here_val;
	      state.extra = (here_op) & 15;
	      state.mode = DISTEXT;
	      /* falls through */
	    case DISTEXT:
	      if (state.extra) {
	        //=== NEEDBITS(state.extra);
	        n = state.extra;
	        while (bits < n) {
	          if (have === 0) { break inf_leave; }
	          have--;
	          hold += input[next++] << bits;
	          bits += 8;
	        }
	        //===//
	        state.offset += hold & ((1 << state.extra) -1)/*BITS(state.extra)*/;
	        //--- DROPBITS(state.extra) ---//
	        hold >>>= state.extra;
	        bits -= state.extra;
	        //---//
	        state.back += state.extra;
	      }
	//#ifdef INFLATE_STRICT
	      if (state.offset > state.dmax) {
	        strm.msg = 'invalid distance too far back';
	        state.mode = BAD;
	        break;
	      }
	//#endif
	      //Tracevv((stderr, "inflate:         distance %u\n", state.offset));
	      state.mode = MATCH;
	      /* falls through */
	    case MATCH:
	      if (left === 0) { break inf_leave; }
	      copy = _out - left;
	      if (state.offset > copy) {         /* copy from window */
	        copy = state.offset - copy;
	        if (copy > state.whave) {
	          if (state.sane) {
	            strm.msg = 'invalid distance too far back';
	            state.mode = BAD;
	            break;
	          }
	// (!) This block is disabled in zlib defailts,
	// don't enable it for binary compatibility
	//#ifdef INFLATE_ALLOW_INVALID_DISTANCE_TOOFAR_ARRR
	//          Trace((stderr, "inflate.c too far\n"));
	//          copy -= state.whave;
	//          if (copy > state.length) { copy = state.length; }
	//          if (copy > left) { copy = left; }
	//          left -= copy;
	//          state.length -= copy;
	//          do {
	//            output[put++] = 0;
	//          } while (--copy);
	//          if (state.length === 0) { state.mode = LEN; }
	//          break;
	//#endif
	        }
	        if (copy > state.wnext) {
	          copy -= state.wnext;
	          from = state.wsize - copy;
	        }
	        else {
	          from = state.wnext - copy;
	        }
	        if (copy > state.length) { copy = state.length; }
	        from_source = state.window;
	      }
	      else {                              /* copy from output */
	        from_source = output;
	        from = put - state.offset;
	        copy = state.length;
	      }
	      if (copy > left) { copy = left; }
	      left -= copy;
	      state.length -= copy;
	      do {
	        output[put++] = from_source[from++];
	      } while (--copy);
	      if (state.length === 0) { state.mode = LEN; }
	      break;
	    case LIT:
	      if (left === 0) { break inf_leave; }
	      output[put++] = state.length;
	      left--;
	      state.mode = LEN;
	      break;
	    case CHECK:
	      if (state.wrap) {
	        //=== NEEDBITS(32);
	        while (bits < 32) {
	          if (have === 0) { break inf_leave; }
	          have--;
	          // Use '|' insdead of '+' to make sure that result is signed
	          hold |= input[next++] << bits;
	          bits += 8;
	        }
	        //===//
	        _out -= left;
	        strm.total_out += _out;
	        state.total += _out;
	        if (_out) {
	          strm.adler = state.check =
	              /*UPDATE(state.check, put - _out, _out);*/
	              (state.flags ? crc32(state.check, output, _out, put - _out) : adler32(state.check, output, _out, put - _out));

	        }
	        _out = left;
	        // NB: crc32 stored as signed 32-bit int, ZSWAP32 returns signed too
	        if ((state.flags ? hold : ZSWAP32(hold)) !== state.check) {
	          strm.msg = 'incorrect data check';
	          state.mode = BAD;
	          break;
	        }
	        //=== INITBITS();
	        hold = 0;
	        bits = 0;
	        //===//
	        //Tracev((stderr, "inflate:   check matches trailer\n"));
	      }
	      state.mode = LENGTH;
	      /* falls through */
	    case LENGTH:
	      if (state.wrap && state.flags) {
	        //=== NEEDBITS(32);
	        while (bits < 32) {
	          if (have === 0) { break inf_leave; }
	          have--;
	          hold += input[next++] << bits;
	          bits += 8;
	        }
	        //===//
	        if (hold !== (state.total & 0xffffffff)) {
	          strm.msg = 'incorrect length check';
	          state.mode = BAD;
	          break;
	        }
	        //=== INITBITS();
	        hold = 0;
	        bits = 0;
	        //===//
	        //Tracev((stderr, "inflate:   length matches trailer\n"));
	      }
	      state.mode = DONE;
	      /* falls through */
	    case DONE:
	      ret = Z_STREAM_END;
	      break inf_leave;
	    case BAD:
	      ret = Z_DATA_ERROR;
	      break inf_leave;
	    case MEM:
	      return Z_MEM_ERROR;
	    case SYNC:
	      /* falls through */
	    default:
	      return Z_STREAM_ERROR;
	    }
	  }

	  // inf_leave <- here is real place for "goto inf_leave", emulated via "break inf_leave"

	  /*
	     Return from inflate(), updating the total counts and the check value.
	     If there was no progress during the inflate() call, return a buffer
	     error.  Call updatewindow() to create and/or update the window state.
	     Note: a memory error from inflate() is non-recoverable.
	   */

	  //--- RESTORE() ---
	  strm.next_out = put;
	  strm.avail_out = left;
	  strm.next_in = next;
	  strm.avail_in = have;
	  state.hold = hold;
	  state.bits = bits;
	  //---

	  if (state.wsize || (_out !== strm.avail_out && state.mode < BAD &&
	                      (state.mode < CHECK || flush !== Z_FINISH))) {
	    if (updatewindow(strm, strm.output, strm.next_out, _out - strm.avail_out)) {
	      state.mode = MEM;
	      return Z_MEM_ERROR;
	    }
	  }
	  _in -= strm.avail_in;
	  _out -= strm.avail_out;
	  strm.total_in += _in;
	  strm.total_out += _out;
	  state.total += _out;
	  if (state.wrap && _out) {
	    strm.adler = state.check = /*UPDATE(state.check, strm.next_out - _out, _out);*/
	      (state.flags ? crc32(state.check, output, _out, strm.next_out - _out) : adler32(state.check, output, _out, strm.next_out - _out));
	  }
	  strm.data_type = state.bits + (state.last ? 64 : 0) +
	                    (state.mode === TYPE ? 128 : 0) +
	                    (state.mode === LEN_ || state.mode === COPY_ ? 256 : 0);
	  if (((_in === 0 && _out === 0) || flush === Z_FINISH) && ret === Z_OK) {
	    ret = Z_BUF_ERROR;
	  }
	  return ret;
	}

	function inflateEnd(strm) {

	  if (!strm || !strm.state /*|| strm->zfree == (free_func)0*/) {
	    return Z_STREAM_ERROR;
	  }

	  var state = strm.state;
	  if (state.window) {
	    state.window = null;
	  }
	  strm.state = null;
	  return Z_OK;
	}

	function inflateGetHeader(strm, head) {
	  var state;

	  /* check state */
	  if (!strm || !strm.state) { return Z_STREAM_ERROR; }
	  state = strm.state;
	  if ((state.wrap & 2) === 0) { return Z_STREAM_ERROR; }

	  /* save header structure */
	  state.head = head;
	  head.done = false;
	  return Z_OK;
	}


	exports.inflateReset = inflateReset;
	exports.inflateReset2 = inflateReset2;
	exports.inflateResetKeep = inflateResetKeep;
	exports.inflateInit = inflateInit;
	exports.inflateInit2 = inflateInit2;
	exports.inflate = inflate;
	exports.inflateEnd = inflateEnd;
	exports.inflateGetHeader = inflateGetHeader;
	exports.inflateInfo = 'pako inflate (from Nodeca project)';

	/* Not implemented
	exports.inflateCopy = inflateCopy;
	exports.inflateGetDictionary = inflateGetDictionary;
	exports.inflateMark = inflateMark;
	exports.inflatePrime = inflatePrime;
	exports.inflateSetDictionary = inflateSetDictionary;
	exports.inflateSync = inflateSync;
	exports.inflateSyncPoint = inflateSyncPoint;
	exports.inflateUndermine = inflateUndermine;
	*/

/***/ },
/* 19 */
/***/ function(module, exports) {

	'use strict';

	// See state defs from inflate.js
	var BAD = 30;       /* got a data error -- remain here until reset */
	var TYPE = 12;      /* i: waiting for type bits, including last-flag bit */

	/*
	   Decode literal, length, and distance codes and write out the resulting
	   literal and match bytes until either not enough input or output is
	   available, an end-of-block is encountered, or a data error is encountered.
	   When large enough input and output buffers are supplied to inflate(), for
	   example, a 16K input buffer and a 64K output buffer, more than 95% of the
	   inflate execution time is spent in this routine.

	   Entry assumptions:

	        state.mode === LEN
	        strm.avail_in >= 6
	        strm.avail_out >= 258
	        start >= strm.avail_out
	        state.bits < 8

	   On return, state.mode is one of:

	        LEN -- ran out of enough output space or enough available input
	        TYPE -- reached end of block code, inflate() to interpret next block
	        BAD -- error in block data

	   Notes:

	    - The maximum input bits used by a length/distance pair is 15 bits for the
	      length code, 5 bits for the length extra, 15 bits for the distance code,
	      and 13 bits for the distance extra.  This totals 48 bits, or six bytes.
	      Therefore if strm.avail_in >= 6, then there is enough input to avoid
	      checking for available input while decoding.

	    - The maximum bytes that a single length/distance pair can output is 258
	      bytes, which is the maximum length that can be coded.  inflate_fast()
	      requires strm.avail_out >= 258 for each loop to avoid checking for
	      output space.
	 */
	module.exports = function inflate_fast(strm, start) {
	  var state;
	  var _in;                    /* local strm.input */
	  var last;                   /* have enough input while in < last */
	  var _out;                   /* local strm.output */
	  var beg;                    /* inflate()'s initial strm.output */
	  var end;                    /* while out < end, enough space available */
	//#ifdef INFLATE_STRICT
	  var dmax;                   /* maximum distance from zlib header */
	//#endif
	  var wsize;                  /* window size or zero if not using window */
	  var whave;                  /* valid bytes in the window */
	  var wnext;                  /* window write index */
	  var window;                 /* allocated sliding window, if wsize != 0 */
	  var hold;                   /* local strm.hold */
	  var bits;                   /* local strm.bits */
	  var lcode;                  /* local strm.lencode */
	  var dcode;                  /* local strm.distcode */
	  var lmask;                  /* mask for first level of length codes */
	  var dmask;                  /* mask for first level of distance codes */
	  var here;                   /* retrieved table entry */
	  var op;                     /* code bits, operation, extra bits, or */
	                              /*  window position, window bytes to copy */
	  var len;                    /* match length, unused bytes */
	  var dist;                   /* match distance */
	  var from;                   /* where to copy match from */
	  var from_source;


	  var input, output; // JS specific, because we have no pointers

	  /* copy state to local variables */
	  state = strm.state;
	  //here = state.here;
	  _in = strm.next_in;
	  input = strm.input;
	  last = _in + (strm.avail_in - 5);
	  _out = strm.next_out;
	  output = strm.output;
	  beg = _out - (start - strm.avail_out);
	  end = _out + (strm.avail_out - 257);
	//#ifdef INFLATE_STRICT
	  dmax = state.dmax;
	//#endif
	  wsize = state.wsize;
	  whave = state.whave;
	  wnext = state.wnext;
	  window = state.window;
	  hold = state.hold;
	  bits = state.bits;
	  lcode = state.lencode;
	  dcode = state.distcode;
	  lmask = (1 << state.lenbits) - 1;
	  dmask = (1 << state.distbits) - 1;


	  /* decode literals and length/distances until end-of-block or not enough
	     input data or output space */

	  top:
	  do {
	    if (bits < 15) {
	      hold += input[_in++] << bits;
	      bits += 8;
	      hold += input[_in++] << bits;
	      bits += 8;
	    }

	    here = lcode[hold & lmask];

	    dolen:
	    for (;;) { // Goto emulation
	      op = here >>> 24/*here.bits*/;
	      hold >>>= op;
	      bits -= op;
	      op = (here >>> 16) & 0xff/*here.op*/;
	      if (op === 0) {                          /* literal */
	        //Tracevv((stderr, here.val >= 0x20 && here.val < 0x7f ?
	        //        "inflate:         literal '%c'\n" :
	        //        "inflate:         literal 0x%02x\n", here.val));
	        output[_out++] = here & 0xffff/*here.val*/;
	      }
	      else if (op & 16) {                     /* length base */
	        len = here & 0xffff/*here.val*/;
	        op &= 15;                           /* number of extra bits */
	        if (op) {
	          if (bits < op) {
	            hold += input[_in++] << bits;
	            bits += 8;
	          }
	          len += hold & ((1 << op) - 1);
	          hold >>>= op;
	          bits -= op;
	        }
	        //Tracevv((stderr, "inflate:         length %u\n", len));
	        if (bits < 15) {
	          hold += input[_in++] << bits;
	          bits += 8;
	          hold += input[_in++] << bits;
	          bits += 8;
	        }
	        here = dcode[hold & dmask];

	        dodist:
	        for (;;) { // goto emulation
	          op = here >>> 24/*here.bits*/;
	          hold >>>= op;
	          bits -= op;
	          op = (here >>> 16) & 0xff/*here.op*/;

	          if (op & 16) {                      /* distance base */
	            dist = here & 0xffff/*here.val*/;
	            op &= 15;                       /* number of extra bits */
	            if (bits < op) {
	              hold += input[_in++] << bits;
	              bits += 8;
	              if (bits < op) {
	                hold += input[_in++] << bits;
	                bits += 8;
	              }
	            }
	            dist += hold & ((1 << op) - 1);
	//#ifdef INFLATE_STRICT
	            if (dist > dmax) {
	              strm.msg = 'invalid distance too far back';
	              state.mode = BAD;
	              break top;
	            }
	//#endif
	            hold >>>= op;
	            bits -= op;
	            //Tracevv((stderr, "inflate:         distance %u\n", dist));
	            op = _out - beg;                /* max distance in output */
	            if (dist > op) {                /* see if copy from window */
	              op = dist - op;               /* distance back in window */
	              if (op > whave) {
	                if (state.sane) {
	                  strm.msg = 'invalid distance too far back';
	                  state.mode = BAD;
	                  break top;
	                }

	// (!) This block is disabled in zlib defailts,
	// don't enable it for binary compatibility
	//#ifdef INFLATE_ALLOW_INVALID_DISTANCE_TOOFAR_ARRR
	//                if (len <= op - whave) {
	//                  do {
	//                    output[_out++] = 0;
	//                  } while (--len);
	//                  continue top;
	//                }
	//                len -= op - whave;
	//                do {
	//                  output[_out++] = 0;
	//                } while (--op > whave);
	//                if (op === 0) {
	//                  from = _out - dist;
	//                  do {
	//                    output[_out++] = output[from++];
	//                  } while (--len);
	//                  continue top;
	//                }
	//#endif
	              }
	              from = 0; // window index
	              from_source = window;
	              if (wnext === 0) {           /* very common case */
	                from += wsize - op;
	                if (op < len) {         /* some from window */
	                  len -= op;
	                  do {
	                    output[_out++] = window[from++];
	                  } while (--op);
	                  from = _out - dist;  /* rest from output */
	                  from_source = output;
	                }
	              }
	              else if (wnext < op) {      /* wrap around window */
	                from += wsize + wnext - op;
	                op -= wnext;
	                if (op < len) {         /* some from end of window */
	                  len -= op;
	                  do {
	                    output[_out++] = window[from++];
	                  } while (--op);
	                  from = 0;
	                  if (wnext < len) {  /* some from start of window */
	                    op = wnext;
	                    len -= op;
	                    do {
	                      output[_out++] = window[from++];
	                    } while (--op);
	                    from = _out - dist;      /* rest from output */
	                    from_source = output;
	                  }
	                }
	              }
	              else {                      /* contiguous in window */
	                from += wnext - op;
	                if (op < len) {         /* some from window */
	                  len -= op;
	                  do {
	                    output[_out++] = window[from++];
	                  } while (--op);
	                  from = _out - dist;  /* rest from output */
	                  from_source = output;
	                }
	              }
	              while (len > 2) {
	                output[_out++] = from_source[from++];
	                output[_out++] = from_source[from++];
	                output[_out++] = from_source[from++];
	                len -= 3;
	              }
	              if (len) {
	                output[_out++] = from_source[from++];
	                if (len > 1) {
	                  output[_out++] = from_source[from++];
	                }
	              }
	            }
	            else {
	              from = _out - dist;          /* copy direct from output */
	              do {                        /* minimum length is three */
	                output[_out++] = output[from++];
	                output[_out++] = output[from++];
	                output[_out++] = output[from++];
	                len -= 3;
	              } while (len > 2);
	              if (len) {
	                output[_out++] = output[from++];
	                if (len > 1) {
	                  output[_out++] = output[from++];
	                }
	              }
	            }
	          }
	          else if ((op & 64) === 0) {          /* 2nd level distance code */
	            here = dcode[(here & 0xffff)/*here.val*/ + (hold & ((1 << op) - 1))];
	            continue dodist;
	          }
	          else {
	            strm.msg = 'invalid distance code';
	            state.mode = BAD;
	            break top;
	          }

	          break; // need to emulate goto via "continue"
	        }
	      }
	      else if ((op & 64) === 0) {              /* 2nd level length code */
	        here = lcode[(here & 0xffff)/*here.val*/ + (hold & ((1 << op) - 1))];
	        continue dolen;
	      }
	      else if (op & 32) {                     /* end-of-block */
	        //Tracevv((stderr, "inflate:         end of block\n"));
	        state.mode = TYPE;
	        break top;
	      }
	      else {
	        strm.msg = 'invalid literal/length code';
	        state.mode = BAD;
	        break top;
	      }

	      break; // need to emulate goto via "continue"
	    }
	  } while (_in < last && _out < end);

	  /* return unused bytes (on entry, bits < 8, so in won't go too far back) */
	  len = bits >> 3;
	  _in -= len;
	  bits -= len << 3;
	  hold &= (1 << bits) - 1;

	  /* update state and return */
	  strm.next_in = _in;
	  strm.next_out = _out;
	  strm.avail_in = (_in < last ? 5 + (last - _in) : 5 - (_in - last));
	  strm.avail_out = (_out < end ? 257 + (end - _out) : 257 - (_out - end));
	  state.hold = hold;
	  state.bits = bits;
	  return;
	};


/***/ },
/* 20 */
/***/ function(module, exports, __webpack_require__) {

	'use strict';


	var utils = __webpack_require__(8);

	var MAXBITS = 15;
	var ENOUGH_LENS = 852;
	var ENOUGH_DISTS = 592;
	//var ENOUGH = (ENOUGH_LENS+ENOUGH_DISTS);

	var CODES = 0;
	var LENS = 1;
	var DISTS = 2;

	var lbase = [ /* Length codes 257..285 base */
	  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31,
	  35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258, 0, 0
	];

	var lext = [ /* Length codes 257..285 extra */
	  16, 16, 16, 16, 16, 16, 16, 16, 17, 17, 17, 17, 18, 18, 18, 18,
	  19, 19, 19, 19, 20, 20, 20, 20, 21, 21, 21, 21, 16, 72, 78
	];

	var dbase = [ /* Distance codes 0..29 base */
	  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193,
	  257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145,
	  8193, 12289, 16385, 24577, 0, 0
	];

	var dext = [ /* Distance codes 0..29 extra */
	  16, 16, 16, 16, 17, 17, 18, 18, 19, 19, 20, 20, 21, 21, 22, 22,
	  23, 23, 24, 24, 25, 25, 26, 26, 27, 27,
	  28, 28, 29, 29, 64, 64
	];

	module.exports = function inflate_table(type, lens, lens_index, codes, table, table_index, work, opts)
	{
	  var bits = opts.bits;
	      //here = opts.here; /* table entry for duplication */

	  var len = 0;               /* a code's length in bits */
	  var sym = 0;               /* index of code symbols */
	  var min = 0, max = 0;          /* minimum and maximum code lengths */
	  var root = 0;              /* number of index bits for root table */
	  var curr = 0;              /* number of index bits for current table */
	  var drop = 0;              /* code bits to drop for sub-table */
	  var left = 0;                   /* number of prefix codes available */
	  var used = 0;              /* code entries in table used */
	  var huff = 0;              /* Huffman code */
	  var incr;              /* for incrementing code, index */
	  var fill;              /* index for replicating entries */
	  var low;               /* low bits for current root entry */
	  var mask;              /* mask for low root bits */
	  var next;             /* next available space in table */
	  var base = null;     /* base value table to use */
	  var base_index = 0;
	//  var shoextra;    /* extra bits table to use */
	  var end;                    /* use base and extra for symbol > end */
	  var count = new utils.Buf16(MAXBITS+1); //[MAXBITS+1];    /* number of codes of each length */
	  var offs = new utils.Buf16(MAXBITS+1); //[MAXBITS+1];     /* offsets in table for each length */
	  var extra = null;
	  var extra_index = 0;

	  var here_bits, here_op, here_val;

	  /*
	   Process a set of code lengths to create a canonical Huffman code.  The
	   code lengths are lens[0..codes-1].  Each length corresponds to the
	   symbols 0..codes-1.  The Huffman code is generated by first sorting the
	   symbols by length from short to long, and retaining the symbol order
	   for codes with equal lengths.  Then the code starts with all zero bits
	   for the first code of the shortest length, and the codes are integer
	   increments for the same length, and zeros are appended as the length
	   increases.  For the deflate format, these bits are stored backwards
	   from their more natural integer increment ordering, and so when the
	   decoding tables are built in the large loop below, the integer codes
	   are incremented backwards.

	   This routine assumes, but does not check, that all of the entries in
	   lens[] are in the range 0..MAXBITS.  The caller must assure this.
	   1..MAXBITS is interpreted as that code length.  zero means that that
	   symbol does not occur in this code.

	   The codes are sorted by computing a count of codes for each length,
	   creating from that a table of starting indices for each length in the
	   sorted table, and then entering the symbols in order in the sorted
	   table.  The sorted table is work[], with that space being provided by
	   the caller.

	   The length counts are used for other purposes as well, i.e. finding
	   the minimum and maximum length codes, determining if there are any
	   codes at all, checking for a valid set of lengths, and looking ahead
	   at length counts to determine sub-table sizes when building the
	   decoding tables.
	   */

	  /* accumulate lengths for codes (assumes lens[] all in 0..MAXBITS) */
	  for (len = 0; len <= MAXBITS; len++) {
	    count[len] = 0;
	  }
	  for (sym = 0; sym < codes; sym++) {
	    count[lens[lens_index + sym]]++;
	  }

	  /* bound code lengths, force root to be within code lengths */
	  root = bits;
	  for (max = MAXBITS; max >= 1; max--) {
	    if (count[max] !== 0) { break; }
	  }
	  if (root > max) {
	    root = max;
	  }
	  if (max === 0) {                     /* no symbols to code at all */
	    //table.op[opts.table_index] = 64;  //here.op = (var char)64;    /* invalid code marker */
	    //table.bits[opts.table_index] = 1;   //here.bits = (var char)1;
	    //table.val[opts.table_index++] = 0;   //here.val = (var short)0;
	    table[table_index++] = (1 << 24) | (64 << 16) | 0;


	    //table.op[opts.table_index] = 64;
	    //table.bits[opts.table_index] = 1;
	    //table.val[opts.table_index++] = 0;
	    table[table_index++] = (1 << 24) | (64 << 16) | 0;

	    opts.bits = 1;
	    return 0;     /* no symbols, but wait for decoding to report error */
	  }
	  for (min = 1; min < max; min++) {
	    if (count[min] !== 0) { break; }
	  }
	  if (root < min) {
	    root = min;
	  }

	  /* check for an over-subscribed or incomplete set of lengths */
	  left = 1;
	  for (len = 1; len <= MAXBITS; len++) {
	    left <<= 1;
	    left -= count[len];
	    if (left < 0) {
	      return -1;
	    }        /* over-subscribed */
	  }
	  if (left > 0 && (type === CODES || max !== 1)) {
	    return -1;                      /* incomplete set */
	  }

	  /* generate offsets into symbol table for each length for sorting */
	  offs[1] = 0;
	  for (len = 1; len < MAXBITS; len++) {
	    offs[len + 1] = offs[len] + count[len];
	  }

	  /* sort symbols by length, by symbol order within each length */
	  for (sym = 0; sym < codes; sym++) {
	    if (lens[lens_index + sym] !== 0) {
	      work[offs[lens[lens_index + sym]]++] = sym;
	    }
	  }

	  /*
	   Create and fill in decoding tables.  In this loop, the table being
	   filled is at next and has curr index bits.  The code being used is huff
	   with length len.  That code is converted to an index by dropping drop
	   bits off of the bottom.  For codes where len is less than drop + curr,
	   those top drop + curr - len bits are incremented through all values to
	   fill the table with replicated entries.

	   root is the number of index bits for the root table.  When len exceeds
	   root, sub-tables are created pointed to by the root entry with an index
	   of the low root bits of huff.  This is saved in low to check for when a
	   new sub-table should be started.  drop is zero when the root table is
	   being filled, and drop is root when sub-tables are being filled.

	   When a new sub-table is needed, it is necessary to look ahead in the
	   code lengths to determine what size sub-table is needed.  The length
	   counts are used for this, and so count[] is decremented as codes are
	   entered in the tables.

	   used keeps track of how many table entries have been allocated from the
	   provided *table space.  It is checked for LENS and DIST tables against
	   the constants ENOUGH_LENS and ENOUGH_DISTS to guard against changes in
	   the initial root table size constants.  See the comments in inftrees.h
	   for more information.

	   sym increments through all symbols, and the loop terminates when
	   all codes of length max, i.e. all codes, have been processed.  This
	   routine permits incomplete codes, so another loop after this one fills
	   in the rest of the decoding tables with invalid code markers.
	   */

	  /* set up for code type */
	  // poor man optimization - use if-else instead of switch,
	  // to avoid deopts in old v8
	  if (type === CODES) {
	      base = extra = work;    /* dummy value--not used */
	      end = 19;
	  } else if (type === LENS) {
	      base = lbase;
	      base_index -= 257;
	      extra = lext;
	      extra_index -= 257;
	      end = 256;
	  } else {                    /* DISTS */
	      base = dbase;
	      extra = dext;
	      end = -1;
	  }

	  /* initialize opts for loop */
	  huff = 0;                   /* starting code */
	  sym = 0;                    /* starting code symbol */
	  len = min;                  /* starting code length */
	  next = table_index;              /* current table to fill in */
	  curr = root;                /* current table index bits */
	  drop = 0;                   /* current bits to drop from code for index */
	  low = -1;                   /* trigger new sub-table when len > root */
	  used = 1 << root;          /* use root table entries */
	  mask = used - 1;            /* mask for comparing low */

	  /* check available table space */
	  if ((type === LENS && used > ENOUGH_LENS) ||
	    (type === DISTS && used > ENOUGH_DISTS)) {
	    return 1;
	  }

	  var i=0;
	  /* process all codes and make table entries */
	  for (;;) {
	    i++;
	    /* create table entry */
	    here_bits = len - drop;
	    if (work[sym] < end) {
	      here_op = 0;
	      here_val = work[sym];
	    }
	    else if (work[sym] > end) {
	      here_op = extra[extra_index + work[sym]];
	      here_val = base[base_index + work[sym]];
	    }
	    else {
	      here_op = 32 + 64;         /* end of block */
	      here_val = 0;
	    }

	    /* replicate for those indices with low len bits equal to huff */
	    incr = 1 << (len - drop);
	    fill = 1 << curr;
	    min = fill;                 /* save offset to next table */
	    do {
	      fill -= incr;
	      table[next + (huff >> drop) + fill] = (here_bits << 24) | (here_op << 16) | here_val |0;
	    } while (fill !== 0);

	    /* backwards increment the len-bit code huff */
	    incr = 1 << (len - 1);
	    while (huff & incr) {
	      incr >>= 1;
	    }
	    if (incr !== 0) {
	      huff &= incr - 1;
	      huff += incr;
	    } else {
	      huff = 0;
	    }

	    /* go to next symbol, update count, len */
	    sym++;
	    if (--count[len] === 0) {
	      if (len === max) { break; }
	      len = lens[lens_index + work[sym]];
	    }

	    /* create new sub-table if needed */
	    if (len > root && (huff & mask) !== low) {
	      /* if first time, transition to sub-tables */
	      if (drop === 0) {
	        drop = root;
	      }

	      /* increment past last table */
	      next += min;            /* here min is 1 << curr */

	      /* determine length of next table */
	      curr = len - drop;
	      left = 1 << curr;
	      while (curr + drop < max) {
	        left -= count[curr + drop];
	        if (left <= 0) { break; }
	        curr++;
	        left <<= 1;
	      }

	      /* check for enough space */
	      used += 1 << curr;
	      if ((type === LENS && used > ENOUGH_LENS) ||
	        (type === DISTS && used > ENOUGH_DISTS)) {
	        return 1;
	      }

	      /* point entry in root table to sub-table */
	      low = huff & mask;
	      /*table.op[low] = curr;
	      table.bits[low] = root;
	      table.val[low] = next - opts.table_index;*/
	      table[low] = (root << 24) | (curr << 16) | (next - table_index) |0;
	    }
	  }

	  /* fill in remaining table entry if code is incomplete (guaranteed to have
	   at most one remaining entry, since if the code is incomplete, the
	   maximum code length that was allowed to get this far is one bit) */
	  if (huff !== 0) {
	    //table.op[next + huff] = 64;            /* invalid code marker */
	    //table.bits[next + huff] = len - drop;
	    //table.val[next + huff] = 0;
	    table[next + huff] = ((len - drop) << 24) | (64 << 16) |0;
	  }

	  /* set return parameters */
	  //opts.table_index += used;
	  opts.bits = root;
	  return 0;
	};


/***/ },
/* 21 */
/***/ function(module, exports) {

	module.exports = {

	  /* Allowed flush values; see deflate() and inflate() below for details */
	  Z_NO_FLUSH:         0,
	  Z_PARTIAL_FLUSH:    1,
	  Z_SYNC_FLUSH:       2,
	  Z_FULL_FLUSH:       3,
	  Z_FINISH:           4,
	  Z_BLOCK:            5,
	  Z_TREES:            6,

	  /* Return codes for the compression/decompression functions. Negative values
	  * are errors, positive values are used for special but normal events.
	  */
	  Z_OK:               0,
	  Z_STREAM_END:       1,
	  Z_NEED_DICT:        2,
	  Z_ERRNO:           -1,
	  Z_STREAM_ERROR:    -2,
	  Z_DATA_ERROR:      -3,
	  //Z_MEM_ERROR:     -4,
	  Z_BUF_ERROR:       -5,
	  //Z_VERSION_ERROR: -6,

	  /* compression levels */
	  Z_NO_COMPRESSION:         0,
	  Z_BEST_SPEED:             1,
	  Z_BEST_COMPRESSION:       9,
	  Z_DEFAULT_COMPRESSION:   -1,


	  Z_FILTERED:               1,
	  Z_HUFFMAN_ONLY:           2,
	  Z_RLE:                    3,
	  Z_FIXED:                  4,
	  Z_DEFAULT_STRATEGY:       0,

	  /* Possible values of the data_type field (though see inflate()) */
	  Z_BINARY:                 0,
	  Z_TEXT:                   1,
	  //Z_ASCII:                1, // = Z_TEXT (deprecated)
	  Z_UNKNOWN:                2,

	  /* The deflate compression method */
	  Z_DEFLATED:               8
	  //Z_NULL:                 null // Use -1 or null inline, depending on var type
	};

/***/ },
/* 22 */
/***/ function(module, exports) {

	'use strict';


	function GZheader() {
	  /* true if compressed data believed to be text */
	  this.text       = 0;
	  /* modification time */
	  this.time       = 0;
	  /* extra flags (not used when writing a gzip file) */
	  this.xflags     = 0;
	  /* operating system */
	  this.os         = 0;
	  /* pointer to extra field or Z_NULL if none */
	  this.extra      = null;
	  /* extra field length (valid if extra != Z_NULL) */
	  this.extra_len  = 0; // Actually, we don't need it in JS,
	                       // but leave for few code modifications

	  //
	  // Setup limits is not necessary because in js we should not preallocate memory 
	  // for inflate use constant limit in 65536 bytes
	  //

	  /* space at extra (only when reading header) */
	  // this.extra_max  = 0;
	  /* pointer to zero-terminated file name or Z_NULL */
	  this.name       = '';
	  /* space at name (only when reading header) */
	  // this.name_max   = 0;
	  /* pointer to zero-terminated comment or Z_NULL */
	  this.comment    = '';
	  /* space at comment (only when reading header) */
	  // this.comm_max   = 0;
	  /* true if there was or will be a header crc */
	  this.hcrc       = 0;
	  /* true when done reading gzip header (not used when writing a gzip file) */
	  this.done       = false;
	}

	module.exports = GZheader;

/***/ },
/* 23 */
/***/ function(module, exports) {

	/*
	 * Websock: high-performance binary WebSockets
	 * Copyright (C) 2012 Joel Martin
	 * Licensed under MPL 2.0 (see LICENSE.txt)
	 *
	 * Websock is similar to the standard WebSocket object but Websock
	 * enables communication with raw TCP sockets (i.e. the binary stream)
	 * via websockify. This is accomplished by base64 encoding the data
	 * stream between Websock and websockify.
	 *
	 * Websock has built-in receive queue buffering; the message event
	 * does not contain actual data but is simply a notification that
	 * there is new data available. Several rQ* methods are available to
	 * read binary data off of the receive queue.
	 */

	/*jslint browser: true, bitwise: true */
	/*global Util*/


	// Load Flash WebSocket emulator if needed

	// To force WebSocket emulator even when native WebSocket available
	//window.WEB_SOCKET_FORCE_FLASH = true;
	// To enable WebSocket emulator debug:
	//window.WEB_SOCKET_DEBUG=1;

	if (window.WebSocket && !window.WEB_SOCKET_FORCE_FLASH) {
	    Websock_native = true;
	} else if (window.MozWebSocket && !window.WEB_SOCKET_FORCE_FLASH) {
	    Websock_native = true;
	    window.WebSocket = window.MozWebSocket;
	} else {
	    /* no builtin WebSocket so load web_socket.js */

	    Websock_native = false;
	}

	function Websock() {
	    "use strict";

	    this._websocket = null;  // WebSocket object

	    this._rQi = 0;           // Receive queue index
	    this._rQlen = 0;         // Next write position in the receive queue
	    this._rQbufferSize = 1024 * 1024 * 4; // Receive queue buffer size (4 MiB)
	    this._rQmax = this._rQbufferSize / 8;
	    // called in init: this._rQ = new Uint8Array(this._rQbufferSize);
	    this._rQ = null; // Receive queue

	    this._sQbufferSize = 1024 * 10;  // 10 KiB
	    // called in init: this._sQ = new Uint8Array(this._sQbufferSize);
	    this._sQlen = 0;
	    this._sQ = null;  // Send queue

	    this._mode = 'binary';    // Current WebSocket mode: 'binary', 'base64'
	    this.maxBufferedAmount = 200;

	    this._eventHandlers = {
	        'message': function () {},
	        'open': function () {},
	        'close': function () {},
	        'error': function () {}
	    };
	}

	(function () {
	    "use strict";
	    // this has performance issues in some versions Chromium, and
	    // doesn't gain a tremendous amount of performance increase in Firefox
	    // at the moment.  It may be valuable to turn it on in the future.
	    var ENABLE_COPYWITHIN = false;

	    var MAX_RQ_GROW_SIZE = 40 * 1024 * 1024;  // 40 MiB

	    var typedArrayToString = (function () {
	        // This is only for PhantomJS, which doesn't like apply-ing
	        // with Typed Arrays
	        try {
	            var arr = new Uint8Array([1, 2, 3]);
	            String.fromCharCode.apply(null, arr);
	            return function (a) { return String.fromCharCode.apply(null, a); };
	        } catch (ex) {
	            return function (a) {
	                return String.fromCharCode.apply(
	                    null, Array.prototype.slice.call(a));
	            };
	        }
	    })();

	    Websock.prototype = {
	        // Getters and Setters
	        get_sQ: function () {
	            return this._sQ;
	        },

	        get_rQ: function () {
	            return this._rQ;
	        },

	        get_rQi: function () {
	            return this._rQi;
	        },

	        set_rQi: function (val) {
	            this._rQi = val;
	        },

	        // Receive Queue
	        rQlen: function () {
	            return this._rQlen - this._rQi;
	        },

	        rQpeek8: function () {
	            return this._rQ[this._rQi];
	        },

	        rQshift8: function () {
	            return this._rQ[this._rQi++];
	        },

	        rQskip8: function () {
	            this._rQi++;
	        },

	        rQskipBytes: function (num) {
	            this._rQi += num;
	        },

	        // TODO(directxman12): test performance with these vs a DataView
	        rQshift16: function () {
	            return (this._rQ[this._rQi++] << 8) +
	                   this._rQ[this._rQi++];
	        },

	        rQshift32: function () {
	            return (this._rQ[this._rQi++] << 24) +
	                   (this._rQ[this._rQi++] << 16) +
	                   (this._rQ[this._rQi++] << 8) +
	                   this._rQ[this._rQi++];
	        },

	        rQshiftStr: function (len) {
	            if (typeof(len) === 'undefined') { len = this.rQlen(); }
	            var arr = new Uint8Array(this._rQ.buffer, this._rQi, len);
	            this._rQi += len;
	            return typedArrayToString(arr);
	        },

	        rQshiftBytes: function (len) {
	            if (typeof(len) === 'undefined') { len = this.rQlen(); }
	            this._rQi += len;
	            return new Uint8Array(this._rQ.buffer, this._rQi - len, len);
	        },

	        rQshiftTo: function (target, len) {
	            if (len === undefined) { len = this.rQlen(); }
	            // TODO: make this just use set with views when using a ArrayBuffer to store the rQ
	            target.set(new Uint8Array(this._rQ.buffer, this._rQi, len));
	            this._rQi += len;
	        },

	        rQwhole: function () {
	            return new Uint8Array(this._rQ.buffer, 0, this._rQlen);
	        },

	        rQslice: function (start, end) {
	            if (end) {
	                return new Uint8Array(this._rQ.buffer, this._rQi + start, end - start);
	            } else {
	                return new Uint8Array(this._rQ.buffer, this._rQi + start, this._rQlen - this._rQi - start);
	            }
	        },

	        // Check to see if we must wait for 'num' bytes (default to FBU.bytes)
	        // to be available in the receive queue. Return true if we need to
	        // wait (and possibly print a debug message), otherwise false.
	        rQwait: function (msg, num, goback) {
	            var rQlen = this._rQlen - this._rQi; // Skip rQlen() function call
	            if (rQlen < num) {
	                if (goback) {
	                    if (this._rQi < goback) {
	                        throw new Error("rQwait cannot backup " + goback + " bytes");
	                    }
	                    this._rQi -= goback;
	                }
	                return true; // true means need more data
	            }
	            return false;
	        },

	        // Send Queue

	        flush: function () {
	            if (this._websocket.bufferedAmount !== 0) {
	                Util.Debug("bufferedAmount: " + this._websocket.bufferedAmount);
	            }

	            if (this._websocket.bufferedAmount < this.maxBufferedAmount) {
	                if (this._sQlen > 0 && this._websocket.readyState === WebSocket.OPEN) {
	                    this._websocket.send(this._encode_message());
	                    this._sQlen = 0;
	                }

	                return true;
	            } else {
	                Util.Info("Delaying send, bufferedAmount: " +
	                        this._websocket.bufferedAmount);
	                return false;
	            }
	        },

	        send: function (arr) {
	            this._sQ.set(arr, this._sQlen);
	            this._sQlen += arr.length;
	            return this.flush();
	        },

	        send_string: function (str) {
	            this.send(str.split('').map(function (chr) {
	                return chr.charCodeAt(0);
	            }));
	        },

	        // Event Handlers
	        off: function (evt) {
	            this._eventHandlers[evt] = function () {};
	        },

	        on: function (evt, handler) {
	            this._eventHandlers[evt] = handler;
	        },

	        _allocate_buffers: function () {
	            this._rQ = new Uint8Array(this._rQbufferSize);
	            this._sQ = new Uint8Array(this._sQbufferSize);
	        },

	        init: function (protocols, ws_schema) {
	            this._allocate_buffers();
	            this._rQi = 0;
	            this._websocket = null;

	            // Check for full typed array support
	            var bt = false;
	            if (('Uint8Array' in window) &&
	                    ('set' in Uint8Array.prototype)) {
	                bt = true;
	            }

	            // Check for full binary type support in WebSockets
	            // Inspired by:
	            // https://github.com/Modernizr/Modernizr/issues/370
	            // https://github.com/Modernizr/Modernizr/blob/master/feature-detects/websockets/binary.js
	            var wsbt = false;
	            try {
	                if (bt && ('binaryType' in WebSocket.prototype ||
	                           !!(new WebSocket(ws_schema + '://.').binaryType))) {
	                    Util.Info("Detected binaryType support in WebSockets");
	                    wsbt = true;
	                }
	            } catch (exc) {
	                // Just ignore failed test localhost connection
	            }

	            // Default protocols if not specified
	            if (typeof(protocols) === "undefined") {
	                protocols = 'binary';
	            }

	            if (Array.isArray(protocols) && protocols.indexOf('binary') > -1) {
	                protocols = 'binary';
	            }

	            if (!wsbt) {
	                throw new Error("noVNC no longer supports base64 WebSockets.  " +
	                                "Please use a browser which supports binary WebSockets.");
	            }

	            if (protocols != 'binary') {
	                throw new Error("noVNC no longer supports base64 WebSockets.  Please " +
	                                "use the binary subprotocol instead.");
	            }

	            return protocols;
	        },

	        open: function (uri, protocols) {
	            var ws_schema = uri.match(/^([a-z]+):\/\//)[1];
	            protocols = this.init(protocols, ws_schema);

	            this._websocket = new WebSocket(uri, protocols);

	            if (protocols.indexOf('binary') >= 0) {
	                this._websocket.binaryType = 'arraybuffer';
	            }

	            this._websocket.onmessage = this._recv_message.bind(this);
	            this._websocket.onopen = (function () {
	                Util.Debug('>> WebSock.onopen');
	                if (this._websocket.protocol) {
	                    this._mode = this._websocket.protocol;
	                    Util.Info("Server choose sub-protocol: " + this._websocket.protocol);
	                } else {
	                    this._mode = 'binary';
	                    Util.Error('Server select no sub-protocol!: ' + this._websocket.protocol);
	                }

	                if (this._mode != 'binary') {
	                    throw new Error("noVNC no longer supports base64 WebSockets.  Please " +
	                                    "use the binary subprotocol instead.");

	                }

	                this._eventHandlers.open();
	                Util.Debug("<< WebSock.onopen");
	            }).bind(this);
	            this._websocket.onclose = (function (e) {
	                Util.Debug(">> WebSock.onclose");
	                this._eventHandlers.close(e);
	                Util.Debug("<< WebSock.onclose");
	            }).bind(this);
	            this._websocket.onerror = (function (e) {
	                Util.Debug(">> WebSock.onerror: " + e);
	                this._eventHandlers.error(e);
	                Util.Debug("<< WebSock.onerror: " + e);
	            }).bind(this);
	        },

	        close: function () {
	            if (this._websocket) {
	                if ((this._websocket.readyState === WebSocket.OPEN) ||
	                        (this._websocket.readyState === WebSocket.CONNECTING)) {
	                    Util.Info("Closing WebSocket connection");
	                    this._websocket.close();
	                }

	                this._websocket.onmessage = function (e) { return; };
	            }
	        },

	        // private methods
	        _encode_message: function () {
	            // Put in a binary arraybuffer
	            // according to the spec, you can send ArrayBufferViews with the send method
	            return new Uint8Array(this._sQ.buffer, 0, this._sQlen);
	        },

	        _expand_compact_rQ: function (min_fit) {
	            var resizeNeeded = min_fit || this._rQlen - this._rQi > this._rQbufferSize / 2;
	            if (resizeNeeded) {
	                if (!min_fit) {
	                    // just double the size if we need to do compaction
	                    this._rQbufferSize *= 2;
	                } else {
	                    // otherwise, make sure we satisy rQlen - rQi + min_fit < rQbufferSize / 8
	                    this._rQbufferSize = (this._rQlen - this._rQi + min_fit) * 8;
	                }
	            }

	            // we don't want to grow unboundedly
	            if (this._rQbufferSize > MAX_RQ_GROW_SIZE) {
	                this._rQbufferSize = MAX_RQ_GROW_SIZE;
	                if (this._rQbufferSize - this._rQlen - this._rQi < min_fit) {
	                    throw new Exception("Receive Queue buffer exceeded " + MAX_RQ_GROW_SIZE + " bytes, and the new message could not fit");
	                }
	            }

	            if (resizeNeeded) {
	                var old_rQbuffer = this._rQ.buffer;
	                this._rQmax = this._rQbufferSize / 8;
	                this._rQ = new Uint8Array(this._rQbufferSize);
	                this._rQ.set(new Uint8Array(old_rQbuffer, this._rQi));
	            } else {
	                if (ENABLE_COPYWITHIN) {
	                    this._rQ.copyWithin(0, this._rQi);
	                } else {
	                    this._rQ.set(new Uint8Array(this._rQ.buffer, this._rQi));
	                }
	            }

	            this._rQlen = this._rQlen - this._rQi;
	            this._rQi = 0;
	        },

	        _decode_message: function (data) {
	            // push arraybuffer values onto the end
	            var u8 = new Uint8Array(data);
	            if (u8.length > this._rQbufferSize - this._rQlen) {
	                this._expand_compact_rQ(u8.length);
	            }
	            this._rQ.set(u8, this._rQlen);
	            this._rQlen += u8.length;
	        },

	        _recv_message: function (e) {
	            try {
	                this._decode_message(e.data);
	                if (this.rQlen() > 0) {
	                    this._eventHandlers.message();
	                    // Compact the receive queue
	                    if (this._rQlen == this._rQi) {
	                        this._rQlen = 0;
	                        this._rQi = 0;
	                    } else if (this._rQlen > this._rQmax) {
	                        this._expand_compact_rQ();
	                    }
	                } else {
	                    Util.Debug("Ignoring empty message");
	                }
	            } catch (exc) {
	                var exception_str = "";
	                if (exc.name) {
	                    exception_str += "\n    name: " + exc.name + "\n";
	                    exception_str += "    message: " + exc.message + "\n";
	                }

	                if (typeof exc.description !== 'undefined') {
	                    exception_str += "    description: " + exc.description + "\n";
	                }

	                if (typeof exc.stack !== 'undefined') {
	                    exception_str += exc.stack;
	                }

	                if (exception_str.length > 0) {
	                    Util.Error("recv_message, caught exception: " + exception_str);
	                } else {
	                    Util.Error("recv_message, caught exception: " + exc);
	                }

	                if (typeof exc.name !== 'undefined') {
	                    this._eventHandlers.error(exc.name + ": " + exc.message);
	                } else {
	                    this._eventHandlers.error(exc);
	                }
	            }
	        }
	    };
	})();

	module.exports = { Websock_native: Websock_native, Websock: Websock }


/***/ },
/* 24 */
/***/ function(module, exports) {

	/* This Source Code Form is subject to the terms of the Mozilla Public
	 * License, v. 2.0. If a copy of the MPL was not distributed with this
	 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

	// From: http://hg.mozilla.org/mozilla-central/raw-file/ec10630b1a54/js/src/devtools/jint/sunspider/string-base64.js

	/*jslint white: false */
	/*global console */

	var Base64 = {
	    /* Convert data (an array of integers) to a Base64 string. */
	    toBase64Table : 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/='.split(''),
	    base64Pad     : '=',

	    encode: function (data) {
	        "use strict";
	        var result = '';
	        var toBase64Table = Base64.toBase64Table;
	        var length = data.length;
	        var lengthpad = (length % 3);
	        // Convert every three bytes to 4 ascii characters.

	        for (var i = 0; i < (length - 2); i += 3) {
	            result += toBase64Table[data[i] >> 2];
	            result += toBase64Table[((data[i] & 0x03) << 4) + (data[i + 1] >> 4)];
	            result += toBase64Table[((data[i + 1] & 0x0f) << 2) + (data[i + 2] >> 6)];
	            result += toBase64Table[data[i + 2] & 0x3f];
	        }

	        // Convert the remaining 1 or 2 bytes, pad out to 4 characters.
	        var j = 0;
	        if (lengthpad === 2) {
	            j = length - lengthpad;
	            result += toBase64Table[data[j] >> 2];
	            result += toBase64Table[((data[j] & 0x03) << 4) + (data[j + 1] >> 4)];
	            result += toBase64Table[(data[j + 1] & 0x0f) << 2];
	            result += toBase64Table[64];
	        } else if (lengthpad === 1) {
	            j = length - lengthpad;
	            result += toBase64Table[data[j] >> 2];
	            result += toBase64Table[(data[j] & 0x03) << 4];
	            result += toBase64Table[64];
	            result += toBase64Table[64];
	        }

	        return result;
	    },

	    /* Convert Base64 data to a string */
	    /* jshint -W013 */
	    toBinaryTable : [
	        -1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1,
	        -1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1,
	        -1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,62, -1,-1,-1,63,
	        52,53,54,55, 56,57,58,59, 60,61,-1,-1, -1, 0,-1,-1,
	        -1, 0, 1, 2,  3, 4, 5, 6,  7, 8, 9,10, 11,12,13,14,
	        15,16,17,18, 19,20,21,22, 23,24,25,-1, -1,-1,-1,-1,
	        -1,26,27,28, 29,30,31,32, 33,34,35,36, 37,38,39,40,
	        41,42,43,44, 45,46,47,48, 49,50,51,-1, -1,-1,-1,-1
	    ],
	    /* jshint +W013 */

	    decode: function (data, offset) {
	        "use strict";
	        offset = typeof(offset) !== 'undefined' ? offset : 0;
	        var toBinaryTable = Base64.toBinaryTable;
	        var base64Pad = Base64.base64Pad;
	        var result, result_length;
	        var leftbits = 0; // number of bits decoded, but yet to be appended
	        var leftdata = 0; // bits decoded, but yet to be appended
	        var data_length = data.indexOf('=') - offset;

	        if (data_length < 0) { data_length = data.length - offset; }

	        /* Every four characters is 3 resulting numbers */
	        result_length = (data_length >> 2) * 3 + Math.floor((data_length % 4) / 1.5);
	        result = new Array(result_length);

	        // Convert one by one.
	        for (var idx = 0, i = offset; i < data.length; i++) {
	            var c = toBinaryTable[data.charCodeAt(i) & 0x7f];
	            var padding = (data.charAt(i) === base64Pad);
	            // Skip illegal characters and whitespace
	            if (c === -1) {
	                console.error("Illegal character code " + data.charCodeAt(i) + " at position " + i);
	                continue;
	            }
	          
	            // Collect data into leftdata, update bitcount
	            leftdata = (leftdata << 6) | c;
	            leftbits += 6;

	            // If we have 8 or more bits, append 8 bits to the result
	            if (leftbits >= 8) {
	                leftbits -= 8;
	                // Append if not padding.
	                if (!padding) {
	                    result[idx++] = (leftdata >> leftbits) & 0xff;
	                }
	                leftdata &= (1 << leftbits) - 1;
	            }
	        }

	        // If there are any bits left, the base64 string was corrupted
	        if (leftbits) {
	            err = new Error('Corrupted base64 string');
	            err.name = 'Base64-Error';
	            throw err;
	        }

	        return result;
	    }
	}; /* End of Base64 namespace */

	module.exports - Base64;


/***/ },
/* 25 */
/***/ function(module, exports) {

	/*
	 * Ported from Flashlight VNC ActionScript implementation:
	 *     http://www.wizhelp.com/flashlight-vnc/
	 *
	 * Full attribution follows:
	 *
	 * -------------------------------------------------------------------------
	 *
	 * This DES class has been extracted from package Acme.Crypto for use in VNC.
	 * The unnecessary odd parity code has been removed.
	 *
	 * These changes are:
	 *  Copyright (C) 1999 AT&T Laboratories Cambridge.  All Rights Reserved.
	 *
	 * This software is distributed in the hope that it will be useful,
	 * but WITHOUT ANY WARRANTY; without even the implied warranty of
	 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
	 *

	 * DesCipher - the DES encryption method
	 *
	 * The meat of this code is by Dave Zimmerman <dzimm@widget.com>, and is:
	 *
	 * Copyright (c) 1996 Widget Workshop, Inc. All Rights Reserved.
	 *
	 * Permission to use, copy, modify, and distribute this software
	 * and its documentation for NON-COMMERCIAL or COMMERCIAL purposes and
	 * without fee is hereby granted, provided that this copyright notice is kept 
	 * intact. 
	 * 
	 * WIDGET WORKSHOP MAKES NO REPRESENTATIONS OR WARRANTIES ABOUT THE SUITABILITY
	 * OF THE SOFTWARE, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
	 * TO THE IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
	 * PARTICULAR PURPOSE, OR NON-INFRINGEMENT. WIDGET WORKSHOP SHALL NOT BE LIABLE
	 * FOR ANY DAMAGES SUFFERED BY LICENSEE AS A RESULT OF USING, MODIFYING OR
	 * DISTRIBUTING THIS SOFTWARE OR ITS DERIVATIVES.
	 * 
	 * THIS SOFTWARE IS NOT DESIGNED OR INTENDED FOR USE OR RESALE AS ON-LINE
	 * CONTROL EQUIPMENT IN HAZARDOUS ENVIRONMENTS REQUIRING FAIL-SAFE
	 * PERFORMANCE, SUCH AS IN THE OPERATION OF NUCLEAR FACILITIES, AIRCRAFT
	 * NAVIGATION OR COMMUNICATION SYSTEMS, AIR TRAFFIC CONTROL, DIRECT LIFE
	 * SUPPORT MACHINES, OR WEAPONS SYSTEMS, IN WHICH THE FAILURE OF THE
	 * SOFTWARE COULD LEAD DIRECTLY TO DEATH, PERSONAL INJURY, OR SEVERE
	 * PHYSICAL OR ENVIRONMENTAL DAMAGE ("HIGH RISK ACTIVITIES").  WIDGET WORKSHOP
	 * SPECIFICALLY DISCLAIMS ANY EXPRESS OR IMPLIED WARRANTY OF FITNESS FOR
	 * HIGH RISK ACTIVITIES.
	 *
	 *
	 * The rest is:
	 *
	 * Copyright (C) 1996 by Jef Poskanzer <jef@acme.com>.  All rights reserved.
	 *
	 * Redistribution and use in source and binary forms, with or without
	 * modification, are permitted provided that the following conditions
	 * are met:
	 * 1. Redistributions of source code must retain the above copyright
	 *    notice, this list of conditions and the following disclaimer.
	 * 2. Redistributions in binary form must reproduce the above copyright
	 *    notice, this list of conditions and the following disclaimer in the
	 *    documentation and/or other materials provided with the distribution.
	 *
	 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR AND CONTRIBUTORS ``AS IS'' AND
	 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
	 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
	 * ARE DISCLAIMED.  IN NO EVENT SHALL THE AUTHOR OR CONTRIBUTORS BE LIABLE
	 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
	 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS
	 * OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
	 * HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
	 * LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY
	 * OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
	 * SUCH DAMAGE.
	 *
	 * Visit the ACME Labs Java page for up-to-date versions of this and other
	 * fine Java utilities: http://www.acme.com/java/
	 */

	/* jslint white: false */

	function DES(passwd) {
	    "use strict";

	    // Tables, permutations, S-boxes, etc.
	    // jshint -W013
	    var PC2 = [13,16,10,23, 0, 4, 2,27,14, 5,20, 9,22,18,11, 3,
	               25, 7,15, 6,26,19,12, 1,40,51,30,36,46,54,29,39,
	               50,44,32,47,43,48,38,55,33,52,45,41,49,35,28,31 ],
	        totrot = [ 1, 2, 4, 6, 8,10,12,14,15,17,19,21,23,25,27,28],
	        z = 0x0, a,b,c,d,e,f, SP1,SP2,SP3,SP4,SP5,SP6,SP7,SP8,
	        keys = [];

	    // jshint -W015
	    a=1<<16; b=1<<24; c=a|b; d=1<<2; e=1<<10; f=d|e;
	    SP1 = [c|e,z|z,a|z,c|f,c|d,a|f,z|d,a|z,z|e,c|e,c|f,z|e,b|f,c|d,b|z,z|d,
	           z|f,b|e,b|e,a|e,a|e,c|z,c|z,b|f,a|d,b|d,b|d,a|d,z|z,z|f,a|f,b|z,
	           a|z,c|f,z|d,c|z,c|e,b|z,b|z,z|e,c|d,a|z,a|e,b|d,z|e,z|d,b|f,a|f,
	           c|f,a|d,c|z,b|f,b|d,z|f,a|f,c|e,z|f,b|e,b|e,z|z,a|d,a|e,z|z,c|d];
	    a=1<<20; b=1<<31; c=a|b; d=1<<5; e=1<<15; f=d|e;
	    SP2 = [c|f,b|e,z|e,a|f,a|z,z|d,c|d,b|f,b|d,c|f,c|e,b|z,b|e,a|z,z|d,c|d,
	           a|e,a|d,b|f,z|z,b|z,z|e,a|f,c|z,a|d,b|d,z|z,a|e,z|f,c|e,c|z,z|f,
	           z|z,a|f,c|d,a|z,b|f,c|z,c|e,z|e,c|z,b|e,z|d,c|f,a|f,z|d,z|e,b|z,
	           z|f,c|e,a|z,b|d,a|d,b|f,b|d,a|d,a|e,z|z,b|e,z|f,b|z,c|d,c|f,a|e];
	    a=1<<17; b=1<<27; c=a|b; d=1<<3; e=1<<9; f=d|e;
	    SP3 = [z|f,c|e,z|z,c|d,b|e,z|z,a|f,b|e,a|d,b|d,b|d,a|z,c|f,a|d,c|z,z|f,
	           b|z,z|d,c|e,z|e,a|e,c|z,c|d,a|f,b|f,a|e,a|z,b|f,z|d,c|f,z|e,b|z,
	           c|e,b|z,a|d,z|f,a|z,c|e,b|e,z|z,z|e,a|d,c|f,b|e,b|d,z|e,z|z,c|d,
	           b|f,a|z,b|z,c|f,z|d,a|f,a|e,b|d,c|z,b|f,z|f,c|z,a|f,z|d,c|d,a|e];
	    a=1<<13; b=1<<23; c=a|b; d=1<<0; e=1<<7; f=d|e;
	    SP4 = [c|d,a|f,a|f,z|e,c|e,b|f,b|d,a|d,z|z,c|z,c|z,c|f,z|f,z|z,b|e,b|d,
	           z|d,a|z,b|z,c|d,z|e,b|z,a|d,a|e,b|f,z|d,a|e,b|e,a|z,c|e,c|f,z|f,
	           b|e,b|d,c|z,c|f,z|f,z|z,z|z,c|z,a|e,b|e,b|f,z|d,c|d,a|f,a|f,z|e,
	           c|f,z|f,z|d,a|z,b|d,a|d,c|e,b|f,a|d,a|e,b|z,c|d,z|e,b|z,a|z,c|e];
	    a=1<<25; b=1<<30; c=a|b; d=1<<8; e=1<<19; f=d|e;
	    SP5 = [z|d,a|f,a|e,c|d,z|e,z|d,b|z,a|e,b|f,z|e,a|d,b|f,c|d,c|e,z|f,b|z,
	           a|z,b|e,b|e,z|z,b|d,c|f,c|f,a|d,c|e,b|d,z|z,c|z,a|f,a|z,c|z,z|f,
	           z|e,c|d,z|d,a|z,b|z,a|e,c|d,b|f,a|d,b|z,c|e,a|f,b|f,z|d,a|z,c|e,
	           c|f,z|f,c|z,c|f,a|e,z|z,b|e,c|z,z|f,a|d,b|d,z|e,z|z,b|e,a|f,b|d];
	    a=1<<22; b=1<<29; c=a|b; d=1<<4; e=1<<14; f=d|e;
	    SP6 = [b|d,c|z,z|e,c|f,c|z,z|d,c|f,a|z,b|e,a|f,a|z,b|d,a|d,b|e,b|z,z|f,
	           z|z,a|d,b|f,z|e,a|e,b|f,z|d,c|d,c|d,z|z,a|f,c|e,z|f,a|e,c|e,b|z,
	           b|e,z|d,c|d,a|e,c|f,a|z,z|f,b|d,a|z,b|e,b|z,z|f,b|d,c|f,a|e,c|z,
	           a|f,c|e,z|z,c|d,z|d,z|e,c|z,a|f,z|e,a|d,b|f,z|z,c|e,b|z,a|d,b|f];
	    a=1<<21; b=1<<26; c=a|b; d=1<<1; e=1<<11; f=d|e;
	    SP7 = [a|z,c|d,b|f,z|z,z|e,b|f,a|f,c|e,c|f,a|z,z|z,b|d,z|d,b|z,c|d,z|f,
	           b|e,a|f,a|d,b|e,b|d,c|z,c|e,a|d,c|z,z|e,z|f,c|f,a|e,z|d,b|z,a|e,
	           b|z,a|e,a|z,b|f,b|f,c|d,c|d,z|d,a|d,b|z,b|e,a|z,c|e,z|f,a|f,c|e,
	           z|f,b|d,c|f,c|z,a|e,z|z,z|d,c|f,z|z,a|f,c|z,z|e,b|d,b|e,z|e,a|d];
	    a=1<<18; b=1<<28; c=a|b; d=1<<6; e=1<<12; f=d|e;
	    SP8 = [b|f,z|e,a|z,c|f,b|z,b|f,z|d,b|z,a|d,c|z,c|f,a|e,c|e,a|f,z|e,z|d,
	           c|z,b|d,b|e,z|f,a|e,a|d,c|d,c|e,z|f,z|z,z|z,c|d,b|d,b|e,a|f,a|z,
	           a|f,a|z,c|e,z|e,z|d,c|d,z|e,a|f,b|e,z|d,b|d,c|z,c|d,b|z,a|z,b|f,
	           z|z,c|f,a|d,b|d,c|z,b|e,b|f,z|z,c|f,a|e,a|e,z|f,z|f,a|d,b|z,c|e];
	    // jshint +W013,+W015

	    // Set the key.
	    function setKeys(keyBlock) {
	        var i, j, l, m, n, o, pc1m = [], pcr = [], kn = [],
	            raw0, raw1, rawi, KnLi;

	        for (j = 0, l = 56; j < 56; ++j, l -= 8) {
	            l += l < -5 ? 65 : l < -3 ? 31 : l < -1 ? 63 : l === 27 ? 35 : 0; // PC1
	            m = l & 0x7;
	            pc1m[j] = ((keyBlock[l >>> 3] & (1<<m)) !== 0) ? 1: 0;
	        }

	        for (i = 0; i < 16; ++i) {
	            m = i << 1;
	            n = m + 1;
	            kn[m] = kn[n] = 0;
	            for (o = 28; o < 59; o += 28) {
	                for (j = o - 28; j < o; ++j) {
	                    l = j + totrot[i];
	                    if (l < o) {
	                        pcr[j] = pc1m[l];
	                    } else {
	                        pcr[j] = pc1m[l - 28];
	                    }
	                }
	            }
	            for (j = 0; j < 24; ++j) {
	                if (pcr[PC2[j]] !== 0) {
	                    kn[m] |= 1 << (23 - j);
	                }
	                if (pcr[PC2[j + 24]] !== 0) {
	                    kn[n] |= 1 << (23 - j);
	                }
	            }
	        }

	        // cookey
	        for (i = 0, rawi = 0, KnLi = 0; i < 16; ++i) {
	            raw0 = kn[rawi++];
	            raw1 = kn[rawi++];
	            keys[KnLi] = (raw0 & 0x00fc0000) << 6;
	            keys[KnLi] |= (raw0 & 0x00000fc0) << 10;
	            keys[KnLi] |= (raw1 & 0x00fc0000) >>> 10;
	            keys[KnLi] |= (raw1 & 0x00000fc0) >>> 6;
	            ++KnLi;
	            keys[KnLi] = (raw0 & 0x0003f000) << 12;
	            keys[KnLi] |= (raw0 & 0x0000003f) << 16;
	            keys[KnLi] |= (raw1 & 0x0003f000) >>> 4;
	            keys[KnLi] |= (raw1 & 0x0000003f);
	            ++KnLi;
	        }
	    }

	    // Encrypt 8 bytes of text
	    function enc8(text) {
	        var i = 0, b = text.slice(), fval, keysi = 0,
	            l, r, x; // left, right, accumulator

	        // Squash 8 bytes to 2 ints
	        l = b[i++]<<24 | b[i++]<<16 | b[i++]<<8 | b[i++];
	        r = b[i++]<<24 | b[i++]<<16 | b[i++]<<8 | b[i++];

	        x = ((l >>> 4) ^ r) & 0x0f0f0f0f;
	        r ^= x;
	        l ^= (x << 4);
	        x = ((l >>> 16) ^ r) & 0x0000ffff;
	        r ^= x;
	        l ^= (x << 16);
	        x = ((r >>> 2) ^ l) & 0x33333333;
	        l ^= x;
	        r ^= (x << 2);
	        x = ((r >>> 8) ^ l) & 0x00ff00ff;
	        l ^= x;
	        r ^= (x << 8);
	        r = (r << 1) | ((r >>> 31) & 1);
	        x = (l ^ r) & 0xaaaaaaaa;
	        l ^= x;
	        r ^= x;
	        l = (l << 1) | ((l >>> 31) & 1);

	        for (i = 0; i < 8; ++i) {
	            x = (r << 28) | (r >>> 4);
	            x ^= keys[keysi++];
	            fval =  SP7[x & 0x3f];
	            fval |= SP5[(x >>> 8) & 0x3f];
	            fval |= SP3[(x >>> 16) & 0x3f];
	            fval |= SP1[(x >>> 24) & 0x3f];
	            x = r ^ keys[keysi++];
	            fval |= SP8[x & 0x3f];
	            fval |= SP6[(x >>> 8) & 0x3f];
	            fval |= SP4[(x >>> 16) & 0x3f];
	            fval |= SP2[(x >>> 24) & 0x3f];
	            l ^= fval;
	            x = (l << 28) | (l >>> 4);
	            x ^= keys[keysi++];
	            fval =  SP7[x & 0x3f];
	            fval |= SP5[(x >>> 8) & 0x3f];
	            fval |= SP3[(x >>> 16) & 0x3f];
	            fval |= SP1[(x >>> 24) & 0x3f];
	            x = l ^ keys[keysi++];
	            fval |= SP8[x & 0x0000003f];
	            fval |= SP6[(x >>> 8) & 0x3f];
	            fval |= SP4[(x >>> 16) & 0x3f];
	            fval |= SP2[(x >>> 24) & 0x3f];
	            r ^= fval;
	        }

	        r = (r << 31) | (r >>> 1);
	        x = (l ^ r) & 0xaaaaaaaa;
	        l ^= x;
	        r ^= x;
	        l = (l << 31) | (l >>> 1);
	        x = ((l >>> 8) ^ r) & 0x00ff00ff;
	        r ^= x;
	        l ^= (x << 8);
	        x = ((l >>> 2) ^ r) & 0x33333333;
	        r ^= x;
	        l ^= (x << 2);
	        x = ((r >>> 16) ^ l) & 0x0000ffff;
	        l ^= x;
	        r ^= (x << 16);
	        x = ((r >>> 4) ^ l) & 0x0f0f0f0f;
	        l ^= x;
	        r ^= (x << 4);

	        // Spread ints to bytes
	        x = [r, l];
	        for (i = 0; i < 8; i++) {
	            b[i] = (x[i>>>2] >>> (8 * (3 - (i % 4)))) % 256;
	            if (b[i] < 0) { b[i] += 256; } // unsigned
	        }
	        return b;
	    }

	    // Encrypt 16 bytes of text using passwd as key
	    function encrypt(t) {
	        return enc8(t.slice(0, 8)).concat(enc8(t.slice(8, 16)));
	    }

	    setKeys(passwd);             // Setup keys
	    return {'encrypt': encrypt}; // Public interface

	} // function DES

	module.exports = DES;


/***/ }
/******/ ]);