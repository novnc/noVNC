/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2018 The noVNC Authors
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 */

/*
 * Decode from UTF-8
 */
export function decodeUTF8(utf8string) {
    return decodeURIComponent(escape(utf8string));
}
