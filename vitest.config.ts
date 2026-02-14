import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['src/**/*.spec.ts', 'src/**/*.test.ts', 'test/**/*.test.ts', 'test/**/*.test.mjs'],
        exclude: ['node_modules', 'dist'],
    },
    // Alias cozo-lib-wasm to a mock
    resolve: {
        alias: {
            'cozo-lib-wasm': '/src/__mocks__/cozo-lib-wasm.ts',
        },
    },
});
