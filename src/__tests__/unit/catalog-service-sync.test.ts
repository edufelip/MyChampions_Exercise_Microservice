import {
  CatalogError,
  ensureCatalogSynced,
  getCatalogHealth,
  getCatalogExerciseById,
  reviewCatalogLocalization,
  searchCatalog,
} from '../../services/catalog.service';
import * as repo from '../../infrastructure/catalog-repository';
import * as ymoveClient from '../../infrastructure/ymove-client';
import * as translateClient from '../../infrastructure/translate-client';

jest.mock('../../infrastructure/catalog-repository', () => ({
  clearCatalog: jest.fn(),
  createCatalogVersion: jest.fn(),
  getExerciseIndexedTokens: jest.fn(),
  getActiveCatalogVersion: jest.fn(),
  getCatalogDocument: jest.fn(),
  getCatalogDocumentIds: jest.fn(),
  getCatalogDocuments: jest.fn(),
  getCatalogLanguages: jest.fn(() => ['en', 'pt', 'es', 'fr', 'it']),
  getCatalogMetadata: jest.fn(),
  getIdsByExactToken: jest.fn(),
  getIdsByPrefix: jest.fn(),
  getLocalizationStatus: jest.fn(),
  getPopularExerciseIds: jest.fn(),
  getPopularityScores: jest.fn(),
  getSynonymTargets: jest.fn(),
  getTokensByPrefix: jest.fn(),
  incrementPopularityMany: jest.fn(),
  listCatalogVersions: jest.fn(),
  registerSynonym: jest.fn(),
  removeExerciseTokenIndexes: jest.fn(),
  saveCatalogDocument: jest.fn(),
  setActiveCatalogVersion: jest.fn(),
  setCatalogMetadata: jest.fn(),
  setExerciseIndexedTokens: jest.fn(),
  setLocalizationStatus: jest.fn(),
  upsertExerciseTokenIndexes: jest.fn(),
}));

jest.mock('../../infrastructure/ymove-client', () => ({
  forwardToYMove: jest.fn(),
  YMoveError: class YMoveError extends Error {
    constructor(message: string, public readonly statusCode?: number) {
      super(message);
      this.name = 'YMoveError';
    }
  },
}));

jest.mock('../../infrastructure/translate-client', () => ({
  translateTexts: jest.fn(async (texts: string[]) => texts),
  translateQueryToEnglish: jest.fn(async (query: string) => query),
}));

describe('ensureCatalogSynced fail-open behavior', () => {
  const mockedRepo = repo as jest.Mocked<typeof repo>;
  const mockedYMove = ymoveClient as jest.Mocked<typeof ymoveClient>;
  const mockedTranslate = translateClient as jest.Mocked<typeof translateClient>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockedRepo.createCatalogVersion.mockResolvedValue('v2');
    mockedRepo.registerSynonym.mockResolvedValue();
    mockedRepo.clearCatalog.mockResolvedValue();
    mockedRepo.listCatalogVersions.mockResolvedValue(['v2']);
    mockedRepo.setCatalogMetadata.mockResolvedValue();
    mockedRepo.setActiveCatalogVersion.mockResolvedValue();
    mockedRepo.saveCatalogDocument.mockResolvedValue();
    mockedRepo.getExerciseIndexedTokens.mockResolvedValue([]);
    mockedRepo.removeExerciseTokenIndexes.mockResolvedValue();
    mockedRepo.setLocalizationStatus.mockResolvedValue();
    mockedRepo.setExerciseIndexedTokens.mockResolvedValue();
    mockedRepo.upsertExerciseTokenIndexes.mockResolvedValue();
    mockedRepo.incrementPopularityMany.mockResolvedValue();
    mockedTranslate.translateTexts.mockImplementation(async (texts: string[]) => texts);
  });

  it('does not throw when sync fails but active catalog data already exists', async () => {
    mockedRepo.getActiveCatalogVersion.mockResolvedValue('v1');
    mockedRepo.getCatalogMetadata.mockResolvedValue({
      lastSyncedAt: '2020-01-01T00:00:00.000Z',
      exerciseCount: 10,
    });
    mockedYMove.forwardToYMove.mockRejectedValue(new Error('upstream down'));

    await expect(ensureCatalogSynced('req-1')).resolves.toBe('stale_served');
  });

  it('throws when sync fails and there is no existing active catalog dataset', async () => {
    mockedRepo.getActiveCatalogVersion.mockResolvedValue(null);
    mockedRepo.getCatalogMetadata.mockResolvedValue(null);
    mockedYMove.forwardToYMove.mockRejectedValue(new Error('upstream down'));

    await expect(ensureCatalogSynced('req-2')).rejects.toBeInstanceOf(CatalogError);
  });

  it('deduplicates repeated exercise ids during sync ingestion', async () => {
    mockedRepo.getActiveCatalogVersion.mockResolvedValue(null);
    mockedRepo.getCatalogMetadata.mockResolvedValue(null);
    mockedYMove.forwardToYMove.mockResolvedValue({
      page: 1,
      pageSize: 2,
      total: 1,
      exercises: [
        {
          id: 'dup-1',
          title: 'Bench Press',
          slug: 'bench-press',
          description: 'desc',
          instructions: ['step'],
          importantPoints: ['point'],
          muscleGroup: 'chest',
          secondaryMuscles: null,
          equipment: 'barbell',
          category: 'strength',
          difficulty: 'intermediate',
          videoDurationSecs: null,
          hasVideo: true,
          hasVideoWhite: false,
          hasVideoGym: true,
          exerciseType: ['strength'],
          videoUrl: null,
          videoHlsUrl: null,
          thumbnailUrl: null,
          videos: null,
        },
        {
          id: 'dup-1',
          title: 'Bench Press Duplicate',
          slug: 'bench-press-dup',
          description: 'desc',
          instructions: ['step'],
          importantPoints: ['point'],
          muscleGroup: 'chest',
          secondaryMuscles: null,
          equipment: 'barbell',
          category: 'strength',
          difficulty: 'intermediate',
          videoDurationSecs: null,
          hasVideo: true,
          hasVideoWhite: false,
          hasVideoGym: true,
          exerciseType: ['strength'],
          videoUrl: null,
          videoHlsUrl: null,
          thumbnailUrl: null,
          videos: null,
        },
      ],
    });

    await expect(ensureCatalogSynced('req-3')).resolves.toBe('synced');
    expect(mockedRepo.saveCatalogDocument).toHaveBeenCalledTimes(1);
    expect(mockedRepo.setCatalogMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ exerciseCount: 1 }),
      'v2',
    );
  });

  it('continues with other seeds when one seed query fails', async () => {
    mockedRepo.getActiveCatalogVersion.mockResolvedValue(null);
    mockedRepo.getCatalogMetadata.mockResolvedValue(null);

    let callCount = 0;
    mockedYMove.forwardToYMove.mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) {
        throw new Error('first seed failed');
      }

      return {
        page: 1,
        pageSize: 1,
        total: 1,
        exercises: [
          {
            id: 'same-id',
            title: 'Bench Press',
            slug: 'bench-press',
            description: 'desc',
            instructions: ['step'],
            importantPoints: ['point'],
            muscleGroup: 'chest',
            secondaryMuscles: null,
            equipment: 'barbell',
            category: 'strength',
            difficulty: 'intermediate',
            videoDurationSecs: null,
            hasVideo: true,
            hasVideoWhite: false,
            hasVideoGym: true,
            exerciseType: ['strength'],
            videoUrl: null,
            videoHlsUrl: null,
            thumbnailUrl: null,
            videos: null,
          },
        ],
      };
    });

    await expect(ensureCatalogSynced('req-4')).resolves.toBe('synced');

    expect(mockedRepo.setCatalogMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        exerciseCount: 1,
        failedSeedQueries: 1,
      }),
      'v2',
    );
  });

  it('does not treat zero-count metadata as fresh and forces a resync attempt', async () => {
    mockedRepo.getActiveCatalogVersion.mockResolvedValue('v1');
    mockedRepo.getCatalogMetadata.mockResolvedValue({
      lastSyncedAt: new Date().toISOString(),
      exerciseCount: 0,
    });
    mockedYMove.forwardToYMove.mockResolvedValue({
      page: 1,
      pageSize: 1,
      total: 1,
      exercises: [
        {
          id: 'one',
          title: 'Back Squat',
          slug: 'back-squat',
          description: 'desc',
          instructions: ['step'],
          importantPoints: ['point'],
          muscleGroup: 'legs',
          secondaryMuscles: null,
          equipment: 'barbell',
          category: 'strength',
          difficulty: 'intermediate',
          videoDurationSecs: null,
          hasVideo: true,
          hasVideoWhite: false,
          hasVideoGym: true,
          exerciseType: ['strength'],
          videoUrl: null,
          videoHlsUrl: null,
          thumbnailUrl: null,
          videos: null,
        },
      ],
    });

    await expect(ensureCatalogSynced('req-5')).resolves.toBe('synced');
    expect(mockedRepo.createCatalogVersion).toHaveBeenCalledTimes(1);
  });

  it('reports catalog as not ready when metadata exists but exercise count is zero', async () => {
    const syncedAt = new Date().toISOString();
    mockedRepo.getActiveCatalogVersion.mockResolvedValue('v1');
    mockedRepo.getCatalogMetadata.mockResolvedValue({
      lastSyncedAt: syncedAt,
      exerciseCount: 0,
    });

    await expect(getCatalogHealth('req-6')).resolves.toEqual({
      ready: false,
      status: 'not_ready',
      syncedAt,
      exerciseCount: 0,
      stale: true,
    });
  });

  it('reports catalog as not ready when repository health reads fail', async () => {
    mockedRepo.getActiveCatalogVersion.mockRejectedValue(new Error('redis unavailable'));

    await expect(getCatalogHealth('req-health')).resolves.toEqual({
      ready: false,
      status: 'redis_unavailable',
      syncedAt: null,
      exerciseCount: 0,
      stale: true,
    });
  });

  it('serves stale active catalog data during search without running request-time sync', async () => {
    mockedRepo.getActiveCatalogVersion.mockResolvedValue('v1');
    mockedRepo.getCatalogMetadata.mockResolvedValue({
      lastSyncedAt: '2020-01-01T00:00:00.000Z',
      exerciseCount: 1,
    });
    mockedRepo.getPopularExerciseIds.mockResolvedValue([]);
    mockedRepo.getCatalogDocumentIds.mockResolvedValue(['one']);
    mockedRepo.getCatalogDocuments.mockResolvedValue([
      {
        id: 'one',
        slug: 'back-squat',
        muscleGroup: 'legs',
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
            title: 'Back Squat',
            description: 'desc',
            instructions: ['step'],
            importantPoints: ['point'],
            status: 'reviewed',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        },
      },
    ]);
    mockedRepo.incrementPopularityMany.mockResolvedValue();
    mockedYMove.forwardToYMove.mockRejectedValue(new Error('upstream should not be called'));

    await expect(searchCatalog({ lang: 'en', query: '', page: 1, pageSize: 20 }, 'req-search')).resolves.toMatchObject({
      total: 1,
      results: [{ id: 'one', title: 'Back Squat' }],
    });

    expect(mockedYMove.forwardToYMove).not.toHaveBeenCalled();
    expect(mockedRepo.createCatalogVersion).not.toHaveBeenCalled();
  });

  it('searches all Redis language indexes because response lang is not query lang', async () => {
    mockedRepo.getActiveCatalogVersion.mockResolvedValue('v1');
    mockedRepo.getCatalogMetadata.mockResolvedValue({
      lastSyncedAt: new Date().toISOString(),
      exerciseCount: 1,
    });
    mockedRepo.getIdsByExactToken.mockImplementation(async (lang: string, token: string) => (
      lang === 'pt' && token === 'agachamento' ? ['squat-1'] : []
    ));
    mockedRepo.getIdsByPrefix.mockResolvedValue([]);
    mockedRepo.getSynonymTargets.mockResolvedValue([]);
    mockedRepo.getTokensByPrefix.mockResolvedValue([]);
    mockedRepo.getPopularityScores.mockResolvedValue({ 'squat-1': 0 });
    mockedRepo.getCatalogDocuments.mockResolvedValue([
      {
        id: 'squat-1',
        slug: 'back-squat',
        muscleGroup: 'quads',
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
            title: 'Back Squat',
            description: 'desc',
            instructions: ['step'],
            importantPoints: ['point'],
            status: 'source',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
          pt: {
            title: 'Agachamento',
            description: 'desc',
            instructions: ['passo'],
            importantPoints: ['ponto'],
            status: 'reviewed',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        },
      },
    ]);

    await expect(searchCatalog({ lang: 'en-US', query: 'agachamento', page: 1, pageSize: 20 }, 'req-cross-lang'))
      .resolves.toMatchObject({
        total: 1,
        results: [{ id: 'squat-1', title: 'Back Squat', localizationStatus: 'source' }],
        meta: { lang: 'en' },
      });

    expect(mockedRepo.getIdsByExactToken).toHaveBeenCalledWith('pt', 'agachamento', expect.any(Number), 'v1');
    expect(mockedYMove.forwardToYMove).not.toHaveBeenCalled();
  });

  it('fills Redis from YMove when a non-empty search misses Redis, then returns Redis-localized results', async () => {
    let providerFilled = false;
    mockedRepo.getActiveCatalogVersion.mockResolvedValue('v1');
    mockedRepo.getCatalogMetadata.mockResolvedValue({
      lastSyncedAt: new Date().toISOString(),
      exerciseCount: 10,
    });
    mockedRepo.getIdsByExactToken.mockImplementation(async (lang: string, token: string) => (
      providerFilled && lang === 'pt' && token === 'agachamento' ? ['squat-1'] : []
    ));
    mockedRepo.getIdsByPrefix.mockResolvedValue([]);
    mockedRepo.getSynonymTargets.mockResolvedValue([]);
    mockedRepo.getTokensByPrefix.mockResolvedValue([]);
    mockedRepo.getPopularityScores.mockResolvedValue({});
    mockedRepo.getCatalogDocument.mockResolvedValue(null);
    mockedRepo.saveCatalogDocument.mockImplementation(async () => {
      providerFilled = true;
    });

    mockedRepo.getCatalogDocuments.mockImplementation(async () => (
      providerFilled
        ? [
        {
          id: 'squat-1',
          slug: 'back-squat',
          muscleGroup: 'quads',
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
              title: 'Back Squat',
              description: 'desc',
              instructions: ['step'],
              importantPoints: ['point'],
              status: 'source',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            pt: {
              title: 'Agachamento',
              description: 'pt:desc',
              instructions: ['pt:step'],
              importantPoints: ['pt:point'],
              status: 'machine',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          },
        },
      ]
        : []
    ));

    mockedTranslate.translateQueryToEnglish.mockResolvedValue('squat');
    mockedTranslate.translateTexts.mockImplementation(async (texts: string[], lang: string) => texts.map((text) => (
      lang === 'pt' && text === 'Back Squat' ? 'Agachamento' : `${lang}:${text}`
    )));
    mockedYMove.forwardToYMove.mockImplementation(async (url: string) => ({
      page: 1,
      pageSize: 20,
      total: url.includes('search=squat') ? 1 : 0,
      exercises: url.includes('search=squat')
        ? [
          {
            id: 'squat-1',
            title: 'Back Squat',
            slug: 'back-squat',
            description: 'desc',
            instructions: ['step'],
            importantPoints: ['point'],
            muscleGroup: 'quads',
            secondaryMuscles: null,
            equipment: 'barbell',
            category: 'strength',
            difficulty: 'intermediate',
            videoDurationSecs: null,
            hasVideo: true,
            hasVideoWhite: false,
            hasVideoGym: true,
            exerciseType: ['strength'],
            videoUrl: null,
            videoHlsUrl: null,
            thumbnailUrl: null,
            videos: null,
          },
        ]
        : [],
    }));

    await expect(searchCatalog({ lang: 'en-US', query: 'agachamento', page: 1, pageSize: 20 }, 'req-fill'))
      .resolves.toMatchObject({
        total: 1,
        results: [{ id: 'squat-1', title: 'Back Squat' }],
      });

    expect(mockedTranslate.translateQueryToEnglish).toHaveBeenCalledWith('agachamento', undefined, 'req-fill');
    expect(mockedYMove.forwardToYMove).toHaveBeenLastCalledWith(
      expect.stringContaining('search=squat'),
      'GET',
      'req-fill',
    );
    expect(mockedRepo.saveCatalogDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'squat-1',
        localizations: expect.objectContaining({
          en: expect.objectContaining({ status: 'source' }),
          pt: expect.objectContaining({ status: 'machine' }),
        }),
      }),
      'v1',
    );
  });

  it('removes stale localized search index tokens before reindexing a reviewed localization', async () => {
    mockedRepo.getActiveCatalogVersion.mockResolvedValue('v1');
    mockedRepo.getCatalogDocument.mockResolvedValue({
      id: 'one',
      slug: 'old-squat',
      muscleGroup: 'legs',
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
          title: 'Old Squat',
          description: 'desc',
          instructions: ['step'],
          importantPoints: ['point'],
          status: 'reviewed',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        pt: {
          title: 'Agachamento Antigo',
          description: 'desc',
          instructions: ['step'],
          importantPoints: ['point'],
          status: 'machine',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      },
    });
    mockedRepo.getExerciseIndexedTokens.mockResolvedValue(['agachamento', 'antigo']);

    await reviewCatalogLocalization({
      exerciseId: 'one',
      lang: 'pt',
      status: 'reviewed',
      title: 'Avanco Novo',
    });

    expect(mockedRepo.removeExerciseTokenIndexes).toHaveBeenCalledWith(
      'pt',
      'one',
      ['agachamento', 'antigo'],
      'v1',
    );
    expect(mockedRepo.setExerciseIndexedTokens).toHaveBeenCalledWith(
      'pt',
      'one',
      expect.arrayContaining(['avanco', 'novo']),
      'v1',
    );
  });

  it('returns catalog detail from Redis localized to the requested device language', async () => {
    mockedRepo.getActiveCatalogVersion.mockResolvedValue('v1');
    mockedRepo.getCatalogDocument.mockResolvedValue({
      id: 'squat-1',
      slug: 'back-squat',
      muscleGroup: 'quads',
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
      thumbnailUrl: 'https://cdn/thumb.jpg',
      videos: null,
      localizations: {
        en: {
          title: 'Back Squat',
          description: 'desc',
          instructions: ['step'],
          importantPoints: ['point'],
          status: 'source',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        pt: {
          title: 'Agachamento',
          description: 'descricao',
          instructions: ['passo'],
          importantPoints: ['ponto'],
          status: 'reviewed',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      },
    });

    await expect(getCatalogExerciseById('squat-1', 'pt-BR', 'req-detail')).resolves.toMatchObject({
      id: 'squat-1',
      title: 'Agachamento',
      localizationStatus: 'reviewed',
      thumbnailUrl: 'https://cdn/thumb.jpg',
    });

    expect(mockedYMove.forwardToYMove).not.toHaveBeenCalled();
  });

  it('fills Redis from YMove when catalog detail is missing', async () => {
    mockedRepo.getActiveCatalogVersion.mockResolvedValue('v1');
    mockedRepo.getCatalogMetadata.mockResolvedValue({
      lastSyncedAt: new Date().toISOString(),
      exerciseCount: 10,
    });
    mockedRepo.getCatalogDocument.mockResolvedValueOnce(null);
    mockedRepo.getCatalogDocument.mockResolvedValueOnce({
      id: 'squat-1',
      slug: 'back-squat',
      muscleGroup: 'quads',
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
      thumbnailUrl: 'https://cdn/thumb.jpg',
      videos: null,
      localizations: {
        en: {
          title: 'Back Squat',
          description: 'desc',
          instructions: ['step'],
          importantPoints: ['point'],
          status: 'source',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      },
    });
    mockedYMove.forwardToYMove.mockResolvedValue({
      page: 1,
      pageSize: 1,
      total: 1,
      exercises: [
        {
          id: 'squat-1',
          title: 'Back Squat',
          slug: 'back-squat',
          description: 'desc',
          instructions: ['step'],
          importantPoints: ['point'],
          muscleGroup: 'quads',
          secondaryMuscles: null,
          equipment: 'barbell',
          category: 'strength',
          difficulty: 'intermediate',
          videoDurationSecs: null,
          hasVideo: true,
          hasVideoWhite: false,
          hasVideoGym: true,
          exerciseType: ['strength'],
          videoUrl: null,
          videoHlsUrl: null,
          thumbnailUrl: 'https://cdn/thumb.jpg',
          videos: null,
        },
      ],
    });

    await expect(getCatalogExerciseById('squat-1', 'en-US', 'req-detail-fill')).resolves.toMatchObject({
      id: 'squat-1',
      title: 'Back Squat',
      localizationStatus: 'source',
    });

    expect(mockedYMove.forwardToYMove).toHaveBeenCalledWith(
      'https://exercise-api.ymove.app/api/v2/exercises/squat-1',
      'GET',
      'req-detail-fill',
    );
    expect(mockedRepo.saveCatalogDocument).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'squat-1' }),
      'v1',
    );
  });

  it('returns null when catalog detail is missing and YMove returns 404', async () => {
    const upstreamMissing = new ymoveClient.YMoveError('YMove API returned 404', 404);
    mockedRepo.getActiveCatalogVersion.mockResolvedValue('v1');
    mockedRepo.getCatalogMetadata.mockResolvedValue({
      lastSyncedAt: new Date().toISOString(),
      exerciseCount: 10,
    });
    mockedRepo.getCatalogDocument.mockResolvedValue(null);
    mockedYMove.forwardToYMove.mockRejectedValue(upstreamMissing);

    await expect(getCatalogExerciseById('missing', 'en-US', 'req-detail-404')).resolves.toBeNull();
  });
});
