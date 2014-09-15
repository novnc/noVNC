var FakeWebSocket;

(function () {
    // PhantomJS can't create Event objects directly, so we need to use this
    function make_event(name, props) {
        var evt = document.createEvent('Event');
        evt.initEvent(name, true, true);
        if (props) {
            for (var prop in props) {
                evt[prop] = props[prop];
            }
        }
        return evt;
    }

    FakeWebSocket = function (uri, protocols) {
        this.url = uri;
        this.binaryType = "arraybuffer";
        this.extensions = "";

        if (!protocols || typeof protocols === 'string') {
            this.protocol = protocols;
        } else {
            this.protocol = protocols[0];
        }

        this._send_queue = new Uint8Array(20000);

        this.readyState = FakeWebSocket.CONNECTING;
        this.bufferedAmount = 0;

        this.__is_fake = true;
    };

    FakeWebSocket.prototype = {
        close: function (code, reason) {
            this.readyState = FakeWebSocket.CLOSED;
            if (this.onclose) {
                this.onclose(make_event("close", { 'code': code, 'reason': reason, 'wasClean': true }));
            }
        },

        send: function (data) {
            if (this.protocol == 'base64') {
                data = Base64.decode(data);
            } else {
                data = new Uint8Array(data);
            }
            this._send_queue.set(data, this.bufferedAmount);
            this.bufferedAmount += data.length;
        },

        _get_sent_data: function () {
            var arr = [];
            for (var i = 0; i < this.bufferedAmount; i++) {
                arr[i] = this._send_queue[i];
            }

            this.bufferedAmount = 0;

            return arr;
        },

        _open: function (data) {
            this.readyState = FakeWebSocket.OPEN;
            if (this.onopen) {
                this.onopen(make_event('open'));
            }
        },

        _receive_data: function (data) {
            this.onmessage(make_event("message", { 'data': data }));
        }
    };

    FakeWebSocket.OPEN = WebSocket.OPEN;
    FakeWebSocket.CONNECTING = WebSocket.CONNECTING;
    FakeWebSocket.CLOSING = WebSocket.CLOSING;
    FakeWebSocket.CLOSED = WebSocket.CLOSED;

    FakeWebSocket.__is_fake = true;

    FakeWebSocket.replace = function () {
        if (!WebSocket.__is_fake) {
            var real_version = WebSocket;
            WebSocket = FakeWebSocket;
            FakeWebSocket.__real_version = real_version;
        }
    };

    FakeWebSocket.restore = function () {
        if (WebSocket.__is_fake) {
            WebSocket = WebSocket.__real_version;
        }
    };
})();
