// Type tests for the noVNC library's own type definitions.
//
// The package self references itself ("@novnc/novnc") in order to
// exercise the exact module resolution that consumers will use.

import RFB from "@novnc/novnc";
import type { RfbCapabilities, RfbCredentials, RfbEvents, RfbOptions,
              RfbServerVerification } from "@novnc/novnc";

// Named types are part of the public API

const opts: RfbOptions = { shared: true };
const creds: RfbCredentials = { password: "password" };
const caps: RfbCapabilities = { power: true };
const verification: RfbServerVerification = {
    type: "RSA",
    publickey: new Uint8Array([1, 2, 3]),
};
type ServerVerificationEvent = RfbEvents["serververification"];
const verificationEvent: ServerVerificationEvent =
    new CustomEvent("serververification", { detail: verification });

const rfb = new RFB(document.body, "wss://example.local", {
    shared: true,
    credentials: {
        password: "password",
    },
    repeaterID: "1",
    wsProtocols: ["binary"],
});

// Credentials can also specify the optional username and target

rfb.sendCredentials({ username: "user", password: "pass", target: "target" });

// Properties

rfb.viewOnly = true;
rfb.focusOnClick = false;
rfb.clipViewport = true;
rfb.dragViewport = true;
rfb.scaleViewport = true;
rfb.resizeSession = true;
rfb.showDotCursor = true;
rfb.background = "rgb(40, 40, 40)";
rfb.qualityLevel = 9;
rfb.compressionLevel = 6;

const capabilities: RfbCapabilities = rfb.capabilities;
const clippingViewport: boolean = rfb.clippingViewport;

// The old touchButton API is still there

const touchButton: number = rfb.touchButton;

// Methods

rfb.disconnect();
rfb.approveServer();
rfb.sendCtrlAltDel();
rfb.sendKey(0xff09, "Tab", true);
rfb.sendKey(0xff09, "Tab");
rfb.sendKey(0xff09, null, false);
rfb.focus({ preventScroll: true });
rfb.blur();
rfb.machineShutdown();
rfb.machineReboot();
rfb.machineReset();
rfb.clipboardPasteFrom("text");

const imageData: ImageData = rfb.getImageData();
const dataURL: string = rfb.toDataURL("image/png", 0.9);
rfb.toBlob((blob: Blob) => {}, "image/png", 0.9);

// Events

rfb.addEventListener("connect", e => {
    // @ts-expect-error the connect event has no details
    e.detail.foo;
});

rfb.addEventListener("disconnect", e => {
    const clean: boolean = e.detail.clean;
});

rfb.addEventListener("credentialsrequired", e => {
    const types: Array<"username" | "password" | "target"> = e.detail.types;
});

rfb.addEventListener("securityfailure", e => {
    const status: number = e.detail.status;
    const reason: string | undefined = e.detail.reason;
});

rfb.addEventListener("clipboard", e => {
    const text: string = e.detail.text;
});

rfb.addEventListener("bell", () => {});

rfb.addEventListener("desktopname", e => {
    const name: string = e.detail.name;
});

rfb.addEventListener("capabilities", e => {
    const caps: { power: boolean } = e.detail.capabilities;
});

rfb.addEventListener("clippingviewport", e => {
    const clipping: boolean = e.detail;
});

rfb.addEventListener("serververification", e => {
    const type: "RSA" = e.detail.type;
    const publickey: Uint8Array = e.detail.publickey;
});

// Generic listener overload, listener options and typed removal

const handler = (e: Event) => {};
rfb.addEventListener("connect", handler);
rfb.addEventListener("connect", handler, { once: true });
rfb.removeEventListener("connect", handler);
rfb.removeEventListener("connect", handler, { capture: false });

const onDisconnect = (e: RfbEvents["disconnect"]) => {};
rfb.addEventListener("disconnect", onDisconnect);
rfb.removeEventListener("disconnect", onDisconnect);

// Unrelated events ( superclass signature )

rfb.addEventListener("customevent", handler);

// Things that should NOT compile

// @ts-expect-error qualityLevel is a number
rfb.qualityLevel = "high";

// @ts-expect-error unknown constructor option
new RFB(document.body, "wss://example.local", { shered: true });

// @ts-expect-error capabilities is read only
rfb.capabilities = { power: true };

// @ts-expect-error clippingViewport is read only
rfb.clippingViewport = false;

// @ts-expect-error clipboard detail is an object with text
rfb.addEventListener("clipboard", e => { const n: number = e.detail; });
