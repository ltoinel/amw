// End-to-end tests run against the compiled server (npm run build first),
// hence a dedicated config kept out of the default `npm test` run.
module.exports = {
  rootDir: '../..',
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests/e2e'],
  testMatch: ['**/*.e2e.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tests/tsconfig.json' }],
  },
  // Each suite spawns its own server; running them serially avoids CPU contention on startup
  maxWorkers: 1,
  testTimeout: 30000,
  verbose: true
};
