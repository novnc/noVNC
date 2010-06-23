noVNC: HTML5 VNC Client
======================


Description
-----------

noVNC is a VNC client implemented using HTML5 technologies,
specifically Canvas and WebSocket (supports 'wss://' encryption).

For browsers that do not have builtin WebSocket support, the project
includes web-socket-js, a WebSocket emulator using Adobe Flash
(http://github.com/gimite/web-socket-js).

In addition, as3crypto has been added to web-socket-js to implement
WebSocket SSL/TLS encryption, i.e. the "wss://" URI scheme.
(http://github.com/lyokato/as3crypto_patched).


Requirements
------------

Until there is VNC server support for WebSocket connections, you need
to use a WebSocket to TCP socket proxy. There is a python proxy
included ('wsproxy'). One advantage of using the proxy is that it has
builtin support for SSL/TLS encryption (i.e. "wss://").

There a few reasons why a proxy is required:

  1. WebSocket is not a pure socket protocol. There is an initial HTTP
     like handshake to allow easy hand-off by web servers and allow
     some origin policy exchange. Also, each WebSocket frame begins
     with 0 ('\x00') and ends with 255 ('\xff').

  2. Javascript itself does not have the ability to handle pure byte
     strings (Unicode encoding messes with it) even though you can
     read them with WebSocket. The python proxy encodes the data so
     that the Javascript client can base64 decode the data into an
     array.

  3. When using the web-socket-js as a fallback, WebSocket 'onmessage'
     events may arrive out of order. In order to compensate for this
     the client asks the proxy (using the initial query string) to add
     sequence numbers to each packet.


Usage
-----

* To encrypt the traffic using the WebSocket 'wss://' URI scheme you
  need to generate a certificate for the proxy to load. You can generate
  a self-signed certificate using openssl. The common name should be the
  hostname of the server where the proxy will be running:

    `openssl req -new -x509 -days 365 -nodes -out self.pem -keyout self.pem`

* run a VNC server.
 
    `vncserver :1`

* run the python proxy:

    `./utils/wsproxy.py -f source_port target_addr:target_port

    `./utils/wsproxy.py -f 8787 localhost:5901`


* run the mini python web server to serve the directory:

    `./utils/web.py PORT`

    `./utils/web.py 8080`

* Point your web browser at http://localhost:8080/vnc.html
 (or whatever port you used above to run the web server).

* Specify the host and port where the proxy is running and the
  password that the vnc server is using (if any). Hit the Connect
  button and enjoy!


Browser Support
---------------

I only currently test under Linux. Here are the current results:

* Chrome 5.0.375.29 beta: Works great. Native WebSockets support. Very
  fast.
* firefox 3.5, 3.7: Works. Uses flash WebSockets emulator. Large
  full-color images are slow.
* Arora 0.50: Works. Broken putImageData so large full-color images
  are slow.

* Opera 10.10: Unusable: drops web-socket-js events.
* Opera 10.60: Broken: throws "WRONG_ARGUMENTS_ERR" on connect.
* Konqueror 4.2.2: Broken: flash WebSockets emulator never connects.


Integration
-----------

The client is designed to be easily integrated with existing web
structure and style.

At a minimum you must include the `vnc.js` and `default_controls.js`
scripts and call their load() functions. For example:

    <body>
        <div id='vnc'>Loading</div>
    </body>
    <script src='include/vnc.js'></script>
    <script src="include/default_controls.js"></script>
    <script>
        window.onload = function () {
            DefaultControls.load('vnc');
            RFB.load(); };
    </script>

See `vnc.html` and `vnc_auto.html` for examples. The file
`include/plain.css` has a list of stylable elements.

The `vnc.js` also includes other scripts within the `include`
sub-directory. The `VNC_uri_prefix` variable can be use override the
URL path to the directory that contains the `include` sub-directory.
