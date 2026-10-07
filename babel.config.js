module.exports = {
  presets: ['module:@react-native/babel-preset', 'nativewind/babel'],
  plugins: [
    [
      'module:react-native-dotenv',
      { moduleName: '@env', path: '.env', safe: false, allowUndefined: true },
    ],
    'react-native-worklets/plugin',
  ],
};
