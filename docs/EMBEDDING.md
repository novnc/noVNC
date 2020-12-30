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

* `quality` - The session JPEG quality level. Can be `0` to `9`.

* `compression` - The session compression level. Can be `0` to `9`.

* `show_dot` - If a dot cursor should be shown when the remote server provides
  no local cursor, or provides a fully-transparent (invisible) cursor.

* `logging` - The console log level. Can be one of `error`, `warn`, `info` or
  `debug`.

## HTTP Serving Considerations
### Browser Cache Issue

If you serve noVNC files using a web server that provides an ETag header, and
include any options in the query string, a nasty browser cache issue can bite
you on upgrade, resulting in a red error box. The issue is caused by a mismatch
between the new vnc.html (which is reloaded because the user has used it with
new query string after the upgrade) and the old javascript files (that the
browser reuses from its cache). To avoid this issue, the browser must be told
to always revalidate cached files using conditional requests. The correct
semantics are achieved via the (confusingly named) `Cache-Control: no-cache`
header that needs to be provided in the web server responses.

### Example Server Configurations

Apache:

```
    # In the main configuration file
    # (Debian/Ubuntu users: use "a2enmod headers" instead)
    LoadModule headers_module modules/mod_headers.so

    # In the <Directory> or <Location> block related to noVNC
    Header set Cache-Control "no-cache"
```

Nginx:

```
    # In the location block related to noVNC
    add_header Cache-Control no-cache;
```
