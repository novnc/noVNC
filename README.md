## noVNC: HTML5 VNC Client


### Description

noVNC is a HTML5 VNC client that runs well in any modern browser
including mobile browsers (iPhone/iPad and Android).

Notable commits, announcements and news are posted to
@<a href="http://www.twitter.com/noVNC">noVNC</a>

There are many companies/projects that have integrated noVNC into
their products including: [Ganeti Web Manager](http://code.osuosl.org/projects/ganeti-webmgr), [Archipel](http://archipelproject.org), [openQRM](http://www.openqrm.com/), [OpenNode](http://www.opennodecloud.com/), [OpenStack](http://www.openstack.org), [Broadway (HTML5 GDK/GTK+ backend)](http://blogs.gnome.org/alexl/2011/03/15/gtk-html-backend-update/), [OpenNebula](http://opennebula.org/), [CloudSigma](http://www.cloudsigma.com/), [Zentyal (formerly eBox)](http://www.zentyal.org/), [SlapOS](http://www.slapos.org), [Intel MeshCentral](https://meshcentral.com), [Amahi](http://amahi.org), [Brightbox](http://brightbox.com/), [Foreman](http://theforeman.org), [LibVNCServer](http://libvncserver.sourceforge.net) and [PocketVNC](http://www.pocketvnc.com/blog/?page_id=866). See [this wiki page](https://github.com/kanaka/noVNC/wiki/ProjectsCompanies-using-noVNC) for more info and links.


### Features

* Supports all modern browsers including mobile (iOS, Android)
* Supported VNC encodings: raw, copyrect, rre, hextile, tight, tightPNG
* WebSocket SSL/TLS encryption (i.e. "wss://") support
* 24-bit true color and 8 bit colour mapped
* Supports desktop resize notification/pseudo-encoding
* Local or remote cursor
* Clipboard copy/paste
* Clipping or scolling modes for large remote screens
* Easy site integration and theming (3 example themes included)
* Licensed under the [LGPLv3](http://www.gnu.org/licenses/lgpl.html)

### Screenshots

Running in Chrome before and after connecting:

<img src="http://kanaka.github.com/noVNC/img/noVNC-5.png" width=400>&nbsp;<img src="http://kanaka.github.com/noVNC/img/noVNC-7.jpg" width=400>

See more screenshots <a href="http://kanaka.github.com/noVNC/screenshots.html">here</a>.


### Browser Requirements

* HTML5 Canvas (with createImageData): Chrome, Firefox 3.6+, iOS
  Safari, Opera 11+, Internet Explorer 9+, etc.

* HTML5 WebSockets: For browsers that do not have builtin
  WebSockets support, the project includes
  <a href="http://github.com/gimite/web-socket-js">web-socket-js</a>,
  a WebSockets emulator using Adobe Flash. iOS 4.2+ has built-in
  WebSocket support.

* Fast Javascript Engine: this is not strictly a requirement, but
  without a fast Javascript engine, noVNC might be painfully slow.

* I maintain a more detailed browser compatibility list <a
  href="https://github.com/kanaka/noVNC/wiki/Browser-support">here</a>.


### Server Requirements

Unless you are using a VNC server with support for WebSockets
connections (such as [x11vnc/libvncserver](http://libvncserver.sourceforge.net/) or
[PocketVNC](http://www.pocketvnc.com/blog/?page_id=866)),
you need to use a WebSockets to TCP socket proxy. There is
a python proxy included ('websockify').


### Quick Start

* Use the launch script to start a mini-webserver and the WebSockets
  proxy (websockify). The `--vnc` option is used to specify the location of
  a running VNC server:

    `./utils/launch.sh --vnc localhost:5901`

* Point your browser to the cut-and-paste URL that is output by the
  launch script. Enter a password if the VNC server has one
  configured. Hit the Connect button and enjoy!


### Other Pages

* [Encrypted Connections](https://github.com/kanaka/websockify/wiki/Encrypted-Connections). How to setup websockify so that you can use encrypted connections from noVNC.

* [Advanced Usage](https://github.com/kanaka/noVNC/wiki/Advanced-usage). Starting a VNC server, advanced websockify usage, etc.

* [Integrating noVNC](https://github.com/kanaka/noVNC/wiki/Integration) into existing projects.

* [Troubleshooting noVNC](https://github.com/kanaka/noVNC/wiki/Troubleshooting) problems.


### Authors/Contributors

* noVNC : Joel Martin (github.com/kanaka)
    * New UI and Icons : Chris Gordon
    * Original Logo : Michael Sersen
    * tight encoding : Michael Tinglof (Mercuri.ca)

* Included libraries:
    * web-socket-js : Hiroshi Ichikawa (github.com/gimite/web-socket-js)
    * as3crypto : Henri Torgemane (code.google.com/p/as3crypto)
    * base64 : Martijn Pieters (Digital Creations 2), Samuel Sieb (sieb.net)
    * jsunzip : Erik Moller (github.com/operasoftware/jsunzip),
    * tinflate : Joergen Ibsen (ibsensoftware.com)
    * DES : Dave Zimmerman (Widget Workshop), Jef Poskanzer (ACME Labs)


