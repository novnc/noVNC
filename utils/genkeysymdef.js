#!/usr/bin/env node
/*
 * genkeysymdef: X11 keysymdef.h to JavaScript converter
 * Copyright 2013 jalf <git@jalf.dk>
 * Copyright 2017 Pierre Ossman for Cendio AB
 * Licensed under MPL 2.0 (see LICENSE.txt)
 */

"use strict";

var fs = require('fs');

var show_help = process.argv.length === 2;
var filename;

for (var i = 2; i < process.argv.length; ++i) {
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
  return;
}

var buf = fs.readFileSync(filename);
var str = buf.toString('utf8');

var re = /^\#define XK_([a-zA-Z_0-9]+)\s+0x([0-9a-fA-F]+)\s*(\/\*\s*(.*)\s*\*\/)?\s*$/m;

var arr = str.split('\n');

var codepoints = {};

for (var i = 0; i < arr.length; ++i) {
    var result = re.exec(arr[i]);
    if (result){
        var keyname = result[1];
        var keysym = parseInt(result[2], 16);
        var remainder = result[3];

        var unicodeRes = /U\+([0-9a-fA-F]+)/.exec(remainder);
        if (unicodeRes) {
            var unicode = parseInt(unicodeRes[1], 16);
            // The first entry is the preferred one
            if (!codepoints[unicode]){
                codepoints[unicode] = { keysym: keysym, name: keyname };
            }
        }
    }
}

var out =
"/*\n" +
" * Mapping from Unicode codepoints to X11/RFB keysyms\n" +
" *\n" +
" * This file was automatically generated from keysymdef.h\n" +
" * DO NOT EDIT!\n" +
" */\n" +
"\n" +
"/* Functions at the bottom */\n" +
"\n" +
"var codepoints = {\n";

function toHex(num) {
    var s = num.toString(16);
    if (s.length < 4) {
        s = ("0000" + s).slice(-4);
    }
    return "0x" + s;
};

for (var codepoint in codepoints) {
    out += "    " + toHex(parseInt(codepoint)) + ": " +
           toHex(codepoints[codepoint].keysym) +
           ", // XK_" + codepoints[codepoint].name + "\n";
}

out +=
"};\n" +
"\n" +
"export default {\n" +
"    lookup : function(u) {\n" +
"        var keysym = codepoints[u];\n" +
"        if (keysym === undefined) {\n" +
"            keysym = 0x01000000 | u;\n" +
"        }\n" +
"        return keysym;\n" +
"    },\n" +
"};";

console.log(out);
