import AsyncClipboard from '../core/clipboard.js';

describe('Async Clipboard', function () {
    "use strict";

    let targetMock;
    let clipboard;

    beforeEach(function () {
        sinon.stub(navigator, "clipboard").value({
            writeText: sinon.stub().resolves(),
            readText: sinon.stub().resolves(),
        });

        sinon.stub(navigator, "permissions").value({
            query: sinon.stub(),
        });

        targetMock = document.createElement("canvas");
        clipboard = new AsyncClipboard(targetMock);
    });

    afterEach(function () {
        sinon.restore();
        targetMock = null;
        clipboard = null;
    });

    function stubClipboardPermissions(state) {
        navigator.permissions.query
            .withArgs({ name: 'clipboard-write', allowWithoutGesture: true })
            .resolves({ state: state });
        navigator.permissions.query
            .withArgs({ name: 'clipboard-read', allowWithoutGesture: false })
            .resolves({ state: state });
    }

    function nextTick() {
        return new Promise(resolve => setTimeout(resolve, 0));
    }

    it('grab() adds listener if permissions granted', async function () {
        stubClipboardPermissions('granted');

        const addListenerSpy = sinon.spy(targetMock, 'addEventListener');
        clipboard.grab();

        await nextTick();

        expect(addListenerSpy.calledWith('focus')).to.be.true;
    });

    it('grab() does not add listener if permissions denied', async function () {
        stubClipboardPermissions('denied');

        const addListenerSpy = sinon.spy(targetMock, 'addEventListener');
        clipboard.grab();

        await nextTick();

        expect(addListenerSpy.calledWith('focus')).to.be.false;
    });

    it('focus event triggers onpaste() if permissions granted', async function () {
        stubClipboardPermissions('granted');

        const text = 'hello clipboard world';
        navigator.clipboard.readText.resolves(text);

        const spyPromise = new Promise(resolve => clipboard.onpaste = resolve);

        clipboard.grab();

        await nextTick();

        targetMock.dispatchEvent(new Event('focus'));

        const res = await spyPromise;
        expect(res).to.equal(text);
    });

    it('focus event does not trigger onpaste() if permissions denied', async function () {
        stubClipboardPermissions('denied');

        const text = 'should not read';
        navigator.clipboard.readText.resolves(text);

        clipboard.onpaste = sinon.spy();

        clipboard.grab();

        await nextTick();

        targetMock.dispatchEvent(new Event('focus'));

        expect(clipboard.onpaste.called).to.be.false;
    });

    it('writeClipboard() calls navigator.clipboard.writeText() if permissions granted', async function () {
        stubClipboardPermissions('granted');
        clipboard._isAvailable = true;

        const text = 'writing to clipboard';
        const result = clipboard.writeClipboard(text);

        expect(navigator.clipboard.writeText.calledWith(text)).to.be.true;
        expect(result).to.be.true;
    });

    it('writeClipboard() does not call navigator.clipboard.writeText() if permissions denied', async function () {
        stubClipboardPermissions('denied');
        clipboard._isAvailable = false;

        const text = 'should not write';
        const result = clipboard.writeClipboard(text);

        expect(navigator.clipboard.writeText.called).to.be.false;
        expect(result).to.be.false;
    });

});
