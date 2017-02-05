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

We use Karma to run our tests. You can launch karma manually, or simply
run `npm test`.  The Karma debug page will display the tests in normal
mocha form, if you need it.

Thanks, and happy coding!
