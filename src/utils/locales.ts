import type { AppLocaleId } from '../types';

/** Locale ids the app accepts, in the order they are preferred for detection. */
export const APP_LOCALE_IDS: readonly AppLocaleId[] = [
  'en', 'zh', 'zh-TW', 'ko', 'ja', 'fr', 'de', 'es', 'it', 'uk', 'ru', 'pt', 'vi',
];

const APP_LOCALE_ID_SET = new Set<AppLocaleId>(APP_LOCALE_IDS);

export function isAppLocaleId(value: unknown): value is AppLocaleId {
  return typeof value === 'string' && APP_LOCALE_ID_SET.has(value as AppLocaleId);
}

function appLocaleFromLanguageTag(languageTag: unknown): AppLocaleId | null {
  if (typeof languageTag !== 'string') return null;
  const normalized = languageTag.trim().toLowerCase().replace('_', '-');
  if (!normalized) return null;
  // Traditional-Chinese tags (zh-TW / zh-HK / zh-Hant) resolve to the Traditional locale;
  // any other zh-* falls through to Simplified below.
  if (/^zh-(tw|hk|mo|hant)/.test(normalized)) return 'zh-TW';
  const [baseLanguage] = normalized.split('-');
  if (!baseLanguage) return null;
  return isAppLocaleId(baseLanguage) ? baseLanguage : null;
}

export function getPreferredAppLocaleId(languageTags?: readonly unknown[]): AppLocaleId {
  const candidates = languageTags ?? (
    typeof navigator === 'undefined'
      ? []
      : [...(navigator.languages ?? []), navigator.language]
  );

  for (const languageTag of candidates) {
    const locale = appLocaleFromLanguageTag(languageTag);
    if (locale) return locale;
  }

  return 'en';
}
