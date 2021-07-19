#!/usr/bin/env node

const path = require('path');
const program = require('commander');
const fs = require('fs');
const fse = require('fs-extra');
const babel = require('@babel/core');

program
    .option('-m, --with-source-maps [type]', 'output source maps when not generating a bundled app (type may be empty for external source maps, inline for inline source maps, or both) ')
    .option('--clean', 'clear the lib folder before building')
    .parse(process.argv);

// the various important paths
const paths = {
    main: path.resolve(__dirname, '..'),
    core: path.resolve(__dirname, '..', 'core'),
    vendor: path.resolve(__dirname, '..', 'vendor'),
    libDirBase: path.resolve(__dirname, '..', 'lib'),
};

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

const writeFile = promisify(fs.writeFile);

const readdir = promisify(fs.readdir);
const lstat = promisify(fs.lstat);

const ensureDir = promisify(fse.ensureDir);

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

function makeLibFiles(sourceMaps) {
    // NB: we need to make a copy of babelOpts, since babel sets some defaults on it
    const babelOpts = () => ({
        plugins: [],
        presets: [
            [ '@babel/preset-env',
              { modules: 'commonjs' } ]
        ],
        ast: false,
        sourceMaps: sourceMaps,
    });

    fse.ensureDirSync(paths.libDirBase);

    const outFiles = [];

    const handleDir = (vendorRewrite, inPathBase, filename) => Promise.resolve()
        .then(() => {
            const outPath = path.join(paths.libDirBase, path.relative(inPathBase, filename));

            if (path.extname(filename) !== '.js') {
                return;  // skip non-javascript files
            }
            return Promise.resolve()
                .then(() => ensureDir(path.dirname(outPath)))
                .then(() => {
                    const opts = babelOpts();
            // Adjust for the fact that we move the core files relative
            // to the vendor directory
                    if (vendorRewrite) {
                        opts.plugins.push(["import-redirect",
                                           {"root": paths.libDirBase,
                                            "redirect": { "vendor/(.+)": "./vendor/$1"}}]);
                    }

                    return babelTransformFile(filename, opts)
                        .then((res) => {
                            console.log(`Writing ${outPath}`);
                            const {map} = res;
                            let {code} = res;
                            if (sourceMaps === true) {
                    // append URL for external source map
                                code += `\n//# sourceMappingURL=${path.basename(outPath)}.map\n`;
                            }
                            outFiles.push(`${outPath}`);
                            return writeFile(outPath, code)
                                .then(() => {
                                    if (sourceMaps === true || sourceMaps === 'both') {
                                        console.log(`  and ${outPath}.map`);
                                        outFiles.push(`${outPath}.map`);
                                        return writeFile(`${outPath}.map`, JSON.stringify(map));
                                    }
                                });
                        });
                });
        });

    Promise.resolve()
        .then(() => {
            const handler = handleDir.bind(null, false, paths.main);
            return walkDir(paths.vendor, handler);
        })
        .then(() => {
            const handler = handleDir.bind(null, true, paths.core);
            return walkDir(paths.core, handler);
        })
        .catch((err) => {
            console.error(`Failure converting modules: ${err}`);
            process.exit(1);
        });
}

if (program.clean) {
    console.log(`Removing ${paths.libDirBase}`);
    fse.removeSync(paths.libDirBase);
}

makeLibFiles(program.withSourceMaps);
