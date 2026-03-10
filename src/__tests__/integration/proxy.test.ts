/**
 * Integration tests – POST /proxy with mocked external dependencies.
 *
 * The YMove client, translate client, and Redis cache are mocked so tests
 * run without external dependencies.
 */
import request from 'supertest';
import { createApp } from '../../server';

// Mock the proxy service to avoid all infrastructure dependencies
jest.mock('../../services/proxy.service', () => {
  class UrlValidationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'UrlValidationError';
    }
  }

  class YMoveError extends Error {
    statusCode?: number;
    constructor(message: string, statusCode?: number) {
      super(message);
      this.name = 'YMoveError';
      this.statusCode = statusCode;
    }
  }

  return {
    executeProxy: jest.fn(),
    UrlValidationError,
    YMoveError,
  };
});

import { executeProxy } from '../../services/proxy.service';
import { YMoveError, UrlValidationError } from '../../services/proxy.service';

const mockedExecuteProxy = executeProxy as jest.MockedFunction<typeof executeProxy>;

const VALID_BODY = {
  lang: 'pt',
  request: {
    url: 'https://exercise-api.ymove.app/api/v2/exercises?search=Press',
    method: 'GET',
    headers: { Accept: 'application/json' },
  },
};

const MOCK_RESPONSE = {
  page: 1,
  pageSize: 20,
  total: 1,
  exercises: [
    {
      id: 'abc123',
      title: 'Supino com barra',
      slug: 'bench-press',
      description: 'Um exercício de peito',
      instructions: ['Deite-se na bancada'],
      importantPoints: ['Mantenha a forma'],
      muscleGroup: 'chest',
      secondaryMuscles: null,
      equipment: 'barbell',
      category: 'Chest',
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

const MOCK_METRICS = {
  requestId: 'test-id',
  userLang: 'pt',
  searchTermOriginal: 'Press',
  searchTermTranslated: 'Press',
  cacheHits: 0,
  cacheMisses: 1,
  translationCalls: 1,
  translatedCharacters: 50,
  durationMs: 42,
};

describe('POST /proxy', () => {
  const app = createApp();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Happy path', () => {
    it('returns 200 with translated exercises', async () => {
      mockedExecuteProxy.mockResolvedValue({
        response: MOCK_RESPONSE,
        metrics: MOCK_METRICS,
      });

      const res = await request(app).post('/proxy').send(VALID_BODY);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('exercises');
      expect(res.body.exercises).toHaveLength(1);
      expect(res.body.exercises[0].title).toBe('Supino com barra');
    });

    it('returns 200 with empty exercises when none found', async () => {
      mockedExecuteProxy.mockResolvedValue({
        response: { ...MOCK_RESPONSE, exercises: [], total: 0 },
        metrics: MOCK_METRICS,
      });

      const res = await request(app).post('/proxy').send(VALID_BODY);

      expect(res.status).toBe(200);
      expect(res.body.exercises).toHaveLength(0);
    });
  });

  describe('Input validation', () => {
    it('returns 400 when `request` is missing', async () => {
      const res = await request(app).post('/proxy').send({ lang: 'pt' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('bad_request');
    });

    it('returns 400 when `request.url` is missing', async () => {
      const res = await request(app).post('/proxy').send({
        lang: 'pt',
        request: { method: 'GET', headers: {} },
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 for unsupported method (DELETE)', async () => {
      const res = await request(app).post('/proxy').send({
        lang: 'pt',
        request: {
          url: 'https://exercise-api.ymove.app/api/v2/exercises',
          method: 'DELETE',
          headers: {},
        },
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when forbidden upstream header is provided', async () => {
      const res = await request(app).post('/proxy').send({
        lang: 'pt',
        request: {
          url: 'https://exercise-api.ymove.app/api/v2/exercises',
          method: 'GET',
          headers: { 'X-API-Key': 'user-supplied' },
        },
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('bad_request');
    });
  });

  describe('Error mapping', () => {
    it('returns 400 on UrlValidationError', async () => {
      mockedExecuteProxy.mockRejectedValue(
        new UrlValidationError('Forbidden host'),
      );

      const res = await request(app).post('/proxy').send(VALID_BODY);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('bad_request');
    });

    it('returns 502 on YMoveError', async () => {
      mockedExecuteProxy.mockRejectedValue(new YMoveError('Upstream failure', 503));

      const res = await request(app).post('/proxy').send(VALID_BODY);
      expect(res.status).toBe(502);
      expect(res.body.error.code).toBe('upstream_error');
    });

    it('returns 500 on unexpected error', async () => {
      mockedExecuteProxy.mockRejectedValue(new Error('Something went wrong'));

      const res = await request(app).post('/proxy').send(VALID_BODY);
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('internal_error');
      expect(JSON.stringify(res.body)).not.toContain('Something went wrong');
    });
  });

  describe('Health endpoint', () => {
    it('returns 200 with status ok', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.service).toBe('exercise-microservice');
    });
  });

  describe('Metrics endpoint', () => {
    it('returns Prometheus-compatible plaintext', async () => {
      const res = await request(app).get('/metrics');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');
      expect(res.text).toContain('requests_total');
    });
  });

  describe('Method routing', () => {
    it('returns 404 for unknown routes', async () => {
      const res = await request(app).get('/unknown');
      expect(res.status).toBe(404);
    });

    it('returns 404 for GET /proxy', async () => {
      const res = await request(app).get('/proxy');
      expect(res.status).toBe(404);
    });
  });
});
