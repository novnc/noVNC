#!/usr/bin/env node
var ansi = require('ansi');
var program = require('commander');
var path = require('path');

var make_list = function(val) {
  return val.split(',');
}

program
  .option('-t, --tests <testlist>', 'Run the specified html-file-based test(s). \'testlist\' should be a comma-separated list', make_list, [])
  .option('-a, --print-all', 'Print all tests, not just the failures')
  .option('--disable-color', 'Explicitly disable color')
  .option('-c, --color', 'Explicitly enable color (default is to use color when not outputting to a pipe)')
  .option('-i, --auto-inject <includefiles>', 'Treat the test list as a set of mocha JS files, and automatically generate HTML files with which to test test.  \'includefiles\' should be a comma-separated list of paths to javascript files to include in each of the generated HTML files', make_list, null)
  .option('-p, --provider <name>', 'Use the given provider (defaults to "casper").  Currently, may be "casper" or "zombie"', 'casper')
  .parse(process.argv);

var file_paths = [];

if (program.autoInject) {
  var temp = require('temp');
  var fs = require('fs');
  temp.track();

  var template = {
    header: "<html>\n<head>\n<meta charset='utf-8' />\<link rel='stylesheet' href='node_modules/mocha/mocha.css'/>\n</head>\n<body><div id='mocha'></div>",
    script_tag: function(p) { return "<script src='" + p + "'></script>" },
    footer: "<script>\nmocha.checkLeaks();\nmocha.globals(['navigator', 'create', 'ClientUtils', '__utils__']);\nmocha.run();\n</script>\n</body>\n</html>"
  };

  template.header += "\n" + template.script_tag(path.resolve(__dirname, 'node_modules/chai/chai.js'));
  template.header += "\n" + template.script_tag(path.resolve(__dirname, 'node_modules/mocha/mocha.js'));
  template.header += "\n<script>mocha.setup('bdd');</script>";


  template.header = program.autoInject.reduce(function(acc, sn) {
    return acc + "\n" + template.script_tag(path.resolve(process.cwd(), sn));
  }, template.header);

  file_paths = program.tests.map(function(jsn, ind) {
    var templ = template.header;
    templ += "\n";
    templ += template.script_tag(path.resolve(process.cwd(), jsn));
    templ += template.footer;

    var tempfile = temp.openSync({ prefix: 'novnc-zombie-inject-', suffix: '-file_num-'+ind+'.html' });
    fs.writeSync(tempfile.fd, templ);
    fs.closeSync(tempfile.fd);
    return tempfile.path;
  });

}
else {
  file_paths = program.tests.map(function(fn) {
    return path.resolve(process.cwd(), fn);
  });
}

var failure_count = 0;

var use_ansi = false;
if (program.color) use_ansi = true;
else if (program.disableColor) use_ansi = false;
else if (process.stdout.isTTY) use_ansi = true;

var cursor = ansi(process.stdout, { enabled: use_ansi });

var prov = require(path.resolve(__dirname, 'run_from_console.'+program.provider+'.js'));

cursor
  .write("Running tests ")
  .bold()
  .write(program.tests.join(', '))
  .reset()
  .grey()
  .write(' using provider '+prov.name)
  .reset()
  .write("\n");
//console.log("Running tests %s using provider %s", program.tests.join(', '), prov.name);

var provider = prov.provide_emitter(file_paths);
provider.on('test_ready', function(test_json) {
  console.log('');

  filename = program.tests[test_json.file_ind];

  cursor.bold();
  console.log('Results for %s:', filename);
  console.log(Array('Results for :'.length+filename.length+1).join('='));
  cursor.reset();

  console.log('');

  cursor.write(''+test_json.num_tests+' tests run, ')
  cursor
    .green()
    .write(''+test_json.num_passes+' passed');
  if (test_json.num_slow > 0) {
    cursor
      .reset()
      .write(' (');
    cursor
      .yellow()
      .write(''+test_json.num_slow+' slow')
      .reset()
      .write(')');
  }
  cursor
    .reset()
    .write(', ');
  cursor
    .red()
    .write(''+test_json.num_fails+' failed');
  cursor
    .reset()
    .write(' -- duration: '+test_json.duration+"\n");

  console.log('');

  if (test_json.num_fails > 0 || program.printAll) {
    var traverse_tree = function(indentation, node) {
      if (node.type == 'suite') {
        if (!node.has_subfailures && !program.printAll) return;

        if (indentation == 0) {
          cursor.bold();
          console.log(node.name);
          console.log(Array(node.name.length+1).join('-'));
          cursor.reset();
        }
        else {
          cursor
            .write(Array(indentation+3).join('#'))
            .bold()
            .write(' '+node.name+' ')
            .reset()
            .write(Array(indentation+3).join('#'))
            .write("\n");
        }

        console.log('');

        for (var i = 0; i < node.children.length; i++) {
          traverse_tree(indentation+1, node.children[i]);
        }
      }
      else {
        if (!node.pass) {
          cursor.magenta();
          console.log('- failed: '+node.text+test_json.replay);
          cursor.red();
          console.log('          '+node.error.split("\n")[0]);  // the split is to avoid a weird thing where in PhantomJS, we get a stack trace too
          cursor.reset();
          console.log('');
        }
        else if (program.printAll) {
          if (node.slow) cursor.yellow();
          else cursor.green();
          cursor
            .write('- pass: '+node.text)
            .grey()
            .write(' ('+node.duration+') ');
          /*if (node.slow) cursor.yellow();
          else cursor.green();*/
          cursor
            //.write(test_json.replay)
            .reset()
            .write("\n");
          console.log('');
        }
      }
    }

    for (var i = 0; i < test_json.suites.length; i++) {
      traverse_tree(0, test_json.suites[i]);
    }
  }

  if (test_json.num_fails == 0) {
    cursor.fg.green();
    console.log('all tests passed :-)');
    cursor.reset();
  }
});

/*provider.on('console', function(line) {
  //console.log(line);
});*/

/*gprom.finally(function(ph) {
  ph.exit();
  // exit with a status code that actually gives information
  if (program.exitWithFailureCount) process.exit(failure_count);
});*/

