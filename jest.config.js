module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  // End-to-end tests need a running server and have their own configuration
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/tests/e2e/'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tests/tsconfig.json' }],
    // json-schema-ref-parser (used by swagger-parser) only ships ES modules
    '/node_modules/@apidevtools/json-schema-ref-parser/.+\\.js$': [
      'ts-jest',
      { tsconfig: { allowJs: true, module: 'commonjs' } }
    ],
  },
  transformIgnorePatterns: [
    'node_modules/(?!(jsdom|parse5|whatwg-.*|entities|dom-serializer|domhandler|htmlparser2|@apidevtools/json-schema-ref-parser)/)'
  ],
  collectCoverageFrom: [
    'src/**/*.ts',
    'src/widgets/**/*.js',
    '!src/**/*.d.ts',
    '!src/main.ts'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'text-summary', 'lcov', 'json-summary'],
  // Set slightly below the measured coverage so that any regression fails CI
  coverageThreshold: {
    global: {
      statements: 95,
      branches: 85,
      functions: 95,
      lines: 95
    },
    './src/server/': {
      statements: 98,
      branches: 90,
      functions: 98,
      lines: 98
    }
  },
  clearMocks: true,
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  testTimeout: 10000,
  verbose: true
};
