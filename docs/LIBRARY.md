# Using the noVNC JavaScript library

This document describes how to make use of the noVNC JavaScript library for
integration in your own VNC client application. If you wish to embed the more
complete noVNC application with its included user interface then please see
our [embedding documentation](EMBEDDING.md).

## API

The API of noVNC consists of a single object called `RFB`. The formal
documentation for that object can be found in our [API documentation](API.md).

## Example

noVNC includes a small example application called `vnc_lite.html`. This does
not make use of all the features of noVNC, but is a good start to see how to
do things.

## Conversion of Modules

noVNC is written using ECMAScript 6 modules. Many of the major browsers support
these modules natively, but not all. They are also not supported by Node.js. To
use noVNC in these places the library must first be converted.

Fortunately noVNC includes a script to handle this conversion. Please follow
the following steps:

 1. Install Node.js
 2. Run `npm install` in the noVNC directory
 3. Run `./utils/use_require.js --as <module format>`

Several module formats are available. Please run
`./utils/use_require.js --help` to see them all.

The result of the conversion is available in the `lib/` directory.
