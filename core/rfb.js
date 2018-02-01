/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2012 Joel Martin
 * Copyright (C) 2017 Samuel Mannehed for Cendio AB
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 *
 * TIGHT decoder portion:
 * (c) 2012 Michael Tinglof, Joe Balaz, Les Piech (Mercuri.ca)
 */

import * as Log from './util/logging.js';
import { decodeUTF8 } from './util/strings.js';
import { supportsCursorURIs, isTouchDevice } from './util/browser.js';
import EventTargetMixin from './util/eventtarget.js';
import Display from "./display.js";
import Keyboard from "./input/keyboard.js";
import Mouse from "./input/mouse.js";
import Websock from "./websock.js";
import DES from "./des.js";
import KeyTable from "./input/keysym.js";
import XtScancode from "./input/xtscancodes.js";
import Inflator from "./inflator.js";
import { encodings, encodingName } from "./encodings.js";
import "./util/polyfill.js";

/*jslint white: false, browser: true */
/*global window, Util, Display, Keyboard, Mouse, Websock, Websock_native, Base64, DES, KeyTable, Inflator, XtScancode */

// How many seconds to wait for a disconnect to finish
var DISCONNECT_TIMEOUT = 3;

export default function RFB(target, url, options) {
    if (!target) {
        throw Error("Must specify target");
    }
    if (!url) {
        throw Error("Must specify URL");
    }

    this._target = target;
    this._url = url;

    // Connection details
    options = options || {};
    this._rfb_credentials = options.credentials || {};
    this._shared = 'shared' in options ? !!options.shared : true;
    this._repeaterID = options.repeaterID || '';

    // Internal state
    this._rfb_connection_state = '';
    this._rfb_init_state = '';
    this._rfb_auth_scheme = '';
    this._rfb_clean_disconnect = true;

    // Server capabilities
    this._rfb_version = 0;
    this._rfb_max_version = 3.8;
    this._rfb_tightvnc = false;
    this._rfb_xvp_ver = 0;

    this._fb_width = 0;
    this._fb_height = 0;

    this._fb_name = "";

    this._capabilities = { power: false };

    this._supportsFence = false;

    this._supportsContinuousUpdates = false;
    this._enabledContinuousUpdates = false;

    this._supportsSetDesktopSize = false;
    this._screen_id = 0;
    this._screen_flags = 0;

    this._qemuExtKeyEventSupported = false;

    // Internal objects
    this._sock = null;              // Websock object
    this._display = null;           // Display object
    this._flushing = false;         // Display flushing state
    this._keyboard = null;          // Keyboard input handler object
    this._mouse = null;             // Mouse input handler object

    // Timers
    this._disconnTimer = null;      // disconnection timer
    this._resizeTimeout = null;     // resize rate limiting

    // Decoder states and stats
    this._encHandlers = {};
    this._encStats = {};

    this._FBU = {
        rects: 0,
        subrects: 0,            // RRE and HEXTILE
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
        zlibs: []               // TIGHT zlib streams
    };
    for (var i = 0; i < 4; i++) {
        this._FBU.zlibs[i] = new Inflator();
    }

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

    // Mouse state
    this._mouse_buttonMask = 0;
    this._mouse_arr = [];
    this._viewportDragging = false;
    this._viewportDragPos = {};
    this._viewportHasMoved = false;

    // Bound event handlers
    this._eventHandlers = {
        focusCanvas: this._focusCanvas.bind(this),
        windowResize: this._windowResize.bind(this),
    };

    // main setup
    Log.Debug(">> RFB.constructor");

    // Create DOM elements
    this._screen = document.createElement('div');
    this._screen.style.display = 'flex';
    this._screen.style.width = '100%';
    this._screen.style.height = '100%';
    this._screen.style.overflow = 'auto';
    this._screen.style.backgroundColor = 'rgb(40, 40, 40)';
    this._canvas = document.createElement('canvas');
    this._canvas.style.margin = 'auto';
    // Some browsers add an outline on focus
    this._canvas.style.outline = 'none';
    // IE miscalculates width without this :(
    this._canvas.style.flexShrink = '0';
    this._canvas.width = 0;
    this._canvas.height = 0;
    this._canvas.tabIndex = -1;
    this._screen.appendChild(this._canvas);

    // populate encHandlers with bound versions
    this._encHandlers[encodings.encodingRaw] = RFB.encodingHandlers.RAW.bind(this);
    this._encHandlers[encodings.encodingCopyRect] = RFB.encodingHandlers.COPYRECT.bind(this);
    this._encHandlers[encodings.encodingRRE] = RFB.encodingHandlers.RRE.bind(this);
    this._encHandlers[encodings.encodingHextile] = RFB.encodingHandlers.HEXTILE.bind(this);
    this._encHandlers[encodings.encodingTight] = RFB.encodingHandlers.TIGHT.bind(this);

    this._encHandlers[encodings.pseudoEncodingDesktopSize] = RFB.encodingHandlers.DesktopSize.bind(this);
    this._encHandlers[encodings.pseudoEncodingLastRect] = RFB.encodingHandlers.last_rect.bind(this);
    this._encHandlers[encodings.pseudoEncodingCursor] = RFB.encodingHandlers.Cursor.bind(this);
    this._encHandlers[encodings.pseudoEncodingQEMUExtendedKeyEvent] = RFB.encodingHandlers.QEMUExtendedKeyEvent.bind(this);
    this._encHandlers[encodings.pseudoEncodingExtendedDesktopSize] = RFB.encodingHandlers.ExtendedDesktopSize.bind(this);

    // NB: nothing that needs explicit teardown should be done
    // before this point, since this can throw an exception
    try {
        this._display = new Display(this._canvas);
    } catch (exc) {
        Log.Error("Display exception: " + exc);
        throw exc;
    }
    this._display.onflush = this._onFlush.bind(this);
    this._display.clear();

    this._keyboard = new Keyboard(this._canvas);
    this._keyboard.onkeyevent = this._handleKeyEvent.bind(this);

    this._mouse = new Mouse(this._canvas);
    this._mouse.onmousebutton = this._handleMouseButton.bind(this);
    this._mouse.onmousemove = this._handleMouseMove.bind(this);

    this._sock = new Websock();
    this._sock.on('message', this._handle_message.bind(this));
    this._sock.on('open', function () {
        if ((this._rfb_connection_state === 'connecting') &&
            (this._rfb_init_state === '')) {
            this._rfb_init_state = 'ProtocolVersion';
            Log.Debug("Starting VNC handshake");
        } else {
            this._fail("Unexpected server connection while " +
                       this._rfb_connection_state);
        }
    }.bind(this));
    this._sock.on('close', function (e) {
        Log.Debug("WebSocket on-close event");
        var msg = "";
        if (e.code) {
            msg = "(code: " + e.code;
            if (e.reason) {
                msg += ", reason: " + e.reason;
            }
            msg += ")";
        }
        switch (this._rfb_connection_state) {
            case 'connecting':
                this._fail("Connection closed " + msg);
                break;
            case 'connected':
                // Handle disconnects that were initiated server-side
                this._updateConnectionState('disconnecting');
                this._updateConnectionState('disconnected');
                break;
            case 'disconnecting':
                // Normal disconnection path
                this._updateConnectionState('disconnected');
                break;
            case 'disconnected':
                this._fail("Unexpected server disconnect " +
                           "when already disconnected " + msg);
                break;
            default:
                this._fail("Unexpected server disconnect before connecting " +
                           msg);
                break;
        }
        this._sock.off('close');
    }.bind(this));
    this._sock.on('error', function (e) {
        Log.Warn("WebSocket on-error event");
    });

    // Slight delay of the actual connection so that the caller has
    // time to set up callbacks
    setTimeout(this._updateConnectionState.bind(this, 'connecting'));

    Log.Debug("<< RFB.constructor");
};

RFB.prototype = {
    // ===== PROPERTIES =====

    dragViewport: false,
    focusOnClick: true,

    _viewOnly: false,
    get viewOnly() { return this._viewOnly; },
    set viewOnly(viewOnly) {
        this._viewOnly = viewOnly;

        if (this._rfb_connection_state === "connecting" ||
            this._rfb_connection_state === "connected") {
            if (viewOnly) {
                this._keyboard.ungrab();
                this._mouse.ungrab();
            } else {
                this._keyboard.grab();
                this._mouse.grab();
            }
        }
    },

    get capabilities() { return this._capabilities; },

    get touchButton() { return this._mouse.touchButton; },
    set touchButton(button) { this._mouse.touchButton = button; },

    _clipViewport: false,
    get clipViewport() { return this._clipViewport; },
    set clipViewport(viewport) {
        this._clipViewport = viewport;
        this._updateClip();
    },

    _scaleViewport: false,
    get scaleViewport() { return this._scaleViewport; },
    set scaleViewport(scale) {
        this._scaleViewport = scale;
        // Scaling trumps clipping, so we may need to adjust
        // clipping when enabling or disabling scaling
        if (scale && this._clipViewport) {
            this._updateClip();
        }
        this._updateScale();
        if (!scale && this._clipViewport) {
            this._updateClip();
        }
    },

    _resizeSession: false,
    get resizeSession() { return this._resizeSession; },
    set resizeSession(resize) {
        this._resizeSession = resize;
        if (resize) {
            this._requestRemoteResize();
        }
    },

    // ===== PUBLIC METHODS =====

    disconnect: function () {
        this._updateConnectionState('disconnecting');
        this._sock.off('error');
        this._sock.off('message');
        this._sock.off('open');
    },

    sendCredentials: function (creds) {
        this._rfb_credentials = creds;
        setTimeout(this._init_msg.bind(this), 0);
    },

    sendCtrlAltDel: function () {
        if (this._rfb_connection_state !== 'connected' || this._viewOnly) { return; }
        Log.Info("Sending Ctrl-Alt-Del");

        this.sendKey(KeyTable.XK_Control_L, "ControlLeft", true);
        this.sendKey(KeyTable.XK_Alt_L, "AltLeft", true);
        this.sendKey(KeyTable.XK_Delete, "Delete", true);
        this.sendKey(KeyTable.XK_Delete, "Delete", false);
        this.sendKey(KeyTable.XK_Alt_L, "AltLeft", false);
        this.sendKey(KeyTable.XK_Control_L, "ControlLeft", false);
    },

    machineShutdown: function () {
        this._xvpOp(1, 2);
    },

    machineReboot: function () {
        this._xvpOp(1, 3);
    },

    machineReset: function () {
        this._xvpOp(1, 4);
    },

    // Send a key press. If 'down' is not specified then send a down key
    // followed by an up key.
    sendKey: function (keysym, code, down) {
        if (this._rfb_connection_state !== 'connected' || this._viewOnly) { return; }

        if (down === undefined) {
            this.sendKey(keysym, code, true);
            this.sendKey(keysym, code, false);
            return;
        }

        var scancode = XtScancode[code];

        if (this._qemuExtKeyEventSupported && scancode) {
            // 0 is NoSymbol
            keysym = keysym || 0;

            Log.Info("Sending key (" + (down ? "down" : "up") + "): keysym " + keysym + ", scancode " + scancode);

            RFB.messages.QEMUExtendedKeyEvent(this._sock, keysym, down, scancode);
        } else {
            if (!keysym) {
                return;
            }
            Log.Info("Sending keysym (" + (down ? "down" : "up") + "): " + keysym);
            RFB.messages.keyEvent(this._sock, keysym, down ? 1 : 0);
        }
    },

    focus: function () {
        this._canvas.focus();
    },

    blur: function () {
        this._canvas.blur();
    },

    clipboardPasteFrom: function (text) {
        if (this._rfb_connection_state !== 'connected' || this._viewOnly) { return; }
        RFB.messages.clientCutText(this._sock, text);
    },

    // ===== PRIVATE METHODS =====

    _connect: function () {
        Log.Debug(">> RFB.connect");

        Log.Info("connecting to " + this._url);

        try {
            // WebSocket.onopen transitions to the RFB init states
            this._sock.open(this._url, ['binary']);
        } catch (e) {
            if (e.name === 'SyntaxError') {
                this._fail("Invalid host or port (" + e + ")");
            } else {
                this._fail("Error when opening socket (" + e + ")");
            }
        }

        // Make our elements part of the page
        this._target.appendChild(this._screen);

        // Monitor size changes of the screen
        // FIXME: Use ResizeObserver, or hidden overflow
        window.addEventListener('resize', this._eventHandlers.windowResize);

        // Always grab focus on some kind of click event
        this._canvas.addEventListener("mousedown", this._eventHandlers.focusCanvas);
        this._canvas.addEventListener("touchstart", this._eventHandlers.focusCanvas);

        Log.Debug("<< RFB.connect");
    },

    _disconnect: function () {
        Log.Debug(">> RFB.disconnect");
        this._canvas.removeEventListener("mousedown", this._eventHandlers.focusCanvas);
        this._canvas.removeEventListener("touchstart", this._eventHandlers.focusCanvas);
        window.removeEventListener('resize', this._eventHandlers.windowResize);
        this._keyboard.ungrab();
        this._mouse.ungrab();
        this._sock.close();
        this._print_stats();
        try {
            this._target.removeChild(this._screen);
        } catch (e) {
            if (e.name === 'NotFoundError') {
                // Some cases where the initial connection fails
                // can disconnect before the _screen is created
            } else {
                throw e;
            }
        }
        clearTimeout(this._resizeTimeout);
        Log.Debug("<< RFB.disconnect");
    },

    _print_stats: function () {
        var stats = this._encStats;

        Log.Info("Encoding stats for this connection:");
        Object.keys(stats).forEach(function (key) {
            var s = stats[key];
            if (s[0] + s[1] > 0) {
                Log.Info("    " + encodingName(key) + ": " + s[0] + " rects");
            }
        });

        Log.Info("Encoding stats since page load:");
        Object.keys(stats).forEach(function (key) {
            var s = stats[key];
            Log.Info("    " + encodingName(key) + ": " + s[1] + " rects");
        });
    },

    _focusCanvas: function(event) {
        // Respect earlier handlers' request to not do side-effects
        if (event.defaultPrevented) {
            return;
        }

        if (!this.focusOnClick) {
            return;
        }

        this.focus();
    },

    _windowResize: function (event) {
        // If the window resized then our screen element might have
        // as well. Update the viewport dimensions.
        window.requestAnimationFrame(function () {
            this._updateClip();
            this._updateScale();
        }.bind(this));

        if (this._resizeSession) {
            // Request changing the resolution of the remote display to
            // the size of the local browser viewport.

            // In order to not send multiple requests before the browser-resize
            // is finished we wait 0.5 seconds before sending the request.
            clearTimeout(this._resizeTimeout);
            this._resizeTimeout = setTimeout(this._requestRemoteResize.bind(this), 500);
        }
    },

    // Update state of clipping in Display object, and make sure the
    // configured viewport matches the current screen size
    _updateClip: function () {
        var cur_clip = this._display.clipViewport;
        var new_clip = this._clipViewport;

        if (this._scaleViewport) {
            // Disable viewport clipping if we are scaling
            new_clip = false;
        }

        if (cur_clip !== new_clip) {
            this._display.clipViewport = new_clip;
        }

        if (new_clip) {
            // When clipping is enabled, the screen is limited to
            // the size of the container.
            let size = this._screenSize();
            this._display.viewportChangeSize(size.w, size.h);
            this._fixScrollbars();
        }
    },

    _updateScale: function () {
        if (!this._scaleViewport) {
            this._display.scale = 1.0;
        } else {
            let size = this._screenSize();
            this._display.autoscale(size.w, size.h);
        }
        this._fixScrollbars();
    },

    // Requests a change of remote desktop size. This message is an extension
    // and may only be sent if we have received an ExtendedDesktopSize message
    _requestRemoteResize: function () {
        clearTimeout(this._resizeTimeout);
        this._resizeTimeout = null;

        if (!this._resizeSession || this._viewOnly ||
            !this._supportsSetDesktopSize) {
            return;
        }

        let size = this._screenSize();
        RFB.messages.setDesktopSize(this._sock, size.w, size.h,
                                    this._screen_id, this._screen_flags);

        Log.Debug('Requested new desktop size: ' +
                   size.w + 'x' + size.h);
    },

    // Gets the the size of the available screen
    _screenSize: function () {
        return { w: this._screen.offsetWidth,
                 h: this._screen.offsetHeight };
    },

    _fixScrollbars: function () {
        // This is a hack because Chrome screws up the calculation
        // for when scrollbars are needed. So to fix it we temporarily
        // toggle them off and on.
        var orig = this._screen.style.overflow;
        this._screen.style.overflow = 'hidden';
        // Force Chrome to recalculate the layout by asking for
        // an element's dimensions
        this._screen.getBoundingClientRect();
        this._screen.style.overflow = orig;
    },

    /*
     * Connection states:
     *   connecting
     *   connected
     *   disconnecting
     *   disconnected - permanent state
     */
    _updateConnectionState: function (state) {
        var oldstate = this._rfb_connection_state;

        if (state === oldstate) {
            Log.Debug("Already in state '" + state + "', ignoring");
            return;
        }

        // The 'disconnected' state is permanent for each RFB object
        if (oldstate === 'disconnected') {
            Log.Error("Tried changing state of a disconnected RFB object");
            return;
        }

        // Ensure proper transitions before doing anything
        switch (state) {
            case 'connected':
                if (oldstate !== 'connecting') {
                    Log.Error("Bad transition to connected state, " +
                               "previous connection state: " + oldstate);
                    return;
                }
                break;

            case 'disconnected':
                if (oldstate !== 'disconnecting') {
                    Log.Error("Bad transition to disconnected state, " +
                               "previous connection state: " + oldstate);
                    return;
                }
                break;

            case 'connecting':
                if (oldstate !== '') {
                    Log.Error("Bad transition to connecting state, " +
                               "previous connection state: " + oldstate);
                    return;
                }
                break;

            case 'disconnecting':
                if (oldstate !== 'connected' && oldstate !== 'connecting') {
                    Log.Error("Bad transition to disconnecting state, " +
                               "previous connection state: " + oldstate);
                    return;
                }
                break;

            default:
                Log.Error("Unknown connection state: " + state);
                return;
        }

        // State change actions

        this._rfb_connection_state = state;

        var smsg = "New state '" + state + "', was '" + oldstate + "'.";
        Log.Debug(smsg);

        if (this._disconnTimer && state !== 'disconnecting') {
            Log.Debug("Clearing disconnect timer");
            clearTimeout(this._disconnTimer);
            this._disconnTimer = null;

            // make sure we don't get a double event
            this._sock.off('close');
        }

        switch (state) {
            case 'connecting':
                this._connect();
                break;

            case 'connected':
                var event = new CustomEvent("connect", { detail: {} });
                this.dispatchEvent(event);
                break;

            case 'disconnecting':
                this._disconnect();

                this._disconnTimer = setTimeout(function () {
                    Log.Error("Disconnection timed out.");
                    this._updateConnectionState('disconnected');
                }.bind(this), DISCONNECT_TIMEOUT * 1000);
                break;

            case 'disconnected':
                event = new CustomEvent(
                    "disconnect", { detail:
                                    { clean: this._rfb_clean_disconnect } });
                this.dispatchEvent(event);
                break;
        }
    },

    /* Print errors and disconnect
     *
     * The parameter 'details' is used for information that
     * should be logged but not sent to the user interface.
     */
    _fail: function (details) {
        switch (this._rfb_connection_state) {
            case 'disconnecting':
                Log.Error("Failed when disconnecting: " + details);
                break;
            case 'connected':
                Log.Error("Failed while connected: " + details);
                break;
            case 'connecting':
                Log.Error("Failed when connecting: " + details);
                break;
            default:
                Log.Error("RFB failure: " + details);
                break;
        }
        this._rfb_clean_disconnect = false; //This is sent to the UI

        // Transition to disconnected without waiting for socket to close
        this._updateConnectionState('disconnecting');
        this._updateConnectionState('disconnected');

        return false;
    },

    _setCapability: function (cap, val) {
        this._capabilities[cap] = val;
        var event = new CustomEvent("capabilities",
                                    { detail: { capabilities: this._capabilities } });
        this.dispatchEvent(event);
    },

    _handle_message: function () {
        if (this._sock.rQlen() === 0) {
            Log.Warn("handle_message called on an empty receive queue");
            return;
        }

        switch (this._rfb_connection_state) {
            case 'disconnected':
                Log.Error("Got data while disconnected");
                break;
            case 'connected':
                while (true) {
                    if (this._flushing) {
                        break;
                    }
                    if (!this._normal_msg()) {
                        break;
                    }
                    if (this._sock.rQlen() === 0) {
                        break;
                    }
                }
                break;
            default:
                this._init_msg();
                break;
        }
    },

    _handleKeyEvent: function (keysym, code, down) {
        this.sendKey(keysym, code, down);
    },

    _handleMouseButton: function (x, y, down, bmask) {
        if (down) {
            this._mouse_buttonMask |= bmask;
        } else {
            this._mouse_buttonMask &= ~bmask;
        }

        if (this.dragViewport) {
            if (down && !this._viewportDragging) {
                this._viewportDragging = true;
                this._viewportDragPos = {'x': x, 'y': y};
                this._viewportHasMoved = false;

                // Skip sending mouse events
                return;
            } else {
                this._viewportDragging = false;

                // If we actually performed a drag then we are done
                // here and should not send any mouse events
                if (this._viewportHasMoved) {
                    return;
                }

                // Otherwise we treat this as a mouse click event.
                // Send the button down event here, as the button up
                // event is sent at the end of this function.
                RFB.messages.pointerEvent(this._sock,
                                          this._display.absX(x),
                                          this._display.absY(y),
                                          bmask);
            }
        }

        if (this._viewOnly) { return; } // View only, skip mouse events

        if (this._rfb_connection_state !== 'connected') { return; }
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

        if (this._viewOnly) { return; } // View only, skip mouse events

        if (this._rfb_connection_state !== 'connected') { return; }
        RFB.messages.pointerEvent(this._sock, this._display.absX(x), this._display.absY(y), this._mouse_buttonMask);
    },

    // Message Handlers

    _negotiate_protocol_version: function () {
        if (this._sock.rQlen() < 12) {
            return this._fail("Received incomplete protocol version.");
        }

        var sversion = this._sock.rQshiftStr(12).substr(4, 7);
        Log.Info("Server ProtocolVersion: " + sversion);
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
            case "005.000":  // RealVNC 5.3
                this._rfb_version = 3.8;
                break;
            default:
                return this._fail("Invalid server version " + sversion);
        }

        if (is_repeater) {
            var repeaterID = "ID:" + this._repeaterID;
            while (repeaterID.length < 250) {
                repeaterID += "\0";
            }
            this._sock.send_string(repeaterID);
            return true;
        }

        if (this._rfb_version > this._rfb_max_version) {
            this._rfb_version = this._rfb_max_version;
        }

        var cversion = "00" + parseInt(this._rfb_version, 10) +
                       ".00" + ((this._rfb_version * 10) % 10);
        this._sock.send_string("RFB " + cversion + "\n");
        Log.Debug('Sent ProtocolVersion: ' + cversion);

        this._rfb_init_state = 'Security';
    },

    _negotiate_security: function () {
        // Polyfill since IE and PhantomJS doesn't have
        // TypedArray.includes()
        function includes(item, array) {
            for (var i = 0; i < array.length; i++) {
                if (array[i] === item) {
                    return true;
                }
            }
            return false;
        }

        if (this._rfb_version >= 3.7) {
            // Server sends supported list, client decides
            var num_types = this._sock.rQshift8();
            if (this._sock.rQwait("security type", num_types, 1)) { return false; }

            if (num_types === 0) {
                return this._handle_security_failure("no security types");
            }

            var types = this._sock.rQshiftBytes(num_types);
            Log.Debug("Server security types: " + types);

            // Look for each auth in preferred order
            this._rfb_auth_scheme = 0;
            if (includes(1, types)) {
                this._rfb_auth_scheme = 1; // None
            } else if (includes(22, types)) {
                this._rfb_auth_scheme = 22; // XVP
            } else if (includes(16, types)) {
                this._rfb_auth_scheme = 16; // Tight
            } else if (includes(2, types)) {
                this._rfb_auth_scheme = 2; // VNC Auth
            } else {
                return this._fail("Unsupported security types (types: " + types + ")");
            }

            this._sock.send([this._rfb_auth_scheme]);
        } else {
            // Server decides
            if (this._sock.rQwait("security scheme", 4)) { return false; }
            this._rfb_auth_scheme = this._sock.rQshift32();
        }

        this._rfb_init_state = 'Authentication';
        Log.Debug('Authenticating using scheme: ' + this._rfb_auth_scheme);

        return this._init_msg(); // jump to authentication
    },

    /*
     * Get the security failure reason if sent from the server and
     * send the 'securityfailure' event.
     *
     * - The optional parameter context can be used to add some extra
     *   context to the log output.
     *
     * - The optional parameter security_result_status can be used to
     *   add a custom status code to the event.
     */
    _handle_security_failure: function (context, security_result_status) {

        if (typeof context === 'undefined') {
            context = "";
        } else {
            context = " on " + context;
        }

        if (typeof security_result_status === 'undefined') {
            security_result_status = 1; // fail
        }

        if (this._sock.rQwait("reason length", 4)) {
            return false;
        }
        let strlen = this._sock.rQshift32();
        let reason = "";

        if (strlen > 0) {
            if (this._sock.rQwait("reason", strlen, 8)) { return false; }
            reason = this._sock.rQshiftStr(strlen);
        }

        if (reason !== "") {

            let event = new CustomEvent(
                "securityfailure",
                { detail: { status: security_result_status, reason: reason } });
            this.dispatchEvent(event);

            return this._fail("Security negotiation failed" + context +
                              " (reason: " + reason + ")");
        } else {

            let event = new CustomEvent(
                "securityfailure",
                { detail: { status: security_result_status } });
            this.dispatchEvent(event);

            return this._fail("Security negotiation failed" + context);
        }
    },

    // authentication
    _negotiate_xvp_auth: function () {
        if (!this._rfb_credentials.username ||
            !this._rfb_credentials.password ||
            !this._rfb_credentials.target) {
            var event = new CustomEvent("credentialsrequired",
                                        { detail: { types: ["username", "password", "target"] } });
            this.dispatchEvent(event);
            return false;
        }

        var xvp_auth_str = String.fromCharCode(this._rfb_credentials.username.length) +
                           String.fromCharCode(this._rfb_credentials.target.length) +
                           this._rfb_credentials.username +
                           this._rfb_credentials.target;
        this._sock.send_string(xvp_auth_str);
        this._rfb_auth_scheme = 2;
        return this._negotiate_authentication();
    },

    _negotiate_std_vnc_auth: function () {
        if (this._sock.rQwait("auth challenge", 16)) { return false; }

        if (!this._rfb_credentials.password) {
            var event = new CustomEvent("credentialsrequired",
                                        { detail: { types: ["password"] } });
            this.dispatchEvent(event);
            return false;
        }

        // TODO(directxman12): make genDES not require an Array
        var challenge = Array.prototype.slice.call(this._sock.rQshiftBytes(16));
        var response = RFB.genDES(this._rfb_credentials.password, challenge);
        this._sock.send(response);
        this._rfb_init_state = "SecurityResult";
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
                return this._fail("Client's tunnel type had the incorrect " +
                                  "vendor or signature");
            }
            this._sock.send([0, 0, 0, 0]);  // use NOTUNNEL
            return false; // wait until we receive the sub auth count to continue
        } else {
            return this._fail("Server wanted tunnels, but doesn't support " +
                              "the notunnel type");
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
        if (subAuthCount === 0) {  // empty sub-auth list received means 'no auth' subtype selected
            this._rfb_init_state = 'SecurityResult';
            return true;
        }

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
                        this._rfb_init_state = 'SecurityResult';
                        return true;
                    case 'STDVVNCAUTH_': // VNC auth
                        this._rfb_auth_scheme = 2;
                        return this._init_msg();
                    default:
                        return this._fail("Unsupported tiny auth scheme " +
                                          "(scheme: " + authType + ")");
                }
            }
        }

        return this._fail("No supported sub-auth types!");
    },

    _negotiate_authentication: function () {
        switch (this._rfb_auth_scheme) {
            case 0:  // connection failed
                return this._handle_security_failure("authentication scheme");

            case 1:  // no auth
                if (this._rfb_version >= 3.8) {
                    this._rfb_init_state = 'SecurityResult';
                    return true;
                }
                this._rfb_init_state = 'ClientInitialisation';
                return this._init_msg();

            case 22:  // XVP auth
                return this._negotiate_xvp_auth();

            case 2:  // VNC authentication
                return this._negotiate_std_vnc_auth();

            case 16:  // TightVNC Security Type
                return this._negotiate_tight_auth();

            default:
                return this._fail("Unsupported auth scheme (scheme: " +
                                  this._rfb_auth_scheme + ")");
        }
    },

    _handle_security_result: function () {
        if (this._sock.rQwait('VNC auth response ', 4)) { return false; }

        let status = this._sock.rQshift32();

        if (status === 0) { // OK
            this._rfb_init_state = 'ClientInitialisation';
            Log.Debug('Authentication OK');
            return this._init_msg();
        } else {
            if (this._rfb_version >= 3.8) {
                return this._handle_security_failure("security result", status);
            } else {
                let event = new CustomEvent("securityfailure",
                                            { detail: { status: status } });
                this.dispatchEvent(event);

                return this._fail("Security handshake failed");
            }
        }
    },

    _negotiate_server_init: function () {
        if (this._sock.rQwait("server initialization", 24)) { return false; }

        /* Screen size */
        var width = this._sock.rQshift16();
        var height = this._sock.rQshift16();

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
        this._fb_name = decodeUTF8(this._sock.rQshiftStr(name_length));

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
        Log.Info("Screen: " + width + "x" + height +
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
            Log.Warn("Server native endian is not little endian");
        }

        if (red_shift !== 16) {
            Log.Warn("Server native red-shift is not 16");
        }

        if (blue_shift !== 0) {
            Log.Warn("Server native blue-shift is not 0");
        }

        // we're past the point where we could backtrack, so it's safe to call this
        var event = new CustomEvent("desktopname",
                                    { detail: { name: this._fb_name } });
        this.dispatchEvent(event);

        this._resize(width, height);

        if (!this._viewOnly) { this._keyboard.grab(); }
        if (!this._viewOnly) { this._mouse.grab(); }

        this._fb_depth = 24;

        if (this._fb_name === "Intel(r) AMT KVM") {
            Log.Warn("Intel AMT KVM only supports 8/16 bit depths. Using low color mode.");
            this._fb_depth = 8;
        }

        RFB.messages.pixelFormat(this._sock, this._fb_depth, true);
        this._sendEncodings();
        RFB.messages.fbUpdateRequest(this._sock, false, 0, 0, this._fb_width, this._fb_height);

        this._timing.fbu_rt_start = (new Date()).getTime();
        this._timing.pixels = 0;

        // Cursor will be server side until the server decides to honor
        // our request and send over the cursor image
        this._display.disableLocalCursor();

        this._updateConnectionState('connected');
        return true;
    },

    _sendEncodings: function () {
        var encs = [];

        // In preference order
        encs.push(encodings.encodingCopyRect);
        // Only supported with full depth support
        if (this._fb_depth == 24) {
            encs.push(encodings.encodingTight);
            encs.push(encodings.encodingHextile);
            encs.push(encodings.encodingRRE);
        }
        encs.push(encodings.encodingRaw);

        // Psuedo-encoding settings
        encs.push(encodings.pseudoEncodingTightPNG);
        encs.push(encodings.pseudoEncodingQualityLevel0 + 6);
        encs.push(encodings.pseudoEncodingCompressLevel0 + 2);

        encs.push(encodings.pseudoEncodingDesktopSize);
        encs.push(encodings.pseudoEncodingLastRect);
        encs.push(encodings.pseudoEncodingQEMUExtendedKeyEvent);
        encs.push(encodings.pseudoEncodingExtendedDesktopSize);
        encs.push(encodings.pseudoEncodingXvp);
        encs.push(encodings.pseudoEncodingFence);
        encs.push(encodings.pseudoEncodingContinuousUpdates);

        if (supportsCursorURIs() &&
            !isTouchDevice && this._fb_depth == 24) {
            encs.push(encodings.pseudoEncodingCursor);
        }

        RFB.messages.clientEncodings(this._sock, encs);
    },

    /* RFB protocol initialization states:
     *   ProtocolVersion
     *   Security
     *   Authentication
     *   SecurityResult
     *   ClientInitialization - not triggered by server message
     *   ServerInitialization
     */
    _init_msg: function () {
        switch (this._rfb_init_state) {
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
                this._rfb_init_state = 'ServerInitialisation';
                return true;

            case 'ServerInitialisation':
                return this._negotiate_server_init();

            default:
                return this._fail("Unknown init state (state: " +
                                  this._rfb_init_state + ")");
        }
    },

    _handle_set_colour_map_msg: function () {
        Log.Debug("SetColorMapEntries");

        return this._fail("Unexpected SetColorMapEntries message");
    },

    _handle_server_cut_text: function () {
        Log.Debug("ServerCutText");

        if (this._sock.rQwait("ServerCutText header", 7, 1)) { return false; }
        this._sock.rQskipBytes(3);  // Padding
        var length = this._sock.rQshift32();
        if (this._sock.rQwait("ServerCutText", length, 8)) { return false; }

        var text = this._sock.rQshiftStr(length);

        if (this._viewOnly) { return true; }

        var event = new CustomEvent("clipboard",
                                    { detail: { text: text } });
        this.dispatchEvent(event);

        return true;
    },

    _handle_server_fence_msg: function() {
        if (this._sock.rQwait("ServerFence header", 8, 1)) { return false; }
        this._sock.rQskipBytes(3); // Padding
        var flags = this._sock.rQshift32();
        var length = this._sock.rQshift8();

        if (this._sock.rQwait("ServerFence payload", length, 9)) { return false; }

        if (length > 64) {
            Log.Warn("Bad payload length (" + length + ") in fence response");
            length = 64;
        }

        var payload = this._sock.rQshiftStr(length);

        this._supportsFence = true;

        /*
         * Fence flags
         *
         *  (1<<0)  - BlockBefore
         *  (1<<1)  - BlockAfter
         *  (1<<2)  - SyncNext
         *  (1<<31) - Request
         */

        if (!(flags & (1<<31))) {
            return this._fail("Unexpected fence response");
        }

        // Filter out unsupported flags
        // FIXME: support syncNext
        flags &= (1<<0) | (1<<1);

        // BlockBefore and BlockAfter are automatically handled by
        // the fact that we process each incoming message
        // synchronuosly.
        RFB.messages.clientFence(this._sock, flags, payload);

        return true;
    },

    _handle_xvp_msg: function () {
        if (this._sock.rQwait("XVP version and message", 3, 1)) { return false; }
        this._sock.rQskip8();  // Padding
        var xvp_ver = this._sock.rQshift8();
        var xvp_msg = this._sock.rQshift8();

        switch (xvp_msg) {
            case 0:  // XVP_FAIL
                Log.Error("XVP Operation Failed");
                break;
            case 1:  // XVP_INIT
                this._rfb_xvp_ver = xvp_ver;
                Log.Info("XVP extensions enabled (version " + this._rfb_xvp_ver + ")");
                this._setCapability("power", true);
                break;
            default:
                this._fail("Illegal server XVP message (msg: " + xvp_msg + ")");
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
                if (ret && !this._enabledContinuousUpdates) {
                    RFB.messages.fbUpdateRequest(this._sock, true, 0, 0,
                                                 this._fb_width, this._fb_height);
                }
                return ret;

            case 1:  // SetColorMapEntries
                return this._handle_set_colour_map_msg();

            case 2:  // Bell
                Log.Debug("Bell");
                var event = new CustomEvent("bell", { detail: {} });
                this.dispatchEvent(event);
                return true;

            case 3:  // ServerCutText
                return this._handle_server_cut_text();

            case 150: // EndOfContinuousUpdates
                var first = !(this._supportsContinuousUpdates);
                this._supportsContinuousUpdates = true;
                this._enabledContinuousUpdates = false;
                if (first) {
                    this._enabledContinuousUpdates = true;
                    this._updateContinuousUpdates();
                    Log.Info("Enabling continuous updates.");
                } else {
                    // FIXME: We need to send a framebufferupdaterequest here
                    // if we add support for turning off continuous updates
                }
                return true;

            case 248: // ServerFence
                return this._handle_server_fence_msg();

            case 250:  // XVP
                return this._handle_xvp_msg();

            default:
                this._fail("Unexpected server message (type " + msg_type + ")");
                Log.Debug("sock.rQslice(0, 30): " + this._sock.rQslice(0, 30));
                return true;
        }
    },

    _onFlush: function() {
        this._flushing = false;
        // Resume processing
        if (this._sock.rQlen() > 0) {
            this._handle_message();
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
                Log.Info("First FBU latency: " + (now - this._timing.fbu_rt_start));
            }

            // Make sure the previous frame is fully rendered first
            // to avoid building up an excessive queue
            if (this._display.pending()) {
                this._flushing = true;
                this._display.flush();
                return false;
            }
        }

        while (this._FBU.rects > 0) {
            if (this._rfb_connection_state !== 'connected') { return false; }

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

                if (!this._encHandlers[this._FBU.encoding]) {
                    this._fail("Unsupported encoding (encoding: " +
                               this._FBU.encoding + ")");
                    return false;
                }
            }

            this._timing.last_fbu = (new Date()).getTime();

            ret = this._encHandlers[this._FBU.encoding]();

            now = (new Date()).getTime();
            this._timing.cur_fbu += (now - this._timing.last_fbu);

            if (ret) {
                if (!(this._FBU.encoding in this._encStats)) {
                    this._encStats[this._FBU.encoding] = [0, 0];
                }
                this._encStats[this._FBU.encoding][0]++;
                this._encStats[this._FBU.encoding][1]++;
                this._timing.pixels += this._FBU.width * this._FBU.height;
            }

            if (this._timing.pixels >= (this._fb_width * this._fb_height)) {
                if ((this._FBU.width === this._fb_width && this._FBU.height === this._fb_height) ||
                    this._timing.fbu_rt_start > 0) {
                    this._timing.full_fbu_total += this._timing.cur_fbu;
                    this._timing.full_fbu_cnt++;
                    Log.Info("Timing of full FBU, curr: " +
                              this._timing.cur_fbu + ", total: " +
                              this._timing.full_fbu_total + ", cnt: " +
                              this._timing.full_fbu_cnt + ", avg: " +
                              (this._timing.full_fbu_total / this._timing.full_fbu_cnt));
                }

                if (this._timing.fbu_rt_start > 0) {
                    var fbu_rt_diff = now - this._timing.fbu_rt_start;
                    this._timing.fbu_rt_total += fbu_rt_diff;
                    this._timing.fbu_rt_cnt++;
                    Log.Info("full FBU round-trip, cur: " +
                              fbu_rt_diff + ", total: " +
                              this._timing.fbu_rt_total + ", cnt: " +
                              this._timing.fbu_rt_cnt + ", avg: " +
                              (this._timing.fbu_rt_total / this._timing.fbu_rt_cnt));
                    this._timing.fbu_rt_start = 0;
                }
            }

            if (!ret) { return ret; }  // need more data
        }

        this._display.flip();

        return true;  // We finished this FBU
    },

    _updateContinuousUpdates: function() {
        if (!this._enabledContinuousUpdates) { return; }

        RFB.messages.enableContinuousUpdates(this._sock, true, 0, 0,
                                             this._fb_width, this._fb_height);
    },

    _resize: function(width, height) {
        this._fb_width = width;
        this._fb_height = height;

        this._destBuff = new Uint8Array(this._fb_width * this._fb_height * 4);

        this._display.resize(this._fb_width, this._fb_height);

        // Adjust the visible viewport based on the new dimensions
        this._updateClip();
        this._updateScale();

        this._timing.fbu_rt_start = (new Date()).getTime();
        this._updateContinuousUpdates();
    },

    _xvpOp: function (ver, op) {
        if (this._rfb_xvp_ver < ver) { return; }
        Log.Info("Sending XVP operation " + op + " (version " + ver + ")");
        RFB.messages.xvpOp(this._sock, ver, op);
    },
};

Object.assign(RFB.prototype, EventTargetMixin);

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
        sock.flush();
    },

    QEMUExtendedKeyEvent: function (sock, keysym, down, keycode) {
        function getRFBkeycode(xt_scancode) {
            var upperByte = (keycode >> 8);
            var lowerByte = (keycode & 0x00ff);
            if (upperByte === 0xe0 && lowerByte < 0x7f) {
                lowerByte = lowerByte | 0x80;
                return lowerByte;
            }
            return xt_scancode;
        }

        var buff = sock._sQ;
        var offset = sock._sQlen;

        buff[offset] = 255; // msg-type
        buff[offset + 1] = 0; // sub msg-type

        buff[offset + 2] = (down >> 8);
        buff[offset + 3] = down;

        buff[offset + 4] = (keysym >> 24);
        buff[offset + 5] = (keysym >> 16);
        buff[offset + 6] = (keysym >> 8);
        buff[offset + 7] = keysym;

        var RFBkeycode = getRFBkeycode(keycode);

        buff[offset + 8] = (RFBkeycode >> 24);
        buff[offset + 9] = (RFBkeycode >> 16);
        buff[offset + 10] = (RFBkeycode >> 8);
        buff[offset + 11] = RFBkeycode;

        sock._sQlen += 12;
        sock.flush();
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
        sock.flush();
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
        sock.flush();
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
        sock.flush();
    },

    clientFence: function (sock, flags, payload) {
        var buff = sock._sQ;
        var offset = sock._sQlen;

        buff[offset] = 248; // msg-type

        buff[offset + 1] = 0; // padding
        buff[offset + 2] = 0; // padding
        buff[offset + 3] = 0; // padding

        buff[offset + 4] = flags >> 24; // flags
        buff[offset + 5] = flags >> 16;
        buff[offset + 6] = flags >> 8;
        buff[offset + 7] = flags;

        var n = payload.length;

        buff[offset + 8] = n; // length

        for (var i = 0; i < n; i++) {
            buff[offset + 9 + i] = payload.charCodeAt(i);
        }

        sock._sQlen += 9 + n;
        sock.flush();
    },

    enableContinuousUpdates: function (sock, enable, x, y, width, height) {
        var buff = sock._sQ;
        var offset = sock._sQlen;

        buff[offset] = 150;             // msg-type
        buff[offset + 1] = enable;      // enable-flag

        buff[offset + 2] = x >> 8;      // x
        buff[offset + 3] = x;
        buff[offset + 4] = y >> 8;      // y
        buff[offset + 5] = y;
        buff[offset + 6] = width >> 8;  // width
        buff[offset + 7] = width;
        buff[offset + 8] = height >> 8; // height
        buff[offset + 9] = height;

        sock._sQlen += 10;
        sock.flush();
    },

    pixelFormat: function (sock, depth, true_color) {
        var buff = sock._sQ;
        var offset = sock._sQlen;

        var bpp, bits;

        if (depth > 16) {
            bpp = 32;
        } else if (depth > 8) {
            bpp = 16;
        } else {
            bpp = 8;
        }

        bits = Math.floor(depth/3);

        buff[offset] = 0;  // msg-type

        buff[offset + 1] = 0; // padding
        buff[offset + 2] = 0; // padding
        buff[offset + 3] = 0; // padding

        buff[offset + 4] = bpp;                 // bits-per-pixel
        buff[offset + 5] = depth;               // depth
        buff[offset + 6] = 0;                   // little-endian
        buff[offset + 7] = true_color ? 1 : 0;  // true-color

        buff[offset + 8] = 0;    // red-max
        buff[offset + 9] = (1 << bits) - 1;  // red-max

        buff[offset + 10] = 0;   // green-max
        buff[offset + 11] = (1 << bits) - 1; // green-max

        buff[offset + 12] = 0;   // blue-max
        buff[offset + 13] = (1 << bits) - 1; // blue-max

        buff[offset + 14] = bits * 2; // red-shift
        buff[offset + 15] = bits * 1; // green-shift
        buff[offset + 16] = bits * 0; // blue-shift

        buff[offset + 17] = 0;   // padding
        buff[offset + 18] = 0;   // padding
        buff[offset + 19] = 0;   // padding

        sock._sQlen += 20;
        sock.flush();
    },

    clientEncodings: function (sock, encodings) {
        var buff = sock._sQ;
        var offset = sock._sQlen;

        buff[offset] = 2; // msg-type
        buff[offset + 1] = 0; // padding

        buff[offset + 2] = encodings.length >> 8;
        buff[offset + 3] = encodings.length;

        var i, j = offset + 4;
        for (i = 0; i < encodings.length; i++) {
            var enc = encodings[i];
            buff[j] = enc >> 24;
            buff[j + 1] = enc >> 16;
            buff[j + 2] = enc >> 8;
            buff[j + 3] = enc;

            j += 4;
        }

        sock._sQlen += j - offset;
        sock.flush();
    },

    fbUpdateRequest: function (sock, incremental, x, y, w, h) {
        var buff = sock._sQ;
        var offset = sock._sQlen;

        if (typeof(x) === "undefined") { x = 0; }
        if (typeof(y) === "undefined") { y = 0; }

        buff[offset] = 3;  // msg-type
        buff[offset + 1] = incremental ? 1 : 0;

        buff[offset + 2] = (x >> 8) & 0xFF;
        buff[offset + 3] = x & 0xFF;

        buff[offset + 4] = (y >> 8) & 0xFF;
        buff[offset + 5] = y & 0xFF;

        buff[offset + 6] = (w >> 8) & 0xFF;
        buff[offset + 7] = w & 0xFF;

        buff[offset + 8] = (h >> 8) & 0xFF;
        buff[offset + 9] = h & 0xFF;

        sock._sQlen += 10;
        sock.flush();
    },

    xvpOp: function (sock, ver, op) {
        var buff = sock._sQ;
        var offset = sock._sQlen;

        buff[offset] = 250; // msg-type
        buff[offset + 1] = 0; // padding

        buff[offset + 2] = ver;
        buff[offset + 3] = op;

        sock._sQlen += 4;
        sock.flush();
    },
};

RFB.genDES = function (password, challenge) {
    var passwd = [];
    for (var i = 0; i < password.length; i++) {
        passwd.push(password.charCodeAt(i));
    }
    return (new DES(passwd)).encrypt(challenge);
};

RFB.encodingHandlers = {
    RAW: function () {
        if (this._FBU.lines === 0) {
            this._FBU.lines = this._FBU.height;
        }

        var pixelSize = this._fb_depth == 8 ? 1 : 4;
        this._FBU.bytes = this._FBU.width * pixelSize;  // at least a line
        if (this._sock.rQwait("RAW", this._FBU.bytes)) { return false; }
        var cur_y = this._FBU.y + (this._FBU.height - this._FBU.lines);
        var curr_height = Math.min(this._FBU.lines,
                                   Math.floor(this._sock.rQlen() / (this._FBU.width * pixelSize)));
        var data = this._sock.get_rQ();
        var index = this._sock.get_rQi();
        if (this._fb_depth == 8) {
            var pixels = this._FBU.width * curr_height
            var newdata = new Uint8Array(pixels * 4);
            var i;
            for (i = 0;i < pixels;i++) {
                newdata[i * 4 + 0] = ((data[index + i] >> 0) & 0x3) * 255 / 3;
                newdata[i * 4 + 1] = ((data[index + i] >> 2) & 0x3) * 255 / 3;
                newdata[i * 4 + 2] = ((data[index + i] >> 4) & 0x3) * 255 / 3;
                newdata[i * 4 + 4] = 0;
            }
            data = newdata;
            index = 0;
        }
        this._display.blitImage(this._FBU.x, cur_y, this._FBU.width,
                                curr_height, data, index);
        this._sock.rQskipBytes(this._FBU.width * curr_height * pixelSize);
        this._FBU.lines -= curr_height;

        if (this._FBU.lines > 0) {
            this._FBU.bytes = this._FBU.width * pixelSize;  // At least another line
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
            this._FBU.bytes = 4 + 4;
            if (this._sock.rQwait("RRE", 4 + 4)) { return false; }
            this._FBU.subrects = this._sock.rQshift32();
            color = this._sock.rQshiftBytes(4);  // Background
            this._display.fillRect(this._FBU.x, this._FBU.y, this._FBU.width, this._FBU.height, color);
        }

        while (this._FBU.subrects > 0 && this._sock.rQlen() >= (4 + 8)) {
            color = this._sock.rQshiftBytes(4);
            var x = this._sock.rQshift16();
            var y = this._sock.rQshift16();
            var width = this._sock.rQshift16();
            var height = this._sock.rQshift16();
            this._display.fillRect(this._FBU.x + x, this._FBU.y + y, width, height, color);
            this._FBU.subrects--;
        }

        if (this._FBU.subrects > 0) {
            var chunk = Math.min(this._rre_chunk_sz, this._FBU.subrects);
            this._FBU.bytes = (4 + 8) * chunk;
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
                this._fail("Illegal hextile subencoding (subencoding: " +
                           subencoding + ")");
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
                this._FBU.bytes += w * h * 4;
            } else {
                if (subencoding & 0x02) {  // Background
                    this._FBU.bytes += 4;
                }
                if (subencoding & 0x04) {  // Foreground
                    this._FBU.bytes += 4;
                }
                if (subencoding & 0x08) {  // AnySubrects
                    this._FBU.bytes++;  // Since we aren't shifting it off
                    if (this._sock.rQwait("hextile subrects header", this._FBU.bytes)) { return false; }
                    subrects = rQ[rQi + this._FBU.bytes - 1];  // Peek
                    if (subencoding & 0x10) {  // SubrectsColoured
                        this._FBU.bytes += subrects * (4 + 2);
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
                    Log.Debug("     Ignoring blank after RAW");
                } else {
                    this._display.fillRect(x, y, w, h, this._FBU.background);
                }
            } else if (this._FBU.subencoding & 0x01) {  // Raw
                this._display.blitImage(x, y, w, h, rQ, rQi);
                rQi += this._FBU.bytes - 1;
            } else {
                if (this._FBU.subencoding & 0x02) {  // Background
                    this._FBU.background = [rQ[rQi], rQ[rQi + 1], rQ[rQi + 2], rQ[rQi + 3]];
                    rQi += 4;
                }
                if (this._FBU.subencoding & 0x04) {  // Foreground
                    this._FBU.foreground = [rQ[rQi], rQ[rQi + 1], rQ[rQi + 2], rQ[rQi + 3]];
                    rQi += 4;
                }

                this._display.startTile(x, y, w, h, this._FBU.background);
                if (this._FBU.subencoding & 0x08) {  // AnySubrects
                    subrects = rQ[rQi];
                    rQi++;

                    for (var s = 0; s < subrects; s++) {
                        var color;
                        if (this._FBU.subencoding & 0x10) {  // SubrectsColoured
                            color = [rQ[rQi], rQ[rQi + 1], rQ[rQi + 2], rQ[rQi + 3]];
                            rQi += 4;
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

    TIGHT: function () {
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
                    Log.Info("Reset zlib stream " + i);
                }
            }

            //var uncompressed = this._FBU.zlibs[streamId].uncompress(data, 0);
            var uncompressed = this._FBU.zlibs[streamId].inflate(data, true, expected);
            /*if (uncompressed.status !== 0) {
                Log.Error("Invalid data in zlib stream");
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
            var paletteSize = numColors * 3;
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
            var uncompressedSize = this._FBU.width * this._FBU.height * 3;
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
        else return this._fail("Illegal tight compression received (ctl: " +
                               ctl + ")");

        switch (cmode) {
            // fill use depth because TPIXELs drop the padding byte
            case "fill":  // TPIXEL
                this._FBU.bytes += 3;
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
                data = this._sock.rQshiftBytes(cl_data);
                this._display.imageRect(this._FBU.x, this._FBU.y, "image/" + cmode, data);
                break;
            case "filter":
                var filterId = rQ[rQi + 1];
                if (filterId === 1) {
                    if (!handlePalette()) { return false; }
                } else {
                    // Filter 0, Copy could be valid here, but servers don't send it as an explicit filter
                    // Filter 2, Gradient is valid but not use if jpeg is enabled
                    this._fail("Unsupported tight subencoding received " +
                               "(filter: " + filterId + ")");
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

    last_rect: function () {
        this._FBU.rects = 0;
        return true;
    },

    ExtendedDesktopSize: function () {
        this._FBU.bytes = 1;
        if (this._sock.rQwait("ExtendedDesktopSize", this._FBU.bytes)) { return false; }

        var firstUpdate = !this._supportsSetDesktopSize;
        this._supportsSetDesktopSize = true;

        // Normally we only apply the current resize mode after a
        // window resize event. However there is no such trigger on the
        // initial connect. And we don't know if the server supports
        // resizing until we've gotten here.
        if (firstUpdate) {
            this._requestRemoteResize();
        }

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
            Log.Warn("Server did not accept the resize request: "
                     + msg);
        } else {
            this._resize(this._FBU.width, this._FBU.height);
        }

        this._FBU.bytes = 0;
        this._FBU.rects -= 1;
        return true;
    },

    DesktopSize: function () {
        this._resize(this._FBU.width, this._FBU.height);
        this._FBU.bytes = 0;
        this._FBU.rects -= 1;
        return true;
    },

    Cursor: function () {
        Log.Debug(">> set_cursor");
        var x = this._FBU.x;  // hotspot-x
        var y = this._FBU.y;  // hotspot-y
        var w = this._FBU.width;
        var h = this._FBU.height;

        var pixelslength = w * h * 4;
        var masklength = Math.floor((w + 7) / 8) * h;

        this._FBU.bytes = pixelslength + masklength;
        if (this._sock.rQwait("cursor encoding", this._FBU.bytes)) { return false; }

        this._display.changeCursor(this._sock.rQshiftBytes(pixelslength),
                                   this._sock.rQshiftBytes(masklength),
                                   x, y, w, h);

        this._FBU.bytes = 0;
        this._FBU.rects--;

        Log.Debug("<< set_cursor");
        return true;
    },

    QEMUExtendedKeyEvent: function () {
        this._FBU.rects--;

        // Old Safari doesn't support creating keyboard events
        try {
            var keyboardEvent = document.createEvent("keyboardEvent");
            if (keyboardEvent.code !== undefined) {
                this._qemuExtKeyEventSupported = true;
            }
        } catch (err) {
        }
    },
};
