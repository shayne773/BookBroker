import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import { reactRefresh } from 'eslint-plugin-react-refresh';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx,mjs}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat['recommended-latest'],
      reactRefresh.configs.vite(),
    ],
    plugins: { react },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.browser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      // Core no-unused-vars does not see a name used only as a JSX tag
      // (<BookCover />), so without this every component import reads as unused.
      'react/jsx-uses-vars': 'error',
    },
  },
  {
    // Vitest runs with `globals: true` (vite.config.js), so tests use its globals unimported.
    files: ['**/*.test.{js,jsx}', 'src/setupTests.js'],
    languageOptions: {
      globals: { ...globals.vitest, ...globals.node },
    },
  },
  {
    // postcss.config.js and tailwind.config.js are CommonJS, loaded by Node.
    files: ['postcss.config.js', 'tailwind.config.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: globals.node,
    },
  },
]);
