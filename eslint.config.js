// eslint-disable-file @typescript-eslint/no-var-requires
const js = require('@eslint/js');
const eslintPluginPrettier = require('eslint-plugin-prettier/recommended');
const globals = require('globals');
const tsEslint = require('typescript-eslint');

/** @type { import("eslint").Linter.Config[] } */
module.exports = [
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
      'prettier/prettier': 'error',
      'no-console': 'warn',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'all',
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },

  {
    ignores: [
      '*.{mjs,cjs,js}',
      '.husky/*',
      '.yarn/*',
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/out/**',
      '**/coverage/**',
    ],
  },

  eslintPluginPrettier,
];
