import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Storage } from '../utils/storage';
import { useUserRole } from '../hooks/useUserRole';
import {
  DICTIONARIES,
  type Language,
  type TranslationKey,
} from './translations';

const STORAGE_KEY = 'app:language';

export type TranslationValues = Record<string, string | number>;

interface LanguageContextValue {
  language: Language;
  setLanguage: (next: Language) => void;
  toggleLanguage: () => void;
  t: (key: TranslationKey, values?: TranslationValues) => string;
  isSpanish: boolean;
  canSwitchLanguage: boolean;
}

const readStoredLanguage = (): Language => {
  try {
    return Storage.getItem(STORAGE_KEY) === 'es' ? 'es' : 'en';
  } catch {
    return 'en';
  }
};

const lookup = (language: Language, key: TranslationKey): string | undefined => {
  const [group, name] = key.split('.') as [keyof typeof DICTIONARIES.en, string];
  const value = (DICTIONARIES[language] as any)?.[group]?.[name];
  return typeof value === 'string' ? value : undefined;
};

const fill = (template: string, values?: TranslationValues): string => {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name) =>
    values[name] === undefined ? whole : String(values[name])
  );
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [stored, setStoredLanguage] = useState<Language>(readStoredLanguage);
  const { isInstaller } = useUserRole();

  const language: Language = isInstaller ? stored : 'en';

  const setLanguage = useCallback((next: Language) => {
    setStoredLanguage(next);
    try {
      Storage.setItem(STORAGE_KEY, next);
    } catch (err) {
      console.warn('[i18n] Could not persist the language choice:', err);
    }
  }, []);

  const value = useMemo<LanguageContextValue>(() => {
    const t = (key: TranslationKey, values?: TranslationValues): string => {
      const template = lookup(language, key) ?? lookup('en', key) ?? key;
      return fill(template, values);
    };

    return {
      language,
      setLanguage,
      toggleLanguage: () => setLanguage(language === 'en' ? 'es' : 'en'),
      t,
      isSpanish: language === 'es',
      canSwitchLanguage: isInstaller,
    };
  }, [language, setLanguage, isInstaller]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useTranslation(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (ctx) return ctx;

  return {
    language: 'en',
    setLanguage: () => {},
    toggleLanguage: () => {},
    t: (key, values) => fill(lookup('en', key) ?? key, values),
    isSpanish: false,
    canSwitchLanguage: false,
  };
}
