export default class Clipboard {
     /**
     *  @type {string}
     */
     _remoteClipboard
    constructor(target) {
        this._target = target;

        this._eventHandlers = {
            'copy': this._handleCopy.bind(this),
            'paste': this._handlePaste.bind(this)
        };

        // ===== EVENT HANDLERS =====

        this.onpaste = () => {};
    }

    // ===== PRIVATE METHODS =====

    _handleCopy(e) {
        this._remoteClipboard = e.clipboardData.getData('text/plain');
        this._copy(this._remoteClipboard)
    }
    /**
     * Has a better browser support compared with navigator.clipboard.writeText.
     * Also, no permission required.
     */
    _copy(text) {
        const textarea = document.createElement('textarea');
        textarea.innerHTML = text;
        document.body.appendChild(textarea);
        textarea.select();
        const result = document.execCommand('copy');
        document.body.removeChild(textarea);
    }
    /**
     * @param {ClipboardEvent} e 
     */
    _handlePaste(e) {
        if(!this._isVncEvent()){
            return;
        }
        if(e.clipboardData){
            const localClipboard = e.clipboardData.getData('text/plain');
            if(localClipboard === this._remoteClipboard){
                this._pasteVncServerInternalClipboard();
                return;
            }
            this.onpaste(localClipboard);
        }
    }
    /**
     * The vnc server clipboard can be non ascii text and server might only support ascii code.
     * In that case, localClipboard received from the vnc server is garbled.
     * For example, if you copied chinese text "你好" in the vnc server the local clipboard will be changed to "??". 
     * If you press Ctrl+V, the vnc server should paste "你好" instead of "??".
     * So, we shouldn't send the local clipboard to the vnc server because the local clipboard is garbled in this case.
     */
    _pasteVncServerInternalClipboard(){
        this.onpaste("", false);
    }
    _isVncEvent(){
        const isTargetFocused = document.activeElement === this._target;
        return isTargetFocused;
    }

    // ===== PUBLIC METHODS =====

    grab() {
        if (!Clipboard.isSupported) return;
        this._target.addEventListener('copy', this._eventHandlers.copy);
        // _target can not listen the paste event.
        document.body.addEventListener('paste', this._eventHandlers.paste);
    }

    ungrab() {
        if (!Clipboard.isSupported) return;
        this._target.removeEventListener('copy', this._eventHandlers.copy);
        document.body.removeEventListener('paste', this._eventHandlers.paste);
    }
}

Clipboard.isSupported = (navigator && navigator.clipboard) ? true : false;
