/**
 * Cache service – wraps Redis operations for exercise translation caching.
 *
 * Key format: exercise:{exerciseId}:{lang}
 * TTL: configurable (default 30 days)
 *
 * All operations degrade gracefully: if Redis is unavailable, the error
 * is logged and the caller receives a cache miss.
 */
import { getRedisClient } from '../infrastructure/redis-client';
import { TranslatedFieldsDTO } from '../domain/dtos';
import { config } from '../config';
import { logger } from '../logger';

function cacheKey(exerciseId: string, lang: string): string {
  return `exercise:${exerciseId}:${lang}`;
}

/**
 * Retrieve cached translated fields for an exercise, or null on miss/error.
 */
export async function getCachedTranslation(
  exerciseId: string,
  lang: string,
): Promise<TranslatedFieldsDTO | null> {
  const redis = getRedisClient();
  const key = cacheKey(exerciseId, lang);

  try {
    const raw = await redis.get(key);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as TranslatedFieldsDTO;
  } catch (err) {
    logger.warn({ key, err: String(err) }, 'Redis GET failed – cache miss');
    return null;
  }
}

/**
 * Store translated fields for an exercise in Redis.
 *
 * Failures are silently swallowed so the service continues without caching.
 */
export async function setCachedTranslation(
  exerciseId: string,
  lang: string,
  fields: TranslatedFieldsDTO,
): Promise<void> {
  const redis = getRedisClient();
  const key = cacheKey(exerciseId, lang);

  try {
    await redis.set(key, JSON.stringify(fields), 'EX', config.cacheTtlSeconds);
  } catch (err) {
    logger.warn({ key, err: String(err) }, 'Redis SET failed – skipping cache write');
  }
}
