export const overrideDefaults = (defaults) => {
    if (!defaults['host']) {
        defaults['host'] = window.location.hostname;
    }
    if (!defaults['port']) {
        let port = window.location.port;
        if (!port) {
            if (window.location.protocol.substring(0, 5) == 'https') {
                port = 443;
            } else if (window.location.protocol.substring(0, 4) == 'http') {
                port = 80;
            }
        }
        defaults['port'] = port;
    }
};