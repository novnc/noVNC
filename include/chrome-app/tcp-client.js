/*
Copyright 2012 Google Inc.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

     http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

Author: Boris Smus (smus@chromium.org)
*/

(function(exports) {

  // Define some local variables here.
  var socket = chrome.socket || chrome.experimental.socket;
  var dns = chrome.experimental.dns;

  /**
   * Creates an instance of the client
   *
   * @param {String} host The remote host to connect to
   * @param {Number} port The port to connect to at the remote host
   */
  function TcpClient(host, port, pollInterval) {
    this.host = host;
    this.port = port;
    this.pollInterval = pollInterval || 15;

    // Callback functions.
    this.callbacks = {
      connect: null,    // Called when socket is connected.
      disconnect: null, // Called when socket is disconnected.
      recvBuffer: null, // Called (as ArrayBuffer) when client receives data from server.
      recvString: null, // Called (as string) when client receives data from server.
      sent: null        // Called when client sends data to server.
    };

    // Socket.
    this.socketId = null;
    this.isConnected = false;

    log('initialized tcp client');
  }

  /**
   * Connects to the TCP socket, and creates an open socket.
   *
   * @see http://developer.chrome.com/trunk/apps/socket.html#method-create
   * @param {Function} callback The function to call on connection
   */
  TcpClient.prototype.connect = function(callback) {
    // First resolve the hostname to an IP.
    dns.resolve(this.host, function(result) {
      this.addr = result.address;
      socket.create('tcp', {}, this._onCreate.bind(this));

      // Register connect callback.
      this.callbacks.connect = callback;
    }.bind(this));
  };

  /**
   * Sends an arraybuffer/view down the wire to the remote side
   *
   * @see http://developer.chrome.com/trunk/apps/socket.html#method-write
   * @param {String} msg The arraybuffer/view to send
   * @param {Function} callback The function to call when the message has sent
   */
  TcpClient.prototype.sendBuffer = function(buf, callback) {
    if (buf.buffer) {
        buf = buf.buffer;
    }

    /*
    // Debug
    var bytes = [], u8 = new Uint8Array(buf);
    for (var i = 0; i < u8.length; i++) {
        bytes.push(u8[i]);
    }
    log("sending bytes: " + (bytes.join(',')));
    */
    
    socket.write(this.socketId, buf, this._onWriteComplete.bind(this));

    // Register sent callback.
    this.callbacks.sent = callback;
  };

  /**
   * Sends a string down the wire to the remote side
   *
   * @see http://developer.chrome.com/trunk/apps/socket.html#method-write
   * @param {String} msg The string to send
   * @param {Function} callback The function to call when the message has sent
   */
  TcpClient.prototype.sendString = function(msg, callback) {
    /*
    // Debug
    log("sending string: " + msg);
    */

    this._stringToArrayBuffer(msg, function(arrayBuffer) {
      socket.write(this.socketId, arrayBuffer, this._onWriteComplete.bind(this));
    }.bind(this));

    // Register sent callback.
    this.callbacks.sent = callback;
  };

  /**
   * Sets the callback for when a message is received
   *
   * @param {Function} callback The function to call when a message has arrived
   * @param {String} type The callback argument type: "arraybuffer" or "string"
   */
  TcpClient.prototype.addResponseListener = function(callback, type) {
    if (typeof type === "undefined") {
        type = "arraybuffer";
    }
    // Register received callback.
    if (type === "string") {
      this.callbacks.recvString = callback;
    } else {
      this.callbacks.recvBuffer = callback;
    }
  };

  /**
   * Sets the callback for when the socket disconnects
   *
   * @param {Function} callback The function to call when the socket disconnects
   * @param {String} type The callback argument type: "arraybuffer" or "string"
   */
  TcpClient.prototype.addDisconnectListener = function(callback) {
    // Register disconnect callback.
    this.callbacks.disconnect = callback;
  };

  /**
   * Disconnects from the remote side
   *
   * @see http://developer.chrome.com/trunk/apps/socket.html#method-disconnect
   */
  TcpClient.prototype.disconnect = function() {
    if (this.isConnected) {
      this.isConnected = false;
      socket.disconnect(this.socketId);
      if (this.callbacks.disconnect) {
        this.callbacks.disconnect();
      }
      log('socket disconnected');
    }
  };

  /**
   * The callback function used for when we attempt to have Chrome
   * create a socket. If the socket is successfully created
   * we go ahead and connect to the remote side.
   *
   * @private
   * @see http://developer.chrome.com/trunk/apps/socket.html#method-connect
   * @param {Object} createInfo The socket details
   */
  TcpClient.prototype._onCreate = function(createInfo) {
    this.socketId = createInfo.socketId;
    if (this.socketId > 0) {
      socket.connect(this.socketId, this.addr, this.port, this._onConnectComplete.bind(this));
    } else {
      error('Unable to create socket');
    }
  };

  /**
   * The callback function used for when we attempt to have Chrome
   * connect to the remote side. If a successful connection is
   * made then polling starts to check for data to read
   *
   * @private
   * @param {Number} resultCode Indicates whether the connection was successful
   */
  TcpClient.prototype._onConnectComplete = function(resultCode) {
    // Start polling for reads.
    this.isConnected = true;
    setTimeout(this._periodicallyRead.bind(this), this.pollInterval);

    if (this.callbacks.connect) {
      log('connect complete');
      this.callbacks.connect();
    }
    log('onConnectComplete');
  };

  /**
   * Checks for new data to read from the socket
   *
   * @see http://developer.chrome.com/trunk/apps/socket.html#method-read
   */
  TcpClient.prototype._periodicallyRead = function() {
    var that = this;
    socket.getInfo(this.socketId, function (info) {
      if (info.connected) {
        setTimeout(that._periodicallyRead.bind(that), that.pollInterval);
        socket.read(that.socketId, null, that._onDataRead.bind(that));
      } else if (that.isConnected) {
        log('socket disconnect detected');
        that.disconnect();
      }
   });
  };

  /**
   * Callback function for when data has been read from the socket.
   * Converts the array buffer that is read in to a string
   * and sends it on for further processing by passing it to
   * the previously assigned callback function.
   *
   * @private
   * @see TcpClient.prototype.addResponseListener
   * @param {Object} readInfo The incoming message
   */
  TcpClient.prototype._onDataRead = function(readInfo) {
    // Call received callback if there's data in the response.
    if (readInfo.resultCode > 0) {
      log('onDataRead');

      /*
      // Debug
      var bytes = [], u8 = new Uint8Array(readInfo.data);
      for (var i = 0; i < u8.length; i++) {
          bytes.push(u8[i]);
      }
      log("received bytes: " + (bytes.join(',')));
      */
      
      if (this.callbacks.recvBuffer) {
        // Return raw ArrayBuffer directly.
        this.callbacks.recvBuffer(readInfo.data);
      }
      if (this.callbacks.recvString) {
        // Convert ArrayBuffer to string.
        this._arrayBufferToString(readInfo.data, function(str) {
          this.callbacks.recvString(str);
        }.bind(this));
      }

      // Trigger another read right away
      setTimeout(this._periodicallyRead.bind(this), 0);
    }
  };

  /**
   * Callback for when data has been successfully
   * written to the socket.
   *
   * @private
   * @param {Object} writeInfo The outgoing message
   */
  TcpClient.prototype._onWriteComplete = function(writeInfo) {
    log('onWriteComplete');
    // Call sent callback.
    if (this.callbacks.sent) {
      this.callbacks.sent(writeInfo);
    }
  };

  /**
   * Converts an array buffer to a string
   *
   * @private
   * @param {ArrayBuffer} buf The buffer to convert
   * @param {Function} callback The function to call when conversion is complete
   */
  TcpClient.prototype._arrayBufferToString = function(buf, callback) {
    var bb = new Blob([new Uint8Array(buf)]);
    var f = new FileReader();
    f.onload = function(e) {
      callback(e.target.result);
    };
    f.readAsText(bb);
  };

  /**
   * Converts a string to an array buffer
   *
   * @private
   * @param {String} str The string to convert
   * @param {Function} callback The function to call when conversion is complete
   */
  TcpClient.prototype._stringToArrayBuffer = function(str, callback) {
    var bb = new Blob([str]);
    var f = new FileReader();
    f.onload = function(e) {
        callback(e.target.result);
    };
    f.readAsArrayBuffer(bb);
  };

  /**
   * Wrapper function for logging
   */
  function log(msg) {
    console.log(msg);
  }

  /**
   * Wrapper function for error logging
   */
  function error(msg) {
    console.error(msg);
  }

  exports.TcpClient = TcpClient;

})(window);
