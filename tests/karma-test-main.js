var TEST_REGEXP = /test\..*\.js/;
var allTestFiles = [];
var extraFiles = ['/base/tests/assertions.js'];

Object.keys(window.__karma__.files).forEach(function (file) {
    if (TEST_REGEXP.test(file)) {
        // TODO: normalize?
        allTestFiles.push(file);
    }
});

require.config({
    baseUrl: '/base',
    deps: allTestFiles.concat(extraFiles),
    callback: window.__karma__.start,
});
