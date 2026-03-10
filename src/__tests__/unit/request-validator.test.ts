/**
 * Unit tests – request validator middleware
 */
import { Request, Response, NextFunction } from 'express';
import { validateProxyBody } from '../../middleware/request-validator';

interface ReqResContext {
  req: Request;
  res: Partial<Response>;
  next: NextFunction;
  getStatusCode: () => number | null;
  getResponseBody: () => unknown;
}

function makeReqRes(body: unknown): ReqResContext {
  let statusCode: number | null = null;
  let responseBody: unknown = null;

  const res = {
    status: jest.fn().mockImplementation((code: number) => {
      statusCode = code;
      return res;
    }),
    json: jest.fn().mockImplementation((data: unknown) => {
      responseBody = data;
      return res;
    }),
  } as Partial<Response>;

  const req = { body } as Request;
  const next = jest.fn() as NextFunction;

  return {
    req,
    res,
    next,
    getStatusCode: () => statusCode,
    getResponseBody: () => responseBody,
  };
}

describe('validateProxyBody', () => {
  it('passes valid body to next()', () => {
    const { req, res, next } = makeReqRes({
      lang: 'pt',
      request: {
        url: 'https://exercise-api.ymove.app/api/v2/exercises?search=Press',
        method: 'GET',
        headers: { 'X-API-Key': 'test' },
      },
    });

    validateProxyBody(req, res as Response, next);
    expect(next).toHaveBeenCalled();
  });

  it('returns 400 when `request` is missing', () => {
    const { req, res, next, getStatusCode } = makeReqRes({ lang: 'pt' });
    validateProxyBody(req, res as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(getStatusCode()).toBe(400);
  });

  it('returns 400 when `request.url` is missing', () => {
    const { req, res, next, getStatusCode } = makeReqRes({
      lang: 'pt',
      request: { method: 'GET', headers: {} },
    });
    validateProxyBody(req, res as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(getStatusCode()).toBe(400);
  });

  it('returns 400 when `request.method` is missing', () => {
    const { req, res, next, getStatusCode } = makeReqRes({
      lang: 'pt',
      request: { url: 'https://exercise-api.ymove.app/api/v2/exercises', headers: {} },
    });
    validateProxyBody(req, res as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(getStatusCode()).toBe(400);
  });

  it('returns 400 for unsupported HTTP method (POST)', () => {
    const { req, res, next, getStatusCode } = makeReqRes({
      lang: 'pt',
      request: {
        url: 'https://exercise-api.ymove.app/api/v2/exercises',
        method: 'POST',
        headers: {},
      },
    });
    validateProxyBody(req, res as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(getStatusCode()).toBe(400);
  });

  it('defaults lang to empty string when not provided', () => {
    const { req, res, next } = makeReqRes({
      request: {
        url: 'https://exercise-api.ymove.app/api/v2/exercises',
        method: 'GET',
        headers: {},
      },
    });
    validateProxyBody(req, res as Response, next);
    expect(next).toHaveBeenCalled();
    expect((req.body as { lang: string }).lang).toBe('');
  });

  it('uppercases the HTTP method', () => {
    const { req, res, next } = makeReqRes({
      request: {
        url: 'https://exercise-api.ymove.app/api/v2/exercises',
        method: 'get',
        headers: {},
      },
    });
    validateProxyBody(req, res as Response, next);
    expect(next).toHaveBeenCalled();
    expect((req.body as { request: { method: string } }).request.method).toBe('GET');
  });

  it('returns 400 when headers is an array', () => {
    const { req, res, next, getStatusCode } = makeReqRes({
      request: {
        url: 'https://exercise-api.ymove.app/api/v2/exercises',
        method: 'GET',
        headers: ['bad'],
      },
    });
    validateProxyBody(req, res as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(getStatusCode()).toBe(400);
  });
});
