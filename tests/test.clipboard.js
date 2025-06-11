import Clipboard from '../core/clipboard.js';

describe('Async Clipboard API', function () {
    "use strict";

    let targetMock;
    let clipboard;

    beforeEach(function () {
        targetMock = document.createElement("canvas");
        clipboard = new Clipboard(targetMock);
    });

    afterEach(function () {
        sinon.restore();
        targetMock = null;
        clipboard = null;
    });

    it("writeClipboard calls navigator.clipboard.writeText", async function () {
        const text = "writing some text";
        sinon.stub(navigator.clipboard, "writeText").resolves(text);
        await clipboard.writeClipboard(text);
        sinon.assert.calledOnceWithExactly(navigator.clipboard.writeText, text);
    });

    it("_handleFocus calls navigator.clipboard.readText", async function () {
        sinon.stub(navigator.clipboard, "readText").resolves();
        await clipboard._handleFocus(new Event("focus"));
        sinon.assert.calledOnce(navigator.clipboard.readText);
    });

    it("_handleFocus triggers onRead with read text", async function () {
        const text = "random text 123";
        sinon.stub(navigator.clipboard, "readText").resolves(text);
        clipboard.onRead = sinon.spy();
        await clipboard._handleFocus(new Event("focus"));
        sinon.assert.calledOnceWithExactly(clipboard.onRead, text);
    });
});
