// Copyright: Hiroshi Ichikawa <http://gimite.net/en/>
// Lincense: New BSD Lincense

(function() {
  
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

  FABTest = function() {
    var self = this;
    FABTest.__addTask(function() {
      self.__flash =
        FABTest.__flash.create();

      self.__flash.addEventListener("message", function(fe) {
        var data = decodeURIComponent(fe.getData());
        try {
          if (self.onmessage) {
            var e;
            if (window.MessageEvent) {
              e = document.createEvent("MessageEvent");
              e.initMessageEvent("message", false, false, data, null, null, window);
            } else { // IE
              e = {data: data};
            }
            self.onmessage(e);
          }
        } catch (e) {
          console.error(e.toString());
        }
      });

      //console.log("[FABTest] Flash object is ready");
    });
  }

  FABTest.prototype.start = function(eventDelay) {
    if (!this.__flash) {
      throw "INVALID_STATE_ERR: FABTest connection has not been established";
    }
    var result = this.__flash.start(eventDelay);
    if (result < 0) { // success
      return true;
    } else {
      return false;
    }
  };

  FABTest.prototype.stop = function() {
    if (!this.__flash) return;
    this.__flash.stop();
  };



  FABTest.__tasks = [];

  FABTest.__initialize = function() {
    if (!FABTest.__swfLocation) {
      console.error("[FABTest] set FABTest.__swfLocation to location of FABTestMain.swf");
      return;
    }
    var container = document.createElement("div");
    container.id = "fabTestContainer";
    // Puts the Flash out of the window. Note that we cannot use display: none or visibility: hidden
    // here because it prevents Flash from loading at least in IE.
    container.style.position = "absolute";
    container.style.left = "-100px";
    container.style.top = "-100px";
    var holder = document.createElement("div");
    holder.id = "fabTestFlash";
    container.appendChild(holder);
    document.body.appendChild(container);
    swfobject.embedSWF(
      FABTest.__swfLocation, "fabTestFlash", "8", "8", "9.0.0",
      null, {bridgeName: "fabTest"}, null, null,
      function(e) {
        if (!e.success) console.error("[FABTest] swfobject.embedSWF failed");
      }
    );
    FABridge.addInitializationCallback("fabTest", function() {
      try {
        console.log("[FABTest] FABridge initializad");
        FABTest.__flash = FABridge.fabTest.root();
        for (var i = 0; i < FABTest.__tasks.length; ++i) {
          FABTest.__tasks[i]();
        }
        FABTest.__tasks = [];
      } catch (e) {
        console.error("[FABTest] " + e.toString());
      }
    });
  };

  FABTest.__addTask = function(task) {
    if (FABTest.__flash) {
      task();
    } else {
      FABTest.__tasks.push(task);
    }
  }

  // called from Flash
  function fabTestLog(message) {
    console.log(decodeURIComponent(message));
  }

  // called from Flash
  function fabTestError(message) {
    console.error(decodeURIComponent(message));
  }

  if (window.addEventListener) {
    window.addEventListener("load", FABTest.__initialize, false);
  } else {
    window.attachEvent("onload", FABTest.__initialize);
  }
  
})();
