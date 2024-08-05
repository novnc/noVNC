import { defaultReporter } from '@web/test-runner';
import { summaryReporter } from '@web/test-runner';

export default {
    nodeResolve: true,
    files: [
        'tests/test.*.js',
    ],
    reporters: [
        defaultReporter(),
        summaryReporter(),
    ]
};