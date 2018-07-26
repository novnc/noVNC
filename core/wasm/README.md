# noVNC + wasm

This is a WebAssembly proof-of-concept.

It is based on information from the following sources:

* https://hacks.mozilla.org/2018/04/javascript-to-rust-and-back-again-a-wasm-bindgen-tale/
* https://www.hellorust.com/demos/canvas/index.html
* https://github.com/rustwasm/wasm-bindgen/blob/master/examples/julia\_set/
* https://github.com/rustwasm/wasm\_game\_of\_life/


## Prep:

```
docker build -t rust-wasm ./core/wasm

docker run -it -v `pwd`:/novnc -w /novnc/core/wasm -p 8080:8080 rust-wasm bash

npm install
```

## Build:

```
npm run build-release  # or run build-debug (10x slower code)
npm run serve          # then visit localhost:8080 outside the container
```

Note that `run server` will automatically detect modification to
`index.js` and reload the page.


## Preliminary results:

* 2048x1024, draw1, release:  66.7ms
* 2048x1024, draw2, release:  34.1ms ( 21.7ms /  12.4ms)
* 2048x1024, draw3, release:  29.9ms ( 15.1ms /  14.8ms)

* 1024x1024, draw1, release:  47.5ms
* 1024x1024, draw2, release:  21.8ms ( 12.0ms /   9.8ms)
* 1024x1024, draw3, release:  16.7ms (  6.9ms /   9.8ms)

* 1024x1024, draw1, debug:   376.6ms
* 1024x1024, draw2, debug:   132.4ms (129.1ms /   3.3ms)
* 1024x1024, draw3, debug:   131.4ms (128.8ms /   2.6ms)
