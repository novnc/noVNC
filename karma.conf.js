// Karma configuration

// The Safari launcher is broken, so construct our own
function SafariBrowser(id, baseBrowserDecorator, args) {
  baseBrowserDecorator(this);

  this._start = function(url) {
    this._execCommand('/usr/bin/open', ['-W', '-n', '-a', 'Safari', url]);
  }
}

SafariBrowser.prototype = {
  name: 'Safari'
}

module.exports = (config) => {
  let browsers = [];

  if (process.env.TEST_BROWSER_NAME) {
    browsers = process.env.TEST_BROWSER_NAME.split(',');
  }

  const my_conf = {

    // base path that will be used to resolve all patterns (eg. files, exclude)
    basePath: '',

    // frameworks to use
    // available frameworks: https://npmjs.org/browse/keyword/karma-adapter
    frameworks: ['mocha', 'sinon-chai'],

    // list of files / patterns to load in the browser (loaded in order)
    files: [
      { pattern: 'app/localization.js', included: false },
      { pattern: 'app/webutil.js', included: false },
      { pattern: 'core/**/*.js', included: false },
      { pattern: 'vendor/pako/**/*.js', included: false },
      { pattern: 'vendor/browser-es-module-loader/dist/*.js*', included: false },
      { pattern: 'tests/test.*.js', included: false },
      { pattern: 'tests/fake.*.js', included: false },
      { pattern: 'tests/assertions.js', included: false },
      'vendor/promise.js',
      'tests/karma-test-main.js',
    ],

    client: {
      mocha: {
        // replace Karma debug page with mocha display
        'reporter': 'html',
        'ui': 'bdd'
      }
    },

    // list of files to exclude
    exclude: [
    ],

    plugins: [
      'karma-*',
      '@chiragrupani/karma-chromium-edge-launcher',
      { 'launcher:Safari': [ 'type', SafariBrowser ] },
    ],

    // start these browsers
    // available browser launchers: https://npmjs.org/browse/keyword/karma-launcher
    browsers: browsers,

    // test results reporter to use
    // possible values: 'dots', 'progress'
    // available reporters: https://npmjs.org/browse/keyword/karma-reporter
    reporters: ['mocha'],


    // level of logging
    // possible values: config.LOG_DISABLE || config.LOG_ERROR || config.LOG_WARN || config.LOG_INFO || config.LOG_DEBUG
    logLevel: config.LOG_INFO,


    // enable / disable watching file and executing tests whenever any file changes
    autoWatch: false,

    // Continuous Integration mode
    // if true, Karma captures browsers, runs the tests and exits
    singleRun: true,
  };

  config.set(my_conf);
};
