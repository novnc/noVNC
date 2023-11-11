export default class Clipboard {
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
        if (navigator.clipboard.writeText) {
            navigator.clipboard.writeText(e.clipboardData.getData('text/plain')).catch(() => {/* Do nothing */});
        }
    }
    /**
     * @param {ClipboardEvent} e 
     */
    _handlePaste(e) {
        if(!this._isVncEvent()){
            return;
        }
        if(e.clipboardData){
            this.onpaste(e.clipboardData.getData('text/plain'));
        }
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
