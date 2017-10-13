# API

The interface of the noVNC client consists of a single RFB object that
is instantiated once per connection.


## 1 Configuration Attributes

Each configuration option has a default value, which can be overridden
by a a configuration object passed to the constructor. Configuration
options can then be read and modified after initialization with "get_*"
and "set_*" methods respectively. For example, the following
initializes an RFB object with the 'encrypt' configuration option
enabled, then confirms it was set, then disables it:

    var rfb = new RFB({'encrypt': true});
    if (rfb.get_encrypt()) {
        alert("Encryption is set");
    }
    rfb.set_encrypt(false);

Some attributes are read-only and cannot be changed. An exception will
be thrown if an attempt is made to set one of these attributs. The
attribute mode is one of the following:

    RO - read only
    RW - read write
    WO - write once

| name              | type  | mode | default    | description
| ----------------- | ----- | ---- | ---------- | ------------
| target            | DOM   | WO   | null       | Canvas element for rendering (passed to Display, Mouse and Keyboard)
| encrypt           | bool  | RW   | false      | Use TLS/SSL encryption
| local_cursor      | bool  | RW   | false      | Request locally rendered cursor
| shared            | bool  | RW   | true       | Request shared VNC mode
| view_only         | bool  | RW   | false      | Disable client mouse/keyboard
| touchButton       | int   | RW   | 1          | Button mask (1, 2, 4) for which click to send on touch devices. 0 means ignore clicks.
| scale             | float | RW   | 1.0        | Display area scale factor
| viewport          | bool  | RW   | false      | Use viewport clipping
| xvp_password_sep  | str   | RW   | '@'        | Separator for XVP password fields
| disconnectTimeout | int   | RW   | 3          | Time (in seconds) to wait for disconnection
| wsProtocols       | arr   | RW   | ['binary'] | Protocols to use in the WebSocket connection
| repeaterID        | str   | RW   | ''         | UltraVNC RepeaterID to connect to
| viewportDrag      | bool  | RW   | false      | Move the viewport on mouse drags


## 2 Methods

In addition to the getter and setter methods to modify configuration
attributes, the RFB object has other methods that are available in the
object instance.

| name               | parameters                     | description
| ------------------ | ------------------------------ | ------------
| connect            | (host, port, password, path)   | Connect to the given host:port/path. Optional password and path.
| disconnect         | ()                             | Disconnect
| sendPassword       | (passwd)                       | Send password after onPasswordRequired callback
| sendCtrlAltDel     | ()                             | Send Ctrl-Alt-Del key sequence
| xvpOp              | (ver, op)                      | Send a XVP operation (2=shutdown, 3=reboot, 4=reset)
| xvpShutdown        | ()                             | Send XVP shutdown.
| xvpReboot          | ()                             | Send XVP reboot.
| xvpReset           | ()                             | Send XVP reset.
| sendKey            | (keysym, code, down)           | Send a key press event. If down not specified, send a down and up event.
| clipboardPasteFrom | (text)                         | Send a clipboard paste event
| autoscale          | (width, height, downscaleOnly) | Scale the display
| clippingDisplay    | ()                             | Check if the remote display is larger than the client display
| requestDesktopSize | (width, height)                | Send a request to change the remote desktop size.
| viewportChangeSize | (width, height)                | Change size of the viewport


## 3 Callbacks

The RFB object has certain events that can be hooked with callback
functions.

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
