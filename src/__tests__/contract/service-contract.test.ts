import request from 'supertest';

process.env.CATALOG_REVIEW_API_KEY = 'contract-review-key';

jest.mock('../../services/catalog.service', () => ({
  CatalogError: class CatalogError extends Error {
    statusCode = 500;
    code = 'catalog_error';
  },
  searchCatalog: jest.fn(),
  getCatalogHealth: jest.fn(),
  getCatalogExerciseById: jest.fn(),
  reviewCatalogLocalization: jest.fn(),
}));

jest.mock('../../services/provider-benchmark.service', () => ({
  CatalogBenchmarkError: class CatalogBenchmarkError extends Error {},
  runCatalogProviderBenchmark: jest.fn(),
}));

import { CatalogExerciseDTO, CatalogSearchResponseDTO } from '../../domain/dtos';
import { createApp } from '../../server';
import { searchCatalog } from '../../services/catalog.service';

const mockedSearchCatalog = searchCatalog as jest.MockedFunction<typeof searchCatalog>;
const app = createApp();

const CONTRACT_EXERCISE: CatalogExerciseDTO = {
  id: 'contract-exercise',
  slug: 'squat',
  title: 'Squat',
  description: 'A complete contract exercise fixture.',
  instructions: ['Stand tall', 'Bend your knees'],
  importantPoints: ['Keep your core braced'],
  muscleGroup: 'legs',
  secondaryMuscles: 'glutes',
  equipment: 'barbell',
  category: 'strength',
  difficulty: 'beginner',
  exerciseType: ['compound'],
  hasVideo: false,
  hasVideoWhite: false,
  hasVideoGym: false,
  videos: null,
  videoUrl: null,
  videoHlsUrl: null,
  thumbnailUrl: null,
  videoDurationSecs: null,
  localizationStatus: 'source',
};

const CONTRACT_RESPONSE: CatalogSearchResponseDTO = {
  page: 1,
  pageSize: 20,
  total: 1,
  results: [CONTRACT_EXERCISE],
  meta: {
    lang: 'en',
    normalizedQuery: 'squat',
    tookMs: 0,
    catalogSyncedAt: null,
  },
};

describe('exercise service consumer contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedSearchCatalog.mockReset();
  });

  it('preserves every required catalog search field and forwards normalized request input', async () => {
    mockedSearchCatalog.mockResolvedValue(CONTRACT_RESPONSE);

    const response = await request(app)
      .post('/catalog/search')
      .send({ query: 'squat', page: 1, pageSize: 20, lang: 'en-US' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(CONTRACT_RESPONSE);
    expect(mockedSearchCatalog).toHaveBeenCalledWith(
      { query: 'squat', page: 1, pageSize: 20, lang: 'en-US' },
      expect.any(String),
    );
    expect(JSON.stringify(response.body)).not.toMatch(/YMOVE_API_KEY|GOOGLE_TRANSLATE_API_KEY/);
  });

  it('maps an unexpected provider failure to a generic secret-free response', async () => {
    mockedSearchCatalog.mockRejectedValue(new Error('YMOVE_API_KEY=contract-secret'));

    const response = await request(app)
      .post('/catalog/search')
      .send({ query: 'squat', page: 1, pageSize: 20, lang: 'en-US' });

    expect(response.status).toBe(500);
    expect(response.body.error).toEqual(
      expect.objectContaining({
        code: 'internal_error',
        message: 'An unexpected error occurred',
      }),
    );
    expect(JSON.stringify(response.body)).not.toContain('contract-secret');
  });

  it('rejects catalog review without the operator key', async () => {
    const response = await request(app)
      .post('/catalog/review')
      .send({ exerciseId: 'contract-exercise', lang: 'en', status: 'approved' });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('unauthorized');
  });

  it('keeps the health response service-owned and secret-free', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({ status: 'ok', service: 'exercise-microservice' }),
    );
    expect(JSON.stringify(response.body)).not.toMatch(/secret|token|password/i);
  });
});
