/*
 * KasmVNC: HTML5 VNC client
 * Copyright (C) 2020 Kasm Technologies
 * Copyright (C) 2020 The noVNC Authors
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 *
 */

import { toUnsigned32bit, toSigned32bit } from './util/int.js';
import * as Log from './util/logging.js';
import { encodeUTF8, decodeUTF8, uuidv4 } from './util/strings.js';
import { hashUInt8Array } from './util/int.js';
import { dragThreshold, supportsCursorURIs, isTouchDevice, isWindows, isMac, isIOS, isDesktop } from './util/browser.js';
import { clientToElement } from './util/element.js';
import { setCapture } from './util/events.js';
import EventTargetMixin from './util/eventtarget.js';
import Display from "./display.js";
import Inflator from "./inflator.js";
import Deflator from "./deflator.js";
import Keyboard from "./input/keyboard.js";
import initializePrinterRelay from "./output/printer.js";
import GestureHandler from "./input/gesturehandler.js";
import Cursor from "./util/cursor.js";
import Websock from "./websock.js";
import DES from "./des.js";
import KeyTable from "./input/keysym.js";
import XtScancode from "./input/xtscancodes.js";
import { encodings } from "./encodings.js";
import { MouseButtonMapper, xvncButtonToMask } from "./mousebuttonmapper.js";

import RawDecoder from "./decoders/raw.js";
import CopyRectDecoder from "./decoders/copyrect.js";
import RREDecoder from "./decoders/rre.js";
import HextileDecoder from "./decoders/hextile.js";
import TightDecoder from "./decoders/tight.js";
import TightPNGDecoder from "./decoders/tightpng.js";
import UDPDecoder from './decoders/udp.js';
import { toSignedRelative16bit } from './util/int.js';

// How many seconds to wait for a disconnect to finish
const DISCONNECT_TIMEOUT = 3;
const DEFAULT_BACKGROUND = 'rgb(40, 40, 40)';

// Minimum wait (ms) between two mouse moves
const MOUSE_MOVE_DELAY = 17; 

// Wheel thresholds
let WHEEL_LINE_HEIGHT = 19; // Pixels for one line step (on Windows)

// Gesture thresholds
const GESTURE_ZOOMSENS = 75;
const GESTURE_SCRLSENS = 50;
const DOUBLE_TAP_TIMEOUT = 1000;
const DOUBLE_TAP_THRESHOLD = 50;

// Extended clipboard pseudo-encoding formats
const extendedClipboardFormatText   = 1;
/*eslint-disable no-unused-vars */
const extendedClipboardFormatRtf    = 1 << 1;
const extendedClipboardFormatHtml   = 1 << 2;
const extendedClipboardFormatDib    = 1 << 3;
const extendedClipboardFormatFiles  = 1 << 4;
/*eslint-enable */

// Extended clipboard pseudo-encoding actions
const extendedClipboardActionCaps    = 1 << 24;
const extendedClipboardActionRequest = 1 << 25;
const extendedClipboardActionPeek    = 1 << 26;
const extendedClipboardActionNotify  = 1 << 27;
const extendedClipboardActionProvide = 1 << 28;

export default class RFB extends EventTargetMixin {
    constructor(target, touchInput, urlOrChannel, options, isPrimaryDisplay) {
        if (!target) {
            throw new Error("Must specify target");
        }
        if (!urlOrChannel && isPrimaryDisplay) {
            throw new Error("Must specify URL, WebSocket or RTCDataChannel");
        }

        super();

        this._target = target;

        if (typeof urlOrChannel === "string") {
            this._url = urlOrChannel;
        } else {
            this._url = null;
            this._rawChannel = urlOrChannel;
        }

        // Connection details
        options = options || {};
        this._rfbCredentials = options.credentials || {};
        this._shared = 'shared' in options ? !!options.shared : true;
        this._repeaterID = options.repeaterID || '';
        this._wsProtocols = options.wsProtocols || ['binary'];
        this._isPrimaryDisplay = (isPrimaryDisplay !== false);

        // Internal state
        this._rfbConnectionState = '';
        this._rfbInitState = '';
        this._rfbAuthScheme = -1;
        this._rfbCleanDisconnect = true;

        // Server capabilities
        this._rfbVersion = 0;
        this._rfbMaxVersion = 3.8;
        this._rfbTightVNC = false;
        this._rfbVeNCryptState = 0;
        this._rfbXvpVer = 0;
        this._fbWidth = 0;
        this._fbHeight = 0;
        this._fbName = "";
        this._capabilities = { power: false };
        this._supportsFence = false;
        this._supportsContinuousUpdates = false;
        this._enabledContinuousUpdates = false;
        this._supportsSetDesktopSize = false;
        this._connectionID = window.location.href.split('?')[0].match(/^(.+)(\/)/)[0];
        this._screenFlags = 0;
        this._qemuExtKeyEventSupported = false;

        // kasm defaults
        this._jpegVideoQuality = 5;
        this._webpVideoQuality = 5;
        this._treatLossless = 7;
        this._preferBandwidth = true;
        this._dynamicQualityMin = 3;
        this._dynamicQualityMax = 9;
        this._videoArea = 65;
        this._videoTime = 5;
        this._videoOutTime = 3;
        this._videoScaling = 2;
        this._frameRate = 30;
        this._maxVideoResolutionX = 960;
        this._maxVideoResolutionY = 540;
        this._forcedResolutionX = null;
        this._forcedResolutionY = null;
        this._clipboardBinary = true;
        this._resendClipboardNextUserDrivenEvent = true;
        this._useUdp = true;
        this._hiDpi = 'hiDpi' in options ? !!options.hiDpi : false;
        this._enableQOI = false;
        this._videoQuality =  2;
        this._enableWebP = false;
        this.TransitConnectionStates = {
            Tcp: Symbol("tcp"),
            Udp: Symbol("udp"),
            Upgrading: Symbol("upgrading"),
            Downgrading: Symbol("downgrading"),
            Failure: Symbol("failure")
        }
        this._transitConnectionState = this.TransitConnectionStates.Tcp;
        this._lastTransition = null;
        this._udpConnectFailures = 0; //Failures in upgrading connection to udp
        this._udpTransitFailures = 0; //Failures in transit after successful upgrade

        this._trackFrameStats = false;

        this._clipboardText = null;
        this._clipboardServerCapabilitiesActions = {};
        this._clipboardServerCapabilitiesFormats = {};

        // Internal objects
        this._sock = null;              // Websock object
        this._display = null;           // Display object
        this._flushing = false;         // Display flushing state
        this._keyboard = null;          // Keyboard input handler object
        this._gestures = null;          // Gesture input handler object

        // Timers
        this._disconnTimer = null;      // disconnection timer
        this._resizeTimeout = null;     // resize rate limiting
        this._mouseMoveTimer = null;
        this._forceFullFrameUpdateTimeout = null;

        // Decoder states
        this._decoders = {};

        this._FBU = {
            rects: 0, // current rect number
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            encoding: null,
            frame_id: 0,
            rect_total: 0, //Total rects in frame
        };

        // Mouse state
        this._mousePos = {};
        this._mouseButtonMask = 0;
        this._mouseLastMoveTime = 0;
        this._pointerLock = false;
        this._pointerLockPos = { x: 0, y: 0 };
        this._pointerRelativeEnabled = false;
        this._mouseLastPinchAndZoomTime = 0;
        this._viewportDragging = false;
        this._viewportDragPos = {};
        this._viewportHasMoved = false;
        this._accumulatedWheelDeltaX = 0;
        this._accumulatedWheelDeltaY = 0;
        this.mouseButtonMapper = null;
        this._mouseLastScreenIndex = -1;
        this._sendLeftClickonNextMove = false;

        // Gesture state
        this._gestureLastTapTime = null;
        this._gestureFirstDoubleTapEv = null;
        this._gestureLastMagnitudeX = 0;
        this._gestureLastMagnitudeY = 0;

        // Secondary Displays
        this._supportsBroadcastChannel = (typeof BroadcastChannel !== "undefined");
        if (this._supportsBroadcastChannel) {
            this._controlChannel = new BroadcastChannel(this._connectionID);
            this._controlChannel.addEventListener('message', this._handleControlMessage.bind(this));
            Log.Debug("Attached to registrationChannel for secondary displays.")
            
        }
        if (!this._isPrimaryDisplay) {
            this._screenIndex = 2;
        }

        // Bound event handlers
        this._eventHandlers = {
            updateHiddenKeyboard: this._updateHiddenKeyboard.bind(this),
            focusCanvas: this._focusCanvas.bind(this),
            windowResize: this._windowResize.bind(this),
            handleMouse: this._handleMouse.bind(this),
            handlePointerLockChange: this._handlePointerLockChange.bind(this),
            handlePointerLockError: this._handlePointerLockError.bind(this),
            handleWheel: this._handleWheel.bind(this),
            handleGesture: this._handleGesture.bind(this),
            handleFocusChange: this._handleFocusChange.bind(this),
            handleMouseOut: this._handleMouseOut.bind(this),
            handleVisibilityChange: this._handleVisibilityChange.bind(this),
        };

        // main setup
        Log.Debug(">> RFB.constructor");

        // Create DOM elements
        this._screen = document.createElement('div');
        this._screen.style.display = 'flex';
        this._screen.style.width = '100%';
        this._screen.style.height = '100%';
        this._screen.style.overflow = 'auto';
        this._screen.style.background = DEFAULT_BACKGROUND;
        this._canvas = document.createElement('canvas');
        this._canvas.style.margin = 'auto';
        // Some browsers add an outline on focus
        this._canvas.style.outline = 'none';
        this._canvas.width = 0;
        this._canvas.height = 0;
        this._canvas.tabIndex = -1;
        this._canvas.overflow = 'hidden';
        this._screen.appendChild(this._canvas);

        // Cursor
        this._cursor = new Cursor();

        // XXX: TightVNC 2.8.11 sends no cursor at all until Windows changes
        // it. Result: no cursor at all until a window border or an edit field
        // is hit blindly. But there are also VNC servers that draw the cursor
        // in the framebuffer and don't send the empty local cursor. There is
        // no way to satisfy both sides.
        //
        // The spec is unclear on this "initial cursor" issue. Many other
        // viewers (TigerVNC, RealVNC, Remmina) display an arrow as the
        // initial cursor instead.
        this._cursorImage = RFB.cursors.none;

        // NB: nothing that needs explicit teardown should be done
        // before this point, since this can throw an exception
        try {
            this._display = new Display(this._canvas, this._isPrimaryDisplay);
        } catch (exc) {
            Log.Error("Display exception: " + exc);
            throw exc;
        }
        this._display.onflush = this._onFlush.bind(this);

        // populate decoder array with objects
        this._decoders[encodings.encodingRaw] = new RawDecoder();
        this._decoders[encodings.encodingCopyRect] = new CopyRectDecoder();
        this._decoders[encodings.encodingRRE] = new RREDecoder();
        this._decoders[encodings.encodingHextile] = new HextileDecoder();
        this._decoders[encodings.encodingTight] = new TightDecoder(this._display);
        this._decoders[encodings.encodingTightPNG] = new TightPNGDecoder();
        this._decoders[encodings.encodingUDP] = new UDPDecoder();

        this._keyboard = new Keyboard(this._canvas, touchInput);
        this._keyboard.onkeyevent = this._handleKeyEvent.bind(this);

        this._gestures = new GestureHandler();

        if (this._isPrimaryDisplay) {
            this._setupWebSocket();
        } 

        Log.Debug("<< RFB.constructor");

        // ===== PROPERTIES =====
        this.dragViewport = false;
        this.focusOnClick = true;
        this.lastActiveAt = Date.now();

        this._viewOnly = false;
        this._clipViewport = false;
        this._scaleViewport = false;
        this._resizeSession = false;
        this._lastVisibilityState = "visible";

        this._showDotCursor = false;
        if (options.showDotCursor !== undefined) {
            Log.Warn("Specifying showDotCursor as a RFB constructor argument is deprecated");
            this._showDotCursor = options.showDotCursor;
        }

        this._qualityLevel = 6;
        this._compressionLevel = 2;
        this._clipHash = 0;
    }

    // ===== PROPERTIES =====
    
    get connectionID() { return this._connectionID; }

    get translateShortcuts() { return this._keyboard.translateShortcuts; }
    set translateShortcuts(value) {
        this._keyboard.translateShortcuts = value;
    }

    get pointerLock() { return this._pointerLock; }
    set pointerLock(value) {
        if (!this._pointerLock) {
            if (this._canvas.requestPointerLock) {
                this._canvas.requestPointerLock();
                this._pointerLockChanging = true;
            } else if (this._canvas.mozRequestPointerLock) {
                this._canvas.mozRequestPointerLock();
                this._pointerLockChanging = true;
            }
        } else {
            if (window.document.exitPointerLock) {
                window.document.exitPointerLock();
                this._pointerLockChanging = true;
            } else if (window.document.mozExitPointerLock) {
                window.document.mozExitPointerLock();
                this._pointerLockChanging = true;
            }
        }
    }

    get pointerRelative() { return this._pointerRelativeEnabled; }
    set pointerRelative(value) 
    { 
        this._pointerRelativeEnabled = value; 
        if (value) {
            let max_w = ((this._display.scale === 1) ? this._fbWidth : (this._fbWidth * this._display.scale));
            let max_h = ((this._display.scale === 1) ? this._fbHeight : (this._fbHeight * this._display.scale));
            this._pointerLockPos.x = Math.floor(max_w / 2);
            this._pointerLockPos.y = Math.floor(max_h / 2);

            // reset the cursor position to center
            this._mousePos = { x: this._pointerLockPos.x , y: this._pointerLockPos.y };
            this._cursor.move(this._pointerLockPos.x, this._pointerLockPos.y);
        }
    }

    get keyboard() { return this._keyboard; }

    get clipboardBinary() { return this._clipboardMode; }
    set clipboardBinary(val) { this._clipboardMode = val; }

    get videoQuality() { return this._videoQuality; }
    set videoQuality(quality) 
    { 
        //if changing to or from a video quality mode that uses a fixed resolution server side
        if (this._videoQuality <= 1 || quality <= 1) {
            this._pendingApplyResolutionChange = true;
        }
        this._videoQuality = quality;
        this._pendingApplyEncodingChanges = true;
    }

    get preferBandwidth() { return this._preferBandwidth; }
    set preferBandwidth(val) { 
        this._preferBandwidth = val; 
        this._pendingApplyEncodingChanges = true;
    }

    get viewOnly() { return this._viewOnly; }
    set viewOnly(viewOnly) {
        this._viewOnly = viewOnly;

        if (this._rfbConnectionState === "connecting" ||
            this._rfbConnectionState === "connected") {
            if (viewOnly) {
                this._keyboard.ungrab();
            } else {
                this._keyboard.grab();
            }
        }
    }

    get capabilities() { return this._capabilities; }

    get touchButton() { return 0; }
    set touchButton(button) { Log.Warn("Using old API!"); }

    get clipViewport() { return this._clipViewport; }
    set clipViewport(viewport) {
        this._clipViewport = viewport;
    }

    get scaleViewport() { return this._scaleViewport; }
    set scaleViewport(scale) {
        if (this._scaleViewport !== scale) {
            this._scaleViewport = scale;
            this._pendingApplyResolutionChange = true;
        }
    }

    get resizeSession() { return this._resizeSession; }
    set resizeSession(resize) {
        this._resizeSession = resize;
        if (resize) {
            this.scaleViewport = true;
            this._pendingApplyResolutionChange = true;
        }
    }

    get showDotCursor() { return this._showDotCursor; }
    set showDotCursor(show) {
        this._showDotCursor = show;
        this._refreshCursor();
    }

    get background() { return this._screen.style.background; }
    set background(cssValue) { this._screen.style.background = cssValue; }

    get enableWebP() { return this._enableWebP; }
    set enableWebP(enabled) { 
        if (this._enableWebP === enabled) {
            return;
        }
        this._enableWebP = enabled; 
        this._pendingApplyEncodingChanges = true;
    }

    get enableQOI() { return this._enableQOI; }
    set enableQOI(enabled) {
        if(this._enableQOI === enabled) {
            return;
        }

        this._decoders[encodings.encodingTight].enableQOI = enabled;
        this._enableQOI = this._decoders[encodings.encodingTight].enableQOI
        
        if (this._enableQOI === enabled) {
            this._pendingApplyEncodingChanges = true;
        }
        
    }

    get antiAliasing() { return this._display.antiAliasing; }
    set antiAliasing(value) {
       this._display.antiAliasing = value;
    }

    get jpegVideoQuality() { return this._jpegVideoQuality; }
    set jpegVideoQuality(qualityLevel) {
        if (!Number.isInteger(qualityLevel) || qualityLevel < 0 || qualityLevel > 9) {
            Log.Error("qualityLevel must be an integer between 0 and 9");
            return;
        }

        if (this._jpegVideoQuality === qualityLevel) {
            return;
        }

        this._jpegVideoQuality = qualityLevel;
        this._pendingApplyEncodingChanges = true;
    }

    get webpVideoQuality() { return this._webpVideoQuality; }
    set webpVideoQuality(qualityLevel) {
        if (!Number.isInteger(qualityLevel) || qualityLevel < 0 || qualityLevel > 9) {
            Log.Error("qualityLevel must be an integer between 0 and 9");
            return;
        }

        if (this._webpVideoQuality === qualityLevel) {
            return;
        }

        this._webpVideoQuality = qualityLevel;
        this._pendingApplyEncodingChanges = true;
    }

    get treatLossless() { return this._treatLossless; }
    set treatLossless(qualityLevel) {
        if (!Number.isInteger(qualityLevel) || qualityLevel < 0 || qualityLevel > 9) {
            Log.Error("qualityLevel must be an integer between 0 and 9");
            return;
        }

        if (this._treatLossless === qualityLevel) {
            return;
        }

        this._treatLossless = qualityLevel;
    }

    get dynamicQualityMin() { return this._dynamicQualityMin; }
    set dynamicQualityMin(qualityLevel) {
        if (!Number.isInteger(qualityLevel) || qualityLevel < 0 || qualityLevel > 9) {
            Log.Error("qualityLevel must be an integer between 0 and 9");
            return;
        }

        if (this._dynamicQualityMin === qualityLevel) {
            return;
        }

        this._dynamicQualityMin = qualityLevel;
        this._pendingApplyEncodingChanges = true;
    }

    get dynamicQualityMax() { return this._dynamicQualityMax; }
    set dynamicQualityMax(qualityLevel) {
        if (!Number.isInteger(qualityLevel) || qualityLevel < 0 || qualityLevel > 9) {
            Log.Error("qualityLevel must be an integer between 0 and 9");
            return;
        }

        if (this._dynamicQualityMax === qualityLevel) {
            return;
        }

        this._dynamicQualityMax = qualityLevel;
        this._pendingApplyEncodingChanges = true;
    }

    get videoArea() {
        return this._videoArea;
    }
    set videoArea(area) {
        if (!Number.isInteger(area) || area < 0 || area > 100) {
            Log.Error("video area must be an integer between 0 and 100");
            return;
        }

        if (this._videoArea === area) {
            return;
        }

        this._videoArea = area;
        this._pendingApplyEncodingChanges = true;
    }

    get videoTime() {
        return this._videoTime;
    }
    set videoTime(value) {
        if (!Number.isInteger(value) || value < 0 || value > 100) {
            Log.Error("video time must be an integer between 0 and 100");
            return;
        }

        if (this._videoTime === value) {
            return;
        }

        this._videoTime = value;
        this._pendingApplyEncodingChanges = true;
    }

    get videoOutTime() {
        return this._videoOutTime;
    }
    set videoOutTime(value) {
        if (!Number.isInteger(value) || value < 0 || value > 100) {
            Log.Error("video out time must be an integer between 0 and 100");
            return;
        }

        if (this._videoOutTime === value) {
            return;
        }

        this._videoOutTime = value;
        this._pendingApplyEncodingChanges = true;
    }

    get videoScaling() {
        return this._videoScaling;
    }
    set videoScaling(value) {
        if (!Number.isInteger(value) || value < 0 || value > 2) {
            Log.Error("video scaling must be an integer between 0 and 2");
            return;
        }

        if (this._videoScaling === value) {
            return;
        }

        this._videoScaling = value;
        this._pendingApplyEncodingChanges = true;
    }

    get frameRate() { return this._frameRate; }
    set frameRate(value) {
        if (!Number.isInteger(value) || value < 1 || value > 120) {
            Log.Error("frame rate must be an integer between 1 and 120");
            return;
        }

        if (this._frameRate === value) {
            return;
        }

        this._frameRate = value;
        this._pendingApplyEncodingChanges = true;
    }

    get maxVideoResolutionX() { return this._maxVideoResolutionX; }
    set maxVideoResolutionX(value) {
        if (!Number.isInteger(value) || value < 100 ) {
            Log.Error("max video resolution must be an integer greater than 100");
            return;
        }

        if (this._maxVideoResolutionX === value) {
            return;
        }

        this._maxVideoResolutionX = value;
        this._pendingApplyVideoRes = true;
    }

    get maxVideoResolutionY() { return this._maxVideoResolutionY; }
    set maxVideoResolutionY(value) {
        if (!Number.isInteger(value) || value < 100 ) {
            Log.Error("max video resolution must be an integer greater than 100");
            return;
        }

        if (this._maxVideoResolutionY === value) {
            return;
        }

        this._maxVideoResolutionY = value;
        this._pendingApplyVideoRes = true;
    }

    get forcedResolutionX() { return this._forcedResolutionX; }
    set forcedResolutionX(value) {
        if (value !== this._forcedResolutionX) {
            this._forcedResolutionX = value;
            this._pendingApplyResolutionChange = true;
        }
    }

    get forcedResolutionY() { return this._forcedResolutionY; }
    set forcedResolutionY(value) {
        if (value !== this._forcedResolutionY) {
            this._forcedResolutionY = value;
            this._pendingApplyResolutionChange = true;
        }
    }

    get qualityLevel() {
        return this._qualityLevel;
    }
    set qualityLevel(qualityLevel) {
        if (!Number.isInteger(qualityLevel) || qualityLevel < 0 || qualityLevel > 9) {
            Log.Error("qualityLevel must be an integer between 0 and 9");
            return;
        }

        if (this._qualityLevel === qualityLevel) {
            return;
        }

        this._qualityLevel = qualityLevel;
        this._pendingApplyEncodingChanges = true;
    }

    get compressionLevel() {
        return this._compressionLevel;
    }
    set compressionLevel(compressionLevel) {
        if (!Number.isInteger(compressionLevel) || compressionLevel < 0 || compressionLevel > 9) {
            Log.Error("compressionLevel must be an integer between 0 and 9");
            return;
        }

        if (this._compressionLevel === compressionLevel) {
            return;
        }

        this._compressionLevel = compressionLevel;

        if (this._rfbConnectionState === 'connected') {
            this._sendEncodings();
        }
    }

    get statsFps() { return this._display.fps; }

    get enableWebRTC() { return this._useUdp; }
    set enableWebRTC(value) {
        this._useUdp = value;
        if (!value) {
            if (this._rfbConnectionState === 'connected' && (this._transitConnectionState !== this.TransitConnectionStates.Tcp)) {
                this._sendUdpDowngrade();
            } 
        } else {
            if (this._rfbConnectionState === 'connected' && (this._transitConnectionState !== this.TransitConnectionStates.Udp)) {
                this._sendUdpUpgrade();
            }
        }
    }

    get enableHiDpi() { return this._hiDpi; }
    set enableHiDpi(value) {
        if (value !== this._hiDpi) {
            this._hiDpi = value;
            this._pendingApplyResolutionChange = true;
            this._display.applyServerResolution(0, 0, 0);
        }
    }

    // ===== PUBLIC METHODS =====

    refreshSecondaryDisplays() {
        //send secondary displays new settings
        if (this._display.screens.length > 1) {
            this._proxyRFBMessage('applySettings', [ this._hiDpi, this._clipViewport, this._scaleViewport, this._resizeSession, this._videoQuality, this._forcedResolutionX, this._forcedResolutionY ]);
        }
    }

    attachSecondaryDisplay(details) {
        this._updateConnectionState('connecting');
        const screen = this._registerSecondaryDisplay(false, details);
        this._updateConnectionState('connected');
        return screen
    }

    reattachSecondaryDisplay(screen, details) {
        this._updateConnectionState('connecting');
        this._registerSecondaryDisplay(screen, details);
        this._updateConnectionState('connected');
        return screen
    }


    applyScreenPlan(screenPlan) {
        if (this._isPrimaryDisplay) {
            let fullPlan = this._screenSize();

            //check plan for validity
            let minX = Number.MAX_SAFE_INTEGER, minY = Number.MAX_SAFE_INTEGER;
            let numScreensFound = 0;

            for (let i = 0; i < screenPlan.screens.length; i++) {
                minX = Math.min(minX, screenPlan.screens[i].x);
                minY = Math.min(minY, screenPlan.screens[i].y);
                for (let z = 0; z < fullPlan.screens.length; z++) {
                    if (screenPlan.screens[i].screenID == fullPlan.screens[z].screenID) {
                        numScreensFound++;
                    }
                }
            }
            if (minX !== 0 || minY !== 0) {
                throw new Error("Screen plan invalid, improper coordinates provided.");
            }
            if (numScreensFound > fullPlan.screens.length) {
                throw new Error("Screen plan contained more screens then there are registered.")
            } else if (numScreensFound < fullPlan.screens.length) {
                throw new Error("Screen plan contained fewer screens then there are registered.")
            }

            //apply screen plan on primary display
            let changes = this._display.applyScreenPlan(screenPlan);

            if (changes) {
                //send updates to secondary screens
                for (let i = 0; i < screenPlan.screens.length; i++) {
                    for (let z = 1; z < fullPlan.screens.length; z++) {
                        if (screenPlan.screens[i].screenID == fullPlan.screens[z].screenID) {
                            this._proxyRFBMessage('applyScreenPlan', [ fullPlan.screens[z].screenID, fullPlan.screens[z].screenIndex, screenPlan.screens[i].width, screenPlan.screens[i].height, screenPlan.screens[i].x, screenPlan.screens[i].y ]);
                        }
                    }
                }

                this._pendingApplyResolutionChange = true;
            } else {
                Log.Debug("Screen plan did not apply, no changes detected.");
            }
            
            return changes;
        }
    }

    getScreenPlan() {
        let fullPlan = this._screenSize();
        let sanitizedPlan = {
            screens: [],
            serverWidth: fullPlan.serverWidth,
            serverHeight: fullPlan.serverHeight
        };

        for (let i=0; i < fullPlan.screens.length; i++) {
            sanitizedPlan.screens.push(
                {
                    screenID: fullPlan.screens[i].screenID,
                    serverWidth: fullPlan.screens[i].serverWidth,
                    serverHeight: fullPlan.screens[i].serverHeight,
                    x: fullPlan.screens[i].x,
                    y: fullPlan.screens[i].y,
                    pixelRatio: fullPlan.screens[i].pixelRatio
                }
            )
        }

        return sanitizedPlan;
    }

    /*
    This function must be called after changing any properties that effect rendering quality
    */
    updateConnectionSettings() {
        if (this._rfbConnectionState === 'connected' && this._isPrimaryDisplay) {
            
            if (this._pendingApplyVideoRes) {
                RFB.messages.setMaxVideoResolution(this._sock, this._maxVideoResolutionX, this._maxVideoResolutionY);
            }

            if (this._pendingApplyResolutionChange) {
                this._screenSize();
                // Scaling trumps clipping, so we may need to adjust
                // clipping when enabling or disabling scaling
                if (this._scaleViewport && this._clipViewport) {
                    this._updateClip();
                }
                this._updateScale();
                if (!this._scaleViewport && this._clipViewport) {
                    this._updateClip();
                }

                if (this._display.screens.length > 1) {
                    this.refreshSecondaryDisplays();
                } 

                if (this._resizeSession || (this._forcedResolutionX && this._forcedResolutionY)) {
                    this.dispatchEvent(new CustomEvent("screenregistered", {}));
                    clearTimeout(this._resizeTimeout);
                    this._resizeTimeout = setTimeout(this._requestRemoteResize.bind(this), 500);
                }
            }

            if (this._pendingApplyEncodingChanges) {
                this._sendEncodings();
            }

            this._pendingApplyVideoRes = false;
            this._pendingApplyEncodingChanges = false;
            this._pendingApplyResolutionChange = false;
        } else if (!this._isPrimaryDisplay) {
            if (this._pendingApplyResolutionChange) {
                if (this._scaleViewport && this._clipViewport) {
                    this._updateClip();
                }
                this._updateScale();
                if (!this._scaleViewport && this._clipViewport) {
                    this._updateClip();
                }
            }

            if (this._resizeSession || (this._forcedResolutionX && this._forcedResolutionY)) {
                this._requestRemoteResize();
            }
        }
        
    }

    disconnect() {
        if (this._isPrimaryDisplay) {
            this._updateConnectionState('disconnecting');
            this._sock.off('error');
            this._sock.off('message');
            this._sock.off('open');
            this._proxyRFBMessage('disconnect');
        } else {
            this._updateConnectionState('disconnecting');
            this._unregisterSecondaryDisplay();
            this._rfbConnectionState = "";
        }
    }

    terminate() {
        if (this._isPrimaryDisplay) {
            //disconnect the rfb connection
            this._updateConnectionState('disconnecting');
            this._sock.off('error');
            this._sock.off('message');
            this._sock.off('open');
            //close secondary display windows
            this._proxyRFBMessage('terminate');
        }
    }

    sendCtrlAltDel() {
        if (this._rfbConnectionState !== 'connected' || this._viewOnly) { return; }
        Log.Info("Sending Ctrl-Alt-Del");

        this.sendKey(KeyTable.XK_Control_L, "ControlLeft", true);
        this.sendKey(KeyTable.XK_Alt_L, "AltLeft", true);
        this.sendKey(KeyTable.XK_Delete, "Delete", true);
        this.sendKey(KeyTable.XK_Delete, "Delete", false);
        this.sendKey(KeyTable.XK_Alt_L, "AltLeft", false);
        this.sendKey(KeyTable.XK_Control_L, "ControlLeft", false);
    }

    machineShutdown() {
        this._xvpOp(1, 2);
    }

    machineReboot() {
        this._xvpOp(1, 3);
    }

    machineReset() {
        this._xvpOp(1, 4);
    }

    // Send a key press. If 'down' is not specified then send a down key
    // followed by an up key.
    sendKey(keysym, code, down) {
        if (this._rfbConnectionState !== 'connected' || this._viewOnly) { return; }

        if (code !== null) {
            this._setLastActive();
        }
        
        if (down === undefined) {
            this.sendKey(keysym, code, true);
            this.sendKey(keysym, code, false);
            return;
        }

        const scancode = XtScancode[code];

        if (this._qemuExtKeyEventSupported && scancode) {
            // 0 is NoSymbol
            keysym = keysym || 0;

            Log.Info("Sending key (" + (down ? "down" : "up") + "): keysym " + keysym + ", scancode " + scancode);

            if (this._isPrimaryDisplay) {
                RFB.messages.QEMUExtendedKeyEvent(this._sock, keysym, down, scancode);
            } else {
                this._proxyRFBMessage('QEMUExtendedKeyEvent', [ keysym, down, scancode ])
            }
        } else {
            if (!keysym) {
                return;
            }
            Log.Info("Sending keysym (" + (down ? "down" : "up") + "): " + keysym);
            if (this._isPrimaryDisplay) {
                RFB.messages.keyEvent(this._sock, keysym, down ? 1 : 0);
            } else {
                this._proxyRFBMessage('keyEvent', [ keysym, down ? 1 : 0 ])
            }
        }
    }

    focus() {
        this._keyboard.focus();
    }

    blur() {
        this._keyboard.blur();
    }

    checkLocalClipboard() {
        if (this.clipboardUp && this.clipboardSeamless && this._resendClipboardNextUserDrivenEvent) {
            this._resendClipboardNextUserDrivenEvent = false;
            if (this.clipboardBinary) {
                navigator.clipboard.read().then((data) => {
                    this.clipboardPasteDataFrom(data);
                }, (err) => {
                    Log.Debug("No data in clipboard: " + err);
                }); 
            } else {
                if (navigator.clipboard && navigator.clipboard.readText) {
                    navigator.clipboard.readText().then(function (text) {
                        this.clipboardPasteFrom(text);
                    }.bind(this)).catch(function () {
                      return Log.Debug("Failed to read system clipboard");
                    });
                }
            }
        }
    }

    clipboardPasteFrom(text) {
        if (this._rfbConnectionState !== 'connected' || this._viewOnly) { return; }
        if (!(typeof text === 'string' && text.length > 0)) { return; }

        let data = new TextEncoder().encode(text);

        let h = hashUInt8Array(data);
        // avoid resending the same data if larger than 64k
        if (h === this._clipHash) {
            Log.Debug('No clipboard changes');
            return;
        } else {
            this._clipHash = h;
        }

        let dataset = [];
        let mimes = [ 'text/plain' ];
        dataset.push(data);

        if (this._isPrimaryDisplay) {
            RFB.messages.sendBinaryClipboard(this._sock, dataset, mimes);
        } else {
            this._proxyRFBMessage('sendBinaryClipboard', [ dataset, mimes ]);
        }
        
    }

    async clipboardPasteDataFrom(clipdata) {
        if (this._rfbConnectionState !== 'connected' || this._viewOnly) { return; }

        let dataset = [];
        let mimes = [];
        let h = 0;
        for (let i = 0; i < clipdata.length; i++) {
            for (let ti = 0; ti < clipdata[i].types.length; ti++) {
                let mime = clipdata[i].types[ti];

                switch (mime) {
                    case 'image/png':
                    case 'text/plain':
                    case 'text/html':
                        let blob = await clipdata[i].getType(mime);
                        if (!blob) {
                            continue;
                        }
                        let buff = await blob.arrayBuffer();
                        let data = new Uint8Array(buff);

                        if (!h) {
                            h = hashUInt8Array(data);
                            // avoid resending the same data if larger than 64k
                            if (h === this._clipHash) {
                                Log.Debug('No clipboard changes');
                                return;
                            } else {
                                this._clipHash = h;
                            }
                        }

                        if (mimes.includes(mime)) {
                            continue;
                        }

                        mimes.push(mime); 
                        dataset.push(data);
                        Log.Debug('Sending mime type: ' + mime);
                        break;
                    default:
                        Log.Info('skipping clip send mime type: ' + mime)
                }

            }
        }

        //if png is present and  text/plain is not, remove other variations of images to save bandwidth
        //if png is present with text/plain, then remove png. Word will put in a png of copied text
        if (mimes.includes('image/png') && !mimes.includes('text/plain')) {
            let i = mimes.indexOf('image/png');
            mimes = mimes.slice(i, i+1);
            dataset = dataset.slice(i, i+1);
        } else if (mimes.includes('image/png') && mimes.includes('text/plain')) {
            let i = mimes.indexOf('image/png');
            mimes.splice(i, 1);
            dataset.splice(i, 1);
        }


        if (dataset.length > 0) {
            if (this._isPrimaryDisplay) {
                RFB.messages.sendBinaryClipboard(this._sock, dataset, mimes);
            } else {
                this._proxyRFBMessage('sendBinaryClipboard', [ dataset, mimes ]);
            }
        }
        
    }

    requestBottleneckStats() {
        if (this._isPrimaryDisplay) {
            RFB.messages.requestStats(this._sock);
        }
    }

    subscribeUnixRelay(name, processRelayFn) {
        if (this._isPrimaryDisplay){
            this._unixRelays = this._unixRelays || {};
            this._unixRelays[name] = processRelayFn;
            RFB.messages.sendSubscribeUnixRelay(this._sock, name);
        }
    }

    sendUnixRelayData(name, payload) {
        if (this._isPrimaryDisplay) {
            RFB.messages.sendUnixRelay(this._sock, name, payload);
        }
    }

    // ===== PRIVATE METHODS =====

    _setLastActive() {
        this.lastActiveAt = Date.now();
    }

    _changeTransitConnectionState(value) {
        Log.Info("Transit state change from " + this._transitConnectionState.toString() + ' to ' + value.toString());
        this._transitConnectionState = value;
    }

    _setupWebSocket() {
        this._sock = new Websock();
        this._sock.on('message', () => {
            this._handleMessage();
        });
        this._sock.on('open', () => {
            if ((this._rfbConnectionState === 'connecting') &&
                (this._rfbInitState === '')) {
                this._rfbInitState = 'ProtocolVersion';
                Log.Debug("Starting VNC handshake");
            } else {
                this._fail("Unexpected server connection while " +
                           this._rfbConnectionState);
            }
        });
        this._sock.on('close', (e) => {
            Log.Debug("WebSocket on-close event");
            let msg = "";
            if (e.code) {
                msg = "(code: " + e.code;
                if (e.reason) {
                    msg += ", reason: " + e.reason;
                }
                msg += ")";
            }
            switch (this._rfbConnectionState) {
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
            // Delete reference to raw channel to allow cleanup.
            this._rawChannel = null;
        });
        this._sock.on('error', e => Log.Warn("WebSocket on-error event"));

        // Slight delay of the actual connection so that the caller has
        // time to set up callbacks
        setTimeout(this._updateConnectionState.bind(this, 'connecting'));
    }

    _connect() {
        Log.Debug(">> RFB.connect");

        if (this._url && this._isPrimaryDisplay) {
            try {
                Log.Info(`connecting to ${this._url}`);
                this._sock.open(this._url, this._wsProtocols);
                this._setLastActive();
            } catch (e) {
                if (e.name === 'SyntaxError') {
                    this._fail("Invalid host or port (" + e + ")");
                } else {
                    this._fail("Error when opening socket (" + e + ")");
                }
            }
        } else if (this._isPrimaryDisplay) {
            try {
                Log.Info(`attaching ${this._rawChannel} to Websock`);
                this._sock.attach(this._rawChannel);
            } catch (e) {
                this._fail("Error attaching channel (" + e + ")");
            }
        }

        // Make our elements part of the page
        this._target.appendChild(this._screen);

        this._gestures.attach(this._canvas);

        this._cursor.attach(this._canvas);
        this._refreshCursor();

        // Monitor size changes of the screen
        // FIXME: Use ResizeObserver, or hidden overflow
        window.addEventListener('resize', this._eventHandlers.windowResize);

        // Always grab focus on some kind of click event
        this._canvas.addEventListener("mousedown", this._eventHandlers.focusCanvas);
        this._canvas.addEventListener("touchstart", this._eventHandlers.focusCanvas);
        this._canvas.addEventListener("focus", this._eventHandlers.handleFocusChange);
        window.addEventListener("focus", this._eventHandlers.handleFocusChange);
        window.addEventListener("blur", this._eventHandlers.handleFocusChange);
        document.addEventListener("visibilitychange", this._eventHandlers.handleVisibilityChange);

        //User cursor moves outside of the window
        window.addEventListener("mouseover", this._eventHandlers.handleMouseOut);

        // In order for the keyboard to not occlude the input being edited
        // we move the hidden input we use for triggering the keyboard to the last click
        // position which should trigger a page being moved down enough
        // to show the input. On Android the whole website gets resized so we don't
        // have to do anything.
        if (isIOS()) {
            this._canvas.addEventListener("touchend", this._eventHandlers.updateHiddenKeyboard);
        }

        // Mouse events
        this._canvas.addEventListener('mousedown', this._eventHandlers.handleMouse);
        this._canvas.addEventListener('mouseup', this._eventHandlers.handleMouse);
        this._canvas.addEventListener('mousemove', this._eventHandlers.handleMouse);
        // Prevent middle-click pasting (see handler for why we bind to document)
        this._canvas.addEventListener('click', this._eventHandlers.handleMouse);
        // preventDefault() on mousedown doesn't stop this event for some
        // reason so we have to explicitly block it
        this._canvas.addEventListener('contextmenu', this._eventHandlers.handleMouse);

        // Pointer Lock listeners need to be installed in document instead of the canvas.
        if (document.onpointerlockchange !== undefined) {
            document.addEventListener('pointerlockchange', this._eventHandlers.handlePointerLockChange, false);
            document.addEventListener('pointerlockerror', this._eventHandlers.handlePointerLockError, false);
        } else if (document.onmozpointerlockchange !== undefined) {
            document.addEventListener('mozpointerlockchange', this._eventHandlers.handlePointerLockChange, false);
            document.addEventListener('mozpointerlockerror', this._eventHandlers.handlePointerLockError, false);
        }

        // Wheel events
        this._canvas.addEventListener("wheel", this._eventHandlers.handleWheel);

        // Gesture events
        this._canvas.addEventListener("gesturestart", this._eventHandlers.handleGesture);
        this._canvas.addEventListener("gesturemove", this._eventHandlers.handleGesture);
        this._canvas.addEventListener("gestureend", this._eventHandlers.handleGesture);

        this._resendClipboardNextUserDrivenEvent = true;

        // WebRTC UDP datachannel inits
        if (typeof RTCPeerConnection !== 'undefined' && this._isPrimaryDisplay) {
            this._udpBuffer = new Map();

            this._udpPeer = new RTCPeerConnection({
                iceServers: [{
                    urls: ["stun:stun.l.google.com:19302"]
                }]
            });
            let peer = this._udpPeer;

            peer.onicecandidate = function(e) {
                if (e.candidate)
                    Log.Debug("received ice candidate", e.candidate);
                else
                    Log.Debug("all candidates received");
            }

            peer.ondatachannel = function(e) {
                Log.Debug("peer connection on data channel", e);
            }

            this._udpChannel = peer.createDataChannel("webudp", {
                ordered: false,
                maxRetransmits: 0
            });
            this._udpChannel.binaryType = "arraybuffer";

            this._udpChannel.onerror = function(e) {
                Log.Error("data channel error " + e.message);
                this._udpTransitFailures+=1;
                this._sendUdpDowngrade();
            }

            let sock = this._sock;
            let udpBuffer = this._udpBuffer;
            let me = this;
            this._udpChannel.onmessage = function(e) {
                //Log.Info("got udp msg", e.data);
                const u8 = new Uint8Array(e.data);
                // Got an UDP packet. Do we need reassembly?
                const id = parseInt(u8[0] +
                                    (u8[1] << 8) +
                                    (u8[2] << 16) +
                                    (u8[3] << 24), 10);
                const i = parseInt(u8[4] +
                                   (u8[5] << 8) +
                                   (u8[6] << 16) +
                                   (u8[7] << 24), 10);
                const pieces = parseInt(u8[8] +
                                        (u8[9] << 8) +
                                        (u8[10] << 16) +
                                        (u8[11] << 24), 10);
                const hash = parseInt(u8[12] +
                                        (u8[13] << 8) +
                                        (u8[14] << 16) +
                                        (u8[15] << 24), 10);
                // TODO: check the hash. It's the low 32 bits of XXH64, seed 0
                const frame_id = parseInt(u8[16] +
                                        (u8[17] << 8) +
                                        (u8[18] << 16) +
                                        (u8[19] << 24), 10);

                if (me._transitConnectionState !== me.TransitConnectionStates.Udp) {
                    me._display.clear();
                    me._changeTransitConnectionState(me.TransitConnectionStates.Udp);
                }

                if (pieces == 1) { // Handle it immediately
                    me._handleUdpRect(u8.slice(20), frame_id);
                } else { // Use buffer
                    const now = Date.now();
		    
                    if (udpBuffer.has(id)) {
                        let item = udpBuffer.get(id);
                        item.recieved_pieces += 1;
                        item.data[i] = u8.slice(20);
                        item.total_bytes += item.data[i].length;

                        if (item.total_pieces == item.recieved_pieces) {
                            // Message is complete, combile data into a single array
                            var finaldata = new Uint8Array(item.total_bytes);
                            let z = 0;
                            for (let x = 0; x < item.data.length; x++) {
                                finaldata.set(item.data[x], z);
                                z += item.data[x].length;
                            }
                            udpBuffer.delete(id);
                            me._handleUdpRect(finaldata, frame_id);
                        }
                    } else {
                        let item = {
                            total_pieces: pieces,   // number of pieces expected
                                arrival: now,       //time first piece was recieved
                            recieved_pieces: 1,     // current number of pieces in data
                            total_bytes: 0,         // total size of all data pieces combined
                            data: new Array(pieces)
                        }
                        item.data[i] = u8.slice(20);
                        item.total_bytes = item.data[i].length;
                        udpBuffer.set(id, item);
                    }
                }
            }
        }

	    if (this._useUdp && typeof RTCPeerConnection !== 'undefined' && this._isPrimaryDisplay) {
            setTimeout(function() { this._sendUdpUpgrade() }.bind(this), 3000);
        }

        Log.Debug("<< RFB.connect");
    }

    _disconnect() {
        Log.Debug(">> RFB.disconnect");
        this._cursor.detach();
        this._canvas.removeEventListener("gesturestart", this._eventHandlers.handleGesture);
        this._canvas.removeEventListener("gesturemove", this._eventHandlers.handleGesture);
        this._canvas.removeEventListener("gestureend", this._eventHandlers.handleGesture);
        this._canvas.removeEventListener("wheel", this._eventHandlers.handleWheel);
        this._canvas.removeEventListener('mousedown', this._eventHandlers.handleMouse);
        this._canvas.removeEventListener('mouseup', this._eventHandlers.handleMouse);
        this._canvas.removeEventListener('mousemove', this._eventHandlers.handleMouse);
        this._canvas.removeEventListener('click', this._eventHandlers.handleMouse);
        this._canvas.removeEventListener('contextmenu', this._eventHandlers.handleMouse);
        if (document.onpointerlockchange !== undefined) {
            document.removeEventListener('pointerlockchange', this._eventHandlers.handlePointerLockChange);
            document.removeEventListener('pointerlockerror', this._eventHandlers.handlePointerLockError);
        } else if (document.onmozpointerlockchange !== undefined) {
            document.removeEventListener('mozpointerlockchange', this._eventHandlers.handlePointerLockChange);
            document.removeEventListener('mozpointerlockerror', this._eventHandlers.handlePointerLockError);
        }
        this._canvas.removeEventListener("mousedown", this._eventHandlers.focusCanvas);
        this._canvas.removeEventListener("touchstart", this._eventHandlers.focusCanvas);
        this._canvas.removeEventListener("focus", this._eventHandlers.handleFocusChange);
        window.removeEventListener('resize', this._eventHandlers.windowResize);
        window.removeEventListener('focus', this._eventHandlers.handleFocusChange);
        document.removeEventListener('visibilitychange', this._eventHandlers.handleVisibilityChange);

        this._keyboard.ungrab();
        this._gestures.detach();
        if (this._isPrimaryDisplay) {
            this._sock.close();
        } else {
            if (this._primaryDisplayChannel) {
                this._primaryDisplayChannel.postMessage({eventType: 'unregister', screenID: this._display.screenID})
                this._primaryDisplayChannel.removeEventListener('message', this._handleSecondaryDisplayMessage);
                this._primaryDisplayChannel.close();
                this._primaryDisplayChannel = null;
            }
        }
        
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
        this._display.dispose();
        clearTimeout(this._resizeTimeout);
        clearTimeout(this._mouseMoveTimer);
        window.localStorage.removeItem('lastWindow')
        Log.Debug("<< RFB.disconnect");
    }

    _updateHiddenKeyboard(event) {
        // On iOS 15 the navigation bar is at the bottom so we need to account for it
        const y = Math.max(0, event.pageY - 50);
        document.querySelector("#noVNC_keyboardinput").style.top = `${y}px`;
    }

    _handleFocusChange(event) {
        this._resendClipboardNextUserDrivenEvent = true;
        if (event.type == 'focus' && event.currentTarget instanceof Window) {

            if (this._lastVisibilityState === 'visible') {
                const lastWindow = window.localStorage.getItem('lastWindow')
                Log.Debug("Window focused while user switched between windows.");
                // added for multi-montiors
                // as user moves from window to window, focus change loses a click, this marks the next mouse
                // move to simulate a left click. We wait for the next mouse move because we need accurate x,y coords
                if (lastWindow != event.currentTarget.name) {
                    this._sendLeftClickonNextMove = true;
                    window.localStorage.setItem('lastWindow', event.currentTarget.name)
                }
            } else {
                Log.Debug("Window focused while user switched between tabs.");
            }
            
        }

        if (document.visibilityState === "visible" && this._lastVisibilityState === "hidden") {
            Log.Debug("Window is now visible.");
            this._lastVisibilityState = document.visibilityState;
        }
    }

    _handleVisibilityChange(event) {
        if (document.visibilityState === "hidden") {
            this._lastVisibilityState = document.visibilityState;
            Log.Debug("Window is not visible.")
        }
    }

    _focusCanvas(event) {
        // Hack:
        // On most mobile phones it's possible to play audio
        // only if it's triggered by user action. It's also
        // impossible to listen for touch events on child frames (on mobile phones)
        // so we catch those events here but forward the audio unlocking to the parent window
        window.parent.postMessage({
            action: "enable_audio",
            value: null
        }, "*");

        // Re-enable pointerLock if relative cursor is enabled
        // pointerLock must come from user initiated event
        if (!this._pointerLock && this._pointerRelativeEnabled) {
            this.pointerLock = true;
        }

        if (this._resendClipboardNextUserDrivenEvent) {
            this.checkLocalClipboard();
        }

        if (!this.focusOnClick) {
            return;
        }

        this.focus();

    }

    _setDesktopName(name) {
        this._fbName = name;
        this.dispatchEvent(new CustomEvent(
            "desktopname",
            { detail: { name: this._fbName } }));
    }

    _windowResize(event) {
        // If the window resized then our screen element might have
        // as well. Update the viewport dimensions.
        window.requestAnimationFrame(() => {
            this._screenSize();
            this._updateClip();
            this._updateScale();
        });

        this.dispatchEvent(new CustomEvent("screenregistered", { }));

        if (this._resizeSession) {
            // Request changing the resolution of the remote display to
            // the size of the local browser viewport.

            // In order to not send multiple requests before the browser-resize
            // is finished we wait 0.5 seconds before sending the request.
            clearTimeout(this._resizeTimeout);
            this._resizeTimeout = setTimeout(this._requestRemoteResize.bind(this), 500);
        }
    }

    // Update state of clipping in Display object, and make sure the
    // configured viewport matches the current screen size
    _updateClip() {
        const curClip = this._display.clipViewport;
        let newClip = this._clipViewport;

        if (this._scaleViewport) {
            // Disable viewport clipping if we are scaling
            newClip = false;
        }

        if (curClip !== newClip) {
            this._display.clipViewport = newClip;
        }

        if (newClip) {
            // When clipping is enabled, the screen is limited to
            // the size of the container.
            const size = this._screenSize();
            this._display.viewportChangeSize(size.screens[0].serverWidth, size.screens[0].serverHeight);
            this._fixScrollbars();
        }
    }

    _updateScale() {
        if (!this._scaleViewport) {
            this._display.scale = 1.0;
        } else {
            const size = this._screenSize();
            this._display.autoscale(size.screens[0].width, size.screens[0].height, size.screens[0].scale);
        }
        this._fixScrollbars();
    }

    // Requests a change of remote desktop size. This message is an extension
    // and may only be sent if we have received an ExtendedDesktopSize message
    _requestRemoteResize() {
        clearTimeout(this._resizeTimeout);
        this._resizeTimeout = null;

        if (this._isPrimaryDisplay) {
            if (
                (this._viewOnly || !this._supportsSetDesktopSize) ||
                (!this._resizeSession && !this._forcedResolutionX && !this._forcedResolutionY)
            ) {
                return;
            }

            //zero out the server reported resolution
            for (let i=0; i < this._display.screens.length; i++) {
                this._display.applyServerResolution(0, 0, this._display.screens[i].screenIndex);
            }

            const size = this._screenSize();
            this._forceFullFrameUpdateAfterResize = true;
            RFB.messages.setDesktopSize(this._sock, size, this._screenFlags);

            Log.Debug('Requested new desktop size: ' +
                   size.serverWidth + 'x' + size.serverHeight);
        } else if (this._display.screenIndex > 0) {
            //re-register the secondary display with new resolution
            let details = null
            const initialAutoPlacementValue = window.localStorage.getItem('autoPlacement')
            if (initialAutoPlacementValue === null) {
                details = {
                    left: window.screenLeft,
                    top: window.screenTop
                }
            }
 
            this._registerSecondaryDisplay(this._display.screens[0], details);
        }
    }

    // Gets the the size of the available screen
    _screenSize (limited) {
        return this._display.getScreenSize(this.videoQuality, this.forcedResolutionX, this.forcedResolutionY, this._hiDpi, limited, !this._resizeSession);
    }

    _fixScrollbars() {
        // This is a hack because Chrome screws up the calculation
        // for when scrollbars are needed. So to fix it we temporarily
        // toggle them off and on.
        const orig = this._screen.style.overflow;
        this._screen.style.overflow = 'hidden';
        // Force Chrome to recalculate the layout by asking for
        // an element's dimensions
        this._screen.getBoundingClientRect();
        this._screen.style.overflow = orig;
    }

    /*
     * Connection states:
     *   connecting
     *   connected
     *   disconnecting
     *   disconnected - permanent state
     */
    _updateConnectionState(state) {
        const oldstate = this._rfbConnectionState;

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

            case 'proxied':
                //secondary display that needs to proxy messages through the broadcast channel
                break;

            default:
                Log.Error("Unknown connection state: " + state);
                return;
        }

        // State change actions

        this._rfbConnectionState = state;

        Log.Debug("New state '" + state + "', was '" + oldstate + "'.");

        if (this._disconnTimer && state !== 'disconnecting') {
            Log.Debug("Clearing disconnect timer");
            clearTimeout(this._disconnTimer);
            this._disconnTimer = null;

            // make sure we don't get a double event
            if (this._isPrimaryDisplay) {
                this._sock.off('close');
            }
        }
        
        switch (state) {
            case 'connecting':
                this._connect();
                break;

            case 'connected':
                this.dispatchEvent(new CustomEvent("connect", { detail: {} }));
                break;

            case 'disconnecting':
                this._disconnect();

                this._disconnTimer = setTimeout(() => {
                    Log.Error("Disconnection timed out.");
                    this._updateConnectionState('disconnected');
                    this._proxyRFBMessage('secondarydisconnected')
                }, DISCONNECT_TIMEOUT * 1000);
                break;

            case 'disconnected':
                this.dispatchEvent(new CustomEvent(
                    "disconnect", { detail:
                                    { clean: this._rfbCleanDisconnect } }));
                break;
        }
    }

    /* Print errors and disconnect
     *
     * The parameter 'details' is used for information that
     * should be logged but not sent to the user interface.
     */
    _fail(details) {
        switch (this._rfbConnectionState) {
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
        this._rfbCleanDisconnect = false; //This is sent to the UI

        // Transition to disconnected without waiting for socket to close
        this._updateConnectionState('disconnecting');
        this._updateConnectionState('disconnected');

        return false;
    }

    _setCapability(cap, val) {
        this._capabilities[cap] = val;
        this.dispatchEvent(new CustomEvent("capabilities",
                                           { detail: { capabilities: this._capabilities } }));
    }

    _proxyRFBMessage(messageType, data) {
        let message = { 
            eventType: messageType,
            args: data,
            screenID: this._display.screenID,
            screenIndex: this._display.screenIndex,
            mouseLastScreenIndex: this._mouseLastScreenIndex,
        }
        this._controlChannel.postMessage(message);
    }

    _handleControlMessage(event) {
        if (this._isPrimaryDisplay) {
            // Secondary to Primary screen message
            let size;
            let coords;
            switch (event.data.eventType) {
                case 'register':
                    const details = {
                        ...event.data.details,
                        screenID: event.data.screenID
                    }
                    let screenIndex = this._display.addScreen(event.data.screenID, event.data.width, event.data.height, event.data.pixelRatio, event.data.containerHeight, event.data.containerWidth, event.data.scale, event.data.serverWidth, event.data.serverHeight, event.data.x, event.data.y);
                    this._proxyRFBMessage('screenRegistrationConfirmed', [ this._display.screens[screenIndex].screenID, screenIndex ]);
                    this._sendEncodings();
                    clearTimeout(this._resizeTimeout);
                    this._resizeTimeout = setTimeout(this._requestRemoteResize.bind(this), 500);
                    this.dispatchEvent(new CustomEvent("screenregistered", { detail: details }));
                    Log.Info(`Secondary monitor (${event.data.screenID}) has been registered.`);
                    break;
                case 'reattach':
                    let changes = this._display.addScreen(event.data.screenID, event.data.width, event.data.height, event.data.pixelRatio, event.data.containerHeight, event.data.containerWidth, event.data.scale, event.data.serverWidth, event.data.serverHeight, event.data.x, event.data.y);
                    
                    clearTimeout(this._resizeTimeout);
                    this._resizeTimeout = setTimeout(this._requestRemoteResize.bind(this), 500);
                    this.dispatchEvent(new CustomEvent("screenregistered", {}));
                    Log.Info(`Secondary monitor (${event.data.screenID}) has been reattached.`);
                    break;
                case 'unregister':
                    if (this._display.removeScreen(event.data.screenID)) {
                        this.dispatchEvent(new CustomEvent("screenregistered", {}));
                        Log.Info(`Secondary monitor (${event.data.screenID}) has been removed.`);
                        const size = this._screenSize();
                        RFB.messages.setDesktopSize(this._sock, size, this._screenFlags);
                        this._sendEncodings();
                        this._updateContinuousUpdates();
                        this.dispatchEvent(new CustomEvent("screenregistered", {}));
                    } else {
                        Log.Info(`Secondary monitor (${event.data.screenID}) not found.`);
                    }
                    break;
                case 'mousemove':
                    coords = this._display.getServerRelativeCoordinates(event.data.screenIndex, event.data.args[0], event.data.args[1]);
                    this._mouseLastScreenIndex = event.data.screenIndex;
                    this._mousePos = { 'x': coords[0], 'y': coords[1] };
                    if (this._mouseButtonMask !== 0 && !event.data.args[2]) {
                        this._mouseButtonMask = 0;
                    }
                    RFB.messages.pointerEvent(this._sock, this._mousePos.x, this._mousePos.y, this._mouseButtonMask);

                    //simulate a left click
                    if (event.data.args[3]) {
                        this._mouseButtonMask |= 0x1;
                        RFB.messages.pointerEvent(this._sock, this._mousePos.x, this._mousePos.y, this._mouseButtonMask);
                        this._mouseButtonMask &= ~0x1;
                        RFB.messages.pointerEvent(this._sock, this._mousePos.x, this._mousePos.y, this._mouseButtonMask);
                        Log.Debug('Simulated Left Click on secondary display.');
                    }
                    break;
                case 'mousedown':
                    coords = this._display.getServerRelativeCoordinates(event.data.screenIndex, event.data.args[0], event.data.args[1]);
                    this._mouseLastScreenIndex = event.data.screenIndex;
                    this._mousePos = { 'x': coords[0], 'y': coords[1] };
                    this._mouseButtonMask |= event.data.args[2];
                    RFB.messages.pointerEvent(this._sock, this._mousePos.x, this._mousePos.y, this._mouseButtonMask);
                    break;
                case 'mouseup':
                    coords = this._display.getServerRelativeCoordinates(event.data.screenIndex, event.data.args[0], event.data.args[1]);
                    this._mouseLastScreenIndex = event.data.screenIndex;
                    this._mousePos = { 'x': coords[0], 'y': coords[1] };
                    this._mouseButtonMask &= ~event.data.args[2];
                    RFB.messages.pointerEvent(this._sock, this._mousePos.x, this._mousePos.y, this._mouseButtonMask);
                    break;
                case 'scroll':
                    coords = this._display.getServerRelativeCoordinates(event.data.screenIndex, event.data.args[0], event.data.args[1]);
                    this._mouseLastScreenIndex = event.data.screenIndex;
                    this._mousePos = { 'x': coords[0], 'y': coords[1] };
                    RFB.messages.pointerEvent(this._sock, this._mousePos.x, this._mousePos.y, 0, event.data.args[2], event.data.args[3]);
                    break;
                case 'keyEvent':
                    RFB.messages.keyEvent(this._sock, ...event.data.args);
                    break;
                case 'sendBinaryClipboard':
                    RFB.messages.sendBinaryClipboard(this._sock, ...event.data.args);
                    break;
                // The following are primary to secondary messages that should be ignored on the primary
                case 'updateCursor':
                    break;
            }
        } else {
            // Primary to secondary screen message
            switch (event.data.eventType) {
                case 'updateCursor':
                    this._updateCursor(...event.data.args);
                    this._mouseLastScreenIndex = event.data.mouseLastScreenIndex;
                    break;
                case 'receivedClipboard':
                    if (event.data.mouseLastScreenIndex === this._display.screenIndex) {
                        this._write_binary_clipboard(...event.data.args);
                    }
                    break;
                case 'disconnect':
                    this.disconnect();
                    break;
                case 'terminate':
                    this.disconnect();
                    window.close();
                    break;
                case 'applySettings':
                        if (!this._isPrimaryDisplay) {
                            this.enableHiDpi = event.data.args[0];
                            this.clipViewport = event.data.args[1];
                            this.scaleViewport = event.data.args[2];
                            this.resizeSession = event.data.args[3];
                            this.videoQuality = event.data.args[4];
                            //TODO: add support for forced static resolution for multiple monitors
                            //this._forcedResolutionX = event.data.args[5];
                            //this._forcedResolutionY = event.data.args[6];

                            //TODO, do we need to do this twice
                            this.scaleViewport = event.data.args[3];
                            this.updateConnectionSettings();
                        }
                        
                break;
                case 'applyScreenPlan':
                    if (event.data.args[0] == this._display.screenID) {
                        this._display.screens[0].screenIndex = event.data.args[1];
                        this._display.screens[0].width = event.data.args[2];
                        this._display.screens[0].height = event.data.args[3];
                        this._display.screens[0].x = event.data.args[4];
                        this._display.screens[0].y = event.data.args[5];
                        
                        this.updateConnectionSettings();
                    }
                    break;
                case 'screenRegistrationConfirmed':
                    if (event.data.args[0] == this._display.screenID) {
                        this._display.screens[0].screenIndex = event.data.args[1];
                    }
                    break;
            }
        }
        
    }

    _unregisterSecondaryDisplay() {
        if (!this._isPrimaryDisplay){
            let message = {
                eventType: 'unregister',
                screenID: this._display.screenID
            }
            this._controlChannel.postMessage(message);
        }
        
    }

    _registerSecondaryDisplay(currentScreen = false, details = null) {
        if (!this._isPrimaryDisplay) {
            const registerType = (currentScreen) ? 'reattach' : 'register'

            let size = this._screenSize();
            this._display.resize(size.screens[0].serverWidth, size.screens[0].serverHeight);
            this._display.autoscale(size.screens[0].serverWidth, size.screens[0].serverHeight, size.screens[0].scale);
            
            let screen = size.screens[0];
            
            let message = {
                eventType: registerType,
                screenID: screen.screenID,
                width: screen.width,
                height: screen.height,
                x: currentScreen.x || 0,
                y: currentScreen.y || 0,
                pixelRatio: screen.pixelRatio,
                scale: screen.scale,
                serverWidth: screen.serverWidth,
                serverHeight: screen.serverHeight,
                containerWidth: screen.containerWidth,
                containerHeight: screen.containerHeight,
                channel: null,
                details
            }
            this._controlChannel.postMessage(message);

            if (!this._viewOnly) { this._keyboard.grab(); }
            // return screen.screenID
            return screen
        }
        
    }

    identify(screens) {
        let message = {
            eventType: 'identify',
            screens
        }
        this._controlChannel.postMessage(message);
    }

    _handleSecondaryDisplayMessage(event) {
        if (this._isPrimaryDisplay) {

        }
    }

    _handleMessage() {
        if (this._sock.rQlen === 0) {
            Log.Warn("handleMessage called on an empty receive queue");
            return;
        }

        switch (this._rfbConnectionState) {
            case 'disconnected':
                Log.Error("Got data while disconnected");
                break;
            case 'connected':
                while (true) {
                    if (this._flushing) {
                        break;
                    }
                    if (!this._normalMsg()) {
                        break;
                    }
                    if (this._sock.rQlen === 0) {
                        break;
                    }
                }
                break;
            default:
                this._initMsg();
                break;
        }
    }

    _handleKeyEvent(keysym, code, down) {
        this.sendKey(keysym, code, down);
    }

    _handleMouseOut(ev) {
        if (ev.toElement !== null && ev.relatedTarget === null && ev.fromElement === null) {
            //mouse was outside of the window and just came in, this is our chance to do things
            //Ensure the window was not moved to a different screen with a different pixel ratio
            if (this._display.screens[0].pixelRatio !== window.devicePixelRatio) {
                Log.Debug("Window moved to another screen with different pixel ratio, sending resize request.");
                if (this._isPrimaryDisplay && this._display.screens.length > 1) {
                    //this.refreshSecondaryDisplays();
                    this.dispatchEvent(new CustomEvent("screenregistered", {}));
                } else {
                    this._requestRemoteResize();
                }
                
            }
        } 
    }

    _handleMouse(ev) {
        /*
         * We don't check connection status or viewOnly here as the
         * mouse events might be used to control the viewport
         */

        if (ev.type === 'click') {
            /*
             * Note: This is only needed for the 'click' event as it fails
             *       to fire properly for the target element so we have
             *       to listen on the document element instead.
             */
            if (ev.target !== this._canvas) {
                return;
            }
        }

        // FIXME: if we're in view-only and not dragging,
        //        should we stop events?
        ev.stopPropagation();

        if ((ev.type === 'click') || (ev.type === 'contextmenu')) {
            ev.preventDefault();
            return;
        }

        let pos;
        if (this._pointerLock && !this._pointerRelativeEnabled) {
            let max_w = ((this._display.scale === 1) ? this._fbWidth : (this._fbWidth * this._display.scale));
            let max_h = ((this._display.scale === 1) ? this._fbHeight : (this._fbHeight * this._display.scale));
            pos = {
                x: this._mousePos.x + ev.movementX,
                y: this._mousePos.y + ev.movementY,
            };
            if (pos.x < 0) {
                pos.x = 0;
            } else if (pos.x > max_w) {
                pos.x = max_w;
            }
            if (pos.y < 0) {
                pos.y = 0;
            } else if (pos.y > max_h) {
                pos.y = max_h;
            }
            this._cursor.move(pos.x, pos.y);
        } else if (this._pointerLock && this._pointerRelativeEnabled) {
            pos = {
                x: this._mousePos.x + ev.movementX,
                y: this._mousePos.y + ev.movementY,
            };
        } else {
            pos = clientToElement(ev.clientX, ev.clientY,
                                  this._canvas);
        }

        this._mouseLastScreenIndex = this._display.screenIndex;
        this._setLastActive();
        const mappedButton = this.mouseButtonMapper.get(ev.button);
        switch (ev.type) {
            case 'mousedown':
                if (this._display.screens.length === 0 || window.self === window.top) {
                	ev.preventDefault();
                }
                setCapture(this._canvas);

                // Translate CMD+Click into CTRL+click on MacOs
                if (
                    isMac() &&
                    ev.metaKey &&
                    (this._keyboard._keyDownList["MetaLeft"] || this._keyboard._keyDownList["MetaRight"])
                ) {
                    this._keyboard._sendKeyEvent(this._keyboard._keyDownList["MetaLeft"], "MetaLeft", false);
                    this._keyboard._sendKeyEvent(this._keyboard._keyDownList["MetaRight"], "MetaRight", false);
                    this._keyboard._sendKeyEvent(KeyTable.XK_Control_L, "ControlLeft", true);
                }

                // Ensure keys down are synced between client and server
                this._keyboard.clearKeysDown(ev);

                if (this._isPrimaryDisplay) {
                    this._handleMouseButton(pos.x, pos.y, true, xvncButtonToMask(mappedButton));
                } else {
                    this._proxyRFBMessage('mousedown', [ pos.x, pos.y, xvncButtonToMask(mappedButton) ]);
                }
                
                Log.Debug('Mouse Down');
                break;
            case 'mouseup':
                ev.preventDefault();
                if (this._isPrimaryDisplay) {
                    this._handleMouseButton(pos.x, pos.y, false, xvncButtonToMask(mappedButton));
                } else {
                    this._proxyRFBMessage('mouseup', [ pos.x, pos.y, xvncButtonToMask(mappedButton) ]);
                }
                
                Log.Debug('Mouse Up');
                break;
            case 'mousemove':
            	ev.preventDefault();
                if (this._isPrimaryDisplay) {
                    this._handleMouseMove(pos.x, pos.y, (ev.buttons > 0));
                } else {
                    this._proxyRFBMessage('mousemove', [ pos.x, pos.y, (ev.buttons > 0), this._sendLeftClickonNextMove ]);
                    this._sendLeftClickonNextMove = false;
                }
                break;
            default:
                ev.preventDefault();
                break;
        }
    }

    _handleMouseButton(x, y, down, bmask) {
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
                this._sendMouse(x, y, bmask);
            }
        }

        // Flush waiting move event first
        if (this._mouseMoveTimer !== null) {
            clearTimeout(this._mouseMoveTimer);
            this._mouseMoveTimer = null;
            this._sendMouse(x, y, this._mouseButtonMask);
        }

        if (down) {
            this._mouseButtonMask |= bmask;
        } else {
            this._mouseButtonMask &= ~bmask;
        }

        this._sendMouse(x, y, this._mouseButtonMask);

        //marked true on canvas going into focus
        this._sendLeftClickonNextMove = false;
    }

    _handleMouseMove(x, y, down, simulated=false) {
        if (this._viewportDragging) {
            const deltaX = this._viewportDragPos.x - x;
            const deltaY = this._viewportDragPos.y - y;

            if (this._viewportHasMoved || (Math.abs(deltaX) > dragThreshold ||
                                           Math.abs(deltaY) > dragThreshold)) {
                this._viewportHasMoved = true;

                this._viewportDragPos = {'x': x, 'y': y};
                this._display.viewportChangePos(deltaX, deltaY);
            }

            // Skip sending mouse events
            return;
        }

        // With multiple displays, it is possible to end up in a state where we lost the mouseup event
        // If a mouse move indicates no buttons are down but the current state shows something down, lets clear the plate
        if (this._display.screens.length > 1 && this._mouseButtonMask !== 0 && !down && !simulated && isDesktop()) {
            this._mouseButtonMask = 0;
            Log.Debug('Mouse event button down mismatch with current mask, resetting mask to 0.')
        }

        this._mousePos = { 'x': x, 'y': y };

        // Limit many mouse move events to one every MOUSE_MOVE_DELAY ms
        if (this._mouseMoveTimer == null) {

            const timeSinceLastMove = Date.now() - this._mouseLastMoveTime;
            if (timeSinceLastMove > MOUSE_MOVE_DELAY) {
                this._sendMouse(x, y, this._mouseButtonMask);
                this._mouseLastMoveTime = Date.now();
            } else {
                // Too soon since the latest move, wait the remaining time
                this._mouseMoveTimer = setTimeout(() => {
                    this._handleDelayedMouseMove();
                }, MOUSE_MOVE_DELAY - timeSinceLastMove);
            }
        }

        //Simulate a left click on focus change
        //this was added to aid multi-display, not requiring two clicks when switching between displays
        if (this._sendLeftClickonNextMove && this._display.screens.length > 1) {
            this._sendLeftClickonNextMove = false;
            this._handleMouseButton(this._mousePos.x, this._mousePos.y, true, 0x1);
            this._handleMouseButton(this._mousePos.x, this._mousePos.y, false, 0x1);
        }
    }

    _handleDelayedMouseMove() {
        this._mouseMoveTimer = null;
        this._sendMouse(this._mousePos.x, this._mousePos.y,
                        this._mouseButtonMask);
        this._mouseLastMoveTime = Date.now();
    }

    _handlePointerLockChange(env) {
        if (
            document.pointerLockElement === this._canvas ||
            document.mozPointerLockElement === this._canvas
        ) {
            this._pointerLock = true;
            this._cursor.setEmulateCursor(true);
        } else {
            this._pointerLock = false;
            this._cursor.setEmulateCursor(false);
        }
        this.dispatchEvent(new CustomEvent(
            "inputlock",
            { detail: { pointer: this._pointerLock }, }));
    }

    _handlePointerLockError() {
        this._pointerLockChanging = false;
        this.dispatchEvent(new CustomEvent(
            "inputlockerror",
            { detail: { pointer: this._pointerLock }, }));
    }

    _sendMouse(x, y, mask) {
        if (this._rfbConnectionState !== 'connected') { return; }
        if (this._viewOnly) { return; } // View only, skip mouse events
        if (!this._isPrimaryDisplay) { return; }

        if (this._pointerLock && this._pointerRelativeEnabled) {

            // Use releative cursor position
            var rel_16_x = toSignedRelative16bit(x - this._pointerLockPos.x);
            var rel_16_y = toSignedRelative16bit(y - this._pointerLockPos.y);

            RFB.messages.pointerEvent(this._sock, rel_16_x, rel_16_y, mask);
            
            // reset the cursor position to center
            this._mousePos = { x: this._pointerLockPos.x , y: this._pointerLockPos.y };
            this._cursor.move(this._pointerLockPos.x, this._pointerLockPos.y);
        } else {
            RFB.messages.pointerEvent(this._sock, this._display.absX(x), this._display.absY(y), mask);
        }
        
    }

    _sendScroll(x, y, dX, dY) {
        if (this._rfbConnectionState !== 'connected') { return; }
        if (this._viewOnly) { return; } // View only, skip mouse events

        if (this._isPrimaryDisplay) {
            RFB.messages.pointerEvent(this._sock, this._display.absX(x), this._display.absY(y), 0, dX, dY);
        } else {
            this._proxyRFBMessage('scroll', [ x, y, dX, dY ]);
        }
    }

    _handleWheel(ev) {
        if (this._rfbConnectionState !== 'connected') { return; }
        if (this._viewOnly) { return; } // View only, skip mouse events

        ev.stopPropagation();
        ev.preventDefault();

        // Ensure keys down are synced between client and server
        this._keyboard.clearKeysDown(ev);

        // On MacOs we need to translate zooming CMD+wheel to CTRL+wheel
        if (isMac() && (this._keyboard._keyDownList["MetaLeft"] || this._keyboard._keyDownList["MetaRight"])) {
            this._keyboard._sendKeyEvent(this._keyboard._keyDownList["MetaLeft"], "MetaLeft", false);
            this._keyboard._sendKeyEvent(this._keyboard._keyDownList["MetaRight"], "MetaRight", false);
            this._keyboard._sendKeyEvent(KeyTable.XK_Control_L, "ControlLeft", true);
        }

        // In a pinch and zoom gesture we're sending only a wheel event so we need
        // to make sure a CTRL press event is sent alongside it if we want to trigger zooming.
        // Moreover, we don't have a way to know that the gesture has stopped so we
        // need to check manually every now and then and "unpress" the CTRL key when it ends.
        if (ev.ctrlKey && !this._keyboard._keyDownList["ControlLeft"]) {
            this._keyboard._sendKeyEvent(KeyTable.XK_Control_L, "ControlLeft", true);

            this._watchForPinchAndZoom = this._watchForPinchAndZoom || setInterval(() => {
                const timeSinceLastPinchAndZoom = +new Date() - this._mouseLastPinchAndZoomTime;
                if (timeSinceLastPinchAndZoom > 250) {
                    clearInterval(this._watchForPinchAndZoom);
                    this._keyboard._sendKeyEvent(KeyTable.XK_Control_L, "ControlLeft", false);
                    this._watchForPinchAndZoom = null;
                    this._mouseLastPinchAndZoomTime = 0;
                }
            }, 10);
        }

        if (this._watchForPinchAndZoom) {
            this._mouseLastPinchAndZoomTime = +new Date();
        }

        // Pixel units unless it's non-zero.
        // Note that if deltamode is line or page won't matter since we aren't
        // sending the mouse wheel delta to the server anyway.
        // The difference between pixel and line can be important however since
        // we have a threshold that can be smaller than the line height.
        let dX = ev.deltaX;
        let dY = ev.deltaY;

        if (ev.deltaMode !== 0) {
            dX *= WHEEL_LINE_HEIGHT;
            dY *= WHEEL_LINE_HEIGHT;
        }

        const pointer = clientToElement(ev.clientX, ev.clientY, this._canvas);
        this._sendScroll(pointer.x, pointer.y, dX, dY);
    }

    _fakeMouseMove(ev, elementX, elementY) {
        if (this._isPrimaryDisplay) {
            this._handleMouseMove(elementX, elementY, false, true);
            this._cursor.move(ev.detail.clientX, ev.detail.clientY);
        } else {
            this._proxyRFBMessage('mousemove', [ elementX, elementY, true, false ]);
            this._cursor.move(ev.detail.clientX, ev.detail.clientY);

        }
    }

    _handleTapEvent(ev, bmask) {
        let pos = clientToElement(ev.detail.clientX, ev.detail.clientY,
                                  this._canvas);

        // If the user quickly taps multiple times we assume they meant to
        // hit the same spot, so slightly adjust coordinates

        if ((this._gestureLastTapTime !== null) &&
            ((Date.now() - this._gestureLastTapTime) < DOUBLE_TAP_TIMEOUT) &&
            (this._gestureFirstDoubleTapEv.detail.type === ev.detail.type)) {
            let dx = this._gestureFirstDoubleTapEv.detail.clientX - ev.detail.clientX;
            let dy = this._gestureFirstDoubleTapEv.detail.clientY - ev.detail.clientY;
            let distance = Math.hypot(dx, dy);

            if (distance < DOUBLE_TAP_THRESHOLD) {
                pos = clientToElement(this._gestureFirstDoubleTapEv.detail.clientX,
                                      this._gestureFirstDoubleTapEv.detail.clientY,
                                      this._canvas);
            } else {
                this._gestureFirstDoubleTapEv = ev;
            }
        } else {
            this._gestureFirstDoubleTapEv = ev;
        }
        this._gestureLastTapTime = Date.now();

        this._fakeMouseMove(this._gestureFirstDoubleTapEv, pos.x, pos.y);
        this._fakeMouseButton(pos.x, pos.y, true, bmask);
        this._fakeMouseButton(pos.x, pos.y, false, bmask);
    }

    _fakeMouseButton(x, y, down, mask) {
        if (this._isPrimaryDisplay) {
            this._handleMouseButton(x, y, down, mask);
        } else {
            if (down) {
                this._proxyRFBMessage('mousedown', [ x, y, mask ]);
            } else {
                this._proxyRFBMessage('mouseup', [ x, y, mask ]);
            }
        }
    }

    _handleGesture(ev) {
        let magnitude;

        let pos = clientToElement(ev.detail.clientX, ev.detail.clientY,
                                  this._canvas);
        switch (ev.type) {
            case 'gesturestart':
                switch (ev.detail.type) {
                    case 'onetap':
                        this._handleTapEvent(ev, 0x1);
                        break;
                    case 'twotap':
                        this._handleTapEvent(ev, 0x4);
                        break;
                    case 'threetap':
                        this._handleTapEvent(ev, 0x2);
                        break;
                    case 'drag':
                        this._fakeMouseMove(ev, pos.x, pos.y);

                        this._fakeMouseButton(pos.x, pos.y, true, 0x1);
                        break;
                    case 'longpress':
                        this._fakeMouseMove(ev, pos.x, pos.y);
                        this._fakeMouseButton(pos.x, pos.y, true, 0x4);
                        break;

                    case 'twodrag':
                        this._gestureLastMagnitudeX = ev.detail.magnitudeX;
                        this._gestureLastMagnitudeY = ev.detail.magnitudeY;
                        this._fakeMouseMove(ev, pos.x, pos.y);
                        break;
                    case 'pinch':
                        this._gestureLastMagnitudeX = Math.hypot(ev.detail.magnitudeX,
                                                                 ev.detail.magnitudeY);
                        this._fakeMouseMove(ev, pos.x, pos.y);
                        break;
                }
                break;

            case 'gesturemove':
                switch (ev.detail.type) {
                    case 'onetap':
                    case 'twotap':
                    case 'threetap':
                        break;
                    case 'drag':
                    case 'longpress':
                        this._fakeMouseMove(ev, pos.x, pos.y);
                        break;
                    case 'twodrag':
                        // Always scroll in the same position.
                        // We don't know if the mouse was moved so we need to move it
                        // every update.
                        this._fakeMouseMove(ev, pos.x, pos.y);
                        while ((ev.detail.magnitudeY - this._gestureLastMagnitudeY) > GESTURE_SCRLSENS) {
                            this._fakeMouseButton(pos.x, pos.y, true, 0x8);
                            this._fakeMouseButton(pos.x, pos.y, false, 0x8);
                            this._gestureLastMagnitudeY += GESTURE_SCRLSENS;
                        }
                        while ((ev.detail.magnitudeY - this._gestureLastMagnitudeY) < -GESTURE_SCRLSENS) {
                            this._fakeMouseButton(pos.x, pos.y, true, 0x10);
                            this._fakeMouseButton(pos.x, pos.y, false, 0x10);
                            this._gestureLastMagnitudeY -= GESTURE_SCRLSENS;
                        }
                        while ((ev.detail.magnitudeX - this._gestureLastMagnitudeX) > GESTURE_SCRLSENS) {
                            this._fakeMouseButton(pos.x, pos.y, true, 0x20);
                            this._fakeMouseButton(pos.x, pos.y, false, 0x20);
                            this._gestureLastMagnitudeX += GESTURE_SCRLSENS;
                        }
                        while ((ev.detail.magnitudeX - this._gestureLastMagnitudeX) < -GESTURE_SCRLSENS) {
                            this._fakeMouseButton(pos.x, pos.y, true, 0x40);
                            this._fakeMouseButton(pos.x, pos.y, false, 0x40);
                            this._gestureLastMagnitudeX -= GESTURE_SCRLSENS;
                        }
                        break;
                    case 'pinch':
                        // Always scroll in the same position.
                        // We don't know if the mouse was moved so we need to move it
                        // every update.
                        this._fakeMouseMove(ev, pos.x, pos.y);
                        magnitude = Math.hypot(ev.detail.magnitudeX, ev.detail.magnitudeY);
                        if (Math.abs(magnitude - this._gestureLastMagnitudeX) > GESTURE_ZOOMSENS) {
                            this._handleKeyEvent(KeyTable.XK_Control_L, "ControlLeft", true);
                            while ((magnitude - this._gestureLastMagnitudeX) > GESTURE_ZOOMSENS) {
                                this._fakeMouseButton(pos.x, pos.y, true, 0x8);
                                this._fakeMouseButton(pos.x, pos.y, false, 0x8);
                                this._gestureLastMagnitudeX += GESTURE_ZOOMSENS;
                            }
                            while ((magnitude -  this._gestureLastMagnitudeX) < -GESTURE_ZOOMSENS) {
                                this._fakeMouseButton(pos.x, pos.y, true, 0x10);
                                this._fakeMouseButton(pos.x, pos.y, false, 0x10);
                                this._gestureLastMagnitudeX -= GESTURE_ZOOMSENS;
                            }
                        }
                        this._handleKeyEvent(KeyTable.XK_Control_L, "ControlLeft", false);
                        break;
                }
                break;

            case 'gestureend':
                switch (ev.detail.type) {
                    case 'onetap':
                    case 'twotap':
                    case 'threetap':
                    case 'pinch':
                    case 'twodrag':
                        break;
                    case 'drag':
                        this._fakeMouseMove(ev, pos.x, pos.y);
                        this._fakeMouseButton(pos.x, pos.y, false, 0x1);
                        break;
                    case 'longpress':
                        this._fakeMouseMove(ev, pos.x, pos.y);
                        this._fakeMouseButton(pos.x, pos.y, false, 0x4);
                        break;
                }
                break;
        }
    }

    // Message Handlers

    _negotiateProtocolVersion() {
        if (this._sock.rQwait("version", 12)) {
            return false;
        }

        const sversion = this._sock.rQshiftStr(12).substr(4, 7);
        Log.Info("Server ProtocolVersion: " + sversion);
        let isRepeater = 0;
        switch (sversion) {
            case "000.000":  // UltraVNC repeater
                isRepeater = 1;
                break;
            case "003.003":
            case "003.006":  // UltraVNC
            case "003.889":  // Apple Remote Desktop
                this._rfbVersion = 3.3;
                break;
            case "003.007":
                this._rfbVersion = 3.7;
                break;
            case "003.008":
            case "004.000":  // Intel AMT KVM
            case "004.001":  // RealVNC 4.6
            case "005.000":  // RealVNC 5.3
                this._rfbVersion = 3.8;
                break;
            default:
                return this._fail("Invalid server version " + sversion);
        }

        if (isRepeater) {
            let repeaterID = "ID:" + this._repeaterID;
            while (repeaterID.length < 250) {
                repeaterID += "\0";
            }
            this._sock.sendString(repeaterID);
            return true;
        }

        if (this._rfbVersion > this._rfbMaxVersion) {
            this._rfbVersion = this._rfbMaxVersion;
        }

        const cversion = "00" + parseInt(this._rfbVersion, 10) +
                       ".00" + ((this._rfbVersion * 10) % 10);
        this._sock.sendString("RFB " + cversion + "\n");
        Log.Debug('Sent ProtocolVersion: ' + cversion);

        this._rfbInitState = 'Security';
    }

    _negotiateSecurity() {
        if (this._rfbVersion >= 3.7) {
            // Server sends supported list, client decides
            const numTypes = this._sock.rQshift8();
            if (this._sock.rQwait("security type", numTypes, 1)) { return false; }

            if (numTypes === 0) {
                this._rfbInitState = "SecurityReason";
                this._securityContext = "no security types";
                this._securityStatus = 1;
                return this._initMsg();
            }

            const types = this._sock.rQshiftBytes(numTypes);
            Log.Debug("Server security types: " + types);

            // Look for each auth in preferred order
            if (types.includes(1)) {
                this._rfbAuthScheme = 1; // None
            } else if (types.includes(22)) {
                this._rfbAuthScheme = 22; // XVP
            } else if (types.includes(16)) {
                this._rfbAuthScheme = 16; // Tight
            } else if (types.includes(2)) {
                this._rfbAuthScheme = 2; // VNC Auth
            } else if (types.includes(19)) {
                this._rfbAuthScheme = 19; // VeNCrypt Auth
            } else {
                return this._fail("Unsupported security types (types: " + types + ")");
            }

            this._sock.send([this._rfbAuthScheme]);
        } else {
            // Server decides
            if (this._sock.rQwait("security scheme", 4)) { return false; }
            this._rfbAuthScheme = this._sock.rQshift32();

            if (this._rfbAuthScheme == 0) {
                this._rfbInitState = "SecurityReason";
                this._securityContext = "authentication scheme";
                this._securityStatus = 1;
                return this._initMsg();
            }
        }

        this._rfbInitState = 'Authentication';
        Log.Debug('Authenticating using scheme: ' + this._rfbAuthScheme);

        return this._initMsg(); // jump to authentication
    }

    _handleSecurityReason() {
        if (this._sock.rQwait("reason length", 4)) {
            return false;
        }
        const strlen = this._sock.rQshift32();
        let reason = "";

        if (strlen > 0) {
            if (this._sock.rQwait("reason", strlen, 4)) { return false; }
            reason = this._sock.rQshiftStr(strlen);
        }

        if (reason !== "") {
            this.dispatchEvent(new CustomEvent(
                "securityfailure",
                { detail: { status: this._securityStatus,
                            reason: reason } }));

            return this._fail("Security negotiation failed on " +
                              this._securityContext +
                              " (reason: " + reason + ")");
        } else {
            this.dispatchEvent(new CustomEvent(
                "securityfailure",
                { detail: { status: this._securityStatus } }));

            return this._fail("Security negotiation failed on " +
                              this._securityContext);
        }
    }

    // authentication
    _negotiateXvpAuth() {
        if (this._rfbCredentials.username === undefined ||
            this._rfbCredentials.password === undefined ||
            this._rfbCredentials.target === undefined) {
            this.dispatchEvent(new CustomEvent(
                "credentialsrequired",
                { detail: { types: ["username", "password", "target"] } }));
            return false;
        }

        const xvpAuthStr = String.fromCharCode(this._rfbCredentials.username.length) +
                           String.fromCharCode(this._rfbCredentials.target.length) +
                           this._rfbCredentials.username +
                           this._rfbCredentials.target;
        this._sock.sendString(xvpAuthStr);
        this._rfbAuthScheme = 2;
        return this._negotiateAuthentication();
    }

    // VeNCrypt authentication, currently only supports version 0.2 and only Plain subtype
    _negotiateVeNCryptAuth() {

        // waiting for VeNCrypt version
        if (this._rfbVeNCryptState == 0) {
            if (this._sock.rQwait("vencrypt version", 2)) { return false; }

            const major = this._sock.rQshift8();
            const minor = this._sock.rQshift8();

            if (!(major == 0 && minor == 2)) {
                return this._fail("Unsupported VeNCrypt version " + major + "." + minor);
            }

            this._sock.send([0, 2]);
            this._rfbVeNCryptState = 1;
        }

        // waiting for ACK
        if (this._rfbVeNCryptState == 1) {
            if (this._sock.rQwait("vencrypt ack", 1)) { return false; }

            const res = this._sock.rQshift8();

            if (res != 0) {
                return this._fail("VeNCrypt failure " + res);
            }

            this._rfbVeNCryptState = 2;
        }
        // must fall through here (i.e. no "else if"), beacause we may have already received
        // the subtypes length and won't be called again

        if (this._rfbVeNCryptState == 2) { // waiting for subtypes length
            if (this._sock.rQwait("vencrypt subtypes length", 1)) { return false; }

            const subtypesLength = this._sock.rQshift8();
            if (subtypesLength < 1) {
                return this._fail("VeNCrypt subtypes empty");
            }

            this._rfbVeNCryptSubtypesLength = subtypesLength;
            this._rfbVeNCryptState = 3;
        }

        // waiting for subtypes list
        if (this._rfbVeNCryptState == 3) {
            if (this._sock.rQwait("vencrypt subtypes", 4 * this._rfbVeNCryptSubtypesLength)) { return false; }

            const subtypes = [];
            for (let i = 0; i < this._rfbVeNCryptSubtypesLength; i++) {
                subtypes.push(this._sock.rQshift32());
            }

            // 256 = Plain subtype
            if (subtypes.indexOf(256) != -1) {
                // 0x100 = 256
                this._sock.send([0, 0, 1, 0]);
                this._rfbVeNCryptState = 4;
            } else {
                return this._fail("VeNCrypt Plain subtype not offered by server");
            }
        }

        // negotiated Plain subtype, server waits for password
        if (this._rfbVeNCryptState == 4) {
            if (this._rfbCredentials.username === undefined ||
                this._rfbCredentials.password === undefined) {
                this.dispatchEvent(new CustomEvent(
                    "credentialsrequired",
                    { detail: { types: ["username", "password"] } }));
                return false;
            }

            const user = encodeUTF8(this._rfbCredentials.username);
            const pass = encodeUTF8(this._rfbCredentials.password);

            this._sock.send([
                (user.length >> 24) & 0xFF,
                (user.length >> 16) & 0xFF,
                (user.length >> 8) & 0xFF,
                user.length & 0xFF
            ]);
            this._sock.send([
                (pass.length >> 24) & 0xFF,
                (pass.length >> 16) & 0xFF,
                (pass.length >> 8) & 0xFF,
                pass.length & 0xFF
            ]);
            this._sock.sendString(user);
            this._sock.sendString(pass);

            this._rfbInitState = "SecurityResult";
            return true;
        }
    }

    _negotiateStdVNCAuth() {
        if (this._sock.rQwait("auth challenge", 16)) { return false; }

        // KasmVNC uses basic Auth, clear the VNC password, which is not used
        this._rfbCredentials.password = "";

        // TODO(directxman12): make genDES not require an Array
        const challenge = Array.prototype.slice.call(this._sock.rQshiftBytes(16));
        const response = RFB.genDES(this._rfbCredentials.password, challenge);
        this._sock.send(response);
        this._rfbInitState = "SecurityResult";
        return true;
    }

    _negotiateTightUnixAuth() {
        if (this._rfbCredentials.username === undefined ||
            this._rfbCredentials.password === undefined) {
            this.dispatchEvent(new CustomEvent(
                "credentialsrequired",
                { detail: { types: ["username", "password"] } }));
            return false;
        }

        this._sock.send([0, 0, 0, this._rfbCredentials.username.length]);
        this._sock.send([0, 0, 0, this._rfbCredentials.password.length]);
        this._sock.sendString(this._rfbCredentials.username);
        this._sock.sendString(this._rfbCredentials.password);
        this._rfbInitState = "SecurityResult";
        return true;
    }

    _negotiateTightTunnels(numTunnels) {
        const clientSupportedTunnelTypes = {
            0: { vendor: 'TGHT', signature: 'NOTUNNEL' }
        };
        const serverSupportedTunnelTypes = {};
        // receive tunnel capabilities
        for (let i = 0; i < numTunnels; i++) {
            const capCode = this._sock.rQshift32();
            const capVendor = this._sock.rQshiftStr(4);
            const capSignature = this._sock.rQshiftStr(8);
            serverSupportedTunnelTypes[capCode] = { vendor: capVendor, signature: capSignature };
        }

        Log.Debug("Server Tight tunnel types: " + serverSupportedTunnelTypes);

        // Siemens touch panels have a VNC server that supports NOTUNNEL,
        // but forgets to advertise it. Try to detect such servers by
        // looking for their custom tunnel type.
        if (serverSupportedTunnelTypes[1] &&
            (serverSupportedTunnelTypes[1].vendor === "SICR") &&
            (serverSupportedTunnelTypes[1].signature === "SCHANNEL")) {
            Log.Debug("Detected Siemens server. Assuming NOTUNNEL support.");
            serverSupportedTunnelTypes[0] = { vendor: 'TGHT', signature: 'NOTUNNEL' };
        }

        // choose the notunnel type
        if (serverSupportedTunnelTypes[0]) {
            if (serverSupportedTunnelTypes[0].vendor != clientSupportedTunnelTypes[0].vendor ||
                serverSupportedTunnelTypes[0].signature != clientSupportedTunnelTypes[0].signature) {
                return this._fail("Client's tunnel type had the incorrect " +
                                  "vendor or signature");
            }
            Log.Debug("Selected tunnel type: " + clientSupportedTunnelTypes[0]);
            this._sock.send([0, 0, 0, 0]);  // use NOTUNNEL
            return false; // wait until we receive the sub auth count to continue
        } else {
            return this._fail("Server wanted tunnels, but doesn't support " +
                              "the notunnel type");
        }
    }

    _negotiateTightAuth() {
        if (!this._rfbTightVNC) {  // first pass, do the tunnel negotiation
            if (this._sock.rQwait("num tunnels", 4)) { return false; }
            const numTunnels = this._sock.rQshift32();
            if (numTunnels > 0 && this._sock.rQwait("tunnel capabilities", 16 * numTunnels, 4)) { return false; }

            this._rfbTightVNC = true;

            if (numTunnels > 0) {
                this._negotiateTightTunnels(numTunnels);
                return false;  // wait until we receive the sub auth to continue
            }
        }

        // second pass, do the sub-auth negotiation
        if (this._sock.rQwait("sub auth count", 4)) { return false; }
        const subAuthCount = this._sock.rQshift32();
        if (subAuthCount === 0) {  // empty sub-auth list received means 'no auth' subtype selected
            this._rfbInitState = 'SecurityResult';
            return true;
        }

        if (this._sock.rQwait("sub auth capabilities", 16 * subAuthCount, 4)) { return false; }

        const clientSupportedTypes = {
            'STDVNOAUTH__': 1,
            'STDVVNCAUTH_': 2,
            'TGHTULGNAUTH': 129
        };

        const serverSupportedTypes = [];

        for (let i = 0; i < subAuthCount; i++) {
            this._sock.rQshift32(); // capNum
            const capabilities = this._sock.rQshiftStr(12);
            serverSupportedTypes.push(capabilities);
        }

        Log.Debug("Server Tight authentication types: " + serverSupportedTypes);

        for (let authType in clientSupportedTypes) {
            if (serverSupportedTypes.indexOf(authType) != -1) {
                this._sock.send([0, 0, 0, clientSupportedTypes[authType]]);
                Log.Debug("Selected authentication type: " + authType);

                switch (authType) {
                    case 'STDVNOAUTH__':  // no auth
                        this._rfbInitState = 'SecurityResult';
                        return true;
                    case 'STDVVNCAUTH_': // VNC auth
                        this._rfbAuthScheme = 2;
                        return this._initMsg();
                    case 'TGHTULGNAUTH': // UNIX auth
                        this._rfbAuthScheme = 129;
                        return this._initMsg();
                    default:
                        return this._fail("Unsupported tiny auth scheme " +
                                          "(scheme: " + authType + ")");
                }
            }
        }

        return this._fail("No supported sub-auth types!");
    }

    _negotiateAuthentication() {
        switch (this._rfbAuthScheme) {
            case 1:  // no auth
                if (this._rfbVersion >= 3.8) {
                    this._rfbInitState = 'SecurityResult';
                    return true;
                }
                this._rfbInitState = 'ClientInitialisation';
                return this._initMsg();

            case 22:  // XVP auth
                return this._negotiateXvpAuth();

            case 2:  // VNC authentication
                return this._negotiateStdVNCAuth();

            case 16:  // TightVNC Security Type
                return this._negotiateTightAuth();

            case 19:  // VeNCrypt Security Type
                return this._negotiateVeNCryptAuth();

            case 129:  // TightVNC UNIX Security Type
                return this._negotiateTightUnixAuth();

            default:
                return this._fail("Unsupported auth scheme (scheme: " +
                                  this._rfbAuthScheme + ")");
        }
    }

    _handleSecurityResult() {
        if (this._sock.rQwait('VNC auth response ', 4)) { return false; }

        const status = this._sock.rQshift32();

        if (status === 0) { // OK
            this._rfbInitState = 'ClientInitialisation';
            Log.Debug('Authentication OK');
            return this._initMsg();
        } else {
            if (this._rfbVersion >= 3.8) {
                this._rfbInitState = "SecurityReason";
                this._securityContext = "security result";
                this._securityStatus = status;
                return this._initMsg();
            } else {
                this.dispatchEvent(new CustomEvent(
                    "securityfailure",
                    { detail: { status: status } }));

                return this._fail("Security handshake failed");
            }
        }
    }

    _negotiateServerInit() {
        if (this._sock.rQwait("server initialization", 24)) { return false; }

        /* Screen size */
        const width = this._sock.rQshift16();
        const height = this._sock.rQshift16();

        /* PIXEL_FORMAT */
        const bpp         = this._sock.rQshift8();
        const depth       = this._sock.rQshift8();
        const bigEndian  = this._sock.rQshift8();
        const trueColor  = this._sock.rQshift8();

        const redMax     = this._sock.rQshift16();
        const greenMax   = this._sock.rQshift16();
        const blueMax    = this._sock.rQshift16();
        const redShift   = this._sock.rQshift8();
        const greenShift = this._sock.rQshift8();
        const blueShift  = this._sock.rQshift8();
        this._sock.rQskipBytes(3);  // padding

        // NB(directxman12): we don't want to call any callbacks or print messages until
        //                   *after* we're past the point where we could backtrack

        /* Connection name/title */
        const nameLength = this._sock.rQshift32();
        if (this._sock.rQwait('server init name', nameLength, 24)) { return false; }
        let name = this._sock.rQshiftStr(nameLength);
        name = decodeUTF8(name, true);

        if (this._rfbTightVNC) {
            if (this._sock.rQwait('TightVNC extended server init header', 8, 24 + nameLength)) { return false; }
            // In TightVNC mode, ServerInit message is extended
            const numServerMessages = this._sock.rQshift16();
            const numClientMessages = this._sock.rQshift16();
            const numEncodings = this._sock.rQshift16();
            this._sock.rQskipBytes(2);  // padding

            const totalMessagesLength = (numServerMessages + numClientMessages + numEncodings) * 16;
            if (this._sock.rQwait('TightVNC extended server init header', totalMessagesLength, 32 + nameLength)) { return false; }

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
                  ", bigEndian: " + bigEndian +
                  ", trueColor: " + trueColor +
                  ", redMax: " + redMax +
                  ", greenMax: " + greenMax +
                  ", blueMax: " + blueMax +
                  ", redShift: " + redShift +
                  ", greenShift: " + greenShift +
                  ", blueShift: " + blueShift);

        // we're past the point where we could backtrack, so it's safe to call this
        this._setDesktopName(name);
        this._resize(width, height);

        if (!this._viewOnly) { this._keyboard.grab(); }

        this._fbDepth = 24;

        if (this._fbName === "Intel(r) AMT KVM") {
            Log.Warn("Intel AMT KVM only supports 8/16 bit depths. Using low color mode.");
            this._fbDepth = 8;
        }

        RFB.messages.pixelFormat(this._sock, this._fbDepth, true);
        this._sendEncodings();
        RFB.messages.fbUpdateRequest(this._sock, false, 0, 0, this._fbWidth, this._fbHeight);

        this._updateConnectionState('connected');

        //Register pipe based extensions
        initializePrinterRelay(this);

        return true;
    }

    _hasWebp() {
        /*
        return new Promise(res => {
            const webP = new Image();
            webP.src = 'data:image/webp;base64,UklGRjoAAABXRUJQVlA4IC4AAACyAgCdASoCAAIALmk0mk0iIiIiIgBoSygABc6WWgAA/veff/0PP8bA//LwYAAA';
            webP.onload = webP.onerror = function () {
                res(webP.height === 2);
            };
        })
        */
        if (!this.enableWebP)
            return false;
        // It's not possible to check for webp synchronously, and hacking promises
        // into everything would be too time-consuming. So test for FF and Chrome.
        var uagent = navigator.userAgent.toLowerCase();
        var match = uagent.match(/firefox\/([0-9]+)\./);
        if (match && parseInt(match[1]) >= 65)
            return true;
        match = uagent.match(/chrome\/([0-9]+)\./);
        if (match && parseInt(match[1]) >= 23)
            return true;
        return false;
    }

    _sendEncodings() {
        const encs = [];

        // In preference order
        // Disable copyrect when using multiple displays
        if (this._display.screens.length === 1) {
            encs.push(encodings.encodingCopyRect);
        } else {
            Log.Debug("Multiple displays detected, disabling copyrect encoding.");
        }
        // Only supported with full depth support
        if (this._fbDepth == 24) {
            encs.push(encodings.encodingTight);
            encs.push(encodings.encodingTightPNG);
            encs.push(encodings.encodingHextile);
            encs.push(encodings.encodingRRE);
        }
        encs.push(encodings.encodingRaw);

        // Psuedo-encoding settings
        encs.push(encodings.pseudoEncodingQualityLevel0 + this._qualityLevel);
        encs.push(encodings.pseudoEncodingCompressLevel0 + this._compressionLevel);
        encs.push(encodings.pseudoEncodingDesktopSize);
        encs.push(encodings.pseudoEncodingLastRect);
        encs.push(encodings.pseudoEncodingQEMUExtendedKeyEvent);
        encs.push(encodings.pseudoEncodingExtendedDesktopSize);
        encs.push(encodings.pseudoEncodingXvp);
        encs.push(encodings.pseudoEncodingFence);
        encs.push(encodings.pseudoEncodingContinuousUpdates);
        encs.push(encodings.pseudoEncodingDesktopName);
        encs.push(encodings.pseudoEncodingExtendedClipboard);
        if (this._hasWebp())
            encs.push(encodings.pseudoEncodingWEBP);
        if (this._enableQOI)
            encs.push(encodings.pseudoEncodingQOI);
            

        // kasm settings; the server may be configured to ignore these
        encs.push(encodings.pseudoEncodingJpegVideoQualityLevel0 + this.jpegVideoQuality);
        encs.push(encodings.pseudoEncodingWebpVideoQualityLevel0 + this.webpVideoQuality);
        encs.push(encodings.pseudoEncodingTreatLosslessLevel0 + this.treatLossless);
        encs.push(encodings.pseudoEncodingDynamicQualityMinLevel0 + this.dynamicQualityMin);
        encs.push(encodings.pseudoEncodingDynamicQualityMaxLevel0 + this.dynamicQualityMax);
        encs.push(encodings.pseudoEncodingVideoAreaLevel1 + this.videoArea - 1);
        encs.push(encodings.pseudoEncodingVideoTimeLevel0 + this.videoTime);
        encs.push(encodings.pseudoEncodingVideoOutTimeLevel1 + this.videoOutTime - 1);
        encs.push(encodings.pseudoEncodingVideoScalingLevel0 + this.videoScaling);
        encs.push(encodings.pseudoEncodingFrameRateLevel10 + this.frameRate - 10);
        encs.push(encodings.pseudoEncodingMaxVideoResolution);
        
	// preferBandwidth choses preset settings. Since we expose all the settings, lets not pass this
        if (this.preferBandwidth) // must be last - server processes in reverse order
            encs.push(encodings.pseudoEncodingPreferBandwidth);

        if (this._fbDepth == 24) {
            encs.push(encodings.pseudoEncodingVMwareCursor);
            encs.push(encodings.pseudoEncodingCursor);
        }
        encs.push(encodings.pseudoEncodingVMwareCursorPosition);

        RFB.messages.clientEncodings(this._sock, encs);
    }

    /* RFB protocol initialization states:
     *   ProtocolVersion
     *   Security
     *   Authentication
     *   SecurityResult
     *   ClientInitialization - not triggered by server message
     *   ServerInitialization
     */
    _initMsg() {
        switch (this._rfbInitState) {
            case 'ProtocolVersion':
                return this._negotiateProtocolVersion();

            case 'Security':
                return this._negotiateSecurity();

            case 'Authentication':
                return this._negotiateAuthentication();

            case 'SecurityResult':
                return this._handleSecurityResult();

            case 'SecurityReason':
                return this._handleSecurityReason();

            case 'ClientInitialisation':
                this._sock.send([this._shared ? 1 : 0]); // ClientInitialisation
                this._rfbInitState = 'ServerInitialisation';
                return true;

            case 'ServerInitialisation':
                return this._negotiateServerInit();

            default:
                return this._fail("Unknown init state (state: " +
                                  this._rfbInitState + ")");
        }
    }

    _handleSetColourMapMsg() {
        Log.Debug("SetColorMapEntries");

        return this._fail("Unexpected SetColorMapEntries message");
    }

    _handleServerCutText() {
        Log.Debug("ServerCutText");

        if (this._sock.rQwait("ServerCutText header", 7, 1)) { return false; }

        this._sock.rQskipBytes(3);  // Padding

        let length = this._sock.rQshift32();
        length = toSigned32bit(length);

        if (this._sock.rQwait("ServerCutText content", Math.abs(length), 8)) { return false; }

        if (length >= 0) {
            //Standard msg
            const text = this._sock.rQshiftStr(length);
            if (this._viewOnly) {
                return true;
            }

            this.dispatchEvent(new CustomEvent(
                "clipboard",
                { detail: { text: text } })
            );

            this._clipHash = 0;

        } else {
            //Extended msg.
            length = Math.abs(length);
            const flags = this._sock.rQshift32();
            let formats = flags & 0x0000FFFF;
            let actions = flags & 0xFF000000;

            let isCaps = (!!(actions & extendedClipboardActionCaps));
            if (isCaps) {
                this._clipboardServerCapabilitiesFormats = {};
                this._clipboardServerCapabilitiesActions = {};

                // Update our server capabilities for Formats
                for (let i = 0; i <= 15; i++) {
                    let index = 1 << i;

                    // Check if format flag is set.
                    if ((formats & index)) {
                        this._clipboardServerCapabilitiesFormats[index] = true;
                        // We don't send unsolicited clipboard, so we
                        // ignore the size
                        this._sock.rQshift32();
                    }
                }

                // Update our server capabilities for Actions
                for (let i = 24; i <= 31; i++) {
                    let index = 1 << i;
                    this._clipboardServerCapabilitiesActions[index] = !!(actions & index);
                }

                /*  Caps handling done, send caps with the clients
                    capabilities set as a response */
                let clientActions = [
                    extendedClipboardActionCaps,
                    extendedClipboardActionRequest,
                    extendedClipboardActionPeek,
                    extendedClipboardActionNotify,
                    extendedClipboardActionProvide
                ];
                RFB.messages.extendedClipboardCaps(this._sock, clientActions, {extendedClipboardFormatText: 0});

            } else if (actions === extendedClipboardActionRequest) {
                if (this._viewOnly) {
                    return true;
                }

                // Check if server has told us it can handle Provide and there is clipboard data to send.
                if (this._clipboardText != null &&
                    this._clipboardServerCapabilitiesActions[extendedClipboardActionProvide]) {

                    if (formats & extendedClipboardFormatText) {
                        RFB.messages.extendedClipboardProvide(this._sock, [extendedClipboardFormatText], [this._clipboardText]);
                    }
                }

            } else if (actions === extendedClipboardActionPeek) {
                if (this._viewOnly) {
                    return true;
                }

                if (this._clipboardServerCapabilitiesActions[extendedClipboardActionNotify]) {

                    if (this._clipboardText != null) {
                        RFB.messages.extendedClipboardNotify(this._sock, [extendedClipboardFormatText]);
                    } else {
                        RFB.messages.extendedClipboardNotify(this._sock, []);
                    }
                }

            } else if (actions === extendedClipboardActionNotify) {
                if (this._viewOnly) {
                    return true;
                }

                if (this._clipboardServerCapabilitiesActions[extendedClipboardActionRequest]) {

                    if (formats & extendedClipboardFormatText) {
                        RFB.messages.extendedClipboardRequest(this._sock, [extendedClipboardFormatText]);
                    }
                }

            } else if (actions === extendedClipboardActionProvide) {
                if (this._viewOnly) {
                    return true;
                }

                if (!(formats & extendedClipboardFormatText)) {
                    return true;
                }
                // Ignore what we had in our clipboard client side.
                this._clipboardText = null;

                // FIXME: Should probably verify that this data was actually requested
                let zlibStream = this._sock.rQshiftBytes(length - 4);
                let streamInflator = new Inflator();
                let textData = null;

                streamInflator.setInput(zlibStream);
                for (let i = 0; i <= 15; i++) {
                    let format = 1 << i;

                    if (formats & format) {

                        let size = 0x00;
                        let sizeArray = streamInflator.inflate(4);

                        size |= (sizeArray[0] << 24);
                        size |= (sizeArray[1] << 16);
                        size |= (sizeArray[2] << 8);
                        size |= (sizeArray[3]);
                        let chunk = streamInflator.inflate(size);

                        if (format === extendedClipboardFormatText) {
                            textData = chunk;
                        }
                    }
                }
                streamInflator.setInput(null);

                if (textData !== null) {
                    let tmpText = "";
                    for (let i = 0; i < textData.length; i++) {
                        tmpText += String.fromCharCode(textData[i]);
                    }
                    textData = tmpText;

                    textData = decodeUTF8(textData);
                    if ((textData.length > 0) && "\0" === textData.charAt(textData.length - 1)) {
                        textData = textData.slice(0, -1);
                    }

                    textData = textData.replace("\r\n", "\n");

                    this.dispatchEvent(new CustomEvent(
                        "clipboard",
                        { detail: { text: textData } }));
                }
            } else {
                return this._fail("Unexpected action in extended clipboard message: " + actions);
            }
        }
        return true;
    }

    _handleBinaryClipboard() {
        Log.Debug("HandleBinaryClipboard");

        if (this._sock.rQwait("Binary Clipboard header", 2, 1)) { return false; }

        let num = this._sock.rQshift8(); // how many different mime types
        let mimes = [];
        let clipItemData = {};
        let buffByteLen = 2;
        let textdata = '';
        Log.Info(num + ' Clipboard items recieved.');
	    Log.Debug('Started clipbooard processing with Client sockjs buffer size ' + this._sock.rQlen);

        

        for (let i = 0; i < num; i++) {
            if (this._sock.rQwait("Binary Clipboard op id", 4, buffByteLen)) { return false; }
            buffByteLen += 4;
            let clipid = this._sock.rQshift32();

            if (this._sock.rQwait("Binary Clipboard mimelen", 1, buffByteLen)) { return false; }
            buffByteLen++;
            let mimelen = this._sock.rQshift8();

            if (this._sock.rQwait("Binary Clipboard mime", Math.abs(mimelen), buffByteLen)) { return false; }
            buffByteLen+=mimelen;
            let mime = this._sock.rQshiftStr(mimelen);

            if (this._sock.rQwait("Binary Clipboard data len", 4, buffByteLen)) { return false; }
            buffByteLen+=4;
            let len = this._sock.rQshift32();

            if (this._sock.rQwait("Binary Clipboard data", Math.abs(len), buffByteLen)) { return false; }
            let data = this._sock.rQshiftBytes(len);
            buffByteLen+=len;
            
            switch(mime) {
                case "image/png":
                case "text/html":
                case "text/plain":
                    mimes.push(mime);

                        if (mime == "text/plain") {
                            textdata = new TextDecoder().decode(data);

                            if ((textdata.length > 0) && "\0" === textdata.charAt(textdata.length - 1)) {
                                textdata = textdata.slice(0, -1);
                            }

                            Log.Debug("Plain text clipboard recieved and placed in text element, size: " + textdata.length);
                            this.dispatchEvent(new CustomEvent(
                                "clipboard",
                                { detail: { text: textdata } })
                            );
                        }

                    Log.Info("Processed binary clipboard (ID: " + clipid + ")  of MIME " + mime + " of length " + len);
                    
	            if (!this.clipboardBinary) { continue; }
                    
                    clipItemData[mime] = new Blob([data], { type: mime });
                    break;
                default:
                    Log.Debug('Mime type skipped: ' + mime);
                    break;
            }
        }

        Log.Debug('Finished processing binary clipboard with client sockjs buffer size ' + this._sock.rQlen);

        if (Object.keys(clipItemData).length > 0) {
            if (this.clipboardBinary) {
                this._clipHash = 0;

                if (this._mouseLastScreenIndex === 0) {
                    this._write_binary_clipboard(clipItemData, textdata)
                } else {
                    this._proxyRFBMessage('receivedClipboard', [ clipItemData, textdata ]);
                }
            }
        }

        return true;
    }

    _write_binary_clipboard(clipItemData, textdata) {
        navigator.clipboard.write([new ClipboardItem(clipItemData)]).then(
            () => {
                if (textdata) {
                    this._clipHash = hashUInt8Array(textdata);
                }
            },
            (err) => { 
                Log.Error("Error writing to client clipboard: " + err);
                // Lets try writeText
                if (textdata.length > 0) {
                    navigator.clipboard.writeText(textdata).then(
                        () => {
                            this._clipHash = hashUInt8Array(textdata);
                        },
                        (err) => {
                            Log.Error("Error writing text to client clipboard: " + err);
                        }
                    );
                }
            }
        );
    }

    _handle_server_stats_msg() {
        this._sock.rQskipBytes(3);  // Padding
        const length = this._sock.rQshift32();
        if (this._sock.rQwait("KASM bottleneck stats", length, 8)) { return false; }

        const text = this._sock.rQshiftStr(length);

        Log.Debug("Received KASM bottleneck stats:");
        Log.Debug(text);
        this.dispatchEvent(new CustomEvent(
            "bottleneck_stats",
            { detail: { text: text } }));

        return true;
    }

    _handleServerFenceMsg() {
        if (this._sock.rQwait("ServerFence header", 8, 1)) { return false; }
        this._sock.rQskipBytes(3); // Padding
        let flags = this._sock.rQshift32();
        let length = this._sock.rQshift8();

        if (this._sock.rQwait("ServerFence payload", length, 9)) { return false; }

        if (length > 64) {
            Log.Warn("Bad payload length (" + length + ") in fence response");
            length = 64;
        }

        const payload = this._sock.rQshiftStr(length);

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
    }

    _handleXvpMsg() {
        if (this._sock.rQwait("XVP version and message", 3, 1)) { return false; }
        this._sock.rQskipBytes(1);  // Padding
        const xvpVer = this._sock.rQshift8();
        const xvpMsg = this._sock.rQshift8();

        switch (xvpMsg) {
            case 0:  // XVP_FAIL
                Log.Error("XVP Operation Failed");
                break;
            case 1:  // XVP_INIT
                this._rfbXvpVer = xvpVer;
                Log.Info("XVP extensions enabled (version " + this._rfbXvpVer + ")");
                this._setCapability("power", true);
                break;
            default:
                this._fail("Illegal server XVP message (msg: " + xvpMsg + ")");
                break;
        }

        return true;
    }

    _normalMsg() {
        let msgType;
        if (this._FBU.rects > 0) {
            msgType = 0;
        } else {
            msgType = this._sock.rQshift8();
        }

        let first, ret;
        switch (msgType) {
            case 0:  // FramebufferUpdate
                this._display.renderMs = 0;
                ret = this._framebufferUpdate();
                if (ret && !this._enabledContinuousUpdates) {
                    RFB.messages.fbUpdateRequest(this._sock, true, 0, 0,
                                                 this._fbWidth, this._fbHeight);
                }
                if (this._trackFrameStats) {
                    RFB.messages.sendFrameStats(this._sock, this._display.fps, this._display.renderMs);
                    this._trackFrameStats = false;
                }
                
                return ret;

            case 1:  // SetColorMapEntries
                return this._handleSetColourMapMsg();

            case 2:  // Bell
                Log.Debug("Bell");
                this.dispatchEvent(new CustomEvent(
                    "bell",
                    { detail: {} }));
                return true;

            case 3:  // ServerCutText
                return this._handleServerCutText();

            case 150: // EndOfContinuousUpdates
                first = !this._supportsContinuousUpdates;
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

            case 178: // KASM bottleneck stats
                return this._handle_server_stats_msg();

            case 179: // KASM requesting frame stats
                this._trackFrameStats = true;
                return true;

            case 180: // KASM binary clipboard
                return this._handleBinaryClipboard();

            case 181: // KASM UDP upgrade
                return this._handleUdpUpgrade();

            case 182: // KASM unix relay subscription
                return this._handleSubscribeUnixRelay();

            case 183: // KASM unix relay data
                return this._handleUnixRelay();

            case 248: // ServerFence
                return this._handleServerFenceMsg();

            case 250:  // XVP
                return this._handleXvpMsg();

            default:
                this._fail("Unexpected server message (type " + msgType + ")");
                Log.Debug("sock.rQslice(0, 30): " + this._sock.rQslice(0, 30));
                return true;
        }
    }

    _onFlush() {
        this._flushing = false;
        // Resume processing
        if (this._sock.rQlen > 0) {
            this._handleMessage();
        }
    }

    _handleUdpRect(data, frame_id) {
        let frame = {
            x: (data[0] << 8) + data[1],
            y: (data[2] << 8) + data[3],
            width: (data[4] << 8) + data[5],
            height: (data[6] << 8) + data[7],
            encoding: parseInt((data[8] << 24) + (data[9] << 16) +
                                            (data[10] << 8) + data[11], 10)
        };
        
        switch (frame.encoding) {
            case encodings.pseudoEncodingLastRect:
                this._display.flip(frame_id, frame.x + 1); //Last Rect message, first 16 bytes contain rect count
                if (this._display.pending())
                    this._display.flush(false);
                break;
            case encodings.encodingTight:
                let decoder = this._decoders[encodings.encodingUDP];
                try {
                    decoder.decodeRect(frame.x, frame.y,
                        frame.width, frame.height,
                        data, this._display,
                        this._fbDepth, frame_id);
                } catch (err) {
                    this._fail("Error decoding rect: " + err);
                    return false;
                }
                break;
            default:
                Log.Error("Invalid rect encoding via UDP: " + frame.encoding);
                return false;
        }

        return true;
    }

    _sendUdpUpgrade() {
        if (this._transitConnectionState == this.TransitConnectionStates.Upgrading) {
            return;
        }
        this._changeTransitConnectionState(this.TransitConnectionStates.Upgrading);

        let peer = this._udpPeer;
        let sock = this._sock;

        peer.createOffer().then(function(offer) {
            return peer.setLocalDescription(offer);
        }).then(function() {
            const buff = sock._sQ;
            const offset = sock._sQlen;
            const str = Uint8Array.from(Array.from(peer.localDescription.sdp).map(letter => letter.charCodeAt(0)));

            buff[offset] = 181; // msg-type
            buff[offset + 1] = str.length >> 8; // u16 len
            buff[offset + 2] = str.length;

            buff.set(str, offset + 3);

            sock._sQlen += 3 + str.length;
            sock.flush();
        }).catch(function(reason) {
            Log.Error("Failed to create offer " + reason);
            this._changeTransitConnectionState(this.TransitConnectionStates.Tcp);
            this._udpConnectFailures++;
        });
    }

    _sendUdpDowngrade() {
        this._changeTransitConnectionState(this.TransitConnectionStates.Downgrading);
        const buff = this._sock._sQ;
        const offset = this._sock._sQlen;

        buff[offset] = 181; // msg-type
        buff[offset + 1] = 0; // u16 len
        buff[offset + 2] = 0;

        this._sock._sQlen += 3;
        this._sock.flush();
    }

    _handleUdpUpgrade() {
        if (this._sock.rQwait("UdpUgrade header", 2, 1)) { return false; }
        let len = this._sock.rQshift16();
        if (this._sock.rQwait("UdpUpgrade payload", len, 3)) { return false; }

        const payload = this._sock.rQshiftStr(len);

        let peer = this._udpPeer;

        var response = JSON.parse(payload);
        Log.Debug("UDP Upgrade recieved from server: " + payload);
        peer.setRemoteDescription(new RTCSessionDescription(response.answer)).then(function() {
            var candidate = new RTCIceCandidate(response.candidate);
            peer.addIceCandidate(candidate).then(function() {
                Log.Debug("success in addicecandidate");
            }.bind(this)).catch(function(err) {
                Log.Error("Failure in addIceCandidate", err);
                this._changeTransitConnectionState(this.TransitConnectionStates.Failure)
                this._udpConnectFailures++;
            }.bind(this));
        }.bind(this)).catch(function(e) {
            Log.Error("Failure in setRemoteDescription", e);
            this._changeTransitConnectionState(this.TransitConnectionStates.Failure)
            this._udpConnectFailures++;
        }.bind(this));
    }

    _handleSubscribeUnixRelay() {
        if (this._sock.rQwait("SubscribeUnixRelay header", 2, 1)) { return false; }
        let status = this._sock.rQshift8();
        let len = this._sock.rQshift8();
        if (this._sock.rQwait("SubscribeUnixRelay message", len, 3)) { return false; }

        const payload = this._sock.rQshiftStr(len);

        if (status) {
            Log.Info("Unix relay subscription succeeded");
        } else {
            Log.Warn("Unix relay subscription failed, " + payload);
        }
    }

    _handleUnixRelay() {
        if (this._sock.rQwait("UnixRelay header", 1, 1)) { return false; }
        let namelen = this._sock.rQshift8();
        if (this._sock.rQwait("UnixRelay name", namelen, 2)) { return false; }
        const name = this._sock.rQshiftStr(namelen);

        if (this._sock.rQwait("UnixRelay len", 4, 2 + namelen)) { return false; }
        let len = this._sock.rQshift32();
        if (this._sock.rQwait("UnixRelay data", len, 6 + namelen)) { return false; }

        const payload = this._sock.rQshiftBytes(len);
        const processRelay = this._unixRelays[name];
        processRelay && processRelay(payload);
    }

    _framebufferUpdate() {
        if (this._FBU.rects === 0) {
            if (this._sock.rQwait("FBU header", 3, 1)) { return false; }
            this._sock.rQskipBytes(1);  // Padding
            this._FBU.rects = this._sock.rQshift16();

            this._FBU.frame_id++;
            this._FBU.rect_total = 0;

            // Make sure the previous frame is fully rendered first
            // to avoid building up an excessive queue
            if (this._display.pending()) {
                this._flushing = true;
                this._display.flush();
                return false;
            }
        }

        while (this._FBU.rects > 0) {
            if (this._FBU.encoding === null) {
                if (this._sock.rQwait("rect header", 12)) { return false; }
                /* New FramebufferUpdate */

                const hdr = this._sock.rQshiftBytes(12);
                this._FBU.x        = (hdr[0] << 8) + hdr[1];
                this._FBU.y        = (hdr[2] << 8) + hdr[3];
                this._FBU.width    = (hdr[4] << 8) + hdr[5];
                this._FBU.height   = (hdr[6] << 8) + hdr[7];
                this._FBU.encoding = parseInt((hdr[8] << 24) + (hdr[9] << 16) +
                                              (hdr[10] << 8) + hdr[11], 10);
            }
            
            
            if (!this._handleRect()) {
                return false;
            }

            this._FBU.rects--;
            this._FBU.encoding = null;
        }

        if (this._FBU.rect_total > 1) {
            this._display.flip(this._FBU.frame_id, this._FBU.rect_total);
        }
        
        return true;  // We finished this FBU
    }

    _handleRect() {
        switch (this._FBU.encoding) {
            case encodings.pseudoEncodingLastRect:
                this._FBU.rect_total++; //only track rendered rects and last rect
                this._FBU.rects = 1; // Will be decreased when we return
                return true;

            case encodings.pseudoEncodingVMwareCursor:
                return this._handleVMwareCursor();

            case encodings.pseudoEncodingVMwareCursorPosition:
                return this._handleVMwareCursorPosition();

            case encodings.pseudoEncodingCursor:
                return this._handleCursor();

            case encodings.pseudoEncodingQEMUExtendedKeyEvent:
                this._qemuExtKeyEventSupported = true;
                return true;

            case encodings.pseudoEncodingDesktopName:
                return this._handleDesktopName();

            case encodings.pseudoEncodingDesktopSize:
                this._resize(this._FBU.width, this._FBU.height);
                return true;

            case encodings.pseudoEncodingExtendedDesktopSize:
                return this._handleExtendedDesktopSize();

            default:
                if (this._handleDataRect()) {
                    this._FBU.rect_total++; //only track rendered rects and last rect
                    return true;
                } 
                return false;
        }
    }

    _handleVMwareCursor() {
        const hotx = this._FBU.x;  // hotspot-x
        const hoty = this._FBU.y;  // hotspot-y
        const w = this._FBU.width;
        const h = this._FBU.height;
        if (this._sock.rQwait("VMware cursor encoding", 1)) {
            return false;
        }

        const cursorType = this._sock.rQshift8();

        this._sock.rQshift8(); //Padding

        let rgba;
        const bytesPerPixel = 4;

        //Classic cursor
        if (cursorType == 0) {
            //Used to filter away unimportant bits.
            //OR is used for correct conversion in js.
            const PIXEL_MASK = 0xffffff00 | 0;
            rgba = new Array(w * h * bytesPerPixel);

            if (this._sock.rQwait("VMware cursor classic encoding",
                                  (w * h * bytesPerPixel) * 2, 2)) {
                return false;
            }

            let andMask = new Array(w * h);
            for (let pixel = 0; pixel < (w * h); pixel++) {
                andMask[pixel] = this._sock.rQshift32();
            }

            let xorMask = new Array(w * h);
            for (let pixel = 0; pixel < (w * h); pixel++) {
                xorMask[pixel] = this._sock.rQshift32();
            }

            for (let pixel = 0; pixel < (w * h); pixel++) {
                if (andMask[pixel] == 0) {
                    //Fully opaque pixel
                    let bgr = xorMask[pixel];
                    let r   = bgr >> 8  & 0xff;
                    let g   = bgr >> 16 & 0xff;
                    let b   = bgr >> 24 & 0xff;

                    rgba[(pixel * bytesPerPixel)     ] = r;    //r
                    rgba[(pixel * bytesPerPixel) + 1 ] = g;    //g
                    rgba[(pixel * bytesPerPixel) + 2 ] = b;    //b
                    rgba[(pixel * bytesPerPixel) + 3 ] = 0xff; //a

                } else if ((andMask[pixel] & PIXEL_MASK) ==
                           PIXEL_MASK) {
                    //Only screen value matters, no mouse colouring
                    if (xorMask[pixel] == 0) {
                        //Transparent pixel
                        rgba[(pixel * bytesPerPixel)     ] = 0x00;
                        rgba[(pixel * bytesPerPixel) + 1 ] = 0x00;
                        rgba[(pixel * bytesPerPixel) + 2 ] = 0x00;
                        rgba[(pixel * bytesPerPixel) + 3 ] = 0x00;

                    } else if ((xorMask[pixel] & PIXEL_MASK) ==
                               PIXEL_MASK) {
                        //Inverted pixel, not supported in browsers.
                        //Fully opaque instead.
                        rgba[(pixel * bytesPerPixel)     ] = 0x00;
                        rgba[(pixel * bytesPerPixel) + 1 ] = 0x00;
                        rgba[(pixel * bytesPerPixel) + 2 ] = 0x00;
                        rgba[(pixel * bytesPerPixel) + 3 ] = 0xff;

                    } else {
                        //Unhandled xorMask
                        rgba[(pixel * bytesPerPixel)     ] = 0x00;
                        rgba[(pixel * bytesPerPixel) + 1 ] = 0x00;
                        rgba[(pixel * bytesPerPixel) + 2 ] = 0x00;
                        rgba[(pixel * bytesPerPixel) + 3 ] = 0xff;
                    }

                } else {
                    //Unhandled andMask
                    rgba[(pixel * bytesPerPixel)     ] = 0x00;
                    rgba[(pixel * bytesPerPixel) + 1 ] = 0x00;
                    rgba[(pixel * bytesPerPixel) + 2 ] = 0x00;
                    rgba[(pixel * bytesPerPixel) + 3 ] = 0xff;
                }
            }

        //Alpha cursor.
        } else if (cursorType == 1) {
            if (this._sock.rQwait("VMware cursor alpha encoding",
                                  (w * h * 4), 2)) {
                return false;
            }

            rgba = new Array(w * h * bytesPerPixel);

            for (let pixel = 0; pixel < (w * h); pixel++) {
                let data = this._sock.rQshift32();

                rgba[(pixel * 4)     ] = data >> 24 & 0xff; //r
                rgba[(pixel * 4) + 1 ] = data >> 16 & 0xff; //g
                rgba[(pixel * 4) + 2 ] = data >> 8 & 0xff;  //b
                rgba[(pixel * 4) + 3 ] = data & 0xff;       //a
            }

        } else {
            Log.Warn("The given cursor type is not supported: "
                      + cursorType + " given.");
            return false;
        }

        this._updateCursor(rgba, hotx, hoty, w, h);

        return true;
    }

    _handleVMwareCursorPosition() {
        const x = this._FBU.x;
        const y = this._FBU.y;

        if (this._pointerLock) {
            // Only attempt to match the server's pointer position if we are in
            // pointer lock mode.
            this._mousePos = { x: x, y: y };
        }

        return true;
    }

    _handleCursor() {
        const hotx = this._FBU.x;  // hotspot-x
        const hoty = this._FBU.y;  // hotspot-y
        const w = this._FBU.width;
        const h = this._FBU.height;

        const pixelslength = w * h * 4;
        const masklength = Math.ceil(w / 8) * h;

        let bytes = pixelslength + masklength;
        if (this._sock.rQwait("cursor encoding", bytes)) {
            return false;
        }

        // Decode from BGRX pixels + bit mask to RGBA
        const pixels = this._sock.rQshiftBytes(pixelslength);
        const mask = this._sock.rQshiftBytes(masklength);
        let rgba = new Uint8Array(w * h * 4);

        let pixIdx = 0;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                let maskIdx = y * Math.ceil(w / 8) + Math.floor(x / 8);
                let alpha = (mask[maskIdx] << (x % 8)) & 0x80 ? 255 : 0;
                rgba[pixIdx    ] = pixels[pixIdx + 2];
                rgba[pixIdx + 1] = pixels[pixIdx + 1];
                rgba[pixIdx + 2] = pixels[pixIdx];
                rgba[pixIdx + 3] = alpha;
                pixIdx += 4;
            }
        }

        this._updateCursor(rgba, hotx, hoty, w, h);

        return true;
    }

    _handleDesktopName() {
        if (this._sock.rQwait("DesktopName", 4)) {
            return false;
        }

        let length = this._sock.rQshift32();

        if (this._sock.rQwait("DesktopName", length, 4)) {
            return false;
        }

        let name = this._sock.rQshiftStr(length);
        name = decodeUTF8(name, true);

        this._setDesktopName(name);

        return true;
    }

    _handleExtendedDesktopSize() {
        if (this._sock.rQwait("ExtendedDesktopSize", 4)) {
            return false;
        }

        const numberOfScreens = this._sock.rQpeek8();

        let bytes = 4 + (numberOfScreens * 16);
        if (this._sock.rQwait("ExtendedDesktopSize", bytes)) {
            return false;
        }

        const firstUpdate = !this._supportsSetDesktopSize;
        this._supportsSetDesktopSize = true;

        // Normally we only apply the current resize mode after a
        // window resize event. However there is no such trigger on the
        // initial connect. And we don't know if the server supports
        // resizing until we've gotten here.
        if (firstUpdate) {
            this._requestRemoteResize();

            RFB.messages.setMaxVideoResolution(this._sock,
                this._maxVideoResolutionX,
                this._maxVideoResolutionY);
        }

        this._sock.rQskipBytes(1);  // number-of-screens
        this._sock.rQskipBytes(3);  // padding

        for (let i = 0; i < numberOfScreens; i += 1) {
            // Save the id and flags of the first screen
            let sI = this._sock.rQshift32();    // id
            let x = this._sock.rQshift16();                       // width
            let y = this._sock.rQshift16();                       // height
            let w = this._sock.rQshift16();                       // width
            let h = this._sock.rQshift16();                       // height
            if (i == 0) {
                this._screenIndex = 0;
                this._screenFlags = this._sock.rQshiftBytes(4); // flags
            } else {
                this._sock.rQskipBytes(4);
            }

            this._display.applyServerResolution(w, h, i);
            Log.Debug(`Server reported screen ${sI} with resolution ${w}x${h} at ${x}x${y}`);
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
            let msg = "";
            // The y-position indicates the status code from the server
            switch (this._FBU.y) {
                case 1:
                    msg = "Resize is administratively prohibited";
                    this._resizeSession = false;
                    this._clipViewport = false;
                    this._scaleViewport = false;
                    this.updateConnectionSettings();
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

        // There are certain conditions with multi-monitor that warrent forcing a full frame update after a delay
        if (this._display.screens.length > 1 && this._forceFullFrameUpdateAfterResize) {
            this._forceFullFrameUpdateAfterResize = false;
            clearTimeout(this._forceFullFrameUpdateTimeout);
            this._forceFullFrameUpdateTimeout = setTimeout(function(){
                RFB.messages.fbUpdateRequest(this._sock, false, 0, 0, this._fbWidth, this._fbHeight)
            }.bind(this), 500);
        }

        return true;
    }

    _handleDataRect() {
        let decoder = this._decoders[this._FBU.encoding];
        if (!decoder) {
            this._fail("Unsupported encoding (encoding: " +
                       this._FBU.encoding + ")");
            return false;
        }

        try {
            if (this._transitConnectionState == this.TransitConnectionStates.Udp || this._transitConnectionState == this.TransitConnectionStates.Failure) {
                if (this._transitConnectionState == this.TransitConnectionStates.Udp) {
                    Log.Warn("Implicit UDP Transit Failure, TCP rects recieved while in UDP mode.")
                    this._udpTransitFailures++;
                }
                this._changeTransitConnectionState(this.TransitConnectionStates.Tcp);
                this._display.clear();
                if (this._useUdp) {
                    if (this._udpConnectFailures < 3 && this._udpTransitFailures < 3) {
                        setTimeout(function() {
                            Log.Warn("Attempting to connect via UDP again after failure.")
                            this.enableWebRTC = true;
                        }.bind(this), 3000);
                    } else {
                        Log.Warn("UDP connection failures exceeded limit, remaining on TCP transit.")
                    }
                }
            } else if (this._transitConnectionState == this.TransitConnectionStates.Downgrading) {
                this._display.clear();
                this._changeTransitConnectionState(this.TransitConnectionStates.Tcp);
            }
            return decoder.decodeRect(this._FBU.x, this._FBU.y,
                                      this._FBU.width, this._FBU.height,
                                      this._sock, this._display,
                                      this._fbDepth, this._FBU.frame_id);
        } catch (err) {
            this._fail("Error decoding rect: " + err);
            return false;
        }
    }

    _updateContinuousUpdates() {
        if (!this._enabledContinuousUpdates) { return; }

        RFB.messages.enableContinuousUpdates(this._sock, true, 0, 0,
                                             this._fbWidth, this._fbHeight);
    }

    _resize(width, height) {
        this._fbWidth = width;
        this._fbHeight = height;

        this._display.resize(this._fbWidth, this._fbHeight);

        // Adjust the visible viewport based on the new dimensions
        this._updateClip();
        this._updateScale();

        this._updateContinuousUpdates();
    }

    _xvpOp(ver, op) {
        if (this._rfbXvpVer < ver) { return; }
        Log.Info("Sending XVP operation " + op + " (version " + ver + ")");
        RFB.messages.xvpOp(this._sock, ver, op);
    }

    _updateCursor(rgba, hotx, hoty, w, h) {
        this._cursorImage = {
            rgbaPixels: rgba,
            hotx: hotx, hoty: hoty, w: w, h: h,
        };

        this._refreshCursor();

        if (this._isPrimaryDisplay) {
            this._proxyRFBMessage('updateCursor', [ rgba, hotx, hoty, w, h ]);
        }
    }

    _shouldShowDotCursor() {
        // Called when this._cursorImage is updated
        if (!this._showDotCursor) {
            // User does not want to see the dot, so...
            return false;
        }

        // The dot should not be shown if the cursor is already visible,
        // i.e. contains at least one not-fully-transparent pixel.
        // So iterate through all alpha bytes in rgba and stop at the
        // first non-zero.
        for (let i = 3; i < this._cursorImage.rgbaPixels.length; i += 4) {
            if (this._cursorImage.rgbaPixels[i]) {
                return false;
            }
        }

        // At this point, we know that the cursor is fully transparent, and
        // the user wants to see the dot instead of this.
        return true;
    }

    _refreshCursor() {
        if (this._rfbConnectionState !== "connecting" &&
            this._rfbConnectionState !== "connected") {
            return;
        }
        const image = this._shouldShowDotCursor() ? RFB.cursors.dot : this._cursorImage;
        this._cursor.change(image.rgbaPixels,
                            image.hotx, image.hoty,
                            image.w, image.h
        );
    }

    static genDES(password, challenge) {
        const passwordChars = password.split('').map(c => c.charCodeAt(0));
        return (new DES(passwordChars)).encrypt(challenge);
    }
}

// Class Methods
RFB.messages = {
    keyEvent(sock, keysym, down) {
        const buff = sock._sQ;
        const offset = sock._sQlen;

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

    QEMUExtendedKeyEvent(sock, keysym, down, keycode) {
        function getRFBkeycode(xtScanCode) {
            const upperByte = (keycode >> 8);
            const lowerByte = (keycode & 0x00ff);
            if (upperByte === 0xe0 && lowerByte < 0x7f) {
                return lowerByte | 0x80;
            }
            return xtScanCode;
        }

        const buff = sock._sQ;
        const offset = sock._sQlen;

        buff[offset] = 255; // msg-type
        buff[offset + 1] = 0; // sub msg-type

        buff[offset + 2] = (down >> 8);
        buff[offset + 3] = down;

        buff[offset + 4] = (keysym >> 24);
        buff[offset + 5] = (keysym >> 16);
        buff[offset + 6] = (keysym >> 8);
        buff[offset + 7] = keysym;

        const RFBkeycode = getRFBkeycode(keycode);

        buff[offset + 8] = (RFBkeycode >> 24);
        buff[offset + 9] = (RFBkeycode >> 16);
        buff[offset + 10] = (RFBkeycode >> 8);
        buff[offset + 11] = RFBkeycode;

        sock._sQlen += 12;
        sock.flush();
    },

    pointerEvent(sock, x, y, mask, dX = 0, dY = 0) {
        const buff = sock._sQ;
        const offset = sock._sQlen;

        buff[offset] = 5; // msg-type

        buff[offset + 1] = mask >> 8;
        buff[offset + 2] = mask;

        buff[offset + 3] = x >> 8;
        buff[offset + 4] = x;

        buff[offset + 5] = y >> 8;
        buff[offset + 6] = y;

        buff[offset + 7] = dX >> 8;
        buff[offset + 8] = dX;

        buff[offset + 9] = dY >> 8;
        buff[offset + 10] = dY;

        sock._sQlen += 11;
        sock.flush();
    },

    // Used to build Notify and Request data.
    _buildExtendedClipboardFlags(actions, formats) {
        let data = new Uint8Array(4);
        let formatFlag = 0x00000000;
        let actionFlag = 0x00000000;

        for (let i = 0; i < actions.length; i++) {
            actionFlag |= actions[i];
        }

        for (let i = 0; i < formats.length; i++) {
            formatFlag |= formats[i];
        }

        data[0] = actionFlag >> 24; // Actions
        data[1] = 0x00;             // Reserved
        data[2] = 0x00;             // Reserved
        data[3] = formatFlag;       // Formats

        return data;
    },

    extendedClipboardProvide(sock, formats, inData) {
        // Deflate incomming data and their sizes
        let deflator = new Deflator();
        let dataToDeflate = [];

        for (let i = 0; i < formats.length; i++) {
            // We only support the format Text at this time
            if (formats[i] != extendedClipboardFormatText) {
                throw new Error("Unsupported extended clipboard format for Provide message.");
            }

            // Change lone \r or \n into \r\n as defined in rfbproto
            inData[i] = inData[i].replace(/\r\n|\r|\n/gm, "\r\n");

            // Check if it already has \0
            let text = encodeUTF8(inData[i] + "\0");

            dataToDeflate.push( (text.length >> 24) & 0xFF,
                                (text.length >> 16) & 0xFF,
                                (text.length >>  8) & 0xFF,
                                (text.length & 0xFF));

            for (let j = 0; j < text.length; j++) {
                dataToDeflate.push(text.charCodeAt(j));
            }
        }

        let deflatedData = deflator.deflate(new Uint8Array(dataToDeflate));

        // Build data  to send
        let data = new Uint8Array(4 + deflatedData.length);
        data.set(RFB.messages._buildExtendedClipboardFlags([extendedClipboardActionProvide],
                                                           formats));
        data.set(deflatedData, 4);

        RFB.messages.clientCutText(sock, data, true);
    },

    extendedClipboardNotify(sock, formats) {
        let flags = RFB.messages._buildExtendedClipboardFlags([extendedClipboardActionNotify],
                                                              formats);
        RFB.messages.clientCutText(sock, flags, true);
    },

    extendedClipboardRequest(sock, formats) {
        let flags = RFB.messages._buildExtendedClipboardFlags([extendedClipboardActionRequest],
                                                              formats);
        RFB.messages.clientCutText(sock, flags, true);
    },

    extendedClipboardCaps(sock, actions, formats) {
        let formatKeys = Object.keys(formats);
        let data  = new Uint8Array(4 + (4 * formatKeys.length));

        formatKeys.map(x => parseInt(x));
        formatKeys.sort((a, b) =>  a - b);

        data.set(RFB.messages._buildExtendedClipboardFlags(actions, []));

        let loopOffset = 4;
        for (let i = 0; i < formatKeys.length; i++) {
            data[loopOffset]     = formats[formatKeys[i]] >> 24;
            data[loopOffset + 1] = formats[formatKeys[i]] >> 16;
            data[loopOffset + 2] = formats[formatKeys[i]] >> 8;
            data[loopOffset + 3] = formats[formatKeys[i]] >> 0;

            loopOffset += 4;
            data[3] |= (1 << formatKeys[i]); // Update our format flags
        }

        RFB.messages.clientCutText(sock, data, true);
    },

    clientCutText(sock, data, extended = false) {
        const buff = sock._sQ;
        const offset = sock._sQlen;

        buff[offset] = 6; // msg-type

        buff[offset + 1] = 0; // padding
        buff[offset + 2] = 0; // padding
        buff[offset + 3] = 0; // padding

        let length;
        if (extended) {
            length = toUnsigned32bit(-data.length);
        } else {
            length = data.length;
        }

        buff[offset + 4] = length >> 24;
        buff[offset + 5] = length >> 16;
        buff[offset + 6] = length >> 8;
        buff[offset + 7] = length;

        sock._sQlen += 8;

        // We have to keep track of from where in the data we begin creating the
        // buffer for the flush in the next iteration.
        let dataOffset = 0;

        let remaining = data.length;
        while (remaining > 0) {

            let flushSize = Math.min(remaining, (sock._sQbufferSize - sock._sQlen));
            for (let i = 0; i < flushSize; i++) {
                buff[sock._sQlen + i] = data[dataOffset + i];
            }

            sock._sQlen += flushSize;
            sock.flush();

            remaining -= flushSize;
            dataOffset += flushSize;
        }

    },

    sendBinaryClipboard(sock, dataset, mimes) {

        
        const buff = sock._sQ;
        let offset = sock._sQlen;

        buff[offset] = 180; // msg-type
        buff[offset + 1] = dataset.length; // how many mime types
        sock._sQlen += 2;
        offset += 2;

        for (let i=0; i < dataset.length; i++) {
            let mime = mimes[i];
            let data = dataset[i];

            buff[offset++] = mime.length;

            for (let i = 0; i < mime.length; i++) {
                buff[offset++] = mime.charCodeAt(i); // change to [] if not a string
            }

            let length = data.length;

            Log.Info('Clipboard data sent mime type ' + mime + ' len ' + length);

            buff[offset++] = length >> 24;
            buff[offset++] = length >> 16;
            buff[offset++] = length >> 8;
            buff[offset++] = length;

            sock._sQlen += 1 + mime.length + 4;

            // We have to keep track of from where in the data we begin creating the
            // buffer for the flush in the next iteration.
            let dataOffset = 0;

            let remaining = data.length;
            while (remaining > 0) {

                let flushSize = Math.min(remaining, (sock._sQbufferSize - sock._sQlen));
                for (let i = 0; i < flushSize; i++) {
                    buff[sock._sQlen + i] = data[dataOffset + i];
                }

                sock._sQlen += flushSize;
                sock.flush();

                remaining -= flushSize;
                dataOffset += flushSize;
            }

            offset = sock._sQlen;
        }
    },

    sendSubscribeUnixRelay(sock, name) {
        const buff = sock._sQ;
        const offset = sock._sQlen;

        buff[offset] = 182;              // msg-type
        buff[offset + 1] = name.length;  // len
        for (let i = 0; i < name.length; i++) {
            buff[offset + 2 + i] = name.charCodeAt(i);
        }

        sock._sQlen += 2 + name.length;
        sock.flush();
    },

    sendUnixRelay(sock, name, data) {
        const buff = sock._sQ;
        let offset = sock._sQlen;

        buff[offset++] = 183;              // msg-type
        buff[offset++] = name.length;  // len
        for (let i = 0; i < name.length; i++) {
            buff[offset++] = name.charCodeAt(i);
        }

        let length = data.length;

        Log.Info('Sent unix relay data len ' + length);

        buff[offset++] = length >> 24;
        buff[offset++] = length >> 16;
        buff[offset++] = length >> 8;
        buff[offset++] = length;

        sock._sQlen += 2 + name.length + 4;

        // We have to keep track of from where in the data we begin creating the
        // buffer for the flush in the next iteration.
        let dataOffset = 0;

        let remaining = data.length;
        while (remaining > 0) {

            let flushSize = Math.min(remaining, (sock._sQbufferSize - sock._sQlen));
            for (let i = 0; i < flushSize; i++) {
                buff[sock._sQlen + i] = data[dataOffset + i];
            }

            sock._sQlen += flushSize;
            sock.flush();

            remaining -= flushSize;
            dataOffset += flushSize;
        }
    },

    setDesktopSize(sock, size, flags) {
        const buff = sock._sQ;
        const offset = sock._sQlen;

        buff[offset] = 251;              // msg-type
        buff[offset + 1] = 0;            // padding
        buff[offset + 2] = size.serverWidth >> 8;   // width
        buff[offset + 3] = size.serverWidth;
        buff[offset + 4] = size.serverHeight >> 8;  // height
        buff[offset + 5] = size.serverHeight;

        buff[offset + 6] = size.screens.length;            // number-of-screens
        buff[offset + 7] = 0;            // padding

        let i = 8;
        for (let iS = 0; iS < size.screens.length; iS++) {
            //screen id
            buff[offset + i++] = iS >> 24;
            buff[offset + i++] = iS >> 16;
            buff[offset + i++] = iS >> 8;
            buff[offset + i++] = iS;
            //screen x position
            buff[offset + i++] = size.screens[iS].x >> 8;
            buff[offset + i++] = size.screens[iS].x;
            //screen y position
            buff[offset + i++] = size.screens[iS].y >> 8;
            buff[offset + i++] = size.screens[iS].y;
            //screen width
            buff[offset + i++] = size.screens[iS].serverWidth >> 8;
            buff[offset + i++] = size.screens[iS].serverWidth;
            //screen height
            buff[offset + i++] = size.screens[iS].serverHeight >> 8;
            buff[offset + i++] = size.screens[iS].serverHeight;
            //flags
            buff[offset + i++] = flags >> 24;
            buff[offset + i++] = flags >> 16;
            buff[offset + i++] = flags >> 8;
            buff[offset + i++] = flags;
        }

        sock._sQlen += i;
        sock.flush();

    },

    setMaxVideoResolution(sock, width, height) {
        const buff = sock._sQ;
        const offset = sock._sQlen;

        buff[offset] = 252;              // msg-type
        buff[offset + 1] = width >> 8;   // width
        buff[offset + 2] = width;
        buff[offset + 3] = height >> 8;  // height
        buff[offset + 4] = height;

        sock._sQlen += 5;
        sock.flush();
    },

    clientFence(sock, flags, payload) {
        const buff = sock._sQ;
        const offset = sock._sQlen;

        buff[offset] = 248; // msg-type

        buff[offset + 1] = 0; // padding
        buff[offset + 2] = 0; // padding
        buff[offset + 3] = 0; // padding

        buff[offset + 4] = flags >> 24; // flags
        buff[offset + 5] = flags >> 16;
        buff[offset + 6] = flags >> 8;
        buff[offset + 7] = flags;

        const n = payload.length;

        buff[offset + 8] = n; // length

        for (let i = 0; i < n; i++) {
            buff[offset + 9 + i] = payload.charCodeAt(i);
        }

        sock._sQlen += 9 + n;
        sock.flush();
    },

    requestStats(sock) {
        const buff = sock._sQ;
        const offset = sock._sQlen;

        if (buff == null) { return; }

        buff[offset] = 178; // msg-type

        buff[offset + 1] = 0; // padding
        buff[offset + 2] = 0; // padding
        buff[offset + 3] = 0; // padding

        sock._sQlen += 4;
        sock.flush();
    },

    sendFrameStats(sock, allMs, renderMs) {
        const buff = sock._sQ;
        const offset = sock._sQlen;

        if (buff == null) { return; }

        buff[offset] = 179; // msg-type

        buff[offset + 1] = 0; // padding
        buff[offset + 2] = 0; // padding
        buff[offset + 3] = 0; // padding

        buff[offset + 4] = allMs >> 24;
        buff[offset + 5] = allMs >> 16;
        buff[offset + 6] = allMs >> 8;
        buff[offset + 7] = allMs;

        buff[offset + 8] = renderMs >> 24;
        buff[offset + 9] = renderMs >> 16;
        buff[offset + 10] = renderMs >> 8;
        buff[offset + 11] = renderMs;

        sock._sQlen += 12;
        sock.flush();
    },


    enableContinuousUpdates(sock, enable, x, y, width, height) {
        const buff = sock._sQ;
        const offset = sock._sQlen;

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

    pixelFormat(sock, depth, trueColor) {
        const buff = sock._sQ;
        const offset = sock._sQlen;

        let bpp;

        if (depth > 16) {
            bpp = 32;
        } else if (depth > 8) {
            bpp = 16;
        } else {
            bpp = 8;
        }

        const bits = Math.floor(depth/3);

        buff[offset] = 0;  // msg-type

        buff[offset + 1] = 0; // padding
        buff[offset + 2] = 0; // padding
        buff[offset + 3] = 0; // padding

        buff[offset + 4] = bpp;                 // bits-per-pixel
        buff[offset + 5] = depth;               // depth
        buff[offset + 6] = 0;                   // little-endian
        buff[offset + 7] = trueColor ? 1 : 0;  // true-color

        buff[offset + 8] = 0;    // red-max
        buff[offset + 9] = (1 << bits) - 1;  // red-max

        buff[offset + 10] = 0;   // green-max
        buff[offset + 11] = (1 << bits) - 1; // green-max

        buff[offset + 12] = 0;   // blue-max
        buff[offset + 13] = (1 << bits) - 1; // blue-max

        buff[offset + 14] = bits * 0; // red-shift
        buff[offset + 15] = bits * 1; // green-shift
        buff[offset + 16] = bits * 2; // blue-shift

        buff[offset + 17] = 0;   // padding
        buff[offset + 18] = 0;   // padding
        buff[offset + 19] = 0;   // padding

        sock._sQlen += 20;
        sock.flush();
    },

    clientEncodings(sock, encodings) {
        const buff = sock._sQ;
        const offset = sock._sQlen;

        buff[offset] = 2; // msg-type
        buff[offset + 1] = 0; // padding

        buff[offset + 2] = encodings.length >> 8;
        buff[offset + 3] = encodings.length;

        let j = offset + 4;
        for (let i = 0; i < encodings.length; i++) {
            const enc = encodings[i];
            buff[j] = enc >> 24;
            buff[j + 1] = enc >> 16;
            buff[j + 2] = enc >> 8;
            buff[j + 3] = enc;

            j += 4;
        }

        sock._sQlen += j - offset;
        sock.flush();
    },

    fbUpdateRequest(sock, incremental, x, y, w, h) {
        const buff = sock._sQ;
        const offset = sock._sQlen;

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

    xvpOp(sock, ver, op) {
        const buff = sock._sQ;
        const offset = sock._sQlen;

        buff[offset] = 250; // msg-type
        buff[offset + 1] = 0; // padding

        buff[offset + 2] = ver;
        buff[offset + 3] = op;

        sock._sQlen += 4;
        sock.flush();
    }
};

RFB.cursors = {
    none: {
        rgbaPixels: new Uint8Array(),
        w: 0, h: 0,
        hotx: 0, hoty: 0,
    },

    dot: {
        /* eslint-disable indent */
        rgbaPixels: new Uint8Array([
            255, 255, 255, 255,   0,   0,   0, 255, 255, 255, 255, 255,
              0,   0,   0, 255,   0,   0,   0,   0,   0,   0,  0,  255,
            255, 255, 255, 255,   0,   0,   0, 255, 255, 255, 255, 255,
        ]),
        /* eslint-enable indent */
        w: 3, h: 3,
        hotx: 1, hoty: 1,
    }
};
