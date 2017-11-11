# noVNC API

The interface of the noVNC client consists of a single RFB object that
is instantiated once per connection.

## RFB

The `RFB` object represents a single connection to a VNC server. It
communicates using a WebSocket that must provide a standard RFB
protocol stream.

### Constructor

[`RFB()`](#rfb-1)
  - Creates and returns a new `RFB` object.

### Properties

`viewOnly`
  - Is a `boolean` indicating if any events (e.g. key presses or mouse
    movement) should be prevented from being sent to the server.
    Disabled by default.

`focusOnClick`
  - Is a `boolean` indicating if keyboard focus should automatically be
    moved to the canvas when a `mousedown` or `touchstart` event is
    received.

`touchButton`
  - Is a `long` controlling the button mask that should be simulated
    when a touch event is recieved. Uses the same values as
    [`MouseEvent.button`](https://developer.mozilla.org/en-US/docs/Web/API/MouseEvent/button).
    Is set to `1` by default.

`viewportScale`
  - Is a `double` indicating how the framebuffer contents should be
    scaled before being rendered on to the canvas. See also
    [`RFB.autoscale()`](#rfbautoscale). Is set to `1.0` by default.

`clipViewport`
  - Is a `boolean` indicating if the canvas should be clipped to its
    container. When disabled the container must be able to handle the
    resulting overflow. Disabled by default.

`dragViewport`
  - Is a `boolean` indicating if mouse events should control the
    relative position of a clipped canvas. Only relevant if
    `clipViewport` is enabled. Disabled by default.

`isClipped` *Read only*
  - Is a `boolean` indicating if the framebuffer is larger than the
    current canvas, i.e. it is being clipped.

`capabilities` *Read only*
  - Is an `Object` indicating which optional extensions are available
    on the server. Some methods may only be called if the corresponding
    capability is set. The following capabilities are defined:

    | name     | type      | description
    | -------- | --------- | -----------
    | `power`  | `boolean` | Machine power control is available
    | `resize` | `boolean` | The framebuffer can be resized

### Events

[`connect`](#connect)
  - The `connect` event is fired when the `RFB` object has completed
    the connection and handshaking with the server.

[`disconnect`](#disconnected)
  - The `disconnect` event is fired when the `RFB` object disconnects.

[`credentialsrequired`](#credentialsrequired)
  - The `credentialsrequired` event is fired when more credentials must
    be given to continue.

[`securityfailure`](#securityfailure)
  - The `securityfailure` event is fired when the security negotiation
    with the server fails.

[`clipboard`](#clipboard)
  - The `clipboard` event is fired when clipboard data is received from
    the server.

[`bell`](#bell)
  - The `bell` event is fired when a audible bell request is received
    from the server.

[`fbresize`](#fbresize)
  - The `fbresize` event is fired when the framebuffer size is changed.

[`desktopname`](#desktopname)
  - The `desktopname` event is fired when the remote desktop name
    changes.

[`capabilities`](#capabilities)
  - The `capabilities` event is fired when `RFB.capabilities` is
    updated.

### Methods

[`RFB.disconnect()`](#rfbdisconnect)
  - Disconnect from the server.

[`RFB.sendCredentials()`](#rfbsendcredentials)
  - Send credentials to server. Should be called after the
    [`credentialsrequired`](#credentialsrequired) event has fired.

[`RFB.sendKey()`](#rfbsendKey)
  - Send a key event.

[`RFB.sendCtrlAltDel()`](#rfbsendctrlaltdel)
  - Send Ctrl-Alt-Del key sequence.

[`RFB.machineShutdown()`](#rfbmachineshutdown)
  - Request a shutdown of the remote machine.

[`RFB.machineReboot()`](#rfbmachinereboot)
  - Request a reboot of the remote machine.

[`RFB.machineReset()`](#rfbmachinereset)
  - Request a reset of the remote machine.

[`RFB.clipboardPasteFrom()`](#rfbclipboardPasteFrom)
  - Send clipboard contents to server.

[`RFB.autoscale()`](#rfbautoscale)
  - Set `RFB.viewportScale` so that the framebuffer fits a specified
    container.

[`RFB.requestDesktopSize()`](#rfbrequestDesktopSize)
  - Send a request to change the remote desktop size.

[`RFB.viewportChangeSize()`](#rfbviewportChangeSize)
  - Change size of the viewport.

### Details

#### RFB()

The `RFB()` constructor returns a new `RFB` object and initiates a new
connection to a specified VNC server.

##### Syntax

    var rfb = new RFB( target, url [, options] );

###### Parameters

**`target`**
  - A [`HTMLCanvasElement`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement)
    that specifies where graphics should be rendered and input events
    should be monitored.

**`url`**
  - A `DOMString` specifying the VNC server to connect to. This must be
    a valid WebSocket URL.

**`options`** *Optional*
  - An `Object` specifying extra details about how the connection
    should be made.

    Possible options:

    `shared`
      - A `boolean` indicating if the remote server should be shared or
        if any other connected clients should be disconnected. Enabled
        by default.

    `credentials`
      - An `Object` specifying the credentials to provide to the server
        when authenticating. The following credentials are possible:

        | name         | type        | description
        | ------------ | ----------- | -----------
        | `"username"` | `DOMString` | The user that authenticates
        | `"password"` | `DOMString` | Password for the user
        | `"target"`   | `DOMString` | Target machine or session

    `repeaterID`
      - A `DOMString` specifying the ID to provide to any VNC repeater
        encountered.

#### connect

The `connect` event is fired after all the handshaking with the server
is completed and the connection is fully established. After this event
the `RFB` object is ready to recieve graphics updates and to send input.

#### disconnect

The `disconnect` event is fired when the connection has been
terminated. The `detail` property is an `Object` that contains the
property `clean`. `clean` is a `boolean` indicating if the termination
was clean or not. In the event of an unexpected termination or an error
`clean` will be set to false.

#### credentialsrequired

The `credentialsrequired` event is fired when the server requests more
credentials than were specified to [`RFB()`](#rfb-1). The `detail`
property is an `Object` containing the property `types` which is an
`Array` of `DOMString` listing the credentials that are required.

#### securityfailure

The `securityfailure` event is fired when the handshaking process with
the server fails during the security negotiation step. The `detail`
property is an `Object` containing the following properties:

| Property | Type        | Description
| -------- | ----------- | -----------
| `status` | `long`      | The failure status code
| `reason` | `DOMString` | The **optional** reason for the failure

The property `status` corresponds to the
[SecurityResult](https://github.com/rfbproto/rfbproto/blob/master/rfbproto.rst#securityresult)
status code in cases of failure. A status of zero will not be sent in
this event since that indicates a successful security handshaking
process. The optional property `reason` is provided by the server and
thus the language of the string is not known. However most servers will
probably send English strings. The server can choose to not send a
reason and in these cases the `reason` property will be omitted.

#### clipboard

The `clipboard` event is fired when the server has sent clipboard data.
The `detail` property is an `Object` containing the property `text`
which is a `DOMString` with the clipboard data.

#### bell

The `bell` event is fired when the server has requested an audible
bell.

#### fbresize

The `fbresize` event is fired when the framebuffer has changed
dimensions. The `detail` property is an `Object` with the properties
`width` and `height` specifying the new dimensions.

#### desktopname

The `desktopname` event is fired when the name of the remote desktop
changes. The `detail` property is an `Object` with the property `name`
which is a `DOMString` specifying the new name.

#### capabilities

The `capabilities` event is fired whenever an entry is added or removed
from `RFB.capabilities`. The `detail` property is an `Object` with the
property `capabilities` containing the new value of `RFB.capabilities`.

#### RFB.disconnect()

The `RFB.disconnect()` method is used to disconnect from the currently
connected server.

##### Syntax

    RFB.disconnect( );

#### RFB.sendCredentials()

The `RFB.sendCredentials()` method is used to provide the missing
credentials after a `credentialsrequired` event has been fired.

##### Syntax

    RFB.sendCredentials( credentials );

###### Parameters

**`credentials`**
  - An `Object` specifying the credentials to provide to the server
    when authenticating. See [`RFB()`](#rfb-1) for details.

#### RFB.sendKey()

The `RFB.sendKey()` method is used to send a key event to the server.

##### Syntax

    RFB.sendKey( keysym, code [, down] );

###### Parameters

**`keysym`**
  - A `long` specifying the RFB keysym to send. Can be `0` if a valid
    **`code`** is specified.

**`code`**
  - A `DOMString` specifying the physical key to send. Valid values are
    those that can be specified to
    [`KeyboardEvent.code`](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/code).
    If the physical key cannot be determined then `null` shall be
    specified.

**`down`** *Optional*
  - A `boolean` specifying if a press or a release event should be
    sent. If omitted then both a press and release event are sent.

#### RFB.sendCtrlAltDel()

The `RFB.sendCtrlAltDel()` method is used to send the key sequence
*left Control*, *left Alt*, *Delete*. This is a convenience wrapper
around [`RFB.sendKey()`](#rfbsendkey).

##### Syntax

    RFB.sendCtrlAltDel( );

#### RFB.machineShutdown()

The `RFB.machineShutdown()` method is used to request to shut down the
remote machine. The capability `power` must be set for this method to
have any effect.

##### Syntax

    RFB.machineShutdown( );

#### RFB.machineReboot()

The `RFB.machineReboot()` method is used to request a clean reboot of
the remote machine. The capability `power` must be set for this method
to have any effect.

##### Syntax

    RFB.machineReboot( );

#### RFB.machineReset()

The `RFB.machineReset()` method is used to request a forced reset of
the remote machine. The capability `power` must be set for this method
to have any effect.

##### Syntax

    RFB.machineReset( );

#### RFB.clipboardPasteFrom()

The `RFB.clipboardPasteFrom()` method is used to send clipboard data
to the remote server.

##### Syntax

    RFB.clipboardPasteFrom( text );

###### Parameters

**`text`**
  - A `DOMString` specifying the clipboard data to send. Currently only
  characters from ISO 8859-1 are supported.

#### RFB.autoscale()

The `RFB.autoscale()` method is used to automatically adjust
`RFB.viewportScale` to fit given dimensions.

##### Syntax

    RFB.autoscale( width, height );

###### Parameters

**`width`**
  - A `long` specifying the maximum width of the canvas in CSS pixels.

**`height`**
  - A `long` specifying the maximum height of the canvas in CSS pixels.

#### RFB.requestDesktopSize()

The `RFB.requestDesktopSize()` method is used to request a change of
the framebuffer. The capability `resize` must be set for this method to
have any effect.

Note that this is merely a request and the server may deny it.
The [`fbresize`](#fbresize) event will be fired when the framebuffer
actually changes dimensions.

##### Syntax

    RFB.requestDesktopSize( width, height );

###### Parameters

**`width`**
  - A `long` specifying the new requested width in CSS pixels.

**`height`**
  - A `long` specifying the new requested height in CSS pixels.

#### RFB.viewportChangeSize()

The `RFB.viewportChangeSize()` method is used to change the size of the
canvas rather than the underlying framebuffer.

This method has no effect if `RFB.clipViewport` is set to `false`.

##### Syntax

    RFB.viewportChangeSize( width, height );

###### Parameters

**`width`**
  - A `long` specifying the new width in CSS pixels.

**`height`**
  - A `long` specifying the new height in CSS pixels.
