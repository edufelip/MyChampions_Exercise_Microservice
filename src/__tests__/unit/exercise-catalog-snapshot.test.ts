import { EXERCISE_CATALOG_PRUNE_SQL, EXERCISE_CATALOG_SCHEMA_SQL } from '../../infrastructure/postgres/catalog-persistence-schema';
import {
  assertRedisRebuildAllowed,
  asStringRecord,
  asZSetArgs,
  resolveRedisRebuildMode,
  validateRedisSnapshotEntries,
} from '../../infrastructure/postgres/catalog-redis-rebuild';
import { assertCatalogSnapshotSafeForPrune } from '../../infrastructure/postgres/catalog-snapshot-prune-guard';
import { buildExerciseCatalogSnapshotRows } from '../../infrastructure/postgres/exercise-catalog-snapshot';

describe('buildExerciseCatalogSnapshotRows', () => {
  it('builds normalized rows from Redis exercise catalog keys', () => {
    const rows = buildExerciseCatalogSnapshotRows([
      {
        key: 'catalog:active_version',
        type: 'string',
        ttlMs: -1,
        value: 'v2',
      },
      {
        key: 'catalog:exercise:ex-1:v2',
        type: 'string',
        ttlMs: -1,
        value: JSON.stringify({
          id: 'ex-1',
          slug: 'squat',
          muscleGroup: 'legs',
          secondaryMuscles: null,
          equipment: null,
          category: 'strength',
          difficulty: 'beginner',
          hasVideo: true,
          hasVideoWhite: false,
          hasVideoGym: false,
          videoDurationSecs: 30,
          exerciseType: ['strength'],
          videoUrl: null,
          videoHlsUrl: null,
          thumbnailUrl: null,
          videos: null,
          localizations: {
            en: {
              title: 'Squat',
              description: 'Lower body',
              instructions: ['Stand'],
              importantPoints: ['Knees aligned'],
              status: 'source',
              updatedAt: '2026-06-19T00:00:00.000Z',
            },
          },
        }),
      },
      {
        key: 'catalog:l10n:status:ex-1:en:v2',
        type: 'string',
        ttlMs: -1,
        value: 'source',
      },
      {
        key: 'catalog:popularity:en:v2',
        type: 'zset',
        ttlMs: -1,
        value: [{ member: 'ex-1', score: 3 }],
      },
      {
        key: 'catalog:meta:v2',
        type: 'string',
        ttlMs: -1,
        value: JSON.stringify({
          lastSyncedAt: '2026-06-19T00:00:00.000Z',
          exerciseCount: 1,
        }),
      },
    ]);

    expect(rows.activeVersion).toBe('v2');
    expect(rows.exercises).toEqual([
      expect.objectContaining({
        id: 'ex-1',
        version: 'v2',
        slug: 'squat',
        muscleGroup: 'legs',
      }),
    ]);
    expect(rows.localizations).toEqual([
      expect.objectContaining({
        exerciseId: 'ex-1',
        version: 'v2',
        lang: 'en',
        title: 'Squat',
        status: 'source',
      }),
    ]);
    expect(rows.localizationStatuses).toEqual([
      expect.objectContaining({
        exerciseId: 'ex-1',
        version: 'v2',
        lang: 'en',
        status: 'source',
      }),
    ]);
    expect(rows.popularity).toEqual([
      expect.objectContaining({
        lang: 'en',
        version: 'v2',
        exerciseId: 'ex-1',
        score: 3,
      }),
    ]);
    expect(rows.metadata).toEqual([
      expect.objectContaining({
        version: 'v2',
        exerciseCount: 1,
      }),
    ]);
  });

  it('allows nullable localization descriptions from reviewed Redis data', () => {
    expect(EXERCISE_CATALOG_SCHEMA_SQL).toContain('description text,');
    expect(EXERCISE_CATALOG_SCHEMA_SQL).not.toContain('description text NOT NULL');
  });

  it('tracks last-seen migration runs and prunes stale snapshot rows', () => {
    expect(EXERCISE_CATALOG_SCHEMA_SQL).toContain('last_seen_run_id uuid');
    expect(EXERCISE_CATALOG_SCHEMA_SQL).toContain('ALTER TABLE redis_keys ADD COLUMN IF NOT EXISTS last_seen_run_id uuid');
    expect(EXERCISE_CATALOG_PRUNE_SQL).toContain('DELETE FROM redis_keys WHERE last_seen_run_id IS DISTINCT FROM $1::uuid');
    expect(EXERCISE_CATALOG_PRUNE_SQL[0]).toContain('catalog_exercise_popularity');
  });

  it('refuses to prune Postgres from an empty or unready Redis snapshot', () => {
    expect(() => assertCatalogSnapshotSafeForPrune({
      service: 'exercise',
      redisKeyCount: 0,
      normalizedDocumentCount: 0,
      activeCatalogMarker: null,
      allowEmptyCatalogMigration: false,
    })).toThrow(/refused to prune stale rows/);

    expect(() => assertCatalogSnapshotSafeForPrune({
      service: 'exercise',
      redisKeyCount: 0,
      normalizedDocumentCount: 0,
      activeCatalogMarker: null,
      allowEmptyCatalogMigration: true,
    })).not.toThrow();
  });

  it('defaults Redis rebuilds to dry-run and requires explicit write confirmation', () => {
    expect(resolveRedisRebuildMode({})).toBe('dry-run');
    expect(resolveRedisRebuildMode({ DRY_RUN: 'false' })).toBe('write');
    expect(() => assertRedisRebuildAllowed({
      rowCount: 10,
      mode: 'write',
      confirmed: false,
    })).toThrow(/CONFIRM_REDIS_REBUILD=true/);
    expect(() => assertRedisRebuildAllowed({
      rowCount: 10,
      mode: 'write',
      confirmed: true,
    })).not.toThrow();
  });

  it('normalizes Postgres JSON values for Redis restore commands', () => {
    expect(asStringRecord({ status: 'reviewed', count: 2 })).toEqual({
      status: 'reviewed',
      count: '2',
    });
    expect(asZSetArgs([{ member: 'ex-1', score: 2.5 }])).toEqual(['2.5', 'ex-1']);
  });

  it('validates all Redis rebuild rows before write mode can delete live keys', () => {
    expect(() => validateRedisSnapshotEntries([
      { key: 'catalog:exercise:ex-1:v2', type: 'string', value: '{}' },
      { key: 'catalog:status:ex-1', type: 'hash', value: { status: 'reviewed' } },
      { key: 'catalog:popularity:en:v2', type: 'zset', value: [{ member: 'ex-1', score: 1 }] },
    ])).not.toThrow();

    expect(() => validateRedisSnapshotEntries([
      { key: 'catalog:stream', type: 'stream', value: [] },
    ])).toThrow(/unsupported Redis type/);

    expect(() => validateRedisSnapshotEntries([
      { key: 'catalog:exercise:ex-1:v2', type: 'string', value: null },
    ])).toThrow(/invalid string value/);
  });
});
