// writes helpers require for vnc.html (they should output app.js)
const fs = require('fs');
const path = require('path');

// util.promisify requires Node.js 8.x, so we have our own
function promisify(original) {
    return function promise_wrap() {
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
        appWriter: (base_out_path, script_base_path, out_path) => {
            // setup for requirejs
            const ui_path = path.relative(base_out_path,
                                          path.join(script_base_path, 'app', 'ui'));
            return writeFile(out_path, `requirejs(["${ui_path}"], function (ui) {});`)
                .then(() => {
                    console.log(`Please place RequireJS in ${path.join(script_base_path, 'require.js')}`);
                    const require_path = path.relative(base_out_path,
                                                       path.join(script_base_path, 'require.js'));
                    return [ require_path ];
                });
        },
    },
    'commonjs': {
        appWriter: (base_out_path, script_base_path, out_path) => {
            const browserify = require('browserify');
            const b = browserify(path.join(script_base_path, 'app/ui.js'), {});
            return promisify(b.bundle).call(b)
                .then(buf => writeFile(out_path, buf))
                .then(() => []);
        },
        removeModules: true,
    },
    'systemjs': {
        appWriter: (base_out_path, script_base_path, out_path) => {
            const ui_path = path.relative(base_out_path,
                                          path.join(script_base_path, 'app', 'ui.js'));
            return writeFile(out_path, `SystemJS.import("${ui_path}");`)
                .then(() => {
                    console.log(`Please place SystemJS in ${path.join(script_base_path, 'system-production.js')}`);
                    const systemjs_path = path.relative(base_out_path,
                                                        path.join(script_base_path, 'system-production.js'));
                    return [ systemjs_path ];
                });
        },
    },
    'umd': {
    },
};
