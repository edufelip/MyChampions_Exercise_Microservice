import { CatalogExerciseDocumentDTO } from '../../domain/dtos';

jest.mock('../../infrastructure/redis-client', () => ({
  getRedisClient: jest.fn(),
}));

import { getRedisClient } from '../../infrastructure/redis-client';
import {
  getCatalogDocumentIds,
  incrementPopularityMany,
  saveCatalogDocument,
  upsertExerciseTokenIndexes,
} from '../../infrastructure/catalog-repository';

const mockedGetRedisClient = getRedisClient as jest.MockedFunction<typeof getRedisClient>;

function makeDoc(id: string): CatalogExerciseDocumentDTO {
  return {
    id,
    slug: 'bench-press',
    muscleGroup: 'chest',
    secondaryMuscles: null,
    equipment: 'barbell',
    category: 'strength',
    difficulty: 'intermediate',
    hasVideo: true,
    hasVideoWhite: false,
    hasVideoGym: true,
    videoDurationSecs: null,
    exerciseType: ['strength'],
    videoUrl: null,
    videoHlsUrl: null,
    thumbnailUrl: null,
    videos: null,
    localizations: {
      en: {
        title: 'Bench Press',
        description: 'desc',
        instructions: ['step'],
        importantPoints: ['point'],
        status: 'reviewed',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    },
  };
}

describe('catalog repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('stores catalog documents and indexed default order in one Redis transaction', async () => {
    const multi = {
      set: jest.fn().mockReturnThis(),
      sadd: jest.fn().mockReturnThis(),
      zadd: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };
    mockedGetRedisClient.mockReturnValue({ multi: jest.fn(() => multi) } as never);

    await saveCatalogDocument(makeDoc('exercise-1'), 'v2');

    expect(multi.set).toHaveBeenCalledWith(
      'catalog:exercise:exercise-1:v2',
      expect.stringContaining('"id":"exercise-1"'),
    );
    expect(multi.sadd).toHaveBeenCalledWith('catalog:docids:v2', 'exercise-1');
    expect(multi.zadd).toHaveBeenCalledWith('catalog:docorder:v2', 'NX', expect.any(String), 'exercise-1');
    expect(multi.exec).toHaveBeenCalledTimes(1);
  });

  it('pages catalog document ids from ordered Redis index without loading the full set', async () => {
    const redis = {
      get: jest.fn(),
      zcard: jest.fn().mockResolvedValue(3),
      zrange: jest.fn().mockResolvedValue(['exercise-2', 'exercise-3']),
      smembers: jest.fn(),
    };
    mockedGetRedisClient.mockReturnValue(redis as never);

    await expect(getCatalogDocumentIds(2, 2, 'v2')).resolves.toEqual(['exercise-2', 'exercise-3']);

    expect(redis.zrange).toHaveBeenCalledWith('catalog:docorder:v2', 2, 3);
    expect(redis.smembers).not.toHaveBeenCalled();
  });

  it('does not fall back to full-set loading for empty pages when ordered index exists', async () => {
    const redis = {
      get: jest.fn(),
      zcard: jest.fn().mockResolvedValue(3),
      zrange: jest.fn().mockResolvedValue([]),
      smembers: jest.fn(),
    };
    mockedGetRedisClient.mockReturnValue(redis as never);

    await expect(getCatalogDocumentIds(3, 2, 'v2')).resolves.toEqual([]);

    expect(redis.zrange).toHaveBeenCalledWith('catalog:docorder:v2', 4, 5);
    expect(redis.smembers).not.toHaveBeenCalled();
  });

  it('pipelines token dictionary, exact, and prefix index writes for an exercise', async () => {
    const multi = {
      sadd: jest.fn().mockReturnThis(),
      zadd: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };
    mockedGetRedisClient.mockReturnValue({ multi: jest.fn(() => multi) } as never);

    await upsertExerciseTokenIndexes('pt', 'exercise-1', ['avanco'], 'v2');

    expect(multi.sadd).toHaveBeenCalledWith('catalog:tokens:pt:v2', 'avanco');
    expect(multi.sadd).toHaveBeenCalledWith('catalog:tokenprefix:pt:av:v2', 'avanco');
    expect(multi.zadd).toHaveBeenCalledWith('catalog:exact:pt:avanco:v2', '100', 'exercise-1');
    expect(multi.zadd).toHaveBeenCalledWith('catalog:index:pt:av:v2', '60', 'exercise-1');
    expect(multi.zadd).toHaveBeenCalledWith('catalog:index:pt:avanc:v2', '60', 'exercise-1');
    expect(multi.exec).toHaveBeenCalledTimes(1);
  });

  it('pipelines popularity increments for multiple exercise ids', async () => {
    const multi = {
      zincrby: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };
    mockedGetRedisClient.mockReturnValue({ multi: jest.fn(() => multi) } as never);

    await incrementPopularityMany('pt', ['exercise-1', 'exercise-2'], 1, 'v2');

    expect(multi.zincrby).toHaveBeenCalledWith('catalog:popularity:pt:v2', 1, 'exercise-1');
    expect(multi.zincrby).toHaveBeenCalledWith('catalog:popularity:pt:v2', 1, 'exercise-2');
    expect(multi.exec).toHaveBeenCalledTimes(1);
  });
});
