export type RedisRebuildMode = 'dry-run' | 'write';

export interface RedisRebuildSafetyInput {
  rowCount: number;
  mode: RedisRebuildMode;
  confirmed: boolean;
}

export interface RedisSnapshotEntryForValidation {
  key: string;
  type: string;
  value: unknown;
}

export function resolveRedisRebuildMode(env: NodeJS.ProcessEnv): RedisRebuildMode {
  return env.DRY_RUN === 'false' ? 'write' : 'dry-run';
}

export function assertRedisRebuildAllowed(input: RedisRebuildSafetyInput): void {
  if (input.rowCount === 0) {
    throw new Error('Refusing to rebuild Redis from an empty Postgres redis_keys snapshot.');
  }

  if (input.mode === 'write' && !input.confirmed) {
    throw new Error('Refusing to modify Redis without CONFIRM_REDIS_REBUILD=true.');
  }
}

export function validateRedisSnapshotEntry(entry: RedisSnapshotEntryForValidation): void {
  if (!entry.key) {
    throw new Error('Redis rebuild snapshot contains a row without a key.');
  }

  if (entry.type === 'string') {
    if (typeof entry.value !== 'string') {
      throw new Error(`Redis rebuild snapshot key ${entry.key} has invalid string value.`);
    }
    return;
  }

  if (entry.type === 'hash') {
    asStringRecord(entry.value);
    return;
  }

  if (entry.type === 'set' || entry.type === 'list') {
    asStringArray(entry.value, entry.type);
    return;
  }

  if (entry.type === 'zset') {
    asZSetArgs(entry.value);
    return;
  }

  throw new Error(`Redis rebuild snapshot key ${entry.key} has unsupported Redis type: ${entry.type}.`);
}

export function validateRedisSnapshotEntries(entries: RedisSnapshotEntryForValidation[]): void {
  entries.forEach(validateRedisSnapshotEntry);
}

export function asStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected Redis hash value to be a JSON object.');
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, typeof item === 'string' ? item : String(item)]),
  );
}

export function asStringArray(value: unknown, type: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Expected Redis ${type} value to be a JSON array.`);
  }
  return value.map((item) => (typeof item === 'string' ? item : String(item)));
}

export function asZSetArgs(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error('Expected Redis zset value to be a JSON array.');
  }

  return value.flatMap((item) => {
    if (
      !item
      || typeof item !== 'object'
      || !('member' in item)
      || !('score' in item)
      || typeof item.member !== 'string'
      || typeof item.score !== 'number'
    ) {
      throw new Error('Expected Redis zset members to have string member and numeric score.');
    }
    return [String(item.score), item.member];
  });
}
