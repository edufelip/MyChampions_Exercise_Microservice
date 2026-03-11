import request from 'supertest';

process.env.CATALOG_REVIEW_API_KEY = 'test-review-key';
import { createApp } from '../../server';

jest.mock('../../services/catalog.service', () => {
  class CatalogError extends Error {
    statusCode: number;
    code: string;

    constructor(message: string, statusCode = 500, code = 'catalog_error') {
      super(message);
      this.name = 'CatalogError';
      this.statusCode = statusCode;
      this.code = code;
    }
  }

  return {
    searchCatalog: jest.fn(),
    getCatalogHealth: jest.fn(),
    reviewCatalogLocalization: jest.fn(),
    CatalogError,
  };
});

jest.mock('../../services/provider-benchmark.service', () => {
  class CatalogBenchmarkError extends Error {
    statusCode: number;
    code: string;

    constructor(message: string, statusCode = 400, code = 'bad_request') {
      super(message);
      this.name = 'CatalogBenchmarkError';
      this.statusCode = statusCode;
      this.code = code;
    }
  }

  return {
    runCatalogProviderBenchmark: jest.fn(),
    CatalogBenchmarkError,
  };
});

import {
  CatalogError,
  getCatalogHealth,
  reviewCatalogLocalization,
  searchCatalog,
} from '../../services/catalog.service';
import {
  CatalogBenchmarkError,
  runCatalogProviderBenchmark,
} from '../../services/provider-benchmark.service';

const mockedSearchCatalog = searchCatalog as jest.MockedFunction<typeof searchCatalog>;
const mockedGetCatalogHealth = getCatalogHealth as jest.MockedFunction<typeof getCatalogHealth>;
const mockedReviewCatalogLocalization = reviewCatalogLocalization as jest.MockedFunction<typeof reviewCatalogLocalization>;
const mockedRunCatalogProviderBenchmark = runCatalogProviderBenchmark as jest.MockedFunction<typeof runCatalogProviderBenchmark>;

const app = createApp();

describe('catalog endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('POST /catalog/search returns 200 with search payload', async () => {
    mockedSearchCatalog.mockResolvedValue({
      page: 1,
      pageSize: 20,
      total: 1,
      results: [{ id: '1', title: 'Supino' } as never],
      meta: {
        lang: 'pt',
        normalizedQuery: 'supi',
        tookMs: 10,
        catalogSyncedAt: new Date().toISOString(),
      },
    });

    const res = await request(app)
      .post('/catalog/search')
      .send({ lang: 'pt', query: 'supi', page: 1, pageSize: 20 });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.meta.lang).toBe('pt');
  });

  it('POST /catalog/search returns 400 for invalid page', async () => {
    const res = await request(app)
      .post('/catalog/search')
      .send({ lang: 'pt', query: 'supi', page: 'abc' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('bad_request');
  });

  it('POST /catalog/search maps CatalogError', async () => {
    mockedSearchCatalog.mockRejectedValue(new CatalogError('Catalog disabled', 503, 'catalog_disabled'));

    const res = await request(app)
      .post('/catalog/search')
      .send({ lang: 'pt', query: 'supi' });

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('catalog_disabled');
  });

  it('GET /catalog/health returns 200', async () => {
    mockedGetCatalogHealth.mockResolvedValue({
      ready: true,
      syncedAt: new Date().toISOString(),
      exerciseCount: 100,
      stale: false,
    });

    const res = await request(app).get('/catalog/health');

    expect(res.status).toBe(200);
    expect(res.body.ready).toBe(true);
  });

  it('POST /catalog/review returns 204', async () => {
    mockedReviewCatalogLocalization.mockResolvedValue();

    const res = await request(app)
      .post('/catalog/review')
      .set('x-catalog-review-key', 'test-review-key')
      .send({ exerciseId: 'abc123', lang: 'pt', status: 'reviewed' });

    expect(res.status).toBe(204);
  });

  it('POST /catalog/review returns 400 for invalid status', async () => {
    const res = await request(app)
      .post('/catalog/review')
      .set('x-catalog-review-key', 'test-review-key')
      .send({ exerciseId: 'abc123', lang: 'pt', status: 'pending' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('bad_request');
  });

  it('POST /catalog/review returns 401 for missing review key', async () => {
    const res = await request(app)
      .post('/catalog/review')
      .send({ exerciseId: 'abc123', lang: 'pt', status: 'reviewed' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  it('POST /catalog/benchmark returns 200 with benchmark payload', async () => {
    mockedRunCatalogProviderBenchmark.mockResolvedValue({
      lang: 'pt',
      pageSize: 10,
      totalQueries: 1,
      summary: {
        avgUpstreamLatencyMs: 120,
        avgCatalogLatencyMs: 90,
        avgTopOverlapRate: 0.6,
      },
      results: [],
    });

    const res = await request(app)
      .post('/catalog/benchmark')
      .set('x-catalog-review-key', 'test-review-key')
      .send({ lang: 'pt', queries: ['supino'] });

    expect(res.status).toBe(200);
    expect(res.body.totalQueries).toBe(1);
  });

  it('POST /catalog/benchmark returns 400 for invalid queries payload', async () => {
    const res = await request(app)
      .post('/catalog/benchmark')
      .set('x-catalog-review-key', 'test-review-key')
      .send({ lang: 'pt', queries: 'supino' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('bad_request');
  });

  it('POST /catalog/benchmark maps benchmark domain errors', async () => {
    mockedRunCatalogProviderBenchmark.mockRejectedValue(
      new CatalogBenchmarkError('Invalid input', 422, 'unprocessable_entity'),
    );

    const res = await request(app)
      .post('/catalog/benchmark')
      .set('x-catalog-review-key', 'test-review-key')
      .send({ lang: 'pt', queries: ['supino'] });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('unprocessable_entity');
  });
});
