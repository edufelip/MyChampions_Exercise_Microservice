/**
 * Unit tests – language normalizer
 */
import { normalizeLanguage } from '../../services/lang-normalizer';

describe('normalizeLanguage', () => {
  it('returns "en" for undefined', () => {
    expect(normalizeLanguage(undefined)).toBe('en');
  });

  it('returns "en" for null', () => {
    expect(normalizeLanguage(null)).toBe('en');
  });

  it('returns "en" for empty string', () => {
    expect(normalizeLanguage('')).toBe('en');
  });

  it('returns "en" for whitespace-only string', () => {
    expect(normalizeLanguage('   ')).toBe('en');
  });

  it('normalizes uppercase "EN" to "en"', () => {
    expect(normalizeLanguage('EN')).toBe('en');
  });

  it('normalizes "eng" (ISO 639-2) to "en"', () => {
    expect(normalizeLanguage('eng')).toBe('en');
  });

  it('normalizes "por" (ISO 639-2) to "pt"', () => {
    expect(normalizeLanguage('por')).toBe('pt');
  });

  it('strips region subtag: "pt-BR" → "pt"', () => {
    expect(normalizeLanguage('pt-BR')).toBe('pt');
  });

  it('strips region subtag: "pt-br" → "pt"', () => {
    expect(normalizeLanguage('pt-br')).toBe('pt');
  });

  it('strips underscore subtag: "zh_TW" → "zh"', () => {
    expect(normalizeLanguage('zh_TW')).toBe('zh');
  });

  it('normalizes "es" to "es"', () => {
    expect(normalizeLanguage('es')).toBe('es');
  });

  it('normalizes "fr" to "fr"', () => {
    expect(normalizeLanguage('fr')).toBe('fr');
  });

  it('normalizes "it" to "it"', () => {
    expect(normalizeLanguage('it')).toBe('it');
  });

  it('returns "en" for unrecognizable garbage', () => {
    expect(normalizeLanguage('123')).toBe('en');
  });

  it('returns "en" for overly long code', () => {
    expect(normalizeLanguage('english')).toBe('en');
  });

  it('passes through known 2-letter codes as-is', () => {
    expect(normalizeLanguage('de')).toBe('de');
    expect(normalizeLanguage('ja')).toBe('ja');
    expect(normalizeLanguage('ko')).toBe('ko');
  });
});
