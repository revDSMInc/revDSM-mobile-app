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
  const { colorScheme, setColorScheme } = useColorScheme();

  const isDark = colorScheme === 'dark';
  const mode: ThemeMode = isDark ? 'dark' : 'light';

  const colors = useMemo(
    () => ({
      ...PALETTE,
      ...(isDark ? PALETTE.dark : PALETTE.light),
    }),
    [isDark]
  );

  const value = useMemo(
    () => ({
      mode,
      colors,
      isDark,
      setColorScheme: (scheme: any) => setColorScheme(scheme),
    }),
    [mode, colors, isDark, setColorScheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
