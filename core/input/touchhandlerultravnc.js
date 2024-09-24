import * as Log from '../util/logging.js';

export default class TouchHandlerUltraVNC {
    static PF_flag = 0x80000000;  // Pressed Flag : active if the touch event is pressed, inactive if it's being released.
    static R1_flag = 0x40000000;  // Reserved 1
    static IF_flag = 0x20000000;  // Primary Flag : active if the touch event is the primary touch event.
    static S1_flag = 0x10000000;  // Size Flag : active if the message contains information about the size of the touch event. The events are currently all sent as symetrical ellipses.
    static S2_flag = 0x8000000;   // Reserved for asymetrical ellipses. Not supported yet and should be 0.
    static RT_flag = 0x4000000;   // Rectangle : the touch event is a rectangle instead of an ellipse.
    static PR_flag = 0x2000000;   // Pressure Flag : pressure of the touch. Currently unused.
    static TI_flag = 0x1000000;   // Timestamp : the timestamp of the touch event.
    static HC_flag = 0x800000;    // High Performance Counter

    static LENGTH_16_flag = 0x10; // 16 bits signed for x touch coordinate followed by 16 bits signed for y together in a 32 bits word
    static IDFORMAT_32    = 0x1;  // 32 bits ID
    static IDFORMAT_CLEAR = 0xF;  // No more touch points

    constructor() {
        this._target = null;

        this._currentTouches = [];
        this._sendTouchesIntervalId = -1;
        this._giiDeviceOrigin = 0;
        this._isUltraVNCTouchActivated = false;

        this._boundEventHandler = this._handleTouch.bind(this);
    }

    attach(target) {
        this.detach();

        this._target = target;
        this._target.addEventListener('touchstart',
            this._boundEventHandler);
        this._target.addEventListener('touchmove',
            this._boundEventHandler);
        this._target.addEventListener('touchend',
            this._boundEventHandler);
        this._target.addEventListener('touchcancel',
            this._boundEventHandler);
    }

    detach() {
        if (!this._target) {
            return;
        }

        this._target.removeEventListener('touchstart',
            this._boundEventHandler);
        this._target.removeEventListener('touchmove',
            this._boundEventHandler);
        this._target.removeEventListener('touchend',
            this._boundEventHandler);
        this._target.removeEventListener('touchcancel',
            this._boundEventHandler);

        clearInterval(this._sendTouchesIntervalId);
        this._sendTouchesIntervalId = -1;

        this._target = null;
    }

    _handleTouch(ev) {
        ev.preventDefault();
        ev.stopImmediatePropagation();

        if (!this._isUltraVNCTouchActivated) {
            return;
        }

        if (ev.type === "touchstart") {
            for (let i = 0; i < ev.changedTouches.length; i++) {
                ev.changedTouches[i].touchIdentifier = this._getTouchIdentifier();
                this._currentTouches.push({ event: ev.changedTouches[i], status: "POINTER_DOWN" });
            }

            if (this._sendTouchesIntervalId === -1 && this._target) {
                this._dispatchTouchEvent(ev);
                this._sendTouchesIntervalId = setInterval(() => {
                    this._dispatchTouchEvent(ev);
                }, 200);
            }
        } else if (ev.type === "touchmove") {
            for (let i = 0; i < ev.changedTouches.length; i++) {
                const index = this._currentTouches.findIndex(t => t.event.identifier === ev.changedTouches[i].identifier);
                if (index !== -1) {
                    ev.changedTouches[i].touchIdentifier = this._currentTouches[index].event.touchIdentifier;
                    this._currentTouches[index].event = ev.changedTouches[i];
                    this._currentTouches[index].status = "POINTER_UPDATE";
                }
            }
        } else if (ev.type === "touchend" || ev.type === "touchcancel") {
            for (let i = 0; i < ev.changedTouches.length; i++) {
                const indexes = this._getAllIndexes(this._currentTouches, (t) => t.event.identifier === ev.changedTouches[i].identifier)
                indexes.forEach((index) => this._currentTouches[index].status = "POINTER_UP");
            }
        }
    }

    _getAllIndexes(arr, func) {
        var indexes = [], i;
        for (i = 0; i < arr.length; i++)
            if (func(arr[i]))
                indexes.push(i);
        return indexes;
    }

    _getTouchIdentifier() {
        const ids = this._currentTouches.map((ev) => ev.event.touchIdentifier);
        let i = 0;
        while (ids.includes(i)) { i++; }
        return i;
    }

    _dispatchTouchEvent(ev) {
        let tev = new CustomEvent('ultravnctouch', { event: ev, detail: { currentTouches: this._currentTouches, giiDeviceOrigin: this._giiDeviceOrigin } });
        this._target.dispatchEvent(tev);
    }

    _removeTouch(index) {
        this._currentTouches.splice(index, 1);
    }

    _interruptTouches() {
        clearInterval(this._sendTouchesIntervalId);
        this._sendTouchesIntervalId = -1;
    }
}