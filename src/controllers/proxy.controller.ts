/**
 * POST /proxy controller.
 *
 * Orchestrates: input validation → proxy service → structured response.
 *
 * Error mapping:
 *   - UrlValidationError → 400
 *   - YMoveError         → 502
 *   - Unknown            → 500
 */
import { Request, Response } from 'express';
import { executeProxy, YMoveError, UrlValidationError } from '../services/proxy.service';
import { RequestDTO } from '../domain/dtos';
import { logger } from '../logger';
import { incCounter } from '../observability/metrics';

function getRequestId(res: Response): string {
  return (res.locals.requestId as string) ?? 'unknown';
}

function errorBody(
  requestId: string,
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    error: {
      code,
      message,
      status,
      requestId,
      ...(details ? { details } : {}),
    },
  };
}

function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof YMoveError || err instanceof UrlValidationError) {
    return { name: err.name, message: err.message };
  }
  if (err instanceof Error) {
    return { name: err.name };
  }
  return { type: typeof err };
}

export async function proxyController(req: Request, res: Response): Promise<void> {
  const body = req.body as RequestDTO;
  const requestId = getRequestId(res);

  try {
    const { response } = await executeProxy(body);
    res.status(200).json(response);
  } catch (err) {
    if (err instanceof UrlValidationError) {
      incCounter('requests_total', { lang: 'unknown', status: 'bad_request' });
      logger.warn({ requestId, error: serializeError(err) }, 'URL validation failed');
      res.status(400).json(errorBody(requestId, 400, 'bad_request', err.message));
      return;
    }

    if (err instanceof YMoveError) {
      const statusCode = err.statusCode ?? 502;
      incCounter('requests_total', { lang: 'unknown', status: 'upstream_error' });
      incCounter('upstream_requests_total', { status: 'error' });
      logger.error({ requestId, error: serializeError(err) }, 'YMove upstream error');
      res.status(502).json(
        errorBody(requestId, 502, 'upstream_error', 'Upstream API failure', {
          upstreamStatus: statusCode,
        }),
      );
      return;
    }

    incCounter('requests_total', { lang: 'unknown', status: 'internal_error' });
    logger.error({ requestId, error: serializeError(err) }, 'Unexpected error during proxy execution');
    res.status(500).json(errorBody(requestId, 500, 'internal_error', 'An unexpected error occurred'));
  }
}
