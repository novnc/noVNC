const TEST_REGEXP = /test\..*\.js/;
const allTestFiles = [];
const extraFiles = ['/base/tests/assertions.js'];

Object.keys(window.__karma__.files).forEach(function (file) {
    if (TEST_REGEXP.test(file)) {
        // TODO: normalize?
        allTestFiles.push(file);
    }
});

// Stub out mocha's start function so we can run it once we're done loading
mocha.origRun = mocha.run;
mocha.run = function () {};

let script;

// Script to import all our tests
script = document.createElement("script");
script.type = "module";
script.text = "";
let allModules = allTestFiles.concat(extraFiles);
allModules.forEach(function (file) {
    script.text += "import \"" + file + "\";\n";
});
script.text += "\nmocha.origRun();\n";
document.body.appendChild(script);

// Fallback code for browsers that don't support modules (IE)
script = document.createElement("script");
script.type = "module";
script.text = "window._noVNC_has_module_support = true;\n";
document.body.appendChild(script);

function fallback() {
    if (!window._noVNC_has_module_support) {
        /* eslint-disable no-console */
        if (console) {
            console.log("No module support detected. Loading fallback...");
        }
        /* eslint-enable no-console */
        let loader = document.createElement("script");
        loader.src = "base/vendor/browser-es-module-loader/dist/browser-es-module-loader.js";
        document.body.appendChild(loader);
    }
}

setTimeout(fallback, 500);
