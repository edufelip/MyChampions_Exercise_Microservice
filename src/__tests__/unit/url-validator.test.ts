/**
 * Unit tests – URL validator
 */
import {
  validateUpstreamUrl,
  extractSearchParam,
  replaceSearchParam,
  UrlValidationError,
} from '../../services/url-validator';

describe('validateUpstreamUrl', () => {
  it('accepts a valid YMove exercises URL', () => {
    const url = 'https://exercise-api.ymove.app/api/v2/exercises?pageSize=20&search=Press';
    const parsed = validateUpstreamUrl(url);
    expect(parsed.hostname).toBe('exercise-api.ymove.app');
  });

  it('throws UrlValidationError for an invalid URL', () => {
    expect(() => validateUpstreamUrl('not-a-url')).toThrow(UrlValidationError);
  });

  it('throws UrlValidationError for a forbidden host', () => {
    expect(() =>
      validateUpstreamUrl('https://evil.example.com/api/v2/exercises'),
    ).toThrow(UrlValidationError);
  });

  it('throws UrlValidationError for a forbidden path', () => {
    expect(() =>
      validateUpstreamUrl('https://exercise-api.ymove.app/admin/reset'),
    ).toThrow(UrlValidationError);
  });

  it('accepts paths that start with the allowed prefix', () => {
    const url = 'https://exercise-api.ymove.app/api/v2/exercises/123';
    expect(() => validateUpstreamUrl(url)).not.toThrow();
  });
});

describe('extractSearchParam', () => {
  it('extracts the search parameter', () => {
    const url = new URL('https://exercise-api.ymove.app/api/v2/exercises?search=Supino&pageSize=20');
    expect(extractSearchParam(url)).toBe('Supino');
  });

  it('returns empty string when search param is absent', () => {
    const url = new URL('https://exercise-api.ymove.app/api/v2/exercises?pageSize=20');
    expect(extractSearchParam(url)).toBe('');
  });
});

describe('replaceSearchParam', () => {
  it('replaces the search parameter', () => {
    const url = new URL('https://exercise-api.ymove.app/api/v2/exercises?search=Supino&pageSize=20');
    const result = replaceSearchParam(url, 'Bench Press');
    expect(result).toContain('search=Bench+Press');
    expect(result).toContain('pageSize=20');
  });

  it('removes the search parameter when replacement is empty', () => {
    const url = new URL('https://exercise-api.ymove.app/api/v2/exercises?search=Supino');
    const result = replaceSearchParam(url, '');
    expect(result).not.toContain('search=');
  });

  it('adds search param when it was not present', () => {
    const url = new URL('https://exercise-api.ymove.app/api/v2/exercises?pageSize=10');
    const result = replaceSearchParam(url, 'Squat');
    expect(result).toContain('search=Squat');
  });
});
