module.exports = {
  preset: 'react-native',
  moduleNameMapper: {
    '\\.css$': '<rootDir>/__mocks__/styleMock.js',
    // @testing-library/react-native v14 imports `test-renderer` (React 19
    // rename) for createRoot; react-test-renderer doesn't expose the same
    // API shape, so we provide a shim in __mocks__/test-renderer.js
    '^test-renderer$': '<rootDir>/__mocks__/test-renderer.js',
  },
  setupFiles: ['./jest.setup.js'],
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|react-native-.*|@react-native-community|@react-native-prompt|@react-native-menu|react-redux|redux-persist|@react-navigation|@tanstack|immer)/)',
  ],
};
