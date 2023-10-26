import RFB from "../core/rfb.js";
import * as WebUtil from "./webutil.js";
import { isTouchDevice, isSafari, hasScrollbarGutter, dragThreshold, supportsBinaryClipboard, isFirefox, isWindows, isIOS, supportsPointerLock }
    from '../core/util/browser.js';
import { MouseButtonMapper, XVNC_BUTTONS } from "../core/mousebuttonmapper.js";
import * as Log from '../core/util/logging.js';

const UI = {
    connected: false,
    screenID: null,
    screen: {},
    screens: [],
    supportsBroadcastChannel: (typeof BroadcastChannel !== "undefined"),
    controlChannel: null,
    //Initial Loading of the UI
    prime() {
        console.log('prime')
        this.start();
    },

    //Render default UI
    start() {
        console.log('start')
        window.addEventListener("beforeunload", (e) => { 
            if (UI.rfb) { 
                UI.disconnect(); 
            }
            console.log('beforeunload')
        });


        UI.addDefaultHandlers();
        UI.updateVisualState('disconnected');
    },

    addDefaultHandlers() {
        document.getElementById('noVNC_connect_button').addEventListener('click', UI.connect);
    },

    getSetting(name, isBool, default_value) {
        let val = WebUtil.readSetting(name);
        if ((val === 'undefined' || val === null) && default_value !== 'undefined' && default_value !== null) {
            val = default_value;
        }
        if (typeof val !== 'undefined' && val !== null && isBool) {
            if (val.toString().toLowerCase() in {'0': 1, 'no': 1, 'false': 1}) {
                val = false;
            } else {
                val = true;
            }
        }
        return val;
    },

    connect() {
        console.log('connect')
        UI.rfb = new RFB(document.getElementById('noVNC_container'),
                        document.getElementById('noVNC_keyboardinput'),
                        "", //URL
                        { 
                            shared: UI.getSetting('shared', true),
                            repeaterID: UI.getSetting('repeaterID', false),
                            credentials: { password: null } 
                        },
                        false // Not a primary display
                    );
        UI.rfb.addEventListener("connect", UI.connectFinished);
        //UI.rfb.addEventListener("disconnect", UI.disconnectFinished);
        UI.rfb.clipViewport = UI.getSetting('view_clip');
        UI.rfb.scaleViewport = UI.getSetting('resize') === 'scale';
        UI.rfb.resizeSession = UI.getSetting('resize') === 'remote';
        UI.rfb.qualityLevel = parseInt(UI.getSetting('quality'));
        UI.rfb.dynamicQualityMin = parseInt(UI.getSetting('dynamic_quality_min'));
        UI.rfb.dynamicQualityMax = parseInt(UI.getSetting('dynamic_quality_max'));
        UI.rfb.jpegVideoQuality = parseInt(UI.getSetting('jpeg_video_quality'));
        UI.rfb.webpVideoQuality = parseInt(UI.getSetting('webp_video_quality'));
        UI.rfb.videoArea = parseInt(UI.getSetting('video_area'));
        UI.rfb.videoTime = parseInt(UI.getSetting('video_time'));
        UI.rfb.videoOutTime = parseInt(UI.getSetting('video_out_time'));
        UI.rfb.videoScaling = parseInt(UI.getSetting('video_scaling'));
        UI.rfb.treatLossless = parseInt(UI.getSetting('treat_lossless'));
        UI.rfb.maxVideoResolutionX = parseInt(UI.getSetting('max_video_resolution_x'));
        UI.rfb.maxVideoResolutionY = parseInt(UI.getSetting('max_video_resolution_y'));
        UI.rfb.frameRate = parseInt(UI.getSetting('framerate'));
        UI.rfb.compressionLevel = parseInt(UI.getSetting('compression'));
        UI.rfb.showDotCursor = UI.getSetting('show_dot', true);
        UI.rfb.idleDisconnect = UI.getSetting('idle_disconnect');
        UI.rfb.pointerRelative = UI.getSetting('pointer_relative');
        UI.rfb.videoQuality = parseInt(UI.getSetting('video_quality'));
        UI.rfb.antiAliasing = UI.getSetting('anti_aliasing');
        UI.rfb.clipboardUp = UI.getSetting('clipboard_up', true, true);
        UI.rfb.clipboardDown = UI.getSetting('clipboard_down', true, true);
        UI.rfb.clipboardSeamless = UI.getSetting('clipboard_seamless', true, true);
        UI.rfb.keyboard.enableIME = UI.getSetting('enable_ime', true, false);
        UI.rfb.clipboardBinary = supportsBinaryClipboard() && UI.rfb.clipboardSeamless;
        UI.rfb.enableWebRTC = UI.getSetting('enable_webrtc', true, false);
        UI.rfb.enableHiDpi = UI.getSetting('enable_hidpi', true, false);
        UI.rfb.mouseButtonMapper = UI.initMouseButtonMapper();
        if (UI.rfb.videoQuality === 5) {
            UI.rfb.enableQOI = true;
        }

        if (UI.supportsBroadcastChannel) {
            console.log('add event listener')
            UI.controlChannel = new BroadcastChannel("registrationChannel");
            UI.controlChannel.addEventListener('message', UI.handleControlMessage)
        }

        //attach this secondary display to the primary display
        if (UI.screenID === null) {
            const screen = UI.rfb.attachSecondaryDisplay();
            UI.screenID = screen.screenID
            UI.screen = screen
        } else {
            console.log('else reattach screens')
            console.log(UI.screen)
            UI.rfb.reattachSecondaryDisplay(UI.screen);
        }
        document.querySelector('title').textContent = 'Display ' + UI.screenID


        if (supportsBinaryClipboard()) {
            // explicitly request permission to the clipboard
            navigator.permissions.query({ name: "clipboard-read" }).then((result) => { Log.Debug('binary clipboard enabled') });
        }
    },

    handleControlMessage(event) {
        switch (event.data.eventType) {
            case 'identify':
                UI.identify(event.data)
                break;
            case 'secondarydisconnected':
                UI.updateVisualState('disconnected');
                break;
        }
    },

    updateVisualState(state) {
        document.documentElement.classList.remove("noVNC_connecting");
        document.documentElement.classList.remove("noVNC_connected");
        document.documentElement.classList.remove("noVNC_disconnecting");
        document.documentElement.classList.remove("noVNC_reconnecting");
        document.documentElement.classList.remove("noVNC_disconnected");

        const transitionElem = document.getElementById("noVNC_transition_text");
        if (WebUtil.isInsideKasmVDI())         
        {
            parent.postMessage({ action: 'connection_state', value: state}, '*' );
        }

        let connect_el = document.getElementById('noVNC_connect_dlg');

        switch (state) {
            case 'init':
                break;
            case 'connecting':
                transitionElem.textContent = _("Connecting...");
                document.documentElement.classList.add("noVNC_connecting");
                break;
            case 'connected':
                document.documentElement.classList.add("noVNC_connected");
                if (!connect_el.classList.contains("noVNC_hidden")) {
                    connect_el.classList.add('noVNC_hidden');
                }
                break;
            case 'disconnecting':
                transitionElem.textContent = _("Disconnecting...");
                document.documentElement.classList.add("noVNC_disconnecting");
                break;
            case 'disconnected':
                console.log('disconnected')
                document.documentElement.classList.add("noVNC_disconnected");
                if (connect_el.classList.contains("noVNC_hidden")) {
                    connect_el.classList.remove('noVNC_hidden');
                }
                UI.disconnect()
                break;
            case 'reconnecting':
                transitionElem.textContent = _("Reconnecting...");
                document.documentElement.classList.add("noVNC_reconnecting");
                break;
            default:
                Log.Error("Invalid visual state: " + state);
                UI.showStatus(_("Internal error"), 'error');
                return;
        }
    },

    identify(data) {
        UI.screens = data.screens
        console.log('identify')
        const screen = data.screens.find(el => el.id === UI.screenID)
        if (screen) {
            document.getElementById('noVNC_identify_monitor').innerHTML = screen.num
            document.getElementById('noVNC_identify_monitor').classList.add("show")
            document.querySelector('title').textContent = 'Display ' + screen.num + ' - ' + UI.screenID
            setTimeout(() => {
                document.getElementById('noVNC_identify_monitor').classList.remove("show")
            }, 3500)
        }
    },


    showStatus(text, statusType, time, kasm = false) {
        // If inside the full Kasm CDI framework, don't show messages unless explicitly told to
        if (WebUtil.isInsideKasmVDI() && !kasm) {
            return;
        }

        const statusElem = document.getElementById('noVNC_status');

        if (typeof statusType === 'undefined') {
            statusType = 'normal';
        }

        // Don't overwrite more severe visible statuses and never
        // errors. Only shows the first error.
        if (statusElem.classList.contains("noVNC_open")) {
            if (statusElem.classList.contains("noVNC_status_error")) {
                return;
            }
            if (statusElem.classList.contains("noVNC_status_warn") &&
                statusType === 'normal') {
                return;
            }
        }

        clearTimeout(UI.statusTimeout);

        switch (statusType) {
            case 'error':
                statusElem.classList.remove("noVNC_status_warn");
                statusElem.classList.remove("noVNC_status_normal");
                statusElem.classList.add("noVNC_status_error");
                break;
            case 'warning':
            case 'warn':
                statusElem.classList.remove("noVNC_status_error");
                statusElem.classList.remove("noVNC_status_normal");
                statusElem.classList.add("noVNC_status_warn");
                break;
            case 'normal':
            case 'info':
            default:
                statusElem.classList.remove("noVNC_status_error");
                statusElem.classList.remove("noVNC_status_warn");
                statusElem.classList.add("noVNC_status_normal");
                break;
        }

        statusElem.textContent = text;
        statusElem.classList.add("noVNC_open");

        // If no time was specified, show the status for 1.5 seconds
        if (typeof time === 'undefined') {
            time = 1500;
        }

        // Error messages do not timeout
        if (statusType !== 'error') {
            UI.statusTimeout = window.setTimeout(UI.hideStatus, time);
        }
    },

    hideStatus() {
        clearTimeout(UI.statusTimeout);
        document.getElementById('noVNC_status').classList.remove("noVNC_open");
    },

    disconnect() {
        if (UI.rfb) {
            UI.rfb.disconnect();
            if (UI.supportsBroadcastChannel) {
                console.log('remove event listeners')
                UI.controlChannel.removeEventListener('message', UI.handleControlMessage);
                UI.rfb.removeEventListener("connect", UI.connectFinished);
            }    
        }
    },

    connectFinished(e) {
        UI.connected = true;
        UI.inhibitReconnect = false;

        UI.showStatus("Secondary Screen Connected");
        UI.updateVisualState('connected');

        // Do this last because it can only be used on rendered elements
        UI.rfb.focus();
    },

    initMouseButtonMapper() {
        const mouseButtonMapper = new MouseButtonMapper();

        const settings = WebUtil.readSetting("mouseButtonMapper");
        if (settings) {
            mouseButtonMapper.load(settings);
            return mouseButtonMapper;
        }

        mouseButtonMapper.set(0, XVNC_BUTTONS.LEFT_BUTTON);
        mouseButtonMapper.set(1, XVNC_BUTTONS.MIDDLE_BUTTON);
        mouseButtonMapper.set(2, XVNC_BUTTONS.RIGHT_BUTTON);
        mouseButtonMapper.set(3, XVNC_BUTTONS.BACK_BUTTON);
        mouseButtonMapper.set(4, XVNC_BUTTONS.FORWARD_BUTTON);
        WebUtil.writeSetting("mouseButtonMapper", mouseButtonMapper.dump());

        return mouseButtonMapper;
    },
}

UI.prime();

export default UI;