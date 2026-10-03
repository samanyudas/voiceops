import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'artifacts/**', 'coverage/**'] },
  { files: ['**/*.mjs'], ...js.configs.recommended, languageOptions: { globals: globals.node } },
  ...tseslint.configs.strict,
  { files: ['**/*.ts'], rules: {
    '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
    '@typescript-eslint/no-non-null-assertion': 'error',
    '@typescript-eslint/no-explicit-any': 'error'
  } }
];
