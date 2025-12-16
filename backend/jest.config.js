module.exports = {
  preset: './node_modules/ts-jest/presets/default/jest-preset.js',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/__tests__/**',
  ],
  moduleNameMapper: {
    '^openai$': '<rootDir>/src/__mocks__/openai.ts',
    '^axios$': '<rootDir>/src/__mocks__/axios.ts',
    '^json2csv$': '<rootDir>/src/__mocks__/json2csv.ts',
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  verbose: true,
  coverageDirectory: 'coverage',
  testTimeout: 30000,
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],
};
