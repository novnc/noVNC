export function createRelayWorker() {
    return new SharedWorker(new URL('../../app/port-relay-worker.js', import.meta.url), { type: 'module' });
}
