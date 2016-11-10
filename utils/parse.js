// Utility to parse keysymdef.h to produce mappings from Unicode codepoints to keysyms
"use strict";

var fs = require('fs');

var show_help = process.argv.length === 2;
var use_keynames = false;
var filename;

for (var i = 2; i < process.argv.length; ++i) {
  switch (process.argv[i]) {
    case "--help":
    case "-h":
      show_help = true;
      break;
    case "--debug-names":
    case "-d":
      use_keynames = true;
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
  console.log("  -d [ --debug-names ]          Preserve keysym names for debugging (Increases file size by ~40KB)");
  console.log("  filename                      The keysymdef.h file to parse");
  return;
}

// Set this to false to omit key names from the generated keysymdef.js
// This reduces the file size by around 40kb, but may hinder debugging

var buf = fs.readFileSync(filename);
var str = buf.toString('utf8');

var re = /^\#define XK_([a-zA-Z_0-9]+)\s+0x([0-9a-fA-F]+)\s*(\/\*\s*(.*)\s*\*\/)?\s*$/m;

var arr = str.split('\n');

var keysyms = {};
var codepoints = {};

for (var i = 0; i < arr.length; ++i) {
    var result = re.exec(arr[i]);
    if (result){
        var keyname = result[1];
        var keysym = parseInt(result[2], 16);
        var remainder = result[3];

        keysyms[keysym] = keyname;

        var unicodeRes = /U\+([0-9a-fA-F]+)/.exec(remainder);
        if (unicodeRes) {
            var unicode = parseInt(unicodeRes[1], 16);
            if (!codepoints[unicode]){
                codepoints[unicode] = keysym;
            }
        }
        else {
            console.log("no unicode codepoint found:", arr[i]);
        }
    }
    else {
        console.log("line is not a keysym:", arr[i]);
    }
}

var out = "// This file describes mappings from Unicode codepoints to the keysym values\n" +
"// (and optionally, key names) expected by the RFB protocol\n" +
"// How this file was generated:\n" +
"// " + process.argv.join(" ") + "\n" +
"var keysyms = (function(){\n" +
"    \"use strict\";\n" +
"    var keynames = {keysyms};\n" +
"    var codepoints = {codepoints};\n" +
"\n" +
"    function lookup(k) { return k ? {keysym: k, keyname: keynames ? keynames[k] : k} : undefined; }\n" +
"    return {\n" +
"        fromUnicode : function(u) {\n" +
"            var keysym = codepoints[u];\n" +
"            if (keysym === undefined) {\n" +
"                keysym = 0x01000000 | u;\n" +
"            }\n" +
"            return lookup(keysym);\n" +
"        },\n" +
"        lookup : lookup\n" +
"    };\n" +
"})();\n";
out = out.replace('{keysyms}', use_keynames ? JSON.stringify(keysyms) : "null");
out = out.replace('{codepoints}', JSON.stringify(codepoints));

fs.writeFileSync("keysymdef.js", out);
