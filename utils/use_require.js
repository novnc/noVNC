#!/usr/bin/env node

const path = require('path');
const program = require('commander');
const fs = require('fs');
const fse = require('fs-extra');
const babel = require('@babel/core');

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
    outDirBase: path.resolve(__dirname, '..', 'build'),
    libDirBase: path.resolve(__dirname, '..', 'lib'),
};

const noCopyFiles = new Set([
    // skip these -- they don't belong in the processed application
    path.join(paths.vendor, 'sinon.js'),
    path.join(paths.vendor, 'browser-es-module-loader'),
    path.join(paths.app, 'images', 'icons', 'Makefile'),
]);

const onlyLegacyScripts = new Set([
    path.join(paths.vendor, 'promise.js'),
]);

const noTransformFiles = new Set([
    // don't transform this -- we want it imported as-is to properly catch loading errors
    path.join(paths.app, 'error-handler.js'),
]);

noCopyFiles.forEach(file => noTransformFiles.add(file));

// util.promisify requires Node.js 8.x, so we have our own
function promisify(original) {
    return function promiseWrap() {
        const args = Array.prototype.slice.call(arguments);
        return new Promise((resolve, reject) => {
            original.apply(this, args.concat((err, value) => {
                if (err) return reject(err);
                resolve(value);
            }));
        });
    };
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
function walkDir(basePath, cb, filter) {
    return readdir(basePath)
        .then((files) => {
            const paths = files.map(filename => path.join(basePath, filename));
            return Promise.all(paths.map(filepath => lstat(filepath)
                .then((stats) => {
                    if (filter !== undefined && !filter(filepath, stats)) return;

                    if (stats.isSymbolicLink()) return;
                    if (stats.isFile()) return cb(filepath);
                    if (stats.isDirectory()) return walkDir(filepath, cb, filter);
                })));
        });
}

function transformHtml(legacyScripts, onlyLegacy) {
    // write out the modified vnc.html file that works with the bundle
    const srcHtmlPath = path.resolve(__dirname, '..', 'vnc.html');
    const outHtmlPath = path.resolve(paths.outDirBase, 'vnc.html');
    return readFile(srcHtmlPath)
        .then((contentsRaw) => {
            let contents = contentsRaw.toString();

            const startMarker = '<!-- begin scripts -->\n';
            const endMarker = '<!-- end scripts -->';
            const startInd = contents.indexOf(startMarker) + startMarker.length;
            const endInd = contents.indexOf(endMarker, startInd);

            let newScript = '';

            if (onlyLegacy) {
            // Only legacy version, so include things directly
                for (let i = 0;i < legacyScripts.length;i++) {
                    newScript += `    <script src="${legacyScripts[i]}"></script>\n`;
                }
            } else {
                // Otherwise include both modules and legacy fallbacks
                newScript += '    <script type="module" crossorigin="anonymous" src="app/ui.js"></script>\n';
                for (let i = 0;i < legacyScripts.length;i++) {
                    newScript += `    <script nomodule src="${legacyScripts[i]}"></script>\n`;
                }
            }

            contents = contents.slice(0, startInd) + `${newScript}\n` + contents.slice(endInd);

            return contents;
        })
        .then((contents) => {
            console.log(`Writing ${outHtmlPath}`);
            return writeFile(outHtmlPath, contents);
        });
}

function makeLibFiles(importFormat, sourceMaps, withAppDir, onlyLegacy) {
    if (!importFormat) {
        throw new Error("you must specify an import format to generate compiled noVNC libraries");
    } else if (!SUPPORTED_FORMATS.has(importFormat)) {
        throw new Error(`unsupported output format "${importFormat}" for import/export -- only ${Array.from(SUPPORTED_FORMATS)} are supported`);
    }

    // NB: we need to make a copy of babelOpts, since babel sets some defaults on it
    const babelOpts = () => ({
        plugins: [],
        presets: [
            [ '@babel/preset-env',
              { targets: 'ie >= 11',
                modules: importFormat } ]
        ],
        ast: false,
        sourceMaps: sourceMaps,
    });

    // No point in duplicate files without the app, so force only converted files
    if (!withAppDir) {
        onlyLegacy = true;
    }

    let inPath;
    let outPathBase;
    if (withAppDir) {
        outPathBase = paths.outDirBase;
        inPath = paths.main;
    } else {
        outPathBase = paths.libDirBase;
    }
    const legacyPathBase = onlyLegacy ? outPathBase : path.join(outPathBase, 'legacy');

    fse.ensureDirSync(outPathBase);

    const helpers = require('./use_require_helpers');
    const helper = helpers[importFormat];

    const outFiles = [];
    const legacyFiles = [];

    const handleDir = (jsOnly, vendorRewrite, inPathBase, filename) => Promise.resolve()
        .then(() => {
            const outPath = path.join(outPathBase, path.relative(inPathBase, filename));
            const legacyPath = path.join(legacyPathBase, path.relative(inPathBase, filename));

            if (path.extname(filename) !== '.js') {
                if (!jsOnly) {
                    console.log(`Writing ${outPath}`);
                    return copy(filename, outPath);
                }
                return;  // skip non-javascript files
            }

            if (noTransformFiles.has(filename)) {
                return ensureDir(path.dirname(outPath))
                    .then(() => {
                        console.log(`Writing ${outPath}`);
                        return copy(filename, outPath);
                    });
            }

            if (onlyLegacyScripts.has(filename)) {
                legacyFiles.push(legacyPath);
                return ensureDir(path.dirname(legacyPath))
                    .then(() => {
                        console.log(`Writing ${legacyPath}`);
                        return copy(filename, legacyPath);
                    });
            }

            return Promise.resolve()
                .then(() => {
                    if (onlyLegacy) {
                        return;
                    }
                    return ensureDir(path.dirname(outPath))
                        .then(() => {
                            console.log(`Writing ${outPath}`);
                            return copy(filename, outPath);
                        });
                })
                .then(() => ensureDir(path.dirname(legacyPath)))
                .then(() => {
                    const opts = babelOpts();
                    if (helper && helpers.optionsOverride) {
                        helper.optionsOverride(opts);
                    }
            // Adjust for the fact that we move the core files relative
            // to the vendor directory
                    if (vendorRewrite) {
                        opts.plugins.push(["import-redirect",
                                           {"root": legacyPathBase,
                                            "redirect": { "vendor/(.+)": "./vendor/$1"}}]);
                    }

                    return babelTransformFile(filename, opts)
                        .then((res) => {
                            console.log(`Writing ${legacyPath}`);
                            const {map} = res;
                            let {code} = res;
                            if (sourceMaps === true) {
                    // append URL for external source map
                                code += `\n//# sourceMappingURL=${path.basename(legacyPath)}.map\n`;
                            }
                            outFiles.push(`${legacyPath}`);
                            return writeFile(legacyPath, code)
                                .then(() => {
                                    if (sourceMaps === true || sourceMaps === 'both') {
                                        console.log(`  and ${legacyPath}.map`);
                                        outFiles.push(`${legacyPath}.map`);
                                        return writeFile(`${legacyPath}.map`, JSON.stringify(map));
                                    }
                                });
                        });
                });
        });

    Promise.resolve()
        .then(() => {
            const handler = handleDir.bind(null, true, false, inPath || paths.main);
            const filter = (filename, stats) => !noCopyFiles.has(filename);
            return walkDir(paths.vendor, handler, filter);
        })
        .then(() => {
            const handler = handleDir.bind(null, true, !inPath, inPath || paths.core);
            const filter = (filename, stats) => !noCopyFiles.has(filename);
            return walkDir(paths.core, handler, filter);
        })
        .then(() => {
            if (!withAppDir) return;
            const handler = handleDir.bind(null, false, false, inPath);
            const filter = (filename, stats) => !noCopyFiles.has(filename);
            return walkDir(paths.app, handler, filter);
        })
        .then(() => {
            if (!withAppDir) return;

            if (!helper || !helper.appWriter) {
                throw new Error(`Unable to generate app for the ${importFormat} format!`);
            }

            const outAppPath = path.join(legacyPathBase, 'app.js');
            console.log(`Writing ${outAppPath}`);
            return helper.appWriter(outPathBase, legacyPathBase, outAppPath)
                .then((extraScripts) => {
                    let legacyScripts = [];

                    legacyFiles.forEach((file) => {
                        let relFilePath = path.relative(outPathBase, file);
                        legacyScripts.push(relFilePath);
                    });

                    legacyScripts = legacyScripts.concat(extraScripts);

                    let relAppPath = path.relative(outPathBase, outAppPath);
                    legacyScripts.push(relAppPath);

                    transformHtml(legacyScripts, onlyLegacy);
                })
                .then(() => {
                    if (!helper.removeModules) return;
                    console.log(`Cleaning up temporary files...`);
                    return Promise.all(outFiles.map((filepath) => {
                        unlink(filepath)
                            .then(() => {
                                // Try to clean up any empty directories if
                                // this was the last file in there
                                const rmdirR = dir =>
                                    rmdir(dir)
                                        .then(() => rmdirR(path.dirname(dir)))
                                        .catch(() => {
                                // Assume the error was ENOTEMPTY and ignore it
                                        });
                                return rmdirR(path.dirname(filepath));
                            });
                    }));
                });
        })
        .catch((err) => {
            console.error(`Failure converting modules: ${err}`);
            process.exit(1);
        });
}

if (program.clean) {
    console.log(`Removing ${paths.libDirBase}`);
    fse.removeSync(paths.libDirBase);

    console.log(`Removing ${paths.outDirBase}`);
    fse.removeSync(paths.outDirBase);
}

makeLibFiles(program.as, program.withSourceMaps, program.withApp, program.onlyLegacy);
