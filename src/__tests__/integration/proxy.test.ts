import request from 'supertest';
import { createApp } from '../../server';

describe('Legacy /proxy endpoint', () => {
  const app = createApp();

  it('returns 410 for POST /proxy with migration details', async () => {
    const res = await request(app)
      .post('/proxy')
      .send({
        lang: 'pt',
        request: {
          url: 'https://exercise-api.ymove.app/api/v2/exercises?page=1&pageSize=20&search=Agachamento',
          method: 'GET',
          headers: { Accept: 'application/json' },
        },
      });

    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('legacy_proxy_removed');
    expect(res.body.error.details.replacement).toBe('/catalog/search');
  });

  it('returns 404 for GET /proxy', async () => {
    const res = await request(app).get('/proxy');
    expect(res.status).toBe(404);
  });

  it('keeps /health and /metrics available', async () => {
    const health = await request(app).get('/health');
    expect(health.status).toBe(200);
    expect(health.body.status).toBe('ok');

    const metrics = await request(app).get('/metrics');
    expect(metrics.status).toBe(200);
    expect(metrics.headers['content-type']).toContain('text/plain');
  });
});
