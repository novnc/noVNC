import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import AsyncClipboard from '../core/clipboard.js';

describe('Async Clipboard', function () {
    "use strict";

    let targetMock;
    let clipboard;

    beforeEach(function () {
        vi.stubGlobal('navigator', {
            ...navigator,
            clipboard: {
                writeText: vi.fn().mockResolvedValue(),
                readText: vi.fn().mockResolvedValue(),
            },
            permissions: {
                query: vi.fn(),
            }
        });

        targetMock = document.createElement("canvas");
        clipboard = new AsyncClipboard(targetMock);
    });

    afterEach(function () {
        vi.restoreAllMocks();
        targetMock = null;
        clipboard = null;
    });

    function stubClipboardPermissions(state) {
        navigator.permissions.query.mockImplementation(args =>
            Promise.resolve({ state: state })
        );
    }

    function nextTick() {
        return new Promise(resolve => setTimeout(resolve, 0));
    }

    it('grab() adds listener if permissions granted', async function () {
        stubClipboardPermissions('granted');

        const addListenerSpy = vi.spyOn(targetMock, 'addEventListener');
        clipboard.grab();

        await nextTick();

        expect(addListenerSpy).toHaveBeenCalledWith('focus', expect.any(Function));
    });

    it('grab() does not add listener if permissions denied', async function () {
        stubClipboardPermissions('denied');

        const addListenerSpy = vi.spyOn(targetMock, 'addEventListener');
        clipboard.grab();

        await nextTick();

        expect(addListenerSpy).not.toHaveBeenCalledWith('focus', expect.any(Function));
    });

    it('focus event triggers onpaste() if permissions granted', async function () {
        stubClipboardPermissions('granted');

        const text = 'hello clipboard world';
        navigator.clipboard.readText.mockResolvedValue(text);

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
        navigator.clipboard.readText.mockResolvedValue(text);

        clipboard.onpaste = vi.fn();

        clipboard.grab();

        await nextTick();

        targetMock.dispatchEvent(new Event('focus'));

        expect(clipboard.onpaste).not.toHaveBeenCalled();
    });

    it('writeClipboard() calls navigator.clipboard.writeText() if permissions granted', async function () {
        stubClipboardPermissions('granted');
        clipboard._isAvailable = true;

        const text = 'writing to clipboard';
        const result = clipboard.writeClipboard(text);

        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(text);
        expect(result).toBe(true);
    });

    it('writeClipboard() does not call navigator.clipboard.writeText() if permissions denied', async function () {
        stubClipboardPermissions('denied');
        clipboard._isAvailable = false;

        const text = 'should not write';
        const result = clipboard.writeClipboard(text);

        expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
        expect(result).toBe(false);
    });

});
