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


let _logLevel = 'warn';

function safeJoin(input, delimiter) {
    if (!Array.isArray(input)) {
        return '';
    }
    const output = [];
    // eslint-disable-next-line
    for (let i = 0; i < input.length; i++) {
        const value = input[i];
        try {
            output.push(String(value));
        } catch (e) {
            output.push('[value cannot be serialized]');
        }
    }
    return output.join(delimiter);
}

const defaultErrorFunc = (...args) => {
    if (!window.Sentry) {
        return;
    }
    const extra = {arguments: args};
    if (args[0] instanceof Error) {
        window.Sentry.captureException(args[0], {extra});
        return;
    }
    let message = safeJoin(args, ' ');
    window.Sentry.captureMessage(message);
};

let Debug = () => {};
let Info = () => {};
let Warn = () => {};
let Error = defaultErrorFunc;

export function initLogging(level) {
    if (typeof level === 'undefined') {
        level = _logLevel;
    } else {
        _logLevel = level;
    }

    Debug = Info = Warn = () => {};
    Error = defaultErrorFunc;

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
                Error = (...args) => {
                    console.error(...args);
                    defaultErrorFunc(...args);
                };
            case 'none':
                break;
            default:
                throw new window.Error("invalid logging type '" + level + "'");
        }
        /* eslint-enable no-console, no-fallthrough */
    }
}

export function getLogging() {
    return _logLevel;
}

export { Debug, Info, Warn, Error };

// Initialize logging level
initLogging();
