var Browser = require('zombie');
var path = require('path');
var EventEmitter = require('events').EventEmitter;
var Q = require('q');

var provide_emitter = function(file_paths) {
  var emitter = new EventEmitter();

  file_paths.reduce(function(prom, file_path, path_ind) {
    return prom.then(function(browser) {
      browser.visit('file://'+file_path, function() {
        if (browser.error) throw new Error(browser.errors);

        var res_json = {};
        res_json.file_ind = path_ind;

        res_json.num_tests = browser.querySelectorAll('li.test').length;
        res_json.num_fails = browser.querySelectorAll('li.test.fail').length;
        res_json.num_passes = browser.querySelectorAll('li.test.pass').length;
        res_json.num_slow = browser.querySelectorAll('li.test.pass:not(.fast)').length;
        res_json.num_skipped = browser.querySelectorAll('li.test.pending').length;
        res_json.duration = browser.text('li.duration em');

        var traverse_node = function(elem) {
          var classList = elem.className.split(' ');
          var res;
          if (classList.indexOf('suite') > -1) {
            res = {
              type: 'suite',
              name: elem.querySelector('h1').textContent,
              has_subfailures: elem.querySelectorAll('li.test.fail').length > 0
            };

            var child_elems = elem.querySelector('ul').children;
            res.children = Array.prototype.map.call(child_elems, traverse_node);
            return res;
          }
          else {
            var h2_content = elem.querySelector('h2').childNodes;
            res = {
              type: 'test',
              text: h2_content[0].textContent
            };

            if (classList.indexOf('pass') > -1) {
              res.pass = true;
              if (classList.indexOf('pending') > -1) {
                res.slow = false;
                res.skipped = true;
              }
              else {
                res.slow = classList.indexOf('fast') < 0;
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

        var top_suites = browser.querySelectorAll('#mocha-report > li.suite');
        res_json.suites = Array.prototype.map.call(top_suites, traverse_node);
        res_json.replay = browser.querySelector('a.replay').textContent;

        emitter.emit('test_ready', res_json);
      });

      return new Browser();
    });
  }, Q(new Browser()));

  return emitter;
};

module.exports = {
  provide_emitter: provide_emitter,
  name: 'ZombieJS'
};
