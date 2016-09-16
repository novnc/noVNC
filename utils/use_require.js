#!/usr/bin/env node

var path = require('path');
var program = require('commander');
var fs = require('fs');
var fse = require('fs-extra');
var browserify = require('browserify');

var make_modules_transform = require('./make-module-transform');
var babelify = require("babelify");


program
    .option('-b, --browserify', 'create a browserify bundled app')
    .option('--as-require', 'output files using "require" instead of ES6 import and export')
    .parse(process.argv);

// the various important paths
var core_path = path.resolve(__dirname, '..', 'core');
var app_path = path.resolve(__dirname, '..', 'app');
var out_dir_base = path.resolve(__dirname, '..', 'build');
var lib_dir_base = path.resolve(__dirname, '..', 'lib');

var make_browserify = function (src_files, opts) {
    // change to the root noVNC directory
    process.chdir(path.resolve(__dirname, '..'));

    var b = browserify(src_files, opts);

    // register the transforms
    b.transform(make_modules_transform);
    b.transform(babelify,
                { plugins: ["add-module-exports", "transform-es2015-modules-commonjs"] });

    return b;
};

var make_full_app = function () {
    // make sure the output directory exists
    fse.ensureDir(out_dir_base);

    // actually bundle the files into a browserified bundled
    var ui_file = path.join(app_path, 'ui.js');
    var b = make_browserify(ui_file, {});
    var app_file = path.join(out_dir_base, 'app.js');
    b.bundle().pipe(fs.createWriteStream(app_file));

    // copy over app-related resources (images, styles, etc)
    var src_dir_app = path.join(__dirname, '..', 'app');
    fs.readdir(src_dir_app, function (err, files) {
        if (err) { throw err; }

        files.forEach(function (src_file) {
            var src_file_path = path.resolve(src_dir_app, src_file);
            var out_file_path = path.resolve(out_dir_base, src_file);
            var ext = path.extname(src_file);
            if (ext === '.js' || ext === '.html') return;
            fse.copy(src_file_path, out_file_path, function (err) {
                if (err) { throw err; }
                console.log("Copied file(s) from " + src_file_path + " to " + out_file_path);
            });
        });
    });

    // write out the modified vnc.html file that works with the bundle
    var src_html_path = path.resolve(__dirname, '..', 'vnc.html');
    var out_html_path = path.resolve(out_dir_base, 'vnc.html');
    fs.readFile(src_html_path, function (err, contents_raw) {
        if (err) { throw err; }

        var contents = contents_raw.toString();
        contents = contents.replace(/="app\//g, '="');

        var start_marker = '<!-- begin scripts -->\n';
        var end_marker = '<!-- end scripts -->';
        var start_ind = contents.indexOf(start_marker) + start_marker.length;
        var end_ind = contents.indexOf(end_marker, start_ind);

        contents = contents.slice(0, start_ind) + '<script src="app.js"></script>\n' + contents.slice(end_ind);

        fs.writeFile(out_html_path, contents, function (err) {
            if (err) { throw err; }
            console.log("Wrote " + out_html_path);
        });
    });
};

var make_lib_files = function (use_require) {
    // make sure the output directory exists
    fse.ensureDir(lib_dir_base);

    var through = require('through2');

    var deps = {};
    var rfb_file = path.join(core_path, 'rfb.js');
    var b = make_browserify(rfb_file, {});
    b.on('transform', function (tr, file) {
        if (tr._is_make_module) {
            var new_path = path.join(lib_dir_base, path.relative(core_path, file));
            fse.ensureDir(path.dirname(new_path));
            console.log("Writing " + new_path)
            var fileStream = fs.createWriteStream(new_path);

            if (use_require) {
                var babelificate = babelify(file,
                                            { plugins: ["add-module-exports", "transform-es2015-modules-commonjs"] });
                tr.pipe(babelificate);
                tr = babelificate;
            }
            tr.pipe(fileStream);
        }
    });

    b.bundle();
};

if (program.browserify) {
    make_full_app();
} else {
    make_lib_files(program.asRequire);
}
