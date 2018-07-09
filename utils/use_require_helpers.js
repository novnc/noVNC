// writes helpers require for vnc.html (they should output app.js)
const fs = require('fs');
const path = require('path');

// util.promisify requires Node.js 8.x, so we have our own
function promisify(original) {
    return function () {
        const args = Array.prototype.slice.call(arguments);
        return new Promise((resolve, reject) => {
            original.apply(this, args.concat((err, value) => {
                if (err) return reject(err);
                resolve(value);
            }));
        });
    }
}

const writeFile = promisify(fs.writeFile);

module.exports = {
    'amd': {
        appWriter: (base_out_path, script_base_path, out_path) => {
            // setup for requirejs
            const ui_path = path.relative(base_out_path,
                                        path.join(script_base_path, 'app', 'ui'));
            return writeFile(out_path, `requirejs(["${ui_path}"], (ui) => {});`)
            .then(() => {
                console.log(`Please place RequireJS in ${path.join(script_base_path, 'require.js')}`);
                const require_path = path.relative(base_out_path,
                                                 path.join(script_base_path, 'require.js'))
                return [ require_path ];
            });
        },
        noCopyOverride: () => {},
    },
    'commonjs': {
        optionsOverride: (opts) => {   
            // CommonJS supports properly shifting the default export to work as normal
            opts.plugins.unshift("add-module-exports");
        },
        appWriter: (base_out_path, script_base_path, out_path) => {
            const browserify = require('browserify');
            const b = browserify(path.join(script_base_path, 'app/ui.js'), {});
            return promisify(b.bundle).call(b)
            .then(buf => writeFile(out_path, buf))
            .then(() => []);
        },
        noCopyOverride: () => {},
        removeModules: true,
    },
    'systemjs': {
        appWriter: (base_out_path, script_base_path, out_path) => {
            const ui_path = path.relative(base_out_path,
                                        path.join(script_base_path, 'app', 'ui.js'));
            return writeFile(out_path, `SystemJS.import("${ui_path}");`)
            .then(() => {
                console.log(`Please place SystemJS in ${path.join(script_base_path, 'system-production.js')}`);
                // FIXME: Should probably be in the legacy directory
                const promise_path = path.relative(base_out_path,
                                                 path.join(base_out_path, 'vendor', 'promise.js'))
                const systemjs_path = path.relative(base_out_path,
                                                  path.join(script_base_path, 'system-production.js'))
                return [ promise_path, systemjs_path ];
            });
        },
        noCopyOverride: (paths, no_copy_files) => {
            no_copy_files.delete(path.join(paths.vendor, 'promise.js'));
        },
    },
    'umd': {
        optionsOverride: (opts) => {   
            // umd supports properly shifting the default export to work as normal
            opts.plugins.unshift("add-module-exports");
        },
    },
}
