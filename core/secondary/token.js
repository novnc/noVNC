const RELAY_TOKEN_RE = /^[0-9a-f]{32}$/;

export function isRelayToken(value) {
    return typeof value === 'string' && RELAY_TOKEN_RE.test(value);
}

export function newRelaySecret() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
