// Karma configuration

module.exports = function(config) {
  var customLaunchers = {};
  var browsers = [];
  var useSauce = false;

  // use Sauce when running on Travis
  if (process.env.TRAVIS_JOB_NUMBER) {
    useSauce = true;
  }

  if (useSauce && process.env.TEST_BROWSER_NAME && process.env.TEST_BROWSER_NAME != 'PhantomJS') {
    var names = process.env.TEST_BROWSER_NAME.split(',');
    var platforms = process.env.TEST_BROWSER_OS.split(',');
    var versions = [];
    if (process.env.TEST_BROWSER_VERSION) {
      versions = process.env.TEST_BROWSER_VERSION.split(',');
    } else {
      versions = [null];
    }

    for (var i = 0; i < names.length; i++) {
      for (var j = 0; j < platforms.length; j++) {
        for (var k = 0; k < versions.length; k++) {
          var launcher_name = 'sl_' + platforms[j].replace(/[^a-zA-Z0-9]/g, '') + '_' + names[i];
          if (versions[k]) {
            launcher_name += '_' + versions[k];
          }

          customLaunchers[launcher_name] = {
            base: 'SauceLabs',
            browserName: names[i],
            platform: platforms[j],
          };

          if (versions[i]) {
            customLaunchers[launcher_name].version = versions[k];
          }
        }
      }
    }

    browsers = Object.keys(customLaunchers);
  } else {
    useSauce = false;
    //browsers = ['PhantomJS'];
    browsers = [];
  }

  var my_conf = {

    // base path that will be used to resolve all patterns (eg. files, exclude)
    basePath: '',

    // frameworks to use
    // available frameworks: https://npmjs.org/browse/keyword/karma-adapter
    frameworks: ['requirejs', 'mocha', 'chai'],

    // list of files / patterns to load in the browser (loaded in order)
    files: [
      { pattern: 'vendor/sinon.js', included: false },
      { pattern: 'node_modules/sinon-chai/lib/sinon-chai.js', included: false },
      { pattern: 'app/localization.js', included: false },
      { pattern: 'app/webutil.js', included: false },
      { pattern: 'core/**/*.js', included: false },
      { pattern: 'vendor/pako/**/*.js', included: false },
      { pattern: 'tests/test.*.js', included: false },
      { pattern: 'tests/fake.*.js', included: false },
      { pattern: 'tests/assertions.js', included: false },
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

    customLaunchers: customLaunchers,

    // start these browsers
    // available browser launchers: https://npmjs.org/browse/keyword/karma-launcher
    browsers: browsers,

    // preprocess matching files before serving them to the browser
    // available preprocessors: https://npmjs.org/browse/keyword/karma-preprocessor
    preprocessors: {
      'app/localization.js': ['babel'],
      'app/webutil.js': ['babel'],
      'core/**/*.js': ['babel'],
      'tests/test.*.js': ['babel'],
      'tests/fake.*.js': ['babel'],
      'tests/assertions.js': ['babel'],
      'vendor/pako/**/*.js': ['babel'],
    },

    babelPreprocessor: {
      options: {
        plugins: ['transform-es2015-modules-amd', 'syntax-dynamic-import'],
        sourceMap: 'inline',
      },
    },

    // test results reporter to use
    // possible values: 'dots', 'progress'
    // available reporters: https://npmjs.org/browse/keyword/karma-reporter
    reporters: ['mocha'],


    // web server port
    port: 9876,


    // enable / disable colors in the output (reporters and logs)
    colors: true,


    // level of logging
    // possible values: config.LOG_DISABLE || config.LOG_ERROR || config.LOG_WARN || config.LOG_INFO || config.LOG_DEBUG
    logLevel: config.LOG_INFO,


    // enable / disable watching file and executing tests whenever any file changes
    autoWatch: false,

    // Continuous Integration mode
    // if true, Karma captures browsers, runs the tests and exits
    singleRun: true,

    // Increase timeout in case connection is slow/we run more browsers than possible
    // (we currently get 3 for free, and we try to run 7, so it can take a while)
    captureTimeout: 240000,

    // similarly to above
    browserNoActivityTimeout: 100000,
  };

  if (useSauce) {
    my_conf.reporters.push('saucelabs');
    my_conf.captureTimeout = 0; // use SL timeout
    my_conf.sauceLabs = {
      testName: 'noVNC Tests (all)',
      startConnect: false,
      tunnelIdentifier: process.env.TRAVIS_JOB_NUMBER
    };
  }

  config.set(my_conf);
};
