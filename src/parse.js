fs = require('fs');

// Set this to false to omit key names from the generated keysymdef.js
// This reduces the file size by around 40kb, but may hinder debugging
var USE_KEYNAMES=true;

var buf = fs.readFileSync("keysymdef.h");
var str = buf.toString('utf8');

var re = /^\#define XK_([a-zA-Z_0-9]+)\s+0x([0-9a-fA-F]+)\s*(\/\*\s*(.*)\s*\*\/)?\s*$/m;

var arr = str.split('\n');

var keysyms = {}
var codepoints = {}

for (var i = 0; i < arr.length; ++i) {
	//console.log(arr[i]);
	var result = re.exec(arr[i]);
	if (result){
        var keyname = result[1];
        var keysym = parseInt(result[2], 16);
        var remainder = result[3]

        var val = {keyname: keyname, keysym: keysym};
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
"// Install node.js and run the command 'node parse.js'\n" +
"var keysyms = (function(){\n" +
"    var keynames = {keysyms};\n" +
"    var codepoints = {codepoints};\n" +
"\n" +
"    function lookup(k) { return k ? {keysym: k, keyname: keynames ? keynames[k] : k} : undefined; }\n" +
"    return {\n" +
"        fromUnicode : function(u) { return lookup(codepoints[u]); },\n" +
"        lookup : lookup\n" +
"    };\n" +
"})();\n";
out = out.replace('{keysyms}', USE_KEYNAMES ? JSON.stringify(keysyms) : "null");
out = out.replace('{codepoints}', JSON.stringify(codepoints));

fs.writeFileSync("keysymdef.js", out);
