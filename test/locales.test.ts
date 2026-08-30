import { describe, expect, it } from 'vitest';
import { APP_LOCALE_IDS, getPreferredAppLocaleId, isAppLocaleId } from '../src/utils/locales';

describe('app locales', () => {
  it('covers the supported locale ids', () => {
    expect(APP_LOCALE_IDS).toEqual([
      'en', 'zh', 'zh-TW', 'ko', 'ja', 'fr', 'de', 'es', 'it', 'uk', 'ru', 'pt', 'vi',
    ]);
  });

  it('validates persisted locale ids defensively', () => {
    expect(isAppLocaleId('en')).toBe(true);
    expect(isAppLocaleId('it')).toBe(true);
    expect(isAppLocaleId('pt')).toBe(true);
    expect(isAppLocaleId('nl')).toBe(false); // Dutch is not a supported locale
    expect(isAppLocaleId(null)).toBe(false);
  });

  it('chooses the first supported browser language before falling back to English', () => {
    expect(getPreferredAppLocaleId(['fr-CA', 'en-US'])).toBe('fr');
    expect(getPreferredAppLocaleId(['pt-BR', 'zh-TW'])).toBe('pt');
    expect(getPreferredAppLocaleId(['zh-CN'])).toBe('zh');
    expect(getPreferredAppLocaleId(['nl-NL', 'zh-TW'])).toBe('zh-TW'); // skips unsupported Dutch
    expect(getPreferredAppLocaleId(['de_DE'])).toBe('de');
    expect(getPreferredAppLocaleId(['', null, 'nl-NL'])).toBe('en'); // no supported lang → English
  });
});
