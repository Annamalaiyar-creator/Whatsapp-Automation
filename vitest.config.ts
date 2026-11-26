import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // The API tests share one test database, so test files run one after another.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 60000,
  },
});
