import { Options, Store, IncrementResponse } from 'express-rate-limit';
import { getRedisClient } from './redis-client';

const DEFAULT_WINDOW_MS = 60_000;

const INCREMENT_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("PTTL", KEYS[1])
return { count, ttl }
`;

export class RedisRateLimitStore implements Store {
  localKeys = false;

  private windowMs = DEFAULT_WINDOW_MS;

  constructor(public readonly prefix = 'rate-limit:') {}

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  async increment(key: string): Promise<IncrementResponse> {
    const redis = getRedisClient();
    const [rawHits, rawTtl] = await redis.eval(
      INCREMENT_SCRIPT,
      1,
      this.key(key),
      this.windowMs,
    ) as [number | string, number | string];

    const totalHits = Number(rawHits);
    const ttl = Number(rawTtl);
    const resetTime = Number.isFinite(ttl) && ttl > 0
      ? new Date(Date.now() + ttl)
      : new Date(Date.now() + this.windowMs);

    return {
      totalHits,
      resetTime,
    };
  }

  async decrement(key: string): Promise<void> {
    const redis = getRedisClient();
    await redis.decr(this.key(key));
  }

  async resetKey(key: string): Promise<void> {
    const redis = getRedisClient();
    await redis.del(this.key(key));
  }

  private key(key: string): string {
    return `${this.prefix}${key}`;
  }
}
