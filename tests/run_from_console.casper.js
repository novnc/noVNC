var Spooky = require('spooky');
var path = require('path');

var phantom_path = require('phantomjs').path;
var casper_path = path.resolve(__dirname, '../node_modules/casperjs/bin/casperjs');
process.env.PHANTOMJS_EXECUTABLE = phantom_path;
var casper_opts = {
  child: {
    transport: 'http',
    command: casper_path
  },
  casper: {
    logLevel: 'debug',
    verbose: true
  }
};

var provide_emitter = function(file_paths) {
  var spooky = new Spooky(casper_opts, function(err) {
    if (err) {
      if (err.stack) console.warn(err.stack);
      else console.warn(err);
      return;
    }
    spooky.start('about:blank');

    file_paths.forEach(function(file_path, path_ind) {
      spooky.thenOpen('file://'+file_path);
      spooky.waitFor(function() {
        return this.getGlobal('__mocha_done') === true;
      },
      [{ path_ind: path_ind }, function() {
        var res_json = {
          file_ind: path_ind
        };

        res_json.num_tests = this.evaluate(function() { return document.querySelectorAll('li.test').length; });
        res_json.num_passes = this.evaluate(function() { return document.querySelectorAll('li.test.pass').length; });
        res_json.num_fails = this.evaluate(function() { return document.querySelectorAll('li.test.fail').length; });
        res_json.num_slow = this.evaluate(function() { return document.querySelectorAll('li.test.pass:not(.fast):not(.pending)').length; });
        res_json.num_skipped = this.evaluate(function () { return document.querySelectorAll('li.test.pending').length; });
        res_json.duration = this.evaluate(function() { return document.querySelector('li.duration em').textContent; });

        res_json.suites = this.evaluate(function() {
          var traverse_node = function(elem) {
            var res;
            if (elem.classList.contains('suite')) {
              res = {
                type: 'suite',
                name: elem.querySelector('h1').textContent,
                has_subfailures: elem.querySelectorAll('li.test.fail').length > 0,
              };

              var child_elems = elem.querySelector('ul').children;
              res.children = Array.prototype.map.call(child_elems, traverse_node);
              return res;
            }
            else {
              var h2_content = elem.querySelector('h2').childNodes;
              res = {
                type: 'test',
                text: h2_content[0].textContent,
              };

              if (elem.classList.contains('pass')) {
                res.pass = true;
                if (elem.classList.contains('pending')) {
                  res.slow = false;
                  res.skipped = true;
                }
                else {
                  res.slow = !elem.classList.contains('fast');
                  res.skipped = false;
                  res.duration = h2_content[1].textContent;
                }
              }
              else {
                res.error = elem.querySelector('pre.error').textContent;
              }

              return res;
            }
          };
          var top_suites = document.querySelectorAll('#mocha-report > li.suite');
          return Array.prototype.map.call(top_suites, traverse_node);
        });

        res_json.replay = this.evaluate(function() { return document.querySelector('a.replay').textContent; });

        this.emit('test_ready', res_json);
      }]);
    });
    spooky.run();
  });

  return spooky;
};

module.exports = {
  provide_emitter: provide_emitter,
  name: 'SpookyJS (CapserJS on PhantomJS)'
};
