/**
 * App language — English ⇄ Spanish.
 *
 * Deliberately dependency-free. `i18next` would bring a plugin chain, a detector and an
 * async init for what is, here, two flat dictionaries and one switch; the whole engine
 * fits in this file, and swapping it for i18next later means changing `t()` and nothing
 * that calls it.
 *
 * The choice is persisted to MMKV under the same `Storage` the rest of the app uses, and
 * read SYNCHRONOUSLY on first render — so a crew that picked Spanish never sees the app
 * flash English on launch.
 */

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Storage } from '../utils/storage';
import { useUserRole } from '../hooks/useUserRole';
import {
  DICTIONARIES,
  type Language,
  type TranslationKey,
} from './translations';

const STORAGE_KEY = 'app:language';

/** Values a `{placeholder}` can be filled with. */
export type TranslationValues = Record<string, string | number>;

interface LanguageContextValue {
  language: Language;
  setLanguage: (next: Language) => void;
  /** English ⇄ Spanish, for the one-tap row in the account menu. */
  toggleLanguage: () => void;
  t: (key: TranslationKey, values?: TranslationValues) => string;
  isSpanish: boolean;
  /**
   * Whether this user may switch language at all. False on the sales side — the account
   * menu hides its language row when this is false.
   */
  canSwitchLanguage: boolean;
}

const readStoredLanguage = (): Language => {
  try {
    return Storage.getItem(STORAGE_KEY) === 'es' ? 'es' : 'en';
  } catch {
    return 'en';
  }
};

/**
 * Looks a dotted key up in one dictionary. Returns undefined rather than the key itself,
 * so the caller can decide to fall back to English.
 */
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

  /**
   * Spanish is an INSTALLER feature.
   *
   * Enforced here rather than only by hiding the toggle: the choice is persisted per
   * DEVICE, so on a shared phone a sales rep signing in after an installer would have
   * inherited Spanish with no row left to switch it back — locked into a language they
   * never chose. Resolving it centrally means one rule instead of a hidden button and a
   * trap behind it.
   */
  const language: Language = isInstaller ? stored : 'en';

  const setLanguage = useCallback((next: Language) => {
    setStoredLanguage(next);
    try {
      Storage.setItem(STORAGE_KEY, next);
    } catch (err) {
      // The switch still applies for this session; only the memory of it is lost.
      console.warn('[i18n] Could not persist the language choice:', err);
    }
  }, []);

  const value = useMemo<LanguageContextValue>(() => {
    const t = (key: TranslationKey, values?: TranslationValues): string => {
      // English is the fallback for anything Spanish hasn't got yet, and the key itself
      // is the last resort — a visible `installer.tabAll` on screen is a bug report,
      // which is better than a blank label nobody notices.
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

/**
 * `const { t } = useTranslation()`.
 *
 * Safe outside the provider — falls back to English rather than throwing, so a screen
 * rendered in a test or a detached tree still shows real words.
 */
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
