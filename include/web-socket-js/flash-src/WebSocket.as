// Copyright: Hiroshi Ichikawa <http://gimite.net/en/>
// Lincense: New BSD Lincense
// Reference: http://dev.w3.org/html5/websockets/
// Reference: http://tools.ietf.org/html/draft-hixie-thewebsocketprotocol-31

package {

import flash.display.*;
import flash.events.*;
import flash.external.*;
import flash.net.*;
import flash.system.*;
import flash.utils.*;
import mx.core.*;
import mx.controls.*;
import mx.events.*;
import mx.utils.*;
import com.adobe.net.proxies.RFC2817Socket;

[Event(name="message", type="WebSocketMessageEvent")]
[Event(name="open", type="flash.events.Event")]
[Event(name="close", type="flash.events.Event")]
[Event(name="stateChange", type="WebSocketStateEvent")]
public class WebSocket extends EventDispatcher {
  
  private static var CONNECTING:int = 0;
  private static var OPEN:int = 1;
  private static var CLOSED:int = 2;
  
  private var socket:RFC2817Socket;
  private var main:WebSocketMain;
  private var scheme:String;
  private var host:String;
  private var port:uint;
  private var path:String;
  private var origin:String;
  private var protocol:String;
  private var buffer:ByteArray = new ByteArray();
  private var headerState:int = 0;
  private var readyState:int = CONNECTING;
  private var bufferedAmount:int = 0;
  private var headers:String;

  public function WebSocket(
      main:WebSocketMain, url:String, protocol:String,
      proxyHost:String = null, proxyPort:int = 0,
      headers:String = null) {
    this.main = main;
    var m:Array = url.match(/^(\w+):\/\/([^\/:]+)(:(\d+))?(\/.*)?$/);
    if (!m) main.fatal("invalid url: " + url);
    this.scheme = m[1];
    this.host = m[2];
    this.port = parseInt(m[4] || "80");
    this.path = m[5] || "/";
    this.origin = main.getOrigin();
    this.protocol = protocol;
    // if present and not the empty string, headers MUST end with \r\n
    // headers should be zero or more complete lines, for example
    // "Header1: xxx\r\nHeader2: yyyy\r\n"
    this.headers = headers;
    
    socket = new RFC2817Socket();
            
    // if no proxy information is supplied, it acts like a normal Socket
    // @see RFC2817Socket::connect
    if (proxyHost != null && proxyPort != 0){      
      socket.setProxyInfo(proxyHost, proxyPort);
    } 
    
    socket.addEventListener(Event.CLOSE, onSocketClose);
    socket.addEventListener(Event.CONNECT, onSocketConnect);
    socket.addEventListener(IOErrorEvent.IO_ERROR, onSocketIoError);
    socket.addEventListener(SecurityErrorEvent.SECURITY_ERROR, onSocketSecurityError);
    socket.addEventListener(ProgressEvent.SOCKET_DATA, onSocketData);
    socket.connect(host, port);
  }
  
  public function send(data:String):int {
    if (readyState == OPEN) {
      socket.writeByte(0x00);
      socket.writeUTFBytes(data);
      socket.writeByte(0xff);
      socket.flush();
      main.log("sent: " + data);
      return -1;
    } else if (readyState == CLOSED) {
      var bytes:ByteArray = new ByteArray();
      bytes.writeUTFBytes(data);
      bufferedAmount += bytes.length; // not sure whether it should include \x00 and \xff
      // We use return value to let caller know bufferedAmount because we cannot fire
      // stateChange event here which causes weird error:
      // > You are trying to call recursively into the Flash Player which is not allowed.
      return bufferedAmount;
    } else {
      main.fatal("invalid state");
      return 0;
    }
  }
  
  public function close():void {
    main.log("close");
    try {
      socket.close();
    } catch (ex:Error) { }
    readyState = CLOSED;
    // We don't fire any events here because it causes weird error:
    // > You are trying to call recursively into the Flash Player which is not allowed.
    // We do something equivalent in JavaScript WebSocket#close instead.
  }
  
  public function getReadyState():int {
    return readyState;
  }
  
  public function getBufferedAmount():int {
    return bufferedAmount;
  }
  
  private function onSocketConnect(event:Event):void {
    main.log("connected");
    var hostValue:String = host + (port == 80 ? "" : ":" + port);
    var cookie:String = "";
    if (main.getCallerHost() == host) {
      cookie = ExternalInterface.call("function(){return document.cookie}");
    }
    var opt:String = "";
    if (protocol) opt += "WebSocket-Protocol: " + protocol + "\r\n";
    // if caller passes additional headers they must end with "\r\n"
    if (headers) opt += headers;
    
    var req:String = StringUtil.substitute(
      "GET {0} HTTP/1.1\r\n" +
      "Upgrade: WebSocket\r\n" +
      "Connection: Upgrade\r\n" +
      "Host: {1}\r\n" +
      "Origin: {2}\r\n" +
      "Cookie: {4}\r\n" +
      "{3}" +
      "\r\n",
      path, hostValue, origin, opt, cookie);
    main.log("request header:\n" + req);
    socket.writeUTFBytes(req);
    socket.flush();
  }

  private function onSocketClose(event:Event):void {
    main.log("closed");
    readyState = CLOSED;
    notifyStateChange();
    dispatchEvent(new Event("close"));
  }

  private function onSocketIoError(event:IOErrorEvent):void {
    close();
    main.fatal("failed to connect Web Socket server (IoError)");
  }

  private function onSocketSecurityError(event:SecurityErrorEvent):void {
    close();
    main.fatal(
      "failed to connect Web Socket server (SecurityError)\n" +
      "make sure the server is running and Flash socket policy file is correctly placed");
  }

  private function onSocketData(event:ProgressEvent):void {
    var pos:int = buffer.length;
    socket.readBytes(buffer, pos);
    for (; pos < buffer.length; ++pos) {
      if (headerState != 4) {
        // try to find "\r\n\r\n"
        if ((headerState == 0 || headerState == 2) && buffer[pos] == 0x0d) {
          ++headerState;
        } else if ((headerState == 1 || headerState == 3) && buffer[pos] == 0x0a) {
          ++headerState;
        } else {
          headerState = 0;
        }
        if (headerState == 4) {
          var headerStr:String = buffer.readUTFBytes(pos + 1);
          main.log("response header:\n" + headerStr);
          validateHeader(headerStr);
          makeBufferCompact();
          pos = -1;
          readyState = OPEN;
          notifyStateChange();
          dispatchEvent(new Event("open"));
        }
      } else {
        if (buffer[pos] == 0xff) {
          if (buffer.readByte() != 0x00) {
            close();
            main.fatal("data must start with \\x00");
          }
          var data:String = buffer.readUTFBytes(pos - 1);
          main.log("received: " + data);
          dispatchEvent(new WebSocketMessageEvent("message", encodeURIComponent(data)));
          buffer.readByte();
          makeBufferCompact();
          pos = -1;
        }
      }
    }
  }
  
  private function validateHeader(headerStr:String):void {
    var lines:Array = headerStr.split(/\r\n/);
    if (!lines[0].match(/^HTTP\/1.1 101 /)) {
      close();
      main.fatal("bad response: " + lines[0]);
    }
    var header:Object = {};
    for (var i:int = 1; i < lines.length; ++i) {
      if (lines[i].length == 0) continue;
      var m:Array = lines[i].match(/^(\S+): (.*)$/);
      if (!m) {
        close();
        main.fatal("failed to parse response header line: " + lines[i]);
      }
      header[m[1]] = m[2];
    }
    if (header["Upgrade"] != "WebSocket") {
      close();
      main.fatal("invalid Upgrade: " + header["Upgrade"]);
    }
    if (header["Connection"] != "Upgrade") {
      close();
      main.fatal("invalid Connection: " + header["Connection"]);
    }
    var resOrigin:String = header["WebSocket-Origin"].toLowerCase();
    if (resOrigin != origin) {
      close();
      main.fatal("origin doesn't match: '" + resOrigin + "' != '" + origin + "'");
    }
    if (protocol && header["WebSocket-Protocol"] != protocol) {
      close();
      main.fatal("protocol doesn't match: '" +
        header["WebSocket-Protocol"] + "' != '" + protocol + "'");
    }
  }

  private function makeBufferCompact():void {
    if (buffer.position == 0) return;
    var nextBuffer:ByteArray = new ByteArray();
    buffer.readBytes(nextBuffer);
    buffer = nextBuffer;
  }
  
  private function notifyStateChange():void {
    dispatchEvent(new WebSocketStateEvent("stateChange", readyState, bufferedAmount));
  }

}

}
