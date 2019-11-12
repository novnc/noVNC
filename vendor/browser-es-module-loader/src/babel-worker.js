// Polyfills needed for Babel to function
require("core-js");

var babelTransform = require('@babel/core').transform;
var babelTransformDynamicImport = require('@babel/plugin-syntax-dynamic-import');
var babelTransformModulesSystemJS = require('@babel/plugin-transform-modules-systemjs');
var babelPresetEnv = require('@babel/preset-env');

self.onmessage = function (evt) {
    // transform source with Babel
    var output = babelTransform(evt.data.source, {
      compact: false,
      filename: evt.data.key + '!transpiled',
      sourceFileName: evt.data.key,
      moduleIds: false,
      sourceMaps: 'inline',
      babelrc: false,
      plugins: [babelTransformDynamicImport, babelTransformModulesSystemJS],
      presets: [ [ babelPresetEnv, { targets: 'ie >= 11' } ] ],
    });

    self.postMessage({key: evt.data.key, code: output.code, source: evt.data.source});
};
