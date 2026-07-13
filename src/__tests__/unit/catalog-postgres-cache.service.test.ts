import { config } from '../../config';
import { rebuildRedisCatalogFromPostgres } from '../../infrastructure/postgres/rebuild-redis-catalog-from-postgres';
import { restoreCatalogCacheFromPostgresIfConfigured } from '../../services/catalog-postgres-cache.service';

jest.mock('../../infrastructure/postgres/rebuild-redis-catalog-from-postgres', () => ({
  rebuildRedisCatalogFromPostgres: jest.fn(),
}));

describe('restoreCatalogCacheFromPostgresIfConfigured', () => {
  const original = {
    postgresUrl: config.postgresUrl,
    redisUrl: config.redisUrl,
    catalogPostgresRestoreOnMiss: config.catalogPostgresRestoreOnMiss,
  };

  beforeEach(() => {
    Object.assign(config, {
      postgresUrl: 'postgresql://exercise-catalog',
      redisUrl: 'redis://exercise-redis',
      catalogPostgresRestoreOnMiss: true,
    });
    jest.mocked(rebuildRedisCatalogFromPostgres).mockResolvedValue({
      deletedRedisKeyCount: 0,
      restoredRedisKeyCount: 5,
    });
  });

  afterEach(() => {
    Object.assign(config, original);
    jest.clearAllMocks();
  });

  it('restores Redis from Postgres when configured', async () => {
    await expect(restoreCatalogCacheFromPostgresIfConfigured('req-1')).resolves.toBe(true);

    expect(rebuildRedisCatalogFromPostgres).toHaveBeenCalledWith({
      redisUrl: 'redis://exercise-redis',
      postgresUrl: 'postgresql://exercise-catalog',
      replaceExisting: true,
    });
  });

  it('coalesces concurrent restore attempts', async () => {
    let resolveRestore: ((value: { deletedRedisKeyCount: number; restoredRedisKeyCount: number }) => void) | undefined;
    jest.mocked(rebuildRedisCatalogFromPostgres).mockImplementation(
      () => new Promise((resolve) => {
        resolveRestore = resolve;
      }),
    );

    const first = restoreCatalogCacheFromPostgresIfConfigured('req-1');
    const second = restoreCatalogCacheFromPostgresIfConfigured('req-2');
    resolveRestore?.({ deletedRedisKeyCount: 0, restoredRedisKeyCount: 5 });

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(rebuildRedisCatalogFromPostgres).toHaveBeenCalledTimes(1);
  });

  it('returns false when the best-effort restore fails', async () => {
    jest.mocked(rebuildRedisCatalogFromPostgres).mockRejectedValueOnce(new Error('Postgres unavailable'));

    await expect(restoreCatalogCacheFromPostgresIfConfigured('req-1')).resolves.toBe(false);
  });

  it('does not restore when Postgres is not configured', async () => {
    Object.assign(config, { postgresUrl: null });

    await expect(restoreCatalogCacheFromPostgresIfConfigured('req-1')).resolves.toBe(false);
    expect(rebuildRedisCatalogFromPostgres).not.toHaveBeenCalled();
  });
});
