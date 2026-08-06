/**
 * Architecture boundaries from ADR-001 are enforced here, not just documented.
 *
 * The domain core must stay free of frameworks, drivers and channel SDKs so it can be
 * unit-tested in isolation and so channels/providers remain swappable.
 */
const FRAMEWORK_AND_DRIVER_PACKAGES = [
  '@nestjs/*',
  '@prisma/*',
  'prisma',
  'ioredis',
  'bullmq',
  'openai',
  '@anthropic-ai/*',
  '@google/*',
  'express',
  'pino',
  'nestjs-pino',
  'axios',
];

module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint/eslint-plugin'],
  extends: ['plugin:@typescript-eslint/recommended', 'plugin:prettier/recommended'],
  root: true,
  env: { node: true, jest: true },
  ignorePatterns: ['.eslintrc.js', 'dist/**', 'coverage/**', 'node_modules/**'],
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    // Execution.md §2.7: no `any` types.
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
  },
  overrides: [
    {
      // The hexagon centre: pure business logic only.
      files: ['src/domain/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: FRAMEWORK_AND_DRIVER_PACKAGES,
                message:
                  'ADR-001: the domain core must not depend on frameworks, DB drivers or provider SDKs. Depend on a port in src/domain/ports/outbound instead.',
              },
              {
                group: ['**/adapters/**', '**/application/**', '**/config/**'],
                message:
                  'ADR-001: the domain core must not import adapters, application wiring or config. Dependencies point inward only.',
              },
            ],
          },
        ],
      },
    },
    {
      // Adapters translate payloads. Business logic and AI calls belong elsewhere.
      files: ['src/adapters/inbound/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['**/domain/workflows/**', '**/adapters/outbound/llm/**'],
                message:
                  'Execution.md §2.1: channel adapters must not execute workflows or call AI directly. Invoke an inbound port.',
              },
            ],
          },
        ],
      },
    },
    {
      files: ['**/*.spec.ts', '**/*.test.ts', 'test/**/*.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        'no-restricted-imports': 'off',
      },
    },
  ],
};
