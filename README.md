## noVNC: HTML5 VNC Client

[![Build Status](https://travis-ci.org/novnc/noVNC.svg?branch=master)](https://travis-ci.org/novnc/noVNC)

### Description

noVNC is a HTML5 VNC client that runs well in any modern browser including
mobile browsers (iOS and Android).

Many companies, projects and products have integrated noVNC including
[Ganeti Web Manager](http://code.osuosl.org/projects/ganeti-webmgr),
[OpenStack](http://www.openstack.org),
[OpenNebula](http://opennebula.org/),
[LibVNCServer](http://libvncserver.sourceforge.net), and
[ThinLinc](https://cendio.com/thinlinc). See
[the Projects and Companies wiki page](https://github.com/novnc/noVNC/wiki/Projects-and-companies-using-noVNC)
for a more complete list with additional info and links.

### News/help/contact

Notable commits, announcements and news are posted to
<a href="http://www.twitter.com/noVNC">@noVNC</a>.

If you are a noVNC developer/integrator/user (or want to be) please join the
<a href="https://groups.google.com/forum/?fromgroups#!forum/novnc">
noVNC discussion group</a>.

Bugs and feature requests can be submitted via
[github issues](https://github.com/novnc/noVNC/issues).
If you are looking for a place to start contributing to noVNC, a good place to
start would be the issues that are marked as
["patchwelcome"](https://github.com/novnc/noVNC/issues?labels=patchwelcome).

If you want to show appreciation for noVNC you could donate to a great non-
profits such as:
[Compassion International](http://www.compassion.com/),
[SIL](http://www.sil.org),
[Habitat for Humanity](http://www.habitat.org),
[Electronic Frontier Foundation](https://www.eff.org/),
[Against Malaria Foundation](http://www.againstmalaria.com/),
[Nothing But Nets](http://www.nothingbutnets.net/), etc.
Please tweet <a href="http://www.twitter.com/noVNC">@noVNC</a> if you do.


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
* Licensed under the [MPL 2.0](http://www.mozilla.org/MPL/2.0/)

### Screenshots

Running in Chrome before and after connecting:

<img src="http://novnc.com/img/noVNC-5.png" width=400>&nbsp;
<img src="http://novnc.com/img/noVNC-7.jpg" width=400>

See more screenshots
<a href="http://novnc.com/screenshots.html">here</a>.


### Browser Requirements

* Chrome 8, Firefox 4, Safari 6, Opera 12, IE 11, Edge 12, etc.

* HTML5 Canvas, WebSockets and Typed Arrays

* Fast Javascript Engine: this is not strictly a requirement, but without a
  fast Javascript engine, noVNC might be painfully slow.

* See the more detailed
[browser compatibility wiki page](https://github.com/novnc/noVNC/wiki/Browser-support).


### Server Requirements

Unless you are using a VNC server with support for WebSockets connections (such
as [x11vnc/libvncserver](http://libvncserver.sourceforge.net/),
[QEMU](http://www.qemu.org/), or
[MobileVNC](http://www.smartlab.at/mobilevnc/)), you need to use a
WebSockets to TCP socket proxy. There is a python proxy included
('websockify').


### Quick Start

* Use the launch script to start a mini-webserver and the WebSockets proxy
  (websockify). The `--vnc` option is used to specify the location of a running
  VNC server:

    `./utils/launch.sh --vnc localhost:5901`

* Point your browser to the cut-and-paste URL that is output by the launch
  script. Enter a password if the VNC server has one configured. Hit the
  Connect button and enjoy!


### Other Pages

* [Modules/API](https://github.com/novnc/noVNC/wiki/Modules-API) - The library
  modules and their Javascript API.

* [Integration](https://github.com/novnc/noVNC/wiki/Integration) - Get noVNC
  to work in existing projects.

* [Troubleshooting](https://github.com/novnc/noVNC/wiki/Troubleshooting) - How
  to troubleshoot problems.

* [Encrypted Connections](https://github.com/novnc/websockify/wiki/Encrypted-Connections) -
  Setup websockify so that you can use encrypted connections from noVNC.

* [Advanced Usage](https://github.com/novnc/noVNC/wiki/Advanced-usage) -
  Generating an SSL certificate, starting a VNC server, advanced websockify
  usage, etc.

* [Testing](https://github.com/novnc/noVNC/wiki/Testing) - Run and write
  tests.

* [Translations](https://github.com/novnc/noVNC/wiki/Translations) - Add and
  modify localization for JavaScript and HTML.


### Authors/Contributors

* Core team:
    * [Joel Martin](https://github.com/kanaka)
    * [Samuel Mannehed](https://github.com/samhed) (Cendio)
    * [Peter Åstrand](https://github.com/astrand) (Cendio)
    * [Solly Ross](https://github.com/DirectXMan12) (Red Hat / OpenStack)
    * [Pierre Ossman](https://github.com/CendioOssman) (Cendio)

* Notable contributions:
    * UI and Icons : Pierre Ossman, Chris Gordon
    * Original Logo : Michael Sersen
    * tight encoding : Michael Tinglof (Mercuri.ca)

* Included libraries:
    * as3crypto : Henri Torgemane (code.google.com/p/as3crypto)
    * base64 : Martijn Pieters (Digital Creations 2), Samuel Sieb (sieb.net)
    * DES : Dave Zimmerman (Widget Workshop), Jef Poskanzer (ACME Labs)
    * Pako : Vitaly Puzrin (https://github.com/nodeca/pako)

* [Contribution guide](https://github.com/novnc/noVNC/wiki/Contributing)
