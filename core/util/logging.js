/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2019 The noVNC Authors
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 */

/*
 * Logging/debug routines
 */

let _log_level = 'warn';

let Debug = () => {};
let Info = () => {};
let Warn = () => {};
let Error = () => {};

export function init_logging(level) {
    if (typeof level === 'undefined') {
        level = _log_level;
    } else {
        _log_level = level;
    }

    Debug = Info = Warn = Error = () => {};

    if (typeof window.console !== "undefined") {
        /* eslint-disable no-console, no-fallthrough */
        switch (level) {
            case 'debug':
                Debug = console.debug.bind(window.console);
            case 'info':
                Info  = console.info.bind(window.console);
            case 'warn':
                Warn  = console.warn.bind(window.console);
            case 'error':
                Error = console.error.bind(window.console);
            case 'none':
                break;
            default:
                throw new window.Error("invalid logging type '" + level + "'");
        }
        /* eslint-enable no-console, no-fallthrough */
    }
}

export function get_logging() {
    return _log_level;
}

export { Debug, Info, Warn, Error };

// Initialize logging level
init_logging();
