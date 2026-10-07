module.exports = {
  preset: 'react-native',
  testMatch: ['**/?(*.)+(spec|test).[jt]s?(x)'],
  moduleNameMapper: {
    '\\.css$': '<rootDir>/__mocks__/styleMock.js',
    '^test-renderer$': '<rootDir>/__mocks__/test-renderer.js',
  },
  setupFiles: ['./jest.setup.js'],
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|react-native-.*|@react-native-community|@react-native-prompt|@react-native-menu|react-redux|redux-persist|@react-navigation|@tanstack|immer)/)',
  ],
};
