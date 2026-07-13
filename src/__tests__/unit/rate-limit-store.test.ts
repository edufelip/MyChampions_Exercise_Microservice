jest.mock('../../infrastructure/redis-client', () => ({
  getRedisClient: jest.fn(),
}));

import { getRedisClient } from '../../infrastructure/redis-client';
import { RedisRateLimitStore } from '../../infrastructure/rate-limit-store';

const mockedGetRedisClient = getRedisClient as jest.MockedFunction<typeof getRedisClient>;

describe('RedisRateLimitStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('increments a namespaced key with the configured window', async () => {
    const redis = {
      eval: jest.fn().mockResolvedValue([3, 5000]),
    };
    mockedGetRedisClient.mockReturnValue(redis as never);
    const store = new RedisRateLimitStore('rl:test:');
    store.init?.({ windowMs: 10_000 } as never);

    await expect(store.increment('client-1')).resolves.toEqual({
      totalHits: 3,
      resetTime: expect.any(Date),
    });

    expect(redis.eval).toHaveBeenCalledWith(expect.any(String), 1, 'rl:test:client-1', 10_000);
  });

  it('resets and decrements namespaced keys', async () => {
    const redis = {
      del: jest.fn().mockResolvedValue(1),
      decr: jest.fn().mockResolvedValue(1),
    };
    mockedGetRedisClient.mockReturnValue(redis as never);
    const store = new RedisRateLimitStore('rl:test:');

    await store.decrement('client-1');
    await store.resetKey('client-1');

    expect(redis.decr).toHaveBeenCalledWith('rl:test:client-1');
    expect(redis.del).toHaveBeenCalledWith('rl:test:client-1');
  });
});
