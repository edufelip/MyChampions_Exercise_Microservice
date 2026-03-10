/**
 * URL validator and query parameter manipulator.
 *
 * Validates that forwarded URLs target the allowed YMove host/path,
 * and provides helpers to extract and replace the search query parameter.
 */
import { config } from '../config';

export class UrlValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UrlValidationError';
  }
}

/**
 * Validate that the URL targets the allowed upstream host and path.
 *
 * @throws UrlValidationError if the URL is invalid or not allowed.
 */
export function validateUpstreamUrl(rawUrl: string): URL {
  if (rawUrl.length > config.maxForwardUrlLength) {
    throw new UrlValidationError(
      `URL length exceeds maximum of ${config.maxForwardUrlLength} characters.`,
    );
  }

  let parsed: URL;

  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new UrlValidationError(`Invalid URL: "${rawUrl}"`);
  }

  if (parsed.protocol !== 'https:') {
    throw new UrlValidationError('Only HTTPS URLs are allowed.');
  }

  if (parsed.hostname !== config.allowedUpstreamHost) {
    throw new UrlValidationError(
      `Forbidden host "${parsed.hostname}". Only "${config.allowedUpstreamHost}" is allowed.`,
    );
  }

  if (!parsed.pathname.startsWith(config.allowedUpstreamPath)) {
    throw new UrlValidationError(
      `Forbidden path "${parsed.pathname}". Only paths under "${config.allowedUpstreamPath}" are allowed.`,
    );
  }

  if (parsed.username || parsed.password) {
    throw new UrlValidationError('User info in URL is not allowed.');
  }

  if (parsed.port !== '' && parsed.port !== '443') {
    throw new UrlValidationError('Only default HTTPS port is allowed.');
  }

  return parsed;
}

/**
 * Extract the `search` query parameter from a URL.
 *
 * @returns The raw search string, or empty string if not present.
 */
export function extractSearchParam(url: URL): string {
  return url.searchParams.get('search') ?? '';
}

/**
 * Replace the `search` query parameter in a URL and return the updated URL string.
 */
export function replaceSearchParam(url: URL, newSearch: string): string {
  const updated = new URL(url.toString());
  if (newSearch) {
    updated.searchParams.set('search', newSearch);
  } else {
    updated.searchParams.delete('search');
  }
  return updated.toString();
}
