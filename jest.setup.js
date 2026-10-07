jest.mock('react-native-gesture-handler', () => {
  const View = require('react-native').View;
  return {
    GestureHandlerRootView: View,
    Gesture: {
      Pan: () => ({}),
      Tap: () => ({}),
      Pinch: () => ({}),
      Rotation: () => ({}),
      LongPress: () => ({}),
      Fling: () => ({}),
      Native: () => ({}),
    },
    GestureDetector: ({ children }) => children,
    State: { ACTIVE: 1, END: 2, FAILED: 3, UNDETERMINED: 0, BEGAN: 4, CANCELLED: 5 },
  };
});

jest.mock('react-native-safe-area-context', () => {
  const insets = { top: 0, right: 0, bottom: 0, left: 0 };
  return {
    SafeAreaProvider: ({ children }) => children,
    SafeAreaView: ({ children }) => children,
    useSafeAreaInsets: () => insets,
    initialWindowMetrics: { insets, frame: { x: 0, y: 0, width: 390, height: 844 } },
  };
});

jest.mock('@react-navigation/native', () => ({
  NavigationContainer: ({ children }) => children,
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), reset: jest.fn(), dispatch: jest.fn() }),
  useRoute: () => ({ params: {} }),
  useFocusEffect: jest.fn(),
  useIsFocused: () => true,
}));

jest.mock('react-native-keyboard-controller', () => ({
  KeyboardProvider: ({ children }) => children,
  useKeyboardAnimation: () => ({ height: 0, progress: 0 }),
  useReanimatedKeyboardAnimation: () => ({ height: { value: 0 }, progress: { value: 0 } }),
}));

jest.mock('react-native-flash-message', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: ({ children }) => View({ children }),
    showMessage: jest.fn(),
    hideMessage: jest.fn(),
  };
});

jest.mock('react-native-mmkv');

jest.mock('react-native-geolocation-service', () => ({
  __esModule: true,
  default: {
    getCurrentPosition: jest.fn(),
    watchPosition: jest.fn(() => 0),
    clearWatch: jest.fn(),
    stopObserving: jest.fn(),
    requestAuthorization: jest.fn(() => Promise.resolve('granted')),
  },
}));
