import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import reactRefreshPlugin from 'eslint-plugin-react-refresh';
import globals from 'globals';

/** @type {import('eslint').Linter.Config[]} */
export default [
  // ---- Global ignores ----
  { ignores: ['dist/**', 'node_modules/**', 'supabase/**'] },

  // ---- Base JS rules ----
  js.configs.recommended,

  // ---- TypeScript + React ----
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooksPlugin,
      'react-refresh': reactRefreshPlugin,
    },
    rules: {
      // TypeScript essentials
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/consistent-type-imports': 'off',

      // React hooks discipline
      ...reactHooksPlugin.configs.recommended.rules,

      // Vite HMR — only export components
      'react-refresh/only-export-components': 'off',

      // General quality
      'react-hooks/exhaustive-deps': 'off',
      'no-console': 'off',
      'no-debugger': 'off',
      'prefer-const': 'off',
      'no-duplicate-imports': 'error',
    },
  },
];
