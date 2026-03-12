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

function optionalNullableEnv(name: string): string | null {
  const raw = process.env[name];
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
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

function parseFloatEnv(
  name: string,
  fallback: string,
  constraints: { min?: number; max?: number } = {},
): number {
  const raw = optionalEnv(name, fallback).trim();
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${name} must be a valid number`);
  }

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

  /** Catalog behavior toggle */
  catalogEnabled: optionalEnv('CATALOG_ENABLED', 'true').toLowerCase() !== 'false',

  /** Re-sync interval for the catalog in milliseconds */
  catalogSyncIntervalMs: parseIntegerEnv('CATALOG_SYNC_INTERVAL_MS', '15552000000', { min: 60000 }),

  /** Page size used while ingesting YMove exercises */
  catalogSyncPageSize: parseIntegerEnv('CATALOG_SYNC_PAGE_SIZE', '100', { min: 1, max: 500 }),

  /** Number of curated seed exercise names to use during sync */
  catalogSeedQueryLimit: parseIntegerEnv('CATALOG_SEED_QUERY_LIMIT', '80', { min: 1, max: 500 }),

  /** Max pages fetched per curated seed query during sync */
  catalogSeedMaxPages: parseIntegerEnv('CATALOG_SEED_MAX_PAGES', '1', { min: 1, max: 20 }),

  /** Minimum query length before prefix/typo search */
  catalogMinQueryLength: parseIntegerEnv('CATALOG_MIN_QUERY_LENGTH', '1', { min: 0, max: 64 }),

  /** Maximum edit distance used for typo tolerant matching */
  catalogTypoDistance: parseIntegerEnv('CATALOG_TYPO_DISTANCE', '1', { min: 0, max: 2 }),

  /** Optional shared secret required for /catalog/review */
  catalogReviewApiKey: optionalNullableEnv('CATALOG_REVIEW_API_KEY'),

  /** Number of catalog versions to keep in Redis (including active one) */
  catalogVersionRetention: parseIntegerEnv('CATALOG_VERSION_RETENTION', '2', { min: 1, max: 20 }),

  /** Whether to trigger a catalog sync at startup */
  catalogSyncOnStartup: optionalEnv('CATALOG_SYNC_ON_STARTUP', 'true').toLowerCase() !== 'false',

  /** Background interval to re-check catalog freshness */
  catalogSyncBackgroundIntervalMs: parseIntegerEnv('CATALOG_SYNC_BACKGROUND_INTERVAL_MS', '900000', {
    min: 60000,
  }),

  /** Cooldown window for startup-triggered sync attempts */
  catalogStartupSyncCooldownMs: parseIntegerEnv('CATALOG_STARTUP_SYNC_COOLDOWN_MS', '15552000000', {
    min: 60000,
  }),

  /** Enable shadow comparison between proxy and catalog search */
  catalogShadowValidationEnabled: optionalEnv('CATALOG_SHADOW_VALIDATION_ENABLED', 'false').toLowerCase() === 'true',

  /** Sample rate [0..1] for shadow comparisons */
  catalogShadowSampleRate: parseFloatEnv('CATALOG_SHADOW_SAMPLE_RATE', '0.1', { min: 0, max: 1 }),
} as const;
