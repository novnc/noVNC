# Embedding and Deploying noVNC Application

This document describes how to embed and deploy the noVNC application, which
includes settings and a full user interface. If you are looking for
documentation on how to use the core noVNC library in your own application,
then please see our [library documentation](LIBRARY.md).

## Files

The noVNC application consists of the following files and directories:

* `vnc.html` - The main page for the application and where users should go. It
  is possible to rename this file.

* `app/` - Support files for the application. Contains code, images, styles and
  translations.

* `core/` - The core noVNC library.

* `vendor/` - Third party support libraries used by the application and the
  core library.

The most basic deployment consists of simply serving these files from a web
server and setting up a WebSocket proxy to the VNC server.

## Parameters

The noVNC application can be controlled by including certain settings in the
query string. Currently the following options are available:

* `autoconnect` - Automatically connect as soon as the page has finished
  loading.

* `reconnect` - If noVNC should automatically reconnect if the connection is
  dropped.

* `reconnect_delay` - How long to wait in milliseconds before attempting to
  reconnect.

* `host` - The WebSocket host to connect to.

* `port` - The WebSocket port to connect to.

* `encrypt` - If TLS should be used for the WebSocket connection.

* `path` - The WebSocket path to use.

* `password` - The password sent to the server, if required.

* `repeaterID` - The repeater ID to use if a VNC repeater is detected.

* `shared` - If other VNC clients should be disconnected when noVNC connects.

* `bell` - If the keyboard bell should be enabled or not.

* `view_only` - If the remote session should be in non-interactive mode.

* `view_clip` - If the remote session should be clipped or use scrollbars if
  it cannot fit in the browser.

* `resize` - How to resize the remote session if it is not the same size as
  the browser window. Can be one of `off`, `scale` and `remote`.

* `logging` - The console log level. Can be one of `error`, `warn`, `info` or
  `debug`.

## Pre-conversion of Modules

noVNC is written using ECMAScript 6 modules. Many of the major browsers support
these modules natively, but not all. By default the noVNC application includes
a script that can convert these modules to an older format as they are being
loaded. However this process can be slow and severely increases the load time
for the application.

It is possible to perform this conversion ahead of time, avoiding the extra
load times. To do this please follow these steps:

 1. Install Node.js
 2. Run `npm install` in the noVNC directory
 3. Run `./utils/use_require.js --with-app --as commonjs`

This will produce a `build/` directory that includes everything needed to run
the noVNC application.
