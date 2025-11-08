import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';

export default defineConfig({
    test: {
        setupFiles: "./tests/assertions.js",
        browser: {
            enabled: true,
            provider: playwright(),
            // https://vitest.dev/guide/browser/playwright
            instances: [
                { browser: 'chromium' },
                { browser: 'firefox' },
                { browser: 'webkit' },
            ],
        },
    },
});