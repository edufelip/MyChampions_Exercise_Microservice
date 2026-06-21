import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { Client } from 'pg';
import { EXERCISE_CATALOG_PRUNE_SQL, EXERCISE_CATALOG_SCHEMA_SQL } from './catalog-persistence-schema';
import { assertCatalogSnapshotSafeForPrune } from './catalog-snapshot-prune-guard';
import { buildExerciseCatalogSnapshotRows } from './exercise-catalog-snapshot';
import { RedisSnapshotEntry, RedisSnapshotType, RedisSnapshotValue } from './redis-snapshot-types';

const REDIS_PATTERN = 'catalog:*';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function readRedisValue(redis: Redis, key: string, type: RedisSnapshotType): Promise<RedisSnapshotValue> {
  if (type === 'string') {
    return redis.get(key);
  }
  if (type === 'hash') {
    return redis.hgetall(key);
  }
  if (type === 'set') {
    return redis.smembers(key);
  }
  if (type === 'zset') {
    const raw = await redis.zrange(key, 0, -1, 'WITHSCORES');
    const members = [];
    for (let index = 0; index < raw.length; index += 2) {
      members.push({ member: raw[index] as string, score: Number(raw[index + 1]) || 0 });
    }
    return members;
  }
  if (type === 'list') {
    return redis.lrange(key, 0, -1);
  }
  return null;
}

async function readRedisSnapshot(redisUrl: string): Promise<RedisSnapshotEntry[]> {
  const redis = new Redis(redisUrl, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  });
  await redis.connect();

  try {
    const entries: RedisSnapshotEntry[] = [];
    let cursor = '0';
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', REDIS_PATTERN, 'COUNT', 500);
      cursor = nextCursor;
      for (const key of keys.sort()) {
        const type = await redis.type(key) as RedisSnapshotType;
        const [ttlMs, value] = await Promise.all([
          redis.pttl(key),
          readRedisValue(redis, key, type),
        ]);
        entries.push({ key, type, ttlMs, value });
      }
    } while (cursor !== '0');
    return entries;
  } finally {
    redis.disconnect();
  }
}

async function upsertSnapshot(client: Client, entries: RedisSnapshotEntry[], runId: string): Promise<void> {
  for (const entry of entries) {
    await client.query(
      `
      INSERT INTO redis_keys (key, redis_type, ttl_ms, value, migrated_at, last_seen_run_id, last_seen_at)
      VALUES ($1, $2, $3, $4::jsonb, now(), $5::uuid, now())
      ON CONFLICT (key) DO UPDATE SET
        redis_type = EXCLUDED.redis_type,
        ttl_ms = EXCLUDED.ttl_ms,
        value = EXCLUDED.value,
        migrated_at = now(),
        last_seen_run_id = EXCLUDED.last_seen_run_id,
        last_seen_at = EXCLUDED.last_seen_at
      `,
      [entry.key, entry.type, entry.ttlMs, JSON.stringify(entry.value), runId],
    );
  }
}

async function upsertNormalizedRows(client: Client, entries: RedisSnapshotEntry[], runId: string): Promise<{
  activeVersion: string | null;
  documentCount: number;
}> {
  const rows = buildExerciseCatalogSnapshotRows(entries);

  for (const exercise of rows.exercises) {
    await client.query(
      `
      INSERT INTO catalog_exercises
        (
          id, version, slug, muscle_group, secondary_muscles, equipment, category,
          difficulty, has_video, has_video_white, has_video_gym, video_duration_secs,
          exercise_type, video_url, video_hls_url, thumbnail_url, videos, raw_document,
          migrated_at, last_seen_run_id, last_seen_at
        )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15, $16,
        $17::jsonb, $18::jsonb, now(), $19::uuid, now()
      )
      ON CONFLICT (id, version) DO UPDATE SET
        slug = EXCLUDED.slug,
        muscle_group = EXCLUDED.muscle_group,
        secondary_muscles = EXCLUDED.secondary_muscles,
        equipment = EXCLUDED.equipment,
        category = EXCLUDED.category,
        difficulty = EXCLUDED.difficulty,
        has_video = EXCLUDED.has_video,
        has_video_white = EXCLUDED.has_video_white,
        has_video_gym = EXCLUDED.has_video_gym,
        video_duration_secs = EXCLUDED.video_duration_secs,
        exercise_type = EXCLUDED.exercise_type,
        video_url = EXCLUDED.video_url,
        video_hls_url = EXCLUDED.video_hls_url,
        thumbnail_url = EXCLUDED.thumbnail_url,
        videos = EXCLUDED.videos,
        raw_document = EXCLUDED.raw_document,
        migrated_at = now(),
        last_seen_run_id = EXCLUDED.last_seen_run_id,
        last_seen_at = EXCLUDED.last_seen_at
      `,
      [
        exercise.id,
        exercise.version,
        exercise.slug,
        exercise.muscleGroup,
        exercise.secondaryMuscles,
        exercise.equipment,
        exercise.category,
        exercise.difficulty,
        exercise.hasVideo,
        exercise.hasVideoWhite,
        exercise.hasVideoGym,
        exercise.videoDurationSecs,
        JSON.stringify(exercise.exerciseType),
        exercise.videoUrl,
        exercise.videoHlsUrl,
        exercise.thumbnailUrl,
        JSON.stringify(exercise.videos),
        JSON.stringify(exercise.rawDocument),
        runId,
      ],
    );
  }

  for (const localization of rows.localizations) {
    await client.query(
      `
      INSERT INTO catalog_exercise_localizations
        (
          exercise_id, version, lang, title, description, instructions,
          important_points, status, updated_at, raw_localization, migrated_at,
          last_seen_run_id, last_seen_at
        )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10::jsonb, now(), $11::uuid, now())
      ON CONFLICT (exercise_id, version, lang) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        instructions = EXCLUDED.instructions,
        important_points = EXCLUDED.important_points,
        status = EXCLUDED.status,
        updated_at = EXCLUDED.updated_at,
        raw_localization = EXCLUDED.raw_localization,
        migrated_at = now(),
        last_seen_run_id = EXCLUDED.last_seen_run_id,
        last_seen_at = EXCLUDED.last_seen_at
      `,
      [
        localization.exerciseId,
        localization.version,
        localization.lang,
        localization.title,
        localization.description,
        JSON.stringify(localization.instructions),
        JSON.stringify(localization.importantPoints),
        localization.status,
        localization.updatedAt,
        JSON.stringify(localization.rawLocalization),
        runId,
      ],
    );
  }

  for (const status of rows.localizationStatuses) {
    await client.query(
      `
      INSERT INTO catalog_exercise_localization_statuses
        (exercise_id, version, lang, status, migrated_at, last_seen_run_id, last_seen_at)
      VALUES ($1, $2, $3, $4, now(), $5::uuid, now())
      ON CONFLICT (exercise_id, version, lang) DO UPDATE SET
        status = EXCLUDED.status,
        migrated_at = now(),
        last_seen_run_id = EXCLUDED.last_seen_run_id,
        last_seen_at = EXCLUDED.last_seen_at
      `,
      [status.exerciseId, status.version, status.lang, status.status, runId],
    );
  }

  for (const popularity of rows.popularity) {
    await client.query(
      `
      INSERT INTO catalog_exercise_popularity
        (lang, version, exercise_id, score, migrated_at, last_seen_run_id, last_seen_at)
      VALUES ($1, $2, $3, $4, now(), $5::uuid, now())
      ON CONFLICT (lang, version, exercise_id) DO UPDATE SET
        score = EXCLUDED.score,
        migrated_at = now(),
        last_seen_run_id = EXCLUDED.last_seen_run_id,
        last_seen_at = EXCLUDED.last_seen_at
      `,
      [popularity.lang, popularity.version, popularity.exerciseId, popularity.score, runId],
    );
  }

  for (const metadata of rows.metadata) {
    await client.query(
      `
      INSERT INTO catalog_metadata
        (
          version, last_synced_at, exercise_count, seed_query_count, successful_seed_queries,
          failed_seed_queries, fetched_rows, duplicate_rows, raw_metadata, migrated_at,
          last_seen_run_id, last_seen_at
        )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, now(), $10::uuid, now())
      ON CONFLICT (version) DO UPDATE SET
        last_synced_at = EXCLUDED.last_synced_at,
        exercise_count = EXCLUDED.exercise_count,
        seed_query_count = EXCLUDED.seed_query_count,
        successful_seed_queries = EXCLUDED.successful_seed_queries,
        failed_seed_queries = EXCLUDED.failed_seed_queries,
        fetched_rows = EXCLUDED.fetched_rows,
        duplicate_rows = EXCLUDED.duplicate_rows,
        raw_metadata = EXCLUDED.raw_metadata,
        migrated_at = now(),
        last_seen_run_id = EXCLUDED.last_seen_run_id,
        last_seen_at = EXCLUDED.last_seen_at
      `,
      [
        metadata.version,
        metadata.lastSyncedAt,
        metadata.exerciseCount,
        metadata.seedQueryCount ?? null,
        metadata.successfulSeedQueries ?? null,
        metadata.failedSeedQueries ?? null,
        metadata.fetchedRows ?? null,
        metadata.duplicateRows ?? null,
        JSON.stringify(metadata.rawMetadata),
        runId,
      ],
    );
  }

  return { activeVersion: rows.activeVersion, documentCount: rows.exercises.length };
}

async function main(): Promise<void> {
  const redisUrl = requireEnv('REDIS_URL');
  const postgresUrl = requireEnv('POSTGRES_URL');
  const startedAt = new Date();
  const runId = randomUUID();
  const entries = await readRedisSnapshot(redisUrl);
  const client = new Client({ connectionString: postgresUrl });
  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query(EXERCISE_CATALOG_SCHEMA_SQL);
    await upsertSnapshot(client, entries, runId);
    const normalized = await upsertNormalizedRows(client, entries, runId);
    assertCatalogSnapshotSafeForPrune({
      service: 'exercise',
      redisKeyCount: entries.length,
      normalizedDocumentCount: normalized.documentCount,
      activeCatalogMarker: normalized.activeVersion,
      allowEmptyCatalogMigration: process.env.ALLOW_EMPTY_CATALOG_POSTGRES_MIGRATION === 'true',
    });
    for (const statement of EXERCISE_CATALOG_PRUNE_SQL) {
      await client.query(statement, [runId]);
    }
    await client.query(
      `
      INSERT INTO migration_runs
        (id, service, source_redis, started_at, finished_at, redis_key_count, normalized_document_count, active_version, notes)
      VALUES ($1, $2, $3, $4, now(), $5, $6, $7, $8::jsonb)
      `,
      [
        runId,
        'exercise',
        redisUrl.replace(/\/\/.*@/, '//<redacted>@'),
        startedAt.toISOString(),
        entries.length,
        normalized.documentCount,
        normalized.activeVersion,
        JSON.stringify({ pattern: REDIS_PATTERN }),
      ],
    );
    await client.query('COMMIT');
    console.log(JSON.stringify({
      service: 'exercise',
      runId,
      redisKeyCount: entries.length,
      documentCount: normalized.documentCount,
      activeVersion: normalized.activeVersion,
    }));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
