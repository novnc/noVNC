# API

The interface of the noVNC client consists of a single RFB object that
is instantiated once per connection.


## 1 Configuration Attributes

Each configuration option has a default value, which can be overridden
by a a configuration object passed to the constructor. Configuration
options can then be read and modified after initialization with "get_*"
and "set_*" methods respectively. For example, the following
initializes an RFB object with the 'view_only' configuration option
enabled, then confirms it was set, then disables it:

    var rfb = new RFB({'view_only': true});
    if (rfb.get_view_only()) {
        alert("View Only is set");
    }
    rfb.set_view_only(false);

Some attributes are read-only and cannot be changed. An exception will
be thrown if an attempt is made to set one of these attributs. The
attribute mode is one of the following:

    RO - read only
    RW - read write
    WO - write once

| name              | type  | mode | default    | description
| ----------------- | ----- | ---- | ---------- | ------------
| target            | DOM   | WO   | null       | Canvas element for rendering (passed to Display, Mouse and Keyboard)
| local_cursor      | bool  | RW   | false      | Request locally rendered cursor
| shared            | bool  | RW   | true       | Request shared VNC mode
| view_only         | bool  | RW   | false      | Disable client mouse/keyboard
| touchButton       | int   | RW   | 1          | Button mask (1, 2, 4) for which click to send on touch devices. 0 means ignore clicks.
| scale             | float | RW   | 1.0        | Display area scale factor
| viewport          | bool  | RW   | false      | Use viewport clipping
| disconnectTimeout | int   | RW   | 3          | Time (in seconds) to wait for disconnection
| repeaterID        | str   | RW   | ''         | UltraVNC RepeaterID to connect to
| viewportDrag      | bool  | RW   | false      | Move the viewport on mouse drags
| capabilities      | arr   | RO   | []         | Supported capabilities (can include: 'power', 'resize')


## 2 Methods

In addition to the getter and setter methods to modify configuration
attributes, the RFB object has other methods that are available in the
object instance.

| name               | parameters                      | description
| ------------------ | ------------------------------- | ------------
| connect            | (url, credentials)              | Connect to the given URL. Optional credentials.
| disconnect         | ()                              | Disconnect
| sendCredentials    | (credentials)                   | Send credentials after onCredentialsRequired callback
| sendCtrlAltDel     | ()                              | Send Ctrl-Alt-Del key sequence
| machineShutdown    | ()                              | Request a shutdown of the remote machine.
| machineReboot      | ()                              | Request a reboot of the remote machine.
| machineReset       | ()                              | Request a reset of the remote machine.
| sendKey            | (keysym, code, down)            | Send a key press event. If down not specified, send a down and up event.
| clipboardPasteFrom | (text)                          | Send a clipboard paste event
| autoscale          | (width, height, downscaleOnly)  | Scale the display
| clippingDisplay    | ()                              | Check if the remote display is larger than the client display
| requestDesktopSize | (width, height)                 | Send a request to change the remote desktop size.
| viewportChangeSize | (width, height)                 | Change size of the viewport


## 3 Callbacks

The RFB object has certain events that can be hooked with callback
functions.

| name                  | parameters                 | description
| --------------------- | -------------------------- | ------------
| onUpdateState         | (rfb, state, oldstate)     | Connection state change (see details below)
| onNotification        | (rfb, msg, level, options) | Notification for the UI (optional options)
| onDisconnected        | (rfb, reason)              | Disconnection finished with an optional reason. No reason specified means normal disconnect.
| onCredentialsRequired | (rfb, types)               | VNC credentials are required (use sendCredentials)
| onClipboard           | (rfb, text)                | RFB clipboard contents received
| onBell                | (rfb)                      | RFB Bell message received
| onFBResize            | (rfb, width, height)       | Frame buffer (remote desktop) size changed
| onDesktopName         | (rfb, name)                | VNC desktop name recieved
| onCapabilities        | (rfb, capabilities)        | The supported capabilities has changed


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

__RFB onCredentialsRequired callback details__

The onCredentialsRequired callback is called when the server requests more
credentials than was specified to connect(). The types argument is a list
of all the credentials that are required. Currently the following are
defined:

| name     | description
| -------- | ------------
| username | User that authenticates
| password | Password for user
| target   | String specifying target machine or session
