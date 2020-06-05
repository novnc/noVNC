// writes helpers require for vnc.html (they should output app.js)
const fs = require('fs');
const path = require('path');

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

module.exports = {
    'amd': {
        appWriter: (baseOutPath, scriptBasePath, outPath) => {
            // setup for requirejs
            const uiPath = path.relative(baseOutPath,
                                         path.join(scriptBasePath, 'app', 'ui'));
            return writeFile(outPath, `requirejs(["${uiPath}"], function (ui) {});`)
                .then(() => {
                    console.log(`Please place RequireJS in ${path.join(scriptBasePath, 'require.js')}`);
                    const requirePath = path.relative(baseOutPath,
                                                      path.join(scriptBasePath, 'require.js'));
                    return [ requirePath ];
                });
        },
    },
    'commonjs': {
        appWriter: (baseOutPath, scriptBasePath, outPath) => {
            const browserify = require('browserify');
            const b = browserify(path.join(scriptBasePath, 'app/ui.js'), {});
            return promisify(b.bundle).call(b)
                .then(buf => writeFile(outPath, buf))
                .then(() => []);
        },
        removeModules: true,
    },
    'systemjs': {
        appWriter: (baseOutPath, scriptBasePath, outPath) => {
            const uiPath = path.relative(baseOutPath,
                                         path.join(scriptBasePath, 'app', 'ui.js'));
            return writeFile(outPath, `SystemJS.import("${uiPath}");`)
                .then(() => {
                    console.log(`Please place SystemJS in ${path.join(scriptBasePath, 'system-production.js')}`);
                    const systemjsPath = path.relative(baseOutPath,
                                                       path.join(scriptBasePath, 'system-production.js'));
                    return [ systemjsPath ];
                });
        },
    },
    'umd': {
    },
};
