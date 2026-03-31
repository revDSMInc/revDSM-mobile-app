import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { PALETTE } from '../../shared/config/theme';

type ThemeMode = 'light' | 'dark';
type ThemeColors = typeof PALETTE.light;

interface ThemeContextValue {
  mode: ThemeMode;
  colors: ThemeColors;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'dark',
  colors: PALETTE.dark,
  isDark: true,
});

export const useTheme = () => useContext(ThemeContext);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const mode: ThemeMode = isDark ? 'dark' : 'light';
  const colors = isDark ? PALETTE.dark : PALETTE.light;

  const value = useMemo(() => ({ mode, colors, isDark }), [mode, colors, isDark]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
