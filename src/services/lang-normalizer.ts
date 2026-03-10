/**
 * Language normalizer.
 *
 * Normalizes incoming language codes to BCP-47 base tags (e.g. "pt").
 * Falls back to "en" when the code is missing or unrecognizable.
 */

/** Map of non-standard or alias codes to their canonical form */
const LANG_ALIASES: Record<string, string> = {
  eng: 'en',
  por: 'pt',
  spa: 'es',
  fra: 'fr',
  ita: 'it',
  deu: 'de',
  zho: 'zh',
  jpn: 'ja',
  kor: 'ko',
  rus: 'ru',
  ara: 'ar',
};

/**
 * Normalize a language code to its BCP-47 base tag.
 *
 * Rules:
 *  - Strip whitespace, lowercase.
 *  - Strip region subtag (e.g. "pt-BR" → "pt").
 *  - Resolve 3-letter ISO 639-2 aliases (e.g. "eng" → "en").
 *  - Return "en" if empty or unrecognizable.
 */
export function normalizeLanguage(lang: string | undefined | null): string {
  if (!lang || typeof lang !== 'string') {
    return 'en';
  }

  const trimmed = lang.trim().toLowerCase();

  if (trimmed.length === 0) {
    return 'en';
  }

  // Strip region subtag (e.g. "pt-BR" → "pt", "zh_TW" → "zh")
  const base = trimmed.split(/[-_]/)[0];

  // Resolve known aliases
  if (LANG_ALIASES[base]) {
    return LANG_ALIASES[base];
  }

  // Must be 2 or 3 lowercase alpha chars to be valid
  if (/^[a-z]{2,3}$/.test(base)) {
    return base;
  }

  return 'en';
}
