## noVNC: HTML5 VNC Client


### Description

noVNC is a VNC client implemented using HTML5 technologies,
specifically Canvas and WebSockets (supports 'wss://' encryption).
noVNC is licensed under the
[LGPLv3](http://www.gnu.org/licenses/lgpl.html).

Special thanks to [Sentry Data Systems](http://www.sentryds.com) for
sponsoring ongoing development of this project (and for employing me).

Notable commits, announcements and news are posted to
@<a href="http://www.twitter.com/noVNC">noVNC</a>


### Screenshots

Running in Chrome before and after connecting:

<img src="http://kanaka.github.com/noVNC/img/noVNC-1.jpg" width=400>&nbsp;<img src="http://kanaka.github.com/noVNC/img/noVNC-2.jpg" width=400>

See more screenshots <a href="http://kanaka.github.com/noVNC/screenshots.html">here</a>.


### Browser Requirements

* HTML5 Canvas: Except for Internet Explorer, most
  browsers have had Canvas support for quite some time. Internet
  Explorer 9 will have Canvas support (finally).

* HTML5 WebSockets: For browsers that do not have builtin
  WebSockets support, the project includes
  <a href="http://github.com/gimite/web-socket-js">web-socket-js</a>,
  a WebSockets emulator using Adobe Flash.

* Fast Javascript Engine: noVNC avoids using new Javascript
  functionality so it will run on older browsers, but decode and
  rendering happen in Javascript, so a slow Javascript engine will
  mean noVNC is painfully slow.

* I maintain a more detailed list of browser compatibility <a
  href="http://github.com/kanaka/noVNC/blob/master/docs/browsers.md">here</a>.


### Server Requirements

Unless you are using a VNC server with support for WebSockets
connections (only my [fork of libvncserver](http://github.com/kanaka/libvncserver)
currently), you need to use a WebSockets to TCP socket proxy. There is
a python proxy included ('wsproxy'). One advantage of using the proxy
is that it has builtin support for SSL/TLS encryption (i.e. "wss://").

There a few reasons why a proxy is required:

  1. WebSockets is not a pure socket protocol. There is an initial HTTP
     like handshake to allow easy hand-off by web servers and allow
     some origin policy exchange. Also, each WebSockets frame begins
     with 0 ('\x00') and ends with 255 ('\xff').

  2. Javascript itself does not have the ability to handle pure byte
     arrays. The python proxy encodes the data as base64 so that the
     Javascript client can decode the data as an integer array.


### Quick Start

* Use the launch script to start a mini-webserver and the WebSockets
  proxy. The `--vnc` option is used to specify the location of
  a running VNC server:

    `./utils/launch.sh --vnc localhost:5901`

* Point your browser to the cut-and-paste URL that is output by the
  launch script. Enter a password if the VNC server has one
  configured. Hit the Connect button and enjoy!


### Advanced usage

* To encrypt the traffic using the WebSocket 'wss://' URI scheme you
  need to generate a certificate for the proxy to load. By default the
  proxy loads a certificate file name `self.pem` but the `--cert=CERT`
  option can override the file name. You can generate a self-signed
  certificate using openssl. When asked for the common name, use the
  hostname of the server where the proxy will be running:

    `openssl req -new -x509 -days 365 -nodes -out self.pem -keyout self.pem`

* `tightvnc` provide a nice startup script that can be used to run
  a separate X desktop that is served by VNC. To install and run the
  server under Ubuntu you would do something like this:

    `sudo apt-get install tightvncserver`

    `vncserver :1`

    The VNC server will run in the background. The port that it runs
    on is the display number + 5900 (i.e. 5901 in the case above).

* `x11vnc` can be used to share your current X desktop. Note that if
  you run noVNC on the X desktop you are connecting to via VNC you
  will get a neat hall of mirrors effect, but the the client and
  server will fight over the mouse.

    `sudo apt-get install x11vnc`

    `x11vnc -forever -display :0`

  Without the `-forever` option, x11vnc will exit after the first
  disconnect. The `-display` option indicates the exiting X display to
  share. The port that it runs on is the display number + 5900 (i.e.
  5900 in the case above).

* To run the python proxy directly without using launch script (to
  pass additional options for example):

    `./utils/wsproxy.py -f source_port target_addr:target_port`

    `./utils/wsproxy.py -f 8787 localhost:5901`

* To run the mini python web server without the launch script:

    `./utils/web.py PORT`

    `./utils/web.py 8080`

* Point your web browser at http://localhost:8080/vnc.html
 (or whatever port you used above to run the web server). Specify the
 host and port where the proxy is running and the password that the
 vnc server is using (if any). Hit the Connect button.

* If you are using python 2.3 or 2.4 and you want wsproxy to support
  'wss://' (TLS) then see the
  [wsproxy README](http://github.com/kanaka/noVNC/blob/master/utils/README.md)
  for instructions on building the ssl module.


### Integration

The client is designed to be easily integrated with existing web
structure and style.

At a minimum you must include the `vnc.js` and `default_controls.js`
scripts and call DefaultControls.load(). For example:

    <head>
        <script src='include/vnc.js'></script>
        <script src="include/default_controls.js"></script>
    </head>
    <body>
        <div id='vnc'>Loading</div>

        <script>
            window.onload = function () {
                DefaultControls.load('vnc');
            }
        </script>
    </body>

See `vnc.html` and `vnc_auto.html` for examples. The file
`include/plain.css` has a list of stylable elements.

The `vnc.js` also includes other scripts within the `include`
sub-directory. The `VNC_uri_prefix` variable can be use override the
URL path to the `include` sub-directory.


### Troubleshooting

You will need console logging support in the browser. Recent Chrome
and Opera versions have built in support. Firefox has a nice extension
called "firebug" that gives console logging support.

First, load the noVNC page with `logging=debug` added to the query string.
For example `vnc.html?logging=debug`.

Then, activate the console logger in your browser.  With Chrome it can
be activate using Ctrl+Shift+J and then switching to the "Console"
tab. With firefox+firebug, it can be activated using Ctrl+F12.

Now reproduce the problem. The console log output will give more
information about what is going wrong and where in the code the
problem is located.

If you file a issue/bug, it is very helpful for me to have the last
page of console output leading up the problem in the issue report.
Other helpful issue/bug information: browser version, OS version,
noVNC git version, and VNC server name/version.
