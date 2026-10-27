export default class RFB extends EventTarget {
    clipViewport: boolean;
    resizeSession: boolean;
    scaleViewport: boolean;
    showDotCursor: boolean;
    viewOnly: boolean;
    constructor(
        target: HTMLElement,
        url: string,
        options?: { credentials?: { password: string }; shared?: boolean; wsProtocols?: string[] },
    );
    disconnect(): void;
    sendCtrlAltDel(): void;
    sendKey(keysym: number, code: string | null, down?: boolean): void;
}
