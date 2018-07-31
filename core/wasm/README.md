# noVNC + wasm

This is a WebAssembly proof-of-concept.

It is based on information from the following sources:

* https://hacks.mozilla.org/2018/04/javascript-to-rust-and-back-again-a-wasm-bindgen-tale/
* https://www.hellorust.com/demos/canvas/index.html
* https://github.com/rustwasm/wasm-bindgen/blob/master/examples/julia\_set/
* https://github.com/rustwasm/wasm\_game\_of\_life/


## Prep:

```
docker build -t kanaka/rust-wasm ./core/wasm
    # OR
docker pull kanaka/rust-wasm

docker run -it -v `pwd`:/novnc -w /novnc/core/wasm -p 7080:7080 kanaka/rust-wasm bash

npm install
```

## Build:

Run the following inside the container:

```
npm run build-release  # or run build-debug (10x slower code)
npm run serve          # then visit localhost:7080 outside the container
```

Note that `run server` will automatically detect modification to
`index.js` and reload the page.

