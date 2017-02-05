var TEST_REGEXP = /test\..*\.js/;
var allTestFiles = [];

Object.keys(window.__karma__.files).forEach(function (file) {
    if (TEST_REGEXP.test(file)) {
        // TODO: normalize?
        allTestFiles.push(file);
    }
});

require.config({
    baseUrl: '/base',
    deps: allTestFiles,
    callback: window.__karma__.start,
    paths: {
        'sinon': 'vendor/sinon',
    },
});
