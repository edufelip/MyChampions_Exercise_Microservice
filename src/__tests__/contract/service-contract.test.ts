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

import { createApp } from '../../server';
import { searchCatalog } from '../../services/catalog.service';

const mockedSearchCatalog = searchCatalog as jest.MockedFunction<typeof searchCatalog>;
const app = createApp();

describe('exercise service consumer contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps the catalog search response shape stable', async () => {
    mockedSearchCatalog.mockResolvedValue({
      page: 1,
      pageSize: 20,
      total: 1,
      results: [{ id: 'contract-exercise', title: 'Squat' }] as never,
      meta: { lang: 'en', normalizedQuery: 'squat' },
    } as never);

    const response = await request(app)
      .post('/catalog/search')
      .send({ query: 'squat', page: 1, pageSize: 20, lang: 'en-US' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({ page: 1, pageSize: 20, total: 1, results: expect.any(Array) }),
    );
    expect(JSON.stringify(response.body)).not.toMatch(/YMOVE_API_KEY|GOOGLE_TRANSLATE_API_KEY/);
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
