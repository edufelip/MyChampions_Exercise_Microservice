/**
 * Central configuration module – reads environment variables once and
 * exposes a typed, validated config object. Fails fast if a required
 * variable is missing so the service never starts in a broken state.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function parseIntegerEnv(
  name: string,
  fallback: string,
  constraints: { min?: number; max?: number } = {},
): number {
  const raw = optionalEnv(name, fallback).trim();
  if (!/^-?\d+$/.test(raw)) {
    throw new Error(`Environment variable ${name} must be a valid integer`);
  }
  const parsed = Number.parseInt(raw, 10);

  if (constraints.min !== undefined && parsed < constraints.min) {
    throw new Error(`Environment variable ${name} must be >= ${constraints.min}`);
  }
  if (constraints.max !== undefined && parsed > constraints.max) {
    throw new Error(`Environment variable ${name} must be <= ${constraints.max}`);
  }

  return parsed;
}

export const config = {
  /** TCP port the HTTP server listens on */
  port: parseIntegerEnv('PORT', '3000', { min: 1, max: 65535 }),

  /** Node environment */
  nodeEnv: optionalEnv('NODE_ENV', 'production'),

  /** YMove exercise API key */
  ymoveApiKey: (): string => requireEnv('YMOVE_API_KEY'),

  /** Google Cloud Translation API key */
  googleTranslateApiKey: (): string => requireEnv('GOOGLE_TRANSLATE_API_KEY'),

  /** Redis connection URL */
  redisUrl: optionalEnv('REDIS_URL', 'redis://localhost:6379'),

  /** Cache TTL in seconds for translated exercises (default: 30 days) */
  cacheTtlSeconds: parseIntegerEnv('CACHE_TTL_SECONDS', '2592000', { min: 1 }),

  /** HTTP request timeout in milliseconds for upstream calls */
  upstreamTimeoutMs: parseIntegerEnv('UPSTREAM_TIMEOUT_MS', '10000', { min: 100 }),

  /** HTTP request timeout in milliseconds for translation API calls */
  translationTimeoutMs: parseIntegerEnv('TRANSLATION_TIMEOUT_MS', '10000', { min: 100 }),

  /** Max retries for YMove upstream call on retryable failures */
  upstreamMaxRetries: parseIntegerEnv('UPSTREAM_MAX_RETRIES', '1', { min: 0, max: 5 }),

  /** Max retries for translation API call on retryable failures */
  translationMaxRetries: parseIntegerEnv('TRANSLATION_MAX_RETRIES', '1', { min: 0, max: 5 }),

  /** Rate limiting window in milliseconds */
  rateLimitWindowMs: parseIntegerEnv('RATE_LIMIT_WINDOW_MS', '60000', { min: 1000 }),

  /** Max requests per IP per window */
  rateLimitMax: parseIntegerEnv('RATE_LIMIT_MAX', '100', { min: 1 }),

  /** Number of trusted proxy hops for correct client IP extraction behind Nginx */
  trustProxyHops: parseIntegerEnv('TRUST_PROXY_HOPS', '1', { min: 0 }),

  /** Log level */
  logLevel: optionalEnv('LOG_LEVEL', 'info'),

  /** Allowed upstream host for URL validation */
  allowedUpstreamHost: 'exercise-api.ymove.app',

  /** Allowed upstream path prefix for URL validation */
  allowedUpstreamPath: '/api/v2/exercises',

  /** Maximum forwarded URL length */
  maxForwardUrlLength: parseIntegerEnv('MAX_FORWARD_URL_LENGTH', '2048', { min: 64, max: 8192 }),

  /** Maximum accepted search query length */
  maxSearchLength: parseIntegerEnv('MAX_SEARCH_LENGTH', '200', { min: 1, max: 2000 }),

  /** Google Translate API base URL */
  googleTranslateApiUrl: optionalEnv(
    'GOOGLE_TRANSLATE_API_URL',
    'https://translation.googleapis.com/language/translate/v2',
  ),
} as const;
