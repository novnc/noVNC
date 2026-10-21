/**
 * Type definitions for the public API of the noVNC library.
 *
 * These definitions describe the `RFB` object as documented in
 * `docs/API.md` and implemented in `core/rfb.js`.
 *
 * Based on the type definitions from the DefinitelyTyped project
 * (types/novnc__novnc), licensed under the MIT license. See
 * `docs/LICENSE.MIT` for the full license text; the individual
 * contributors are listed in the upstream git history.
 */

/**
 * An `object` specifying the credentials to provide to the server when
 * authenticating. Which credentials are needed depends on the security
 * type used by the server. Listen to the `credentialsrequired` event to
 * find out which credentials are missing.
 */
export interface RfbCredentials {
    /** The user that authenticates */
    username?: string;
    /** Password for the user */
    password?: string;
    /** Target machine or session */
    target?: string;
}

/**
 * An `object` specifying extra details about how the connection should
 * be made.
 */
export interface RfbOptions {
    /**
     * A `boolean` indicating if the remote server should be shared or if
     * any other connected clients should be disconnected. Enabled by
     * default.
     */
    shared?: boolean;
    /**
     * An `object` specifying the credentials to provide to the server when
     * authenticating.
     */
    credentials?: RfbCredentials;
    /**
     * A `string` specifying the ID to provide to any VNC repeater
     * encountered.
     */
    repeaterID?: string;
    /**
     * An `Array` of `string`s specifying the sub-protocols to use in the
     * WebSocket connection. Empty by default.
     */
    wsProtocols?: string[];
}

/**
 * The details of the `serververification` event.
 *
 * The available properties depend on the value of `type`.
 */
export interface RfbServerVerification {
    /**
     * A `string` specifying which type of information the server has
     * provided.
     */
    type: "RSA";
    /**
     * The server's public key in an unsigned big endian representation.
     * Only available when `type` is `"RSA"`.
     */
    publickey: Uint8Array;
}

/**
 * The events emitted by {@link RFB}. Each event is a `CustomEvent` with
 * additional details in the `detail` property.
 */
export interface RfbEvents {
    /**
     * The `connect` event is fired after all the handshaking with the
     * server is completed and the connection is fully established. After
     * this event the `RFB` object is ready to receive graphics updates
     * and to send input.
     */
    connect: CustomEvent<{}>;

    /**
     * The `disconnect` event is fired when the connection has been
     * terminated. The `detail` property is an `object` that contains the
     * property `clean`. `clean` is a `boolean` indicating if the
     * termination was clean or not. In the event of an unexpected
     * termination or an error `clean` will be set to false.
     */
    disconnect: CustomEvent<{ clean: boolean }>;

    /**
     * The `credentialsrequired` event is fired when the server requests
     * more credentials than were specified to {@link RFB}. The `detail`
     * property is an `object` containing the property `types` which is an
     * `Array` of `string` listing the credentials that are required.
     */
    credentialsrequired: CustomEvent<{ types: (keyof RfbCredentials)[] }>;

    /**
     * The `securityfailure` event is fired when the handshaking process
     * with the server fails during the security negotiation step. The
     * `detail` property is an `object` containing the following
     * properties:
     *
     * | Property | Type     | Description
     * | -------- | -------- | -----------
     * | `status` | `number` | The failure status code
     * | `reason` | `string` | The **optional** reason for the failure
     *
     * The property `status` corresponds to the
     * [SecurityResult](https://github.com/rfbproto/rfbproto/blob/master/rfbproto.rst#securityresult)
     * status code in cases of failure. A status of zero will not be sent
     * in this event since that indicates a successful security
     * handshaking process. The optional property `reason` is provided by
     * the server and thus the language of the string is not known.
     * However most servers will probably send English strings. The
     * server can choose to not send a reason and in these cases the
     * `reason` property will be omitted.
     */
    securityfailure: CustomEvent<{ status: number; reason?: string }>;

    /**
     * The `clipboard` event is fired when the server has sent clipboard
     * data. The `detail` property is an `object` containing the property
     * `text` which is a `string` with the clipboard data.
     */
    clipboard: CustomEvent<{ text: string }>;

    /**
     * The `bell` event is fired when the server has requested an
     * audible bell.
     */
    bell: CustomEvent<{}>;

    /**
     * The `desktopname` event is fired when the name of the remote
     * desktop changes. The `detail` property is an `object` with the
     * property `name` which is a `string` specifying the new name.
     */
    desktopname: CustomEvent<{ name: string }>;

    /**
     * The `capabilities` event is fired whenever an entry is added or
     * removed from `RFB.capabilities`. The `detail` property is an
     * `object` with the property `capabilities` containing the new
     * value of `RFB.capabilities`.
     */
    capabilities: CustomEvent<{ capabilities: RfbCapabilities }>;

    /**
     * The `clippingviewport` event is fired whenever `clippingViewport`
     * changes between true and false. The `detail` property is a
     * `boolean` with the new value of `clippingViewport`.
     */
    clippingviewport: CustomEvent<boolean>;

    /**
     * The `serververification` event is fired when the server provides
     * information that allows the user to verify that it is the correct
     * server and protect against a man-in-the-middle attack.
     */
    serververification: CustomEvent<RfbServerVerification>;
}

/**
 * An `object` indicating which optional extensions are available on the
 * server. Some methods may only be called if the corresponding capability
 * is set. The following capabilities are defined:
 *
 * | name     | type      | description
 * | -------- | --------- |  -----------
 * | `power`  | `boolean` | Machine power control is available
 */
export interface RfbCapabilities {
    /** Machine power control is available */
    power: boolean;
}

/**
 * The `RFB` object represents a single connection to a VNC server. It
 * communicates using a WebSocket that must provide a standard RFB
 * protocol stream.
 */
export default class RFB extends EventTarget {
    /**
     * Returns a new `RFB` object and initiates a new connection to a
     * specified VNC server.
     *
     * @param target A block `HTMLElement` that specifies where the
     * `RFB` object should attach itself. The existing contents of the
     * `HTMLElement` will be untouched, but new elements will be added
     * during the lifetime of the `RFB` object.
     * @param urlOrChannel A `string`, `WebSocket`, or `RTCDataChannel`
     * specifying the VNC server to connect to. A `string` must be a
     * valid WebSocket URL.
     * @param options An `RfbOptions` object specifying extra details
     * about how the connection should be made.
     */
    constructor(target: HTMLElement,
                urlOrChannel: string | WebSocket | RTCDataChannel,
                options?: RfbOptions);

    /**
     * Adds a listener for one of the events described by `RfbEvents`.
     * The event name is typed and the listener receives the matching
     * `CustomEvent`.
     *
     * The second overload intentionally allows arbitrary event names
     * with ordinary `EventListener`s, matching the `EventTarget` base
     * class.
     */
    addEventListener<K extends keyof RfbEvents>(type: K,
        listener: (event: RfbEvents[K]) => void,
        options?: boolean | AddEventListenerOptions): void;
    addEventListener(type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | AddEventListenerOptions): void;

    /**
     * Removes a listener previously added with `addEventListener`.
     */
    removeEventListener<K extends keyof RfbEvents>(type: K,
        listener: (event: RfbEvents[K]) => void,
        options?: boolean | EventListenerOptions): void;
    removeEventListener(type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | EventListenerOptions): void;

    /**
     * Is a `boolean` indicating if any events (e.g. key presses or mouse
     * movement) should be prevented from being sent to the server.
     * Disabled by default.
     */
    viewOnly: boolean;

    /**
     * Is a `boolean` indicating if keyboard focus should automatically
     * be moved to the remote session when a `mousedown` or `touchstart`
     * event is received. Enabled by default.
     */
    focusOnClick: boolean;

    /**
     * Is a `boolean` indicating if the remote session should be clipped
     * to its container. When disabled scrollbars will be shown to handle
     * the resulting overflow. Disabled by default.
     */
    clipViewport: boolean;

    /**
     * Is a `boolean` indicating if mouse events should control the
     * relative position of a clipped remote session. Only relevant if
     * `clipViewport` is enabled. Disabled by default.
     */
    dragViewport: boolean;

    /**
     * Is a `boolean` indicating if the remote session should be scaled
     * locally so it fits its container. When disabled it will be
     * centered if the remote session is smaller than its container, or
     * handled according to `clipViewport` if it is larger. Disabled by
     * default.
     */
    scaleViewport: boolean;

    /**
     * Is a `boolean` indicating if a request to resize the remote
     * session should be sent whenever the container changes dimensions.
     * Disabled by default.
     */
    resizeSession: boolean;

    /**
     * Is a `boolean` indicating whether a dot cursor should be shown
     * instead of a zero-sized or fully-transparent cursor if the server
     * sets such invisible cursor. Disabled by default.
     */
    showDotCursor: boolean;

    /**
     * Is a valid CSS
     * [background](https://developer.mozilla.org/en-US/docs/Web/CSS/background)
     * style value indicating which background style should be applied to
     * the element containing the remote session screen. The default value
     * is `rgb(40, 40, 40)` (solid gray color).
     */
    background: string;

    /**
     * Is an `int` in range `[0-9]` controlling the desired JPEG quality.
     * Value `0` implies low quality and `9` implies high quality.
     * Default value is `6`.
     */
    qualityLevel: number;

    /**
     * Is an `int` in range `[0-9]` controlling the desired compression
     * level. Value `0` means no compression. Level 1 uses a minimum of
     * CPU resources and achieves weak compression ratios, while level 9
     * offers best compression but is slow in terms of CPU consumption on
     * the server side. Use high levels with very slow network
     * connections. Default value is `2`.
     */
    compressionLevel: number;

    /**
     * Is an `object` indicating which optional extensions are available
     * on the server. Some methods may only be called if the corresponding
     * capability is set. The following capabilities are defined:
     *
     * | name     | type      | description
     * | -------- | --------- | -----------
     * | `power`  | `boolean` | Machine power control is available
     */
    readonly capabilities: RfbCapabilities;

    /**
     * Is a `boolean` indicating if the remote session is currently being
     * clipped to its container. Only relevant if `clipViewport` is
     * enabled.
     */
    readonly clippingViewport: boolean;

    /**
     * Old API that no longer has any effect, always `0`.
     * @deprecated No-op, only exists to keep old code running.
     */
    touchButton: number;

    /**
     * Disconnect from the server.
     */
    disconnect(): void;

    /**
     * Proceed connecting to the server. Should be called after the
     * `serververification` event has fired and the user has verified the
     * identity of the server.
     */
    approveServer(): void;

    /**
     * Send credentials to server. Should be called after the
     * `credentialsrequired` event has fired.
     *
     * @param credentials An `RfbCredentials` object specifying the
     * credentials to provide to the server when authenticating.
     */
    sendCredentials(credentials: RfbCredentials): void;

    /**
     * Send a key event to the server.
     *
     * @param keysym A `number` specifying the RFB keysym to send. Can be
     * `0` if a valid **`code`** is specified.
     * @param code A `string` specifying the physical key to send. Valid
     * values are those that can be specified to `KeyboardEvent.code`.
     * If the physical key cannot be determined then `null` shall be
     * specified.
     * @param down A `boolean` specifying if a press or a release event
     * should be sent. If omitted then both a press and release event are
     * sent.
     */
    sendKey(keysym: number, code: string | null, down?: boolean): void;

    /**
     * Send the key sequence *left Control*, *left Alt*, *Delete*. This
     * is a convenience wrapper around `sendKey`.
     */
    sendCtrlAltDel(): void;

    /**
     * Move keyboard focus to the remote session. Keyboard events will be
     * sent to the remote server after this point.
     *
     * @param options A `FocusOptions` object providing options to
     * control how the focus will be performed. Please see
     * `HTMLElement.focus` for available options.
     */
    focus(options?: FocusOptions): void;

    /**
     * Remove keyboard focus from the remote session. Keyboard events
     * will no longer be sent to the remote server after this point.
     */
    blur(): void;

    /**
     * Request to shut down the remote machine. The capability `power`
     * must be set for this method to have any effect.
     */
    machineShutdown(): void;

    /**
     * Request a clean reboot of the remote machine. The capability
     * `power` must be set for this method to have any effect.
     */
    machineReboot(): void;

    /**
     * Request a forced reset of the remote machine. The capability
     * `power` must be set for this method to have any effect.
     */
    machineReset(): void;

    /**
     * Send clipboard contents to server.
     *
     * @param text A `string` specifying the clipboard data to send.
     */
    clipboardPasteFrom(text: string): void;

    /**
     * Return the current content of the screen as an `ImageData`
     * array.
     */
    getImageData(): ImageData;

    /**
     * Return the current content of the screen encoded as a base64
     * data URL.
     *
     * @param type A `string` indicating the requested MIME type of the
     * image.
     * @param encoderOptions A `number` between 0 and 1 indicating the
     * image quality.
     */
    toDataURL(type?: string, encoderOptions?: number): string;

    /**
     * Return the current content of the screen encoded as a `Blob`.
     *
     * @param callback A callback function which will receive the
     * resulting `Blob` as the single argument.
     * @param type A `string` indicating the requested MIME type of the
     * image.
     * @param quality A `number` between 0 and 1 indicating the image
     * quality.
     */
    toBlob(callback: (blob: Blob) => void, type?: string,
           quality?: number): void;
}
