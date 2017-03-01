// writes helpers require for vnc.html (they should output app.js)
var fs = require('fs');
var fse = require('fs-extra');
var path = require('path');

module.exports = {
    'amd': {
        appWriter: (base_out_path, out_path) => {
            // setup for requirejs
            fs.writeFile(out_path, 'requirejs(["app/ui"], function (ui) {});', (err) => { if (err) throw err; });
            console.log(`Please place RequireJS in ${path.join(base_out_path, 'require.js')}`);
            return `<script src="require.js" data-main="${path.relative(base_out_path, out_path)}"></script>`;
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
            b.bundle().pipe(fs.createWriteStream(out_path));
            return `<script src="${path.relative(base_out_path, out_path)}"></script>`;
        },
        noCopyOverride: () => {},
    },
    'systemjs': {
        appWriter: (base_out_path, out_path) => {
            fs.writeFile(out_path, 'SystemJS.import("./app/ui.js");', (err) => { if (err) throw err; });
            console.log(`Please place SystemJS in ${path.join(base_out_path, 'system-production.js')}`);
            return `<script src="vendor/promise.js"></script>
<script src="system-production.js"></script>\n<script src="${path.relative(base_out_path, out_path)}"></script>`;
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
