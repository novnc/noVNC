VNC HTML5 Client
================


Description
-----------

An VNC client implemented using HTML5, specifically Canvas and
WebSocket.

For browsers that do not have builtin WebSocket support, the project
includes web-socket-js, a WebSocket emulator using Adobe Flash
(http://github.com/gimite/web-socket-js).


Requirements
------------

Until there is VNC server support for WebSocket connections, you need
to use a WebSocket to TCP socket proxy. There is a python proxy
included ('wsproxy').

There a few reasons why a proxy is required:

  1. WebSocket is not a pure socket protocol. There is an initial HTTP
     like handshake to allow easy hand-off by web servers and allow
     some origin policy exchange. Also, each WebSocket frame begins
     with 0 ('\x00') and ends with 255 ('\xff').

  2. Javascript itself does not have the ability to handle pure byte
     strings (Unicode encoding messes with it) even though you can
     read them with WebSocket. The python proxy encodes the data so
     that the Javascript client can base64 decode the data into an
     array. The client requests this encoding

  3. When using the web-socket-js as a fallback, WebSocket 'onmessage'
     events may arrive out of order. In order to compensate for this
     the client asks the proxy (using the initial query string) to add
     sequence numbers to each packet.


Usage
-----

* run a VNC server.
 
    `vncserver :1`

* run the python proxy:

    `./wsproxy.py [listen_port] [vnc_host] [vnc_port]`

    `./wsproxy.py 8787 localhost 5901`


* run the mini python web server to serve the directory:

    `./web.py PORT`

    `./web.py 8080`

* Point your web browser at http://localhost:8080/vnc.html
 (or whatever port you used above to run the web server).

* Provide the host and port where the proxy is running and the
  password that the vnc server is using (if any). Hit the Connect
  button and enjoy!

