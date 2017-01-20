# AST2100 (0x57) encoding support

These are notes to accompany the ATEN iKVM "AST2100" (0x59) encoding implementation that this branch contains.

This implementation is the product of clean-room reverse engineering (that is, I am not and have never been subject to
nondisclosure agreements, nor have I had access to proprietary information, related to the subject matter of this
project).

(c) Copyright 2015-2017 Kevin Kelley <kelleyk@kelleyk.net>

### Current problems / limitations (aka "TODOs")

  - Especially on lower quality settings, you will notice that the picture is not as clear as what the ATEN iKVM client
    will show you (using the same settings).  I'm aware of this issue and intend to fix it.  Disabling chroma
    subsampling will allow the encoder to use VQ when there are few colors (e.g. when you are looking at a terminal); VQ
    data doesn't have the same quality issue.

  - The code could stand to be much better-tested.

  - The JavaScript files related to the AST2100 decoder are loaded even when noVNC does not use the decoder.  It would
    be nice to lazy-load them only when they are necessary.

  - Lots of globals (functions, constants, etc.) are exposed.  Some quick refactoring could tuck the majority of them
    away to avoid cluttering the namespace.

### Profiling

  - For some reason, when I use blitImageData() (with the noVNC render queue disabled), that function shows up as the
    "heaviest" function in Chrome's CPU profiler, even though the function is doing nothing other than evaluating a
    branch condition or two and then calling _rgbxImageData().  When I call _rgbxImageData() directly, then
    putImageData() (the Canvas method that's actually doing the heavy lifting) is correctly shown as the "heaviest"
    function.

  - Profiler oddness aside, putImageData() is overwhelmingly the dominant cost; it seems to occupy 75-85% of the CPU
    time that noVNC uses.  There are plenty of places that we could get small performance improvements in Ast2100Decoder
    (and elsewhere in noVNC) but they seem unlikely to have a worthwhile impact, given that fact.

### About the implementation

  - One large, remaining inefficiency is the several times that image data is copied around before being blitted.  The
    Ast2100Decoder class generates as output 256-element arrays (representing 64 pixels as (R,G,B,A) 4-tuples).  This is
    exactly what winds up in the ImageData object that is eventually passed to putImageData(); we could just have the
    decoder write its output directly into those arrays if we wanted.

### Performance questions

  - Is it faster to call putImageData() fewer times with larger buffers?  We could collect groups of blocks (or even an
    entire frame) and then call putImageData() once.  (Of course, this would require redrawing unchanged regions every
    frame, too.)
