# 1. Modules / API

The noVNC client is a composed of several modular components that handle
rendering, input, networking, etc. Each of the modules is designed to
be cross-browser and be useful as a standalone library in other
projects (see LICENSE.txt).


## 1.1 Module List

* **Mouse** (core/input/devices.js): Mouse input event handler with
limited touch support.

* **Keyboard** (core/input/devices.js): Keyboard input event handler with
non-US keyboard support. Translates keyDown and keyUp events to X11
keysym values.

* **Display** (core/display.js): Efficient 2D rendering abstraction
layered on the HTML5 canvas element.

* **Websock** (core/websock.js): Websock client from websockify
with transparent binary data support.
[Websock API](https://github.com/kanaka/websockify/wiki/websock.js) wiki page.

* **RFB** (core/rfb.js): Main class that implements the RFB
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

<table>
    <tr>
        <td colspan=5><em>Configuration Attributes</em></td>
    </tr>
    <tr>
        <th>name</th> <th>type</th> <th>mode</th> <th>default</th>
        <th>description</th>
    </tr>
    <tr>
        <td>target</td> <td>DOM</td> <td>WO</td> <td>document</td>
        <td>DOM element that captures mouse input</td>
    </tr>
    <tr>
        <td>focused</td> <td>bool</td> <td>RW</td> <td>true</td>
        <td>Capture and send mouse clicks/movement</td>
    </tr>
    <tr>
        <td>touchButton</td> <td>int</td> <td>RW</td> <td>1</td>
        <td>Button mask (1, 2, 4) for which click to send on touch
            devices. 0 means ignore clicks.</td>
    </tr>
    <tr><td colspan=5>&nbsp;</td></tr>
    <tr>
        <td colspan=5><em>Methods</em></td>
    </tr>
    <tr>
        <th>name</th><th colspan=3>parameters</th><th>description</th>
    </tr>
    <tr>
        <td>grab</td> <td colspan=3>()</td>
        <td>Begin capturing mouse events</td>
    </tr>
    <tr>
        <td>ungrab</td> <td colspan=3>()</td>
        <td>Stop capturing mouse events</td>
    </tr>
    <tr><td colspan=5>&nbsp;</td></tr>
    <tr>
        <td colspan=5><em>Callbacks</em></td>
    </tr>
    <tr>
        <th>name</th><th colspan=3>parameters</th><th>description</th>
    </tr>
    <tr>
        <td>onMouseButton</td> <td colspan=3>(x, y, down, bmask)</td>
        <td>Handler for mouse button click/release</td>
    </tr>
    <tr>
        <td>onMouseMove</td> <td colspan=3>(x, y)</td>
        <td>Handler for mouse movement</td>
    </tr>
</table>


## 2.2 Keyboard Module

<table>
    <tr>
        <td colspan=5><em>Configuration Attributes</em></td>
    </tr>
    <tr>
        <th>name</th> <th>type</th> <th>mode</th> <th>default</th>
        <th>description</th>
    </tr>
    <tr>
        <td>target</td> <td>DOM</td> <td>WO</td> <td>document</td>
        <td>DOM element that captures keyboard input</td>
    </tr>
    <tr>
        <td>focused</td> <td>bool</td> <td>RW</td> <td>document</td>
        <td>Capture and send mouse key events</td>
    </tr>
    <tr><td colspan=5>&nbsp;</td></tr>
    <tr>
        <td colspan=5><em>Methods</em></td>
    </tr>
    <tr>
        <th>name</th><th colspan=3>parameters</th><th>description</th>
    </tr>
    <tr>
        <td>grab</td> <td colspan=3>()</td>
        <td>Begin capturing keyboard events</td>
    </tr>
    <tr>
        <td>ungrab</td> <td colspan=3>()</td>
        <td>Stop capturing keyboard events</td>
    </tr>
    <tr><td colspan=5>&nbsp;</td></tr>
    <tr>
        <td colspan=5><em>Callbacks</em></td>
    </tr>
    <tr>
        <th>name</th><th colspan=3>parameters</th><th>description</th>
    </tr>
    <tr>
        <td>onKeyPress</td> <td colspan=3>(keysym, code, down)</td>
        <td>Handler for key press/release</td>
    </tr>
</table>


## 2.3 Display Module

<table>
    <tr>
        <td colspan=5><em>Configuration Attributes</em></td>
    </tr>
    <tr>
        <th>name</th> <th>type</th> <th>mode</th> <th>default</th>
        <th>description</th>
    </tr>
    <tr>
        <td>target</td> <td>DOM</td> <td>WO</td> <td></td>
        <td>Canvas element for rendering</td>
    </tr>
    <tr>
        <td>context</td> <td>raw</td> <td>RO</td> <td></td>
        <td>Canvas 2D context for rendering</td>
    </tr>
    <tr>
        <td>logo</td> <td>raw</td> <td>RW</td> <td></td>
        <td>Logo to display when cleared: {"width": width, "height": height, "type": mime-type, "data": data}</td>
    </tr>
    <tr>
        <td>scale</td> <td>float</td> <td>RW</td> <td>1.0</td>
        <td>Display area scale factor 0.0 - 1.0</td>
    </tr>
    <tr>
        <td>viewport</td> <td>bool</td> <td>RW</td> <td>false</td>
        <td>Use viewport clipping</td>
    </tr>
    <tr>
        <td>width</td> <td>int</td> <td>RO</td> <td></td>
        <td>Display area width</td>
    </tr>
    <tr>
        <td>height</td> <td>int</td> <td>RO</td> <td></td>
        <td>Display area height</td>
    </tr>
    <tr>
        <td>render_mode</td> <td>str</td> <td>RO</td> <td>''</td>
        <td>Canvas rendering mode</td>
    </tr>
    <tr>
        <td>prefer_js</td> <td>str</td> <td>RW</td> <td></td>
        <td>Prefer JavaScript over canvas methods</td>
    </tr>
    <tr>
        <td>cursor_uri</td> <td>raw</td> <td>RW</td> <td></td>
        <td>Can we render cursor using data URI</td>
    </tr>
    <tr><td colspan=5>&nbsp;</td></tr>
    <tr>
        <td colspan=5><em>Methods</em></td>
    </tr>
    <tr>
        <th>name</th><th colspan=3>parameters</th><th>description</th>
    </tr>
    <tr>
        <td>viewportChangePos</td> <td colspan=3>(deltaX, deltaY)</td>
        <td>Move the viewport relative to the current location</td>
    </tr>
    <tr>
        <td>viewportChangeSize</td> <td colspan=3>(width, height)</td>
        <td>Change size of the viewport</td>
    </tr>
    <tr>
        <td>absX</td> <td colspan=3>(x)</td>
        <td>Return X relative to the remote display</td>
    </tr>
    <tr>
        <td>absY</td> <td colspan=3>(y)</td>
        <td>Return Y relative to the remote display</td>
    </tr>
    <tr>
        <td>resize</td> <td colspan=3>(width, height)</td>
        <td>Set width and height</td>
    </tr>
    <tr>
        <td>flip</td> <td colspan=3>(from_queue)</td>
        <td>Update the visible canvas with the contents of the rendering canvas</td>
    </tr>
    <tr>
        <td>clear</td> <td colspan=3>()</td>
        <td>Clear the display (show logo if set)</td>
    </tr>
    <tr>
        <td>pending</td> <td colspan=3>()</td>
        <td>Check if there are waiting items in the render queue</td>
    </tr>
    <tr>
        <td>flush</td> <td colspan=3>()</td>
        <td>Resume processing the render queue unless it's empty</td>
    </tr>
    <tr>
        <td>fillRect</td> <td colspan=3>(x, y, width, height, color, from_queue)</td>
        <td>Draw a filled in rectangle</td>
    </tr>
    <tr>
        <td>copyImage</td> <td colspan=3>(old_x, old_y, new_x, new_y, width, height, from_queue)</td>
        <td>Copy a rectangular area</td>
    </tr>
    <tr>
        <td>imageRect</td> <td colspan=3>(x, y, mime, arr)</td>
        <td>Draw a rectangle with an image</td>
    </tr>
    <tr>
        <td>startTile</td> <td colspan=3>(x, y, width, height, color)</td>
        <td>Begin updating a tile</td>
    </tr>
    <tr>
        <td>subTile</td> <td colspan=3>(tile, x, y, w, h, color)</td>
        <td>Update a sub-rectangle within the given tile</td>
    </tr>
    <tr>
        <td>finishTile</td> <td colspan=3>()</td>
        <td>Draw the current tile to the display</td>
    </tr>
    <tr>
        <td>blitImage</td> <td colspan=3>(x, y, width, height, arr, offset, from_queue)</td>
        <td>Blit pixels (of R,G,B,A) to the display</td>
    </tr>
    <tr>
        <td>blitRgbImage</td> <td colspan=3>(x, y, width, height, arr, offset, from_queue)</td>
        <td>Blit RGB encoded image to display</td>
    </tr>
    <tr>
        <td>blitRgbxImage</td> <td colspan=3>(x, y, width, height, arr, offset, from_queue)</td>
        <td>Blit RGBX encoded image to display</td>
    </tr>
    <tr>
        <td>drawImage</td> <td colspan=3>(img, x, y)</td>
        <td>Draw image and track damage</td>
    </tr>
    <tr>
        <td>changeCursor</td> <td colspan=3>(pixels, mask, hotx, hoty, w, h)</td>
        <td>Change cursor appearance</td>
    </tr>
    <tr>
        <td>defaultCursor</td> <td colspan=3>()</td>
        <td>Restore default cursor appearance</td>
    </tr>
    <tr>
        <td>disableLocalCursor</td> <td colspan=3>()</td>
        <td>Disable local (client-side) cursor</td>
    </tr>
    <tr>
        <td>clippingDisplay</td> <td colspan=3>()</td>
        <td>Check if the remote display is larger than the client display</td>
    </tr>
    <tr>
        <td>autoscale</td> <td colspan=3>(containerWidth, containerHeight, downscaleOnly)</td>
        <td>Scale the display</td>
    </tr>
    <tr><td colspan=5>&nbsp;</td></tr>
    <tr>
        <td colspan=5><em>Callbacks</em></td>
    </tr>
    <tr>
        <th>name</th><th colspan=3>parameters</th><th>description</th>
    </tr>
    <tr>
        <td>onFlush</td> <td colspan=3>()</td>
        <td>A display flush has been requested and we are now ready to resume FBU processing</td>
    </tr>
</table>


## 2.4 RFB Module

<table>
    <tr>
        <td colspan=5><em>Configuration Attributes</em></td>
    </tr>
    <tr>
        <th>name</th> <th>type</th> <th>mode</th> <th>default</th>
        <th>description</th>
    </tr>
    <tr>
        <td>target</td> <td>DOM</td> <td>WO</td> <td>null</td>
        <td>Canvas element for rendering (passed to Display and Mouse)</td>
    </tr>
    <tr>
        <td>focusContainer</td> <td>DOM</td> <td>WO</td> <td>document</td>
        <td>DOM element that captures keyboard input (passed to Keyboard)</td>
    </tr>
    <tr>
        <td>encrypt</td> <td>bool</td> <td>RW</td> <td>false</td>
        <td>Use TLS/SSL encryption</td>
    </tr>
    <tr>
        <td>local_cursor</td> <td>bool</td> <td>RW</td> <td>false</td>
        <td>Request locally rendered cursor</td>
    </tr>
    <tr>
        <td>shared</td> <td>bool</td> <td>RW</td> <td>true</td>
        <td>Request shared VNC mode</td>
    </tr>
    <tr>
        <td>view_only</td> <td>bool</td> <td>RW</td> <td>false</td>
        <td>Disable client mouse/keyboard</td>
    </tr>
    <tr>
        <td>xvp_password_sep</td> <td>str</td> <td>RW</td> <td>'@'</td>
        <td>Separator for XVP password fields</td>
    </tr>
    <tr>
        <td>disconnectTimeout</td> <td>int</td> <td>RW</td> <td>3</td>
        <td>Time (in seconds) to wait for disconnection</td>
    </tr>
    <tr>
        <td>wsProtocols</td> <td>arr</td> <td>RW</td> <td>['binary']</td>
        <td>Protocols to use in the WebSocket connection</td>
    </tr>
    <tr>
        <td>repeaterID</td> <td>str</td> <td>RW</td> <td>''</td>
        <td>UltraVNC RepeaterID to connect to</td>
    </tr>
    <tr>
        <td>viewportDrag</td> <td>bool</td> <td>RW</td> <td>false</td>
        <td>Move the viewport on mouse drags</td>
    </tr>
    <tr><td colspan=5>&nbsp;</td></tr>
    <tr>
        <td colspan=5><em>Methods</em></td>
    </tr>
    <tr>
        <th>name</th><th colspan=3>parameters</th><th>description</th>
    </tr>
    <tr>
        <td>connect</td> <td colspan=3>(host, port, password, path)</td>
        <td>Connect to the given host:port/path. Optional password and path.</td>
    </tr>
    <tr>
        <td>disconnect</td> <td colspan=3>()</td>
        <td>Disconnect</td>
    </tr>
    <tr>
        <td>sendPassword</td> <td colspan=3>(passwd)</td>
        <td>Send password after onPasswordRequired callback</td>
    </tr>
    <tr>
        <td>sendCtrlAltDel</td> <td colspan=3>()</td>
        <td>Send Ctrl-Alt-Del key sequence</td>
    </tr>
    <tr>
        <td>xvpOp</td> <td colspan=3>(ver, op)</td>
        <td>Send a XVP operation (2=shutdown, 3=reboot, 4=reset)</td>
    </tr>
    <tr>
        <td>xvpShutdown</td> <td colspan=3>()</td>
        <td>Send XVP shutdown.</td>
    </tr>
    <tr>
        <td>xvpReboot</td> <td colspan=3>()</td>
        <td>Send XVP reboot.</td>
    </tr>
    <tr>
        <td>xvpReset</td> <td colspan=3>()</td>
        <td>Send XVP reset.</td>
    </tr>
    <tr>
        <td>sendKey</td> <td colspan=3>(keysym, down)</td>
        <td>Send a key press event. If down not specified, send a down and up event.</td>
    </tr>
    <tr>
        <td>clipboardPasteFrom</td> <td colspan=3>(text)</td>
        <td>Send a clipboard paste event</td>
    </tr>
    <tr>
        <td>requestDesktopSize</td> <td colspan=3>(width, height)</td>
        <td>Send a request to change the remote desktop size.</td>
    </tr>
    <tr><td colspan=5>&nbsp;</td></tr>
    <tr>
        <td colspan=5><em>Callbacks</em></td>
    </tr>
    <tr>
        <th>name</th><th colspan=3>parameters</th><th>description</th>
    </tr>
    <tr>
        <td>onUpdateState</td> <td colspan=3>(rfb, state, oldstate)</td>
        <td>Connection state change (see details below)</td>
    </tr>
    <tr>
        <td>onNotification</td> <td colspan=3>(rfb, msg, level, options)</td>
        <td>Notification for the UI (optional options)</td>
    </tr>
    <tr>
        <td>onDisconnected</td> <td colspan=3>(rfb, reason)</td>
        <td>Disconnection finished with an optional reason. No reason specified means normal disconnect.</td>
    </tr>
    <tr>
        <td>onPasswordRequired</td> <td colspan=3>(rfb, msg)</td>
        <td>VNC password is required (use sendPassword), optionally comes with a message.</td>
    </tr>
    <tr>
        <td>onClipboard</td> <td colspan=3>(rfb, text)</td>
        <td>RFB clipboard contents received</td>
    </tr>
    <tr>
        <td>onBell</td> <td colspan=3>(rfb)</td>
        <td>RFB Bell message received</td>
    </tr>
    <tr>
        <td>onFBUReceive</td> <td colspan=3>(rfb, fbu)</td>
        <td>RFB FBU received but not yet processed (see details below)</td>
    </tr>
    <tr>
        <td>onFBUComplete</td> <td colspan=3>(rfb, fbu)</td>
        <td>RFB FBU received and processed (see details below)</td>
    </tr>
    <tr>
        <td>onFBResize</td> <td colspan=3>(rfb, width, height)</td>
        <td>Frame buffer (remote desktop) size changed</td>
    </tr>
    <tr>
        <td>onDesktopName</td> <td colspan=3>(rfb, name)</td>
        <td>VNC desktop name recieved</td>
    </tr>
    <tr>
        <td>onXvpInit</td> <td colspan=3>(version)</td>
        <td>XVP extensions active for this connection.</td>
    </tr>
</table>


__RFB onUpdateState callback details__

The RFB module has an 'onUpdateState' callback that is invoked after
the noVNC connection state changes. Here is a list of the states that
are reported.

<table>
    <tr>
        <td colspan=2><em>Connection States</em></td>
    </tr>
    <tr>
        <th>state</th> <th>description</th>
    </tr>
    <tr>
        <td>connecting</td> <td>starting to connect</td>
    </tr>
    <tr>
        <td>connected</td> <td>connected normally</td>
    </tr>
    <tr>
        <td>disconnecting</td> <td>starting to disconnect</td>
    </tr>
    <tr>
        <td>disconnected</td> <td>disconnected - permanent end-state for this RFB object</td>
    </tr>
</table>

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