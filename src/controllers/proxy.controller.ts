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

  try {
    const { response } = await executeProxy(body);
    res.status(200).json(response);
  } catch (err) {
    if (err instanceof UrlValidationError) {
      logger.warn({ error: serializeError(err) }, 'URL validation failed');
      res.status(400).json({
        error: 'bad_request',
        message: err.message,
      });
      return;
    }

    if (err instanceof YMoveError) {
      const statusCode = err.statusCode ?? 502;
      logger.error({ error: serializeError(err) }, 'YMove upstream error');
      res.status(502).json({
        error: 'Upstream API failure',
        status: statusCode,
      });
      return;
    }

    logger.error({ error: serializeError(err) }, 'Unexpected error during proxy execution');
    res.status(500).json({
      error: 'internal_error',
      message: 'An unexpected error occurred',
    });
  }
}
