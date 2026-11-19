// Stands in for Vite's "?worker" imports. Tests that need real decoding
// inject their own decoder instead of spawning a worker.
export default class StubWorker {
    constructor() { this.onmessage = null; }
    postMessage() {}
    addEventListener() {}
    removeEventListener() {}
    terminate() {}
}
