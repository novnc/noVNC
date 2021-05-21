#!/usr/bin/env node
/*
 * genkeysymdef: X11 keysymdef.h to JavaScript converter
 * Copyright (C) 2018 The noVNC Authors
 * Licensed under MPL 2.0 (see LICENSE.txt)
 */

"use strict";

const fs = require('fs');

let show_help = process.argv.length === 2;
let filename;

for (let i = 2; i < process.argv.length; ++i) {
    switch (process.argv[i]) {
        case "--help":
        case "-h":
            show_help = true;
            break;
        case "--file":
        case "-f":
        default:
            filename = process.argv[i];
    }
}

if (!filename) {
    show_help = true;
    console.log("Error: No filename specified\n");
}

if (show_help) {
    console.log("Parses a *nix keysymdef.h to generate Unicode code point mappings");
    console.log("Usage: node parse.js [options] filename:");
    console.log("  -h [ --help ]                 Produce this help message");
    console.log("  filename                      The keysymdef.h file to parse");
    process.exit(0);
}

const buf = fs.readFileSync(filename);
const str = buf.toString('utf8');

const re = /^#define XK_([a-zA-Z_0-9]+)\s+0x([0-9a-fA-F]+)\s*(\/\*\s*(.*)\s*\*\/)?\s*$/m;

const arr = str.split('\n');

const codepoints = {};

for (let i = 0; i < arr.length; ++i) {
    const result = re.exec(arr[i]);
    if (result) {
        const keyname = result[1];
        const keysym = parseInt(result[2], 16);
        const remainder = result[3];

        const unicodeRes = /U\+([0-9a-fA-F]+)/.exec(remainder);
        if (unicodeRes) {
            const unicode = parseInt(unicodeRes[1], 16);
            // The first entry is the preferred one
            if (!codepoints[unicode]) {
                codepoints[unicode] = { keysym: keysym, name: keyname };
            }
        }
    }
}

let out =
"/*\n" +
" * Mapping from Unicode codepoints to X11/RFB keysyms\n" +
" *\n" +
" * This file was automatically generated from keysymdef.h\n" +
" * DO NOT EDIT!\n" +
" */\n" +
"\n" +
"/* Functions at the bottom */\n" +
"\n" +
"const codepoints = {\n";

function toHex(num) {
    let s = num.toString(16);
    if (s.length < 4) {
        s = ("0000" + s).slice(-4);
    }
    return "0x" + s;
}

for (let codepoint in codepoints) {
    codepoint = parseInt(codepoint);

    // Latin-1?
    if ((codepoint >= 0x20) && (codepoint <= 0xff)) {
        continue;
    }

    // Handled by the general Unicode mapping?
    if ((codepoint | 0x01000000) === codepoints[codepoint].keysym) {
        continue;
    }

    out += "    " + toHex(codepoint) + ": " +
           toHex(codepoints[codepoint].keysym) +
           ", // XK_" + codepoints[codepoint].name + "\n";
}

out +=
"};\n" +
"\n" +
"export default {\n" +
"    lookup(u) {\n" +
"        // Latin-1 is one-to-one mapping\n" +
"        if ((u >= 0x20) && (u <= 0xff)) {\n" +
"            return u;\n" +
"        }\n" +
"\n" +
"        // Lookup table (fairly random)\n" +
"        const keysym = codepoints[u];\n" +
"        if (keysym !== undefined) {\n" +
"            return keysym;\n" +
"        }\n" +
"\n" +
"        // General mapping as final fallback\n" +
"        return 0x01000000 | u;\n" +
"    },\n" +
"};";

console.log(out);
