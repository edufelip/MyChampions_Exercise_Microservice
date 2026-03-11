/**
 * Text normalization helpers used by catalog search indexing and querying.
 */

const TOKEN_MIN_LENGTH = 2;
const PREFIX_MAX_LENGTH = 32;

export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenizeSearchText(value: string): string[] {
  const normalized = normalizeSearchText(value);
  if (!normalized) {
    return [];
  }

  return normalized
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= TOKEN_MIN_LENGTH);
}

export function buildTokenPrefixes(token: string): string[] {
  const safeToken = token.trim();
  if (safeToken.length < TOKEN_MIN_LENGTH) {
    return [];
  }

  const cappedLength = Math.min(safeToken.length, PREFIX_MAX_LENGTH);
  const prefixes: string[] = [];

  for (let i = TOKEN_MIN_LENGTH; i <= cappedLength; i++) {
    prefixes.push(safeToken.slice(0, i));
  }

  return prefixes;
}

export function levenshteinDistance(a: string, b: string): number {
  if (a === b) {
    return 0;
  }

  if (a.length === 0) {
    return b.length;
  }

  if (b.length === 0) {
    return a.length;
  }

  const prev: number[] = new Array(b.length + 1);
  const curr: number[] = new Array(b.length + 1);

  for (let j = 0; j <= b.length; j++) {
    prev[j] = j;
  }

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;

    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost,
      );
    }

    for (let j = 0; j <= b.length; j++) {
      prev[j] = curr[j];
    }
  }

  return prev[b.length];
}
