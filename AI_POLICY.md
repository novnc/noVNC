noVNC AI policy
===============

The legal and ethical status of LLM-generated content is currently
uncertain. LLMs are trained on large amounts of existing work, much of
it under licenses that require attribution or impose other conditions,
and their output can reproduce or be derived from that work without any
indication of its origin. noVNC is a Free Software project that depends
on copyright and licenses being respected, and we want to show the same
respect for the work of others. For now, the noVNC project has therefore
decided to take a cautionary approach to such content. This policy
reflects the current situation, and will be revisited as it becomes
clearer.

Any significant contribution to noVNC must not include LLM-generated
content or be derived from LLM-generated content. This applies to all
contributions, including code, documentation, and translations.

Minor LLM-generated contributions can still be accepted, as long as they
fulfill all other requirements on quality. The commits must be marked
with an "Assisted-by:" tag for transparency.

All contributions must be submitted by a human who has reviewed them,
understands them, and can answer questions about them.

There is no strict definition of what is a "significant" contribution.
The decision will be made by the noVNC maintainer or maintainers that
review the contribution. A guideline is the GNU project's definition[^1]
of legally significant changes.

As an exception, significant LLM-generated contributions to test cases
can be accepted. Tests are largely constrained by the code they
exercise, leaving less room for reproducing the work of others, and they
can be removed without affecting noVNC itself. Such changes must be kept
in separate commits, marked with an "Assisted-by:" tag, so that they can
be identified and removed if needed in the future.

This policy does not apply to code that primarily belongs to other
projects and is imported into noVNC.

Other uses of AI
----------------

This policy covers content included in contributions. It does not cover
using AI tools for research, understanding the code, finding bugs,
debugging, or as support when reviewing, as long as the output is not
included in a contribution. Neither does it cover assistive uses such
as spelling and grammar checking, or screen readers. Bug reports and
comments written with AI assistance should be verified by the contributor
before posting.

[^1]: https://www.gnu.org/prep/maintain/maintain.html#Legally-Significant
