// Currently WebAssembly modules cannot be synchronously imported in the main
// chunk: https://github.com/webpack/webpack/issues/6615
//
// By dynamically importing index.js webpack will split it into a separate chunk
// automatically, where synchronous imports of WebAssembly is allowed.

const index = import("./index");
index.then(() => {
  console.log("Loaded...");
});

