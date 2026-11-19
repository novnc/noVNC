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

    // list of files / patterns to load in the browser
    files: [
      // node modules
      // chai, sinon and sinon-chai are added by the sinon-chai framework
      // modules to test
      { pattern: 'app/localization.js', included: false, type: 'module' },
      { pattern: 'app/webutil.js', included: false, type: 'module' },
      // served as text only, test.ui_enhanced_metrics.js reads its source
      { pattern: 'app/ui.js', included: false },
      { pattern: 'core/**/*.js', included: false, type: 'module' },
      // tests
      { pattern: 'tests/test.*.js', type: 'module' },
      // test support files
      { pattern: 'tests/fake.*.js', included: false, type: 'module' },
      { pattern: 'tests/assertions.js', type: 'module' },
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
      // These import decoders that were removed from core/decoders
      'tests/test.jpeg.js',
      'tests/test.zrle.js',
    ],

    // Bundle every test with Vite, see tests/karma-vite-preprocessor.js
    preprocessors: {
      'tests/test.*.js': ['vite'],
      'tests/fake.*.js': ['vite'],
    },

    customLaunchers: {
      // Chrome in a container (no user namespaces) needs --no-sandbox
      ChromeHeadlessNoSandbox: { base: 'ChromeHeadless', flags: ['--no-sandbox'] },
    },

    plugins: [
      require('./tests/karma-vite-preprocessor.js'),
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
