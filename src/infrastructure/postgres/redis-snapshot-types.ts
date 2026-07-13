export type RedisSnapshotType = 'string' | 'hash' | 'set' | 'zset' | 'list' | 'none' | 'stream';

export interface RedisZSetMember {
  member: string;
  score: number;
}

export type RedisSnapshotValue =
  | string
  | string[]
  | Record<string, string>
  | RedisZSetMember[]
  | null;

export interface RedisSnapshotEntry {
  key: string;
  type: RedisSnapshotType;
  ttlMs: number;
  value: RedisSnapshotValue;
}
