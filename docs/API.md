# 1. Modules / API

The noVNC client is a composed of several modular components that handle
rendering, input, networking, etc. Each of the modules is designed to
be cross-browser and be useful as a standalone library in other
projects (see LICENSE.txt).


## 1.1 Module List

* __Mouse__ (core/input/mouse.js): Mouse input event handler with
limited touch support.

* __Keyboard__ (core/input/keyboard.js): Keyboard input event handler with
non-US keyboard support. Translates keyDown and keyUp events to X11
keysym values.

* __Display__ (core/display.js): Efficient 2D rendering abstraction
layered on the HTML5 canvas element.

* __Websock__ (core/websock.js): Websock client from websockify
with transparent binary data support.
[Websock API](https://github.com/novnc/websockify/wiki/websock.js) wiki page.

* __RFB__ (core/rfb.js): Main class that implements the RFB
protocol and stitches the other classes together.


## 1.2 Configuration Attributes

The Mouse, Keyboard, Display and RFB classes have a similar API for
configuration options. Each configuration option has a default value,
which can be overridden by a a configuration object passed to the
constructor. Configuration options can then be read and modified after
initialization with "get_*" and "set_*" methods respectively. For
example, the following initializes an RFB object with the 'encrypt'
configuration option enabled, then confirms it was set, then disables
it.

    var rfb = new RFB({'encrypt': true});
    if (rfb.get_encrypt()) {
        alert("Encryption is set");
    }
    rfb.set_encrypt(false);

Some attributes are read-only and cannot be changed. For example, the
Display 'render_mode' option will throw an exception if an attempt is
made to set it. The attribute mode is one of the following:

    RO - read only
    RW - read write
    WO - write once


## 1.3 Methods

In addition to the getter and setter methods to modify configuration
attributes, each of the modules has other methods that are available
in the object instance. For example, the Display module has method
named 'blitImage' which takes an array of pixel data and draws it to
the 2D canvas.

## 1.4 Callbacks

Each of the modules has certain events that can be hooked with
callback functions. For the Mouse, Keyboard, Display and RFB classes
the callback functions are assigned to configuration attributes. The
WebSock module has a method named 'on' that takes two parameters: the
callback event name, and the callback function.

## 2. Modules

## 2.1 Mouse Module

### 2.1.1 Configuration Attributes

| name        | type | mode | default  | description
| ----------- | ---- | ---- | -------- | ------------
| target      | DOM  | WO   | document | DOM element that captures mouse input
| touchButton | int  | RW   | 1        | Button mask (1, 2, 4) for which click to send on touch devices. 0 means ignore clicks.

### 2.1.2 Methods

| name   | parameters | description
| ------ | ---------- | ------------
| grab   | ()         | Begin capturing mouse events
| ungrab | ()         | Stop capturing mouse events

### 2.1.2 Callbacks

| name          | parameters          | description
| ------------- | ------------------- | ------------
| onMouseButton | (x, y, down, bmask) | Handler for mouse button click/release
| onMouseMove   | (x, y)              | Handler for mouse movement


## 2.2 Keyboard Module

### 2.2.1 Configuration Attributes

| name    | type | mode | default  | description
| ------- | ---- | ---- | -------- | ------------
| target  | DOM  | WO   | document | DOM element that captures keyboard input

### 2.2.2 Methods

| name   | parameters | description
| ------ | ---------- | ------------
| grab   | ()         | Begin capturing keyboard events
| ungrab | ()         | Stop capturing keyboard events

### 2.2.3 Callbacks

| name       | parameters           | description
| ---------- | -------------------- | ------------
| onKeyPress | (keysym, code, down) | Handler for key press/release


## 2.3 Display Module

### 2.3.1 Configuration Attributes

| name        | type  | mode | default | description
| ----------- | ----- | ---- | ------- | ------------
| target      | DOM   | WO   |         | Canvas element for rendering
| context     | raw   | RO   |         | Canvas 2D context for rendering
| logo        | raw   | RW   |         | Logo to display when cleared: {"width": width, "height": height, "type": mime-type, "data": data}
| scale       | float | RW   | 1.0     | Display area scale factor 0.0 - 1.0
| viewport    | bool  | RW   | false   | Use viewport clipping
| width       | int   | RO   |         | Display area width
| height      | int   | RO   |         | Display area height
| render_mode | str   | RO   | ''      | Canvas rendering mode
| prefer_js   | str   | RW   |         | Prefer JavaScript over canvas methods
| cursor_uri  | raw   | RW   |         | Can we render cursor using data URI

### 2.3.2 Methods

| name               | parameters                                              | description
| ------------------ | ------------------------------------------------------- | ------------
| viewportChangePos  | (deltaX, deltaY)                                        | Move the viewport relative to the current location
| viewportChangeSize | (width, height)                                         | Change size of the viewport
| absX               | (x)                                                     | Return X relative to the remote display
| absY               | (y)                                                     | Return Y relative to the remote display
| resize             | (width, height)                                         | Set width and height
| flip               | (from_queue)                                            | Update the visible canvas with the contents of the rendering canvas
| clear              | ()                                                      | Clear the display (show logo if set)
| pending            | ()                                                      | Check if there are waiting items in the render queue
| flush              | ()                                                      | Resume processing the render queue unless it's empty
| fillRect           | (x, y, width, height, color, from_queue)                | Draw a filled in rectangle
| copyImage          | (old_x, old_y, new_x, new_y, width, height, from_queue) | Copy a rectangular area
| imageRect          | (x, y, mime, arr)                                       | Draw a rectangle with an image
| startTile          | (x, y, width, height, color)                            | Begin updating a tile
| subTile            | (tile, x, y, w, h, color)                               | Update a sub-rectangle within the given tile
| finishTile         | ()                                                      | Draw the current tile to the display
| blitImage          | (x, y, width, height, arr, offset, from_queue)          | Blit pixels (of R,G,B,A) to the display
| blitRgbImage       | (x, y, width, height, arr, offset, from_queue)          | Blit RGB encoded image to display
| blitRgbxImage      | (x, y, width, height, arr, offset, from_queue)          | Blit RGBX encoded image to display
| drawImage          | (img, x, y)                                             | Draw image and track damage
| changeCursor       | (pixels, mask, hotx, hoty, w, h)                        | Change cursor appearance
| defaultCursor      | ()                                                      | Restore default cursor appearance
| disableLocalCursor | ()                                                      | Disable local (client-side) cursor
| clippingDisplay    | ()                                                      | Check if the remote display is larger than the client display
| autoscale          | (containerWidth, containerHeight, downscaleOnly)        | Scale the display

### 2.3.3 Callbacks

| name    | parameters | description
| ------- | ---------- | ------------
| onFlush | ()         | A display flush has been requested and we are now ready to resume FBU processing


## 2.4 RFB Module

### 2.4.1 Configuration Attributes

| name              | type | mode | default    | description
| ----------------- | ---- | ---- | ---------- | ------------
| target            | DOM  | WO   | null       | Canvas element for rendering (passed to Display, Mouse and Keyboard)
| encrypt           | bool | RW   | false      | Use TLS/SSL encryption
| local_cursor      | bool | RW   | false      | Request locally rendered cursor
| shared            | bool | RW   | true       | Request shared VNC mode
| view_only         | bool | RW   | false      | Disable client mouse/keyboard
| xvp_password_sep  | str  | RW   | '@'        | Separator for XVP password fields
| disconnectTimeout | int  | RW   | 3          | Time (in seconds) to wait for disconnection
| wsProtocols       | arr  | RW   | ['binary'] | Protocols to use in the WebSocket connection
| repeaterID        | str  | RW   | ''         | UltraVNC RepeaterID to connect to
| viewportDrag      | bool | RW   | false      | Move the viewport on mouse drags

### 2.4.2 Methods

| name               | parameters                   | description
| ------------------ | ---------------------------- | ------------
| connect            | (host, port, password, path) | Connect to the given host:port/path. Optional password and path.
| disconnect         | ()                           | Disconnect
| sendPassword       | (passwd)                     | Send password after onPasswordRequired callback
| sendCtrlAltDel     | ()                           | Send Ctrl-Alt-Del key sequence
| xvpOp              | (ver, op)                    | Send a XVP operation (2=shutdown, 3=reboot, 4=reset)
| xvpShutdown        | ()                           | Send XVP shutdown.
| xvpReboot          | ()                           | Send XVP reboot.
| xvpReset           | ()                           | Send XVP reset.
| sendKey            | (keysym, code, down)         | Send a key press event. If down not specified, send a down and up event.
| clipboardPasteFrom | (text)                       | Send a clipboard paste event
| requestDesktopSize | (width, height)              | Send a request to change the remote desktop size.

### 2.4.3 Callbacks

| name               | parameters                 | description
| ------------------ | -------------------------- | ------------
| onUpdateState      | (rfb, state, oldstate)     | Connection state change (see details below)
| onNotification     | (rfb, msg, level, options) | Notification for the UI (optional options)
| onDisconnected     | (rfb, reason)              | Disconnection finished with an optional reason. No reason specified means normal disconnect.
| onPasswordRequired | (rfb, msg)                 | VNC password is required (use sendPassword), optionally comes with a message.
| onClipboard        | (rfb, text)                | RFB clipboard contents received
| onBell             | (rfb)                      | RFB Bell message received
| onFBUReceive       | (rfb, fbu)                 | RFB FBU received but not yet processed (see details below)
| onFBUComplete      | (rfb, fbu)                 | RFB FBU received and processed (see details below)
| onFBResize         | (rfb, width, height)       | Frame buffer (remote desktop) size changed
| onDesktopName      | (rfb, name)                | VNC desktop name recieved
| onXvpInit          | (version)                  | XVP extensions active for this connection.


__RFB onUpdateState callback details__

The RFB module has an 'onUpdateState' callback that is invoked after
the noVNC connection state changes. Here is a list of the states that
are reported. Note that the RFB module can not transition from the
disconnected state in any way, a new instance of the object has to be
created for new connections.

| connection state | description
| ---------------- | ------------
| connecting       | starting to connect
| connected        | connected normally
| disconnecting    | starting to disconnect
| disconnected     | disconnected - permanent end-state for this RFB object

__RFB onFBUReceive and on FBUComplete callback details__

The onFBUReceive callback is invoked when a frame buffer update
message has been received from the server but before the RFB class has
done any additional handling. The onFBUComplete callback is invoked
with the same information but after the RFB class has handled the
message.

The 'fbu' parameter is an object with the following structure:

    {
        x:            FBU_x_position,
        y:            FBU_y_position,
        width:        FBU_width,
        height:       FBU_height,
        encoding:     FBU_encoding_number,
        encodingName: FBU_encoding_string
    }
