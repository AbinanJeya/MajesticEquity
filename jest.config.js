/**
 * Jest Configuration
 */
module.exports = {
    testEnvironment: 'node',
    testMatch: ['**/test/**/*.test.js'],
    collectCoverageFrom: [
        'services/**/*.js',
        'middlewares/**/*.js',
        'utils/**/*.js',
        'models/**/*.js'
    ],
    coverageDirectory: 'coverage',
    verbose: true,
    testTimeout: 10000
};
