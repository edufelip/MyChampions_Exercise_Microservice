import { CatalogExerciseDocumentDTO, LocalizationStatus } from '../domain/dtos';
import { getRedisClient } from './redis-client';

const DEFAULT_CATALOG_VERSION = 'v1';
const ACTIVE_CATALOG_VERSION_KEY = 'catalog:active_version';
const STARTUP_SYNC_COOLDOWN_AT_KEY = 'catalog:startup_sync:cooldown_at';
const STARTUP_SYNC_FLIGHT_LOCK_KEY = 'catalog:startup_sync:flight_lock';
const SUPPORTED_CATALOG_LANGS = ['en', 'pt', 'es', 'fr', 'it'] as const;

export interface CatalogMetadata {
  lastSyncedAt: string;
  exerciseCount: number;
  seedQueryCount?: number;
  successfulSeedQueries?: number;
  failedSeedQueries?: number;
  fetchedRows?: number;
  duplicateRows?: number;
}

function exerciseDocKey(exerciseId: string, version: string): string {
  return `catalog:exercise:${exerciseId}:${version}`;
}

function indexKey(lang: string, prefix: string, version: string): string {
  return `catalog:index:${lang}:${prefix}:${version}`;
}

function exactIndexKey(lang: string, token: string, version: string): string {
  return `catalog:exact:${lang}:${token}:${version}`;
}

function tokenDictionaryKey(lang: string, version: string): string {
  return `catalog:tokens:${lang}:${version}`;
}

function tokenPrefixDictionaryKey(lang: string, prefix: string, version: string): string {
  return `catalog:tokenprefix:${lang}:${prefix}:${version}`;
}

function popularityKey(lang: string, version: string): string {
  return `catalog:popularity:${lang}:${version}`;
}

function synonymsKey(lang: string, token: string, version: string): string {
  return `catalog:syn:${lang}:${token}:${version}`;
}

function metadataKey(version: string): string {
  return `catalog:meta:${version}`;
}

function docsSetKey(version: string): string {
  return `catalog:docids:${version}`;
}

function statusKey(exerciseId: string, lang: string, version: string): string {
  return `catalog:l10n:status:${exerciseId}:${lang}:${version}`;
}

async function resolveVersion(version?: string): Promise<string> {
  if (version) {
    return version;
  }

  const active = await getActiveCatalogVersion();
  return active ?? DEFAULT_CATALOG_VERSION;
}

export async function getActiveCatalogVersion(): Promise<string | null> {
  const redis = getRedisClient();
  const raw = await redis.get(ACTIVE_CATALOG_VERSION_KEY);
  return raw || null;
}

export async function setActiveCatalogVersion(version: string): Promise<void> {
  const redis = getRedisClient();
  await redis.set(ACTIVE_CATALOG_VERSION_KEY, version);
}

export async function createCatalogVersion(): Promise<string> {
  const redis = getRedisClient();
  const seq = await redis.incr('catalog:version_seq');
  return `v${seq}`;
}

export async function getStartupSyncCooldownAt(): Promise<number | null> {
  const redis = getRedisClient();
  const raw = await redis.get(STARTUP_SYNC_COOLDOWN_AT_KEY);
  if (!raw) {
    return null;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function setStartupSyncCooldownAt(timestampMs: number, cooldownMs: number): Promise<void> {
  const redis = getRedisClient();
  await redis.set(STARTUP_SYNC_COOLDOWN_AT_KEY, String(timestampMs), 'PX', cooldownMs);
}

export async function acquireStartupSyncFlightLock(ownerToken: string, ttlMs: number): Promise<boolean> {
  const redis = getRedisClient();
  const result = await redis.set(STARTUP_SYNC_FLIGHT_LOCK_KEY, ownerToken, 'PX', ttlMs, 'NX');

  return result === 'OK';
}

export async function releaseStartupSyncFlightLock(ownerToken: string): Promise<void> {
  const redis = getRedisClient();
  const script = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

  await redis.eval(script, 1, STARTUP_SYNC_FLIGHT_LOCK_KEY, ownerToken);
}

function extractVersionFromMetadataKey(key: string): string | null {
  const marker = 'catalog:meta:';
  if (!key.startsWith(marker)) {
    return null;
  }
  const version = key.slice(marker.length).trim();
  return version.length > 0 ? version : null;
}

export async function listCatalogVersions(): Promise<string[]> {
  const redis = getRedisClient();
  let cursor = '0';
  const versions = new Set<string>();

  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', 'catalog:meta:v*', 'COUNT', 200);
    for (const key of keys) {
      const version = extractVersionFromMetadataKey(key);
      if (version) {
        versions.add(version);
      }
    }
    cursor = nextCursor;
  } while (cursor !== '0');

  return [...versions];
}

export async function saveCatalogDocument(doc: CatalogExerciseDocumentDTO, version?: string): Promise<void> {
  const redis = getRedisClient();
  const keyVersion = await resolveVersion(version);
  await redis.set(exerciseDocKey(doc.id, keyVersion), JSON.stringify(doc));
  await redis.sadd(docsSetKey(keyVersion), doc.id);
}

export async function getCatalogDocument(exerciseId: string, version?: string): Promise<CatalogExerciseDocumentDTO | null> {
  const redis = getRedisClient();
  const keyVersion = await resolveVersion(version);
  const raw = await redis.get(exerciseDocKey(exerciseId, keyVersion));
  if (!raw) {
    return null;
  }
  return JSON.parse(raw) as CatalogExerciseDocumentDTO;
}

export async function getCatalogDocuments(
  exerciseIds: string[],
  version?: string,
): Promise<CatalogExerciseDocumentDTO[]> {
  if (exerciseIds.length === 0) {
    return [];
  }

  const redis = getRedisClient();
  const keyVersion = await resolveVersion(version);
  const rawDocs = await redis.mget(...exerciseIds.map((id) => exerciseDocKey(id, keyVersion)));
  return rawDocs
    .filter((raw): raw is string => Boolean(raw))
    .map((raw) => JSON.parse(raw) as CatalogExerciseDocumentDTO);
}

export async function getCatalogDocumentIds(
  page: number,
  pageSize: number,
  version?: string,
): Promise<string[]> {
  const redis = getRedisClient();
  const keyVersion = await resolveVersion(version);
  const start = Math.max(0, (page - 1) * pageSize);
  const end = start + Math.max(0, pageSize - 1);
  const allIds = await redis.smembers(docsSetKey(keyVersion));
  return allIds.sort().slice(start, end + 1);
}

export async function clearCatalog(version?: string): Promise<void> {
  const redis = getRedisClient();
  const keyVersion = await resolveVersion(version);
  let cursor = '0';
  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', `catalog:*:${keyVersion}`, 'COUNT', 200);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    cursor = nextCursor;
  } while (cursor !== '0');
}

export async function clearPopularity(version?: string): Promise<void> {
  const redis = getRedisClient();
  const keyVersion = await resolveVersion(version);
  const keys = SUPPORTED_CATALOG_LANGS.map((lang) => popularityKey(lang, keyVersion));
  if (keys.length > 0) {
    await redis.del(...keys);
  }
}

export async function upsertIndexPrefix(
  lang: string,
  prefix: string,
  exerciseId: string,
  score: number,
  version?: string,
): Promise<void> {
  const redis = getRedisClient();
  const keyVersion = await resolveVersion(version);
  await redis.zadd(indexKey(lang, prefix, keyVersion), String(score), exerciseId);
}

export async function upsertExactIndex(
  lang: string,
  token: string,
  exerciseId: string,
  score: number,
  version?: string,
): Promise<void> {
  const redis = getRedisClient();
  const keyVersion = await resolveVersion(version);
  await redis.zadd(exactIndexKey(lang, token, keyVersion), String(score), exerciseId);
}

export async function addTokenToDictionary(lang: string, token: string, version?: string): Promise<void> {
  const redis = getRedisClient();
  const keyVersion = await resolveVersion(version);
  await redis.sadd(tokenDictionaryKey(lang, keyVersion), token);
}

export async function addTokenPrefixToDictionary(
  lang: string,
  prefix: string,
  token: string,
  version?: string,
): Promise<void> {
  const redis = getRedisClient();
  const keyVersion = await resolveVersion(version);
  await redis.sadd(tokenPrefixDictionaryKey(lang, prefix, keyVersion), token);
}

export async function getIdsByPrefix(
  lang: string,
  prefix: string,
  limit: number,
  version?: string,
): Promise<string[]> {
  const redis = getRedisClient();
  const keyVersion = await resolveVersion(version);
  return redis.zrevrange(indexKey(lang, prefix, keyVersion), 0, Math.max(0, limit - 1));
}

export async function getIdsByExactToken(
  lang: string,
  token: string,
  limit: number,
  version?: string,
): Promise<string[]> {
  const redis = getRedisClient();
  const keyVersion = await resolveVersion(version);
  return redis.zrevrange(exactIndexKey(lang, token, keyVersion), 0, Math.max(0, limit - 1));
}

export async function getAllTokens(lang: string, version?: string): Promise<string[]> {
  const redis = getRedisClient();
  const keyVersion = await resolveVersion(version);
  return redis.smembers(tokenDictionaryKey(lang, keyVersion));
}

export async function getTokensByPrefix(lang: string, prefix: string, version?: string): Promise<string[]> {
  const redis = getRedisClient();
  const keyVersion = await resolveVersion(version);
  return redis.smembers(tokenPrefixDictionaryKey(lang, prefix, keyVersion));
}

export async function registerSynonym(
  lang: string,
  synonymToken: string,
  canonicalToken: string,
  version?: string,
): Promise<void> {
  const redis = getRedisClient();
  const keyVersion = await resolveVersion(version);
  await redis.sadd(synonymsKey(lang, synonymToken, keyVersion), canonicalToken);
}

export async function getSynonymTargets(lang: string, token: string, version?: string): Promise<string[]> {
  const redis = getRedisClient();
  const keyVersion = await resolveVersion(version);
  return redis.smembers(synonymsKey(lang, token, keyVersion));
}

export async function incrementPopularity(lang: string, exerciseId: string, by = 1, version?: string): Promise<void> {
  const redis = getRedisClient();
  const keyVersion = await resolveVersion(version);
  await redis.zincrby(popularityKey(lang, keyVersion), by, exerciseId);
}

export async function getPopularityScores(
  lang: string,
  exerciseIds: string[],
  version?: string,
): Promise<Record<string, number>> {
  if (exerciseIds.length === 0) {
    return {};
  }

  const redis = getRedisClient();
  const keyVersion = await resolveVersion(version);
  const multi = redis.multi();

  for (const exerciseId of exerciseIds) {
    multi.zscore(popularityKey(lang, keyVersion), exerciseId);
  }

  const result = await multi.exec();
  const scores: Record<string, number> = {};

  if (!result) {
    return scores;
  }

  for (let i = 0; i < exerciseIds.length; i++) {
    const rawScore = result[i]?.[1] as string | null;
    scores[exerciseIds[i]] = rawScore ? Number(rawScore) : 0;
  }

  return scores;
}

export async function getPopularExerciseIds(lang: string, limit: number, version?: string): Promise<string[]> {
  const redis = getRedisClient();
  const keyVersion = await resolveVersion(version);
  return redis.zrevrange(popularityKey(lang, keyVersion), 0, Math.max(0, limit - 1));
}

export async function setCatalogMetadata(meta: CatalogMetadata, version?: string): Promise<void> {
  const redis = getRedisClient();
  const keyVersion = await resolveVersion(version);
  await redis.set(metadataKey(keyVersion), JSON.stringify(meta));
}

export async function getCatalogMetadata(version?: string): Promise<CatalogMetadata | null> {
  const redis = getRedisClient();
  const keyVersion = await resolveVersion(version);
  const raw = await redis.get(metadataKey(keyVersion));
  if (!raw) {
    return null;
  }
  return JSON.parse(raw) as CatalogMetadata;
}

export async function setLocalizationStatus(
  exerciseId: string,
  lang: string,
  status: LocalizationStatus,
  version?: string,
): Promise<void> {
  const redis = getRedisClient();
  const keyVersion = await resolveVersion(version);
  await redis.set(statusKey(exerciseId, lang, keyVersion), status);
}

export async function getLocalizationStatus(
  exerciseId: string,
  lang: string,
  version?: string,
): Promise<LocalizationStatus | null> {
  const redis = getRedisClient();
  const keyVersion = await resolveVersion(version);
  const raw = await redis.get(statusKey(exerciseId, lang, keyVersion));
  if (raw === 'machine' || raw === 'reviewed' || raw === 'rejected') {
    return raw;
  }
  return null;
}

export function getCatalogLanguages(): readonly string[] {
  return SUPPORTED_CATALOG_LANGS;
}
