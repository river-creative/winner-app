import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';
import svelteConfig from './svelte.config.js';

export default ts.config(
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node }
    }
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        extraFileExtensions: ['.svelte'],
        parser: ts.parser,
        svelteConfig
      }
    }
  },
  {
    // The migration's own rules. Fail-fast beats defensive defaults (CLAUDE.md), so an
    // unused argument is an error unless it is deliberately prefixed with an underscore.
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],

      /**
       * Off deliberately.
       *
       * The rule flags every `new Map()` / `new Set()` in a `.svelte.ts` file, but it cannot tell
       * reactive state from a local temporary — and in this codebase they are all temporaries:
       * lookup tables built inside a `$derived.by`, the id sets a draw dedupes with, the timer
       * handles a toast queue clears. Two of them must *not* be reactive (the pending-write set in
       * the settings store, the timer map in the toast store), so `SvelteSet`/`SvelteMap` would be
       * actively wrong there. Scattering fifteen disable comments would be worse noise than one
       * decision recorded here.
       *
       * What the rule was protecting against still applies: a collection whose *mutations* have
       * to re-render belongs in `$state`, or in `SvelteMap`/`SvelteSet` if it must stay a
       * collection. Every store here reassigns an array instead, which is simpler and works.
       */
      'svelte/prefer-svelte-reactivity': 'off'
    }
  },
  {
    /**
     * The Express backend keeps the rules it was written under.
     *
     * It was not part of the Svelte migration, and it is type-checked by
     * `tsconfig.backend.json` on every build. Holding fifty pre-existing `any`s and its
     * request-logging to the frontend's standard would mean either a wall of findings nobody
     * acts on, or fifty disable comments — both of which make the linter worth less, not more.
     * Tightening it is real work with its own risk, and belongs in its own change.
     */
    files: ['backend/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
      'preserve-caught-error': 'off'
    }
  },
  {
    ignores: [
      'node_modules/',
      'dist/',
      'build/',
      '.svelte-kit/',
      'data/',
      'backend/**/*.js',
      'backend/**/*.js.map',
      // A standalone puppeteer helper for capturing console output, not part of the app.
      'test-console.cjs'
    ]
  }
);
