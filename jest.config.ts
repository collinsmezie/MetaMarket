import type { Config } from 'jest';

const moduleNameMapper = {
  '^@test/(.*)$': '<rootDir>/test/$1',
};

const transform: Config['transform'] = {
  // `isolatedModules` is set in tsconfig.json, not here: the ts-jest option is deprecated.
  '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
};

const config: Config = {
  rootDir: '.',
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.module.ts', '!src/main.ts'],
  coverageDirectory: 'coverage',
  projects: [
    {
      displayName: 'unit',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/src/**/*.spec.ts'],
      moduleNameMapper,
      transform,
      setupFilesAfterEnv: ['<rootDir>/test/setup-unit.ts'],
    },
    {
      displayName: 'integration',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/test/**/*.test.ts'],
      moduleNameMapper,
      transform,
      // Timeout is raised inside setup-integration.ts: `testTimeout` is not a valid
      // per-project option in Jest's config types.
      setupFilesAfterEnv: ['<rootDir>/test/setup-integration.ts'],
    },
  ],
};

export default config;
