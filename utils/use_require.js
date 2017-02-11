#!/usr/bin/env node

var path = require('path');
var program = require('commander');
var fs = require('fs');
var fse = require('fs-extra');

const SUPPORTED_FORMATS = new Set(['amd', 'commonjs', 'systemjs', 'umd']);

program
    .option('--as [format]', `output files using various import formats instead of ES6 import and export.  Supports ${Array.from(SUPPORTED_FORMATS)}.`)
    .option('-m, --with-source-maps [type]', 'output source maps when not generating a bundled app (type may be empty for external source maps, inline for inline source maps, or both) ')
    .option('--with-app', 'process app files as well as core files')
    .parse(process.argv);

// the various important paths
var main_path = path.resolve(__dirname, '..');
var core_path = path.resolve(__dirname, '..', 'core');
var app_path = path.resolve(__dirname, '..', 'app');
var vendor_path = path.resolve(__dirname, '..', 'vendor');
var out_dir_base = path.resolve(__dirname, '..', 'build');
var lib_dir_base = path.resolve(__dirname, '..', 'lib');

// walkDir *recursively* walks directories trees,
// calling the callback for all normal files found.
var walkDir = function (base_path, cb, filter) {
    fs.readdir(base_path, (err, files) => {
        if (err) throw err;

        files.map((filename) => path.join(base_path, filename)).forEach((filepath) => {
            fs.lstat(filepath, (err, stats) => {
                if (err) throw err;

                if (filter !== undefined && !filter(filepath, stats)) return;

                if (stats.isSymbolicLink()) return;
                if (stats.isFile()) cb(filepath);
                if (stats.isDirectory()) walkDir(filepath, cb, filter);
            });
        });
    });
};

var transform_html = function (new_script) {
    // write out the modified vnc.html file that works with the bundle
    var src_html_path = path.resolve(__dirname, '..', 'vnc.html');
    var out_html_path = path.resolve(out_dir_base, 'vnc.html');
    fs.readFile(src_html_path, (err, contents_raw) => {
        if (err) { throw err; }

        var contents = contents_raw.toString();

        var start_marker = '<!-- begin scripts -->\n';
        var end_marker = '<!-- end scripts -->';
        var start_ind = contents.indexOf(start_marker) + start_marker.length;
        var end_ind = contents.indexOf(end_marker, start_ind);

        contents = contents.slice(0, start_ind) + `${new_script}\n` + contents.slice(end_ind);

        console.log(`Writing ${out_html_path}`);
        fs.writeFile(out_html_path, contents, function (err) {
            if (err) { throw err; }
        });
    });
}

var make_lib_files = function (import_format, source_maps, with_app_dir) {
    if (!import_format) {
        throw new Error("you must specify an import format to generate compiled noVNC libraries");
    } else if (!SUPPORTED_FORMATS.has(import_format)) {
        throw new Error(`unsupported output format "${import_format}" for import/export -- only ${Array.from(SUPPORTED_FORMATS)} are supported`);
    }

    // NB: we need to make a copy of babel_opts, since babel sets some defaults on it
    const babel_opts = () => ({
        plugins: [`transform-es2015-modules-${import_format}`],
        ast: false,
        sourceMaps: source_maps,
    });
    const babel = require('babel-core');

    var in_path;
    if (with_app_dir) {
        var out_path_base = out_dir_base;
        in_path = main_path;
    } else {
        var out_path_base = lib_dir_base;
    }

    fse.ensureDirSync(out_path_base);

    const helpers = require('./use_require_helpers');
    const helper = helpers[import_format];
    
    var handleDir = (js_only, in_path_base, filename) => {
        const out_path = path.join(out_path_base, path.relative(in_path_base, filename));
        if(path.extname(filename) !== '.js') {
            if (!js_only) {
                console.log(`Writing ${out_path}`);
                fse.copy(filename, out_path, (err) => { if (err) throw err; });
            }
            return;  // skip non-javascript files
        }

        fse.ensureDir(path.dirname(out_path), () => {
            const opts = babel_opts();
            if (helper && helpers.optionsOverride) {
                helper.optionsOverride(opts);
            }
            babel.transformFile(filename, babel_opts(), (err, res) => {
                console.log(`Writing ${out_path}`);
                if (err) throw err;
                var {code, map, ast} = res;
                if (source_maps === true) {
                    // append URL for external source map
                    code += `\n//# sourceMappingURL=${path.basename(out_path)}.map\n`;
                }
                fs.writeFile(out_path, code, (err) => { if (err) throw err; });
                if (source_maps === true || source_maps === 'both') {
                    console.log(`  and ${out_path}.map`);
                    fs.writeFile(`${out_path}.map`, JSON.stringify(map), (err) => { if (err) throw err; });
                }
            });
        });
    };

    walkDir(core_path, handleDir.bind(null, true, in_path || core_path));
    walkDir(vendor_path, handleDir.bind(null, true, in_path || main_path), (filepath, stats) => !((stats.isDirectory() && path.basename(filepath) === 'browser-es-module-loader') || path.basename(filepath) === 'sinon.js'));

    if (with_app_dir) {
        walkDir(app_path, handleDir.bind(null, false, in_path || app_path));

        const out_app_path = path.join(out_path_base, 'app.js');
        if (helper && helper.appWriter) {
            console.log(`Writing ${out_app_path}`);
            let out_script = helper.appWriter(out_path_base, out_app_path);
            transform_html(out_script);
        } else {
            console.error(`Unable to generate app for the ${import_format} format!`);
        }
    }
};

make_lib_files(program.as, program.withSourceMaps, program.withApp);
