// writes helpers require for vnc.html (they should output app.js)
var fs = require('fs');
var fse = require('fs-extra');
var path = require('path');

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

const writeFile = promisify(fs.writeFile);

module.exports = {
    'amd': {
        appWriter: (base_out_path, out_path) => {
            // setup for requirejs
            return writeFile(out_path, 'requirejs(["app/ui"], function (ui) {});')
            .then(() => {
                console.log(`Please place RequireJS in ${path.join(base_out_path, 'require.js')}`);
                return `<script src="require.js" data-main="${path.relative(base_out_path, out_path)}"></script>`;
            });
        },
        noCopyOverride: () => {},
    },
    'commonjs': {
        optionsOverride: (opts) => {   
            // CommonJS supports properly shifting the default export to work as normal
            opts.plugins.unshift("add-module-exports");
        },
        appWriter: (base_out_path, out_path) => {
            var browserify = require('browserify');
            var b = browserify(path.join(base_out_path, 'app/ui.js'), {});
            return promisify(b.bundle).call(b)
            .then((buf) => writeFile(out_path, buf))
            .then(() => `<script src="${path.relative(base_out_path, out_path)}"></script>`);
        },
        noCopyOverride: () => {},
        removeModules: true,
    },
    'systemjs': {
        appWriter: (base_out_path, out_path) => {
            return writeFile(out_path, 'SystemJS.import("./app/ui.js");')
            .then(() => {
                console.log(`Please place SystemJS in ${path.join(base_out_path, 'system-production.js')}`);
                return `<script src="vendor/promise.js"></script>
<script src="system-production.js"></script>\n<script src="${path.relative(base_out_path, out_path)}"></script>`;
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
