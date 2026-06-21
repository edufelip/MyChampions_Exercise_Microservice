import { config } from '../config';
import { rebuildRedisCatalogFromPostgres } from '../infrastructure/postgres/rebuild-redis-catalog-from-postgres';
import { logger } from '../logger';

let activeRestorePromise: Promise<boolean> | null = null;

export async function restoreCatalogCacheFromPostgresIfConfigured(requestId: string): Promise<boolean> {
  if (!config.catalogPostgresRestoreOnMiss || !config.postgresUrl) {
    return false;
  }

  if (!activeRestorePromise) {
    activeRestorePromise = (async () => {
      logger.warn({ requestId }, 'Exercise Redis catalog unavailable; restoring cache from Postgres source');
      const result = await rebuildRedisCatalogFromPostgres({
        redisUrl: config.redisUrl,
        postgresUrl: config.postgresUrl as string,
        replaceExisting: true,
      });
      logger.info(
        {
          requestId,
          deletedRedisKeyCount: result.deletedRedisKeyCount,
          restoredRedisKeyCount: result.restoredRedisKeyCount,
        },
        'Exercise Redis catalog restored from Postgres source',
      );
      return true;
    })().finally(() => {
      activeRestorePromise = null;
    });
  }

  return activeRestorePromise;
}
