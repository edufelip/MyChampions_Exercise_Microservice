/**
 * Unit tests – auth guard middleware.
 */
import { NextFunction, Request, Response } from 'express';
import { authGuard } from '../../middleware/auth-guard';

jest.mock('../../auth/mychampions-auth', () => {
  class MyChampionsAuthError extends Error {
    constructor(public readonly code: 'unauthenticated' | 'unavailable') {
      super(code);
    }
  }
  return {
    MyChampionsAuthError,
    verifyMyChampionsAccessToken: jest.fn(),
  };
});

import { MyChampionsAuthError, verifyMyChampionsAccessToken } from '../../auth/mychampions-auth';
const mockedVerify = verifyMyChampionsAccessToken as jest.MockedFunction<typeof verifyMyChampionsAccessToken>;

function mockReq(authHeader?: string): Partial<Request> {
  return {
    headers: authHeader ? { authorization: authHeader } : {},
    header: ((name: string) =>
      name.toLowerCase() === 'authorization' ? authHeader : undefined) as Request['header'],
  };
}

function mockRes(): { res: Partial<Response>; statusFn: jest.Mock; jsonFn: jest.Mock } {
  const jsonFn = jest.fn();
  const statusFn = jest.fn().mockReturnValue({ json: jsonFn });
  const res: Partial<Response> = {
    status: statusFn as never,
    locals: { requestId: 'req-test' },
  };
  return { res, statusFn, jsonFn };
}

describe('authGuard middleware', () => {
  let next: NextFunction;

  beforeEach(() => {
    next = jest.fn();
    jest.clearAllMocks();
  });

  it('returns 401 when Authorization header is missing', async () => {
    const req = mockReq();
    const { res, statusFn, jsonFn } = mockRes();

    await authGuard(req as Request, res as Response, next);

    expect(statusFn).toHaveBeenCalledWith(401);
    expect(jsonFn).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'unauthorized' }) }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when Authorization header has wrong format', async () => {
    const req = mockReq('InvalidFormat');
    const { res, statusFn } = mockRes();

    await authGuard(req as Request, res as Response, next);

    expect(statusFn).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when root auth rejects the token', async () => {
    mockedVerify.mockRejectedValue(new MyChampionsAuthError('unauthenticated', 'rejected'));
    const req = mockReq('Bearer bad-token');
    const { res, statusFn, jsonFn } = mockRes();

    await authGuard(req as Request, res as Response, next);

    expect(statusFn).toHaveBeenCalledWith(401);
    expect(jsonFn).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'unauthorized' }) }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next and sets uid when root auth accepts the token', async () => {
    mockedVerify.mockResolvedValue({ uid: 'user-123' });
    const req = mockReq('Bearer valid-token');
    const { res } = mockRes();

    await authGuard(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
    expect(res.locals?.uid).toBe('user-123');
  });

  it('returns 503 when root auth is unavailable', async () => {
    mockedVerify.mockRejectedValue(new MyChampionsAuthError('unavailable', 'unavailable'));
    const req = mockReq('Bearer valid-token');
    const { res, statusFn, jsonFn } = mockRes();

    await authGuard(req as Request, res as Response, next);

    expect(statusFn).toHaveBeenCalledWith(503);
    expect(jsonFn).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'auth_unavailable' }) }),
    );
    expect(next).not.toHaveBeenCalled();
  });
});
