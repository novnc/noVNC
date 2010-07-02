// Copyright: Hiroshi Ichikawa <http://gimite.net/en/>
// License: New BSD License
// Reference: http://dev.w3.org/html5/websockets/
// Reference: http://tools.ietf.org/html/draft-hixie-thewebsocketprotocol

(function() {
  
  if (window.WebSocket) return;

  var console = window.console;
  if (!console) console = {log: function(){ }, error: function(){ }};

  function hasFlash() {
    if ('navigator' in window && 'plugins' in navigator && navigator.plugins['Shockwave Flash']) {
      return !!navigator.plugins['Shockwave Flash'].description;
    }
    if ('ActiveXObject' in window) {
      try {
        return !!new ActiveXObject('ShockwaveFlash.ShockwaveFlash').GetVariable('$version');
      } catch (e) {}
    }
    return false;
  }
  
  if (!hasFlash()) {
    console.error("Flash Player is not installed.");
    return;
  }

  WebSocket = function(url, protocol, proxyHost, proxyPort, headers) {
    var self = this;
    self.readyState = WebSocket.CONNECTING;
    self.bufferedAmount = 0;
    WebSocket.__addTask(function() {
      self.__flash =
        WebSocket.__flash.create(url, protocol, proxyHost || null, proxyPort || 0, headers || null);

      self.__messageHandler = function() {
        var i, arr, data;
        arr = self.__flash.readSocketData();
        for (i=0; i < arr.length; i++) {
          data = decodeURIComponent(arr[i]);
          try {
            if (self.onmessage) {
              var e;
              if (window.MessageEvent) {
                e = document.createEvent("MessageEvent");
                e.initMessageEvent("message", false, false, data, null, null, window, null);
              } else { // IE
                e = {data: data};
              }
              self.onmessage(e);
            }
          } catch (e) {
            console.error(e.toString());
          }
        }
      };

      self.__flash.addEventListener("open", function(fe) {
        self.readyState = self.__flash.getReadyState();

        // For browsers (like Opera) that drop events, also poll for
        // message data
        if (self.__messageHandlerID) {
          clearInterval(self.__messageHandlerID);
        }
        self.__messageHandlerID = setInterval(function () {
            //console.log("polling for message data");
            self.__messageHandler; }, 500);

        try {
          if (self.onopen) {
            self.onopen();
          } else {
            // If "open" comes back in the same thread, then the
            // caller will not have set the onopen handler yet.
            setTimeout(function () {
                if (self.onopen) { self.onopen(); } }, 10);
          }
        } catch (e) {
          console.error(e.toString());
        }
      });

      self.__flash.addEventListener("close", function(fe) {
        self.readyState = self.__flash.getReadyState();

        if (self.__messageHandlerID) {
          clearInterval(self.__messageHandlerID);
        }
        try {
          if (self.onclose) self.onclose();
        } catch (e) {
          console.error(e.toString());
        }
      });

      self.__flash.addEventListener("message", self.__messageHandler);

      self.__flash.addEventListener("error", function(fe) {
        if (self.__messageHandlerID) {
          clearInterval(self.__messageHandlerID);
        }
        try {
          if (self.onerror) self.onerror();
        } catch (e) {
          console.error(e.toString());
        }
      });

      self.__flash.addEventListener("stateChange", function(fe) {
        try {
          self.readyState = fe.getReadyState();
          self.bufferedAmount = fe.getBufferedAmount();
        } catch (e) {
          console.error(e.toString());
        }
      });

      //console.log("[WebSocket] Flash object is ready");
    });
  }

  WebSocket.prototype.send = function(data) {
    this.readyState = this.__flash.getReadyState();
    if (!this.__flash || this.readyState == WebSocket.CONNECTING) {
      throw "INVALID_STATE_ERR: Web Socket connection has not been established";
    }
    var result = this.__flash.send(encodeURIComponent(data));
    if (result < 0) { // success
      return true;
    } else {
      this.bufferedAmount = result;
      return false;
    }
  };

  WebSocket.prototype.close = function() {
    if (!this.__flash) return;
    this.readyState = this.__flash.getReadyState();
    if (this.readyState != WebSocket.OPEN) return;
    this.__flash.close();
    // Sets/calls them manually here because Flash WebSocketConnection.close cannot fire events
    // which causes weird error:
    // > You are trying to call recursively into the Flash Player which is not allowed.
    this.readyState = WebSocket.CLOSED;
    if (this.__messageHandlerID) {
      clearInterval(this.__messageHandlerID);
    }
    if (this.onclose) this.onclose();
  };

  /**
   * Implementation of {@link <a href="http://www.w3.org/TR/DOM-Level-2-Events/events.html#Events-registration">DOM 2 EventTarget Interface</a>}
   *
   * @param {string} type
   * @param {function} listener
   * @param {boolean} useCapture !NB Not implemented yet
   * @return void
   */
  WebSocket.prototype.addEventListener = function(type, listener, useCapture) {
    if (!('__events' in this)) {
      this.__events = {};
    }
    if (!(type in this.__events)) {
      this.__events[type] = [];
      if ('function' == typeof this['on' + type]) {
        this.__events[type].defaultHandler = this['on' + type];
        this['on' + type] = WebSocket_FireEvent(this, type);
      }
    }
    this.__events[type].push(listener);
  };

  /**
   * Implementation of {@link <a href="http://www.w3.org/TR/DOM-Level-2-Events/events.html#Events-registration">DOM 2 EventTarget Interface</a>}
   *
   * @param {string} type
   * @param {function} listener
   * @param {boolean} useCapture NB! Not implemented yet
   * @return void
   */
  WebSocket.prototype.removeEventListener = function(type, listener, useCapture) {
    if (!('__events' in this)) {
      this.__events = {};
    }
    if (!(type in this.__events)) return;
    for (var i = this.__events.length; i > -1; --i) {
      if (listener === this.__events[type][i]) {
        this.__events[type].splice(i, 1);
        break;
      }
    }
  };

  /**
   * Implementation of {@link <a href="http://www.w3.org/TR/DOM-Level-2-Events/events.html#Events-registration">DOM 2 EventTarget Interface</a>}
   *
   * @param {WebSocketEvent} event
   * @return void
   */
  WebSocket.prototype.dispatchEvent = function(event) {
    if (!('__events' in this)) throw 'UNSPECIFIED_EVENT_TYPE_ERR';
    if (!(event.type in this.__events)) throw 'UNSPECIFIED_EVENT_TYPE_ERR';

    for (var i = 0, l = this.__events[event.type].length; i < l; ++ i) {
      this.__events[event.type][i](event);
      if (event.cancelBubble) break;
    }

    if (false !== event.returnValue &&
        'function' == typeof this.__events[event.type].defaultHandler)
    {
      this.__events[event.type].defaultHandler(event);
    }
  };

  /**
   *
   * @param {object} object
   * @param {string} type
   */
  function WebSocket_FireEvent(object, type) {
    return function(data) {
      var event = new WebSocketEvent();
      event.initEvent(type, true, true);
      event.target = event.currentTarget = object;
      for (var key in data) {
        event[key] = data[key];
      }
      object.dispatchEvent(event, arguments);
    };
  }

  /**
   * Basic implementation of {@link <a href="http://www.w3.org/TR/DOM-Level-2-Events/events.html#Events-interface">DOM 2 EventInterface</a>}
   *
   * @class
   * @constructor
   */
  function WebSocketEvent(){}

  /**
   *
   * @type boolean
   */
  WebSocketEvent.prototype.cancelable = true;

  /**
   *
   * @type boolean
   */
  WebSocketEvent.prototype.cancelBubble = false;

  /**
   *
   * @return void
   */
  WebSocketEvent.prototype.preventDefault = function() {
    if (this.cancelable) {
      this.returnValue = false;
    }
  };

  /**
   *
   * @return void
   */
  WebSocketEvent.prototype.stopPropagation = function() {
    this.cancelBubble = true;
  };

  /**
   *
   * @param {string} eventTypeArg
   * @param {boolean} canBubbleArg
   * @param {boolean} cancelableArg
   * @return void
   */
  WebSocketEvent.prototype.initEvent = function(eventTypeArg, canBubbleArg, cancelableArg) {
    this.type = eventTypeArg;
    this.cancelable = cancelableArg;
    this.timeStamp = new Date();
  };


  WebSocket.CONNECTING = 0;
  WebSocket.OPEN = 1;
  WebSocket.CLOSING = 2;
  WebSocket.CLOSED = 3;

  WebSocket.__tasks = [];

  WebSocket.__initialize = function() {
    if (WebSocket__swfLocation) {
        WebSocket.__swfLocation = WebSocket__swfLocation;
    }
    if (!WebSocket.__swfLocation) {
      console.error("[WebSocket] set WebSocket.__swfLocation to location of WebSocketMain.swf");
      return;
    }
    var container = document.createElement("div");
    container.id = "webSocketContainer";
    // Puts the Flash out of the window. Note that we cannot use display: none or visibility: hidden
    // here because it prevents Flash from loading at least in IE.
    container.style.position = "absolute";
    container.style.left = "-100px";
    container.style.top = "-100px";
    var holder = document.createElement("div");
    holder.id = "webSocketFlash";
    container.appendChild(holder);
    document.body.appendChild(container);
    swfobject.embedSWF(
      WebSocket.__swfLocation, "webSocketFlash", "8", "8", "9.0.0",
      null, {bridgeName: "webSocket"}, null, null,
      function(e) {
        if (!e.success) console.error("[WebSocket] swfobject.embedSWF failed");
      }
    );
    FABridge.addInitializationCallback("webSocket", function() {
      try {
        //console.log("[WebSocket] FABridge initializad");
        WebSocket.__flash = FABridge.webSocket.root();
        WebSocket.__flash.setCallerUrl(location.href);
        WebSocket.__flash.setDebug(!!WebSocket.__debug);
        for (var i = 0; i < WebSocket.__tasks.length; ++i) {
          WebSocket.__tasks[i]();
        }
        WebSocket.__tasks = [];
      } catch (e) {
        console.error("[WebSocket] " + e.toString());
      }
    });
  };

  WebSocket.__addTask = function(task) {
    if (WebSocket.__flash) {
      task();
    } else {
      WebSocket.__tasks.push(task);
    }
  }

  // called from Flash
  window.webSocketLog = function(message) {
    console.log(decodeURIComponent(message));
  };

  // called from Flash
  window.webSocketError = function(message) {
    console.error(decodeURIComponent(message));
  };

  if (!WebSocket.__disableAutoInitialization) {
    if (window.addEventListener) {
      window.addEventListener("load", WebSocket.__initialize, false);
    } else {
      window.attachEvent("onload", WebSocket.__initialize);
    }
  }
  
})();
