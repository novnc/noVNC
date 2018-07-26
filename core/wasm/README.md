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

* 2048x1024, draw1, release: 23 fps
* 2048x1024, draw2, release: 51 fps
* 2048x1024, draw3, release: 60 fps

* 1024x1024, draw1, release: 36 fps
* 1024x1024, draw2, release: 60 fps
* 1024x1024, draw3, release: 60 fps

* 1024x1024, draw1, debug:    3 fps
* 1024x1024, draw2, debug:    8 fps
* 1024x1024, draw3, debug:    9 fps
