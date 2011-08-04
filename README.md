## noVNC: HTML5 VNC Client


### Description

noVNC is a VNC client implemented using HTML5 technologies,
specifically Canvas and WebSockets (supports 'wss://' encryption).
noVNC is licensed under the
[LGPLv3](http://www.gnu.org/licenses/lgpl.html).

Special thanks to [Sentry Data Systems](http://www.sentryds.com) for
sponsoring ongoing development of this project (and for employing me).

There are many companies/projects that have integrated noVNC into
their products including: [Sentry Data Systems](http://www.sentryds.com), [Ganeti Web Manager](http://code.osuosl.org/projects/ganeti-webmgr), [Archipel](http://archipelproject.org), [openQRM](http://www.openqrm.com/), [OpenNode](http://www.opennodecloud.com/), [OpenStack](http://www.openstack.org), [Broadway (HTML5 GDK/GTK+ backend)](http://blogs.gnome.org/alexl/2011/03/15/gtk-html-backend-update/), [OpenNebula](http://opennebula.org/), [CloudSigma](http://www.cloudsigma.com/), [Zentyal (formerly eBox)](http://www.zentyal.org/), and [SlapOS](http://www.slapos.org). See [this wiki page](https://github.com/kanaka/noVNC/wiki/ProjectsCompanies-using-noVNC) for more info and links.

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
  href="https://github.com/kanaka/noVNC/wiki/Browser-support">here</a>.


### Server Requirements

Unless you are using a VNC server with support for WebSockets
connections (only my [fork of libvncserver](http://github.com/kanaka/libvncserver)
currently), you need to use a WebSockets to TCP socket proxy. There is
a python proxy included ('websockify'). One advantage of using the
proxy is that it has builtin support for SSL/TLS encryption (i.e.
"wss://").

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
  proxy (websockify). The `--vnc` option is used to specify the location of
  a running VNC server:

    `./utils/launch.sh --vnc localhost:5901`

* Point your browser to the cut-and-paste URL that is output by the
  launch script. Enter a password if the VNC server has one
  configured. Hit the Connect button and enjoy!


### Other Pages

* [Advanced Usage](https://github.com/kanaka/noVNC/wiki/Advanced-usage). Generating an SSL
  certificate, starting a VNC server, advanced websockify usage, etc.

* [Integrating noVNC](https://github.com/kanaka/noVNC/wiki/Integration) into existing projects.

* [Troubleshooting noVNC](https://github.com/kanaka/noVNC/wiki/Troubleshooting) problems.


