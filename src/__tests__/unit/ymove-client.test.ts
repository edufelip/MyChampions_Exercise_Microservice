import nock from 'nock';

jest.mock('../../config', () => ({
  config: {
    upstreamTimeoutMs: 2000,
    upstreamMaxRetries: 1,
    ymoveApiKey: () => 'server-key',
  },
}));

jest.mock('../../logger', () => ({
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}));

import { forwardToYMove, YMoveError } from '../../infrastructure/ymove-client';

describe('forwardToYMove', () => {
  beforeEach(() => {
    nock.cleanAll();
  });

  afterAll(() => {
    nock.cleanAll();
  });

  it('retries once on 5xx and succeeds', async () => {
    const scope = nock('https://exercise-api.ymove.app')
      .get('/api/v2/exercises')
      .query({ search: 'Press' })
      .reply(503, { message: 'temporary' })
      .get('/api/v2/exercises')
      .query({ search: 'Press' })
      .reply(200, {
        page: 1,
        pageSize: 20,
        total: 1,
        exercises: [{ id: '1', title: 'Bench Press' }],
      });

    const result = await forwardToYMove(
      'https://exercise-api.ymove.app/api/v2/exercises?search=Press',
      'GET',
      'req-1',
    );

    expect(result.total).toBe(1);
    expect(scope.isDone()).toBe(true);
  });

  it('does not retry on 4xx and throws YMoveError', async () => {
    nock('https://exercise-api.ymove.app')
      .get('/api/v2/exercises')
      .query({ search: 'Press' })
      .reply(400, { error: 'bad request' });

    await expect(
      forwardToYMove(
        'https://exercise-api.ymove.app/api/v2/exercises?search=Press',
        'GET',
        'req-2',
      ),
    ).rejects.toMatchObject<Partial<YMoveError>>({
      name: 'YMoveError',
      statusCode: 400,
    });
  });

  it('sends server-side API key header', async () => {
    const scope = nock('https://exercise-api.ymove.app', {
      reqheaders: {
        'x-api-key': 'server-key',
      },
    })
      .get('/api/v2/exercises')
      .query({ search: 'Press' })
      .reply(200, {
        page: 1,
        pageSize: 20,
        total: 0,
        exercises: [],
      });

    await forwardToYMove(
      'https://exercise-api.ymove.app/api/v2/exercises?search=Press',
      'GET',
      'req-3',
    );

    expect(scope.isDone()).toBe(true);
  });
});
