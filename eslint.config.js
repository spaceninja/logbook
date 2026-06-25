import js from '@eslint/js';
import * as typescriptParser from '@typescript-eslint/parser';
import pluginVitest from '@vitest/eslint-plugin';
import eslintConfigPrettier from 'eslint-config-prettier';
import testingLibrary from 'eslint-plugin-testing-library';
import pluginVue from 'eslint-plugin-vue';

export default [
  {
    ignores: ['.nuxt/**/*', '.output/**/*', 'dist/**/*', 'public/**/*'],
  },
  js.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    // Parse <script lang="ts"> blocks in Vue SFCs.
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: typescriptParser,
      },
    },
  },
  eslintConfigPrettier,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      // TypeScript and Nuxt's auto-imports (defineNuxtConfig, useState, etc.)
      // mean no-undef produces false positives; TS handles undefined refs.
      'no-undef': 'off',
      // Conflicts with Nuxt file conventions like `[slug].vue`.
      'vue/multi-word-component-names': 'off',
      // Dead-code detection in SFCs.
      'vue/no-unused-properties': [
        'error',
        { groups: ['props', 'data', 'computed', 'methods'] },
      ],
      'vue/no-unused-refs': 'error',
      'vue/no-unused-emit-declarations': 'error',
    },
  },
  // Test files: each plugin's flat config must be its own array entry —
  // spreading several into one object would clobber each other's `plugins`
  // and `rules` keys.
  {
    files: ['**/*.test.*', '**/*.spec.*'],
    // flat/vue (not flat/dom): @testing-library/vue's fireEvent is async, so
    // awaiting it is correct — the dom config would wrongly flag those awaits.
    ...testingLibrary.configs['flat/vue'],
  },
  {
    files: ['**/*.test.*', '**/*.spec.*'],
    ...pluginVitest.configs.recommended,
  },
  {
    // Test files are TypeScript; parse them with the TS parser so type-only
    // imports (`import type { … }`) and other TS syntax are understood. The
    // recommended test configs above leave the default (espree) parser in place.
    files: ['**/*.test.*', '**/*.spec.*'],
    languageOptions: {
      parser: typescriptParser,
    },
  },
  {
    // Our additions on top of the recommended sets.
    files: ['**/*.test.*', '**/*.spec.*'],
    rules: {
      // Better assertions
      'vitest/prefer-to-be': 'error',
      'vitest/prefer-to-have-length': 'error',
      'vitest/prefer-to-contain': 'error',
      'vitest/prefer-mock-promise-shorthand': 'error',
      // Test structure
      'vitest/consistent-test-it': ['error', { fn: 'it' }],
      'vitest/prefer-hooks-on-top': 'error',
      'vitest/prefer-hooks-in-order': 'error',
      'vitest/no-duplicate-hooks': 'error',
      'vitest/require-top-level-describe': 'error',
      'vitest/max-nested-describe': ['error', { max: 2 }],
      'vitest/no-conditional-in-test': 'warn',
    },
  },
];
