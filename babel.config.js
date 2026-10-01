module.exports = {
  presets: ['module:@react-native/babel-preset', 'nativewind/babel'],
  plugins: [
    // ⚠️ MUST BE LAST. The worklets plugin rewrites every function marked as a
    // worklet, so any plugin listed after it runs against already-transformed
    // output and can silently undo the rewrite.
    //
    // ⚠️ `react-native-worklets/plugin`, NOT `react-native-reanimated/plugin`.
    // Reanimated 4 moved worklet transformation out into `react-native-worklets`
    // (both are installed here: reanimated 4.4.1, worklets 0.9.1). With the
    // plugin missing entirely — which is how this branch arrived — the app does
    // not fail to build, it SIGABRTs at launch with
    // `getValueUnpacker: assertion failed`, so it reads as a native crash
    // rather than a config problem.
    'react-native-worklets/plugin',
  ],
};
