// Karma configuration

module.exports = function(config) {
  /*var customLaunchers = {
    sl_chrome_win7: {
      base: 'SauceLabs',
      browserName: 'chrome',
      platform: 'Windows 7'
    },

    sl_firefox30_linux: {
      base: 'SauceLabs',
      browserName: 'firefox',
      version: '30',
      platform: 'Linux'
    },

    sl_firefox26_linux: {
      base: 'SauceLabs',
      browserName: 'firefox',
      version: 26,
      platform: 'Linux'
    },

    sl_windows7_ie10: {
      base: 'SauceLabs',
      browserName: 'internet explorer',
      platform: 'Windows 7',
      version: '10'
    },

    sl_windows81_ie11: {
      base: 'SauceLabs',
      browserName: 'internet explorer',
      platform: 'Windows 8.1',
      version: '11'
    },

    sl_osxmavericks_safari7: {
      base: 'SauceLabs',
      browserName: 'safari',
      platform: 'OS X 10.9',
      version: '7'
    },

    sl_osxmtnlion_safari6: {
      base: 'SauceLabs',
      browserName: 'safari',
      platform: 'OS X 10.8',
      version: '6'
    }
  };*/

  var customLaunchers = {};
  var browsers = [];
  var useSauce = false;

  if (process.env.SAUCE_USERNAME && process.env.SAUCE_ACCESS_KEY) {
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
    browsers = ['PhantomJS'];
  }

  var my_conf = {

    // base path that will be used to resolve all patterns (eg. files, exclude)
    basePath: '',

    // frameworks to use
    // available frameworks: https://npmjs.org/browse/keyword/karma-adapter
    frameworks: ['mocha', 'sinon', 'chai', 'sinon-chai'],


    // list of files / patterns to load in the browser (loaded in order)
    files: [
      'tests/fake.*.js',
      'tests/assertions.js',
      'include/util.js',  // load first to avoid issues, since methods are called immediately
      //'../include/*.js',
      'include/base64.js',
      'include/keysym.js',
      'include/keysymdef.js',
      'include/keyboard.js',
      'include/input.js',
      'include/websock.js',
      'include/rfb.js',
      'include/jsunzip.js',
      'include/des.js',
      'include/display.js',
      'tests/test.*.js'
    ],

    client: {
      mocha: {
        'ui': 'bdd'
      }
    },

    // list of files to exclude
    exclude: [
      '../include/playback.js',
      '../include/ui.js'
    ],

    customLaunchers: customLaunchers,

    // start these browsers
    // available browser launchers: https://npmjs.org/browse/keyword/karma-launcher
    browsers: browsers,

    // preprocess matching files before serving them to the browser
    // available preprocessors: https://npmjs.org/browse/keyword/karma-preprocessor
    preprocessors: {

    },


    // test results reporter to use
    // possible values: 'dots', 'progress'
    // available reporters: https://npmjs.org/browse/keyword/karma-reporter
    reporters: ['mocha', 'saucelabs'],


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
    my_conf.captureTimeout = 0; // use SL timeout
    my_conf.sauceLabs = {
      testName: 'noVNC Tests (all)',
      startConnect: false,
      tunnelIdentifier: process.env.TRAVIS_JOB_NUMBER
    };
  }

  config.set(my_conf);
};
