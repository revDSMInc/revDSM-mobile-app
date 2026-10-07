import React, { createContext, useContext, useMemo, useEffect } from 'react';
import { useColorScheme } from 'nativewind';
import { PALETTE } from './theme';

type ThemeMode = 'light' | 'dark';
type ThemeColors = typeof PALETTE & {
  background: string;
  surface: string;
  text: string;
  textSecondary: string;
  border: string;
  card: string;
};

interface ThemeContextValue {
  mode: ThemeMode;
  colors: ThemeColors;
  isDark: boolean;
  setColorScheme: (scheme: ThemeMode | 'system') => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'dark',
  colors: { ...PALETTE, ...PALETTE.dark },
  isDark: true,
  setColorScheme: () => {},
});

export const useTheme = () => useContext(ThemeContext);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { setColorScheme } = useColorScheme();

  useEffect(() => {
    setColorScheme('light');
  }, [setColorScheme]);

  const isDark = false;
  const mode: ThemeMode = 'light';

  const colors = useMemo(
    () => ({
      ...PALETTE,
      ...PALETTE.light,
    }),
    []
  );

  const value = useMemo(
    () => ({
      mode,
      colors,
      isDark,
      setColorScheme: () => {}, // Disable setting dark mode temporarily
    }),
    [colors]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
