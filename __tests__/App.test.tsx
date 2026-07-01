/**
 * @format
 */

jest.mock('../src/redux/store', () => ({
  store: { getState: () => ({}), dispatch: jest.fn(), subscribe: jest.fn() },
  persistor: { getState: () => ({}), flush: jest.fn(), purge: jest.fn(), subscribe: jest.fn() },
}));

jest.mock('../src/theme/ThemeProvider', () => ({
  ThemeProvider: ({ children }: any) => children,
  useTheme: () => ({ theme: 'light', toggleTheme: jest.fn(), colors: {} }),
  default: ({ children }: any) => children,
}));

jest.mock('../src/navigation', () => ({
  __esModule: true,
  default: () => null,
  navigationRef: { current: null, navigate: jest.fn(), goBack: jest.fn() },
}));

jest.mock('../src/hooks/useAppInitialization', () => ({
  useAppInitialization: () => ({ isReady: true }),
}));

jest.mock('../src/hooks/useSocketManager', () => ({
  useSocketManager: () => ({ connected: false }),
}));

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

test('renders correctly', async () => {
  await ReactTestRenderer.act(() => {
    ReactTestRenderer.create(<App />);
  });
});
