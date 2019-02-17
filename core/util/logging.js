/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2018 The noVNC Authors
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 */

/*
 * Logging/debug routines
 */

export const LogLevels = {
    none: 'none',
    debug: 'debug',
    info: 'info',
    warn: 'warn',
    error: 'error'
};

export class  NoopLogger {
    Debug() {}
    Info() {}
    Warn() {}
    Error() {}
}

export class ConsoleLogger {
    constructor(level) {
        this._logLevels = {
            debug: 0,
            info: 1,
            warn: 2,
            error: 3
        };

        this.logLevel = level;
        this._logLevel = this._logLevels[level];

        if (this._logLevel === undefined) {
            throw new Error('Invalid logging level \'' + level + '\'');
        }
    }

    Debug(...args) {
        if (this._logLevel <= this._logLevels.debug) {
            // eslint-disable-next-line no-console
            console.debug.apply(console, args);
        }
    }

    Info(...args) {
        if (this._logLevel <= this._logLevels.info) {
            // eslint-disable-next-line no-console
            console.info.apply(console, args);
        }
    }

    Warn(...args) {
        if (this._logLevel <= this._logLevels.warn) {
            // eslint-disable-next-line no-console
            console.warn.apply(console, args);
        }
    }

    Error(...args) {
        if (this._logLevel <= this._logLevels.error) {
            // eslint-disable-next-line no-console
            console.error.apply(console, args);
        }
    }
}

export let Log = window.console ? new ConsoleLogger(LogLevels.warn) : new NoopLogger();

export function setLogger(logger) {
    Log = logger;
}
