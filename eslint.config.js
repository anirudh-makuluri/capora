import js from '@eslint/js';
import tseslint from 'typescript-eslint';
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.wrangler/**',
      '.local/**',
      'test-results/**',
      'playwright-report/**',
      'apps/worker/worker-configuration.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['apps/worker/src/**/*.ts', 'packages/mcp/src/**/*.ts'],
    languageOptions: {
      parserOptions: { project: './apps/worker/tsconfig.json', tsconfigRootDir: import.meta.dirname },
    },
    rules: { '@typescript-eslint/no-floating-promises': 'error' },
  },
  {
    files: ['apps/worker/src/**/*.ts'],
    ignores: ['apps/worker/src/services/storage.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "MemberExpression[property.name='ARTIFACTS'], MemberExpression[property.value='ARTIFACTS']",
          message:
            'Use the storage service so every R2 call reserves its usage budget before accessing the bucket.',
        },
      ],
    },
  },
);
