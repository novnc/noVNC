/*import { transform as babelTransform } from 'babel-core';
import babelTransformDynamicImport from 'babel-plugin-syntax-dynamic-import';
import babelTransformES2015ModulesSystemJS from 'babel-plugin-transform-es2015-modules-systemjs';*/

// sadly, due to how rollup works, we can't use es6 imports here
var babelTransform = require('babel-core').transform;
var babelTransformDynamicImport = require('babel-plugin-syntax-dynamic-import');
var babelTransformES2015ModulesSystemJS = require('babel-plugin-transform-es2015-modules-systemjs');
var babelPresetES2015 = require('babel-preset-es2015');

self.onmessage = function (evt) {
    // transform source with Babel
    var output = babelTransform(evt.data.source, {
      compact: false,
      filename: evt.data.key + '!transpiled',
      sourceFileName: evt.data.key,
      moduleIds: false,
      sourceMaps: 'inline',
      babelrc: false,
      plugins: [babelTransformDynamicImport, babelTransformES2015ModulesSystemJS],
      presets: [babelPresetES2015],
    });

    self.postMessage({key: evt.data.key, code: output.code, source: evt.data.source});
};
