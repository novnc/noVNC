#!/usr/bin/env node

const path = require('path');
const program = require('commander');
const fs = require('fs');
const fse = require('fs-extra');
const babel = require('babel-core');

const SUPPORTED_FORMATS = new Set(['amd', 'commonjs', 'systemjs', 'umd']);

program
    .option('--as [format]', `output files using various import formats instead of ES6 import and export.  Supports ${Array.from(SUPPORTED_FORMATS)}.`)
    .option('-m, --with-source-maps [type]', 'output source maps when not generating a bundled app (type may be empty for external source maps, inline for inline source maps, or both) ')
    .option('--with-app', 'process app files as well as core files')
    .option('--only-legacy', 'only output legacy files (no ES6 modules) for the app')
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
    path.join(paths.app, 'images', 'icons', 'Makefile'),
]);

const no_transform_files = new Set([
    // don't transform this -- we want it imported as-is to properly catch loading errors
    path.join(paths.app, 'error-handler.js'),
]);

no_copy_files.forEach((file) => no_transform_files.add(file));

// util.promisify requires Node.js 8.x, so we have our own
function promisify(original) {
    return function () {
        const obj = this;
        const args = Array.prototype.slice.call(arguments);
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
const unlink = promisify(fse.unlink);
const ensureDir = promisify(fse.ensureDir);
const rmdir = promisify(fse.rmdir);

const babelTransformFile = promisify(babel.transformFile);

// walkDir *recursively* walks directories trees,
// calling the callback for all normal files found.
const walkDir = function (base_path, cb, filter) {
    return readdir(base_path)
    .then(files => {
        const paths = files.map(filename => path.join(base_path, filename));
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

const transform_html = function (legacy_scripts, only_legacy) {
    // write out the modified vnc.html file that works with the bundle
    const src_html_path = path.resolve(__dirname, '..', 'vnc.html');
    const out_html_path = path.resolve(paths.out_dir_base, 'vnc.html');
    return readFile(src_html_path)
    .then(contents_raw => {
        let contents = contents_raw.toString();

        const start_marker = '<!-- begin scripts -->\n';
        const end_marker = '<!-- end scripts -->';
        const start_ind = contents.indexOf(start_marker) + start_marker.length;
        const end_ind = contents.indexOf(end_marker, start_ind);

        let new_script = '';

        if (only_legacy) {
            // Only legacy version, so include things directly
            for (let i = 0;i < legacy_scripts.length;i++) {
                new_script += `    <script src="${legacy_scripts[i]}"></script>\n`;
            }
        } else {
            // Otherwise detect if it's a modern browser and select
            // variant accordingly
            new_script += `\
    <script type="module">\n\
        window._noVNC_has_module_support = true;\n\
    </script>\n\
    <script>\n\
        window.addEventListener("load", function() {\n\
            if (window._noVNC_has_module_support) return;\n\
            let legacy_scripts = ${JSON.stringify(legacy_scripts)};\n\
            for (let i = 0;i < legacy_scripts.length;i++) {\n\
                let script = document.createElement("script");\n\
                script.src = legacy_scripts[i];\n\
                script.async = false;\n\
                document.head.appendChild(script);\n\
            }\n\
        });\n\
    </script>\n`;

            // Original, ES6 modules
            new_script += '    <script type="module" crossorigin="anonymous" src="app/ui.js"></script>\n';
        }

        contents = contents.slice(0, start_ind) + `${new_script}\n` + contents.slice(end_ind);

        return contents;
    })
    .then((contents) => {
        console.log(`Writing ${out_html_path}`);
        return writeFile(out_html_path, contents);
    });
}

const make_lib_files = function (import_format, source_maps, with_app_dir, only_legacy) {
    if (!import_format) {
        throw new Error("you must specify an import format to generate compiled noVNC libraries");
    } else if (!SUPPORTED_FORMATS.has(import_format)) {
        throw new Error(`unsupported output format "${import_format}" for import/export -- only ${Array.from(SUPPORTED_FORMATS)} are supported`);
    }

    // NB: we need to make a copy of babel_opts, since babel sets some defaults on it
    const babel_opts = () => ({
        plugins: [`transform-es2015-modules-${import_format}`],
        presets: ['es2015'],
        ast: false,
        sourceMaps: source_maps,
    });

    // No point in duplicate files without the app, so force only converted files
    if (!with_app_dir) {
        only_legacy = true;
    }

    let in_path;
    let out_path_base;
    if (with_app_dir) {
        out_path_base = paths.out_dir_base;
        in_path = paths.main;
    } else {
        out_path_base = paths.lib_dir_base;
    }
    const legacy_path_base = only_legacy ? out_path_base : path.join(out_path_base, 'legacy');

    fse.ensureDirSync(out_path_base);

    const helpers = require('./use_require_helpers');
    const helper = helpers[import_format];

    const outFiles = [];

    const handleDir = (js_only, vendor_rewrite, in_path_base, filename) => Promise.resolve()
    .then(() => {
        if (no_copy_files.has(filename)) return;

        const out_path = path.join(out_path_base, path.relative(in_path_base, filename));
        const legacy_path = path.join(legacy_path_base, path.relative(in_path_base, filename));

        if(path.extname(filename) !== '.js') {
            if (!js_only) {
                console.log(`Writing ${out_path}`);
                return copy(filename, out_path);
            }
            return;  // skip non-javascript files
        }

        return Promise.resolve()
        .then(() => {
            if (only_legacy && !no_transform_files.has(filename)) {
                return;
            }
            return ensureDir(path.dirname(out_path))
            .then(() => {
                console.log(`Writing ${out_path}`);
                return copy(filename, out_path);
            })
        })
        .then(() => ensureDir(path.dirname(legacy_path)))
        .then(() => {
            if (no_transform_files.has(filename)) {
                return;
            }

            const opts = babel_opts();
            if (helper && helpers.optionsOverride) {
                helper.optionsOverride(opts);
            }
            // Adjust for the fact that we move the core files relative
            // to the vendor directory
            if (vendor_rewrite) {
                opts.plugins.push(["import-redirect",
                                   {"root": legacy_path_base,
                                    "redirect": { "vendor/(.+)": "./vendor/$1"}}]);
            }

            return babelTransformFile(filename, opts)
            .then(res => {
                console.log(`Writing ${legacy_path}`);
                const {map} = res;
                let {code} = res;
                if (source_maps === true) {
                    // append URL for external source map
                    code += `\n//# sourceMappingURL=${path.basename(legacy_path)}.map\n`;
                }
                outFiles.push(`${legacy_path}`);
                return writeFile(legacy_path, code)
                .then(() => {
                    if (source_maps === true || source_maps === 'both') {
                        console.log(`  and ${legacy_path}.map`);
                        outFiles.push(`${legacy_path}.map`);
                        return writeFile(`${legacy_path}.map`, JSON.stringify(map));
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
        const handler = handleDir.bind(null, true, false, in_path || paths.main);
        const filter = (filename, stats) => !no_copy_files.has(filename);
        return walkDir(paths.vendor, handler, filter);
    })
    .then(() => {
        const handler = handleDir.bind(null, true, !in_path, in_path || paths.core);
        const filter = (filename, stats) => !no_copy_files.has(filename);
        return walkDir(paths.core, handler, filter);
    })
    .then(() => {
        if (!with_app_dir) return;
        const handler = handleDir.bind(null, false, false, in_path);
        const filter = (filename, stats) => !no_copy_files.has(filename);
        return walkDir(paths.app, handler, filter);
    })
    .then(() => {
        if (!with_app_dir) return;

        if (!helper || !helper.appWriter) {
            throw new Error(`Unable to generate app for the ${import_format} format!`);
        }

        const out_app_path = path.join(legacy_path_base, 'app.js');
        console.log(`Writing ${out_app_path}`);
        return helper.appWriter(out_path_base, legacy_path_base, out_app_path)
        .then(extra_scripts => {
            const rel_app_path = path.relative(out_path_base, out_app_path);
            const legacy_scripts = extra_scripts.concat([rel_app_path]);
            transform_html(legacy_scripts, only_legacy);
        })
        .then(() => {
            if (!helper.removeModules) return;
            console.log(`Cleaning up temporary files...`);
            return Promise.all(outFiles.map(filepath => {
                unlink(filepath)
                .then(() => {
                    // Try to clean up any empty directories if this
                    // was the last file in there
                    const rmdir_r = dir => {
                        return rmdir(dir)
                        .then(() => rmdir_r(path.dirname(dir)))
                        .catch(() => {
                            // Assume the error was ENOTEMPTY and ignore it
                        });
                    };
                    return rmdir_r(path.dirname(filepath));
                });
            }));
        });
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

make_lib_files(program.as, program.withSourceMaps, program.withApp, program.onlyLegacy);
