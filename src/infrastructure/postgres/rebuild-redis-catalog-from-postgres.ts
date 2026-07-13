import Redis from 'ioredis';
import { Client } from 'pg';
import {
  asStringArray,
  asStringRecord,
  assertRedisRebuildAllowed,
  asZSetArgs,
  resolveRedisRebuildMode,
  validateRedisSnapshotEntries,
} from './catalog-redis-rebuild';
import { RedisSnapshotEntry, RedisSnapshotType, RedisSnapshotValue } from './redis-snapshot-types';

const REDIS_PATTERN = 'catalog:*';
const BATCH_SIZE = 500;

type RedisPipeline = ReturnType<Redis['pipeline']>;

interface RedisKeyRow {
  key: string;
  type: RedisSnapshotType;
  ttlMs: string | number;
  value: RedisSnapshotValue;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export async function readPostgresSnapshot(postgresUrl: string): Promise<RedisSnapshotEntry[]> {
  const client = new Client({ connectionString: postgresUrl });
  await client.connect();
  try {
    const result = await client.query<RedisKeyRow>(`
      SELECT key, redis_type AS type, ttl_ms AS "ttlMs", value
      FROM redis_keys
      WHERE key LIKE 'catalog:%'
      ORDER BY key
    `);
    return result.rows.map((row) => ({
      key: row.key,
      type: row.type,
      ttlMs: Number(row.ttlMs),
      value: row.value,
    }));
  } finally {
    await client.end();
  }
}

async function scanExistingCatalogKeys(redis: Redis): Promise<string[]> {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [nextCursor, batch] = await redis.scan(cursor, 'MATCH', REDIS_PATTERN, 'COUNT', BATCH_SIZE);
    cursor = nextCursor;
    keys.push(...batch);
  } while (cursor !== '0');
  return keys;
}

function applyTtl(pipeline: RedisPipeline, entry: RedisSnapshotEntry): void {
  if (entry.ttlMs > 0) {
    pipeline.pexpire(entry.key, entry.ttlMs);
  }
}

function restoreEntry(pipeline: RedisPipeline, entry: RedisSnapshotEntry): void {
  if (entry.type === 'string') {
    pipeline.set(entry.key, typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value));
    applyTtl(pipeline, entry);
    return;
  }

  if (entry.type === 'hash') {
    const value = asStringRecord(entry.value);
    if (Object.keys(value).length > 0) {
      pipeline.hset(entry.key, value);
      applyTtl(pipeline, entry);
    }
    return;
  }

  if (entry.type === 'set') {
    const value = asStringArray(entry.value, 'set');
    if (value.length > 0) {
      pipeline.sadd(entry.key, ...value);
      applyTtl(pipeline, entry);
    }
    return;
  }

  if (entry.type === 'zset') {
    const args = asZSetArgs(entry.value);
    if (args.length > 0) {
      pipeline.zadd(entry.key, ...args);
      applyTtl(pipeline, entry);
    }
    return;
  }

  if (entry.type === 'list') {
    const value = asStringArray(entry.value, 'list');
    if (value.length > 0) {
      pipeline.rpush(entry.key, ...value);
      applyTtl(pipeline, entry);
    }
    return;
  }

  throw new Error(`Unsupported Redis type for rebuild: ${entry.type}`);
}

async function deleteKeys(redis: Redis, keys: string[]): Promise<void> {
  for (let index = 0; index < keys.length; index += BATCH_SIZE) {
    const chunk = keys.slice(index, index + BATCH_SIZE);
    if (chunk.length > 0) {
      await redis.del(...chunk);
    }
  }
}

async function restoreRows(redis: Redis, entries: RedisSnapshotEntry[]): Promise<void> {
  for (let index = 0; index < entries.length; index += BATCH_SIZE) {
    const pipeline = redis.pipeline();
    entries.slice(index, index + BATCH_SIZE).forEach((entry) => restoreEntry(pipeline, entry));
    await pipeline.exec();
  }
}

export interface RebuildRedisCatalogFromPostgresInput {
  redisUrl: string;
  postgresUrl: string;
  replaceExisting?: boolean;
}

export interface RebuildRedisCatalogFromPostgresResult {
  deletedRedisKeyCount: number;
  restoredRedisKeyCount: number;
}

export async function rebuildRedisCatalogFromPostgres(
  input: RebuildRedisCatalogFromPostgresInput,
): Promise<RebuildRedisCatalogFromPostgresResult> {
  const entries = await readPostgresSnapshot(input.postgresUrl);
  assertRedisRebuildAllowed({
    rowCount: entries.length,
    mode: 'write',
    confirmed: true,
  });
  validateRedisSnapshotEntries(entries);

  const redis = new Redis(input.redisUrl, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  });
  await redis.connect();

  try {
    const deletedKeys = input.replaceExisting === false ? [] : await scanExistingCatalogKeys(redis);
    await deleteKeys(redis, deletedKeys);
    await restoreRows(redis, entries);
    return {
      deletedRedisKeyCount: deletedKeys.length,
      restoredRedisKeyCount: entries.length,
    };
  } finally {
    redis.disconnect();
  }
}

async function main(): Promise<void> {
  const redisUrl = requireEnv('REDIS_URL');
  const postgresUrl = requireEnv('POSTGRES_URL');
  const mode = resolveRedisRebuildMode(process.env);
  const entries = await readPostgresSnapshot(postgresUrl);
  assertRedisRebuildAllowed({
    rowCount: entries.length,
    mode,
    confirmed: process.env.CONFIRM_REDIS_REBUILD === 'true',
  });
  validateRedisSnapshotEntries(entries);

  if (mode === 'dry-run') {
    console.log(JSON.stringify({
      service: 'exercise',
      mode,
      postgresRedisKeyCount: entries.length,
      message: 'Set DRY_RUN=false and CONFIRM_REDIS_REBUILD=true to replace Redis catalog:* keys from Postgres.',
    }));
    return;
  }

  const redis = new Redis(redisUrl, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  });
  await redis.connect();

  try {
    const deletedKeys = await scanExistingCatalogKeys(redis);
    await deleteKeys(redis, deletedKeys);
    await restoreRows(redis, entries);
    console.log(JSON.stringify({
      service: 'exercise',
      mode,
      deletedRedisKeyCount: deletedKeys.length,
      restoredRedisKeyCount: entries.length,
    }));
  } finally {
    redis.disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
