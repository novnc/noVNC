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


### Projects/Companies using noVNC

* [Sentry Data Systems](http://www.sentryds.com): uses noVNC in the
  [Datanex Cloud Computing Platform](http://www.sentryds.com/products/datanex/).

* [Ganeti Web Manager](http://code.osuosl.org/projects/ganeti-webmgr):
  Feature [#1935](http://code.osuosl.org/issues/1935).

* [Archipel](http://archipelproject.org):
  [Video demo](http://antoinemercadal.fr/archipelblog/wp-content/themes/ArchipelWPTemplate/video_youtube.php?title=VNC%20Demonstration&id=te_bzW574Zo)

* [openQRM](http://www.openqrm.com/): VNC plugin available
  by request. Probably included in [version
  4.8](http://www.openqrm.com/?q=node/15). [Video
    demo](http://www.openqrm-enterprise.com/news/details/article/remote-vm-console-plugin-available.html).

* [OpenNode](http://www.opennodecloud.com/): uses noVNC in
  [OpenNode Management Console](http://opennode.activesys.org/about/software-included-in-opennode/).
  [OMC Screencast](http://opennode.activesys.org/about/opennode-management-console-screencast/).

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
  href="wiki/Browser-support">here</a>.


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

* [Advanced Usage](wiki/Advanced-usage). Generating an SSL
  certificate, starting a VNC server, advanced websockify usage, etc.

* [Integrating noVNC](wiki/Integration) into existing projects.

* [Troubleshooting noVNC](wiki/Troubleshooting) problems.


