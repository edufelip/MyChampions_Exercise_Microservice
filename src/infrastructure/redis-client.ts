/**
 * Redis client wrapper.
 *
 * Creates and exports a lazily-connected ioredis instance. The client
 * degrades gracefully: if Redis is unavailable, operations reject and the
 * service continues without caching.
 */
import Redis from 'ioredis';
import { config } from '../config';
import { logger } from '../logger';

let _client: Redis | null = null;

export function getRedisClient(): Redis {
  if (_client) {
    return _client;
  }

  const client = new Redis(config.redisUrl, {
    lazyConnect: true,
    enableReadyCheck: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
    commandTimeout: 2000,
  });

  client.on('connect', () => {
    logger.info('Redis connected');
  });

  client.on('error', (err: Error) => {
    logger.warn({ err: err.message }, 'Redis error – cache layer degraded');
  });

  _client = client;
  return client;
}

/** Reset the singleton (used in tests) */
export function resetRedisClient(): void {
  _client = null;
}
