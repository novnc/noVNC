var through = require('through2');

var singleLineRe = /\/\* \[module\] ((.(?!\*\/))+) \*\//g;
var multiLineRe = /\/\* \[module\]\n(( * .+\n)+) \*\//g;

var skipAsModule = /\/\* \[begin skip-as-module\] \*\/(.|\n)+\/\* \[end skip-as-module\] \*\//g;

module.exports = function (file) {
    var stream = through(function (buf, enc, next) {
        var bufStr = buf.toString('utf8');
        bufStr = bufStr.replace(singleLineRe, "$1");
        bufStr = bufStr.replace(multiLineRe, function (match, mainLines) {
            return mainLines.split(" * ").join("");
        });

        bufStr = bufStr.replace(skipAsModule, "");

        this.push(bufStr);
        next();
    });

    stream._is_make_module = true;

    return stream;
};
