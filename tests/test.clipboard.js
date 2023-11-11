const expect = chai.expect;

import Clipboard from '../core/clipboard.js';

describe('Automatic Clipboard Sync', function () {
    "use strict";

    it('is supported on all target browsers', function () {
        expect(Clipboard.isSupported).to.be.true;
    });

    it('incoming clipboard data from the server is copied to the local clipboard', function () {
        const text = 'Random string for testing';
        const clipboard = new Clipboard();
        if (Clipboard.isSupported) {
            const clipboardData = new DataTransfer();
            clipboardData.setData("text/plain", text);
            const clipboardEvent = new ClipboardEvent('paste', { clipboardData });
            // Force initialization since the constructor is broken in Firefox
            if (!clipboardEvent.clipboardData.items.length) {
                clipboardEvent.clipboardData.items.add(text, "text/plain");
            }
            sinon.spy(clipboard, '_copy');
            clipboard._handleCopy(clipboardEvent);
            expect(clipboard._copy).to.have.been.calledWith(text);
            expect(clipboard._remoteClipboard).to.eq(text);
        }
    });

    it('should copy local pasted data to the server clipboard', function () {
        const text = 'Another random string for testing';
        const clipboard = new Clipboard();
        if (Clipboard.isSupported) {
            const clipboardData = new DataTransfer();
            clipboardData.setData("text/plain", text);
            const clipboardEvent = new ClipboardEvent('paste', { clipboardData });
            // Force initialization since the constructor is broken in Firefox
            if (!clipboardEvent.clipboardData.items.length) {
                clipboardEvent.clipboardData.items.add(text, "text/plain");
            }
            sinon.stub(clipboard, '_isVncEvent').returns(true);
            sinon.spy(clipboard, 'onpaste');
            clipboard._handlePaste(clipboardEvent);
            expect(clipboard.onpaste).to.have.been.calledWith(text);
        }
    });

    it('should not copy local pasted data to the server clipboard', function () {
        const text = 'Another random string for testing';
        const clipboard = new Clipboard();
        clipboard._remoteClipboard = text;
        if (Clipboard.isSupported) {
            const clipboardData = new DataTransfer();
            clipboardData.setData("text/plain", text);
            const clipboardEvent = new ClipboardEvent('paste', { clipboardData });
            // Force initialization since the constructor is broken in Firefox
            if (!clipboardEvent.clipboardData.items.length) {
                clipboardEvent.clipboardData.items.add(text, "text/plain");
            }
            sinon.stub(clipboard, '_isVncEvent').returns(true);
            sinon.spy(clipboard, 'onpaste');
            clipboard._handlePaste(clipboardEvent);
            expect(clipboard.onpaste).to.have.been.calledWith("", false);
        }
    });
});
