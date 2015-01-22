How to contribute to noVNC
==========================

We accept code via pull requests on GitHub.  There are several guidelines that
we expect contributors submitting code requests to follow.  If you have issues
following any of these guidelines, feel free to drop us a line by leaving a
comment in the code request or sending us an email.

Contributing Guidelines
-----------------------

* While we don't have an official coding style guide, please try to follow
  the general coding style of the existing code.
** Use four spaces instead of tabs 
** prefix private variables and functions with an `_`

* Please try to include unit tests for your code.  For instance, if you
  introduce a new encoding, add a test to `tests/test.rfb.js` under the
  "Encoding Handlers" section (basically, input a small pattern in your
  encoding and make sure the pattern gets displayed correctly).  If you
  fix a bug, try to add a unit test that would have caught that bug
  (if possible -- some bugs, especially visual ones, are hard to test for).

* Squash your commits down in to a clean commit history.  For instance, there
  should not be "cleanup" commits where you fix issues in previous commits in
  the same pull request.  Before you go to commit, use `git rebase -i` to
  squash these changes into the relevant commits.  For instance, a good commit
  history might look like "Added support for FOO encoding, Added support for
  BAR message, Placed Button in UI to Trigger BAR" (where each comma denotes
  a separate commit).

* Add both a title and description to your commit, if possible.  Place more
  detail on what you did in the description.

Running the unit tests
----------------------

There are two ways to run the unit tests.  For both ways, you should first run
`npm install` (not as root).

The first way to run the tests is to run `npm test`.  This will run all the
tests in the headless PhantomJS browser (which uses WebKit).

The second way to run the tests is using the `tests/run_from_console.js` file.
This way is a bit more flexible, and can provide more information about what
went wrong.  To run all the tests, simply run `tests/run_from_console.js`.
To run a specific test file, you can use the `-t path/to/test/file.js` option.
If you wish to simply generate the HTML for the test, use the `-g` option, and
the path to the temporary HTML file will be written to standard out.  To open
this file in your default browser automatically, pass the `-o` option as well.
More information can be found by passing the `--help` or `-h` option.


Thanks, and happy coding!
