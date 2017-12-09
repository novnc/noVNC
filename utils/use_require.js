#!/usr/bin/env node

var path = require('path');
var program = require('commander');
var fs = require('fs');
var fse = require('fs-extra');
var babel = require('babel-core');

const SUPPORTED_FORMATS = new Set(['amd', 'commonjs', 'systemjs', 'umd']);

program
    .option('--as [format]', `output files using various import formats instead of ES6 import and export.  Supports ${Array.from(SUPPORTED_FORMATS)}.`)
    .option('-m, --with-source-maps [type]', 'output source maps when not generating a bundled app (type may be empty for external source maps, inline for inline source maps, or both) ')
    .option('--with-app', 'process app files as well as core files')
    .option('--clean', 'clear the lib folder before building')
    .parse(process.argv);

// the various important paths
const paths = {
    main: path.resolve(__dirname, '..'),
    core: path.resolve(__dirname, '..', 'core'),
    app: path.resolve(__dirname, '..', 'app'),
    vendor: path.resolve(__dirname, '..', 'vendor'),
    out_dir_base: path.resolve(__dirname, '..', 'build'),
    lib_dir_base: path.resolve(__dirname, '..', 'lib'),
};

const no_copy_files = new Set([
    // skip these -- they don't belong in the processed application
    path.join(paths.vendor, 'sinon.js'),
    path.join(paths.vendor, 'browser-es-module-loader'),
    path.join(paths.vendor, 'promise.js'),
]);

const no_transform_files = new Set([
    // don't transform this -- we want it imported as-is to properly catch loading errors
    path.join(paths.app, 'error-handler.js'),
]);

no_copy_files.forEach((file) => no_transform_files.add(file));

// util.promisify requires Node.js 8.x, so we have our own
function promisify(original) {
    return function () {
        let obj = this;
        let args = Array.prototype.slice.call(arguments);
        return new Promise((resolve, reject) => {
            original.apply(obj, args.concat((err, value) => {
                if (err) return reject(err);
                resolve(value);
            }));
        });
    }
}

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

const readdir = promisify(fs.readdir);
const lstat = promisify(fs.lstat);

const copy = promisify(fse.copy);
const ensureDir = promisify(fse.ensureDir);

const babelTransformFile = promisify(babel.transformFile);

// walkDir *recursively* walks directories trees,
// calling the callback for all normal files found.
var walkDir = function (base_path, cb, filter) {
    return readdir(base_path)
    .then(files => {
        let paths = files.map(filename => path.join(base_path, filename));
        return Promise.all(paths.map((filepath) => {
            return lstat(filepath)
            .then(stats => {
                if (filter !== undefined && !filter(filepath, stats)) return;

                if (stats.isSymbolicLink()) return;
                if (stats.isFile()) return cb(filepath);
                if (stats.isDirectory()) return walkDir(filepath, cb, filter);
            });
        }));
    });
};

var transform_html = function (new_script) {
    // write out the modified vnc.html file that works with the bundle
    var src_html_path = path.resolve(__dirname, '..', 'vnc.html');
    var out_html_path = path.resolve(paths.out_dir_base, 'vnc.html');
    return readFile(src_html_path)
    .then(contents_raw => {
        var contents = contents_raw.toString();

        var start_marker = '<!-- begin scripts -->\n';
        var end_marker = '<!-- end scripts -->';
        var start_ind = contents.indexOf(start_marker) + start_marker.length;
        var end_ind = contents.indexOf(end_marker, start_ind);

        contents = contents.slice(0, start_ind) + `${new_script}\n` + contents.slice(end_ind);

        return contents;
    })
    .then((contents) => {
        console.log(`Writing ${out_html_path}`);
        return writeFile(out_html_path, contents);
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

    var in_path;
    if (with_app_dir) {
        var out_path_base = paths.out_dir_base;
        in_path = paths.main;
    } else {
        var out_path_base = paths.lib_dir_base;
    }

    fse.ensureDirSync(out_path_base);

    const helpers = require('./use_require_helpers');
    const helper = helpers[import_format];

    var handleDir = (js_only, vendor_rewrite, in_path_base, filename) => Promise.resolve()
    .then(() => {
        if (no_copy_files.has(filename)) return;

        const out_path = path.join(out_path_base, path.relative(in_path_base, filename));
        if(path.extname(filename) !== '.js') {
            if (!js_only) {
                console.log(`Writing ${out_path}`);
                return copy(filename, out_path);
            }
            return;  // skip non-javascript files
        }

        return ensureDir(path.dirname(out_path))
        .then(() => {
            if (no_transform_files.has(filename)) {
                console.log(`Writing ${out_path}`);
                return copy(filename, out_path);
            }

            const opts = babel_opts();
            if (helper && helpers.optionsOverride) {
                helper.optionsOverride(opts);
            }
            // Adjust for the fact that we move the core files relative
            // to the vendor directory
            if (vendor_rewrite) {
                opts.plugins.push(["import-redirect",
                                   {"root": out_path_base,
                                    "redirect": { "vendor/(.+)": "./vendor/$1"}}]);
            }

            return babelTransformFile(filename, opts)
            .then(res => {
                console.log(`Writing ${out_path}`);
                var {code, map, ast} = res;
                if (source_maps === true) {
                    // append URL for external source map
                    code += `\n//# sourceMappingURL=${path.basename(out_path)}.map\n`;
                }
                return writeFile(out_path, code)
                .then(() => {
                    if (source_maps === true || source_maps === 'both') {
                        console.log(`  and ${out_path}.map`);
                        return writeFile(`${out_path}.map`, JSON.stringify(map));
                    }
                });
            });
        });
    });

    if (with_app_dir && helper && helper.noCopyOverride) {
        helper.noCopyOverride(paths, no_copy_files);
    }

    Promise.resolve()
    .then(() => {
        let handler = handleDir.bind(null, true, false, in_path || paths.main);
        let filter = (filename, stats) => !no_copy_files.has(filename);
        return walkDir(paths.vendor, handler, filter);
    })
    .then(() => {
        let handler = handleDir.bind(null, true, !in_path, in_path || paths.core);
        let filter = (filename, stats) => !no_copy_files.has(filename);
        return walkDir(paths.core, handler, filter);
    })
    .then(() => {
        if (!with_app_dir) return;
        let handler = handleDir.bind(null, false, false, in_path);
        let filter = (filename, stats) => !no_copy_files.has(filename);
        return walkDir(paths.app, handler, filter);
    })
    .then(() => {
        if (!with_app_dir) return;

        if (!helper || !helper.appWriter) {
            throw new Error(`Unable to generate app for the ${import_format} format!`);
        }

        const out_app_path = path.join(out_path_base, 'app.js');
        console.log(`Writing ${out_app_path}`);
        return helper.appWriter(out_path_base, out_app_path)
        .then(transform_html);
    })
    .catch((err) => {
        console.error(`Failure converting modules: ${err}`);
        process.exit(1);
    });
};

if (program.clean) {
    console.log(`Removing ${paths.lib_dir_base}`);
    fse.removeSync(paths.lib_dir_base);

    console.log(`Removing ${paths.out_dir_base}`);
    fse.removeSync(paths.out_dir_base);
}

make_lib_files(program.as, program.withSourceMaps, program.withApp);
