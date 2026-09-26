import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        alias: {
            '@apify-actors/common': resolve(import.meta.dirname, '../../packages/common/src/index.ts'),
        },
    },
    test: {
        environment: 'node',
        include: ['test/**/*.test.ts'],
        testTimeout: 120_000,
        hookTimeout: 60_000,
        fileParallelism: false,
    },
});
