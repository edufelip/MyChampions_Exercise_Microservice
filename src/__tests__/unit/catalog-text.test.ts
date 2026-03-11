import {
  buildTokenPrefixes,
  levenshteinDistance,
  normalizeSearchText,
  tokenizeSearchText,
} from '../../services/catalog-text';

describe('catalog-text', () => {
  it('normalizes accents and punctuation', () => {
    expect(normalizeSearchText('  Supíno!!!  ')).toBe('supino');
  });

  it('tokenizes normalized text with minimum token length', () => {
    expect(tokenizeSearchText('A B Supino reto')).toEqual(['supino', 'reto']);
  });

  it('builds prefixes from 2 chars onward', () => {
    expect(buildTokenPrefixes('supino')).toEqual(['su', 'sup', 'supi', 'supin', 'supino']);
  });

  it('computes levenshtein distance', () => {
    expect(levenshteinDistance('supino', 'supnio')).toBe(2);
    expect(levenshteinDistance('agacha', 'agacha')).toBe(0);
  });
});
