import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment  : 'jsdom',
        setupFiles   : ['tests/setup.js'],
        include      : ['tests/bench/**/*.bench.js'],
        benchmark    : {
            include  : ['tests/bench/**/*.bench.js'],
            reporters: ['verbose'],
        },
    },
});
