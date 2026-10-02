import { defineConfig } from 'vitest/config';

// Unit tests only (test/**/*.test.js). The Playwright UI specs live in
// test/ui/*.spec.js and are run with `npm run test:ui`, not vitest.
export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    exclude: ['test/ui/**', 'node_modules/**'],
  },
});
