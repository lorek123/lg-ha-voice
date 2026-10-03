import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'dist/', 'node_modules/',
      // Generated / local-only (mirrors .gitignore) — not app source.
      'playwright-report/', 'test-results/', 'blob-report/', 'bundle.js', 'bundle.js.map',
      'chromium/', 'ghidra/', 'reverse/', 'drive-dev.mjs',
    ],
  },

  // Recommended rules applied globally, with project-wide overrides
  {
    ...js.configs.recommended,
    rules: {
      ...js.configs.recommended.rules,
      // `_` (and `_foo`) signals "intentionally unused" — a common JS convention.
      'no-unused-vars': ['error', {
        varsIgnorePattern:        '^_',
        argsIgnorePattern:        '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      // Empty catch blocks are fine when the variable is `_`.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  // Frontend – browser ESM, esbuild transpiles to chrome58
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
  },

  // Luna service – Node.js CommonJS-style, esbuild transpiles to ES5
  {
    files: ['service/**/*.js'],
    languageOptions: {
      ecmaVersion: 2019,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      'no-var': 'off', // service is written in ES5 var style intentionally
    },
  },

  // Tests – Node.js ESM. UI specs also reference browser globals inside
  // page.evaluate()/addInitScript() callbacks, so include both.
  {
    files: ['test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
  },

  // Root tooling configs – Node.js ESM
  {
    files: ['*.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
];
