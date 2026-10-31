export default {
  testEnvironment: 'node',
  transform: {},
  testTimeout: 60000,
  collectCoverageFrom: ['src/**/*.js', '!src/server.js'],
  coverageDirectory: '../coverage/server',
  coverageThreshold: { global: { statements: 80, branches: 75, functions: 80, lines: 80 } },
};
