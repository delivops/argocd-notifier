import js from '@eslint/js';
// import eslintPluginPrettier from 'eslint-plugin-prettier';
import globals from 'globals';
import tsEslint from 'typescript-eslint';

/** @type { import("eslint").Linter.Config[] } */
export default [
  js.configs.recommended,

  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2024,
        ...globals.node,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
  },

  ...tsEslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: {
      parser: tsEslint.parser,
      parserOptions: {
        project: './tsconfig.json',
      },
      globals: {
        // ...globals.browser,
        ...globals.es2024,
        ...globals.node,
      },
    },
    rules: {
      ...tsEslint.configs.recommended.rules,
      'no-undef': 'error',
      '@typescript-eslint/interface-name-prefix': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      // 'prettier/prettier': 'error',
      'no-console': 'warn',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },

  {
    ignores: [
      '*.{mjs,cjs}',
      '.husky/*',
      '.yarn/*',
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/out/**',
      '**/coverage/**',
    ],
  },

  // eslintPluginPrettier.configs.recommended,
];
