/**
 * Express middleware that enforces MyChampions server session authentication.
 *
 * Expects:  Authorization: Bearer <mychampions-access-token>
 * On success: attaches `res.locals.uid` with the authenticated user ID.
 * On session rejection: responds 401; on auth-authority failure: responds 503.
 *
 * Mirrors the food microservice's `authGuard` (mychampionsapi-food/src/middleware/auth-guard.ts),
 * adapted to this service's `{ error: { code, message, status, requestId } }` response contract.
 */
import { NextFunction, Request, Response } from 'express';
import { MyChampionsAuthError, verifyMyChampionsAccessToken } from '../auth/mychampions-auth';
import { logger } from '../logger';

function unauthorized(res: Response, requestId: string, message: string): void {
  res.status(401).json({
    error: {
      code: 'unauthorized',
      message,
      status: 401,
      requestId,
    },
  });
}

export async function authGuard(req: Request, res: Response, next: NextFunction): Promise<void> {
  const requestId = (res.locals?.requestId as string) ?? 'unknown';
  const authHeader = req.header('authorization');

  if (!authHeader) {
    unauthorized(res, requestId, 'Missing Authorization header');
    return;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer' || parts[1].trim().length === 0) {
    unauthorized(res, requestId, 'Invalid Authorization header format');
    return;
  }

  const accessToken = parts[1];

  try {
    const user = await verifyMyChampionsAccessToken(accessToken);
    res.locals.uid = user.uid;
    next();
  } catch (error) {
    if (error instanceof MyChampionsAuthError && error.code === 'unauthenticated') {
      logger.warn({ requestId, reason: 'root_auth_rejected' }, 'MyChampions access token verification failed');
      unauthorized(res, requestId, 'Invalid or expired token');
      return;
    }

    logger.warn(
      {
        requestId,
        reason: 'root_auth_unavailable',
        error: error instanceof Error ? error.message : String(error),
      },
      'MyChampions auth server is unavailable',
    );
    res.status(503).json({
      error: {
        code: 'auth_unavailable',
        message: 'Authentication service is unavailable',
        status: 503,
        requestId,
      },
    });
  }
}
