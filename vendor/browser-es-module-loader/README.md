Custom Browser ES Module Loader
===============================

This is a module loader using babel and the ES Module Loader polyfill.
It's based heavily on
https://github.com/ModuleLoader/browser-es-module-loader, but uses
WebWorkers to compile the modules in the background.

To generate, run `rollup -c` in this directory, and then run `browserify
src/babel-worker.js > dist/babel-worker.js`.

LICENSE
-------

MIT
