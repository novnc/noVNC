## Prep:

```
docker build -t rust-wasm ./core/wasm

docker run -it -v `pwd`:/novnc -w /novnc/core/wasm -p 8080:8080 rust-wasm bash

npm install
```

Build:

```
cargo +nightly build --target wasm32-unknown-unknown
wasm-bindgen target/wasm32-unknown-unknown/debug/novnc.wasm --out-dir .
npm run serve   # then visit localhost:8080 outside the container
```
