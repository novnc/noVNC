#!/usr/bin/env node

var fs = require("fs");
var browserify = require("browserify");

browserify("src/babel-worker.js")
  .transform("babelify", {
    presets: [ [ "@babel/preset-env", { targets: "ie >= 11" } ] ],
    global: true,
    ignore: [ "../../node_modules/core-js" ]
  })
  .bundle()
  .pipe(fs.createWriteStream("dist/babel-worker.js"));
